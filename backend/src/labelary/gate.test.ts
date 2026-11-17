import { LabelaryGate, Outcome } from './gate';

// The global gate in front of Labelary, with a controlled clock: pacing, concurrency, priority, fairness between users,
// the pause on 429, waiting limits, cancellation and recovery.

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const ok = (): Outcome<string> => ({ kind: 'ok', value: 'png' });

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

/** Work that records when (and for whom) it started, and takes `ms` to finish. */
function recorder(ms = 0) {
  const log: { id: string; at: number }[] = [];
  let active = 0;
  let most = 0;
  const work = (id: string, outcome: () => Outcome<string> = ok) => async (signal: AbortSignal) => {
    log.push({ id, at: Date.now() });
    active++; most = Math.max(most, active);
    await new Promise<void>(res => {
      const t = setTimeout(res, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); res(); });
    });
    active--;
    return outcome();
  };
  return { log, work, most: () => most };
}

describe('pacing and concurrency', () => {
  test('requests are started evenly, never in a burst: 2 a second means one every 500 ms', async () => {
    const g = new LabelaryGate({ ratePerSecond: 2, concurrency: 5 });
    const r = recorder();
    const all = Array.from({ length: 6 }, (_, i) => g.run(r.work(`r${i}`), { user: 'a' }));
    await tick(10_000);
    await Promise.all(all);
    const gaps = r.log.slice(1).map((e, i) => e.at - r.log[i].at);
    expect(gaps.every(gap => gap >= 500)).toBe(true);
    expect(r.log).toHaveLength(6);
  });

  test('never more requests in flight than the concurrency', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 2 });
    const r = recorder(2000);
    const all = Array.from({ length: 8 }, (_, i) => g.run(r.work(`r${i}`), { user: `u${i}` }));
    await tick(30_000);
    await Promise.all(all);
    expect(r.most()).toBe(2);
    expect(g.started).toBe(8);
  });

  test('many users together still stay under the limit in any second', async () => {
    const g = new LabelaryGate({ ratePerSecond: 2, concurrency: 3 });
    const r = recorder(300);
    const all: Promise<unknown>[] = [];
    for (const user of ['a', 'b', 'c', 'd', 'e']) for (let i = 0; i < 4; i++) all.push(g.run(r.work(`${user}${i}`), { user }));
    await tick(30_000);
    await Promise.all(all);
    expect(r.log).toHaveLength(20);
    for (const e of r.log) expect(r.log.filter(o => o.at >= e.at && o.at < e.at + 1000).length).toBeLessThanOrEqual(2);
  });
});

describe('fairness between users', () => {
  test('two users asking at once are served in turn, not one after the other', async () => {
    const g = new LabelaryGate({ ratePerSecond: 10, concurrency: 1 });
    const r = recorder(10);
    const all = [
      ...Array.from({ length: 6 }, (_, i) => g.run(r.work(`a${i}`), { user: 'a' })),
      ...Array.from({ length: 3 }, (_, i) => g.run(r.work(`b${i}`), { user: 'b' })),
    ];
    await tick(10_000);
    await Promise.all(all);
    // a0 started at once and a1 was next in line before b had asked; from then on a and b alternate until b is done
    expect(r.log.map(e => e.id)).toEqual(['a0', 'a1', 'b0', 'a2', 'b1', 'a3', 'b2', 'a4', 'a5']);
  });

  test('a user\'s own requests are served in the order they were made', async () => {
    const g = new LabelaryGate({ ratePerSecond: 10, concurrency: 2 });
    const r = recorder(5);
    const all = Array.from({ length: 12 }, (_, i) => g.run(r.work(`a${i}`), { user: 'a' }));
    all.push(g.run(r.work('b0'), { user: 'b' }));
    await tick(10_000);
    await Promise.all(all);
    const mine = r.log.map(e => e.id).filter(id => id.startsWith('a'));
    expect(mine).toEqual(Array.from({ length: 12 }, (_, i) => `a${i}`));
  });

  test('a big export does not monopolize: another user\'s small export finishes long before it', async () => {
    const g = new LabelaryGate({ ratePerSecond: 10, concurrency: 1 });
    const r = recorder(5);
    const big = Array.from({ length: 60 }, (_, i) => g.run(r.work(`big${i}`), { user: 'big', priority: 'bulk' }));
    const small = Array.from({ length: 3 }, (_, i) => g.run(r.work(`small${i}`), { user: 'small', priority: 'bulk' }));
    await tick(30_000);
    await Promise.all([...big, ...small]);
    const ids = r.log.map(e => e.id);
    expect(Math.max(...[0, 1, 2].map(i => ids.indexOf(`small${i}`)))).toBeLessThan(8);   // not at the end of 63
    expect(ids).toHaveLength(63);
  });
});

describe('priority of previews over exports', () => {
  test('a preview that arrives while an export is waiting is served before the rest of the export', async () => {
    const g = new LabelaryGate({ ratePerSecond: 2, concurrency: 1 });
    const r = recorder(10);
    const bulk = Array.from({ length: 10 }, (_, i) => g.run(r.work(`bulk${i}`), { user: 'exporter', priority: 'bulk' }));
    await tick(1200);                                                             // the export is under way
    const preview = g.run(r.work('preview'), { user: 'someone' });
    await tick(60_000);
    await Promise.all([...bulk, preview]);
    const ids = r.log.map(e => e.id);
    const started = ids.indexOf('preview');
    expect(started).toBeLessThanOrEqual(4);                                       // right after the ones already started
    expect(ids.slice(started + 1).every(id => id.startsWith('bulk'))).toBe(true);
  });

  test('previews do not starve an export: one bulk request is served after every few previews', async () => {
    const g = new LabelaryGate({ ratePerSecond: 10, concurrency: 1, bulkEvery: 3 });
    const r = recorder(5);
    const all = [
      g.run(r.work('bulk'), { user: 'x', priority: 'bulk' }),
      ...Array.from({ length: 12 }, (_, i) => g.run(r.work(`p${i}`), { user: `u${i % 4}` })),
    ];
    await tick(30_000);
    await Promise.all(all);
    const ids = r.log.map(e => e.id);
    expect(ids.indexOf('bulk')).toBeLessThan(6);                                  // served, long before the 12 previews end
  });

  test('a mass export that is alone gets the whole gate', async () => {
    const g = new LabelaryGate({ ratePerSecond: 10, concurrency: 2 });
    const r = recorder(5);
    const all = Array.from({ length: 10 }, (_, i) => g.run(r.work(`b${i}`), { user: 'a', priority: 'bulk' }));
    await tick(10_000);
    expect((await Promise.all(all)).every(x => x.kind === 'ok')).toBe(true);
  });
});

describe('HTTP 429 from the service', () => {
  test('the whole gate pauses for the Retry-After, the request keeps its place and is tried again after it', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 2, maxWaitMs: 60_000 });
    const r = recorder();
    let first = true;
    const limited = g.run(r.work('limited', () => (first ? (first = false, { kind: 'rate-limited', retryAfterMs: 5000 }) : ok())), { user: 'a' });
    await tick(1);
    const other = g.run(r.work('other'), { user: 'b' });                          // another user asks during the pause
    await tick(4000);
    expect(r.log.map(e => e.id)).toEqual(['limited']);                            // nobody is sent in the pause
    await tick(2000);
    expect(await limited).toEqual(ok());
    expect(await other).toEqual(ok());
    expect(r.log.map(e => e.id)).toEqual(['limited', 'limited', 'other']);        // its own place was kept: before the other user's
    expect(r.log[1].at - r.log[0].at).toBeGreaterThanOrEqual(5000);
  });

  test('it is tried again once: a service that keeps saying 429 gives the client the 429 with the wait', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 1, maxWaitMs: 60_000, maxAttempts: 2 });
    const r = recorder();
    const result = g.run(r.work('x', () => ({ kind: 'rate-limited', retryAfterMs: 3000 })), { user: 'a' });
    await tick(20_000);
    expect(await result).toMatchObject({ kind: 'rate-limited' });
    expect(r.log).toHaveLength(2);                                                // the first try and one more, not a loop
  });

  test('a Retry-After longer than the request will wait (the daily quota) is passed on at once, and the gate stays closed', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 1, maxWaitMs: 30_000 });
    const r = recorder();
    const pending = g.run(r.work('x', () => ({ kind: 'rate-limited', retryAfterMs: 3_600_000 })), { user: 'a' });
    await tick(10);
    const result = await pending;
    expect(result).toEqual({ kind: 'rate-limited', retryAfterMs: 3_600_000 });
    expect(r.log).toHaveLength(1);
    // the next ones are not queued for an hour: they are told straight away, without a request to the service
    const next = await g.run(r.work('y'), { user: 'b' });     // answered at once: it is never queued
    expect(next).toMatchObject({ kind: 'busy', reason: 'paused' });
    expect((next as any).retryAfterMs).toBeGreaterThan(3_500_000);
    expect(r.log).toHaveLength(1);
  });

  test('after the pause everything flows again, in the usual order', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 1, maxWaitMs: 60_000 });
    const r = recorder();
    let first = true;
    const all = [
      g.run(r.work('a0', () => (first ? (first = false, { kind: 'rate-limited', retryAfterMs: 2000 }) : ok())), { user: 'a' }),
      g.run(r.work('a1'), { user: 'a' }),
      g.run(r.work('b0'), { user: 'b' }),
    ];
    await tick(20_000);
    expect((await Promise.all(all)).map(x => x.kind)).toEqual(['ok', 'ok', 'ok']);
    expect(r.log.map(e => e.id)).toEqual(['a0', 'a0', 'b0', 'a1']);
  });
});

describe('waiting, cancelling and failing', () => {
  test('a request that waited longer than the limit is turned away as busy and never started', async () => {
    const g = new LabelaryGate({ ratePerSecond: 1, concurrency: 1, maxWaitMs: 2500 });
    const r = recorder(10_000);
    const first = g.run(r.work('long'), { user: 'a' });                           // holds the only slot
    const late = g.run(r.work('late'), { user: 'b' });
    await tick(3000);
    expect(await late).toMatchObject({ kind: 'busy', reason: 'wait-timeout' });
    expect(g.waiting).toBe(0);
    await tick(20_000);
    await first;
    expect(r.log.map(e => e.id)).toEqual(['long']);
  });

  test('a waiting request whose client went away is dropped without ever being sent', async () => {
    const g = new LabelaryGate({ ratePerSecond: 1, concurrency: 1 });
    const r = recorder(1000);
    const hold = g.run(r.work('hold'), { user: 'a' });
    const controller = new AbortController();
    const gone = g.run(r.work('gone'), { user: 'b', signal: controller.signal });
    const stays = g.run(r.work('stays'), { user: 'c' });
    await tick(10);
    controller.abort();
    expect(await gone).toEqual({ kind: 'cancelled' });
    await tick(20_000);
    await Promise.all([hold, stays]);
    expect(r.log.map(e => e.id)).toEqual(['hold', 'stays']);
  });

  test('a running request whose client went away is aborted and its place is freed for the next', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 1 });
    const r = recorder(60_000);
    const controller = new AbortController();
    const running = g.run(r.work('running'), { user: 'a', signal: controller.signal });
    const next = g.run(async () => { r.log.push({ id: 'next', at: Date.now() }); return ok(); }, { user: 'b' });
    await tick(100);
    controller.abort();
    expect(await running).toEqual({ kind: 'cancelled' });
    expect(await next).toEqual(ok());
  });

  test('a client already gone is not even queued', async () => {
    const g = new LabelaryGate();
    const controller = new AbortController();
    controller.abort();
    expect(await g.run(async () => ok(), { user: 'a', signal: controller.signal })).toEqual({ kind: 'cancelled' });
    expect(g.waiting).toBe(0);
  });

  test('a request whose work throws only frees its place: the others carry on, and none is lost', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100, concurrency: 1 });
    const all = [
      g.run(async () => { throw new Error('boom'); }, { user: 'a' }),
      g.run(async () => ok(), { user: 'a' }),
      g.run(async () => ok(), { user: 'b' }),
    ];
    await tick(1000);
    const results = await Promise.all(all);
    expect(results[0]).toMatchObject({ kind: 'failed' });
    expect(results.slice(1)).toEqual([ok(), ok()]);
    expect(g.inFlight).toBe(0);
    expect(g.waiting).toBe(0);
  });

  test('a failure the work reports (not a 429) is handed back as it is, once, with no retry', async () => {
    const g = new LabelaryGate({ ratePerSecond: 100 });
    const r = recorder();
    const result = await (async () => { const p = g.run(r.work('x', () => ({ kind: 'failed', value: 'upstream' })), { user: 'a' }); await tick(10); return p; })();
    expect(result).toEqual({ kind: 'failed', value: 'upstream' });
    expect(r.log).toHaveLength(1);
  });

  test('no request is lost: every one of a mixed crowd is answered exactly once and started exactly once', async () => {
    const g = new LabelaryGate({ ratePerSecond: 20, concurrency: 3, maxWaitMs: 120_000 });
    const r = recorder(100);
    const answers = new Map<string, number>();
    const all: Promise<unknown>[] = [];
    for (let u = 0; u < 6; u++) {
      for (let i = 0; i < 9; i++) {
        const id = `u${u}-${i}`;
        all.push(g.run(r.work(id), { user: `u${u}`, priority: i % 3 === 0 ? 'bulk' : 'interactive' }).then(x => answers.set(id, (answers.get(id) ?? 0) + (x.kind === 'ok' ? 1 : 100))));
      }
    }
    await tick(120_000);
    await Promise.all(all);
    expect(answers.size).toBe(54);
    expect([...answers.values()].every(n => n === 1)).toBe(true);
    expect(g.started).toBe(54);
    expect(new Set(r.log.map(e => e.id)).size).toBe(54);
  });
});

describe('limits on the queue itself', () => {
  test('one user cannot fill the queue: past their own limit they are told to slow down, others still get in', async () => {
    const g = new LabelaryGate({ ratePerSecond: 1, concurrency: 1, maxQueuedPerUser: 3 });
    const r = recorder(60_000);
    const mine = Array.from({ length: 4 }, (_, i) => g.run(r.work(`a${i}`), { user: 'a' }));   // a0 starts, a1..a3 wait
    await tick(1);
    const over = await g.run(r.work('a-over'), { user: 'a' });
    expect(over).toMatchObject({ kind: 'busy', reason: 'user-limit' });
    expect((over as any).retryAfterMs).toBeGreaterThanOrEqual(1000);
    const other = g.run(r.work('b0'), { user: 'b' });
    expect(g.waitingFor('b')).toBe(1);
    expect(g.waitingFor('a')).toBe(3);
    void mine; void other;
  });

  test('a full queue turns new requests away with a wait to come back after', async () => {
    const g = new LabelaryGate({ ratePerSecond: 1, concurrency: 1, maxQueued: 2 });
    const r = recorder(60_000);
    g.run(r.work('0'), { user: 'a' });
    g.run(r.work('1'), { user: 'b' });
    g.run(r.work('2'), { user: 'c' });
    await tick(1);
    expect(await g.run(r.work('3'), { user: 'd' })).toMatchObject({ kind: 'busy', reason: 'queue-full' });
  });
});
