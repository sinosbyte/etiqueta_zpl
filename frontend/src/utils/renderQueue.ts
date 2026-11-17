// The queue every Labelary rendering goes through. The service is public and limited (the app's own proxy allows
// 60 requests a minute per address, shared with generating and simulating), so renderings are not fired at once:
//  - at most `concurrency` at a time;
//  - at most `perMinute` started in any 60 seconds (below the limit, to leave room for the rest of the app);
//  - the selected label goes first (priority), the rest in the order asked;
//  - the same rendering asked twice is one request;
//  - a 429 (or a server/network failure, or a timeout) is tried again with growing waits, and a 429 also stops the
//    whole queue for the wait the service asked for; any other answer (a bad request) is final.

export interface RenderJob {
  key: string;                 // what is rendered (see renderKey): two jobs with one key are one request
  zpl: string;
  width: number;
  height: number;
  priority?: number;           // higher goes first; default 0
  group?: string;              // for cancelling a whole simulation's jobs at once
  bulk?: boolean;              // part of a mass export: the server serves single previews first
}

export type Fetcher = (zpl: string, width: number, height: number, signal: AbortSignal, job: RenderJob) => Promise<Blob>;

export interface QueueOptions {
  fetch: Fetcher;
  concurrency?: number;
  perMinute?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  maxRetryAfterMs?: number;   // a wait longer than this (the service's daily quota, say) is not waited for: the job fails, and can be retried by hand
  now?: () => number;
}

/** How a failure is told from the outside: the HTTP status (0 = no answer) and whether another try could help. */
export class RenderError extends Error {
  constructor(message: string, readonly status: number, readonly retriable: boolean, readonly cancelled = false) {
    super(message);
    this.name = 'RenderError';
  }
}

interface Pending {
  job: RenderJob;
  priority: number;
  seq: number;
  attempts: number;
  notBefore: number;   // a job waiting to be tried again is not started before this time
  resolve(blob: Blob): void;
  reject(e: Error): void;
  waiters: { resolve(blob: Blob): void; reject(e: Error): void }[];
  controller: AbortController | null;
}

const statusOf = (e: unknown): { status: number; retryAfterMs?: number } => {
  const x = e as { status?: unknown; retryAfterMs?: unknown };
  return { status: typeof x?.status === 'number' ? x.status : 0, retryAfterMs: typeof x?.retryAfterMs === 'number' ? x.retryAfterMs : undefined };
};

export class RenderQueue {
  private waiting: Pending[] = [];
  private running = new Map<string, Pending>();
  private started: number[] = [];       // when the requests of the last minute started
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private o: Required<Omit<QueueOptions, 'fetch'>> & { fetch: Fetcher };
  /** Requests sent (every attempt counts), for the tests and the interface. */
  sent = 0;

  constructor(o: QueueOptions) {
    this.o = {
      fetch: o.fetch,
      concurrency: o.concurrency ?? 2,
      perMinute: o.perMinute ?? 45,
      maxRetries: o.maxRetries ?? 3,
      backoffBaseMs: o.backoffBaseMs ?? 2000,
      // Includes the time in the server's queue, where a request waits its turn among all the users
      timeoutMs: o.timeoutMs ?? 45_000,
      maxRetryAfterMs: o.maxRetryAfterMs ?? 120_000,
      now: o.now ?? (() => Date.now()),
    };
  }

  get queued(): number { return this.waiting.length; }
  get active(): number { return this.running.size; }

  /** The rendering, or the error. A key already queued or running shares that request (and takes the higher priority). */
  enqueue(job: RenderJob): Promise<Blob> {
    const existing = this.running.get(job.key) ?? this.waiting.find(p => p.job.key === job.key);
    if (existing) {
      existing.priority = Math.max(existing.priority, job.priority ?? 0);
      return new Promise<Blob>((resolve, reject) => {
        existing.waiters.push({ resolve, reject });
        this.pump();
      });
    }
    return new Promise<Blob>((resolve, reject) => {
      this.waiting.push({ job, priority: job.priority ?? 0, seq: this.seq++, attempts: 0, notBefore: 0, resolve, reject, waiters: [], controller: null });
      this.pump();
    });
  }

  /** Raises the priority of a job that is still waiting (the user selected it). */
  prioritize(key: string, priority: number): void {
    const p = this.waiting.find(w => w.job.key === key);
    if (p) { p.priority = Math.max(p.priority, priority); this.pump(); }
  }

  /** Drops the waiting jobs of a group and aborts its running ones; their promises reject with a cancelled error. */
  cancelGroup(group: string): void {
    const cancelled = new RenderError('Cancelled', 0, false, true);
    this.waiting = this.waiting.filter(p => {
      if (p.job.group !== group) return true;
      this.settle(p, null, cancelled);
      return false;
    });
    for (const p of this.running.values()) {
      if (p.job.group === group) { p.job.priority = -1; p.controller?.abort(); }
    }
  }

  private settle(p: Pending, blob: Blob | null, error: Error | null): void {
    if (blob) { p.resolve(blob); p.waiters.forEach(w => w.resolve(blob)); }
    else if (error) { p.reject(error); p.waiters.forEach(w => w.reject(error)); }
  }

  /** Starts what the limits allow now, and sets a timer for when the next one may start. */
  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const now = this.o.now();
    this.started = this.started.filter(t => now - t < 60_000);
    while (this.running.size < this.o.concurrency) {
      if (now < this.pausedUntil || this.started.length >= this.o.perMinute) break;
      const ready = this.waiting.filter(p => p.notBefore <= now).sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      if (ready.length === 0) break;
      const next = ready[0];
      this.waiting = this.waiting.filter(p => p !== next);
      this.started.push(now);
      this.running.set(next.job.key, next);
      void this.run(next);
    }
    if (this.waiting.length > 0 && this.running.size < this.o.concurrency) {
      // Blocked by a pause, by the minute's budget or by a wait before a new try: wake up when the first ends
      const earliestJob = Math.min(...this.waiting.map(p => p.notBefore));
      const budget = this.started.length >= this.o.perMinute ? this.started[0] + 60_000 : 0;
      const wake = Math.max(this.pausedUntil, budget, earliestJob);
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, Math.max(1, wake - now));
    }
  }

  private async run(p: Pending): Promise<void> {
    const controller = new AbortController();
    p.controller = controller;
    p.attempts++;
    this.sent++;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.o.timeoutMs);
    try {
      const blob = await this.o.fetch(p.job.zpl, p.job.width, p.job.height, controller.signal, p.job);
      this.running.delete(p.job.key);
      this.settle(p, blob, null);
    } catch (e) {
      this.running.delete(p.job.key);
      if (controller.signal.aborted && !timedOut) {
        this.settle(p, null, new RenderError('Cancelled', 0, false, true));
      } else {
        const { status, retryAfterMs } = timedOut ? { status: 0, retryAfterMs: undefined } : statusOf(e);
        // 429, 5xx, no answer and timeouts are worth another try; a 4xx is the request itself being wrong
        const retriable = timedOut || status === 0 || status === 429 || status >= 500;
        if (retriable && p.attempts <= this.o.maxRetries && (retryAfterMs ?? 0) <= this.o.maxRetryAfterMs) {
          const wait = retryAfterMs ?? this.o.backoffBaseMs * 2 ** (p.attempts - 1);
          // A 429 stops everything: the other jobs would only be refused too
          if (status === 429) this.pausedUntil = Math.max(this.pausedUntil, this.o.now() + wait);
          p.notBefore = this.o.now() + wait;
          p.controller = null;
          this.waiting.push(p);
        } else {
          const message = timedOut ? 'Timeout' : e instanceof Error ? e.message : String(e);
          this.settle(p, null, new RenderError(message, timedOut ? 0 : status, retriable));
        }
      }
    } finally {
      clearTimeout(timeout);
      this.pump();
    }
  }
}
