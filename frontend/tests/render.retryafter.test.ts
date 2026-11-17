// What the browser does with an HTTP 503 (the server's queue is busy) or 429 that carries a Retry-After: from the
// header to the retry, compared between the two statuses.

/* eslint-disable @typescript-eslint/no-explicit-any */
// authClient reads Vite's import.meta, which jest cannot load: its few exports are stubbed
jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => 'token', triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => false) }));

import { HttpError, apiFetchBlob } from '../src/utils/apiClient';
import { RenderError, RenderQueue } from '../src/utils/renderQueue';

const png = () => new Blob([new Uint8Array(4)], { type: 'image/png' });
const httpError = (status: number, retryAfterMs?: number) => new HttpError(`HTTP ${status}`, status, retryAfterMs);
const job = (n: number) => ({ key: `k${n}`, zpl: `^XA${n}^XZ`, width: 800, height: 1200 });
const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('the header: from the response to the error', () => {
  const answer = (status: number, headers: Record<string, string> = {}) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Labelary API busy, please retry later' }), { status, headers: { 'Content-Type': 'application/json', ...headers } }));
  };
  afterEach(() => { (globalThis.fetch as any).mockRestore?.(); });
  const caught = async () => apiFetchBlob('/api/preview', { method: 'POST', body: '{}' }).catch(e => e);

  test('a 503 is recognised, and its Retry-After (seconds) is read as milliseconds', async () => {
    answer(503, { 'Retry-After': '7' });
    const e = await caught();
    expect(e).toBeInstanceOf(HttpError);
    expect(e).toBeInstanceOf(Error);                                                // callers that only know Error still work
    expect(e).toMatchObject({ status: 503, retryAfterMs: 7000 });
    expect(e.message).toMatch(/serviço de renderização|rendering service/i);       // the message is the translated one
  });

  test('a 429 is read the same way', async () => {
    answer(429, { 'Retry-After': '26' });
    expect(await caught()).toMatchObject({ status: 429, retryAfterMs: 26_000 });
  });

  test('no header, zero, a negative number, text or a date give no wait (the generic backoff then applies)', async () => {
    for (const value of [undefined, '0', '-3', 'soon', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      answer(503, value === undefined ? {} : { 'Retry-After': value });
      const e = await caught();
      expect([value, e.status, e.retryAfterMs]).toEqual([value, 503, undefined]);
      (globalThis.fetch as any).mockRestore();
    }
  });
});

describe('503 with a Retry-After', () => {
  test('a short one is waited out exactly: not the 2 seconds of the generic backoff, not earlier', async () => {
    const stamps: number[] = [];
    const fetch = jest.fn(async () => { stamps.push(Date.now()); if (stamps.length === 1) throw httpError(503, 1000); return png(); });
    const q = new RenderQueue({ fetch, backoffBaseMs: 2000 });
    const result = q.enqueue(job(1));
    await tick(900);
    expect(fetch).toHaveBeenCalledTimes(1);                                          // not before the interval the server asked for
    await tick(200);
    await expect(result).resolves.toBeInstanceOf(Blob);
    expect(stamps[1] - stamps[0]).toBe(1000);                                        // the server's 1 s, where the backoff would be 2 s
  });

  test('a longer one that is still reasonable is waited out in full, instead of 2, 4, 8 s', async () => {
    const stamps: number[] = [];
    const fetch = jest.fn(async () => { stamps.push(Date.now()); if (stamps.length < 3) throw httpError(503, 30_000); return png(); });
    const q = new RenderQueue({ fetch, backoffBaseMs: 2000 });
    const result = q.enqueue(job(1));
    await tick(29_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await tick(70_000);
    await expect(result).resolves.toBeInstanceOf(Blob);
    expect(stamps.slice(1).map((t, i) => t - stamps[i])).toEqual([30_000, 30_000]);
  });

  test('one that is too long (a quota, minutes away) is not waited for: the job ends at once as a failure that can be tried again', async () => {
    const fetch = jest.fn(async () => { throw httpError(503, 600_000); });
    const q = new RenderQueue({ fetch, maxRetryAfterMs: 120_000 });
    const error = await q.enqueue(job(1)).catch(e => e);
    expect(error).toBeInstanceOf(RenderError);
    expect(error).toMatchObject({ status: 503, retriable: true, cancelled: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    await tick(60 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(1);                                          // and nothing is quietly retried later
  });

  test('"Try again" starts a new request for the same label, and it works once the server is free', async () => {
    let busy = true;
    const fetch = jest.fn(async () => { if (busy) throw httpError(503, 600_000); return png(); });
    const q = new RenderQueue({ fetch });
    await expect(q.enqueue(job(1))).rejects.toMatchObject({ retriable: true });
    busy = false;
    await expect(q.enqueue(job(1))).resolves.toBeInstanceOf(Blob);                   // what the button does: the same job asked again
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('the original request is kept while it waits: a second ask for it shares the retry and nothing is lost', async () => {
    let calls = 0;
    const fetch = jest.fn(async () => { calls++; if (calls === 1) throw httpError(503, 2000); return png(); });
    const q = new RenderQueue({ fetch });
    const first = q.enqueue(job(1));
    await tick(10);
    const again = q.enqueue(job(1));                                                 // asked again during the wait
    await tick(3000);
    expect(await first).toBe(await again);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('503 without a Retry-After', () => {
  test('the generic backoff applies: 2, 4 and 8 seconds, then it gives up as a failure that can be tried again', async () => {
    const stamps: number[] = [];
    const fetch = jest.fn(async () => { stamps.push(Date.now()); throw httpError(503); });
    const q = new RenderQueue({ fetch, backoffBaseMs: 2000, maxRetries: 3 });
    const result = q.enqueue(job(1)).catch(e => e);
    await tick(60_000);
    expect(await result).toMatchObject({ status: 503, retriable: true });
    expect(stamps.slice(1).map((t, i) => t - stamps[i])).toEqual([2000, 4000, 8000]);
  });
});

describe('no loops', () => {
  test('a server that keeps saying 503 with a Retry-After gets a bounded number of requests, and then none at all', async () => {
    const fetch = jest.fn(async () => { throw httpError(503, 1000); });
    const q = new RenderQueue({ fetch, maxRetries: 3 });
    const result = q.enqueue(job(1)).catch(e => e);
    await tick(30_000);
    expect(await result).toMatchObject({ status: 503, retriable: true });
    expect(fetch).toHaveBeenCalledTimes(4);                                          // the first try and three more
    await tick(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(q.queued + q.active).toBe(0);
  });

  test('the same for 429: bounded, and nothing left behind', async () => {
    const fetch = jest.fn(async () => { throw httpError(429, 1000); });
    const q = new RenderQueue({ fetch, maxRetries: 3 });
    const result = q.enqueue(job(1)).catch(e => e);
    await tick(30_000);
    expect(await result).toMatchObject({ status: 429, retriable: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    await tick(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('503 compared with 429', () => {
  test('both honour the Retry-After and keep the request; the only difference: a 429 stops the whole queue, a 503 delays that request', async () => {
    for (const status of [429, 503]) {
      const stamps: Record<string, number[]> = { one: [], two: [] };
      const fetch = jest.fn(async (zpl: string) => {
        const id = zpl.includes('1') ? 'one' : 'two';
        stamps[id].push(Date.now());
        if (id === 'one' && stamps.one.length === 1) throw httpError(status, 5000);
        return png();
      });
      const q = new RenderQueue({ fetch, concurrency: 2 });
      const one = q.enqueue(job(1));
      await tick(1);
      const t0 = Date.now();
      const two = q.enqueue(job(2));                                                 // another label, asked right after
      await tick(10_000);
      await Promise.all([one, two]);
      expect(stamps.one[1] - stamps.one[0]).toBe(5000);                              // the same wait for both statuses
      if (status === 429) expect(stamps.two[0] - t0).toBeGreaterThanOrEqual(4000);   // the other label waits for the pause
      else expect(stamps.two[0] - t0).toBeLessThan(1000);                            // the other label goes on
    }
  });
});

describe('recovery after congestion', () => {
  test('several labels refused with 503 at once all come back once the server is free, in bounded requests', async () => {
    let congested = true;
    const fetch = jest.fn(async () => { if (congested) throw httpError(503, 2000); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 2, maxRetries: 3 });
    const all = Array.from({ length: 6 }, (_, i) => q.enqueue(job(i)));
    await tick(1500);
    congested = false;                                                               // the server frees up
    await tick(20_000);
    const blobs = await Promise.all(all);
    expect(blobs).toHaveLength(6);                                                   // none lost
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6 * 2);                       // the refused ones and one retry each
  });

  test('congestion that lasts longer than the retries ends as failures that can be tried again, and a new try then succeeds', async () => {
    let congested = true;
    const fetch = jest.fn(async () => { if (congested) throw httpError(503, 1000); return png(); });
    const q = new RenderQueue({ fetch, concurrency: 2, maxRetries: 2 });
    const results = Promise.all(Array.from({ length: 3 }, (_, i) => q.enqueue(job(i)).catch(e => e)));
    await tick(30_000);
    const failed = await results;
    expect(failed.every(e => e instanceof RenderError && e.retriable)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(9);                                          // 3 labels x (1 + 2 retries)
    congested = false;
    await Promise.all(Array.from({ length: 3 }, (_, i) => q.enqueue(job(i))));       // the "Try again" of each
    expect(fetch).toHaveBeenCalledTimes(12);
  });
});
