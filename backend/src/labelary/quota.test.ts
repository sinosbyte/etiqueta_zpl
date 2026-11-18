process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from '../db/database';
import { LabelaryQuota, QuotaOptions } from './quota';

/**
 * The quota against a real PostgreSQL: the rule is "never more than `limit` requests in any 24 hours", and what makes
 * it true is a count under a lock inside the database, so these tests are about that: many at once, more than one
 * server, a restart, the edges of the window, a block, a hold for an export, and a database that does not answer.
 */

const LIMIT = 10;
const opts = (extra: Partial<QuotaOptions> = {}): QuotaOptions => ({ limit: LIMIT, lowThreshold: 2, holdTtlMs: 60_000, ...extra });
const quota = (extra: Partial<QuotaOptions> = {}) => new LabelaryQuota(opts(extra));

const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const count = async (): Promise<number> => Number(((await run(sql`SELECT count(*) AS n FROM labelary_requests`)).rows[0] as any).n);
const heldSlots = async (): Promise<number> => Number(((await run(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`)).rows[0] as any).n);

/** `n` rows sent `ago` ago (Postgres interval text, e.g. '23 hours 59 minutes'). */
const seed = (n: number, ago: string, user = 1) =>
  run(sql`INSERT INTO labelary_requests (sent_at, user_id) SELECT clock_timestamp() - ${ago}::interval, ${user} FROM generate_series(1, ${n})`);

const near = (d: Date | null, msFromNow: number, tolerance = 5_000) => {
  expect(d).not.toBeNull();
  expect(Math.abs(d!.getTime() - (Date.now() + msFromNow))).toBeLessThan(tolerance);
};
const HOUR = 3_600_000;

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  await run(sql`DELETE FROM labelary_requests`);
  await run(sql`DELETE FROM labelary_holds`);
  await run(sql`DELETE FROM labelary_block`);
});
afterAll(async () => { await _resetDb(); });

describe('the limit', () => {
  test('lets exactly the limit through, then refuses without writing anything', async () => {
    const q = quota();
    const results = [];
    for (let i = 0; i < LIMIT + 3; i++) results.push(await q.reserve(1));
    expect(results.filter(r => r.ok)).toHaveLength(LIMIT);
    const denied = results[LIMIT];
    expect(denied).toMatchObject({ ok: false, reason: 'quota-internal', remaining: 0 });
    expect(await count()).toBe(LIMIT);                               // a refused request is not counted
  });

  test('a refused request says when there will be room again: when the oldest request leaves the window', async () => {
    await seed(1, '23 hours');
    await seed(LIMIT - 1, '1 hour');
    const denied = await quota().reserve(1);
    expect(denied).toMatchObject({ ok: false, reason: 'quota-internal' });
    near((denied as any).retryAt, 1 * HOUR);                         // 23 h old + 24 h = in one hour
  });

  test('the count is by user-less rows too: a deleted user does not give room back', async () => {
    await seed(LIMIT, '1 hour', 999_999);                            // no such user
    expect(await quota().reserve(1)).toMatchObject({ ok: false });
  });
});

describe('concurrency: nothing passes the limit and nothing is lost', () => {
  test('50 at once, limit 10: exactly 10 are let through', async () => {
    const q = quota();
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => q.reserve(i)));
    expect(results.filter(r => r.ok)).toHaveLength(LIMIT);
    expect(results.filter(r => !r.ok)).toHaveLength(40);
    expect(await count()).toBe(LIMIT);
  });

  test('200 at once from two separate servers sharing the database: still exactly 10', async () => {
    const a = quota();
    const b = quota();
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).reserve(i)));
    expect(results.filter(r => r.ok)).toHaveLength(LIMIT);
    expect(await count()).toBe(LIMIT);
  });

  test('waves of requests while the room is used up: the count never goes over', async () => {
    const q = quota();
    let granted = 0;
    for (let wave = 0; wave < 6; wave++) {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => q.reserve(wave * 100 + i)));
      granted += results.filter(r => r.ok).length;
      expect(await count()).toBeLessThanOrEqual(LIMIT);
    }
    expect(granted).toBe(LIMIT);
  });
});

describe('the window of 24 hours', () => {
  test('requests older than 24 hours do not count; those a little younger do', async () => {
    await seed(LIMIT, '24 hours 2 seconds');
    expect(await quota().reserve(1)).toEqual({ ok: true });         // all of them have left the window
    await run(sql`DELETE FROM labelary_requests`);
    await seed(LIMIT, '23 hours 59 minutes 58 seconds');
    expect(await quota().reserve(1)).toMatchObject({ ok: false });   // still inside it
  });

  test('room comes back as requests leave the window, one by one', async () => {
    await seed(4, '25 hours');                                       // gone
    await seed(3, '23 hours');
    await seed(3, '2 hours');
    expect((await quota().status()).remaining).toBe(LIMIT - 6);
    const q = quota();
    const more = await Promise.all(Array.from({ length: 6 }, () => q.reserve(1)));
    expect(more.filter(r => r.ok)).toHaveLength(4);
  });

  test('in no window of 24 hours, from any request on, are there more than the limit (the rule itself)', async () => {
    // A history that is already at the limit in some windows, then a burst of new requests
    await seed(3, '47 hours');
    await seed(4, '30 hours');
    await seed(3, '20 hours');
    await seed(2, '5 hours');
    const q = quota();
    await Promise.all(Array.from({ length: 40 }, (_, i) => q.reserve(i)));
    const widest = await run(sql`
      SELECT max(c) AS widest FROM (
        SELECT (SELECT count(*) FROM labelary_requests b WHERE b.sent_at >= a.sent_at AND b.sent_at <= a.sent_at + interval '24 hours') AS c
        FROM labelary_requests a) x`);
    expect(Number((widest.rows[0] as any).widest)).toBeLessThanOrEqual(LIMIT);
  });

  test('old rows are deleted (25 hours), recent ones are kept', async () => {
    await seed(2, '26 hours');
    await seed(2, '23 hours');
    await quota().reserve(1);                                        // a new instance cleans on its first use
    expect(await count()).toBe(2 + 1);
  });
});

describe('a restart', () => {
  test('the use of the service survives it: a new process, a new connection, the same count', async () => {
    const first = quota();
    for (let i = 0; i < 6; i++) await first.reserve(1);
    await _resetDb();                                                // the old process is gone
    const second = quota();
    expect((await second.status()).remaining).toBe(LIMIT - 6);
    const results = await Promise.all(Array.from({ length: 10 }, () => second.reserve(1)));
    expect(results.filter(r => r.ok)).toHaveLength(4);
  });

  test('so does a block the service asked for', async () => {
    await quota().blockUntil(HOUR, 'external-429');
    await _resetDb();
    expect(await quota().reserve(1)).toMatchObject({ ok: false, reason: 'quota-external' });
  });
});

describe('the state for the screen', () => {
  test('ok, low and blocked, with what is left', async () => {
    const q = quota();
    expect(await q.status()).toEqual({ state: 'ok', remaining: 10, retryAt: null });
    await seed(7, '1 hour');
    expect(await q.status()).toEqual({ state: 'ok', remaining: 3, retryAt: null });
    await seed(1, '1 hour');
    expect(await q.status()).toEqual({ state: 'low', remaining: 2, retryAt: null });       // at the threshold
    await seed(2, '1 hour');
    const blocked = await q.status();
    expect(blocked).toMatchObject({ state: 'blocked', remaining: 0 });
    near(blocked.retryAt, 23 * HOUR);
  });
});

describe('a block from the service itself', () => {
  test('nothing is let through until it ends, and the answer says when', async () => {
    const q = quota();
    await q.blockUntil(30 * 60_000, 'external-429');
    const denied = await q.reserve(1);
    expect(denied).toMatchObject({ ok: false, reason: 'quota-external' });
    near((denied as any).retryAt, 30 * 60_000);
    expect(await count()).toBe(0);
    expect(await q.status()).toMatchObject({ state: 'blocked' });
  });

  test('a later, shorter answer does not shorten it; it is over when its time is', async () => {
    const q = quota();
    await q.blockUntil(2 * HOUR, 'external-429');
    await q.blockUntil(60_000, 'external-429');
    near((await q.reserve(1) as any).retryAt, 2 * HOUR);
    await run(sql`UPDATE labelary_block SET until = clock_timestamp() - interval '1 second'`);
    expect(await q.reserve(1)).toEqual({ ok: true });
  });
});

describe('when the database does not answer: nothing is sent', () => {
  const down = quota({ db: () => { throw new Error('database down'); } });

  test('a request is refused as unavailable (fail closed), never let through', async () => {
    expect(await down.reserve(1)).toMatchObject({ ok: false, reason: 'quota-unavailable', retryAt: null });
  });

  test('so is room for an export, and the state cannot be read', async () => {
    expect(await down.createHold(1, 5)).toMatchObject({ ok: false, reason: 'quota-unavailable' });
    await expect(down.status()).rejects.toThrow('database down');
  });

  test('a connection that fails in the middle of the transaction is refused too', async () => {
    const failing = quota({ db: () => ({ transaction: async () => { throw new Error('connection lost'); } }) as any });
    expect(await failing.reserve(1)).toMatchObject({ ok: false, reason: 'quota-unavailable' });
  });
});

describe('room kept for a mass export (hold)', () => {
  test('is kept as a whole or refused as a whole; what is refused keeps nothing', async () => {
    await seed(3, '1 hour');
    const q = quota();
    const a = await q.createHold(1, 5);
    expect(a).toMatchObject({ ok: true, slots: 5 });
    const refused = await q.createHold(2, 3);                        // 10 - 3 used - 5 held = 2 free
    expect(refused).toMatchObject({ ok: false, reason: 'quota-internal', remaining: 2 });
    expect(await heldSlots()).toBe(5);
    expect(await q.createHold(2, 2)).toMatchObject({ ok: true });
    expect(await heldSlots()).toBe(7);
  });

  test('what is held counts against the limit: an ordinary request cannot take it', async () => {
    await seed(3, '1 hour');
    const q = quota();
    await q.createHold(1, 7);
    expect(await q.reserve(2)).toMatchObject({ ok: false, reason: 'quota-internal' });
    expect((await q.status()).remaining).toBe(0);
  });

  test('each request of the export uses a slot and the count does not move: the export finishes', async () => {
    await seed(3, '1 hour');
    const q = quota();
    const hold = await q.createHold(1, 7) as any;
    for (let i = 0; i < 7; i++) {
      expect(await q.reserve(1, hold.holdId)).toEqual({ ok: true });
      expect((await q.status()).remaining).toBe(0);                  // used + held stays 10
    }
    expect(await count()).toBe(10);
    expect(await heldSlots()).toBe(0);
    expect(await q.reserve(1, hold.holdId)).toMatchObject({ ok: false });   // the hold is used up: an ordinary request, and there is no room
  });

  test('what an export does not use is given back, at once when it releases, or when the hold expires', async () => {
    const q = quota();
    const a = await q.createHold(1, 6) as any;
    const b = await q.createHold(2, 4) as any;
    expect(await q.reserve(3)).toMatchObject({ ok: false });
    await q.releaseHold(1, a.holdId);
    expect(await heldSlots()).toBe(4);
    await q.releaseHold(1, a.holdId);                                // twice is harmless
    await q.releaseHold(1, b.holdId);                                // not its owner: nothing happens
    expect(await heldSlots()).toBe(4);
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() - interval '1 second'`);
    expect((await q.status()).remaining).toBe(10);                   // an expired hold holds nothing
    expect(await q.reserve(3)).toEqual({ ok: true });
  });

  test('a user has one hold at a time: a second one is REFUSED and the first is never replaced, shortened or renewed', async () => {
    const q = quota();
    const first = await q.createHold(1, 8) as any;
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() + interval '10 minutes'`);
    const before = (await run(sql`SELECT slots, expires_at FROM labelary_holds`)).rows[0] as any;
    const second = await q.createHold(1, 1);
    expect(second).toMatchObject({ ok: false, reason: 'hold-active' });
    near((second as any).retryAt, 10 * 60_000);                      // when the one in use ends
    const after = (await run(sql`SELECT id, slots, expires_at FROM labelary_holds`)).rows as any[];
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.holdId);
    expect(after[0].slots).toBe(before.slots);
    expect(new Date(after[0].expires_at).getTime()).toBe(new Date(before.expires_at).getTime());
    expect(await heldSlots()).toBe(8);
  });

  test('the first export, with its room, keeps working while the same user is refused a second one', async () => {
    const q = quota();
    const first = await q.createHold(1, 6) as any;
    expect(await q.createHold(1, 6)).toMatchObject({ ok: false, reason: 'hold-active' });
    const used = await Promise.all(Array.from({ length: 6 }, () => q.reserve(1, first.holdId)));
    expect(used.every(r => r.ok)).toBe(true);                        // all six, from its own room
    expect(await count()).toBe(6);
    expect(await heldSlots()).toBe(0);
  });

  test('once the first hold is released, or has expired, the user may hold again', async () => {
    const q = quota();
    const a = await q.createHold(1, 4) as any;
    await q.releaseHold(1, a.holdId);
    expect(await q.createHold(1, 4)).toMatchObject({ ok: true });
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() - interval '1 second'`);
    expect(await q.createHold(1, 3)).toMatchObject({ ok: true, slots: 3 });    // the expired one is cleared, not an obstacle
    expect(await heldSlots()).toBe(3);
  });

  test('two requests for a hold of the same user at the same moment: exactly one is granted, the other is "hold-active"', async () => {
    const q = quota();
    const results = await Promise.all(Array.from({ length: 12 }, () => q.createHold(1, 5)));
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok && (r as any).reason === 'hold-active')).toHaveLength(11);
    expect(await heldSlots()).toBe(5);
    const rowsLeft = (await run(sql`SELECT count(*) AS n FROM labelary_holds`)).rows[0] as any;
    expect(Number(rowsLeft.n)).toBe(1);
  });

  test('only its owner can use it, and one that is unknown or expired makes an ordinary request', async () => {
    await seed(9, '1 hour');
    const q = quota();
    const hold = await q.createHold(1, 1) as any;
    expect(await q.reserve(2, hold.holdId)).toMatchObject({ ok: false });    // someone else's hold: no room
    expect(await q.reserve(1, '00000000-0000-4000-8000-000000000000')).toMatchObject({ ok: false });
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() - interval '1 second'`);
    expect(await q.reserve(1, hold.holdId)).toEqual({ ok: true });           // expired: ordinary, and there is room again
  });

  test('using the hold keeps it alive', async () => {
    const q = quota({ holdTtlMs: 60_000 });
    const hold = await q.createHold(1, 3) as any;
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() + interval '2 seconds'`);
    await q.reserve(1, hold.holdId);
    const r = await run(sql`SELECT extract(epoch FROM expires_at - clock_timestamp()) AS s FROM labelary_holds`);
    expect(Number((r.rows[0] as any).s)).toBeGreaterThan(30);
  });

  test('a block refuses room for an export too', async () => {
    const q = quota();
    await q.blockUntil(HOUR, 'external-429');
    expect(await q.createHold(1, 2)).toMatchObject({ ok: false, reason: 'quota-external' });
  });

  test('holds and requests at the same time: used + held never goes over the limit', async () => {
    const q = quota();
    const work = [
      ...[1, 2, 3, 4].map(u => q.createHold(u, 4)),                // only two of these can fit (4 + 4 = 8)
      ...Array.from({ length: 30 }, (_, i) => q.reserve(100 + i)),
    ];
    await Promise.all(work);
    expect((await count()) + (await heldSlots())).toBeLessThanOrEqual(LIMIT);
  });
});
