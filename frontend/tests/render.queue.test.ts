// The cache of rendered labels and the queue that every Labelary request goes through: limits, priority, retries.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RenderCache, renderKey } from '../src/utils/renderCache';
import { RenderError, RenderQueue } from '../src/utils/renderQueue';

const png = (n = 10) => new Blob([new Uint8Array(n)], { type: 'image/png' });
const httpError = (status: number, retryAfterMs?: number) => Object.assign(new Error(`HTTP ${status}`), { status, retryAfterMs });
const job = (n: number, extra: any = {}) => ({ key: `k${n}`, zpl: `^XA${n}^XZ`, width: 800, height: 1200, ...extra });
const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('the cache', () => {
  const make = () => {
    const revoked: string[] = [];
    let n = 0;
    return { revoked, cache: new RenderCache({ maxEntries: 3, maxBytes: 100, makeUrl: () => `blob:${++n}`, revokeUrl: u => revoked.push(u) }) };
  };

  test('is reached only by the ZPL, the size and the density that produced it', () => {
    const { cache } = make();
    cache.set(renderKey('^XA^FDa^FS^XZ', 800, 1200), png());
    expect(cache.get(renderKey('^XA^FDa^FS^XZ', 800, 1200))).toBeDefined();
    expect(cache.get(renderKey('^XA^FDb^FS^XZ', 800, 1200))).toBeUndefined();     // the ZPL changed
    expect(cache.get(renderKey('^XA^FDa^FS^XZ', 800, 1000))).toBeUndefined();     // the height changed
    expect(cache.get(renderKey('^XA^FDa^FS^XZ', 640, 1200))).toBeUndefined();     // the width changed
    expect(renderKey('z', 1, 2)).toContain('8|');                                    // the density is part of the key
  });

  test('keeps a bounded number of entries, the least recently used going first, and releases their URLs', () => {
    const { cache, revoked } = make();
    for (const k of ['a', 'b', 'c']) cache.set(k, png());
    cache.get('a');                                                                  // a is used again: b is now the oldest
    cache.set('d', png());
    expect(cache.has('b')).toBe(false);
    expect(['a', 'c', 'd'].every(k => cache.has(k))).toBe(true);
    expect(cache.size).toBe(3);
    expect(revoked).toHaveLength(1);
  });

  test('keeps a bounded number of bytes, and the entry just stored always stays', () => {
    const { cache } = make();
    cache.set('a', png(60));
    cache.set('b', png(60));                                                         // 120 > 100: a goes
    expect(cache.has('a')).toBe(false);
    expect(cache.bytes).toBe(60);
    cache.set('big', png(500));                                                      // alone over the limit: kept, the others go
    expect(cache.has('big')).toBe(true);
    expect(cache.size).toBe(1);
  });

  test('storing the same key again replaces it and clear() releases everything', () => {
    const { cache, revoked } = make();
    cache.set('a', png(10));
    cache.set('a', png(20));
    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(20);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(revoked).toHaveLength(2);
  });
});

describe('the queue', () => {
  test('renders a label with its own ZPL and size', async () => {
    const fetch = jest.fn(async () => png());
    const q = new RenderQueue({ fetch });
    await q.enqueue(job(1));
    expect(fetch).toHaveBeenCalledWith('^XA1^XZ', 800, 1200, expect.any(AbortSignal), expect.objectContaining({ key: 'k1' }));
    expect(q.sent).toBe(1);
  });

  test('several labels: each is rendered once and all come back', async () => {
    const fetch = jest.fn(async (zpl: string) => png(zpl.length));
    const q = new RenderQueue({ fetch });
    const blobs = await Promise.all([1, 2, 3, 4, 5].map(n => q.enqueue(job(n))));
    expect(blobs).toHaveLength(5);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  test('the same rendering asked twice is one request, for waiting and for running jobs', async () => {
    const fetch = jest.fn(async () => png());
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const [a, b, c] = await Promise.all([q.enqueue(job(1)), q.enqueue(job(1)), q.enqueue(job(2))]);
    expect(a).toBe(b);
    expect(c).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('never has more than the allowed number of requests at once', async () => {
    let active = 0;
    let most = 0;
    const fetch = jest.fn(async () => {
      active++; most = Math.max(most, active);
      await new Promise(r => setTimeout(r, 100));
      active--;
      return png();
    });
    const q = new RenderQueue({ fetch, concurrency: 2 });
    const all = Promise.all(Array.from({ length: 8 }, (_, i) => q.enqueue(job(i))));
    await tick(1000);
    await all;
    expect(most).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(8);
  });

  test('the selected label goes before the ones waiting, whatever the order they were asked in', async () => {
    const order: string[] = [];
    const fetch = jest.fn(async (zpl: string) => { order.push(zpl); await new Promise(r => setTimeout(r, 50)); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const all = [q.enqueue(job(1, { priority: 0 })), q.enqueue(job(2, { priority: 0 })), q.enqueue(job(3, { priority: 0 })), q.enqueue(job(4, { priority: 10 }))];
    await tick(500);
    await Promise.all(all);
    expect(order).toEqual(['^XA1^XZ', '^XA4^XZ', '^XA2^XZ', '^XA3^XZ']);           // 1 had already started; then the selected one
  });

  test('a waiting job can be raised to the front, and asking again with a higher priority does the same', async () => {
    const order: string[] = [];
    const fetch = jest.fn(async (zpl: string) => { order.push(zpl); await new Promise(r => setTimeout(r, 50)); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const all = [1, 2, 3, 4].map(n => q.enqueue(job(n)));
    q.prioritize('k3', 5);
    all.push(q.enqueue(job(4, { priority: 9 })));
    await tick(500);
    await Promise.all(all);
    expect(order).toEqual(['^XA1^XZ', '^XA4^XZ', '^XA3^XZ', '^XA2^XZ']);
  });

  test('stays under the requests-a-minute budget: the rest waits for the minute to pass', async () => {
    const fetch = jest.fn(async () => png());
    const q = new RenderQueue({ fetch, concurrency: 5, perMinute: 3 });
    const all = Promise.all(Array.from({ length: 7 }, (_, i) => q.enqueue(job(i))));
    await tick(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await tick(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);                                          // still inside the same minute
    await tick(31_000);
    expect(fetch).toHaveBeenCalledTimes(6);
    await tick(61_000);
    await all;
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  test('an interface that keeps selecting does not get past the limit in any minute', async () => {
    const stamps: number[] = [];
    const fetch = jest.fn(async () => { stamps.push(Date.now()); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 2, perMinute: 10 });
    const all = Promise.all(Array.from({ length: 35 }, (_, i) => q.enqueue(job(i))));
    await tick(5 * 60_000);
    await all;
    for (const t of stamps) expect(stamps.filter(s => s >= t && s < t + 60_000).length).toBeLessThanOrEqual(10);
    expect(stamps).toHaveLength(35);
  });

  test('HTTP 429: waits as long as the service asked, stops the others meanwhile, and then succeeds', async () => {
    let calls = 0;
    const fetch = jest.fn(async (zpl: string) => {
      calls++;
      if (zpl.includes('1') && calls === 1) throw httpError(429, 20_000);
      return png();
    });
    const q = new RenderQueue({ fetch, concurrency: 2, backoffBaseMs: 1000 });
    const first = q.enqueue(job(1));
    await tick(1);
    const second = q.enqueue(job(2));                                                // asked while the service is saying "wait"
    await tick(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);                                          // nobody is sent in the pause
    await tick(10_500);
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('HTTP 429 without a Retry-After uses a growing wait, and gives up after the retries', async () => {
    const stamps: number[] = [];
    const fetch = jest.fn(async () => { stamps.push(Date.now()); throw httpError(429); });
    const q = new RenderQueue({ fetch, maxRetries: 3, backoffBaseMs: 1000 });
    const result = q.enqueue(job(1)).catch(e => e);
    await tick(60_000);
    const error = await result;
    expect(error).toBeInstanceOf(RenderError);
    expect(error).toMatchObject({ status: 429, retriable: true, cancelled: false });
    expect(fetch).toHaveBeenCalledTimes(4);                                          // the first try and three more
    expect(stamps.slice(1).map((t, i) => t - stamps[i])).toEqual([1000, 2000, 4000]);
  });

  test('a server error, or no answer, is tried again with growing waits; a later success wins', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(httpError(502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(png());
    const q = new RenderQueue({ fetch, backoffBaseMs: 500 });
    const result = q.enqueue(job(1));
    await tick(5000);
    await expect(result).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test('the job travels with the request, so a mass export can say so to the server', async () => {
    const fetch = jest.fn(async (..._args: any[]) => png());
    const q = new RenderQueue({ fetch });
    await q.enqueue(job(1, { bulk: true }));
    await q.enqueue(job(2));
    expect(fetch.mock.calls[0][4]).toMatchObject({ bulk: true });
    expect(fetch.mock.calls[1][4].bulk).toBeUndefined();
  });

  test('a Retry-After longer than anyone should wait (a daily quota) is not waited for: the job fails at once, to be retried by hand', async () => {
    const fetch = jest.fn(async () => { throw httpError(429, 3 * 3600_000); });
    const q = new RenderQueue({ fetch, maxRetryAfterMs: 120_000 });
    const error = await q.enqueue(job(1)).catch(e => e);
    expect(error).toMatchObject({ status: 429, retriable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a request that is wrong (400) is not tried again', async () => {
    const fetch = jest.fn(async () => { throw httpError(400); });
    const q = new RenderQueue({ fetch });
    const error = await q.enqueue(job(1)).catch(e => e);
    expect(error).toMatchObject({ status: 400, retriable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a request that never answers is cut at the timeout and then tried again', async () => {
    const fetch = jest.fn((_z: string, _w: number, _h: number, signal: AbortSignal) =>
      new Promise<Blob>((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
    const q = new RenderQueue({ fetch, timeoutMs: 1000, maxRetries: 1, backoffBaseMs: 100 });
    const result = q.enqueue(job(1)).catch(e => e);
    await tick(10_000);
    const error = await result;
    expect(error).toMatchObject({ message: 'Timeout', retriable: true, cancelled: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('a failure of one label does not hold the others: they are rendered and the failed one reports', async () => {
    const fetch = jest.fn(async (zpl: string) => { if (zpl.includes('2')) throw httpError(400); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const results = await Promise.allSettled([1, 2, 3].map(n => q.enqueue(job(n))));
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  test('cancelling a group drops what is waiting and aborts what is running, and leaves other groups alone', async () => {
    const fetch = jest.fn((_z: string, _w: number, _h: number, signal: AbortSignal) =>
      new Promise<Blob>((res, rej) => { const t = setTimeout(() => res(png()), 1000); signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); }));
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const old = [1, 2, 3].map(n => q.enqueue(job(n, { group: 'old' })).catch(e => e));
    const keep = q.enqueue(job(9, { group: 'new' }));
    await tick(1);
    q.cancelGroup('old');
    const errors = await Promise.all(old);
    expect(errors.every(e => e instanceof RenderError && e.cancelled)).toBe(true);
    await tick(5000);
    await expect(keep).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledTimes(2);                                          // the first of the old group was running; the others never started
  });
});

describe('what the server says is final (the quota, a label the service refused)', () => {
  const coded = (status: number, code: string, retryAfterMs?: number) => Object.assign(new Error(code), { status, code, retryAfterMs });

  test('a label the service refused (422) is not asked again: one request, not four', async () => {
    const fetch = jest.fn(async () => { throw coded(422, 'zpl-rejected'); });
    const q = new RenderQueue({ fetch, backoffBaseMs: 10 });
    const error = await q.enqueue(job(1)).catch(e => e);
    await tick(10_000);
    expect(error).toMatchObject({ status: 422, code: 'zpl-rejected', retriable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('the quota being used up is not asked again either, even with a short wait: the server is not pressed', async () => {
    for (const code of ['quota-internal', 'quota-external', 'quota-unavailable']) {
      const fetch = jest.fn(async () => { throw coded(code === 'quota-unavailable' ? 503 : 429, code, 5000); });
      const q = new RenderQueue({ fetch, backoffBaseMs: 10 });
      const error = await q.enqueue(job(1)).catch(e => e);
      await tick(20_000);
      expect(error).toMatchObject({ code, retriable: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  test('the labels still waiting are refused at once with the same reason, and are never sent', async () => {
    const fetch = jest.fn(async () => { throw coded(429, 'quota-internal'); });
    const q = new RenderQueue({ fetch, concurrency: 1 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(n => q.enqueue(job(n)).catch(e => e)));
    expect(results.every(e => e instanceof RenderError && e.code === 'quota-internal')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);                                          // only the first reached the server
  });

  test('what is only the pace or a problem of the service is still tried again (the codes do not make it final)', async () => {
    for (const [status, code] of [[429, 'rate-limited'], [502, 'upstream'], [502, 'network'], [504, 'timeout'], [503, 'busy']] as const) {
      let n = 0;
      const fetch = jest.fn(async () => { if (++n === 1) throw coded(status, code, 1000); return png(); });
      const q = new RenderQueue({ fetch, backoffBaseMs: 10 });
      const result = q.enqueue(job(1));
      await tick(10_000);
      await expect(result).resolves.toBeInstanceOf(Blob);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });

  test('the job carries the room the server kept for its export, for the request to say so', async () => {
    const fetch = jest.fn(async (_z: string, _w: number, _h: number, _s: AbortSignal, j: any) => { expect(j.hold).toBe('h-1'); return png(); });
    const q = new RenderQueue({ fetch });
    await q.enqueue(job(1, { hold: 'h-1', bulk: true }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
