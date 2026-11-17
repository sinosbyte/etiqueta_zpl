/**
 * The gate every request to the Labelary service goes through, for every user of the server.
 *
 * Labelary is a public service with limits per second and per day, and all the users of this server reach it from
 * one address. A browser can only limit itself, so this is where the limit is kept:
 *  - a request is STARTED at most `ratePerSecond` times a second (evenly spaced, so no bursts), with at most
 *    `concurrency` in flight;
 *  - waiting requests are served by class: single previews ('interactive') before mass exports ('bulk'), except that
 *    one bulk request is served after every `bulkEvery` interactive ones, so a stream of previews cannot starve an export;
 *  - inside a class the users are served in turn (round robin), and each user's own requests in the order they came, so
 *    one user's 500-label export takes one place in the turn, not the whole queue;
 *  - when the service answers 429 the whole gate pauses for its Retry-After, the request that got it keeps its place
 *    and is tried again after the pause (once, within the time it is willing to wait), instead of every client retrying
 *    by itself; a pause longer than anyone waits makes new requests fail at once with that Retry-After;
 *  - a waiting request leaves the queue if its client goes away or if it waited longer than `maxWaitMs`; none is
 *    dropped otherwise, and a request that throws only frees its place.
 * It lives in this process's memory: enough for one server, and it must be revisited if more than one is run.
 */

export type Priority = 'interactive' | 'bulk';

/** What the work done for a request reports back. */
export type Outcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'rate-limited'; retryAfterMs: number }   // the service said 429
  | { kind: 'failed'; value: T };                      // anything else that went wrong (the caller maps it)

export type GateResult<T> =
  | Outcome<T>
  | { kind: 'busy'; reason: 'user-limit' | 'queue-full' | 'wait-timeout' | 'paused'; retryAfterMs: number }
  | { kind: 'cancelled' };

export interface GateOptions {
  ratePerSecond?: number;
  concurrency?: number;
  maxWaitMs?: number;            // longest a request waits to be started
  maxQueuedPerUser?: number;
  maxQueued?: number;
  maxAttempts?: number;          // tries of one request when the service keeps saying 429
  bulkEvery?: number;
  now?: () => number;
}

export interface RunOptions {
  user: string;
  priority?: Priority;
  signal?: AbortSignal;          // the client went away
}

interface Task<T> {
  work: (signal: AbortSignal) => Promise<Outcome<T>>;
  user: string;
  priority: Priority;
  deadline: number;
  attempts: number;
  resolve: (r: GateResult<T>) => void;
  controller: AbortController;
  detach: () => void;
}

export class LabelaryGate {
  private classes: Record<Priority, { order: string[]; queues: Map<string, Task<any>[]> }> = {
    interactive: { order: [], queues: new Map() },
    bulk: { order: [], queues: new Map() },
  };
  private running = new Set<Task<any>>();
  private nextStart = 0;
  private pausedUntil = 0;
  private interactiveRun = 0;       // interactive requests started in a row while a bulk one waited
  private timer: ReturnType<typeof setTimeout> | null = null;
  private o: Required<GateOptions>;
  /** Requests sent to the service (every attempt), for the tests. */
  started = 0;

  constructor(o: GateOptions = {}) {
    this.o = {
      ratePerSecond: o.ratePerSecond ?? 2,
      concurrency: o.concurrency ?? 2,
      maxWaitMs: o.maxWaitMs ?? 30_000,
      maxQueuedPerUser: o.maxQueuedPerUser ?? 100,
      maxQueued: o.maxQueued ?? 1000,
      maxAttempts: o.maxAttempts ?? 2,
      bulkEvery: o.bulkEvery ?? 4,
      now: o.now ?? (() => Date.now()),
    };
  }

  get waiting(): number {
    let n = 0;
    for (const c of Object.values(this.classes)) for (const q of c.queues.values()) n += q.length;
    return n;
  }
  get inFlight(): number { return this.running.size; }
  waitingFor(user: string): number {
    return (this.classes.interactive.queues.get(user)?.length ?? 0) + (this.classes.bulk.queues.get(user)?.length ?? 0);
  }

  /** For the tests: forget a pause and the pacing, as if the gate had just started. */
  resetForTests(): void {
    this.pausedUntil = 0;
    this.nextStart = 0;
    this.interactiveRun = 0;
    this.started = 0;
  }

  private get spacing(): number { return 1000 / this.o.ratePerSecond; }

  /** Runs `work` when the gate lets it. Never rejects because of the gate; it rejects only if `work` throws. */
  run<T>(work: (signal: AbortSignal) => Promise<Outcome<T>>, opts: RunOptions): Promise<GateResult<T>> {
    const now = this.o.now();
    const priority = opts.priority ?? 'interactive';
    if (opts.signal?.aborted) return Promise.resolve({ kind: 'cancelled' });

    const paused = this.pausedUntil - now;
    if (paused > this.o.maxWaitMs) return Promise.resolve({ kind: 'busy', reason: 'paused', retryAfterMs: paused });
    if (this.waiting >= this.o.maxQueued) return Promise.resolve({ kind: 'busy', reason: 'queue-full', retryAfterMs: this.estimateWait() });
    if (this.waitingFor(opts.user) >= this.o.maxQueuedPerUser) {
      return Promise.resolve({ kind: 'busy', reason: 'user-limit', retryAfterMs: this.estimateWait() });
    }

    return new Promise<GateResult<T>>(resolve => {
      const controller = new AbortController();
      const onAbort = () => this.cancel(task);
      const task: Task<T> = {
        work, user: opts.user, priority, deadline: now + this.o.maxWaitMs, attempts: 0, resolve, controller,
        detach: () => opts.signal?.removeEventListener('abort', onAbort),
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      this.enqueue(task, false);
      this.pump();
    });
  }

  /** How long the queue as it is would take to get to a new request, for telling a client when to come back. */
  private estimateWait(): number {
    return Math.max(1000, Math.ceil((this.waiting / this.o.ratePerSecond) * 1000), this.pausedUntil - this.o.now());
  }

  private enqueue(task: Task<any>, front: boolean): void {
    const c = this.classes[task.priority];
    let q = c.queues.get(task.user);
    if (!q) { q = []; c.queues.set(task.user, q); c.order.push(task.user); }
    if (front) q.unshift(task); else q.push(task);
  }

  private cancel(task: Task<any>): void {
    const c = this.classes[task.priority];
    const q = c.queues.get(task.user);
    const at = q ? q.indexOf(task) : -1;
    if (q && at >= 0) {
      q.splice(at, 1);
      this.tidy(task.priority, task.user);
      task.detach();
      task.resolve({ kind: 'cancelled' });
      this.pump();
    } else if (this.running.has(task)) {
      task.controller.abort();            // the work notices the signal and reports; the slot is freed when it does
    }
  }

  private tidy(priority: Priority, user: string): void {
    const c = this.classes[priority];
    if ((c.queues.get(user)?.length ?? 0) === 0) {
      c.queues.delete(user);
      c.order = c.order.filter(u => u !== user);
    }
  }

  /** The next request to start: the class by priority (with the share for bulk), then the next user in turn. */
  private take(): Task<any> | null {
    const interactive = this.classes.interactive.order.length > 0;
    const bulk = this.classes.bulk.order.length > 0;
    if (!interactive && !bulk) return null;
    let from: Priority = interactive ? 'interactive' : 'bulk';
    if (interactive && bulk && this.interactiveRun >= this.o.bulkEvery) from = 'bulk';
    this.interactiveRun = from === 'interactive' && bulk ? this.interactiveRun + 1 : 0;

    const c = this.classes[from];
    const user = c.order[0];
    const q = c.queues.get(user)!;
    const task = q.shift()!;
    // The user goes to the back of the turn (and is dropped when they have nothing more waiting)
    c.order.shift();
    if (q.length > 0) c.order.push(user); else c.queues.delete(user);
    return task;
  }

  /** Starts what the limits allow, drops what waited too long, and sets a timer for the next moment something can happen. */
  private pump(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const now = this.o.now();
    this.expire(now);

    while (this.running.size < this.o.concurrency && now >= this.pausedUntil && now >= this.nextStart) {
      const task = this.take();
      if (!task) break;
      this.nextStart = now + this.spacing;
      this.start(task);
    }

    if (this.waiting > 0) {
      let wake = this.running.size < this.o.concurrency ? Math.max(this.pausedUntil, this.nextStart) : Infinity;
      for (const c of Object.values(this.classes)) for (const q of c.queues.values()) for (const t of q) wake = Math.min(wake, t.deadline);
      if (wake !== Infinity) this.timer = setTimeout(() => { this.timer = null; this.pump(); }, Math.max(1, wake - now));
    }
  }

  private expire(now: number): void {
    for (const priority of ['interactive', 'bulk'] as Priority[]) {
      const c = this.classes[priority];
      for (const [user, q] of [...c.queues]) {
        const late = q.filter(t => t.deadline <= now);
        if (late.length === 0) continue;
        c.queues.set(user, q.filter(t => t.deadline > now));
        this.tidy(priority, user);
        for (const t of late) {
          t.detach();
          t.resolve({ kind: 'busy', reason: 'wait-timeout', retryAfterMs: this.estimateWait() });
        }
      }
    }
  }

  private start(task: Task<any>): void {
    this.running.add(task);
    this.started++;
    task.attempts++;
    task.work(task.controller.signal).then(
      outcome => this.finish(task, outcome),
      error => { this.running.delete(task); task.detach(); task.resolve({ kind: 'failed', value: error }); this.pump(); },
    );
  }

  private finish(task: Task<any>, outcome: Outcome<any>): void {
    this.running.delete(task);
    const now = this.o.now();
    if (task.controller.signal.aborted) {
      task.detach();
      task.resolve({ kind: 'cancelled' });
    } else if (outcome.kind === 'rate-limited') {
      // Everyone stops for as long as the service asked. This request keeps its place and tries again after the pause
      // if it is willing to wait that long and has tries left; otherwise it tells its client how long to wait.
      this.pausedUntil = Math.max(this.pausedUntil, now + outcome.retryAfterMs);
      if (task.attempts < this.o.maxAttempts && this.pausedUntil <= task.deadline) {
        this.enqueue(task, true);
      } else {
        task.detach();
        task.resolve({ kind: 'rate-limited', retryAfterMs: Math.max(outcome.retryAfterMs, this.pausedUntil - now) });
      }
    } else {
      task.detach();
      task.resolve(outcome);
    }
    this.pump();
  }
}
