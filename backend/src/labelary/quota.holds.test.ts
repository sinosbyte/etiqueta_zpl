process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from '../db/database';
import { LabelaryQuota, QuotaOptions } from './quota';

/**
 * The limits of the room that may be held for mass exports (Etapa 4, audit): one hold per user, at most `holdMaxPerUser`
 * for one user and `holdLimit` for all users together, decided under the same lock as every count. Here: limit 100,
 * 30 that may be held at once, 20 for one user (the real defaults are 4,000, 1,200 and 600: the same rules, 30% and so on).
 */

const LIMIT = 100;
const HOLD_LIMIT = 30;
const PER_USER = 20;
const opts = (extra: Partial<QuotaOptions> = {}): QuotaOptions => ({ limit: LIMIT, lowThreshold: 5, holdTtlMs: 60_000, holdLimit: HOLD_LIMIT, holdMaxPerUser: PER_USER, ...extra });
const quota = (extra: Partial<QuotaOptions> = {}) => new LabelaryQuota(opts(extra));

const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const num = async (q: ReturnType<typeof sql>): Promise<number> => Number(((await run(q)).rows[0] as any).n);
const used = () => num(sql`SELECT count(*) AS n FROM labelary_requests WHERE sent_at >= clock_timestamp() - interval '24 hours'`);
const held = () => num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds WHERE expires_at > clock_timestamp()`);
const holds = () => num(sql`SELECT count(*) AS n FROM labelary_holds`);
const reason = (r: any) => (r.ok ? 'ok' : r.reason);

/** The invariant of the whole quota, and the one of the holds. */
async function expectInvariants(limit = LIMIT, holdLimit = HOLD_LIMIT) {
  expect((await used()) + (await held())).toBeLessThanOrEqual(limit);
  expect(await held()).toBeLessThanOrEqual(holdLimit);
  const perUser = (await run(sql`SELECT user_id, count(*) AS n FROM labelary_holds GROUP BY user_id`)).rows as any[];
  expect(perUser.every(r => Number(r.n) === 1)).toBe(true);
}

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  await run(sql`DELETE FROM labelary_requests`);
  await run(sql`DELETE FROM labelary_holds`);
  await run(sql`DELETE FROM labelary_block`);
});
afterAll(async () => { await _resetDb(); });

describe('what one user may hold', () => {
  test('up to the limit for one user, and more than that is refused as a whole, with nothing kept', async () => {
    const q = quota();
    expect(await q.createHold(1, PER_USER + 1)).toMatchObject({ ok: false, reason: 'hold-too-large', remaining: PER_USER });
    expect(await holds()).toBe(0);
    expect(await q.createHold(1, PER_USER)).toMatchObject({ ok: true, slots: PER_USER });
  });

  test('the limit of one user is never above the limit of all together', async () => {
    const q = quota({ holdLimit: 10, holdMaxPerUser: 600 });
    expect(await q.createHold(1, 11)).toMatchObject({ ok: false, reason: 'hold-too-large', remaining: 10 });
    expect(await q.createHold(1, 10)).toMatchObject({ ok: true });
  });
});

describe('what everybody may hold at once', () => {
  test('a hold that would take the total past the limit is refused whole, and spends and keeps nothing', async () => {
    const q = quota();
    expect(await q.createHold(1, 12)).toMatchObject({ ok: true });
    expect(await q.createHold(2, 12)).toMatchObject({ ok: true });                 // 24 of 30
    const refused = await q.createHold(3, 12);                                      // 36 > 30
    expect(refused).toMatchObject({ ok: false, reason: 'hold-capacity', remaining: 6 });
    expect(await held()).toBe(24);
    expect(await holds()).toBe(2);
    expect(await used()).toBe(0);
    expect(await q.createHold(3, 6)).toMatchObject({ ok: true });                   // what fits is granted
    expect(await held()).toBe(30);
  });

  test('a refusal says when there may be room: when the first hold ends', async () => {
    const q = quota();
    await q.createHold(1, 20);
    await q.createHold(2, 10);
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() + interval '7 minutes' WHERE user_id = 1`);
    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() + interval '9 minutes' WHERE user_id = 2`);
    const refused = await q.createHold(3, 5) as any;
    expect(refused.reason).toBe('hold-capacity');
    expect(Math.abs(refused.retryAt.getTime() - (Date.now() + 7 * 60_000))).toBeLessThan(5_000);
  });

  test('the cap is on holds: single requests are not touched by it (they have the whole quota that is left)', async () => {
    const q = quota();
    await q.createHold(1, 20);
    await q.createHold(2, 10);                                                      // 30 held, the most
    const singles = await Promise.all(Array.from({ length: 80 }, (_, i) => q.reserve(100 + i)));
    expect(singles.filter(r => r.ok)).toHaveLength(70);                             // 100 - 30 held
    await expectInvariants();
  });

  test('many users at once, each asking for 10, with 30 allowed: exactly 3 are granted', async () => {
    const q = quota();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => q.createHold(i + 1, 10)));
    expect(results.filter(r => r.ok)).toHaveLength(3);
    expect(results.filter(r => !r.ok).every(r => (r as any).reason === 'hold-capacity')).toBe(true);
    expect(await held()).toBe(30);
    await expectInvariants();
  });

  test('holds that together would pass the limit, asked at once from two servers: never over it', async () => {
    const a = quota();
    const b = quota();
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).createHold(i + 1, 7)));
    expect(results.filter(r => r.ok).length).toBe(4);                               // 4 x 7 = 28 <= 30 < 35
    expect(await held()).toBe(28);
    await expectInvariants();
  });

  test('holds, single requests and releases all at once: used + held never passes the limit, held never passes its cap', async () => {
    const q = quota({ limit: 50 });
    const first = await q.createHold(500, 10) as any;
    const work = [
      ...Array.from({ length: 8 }, (_, i) => q.createHold(i + 1, 10)),
      ...Array.from({ length: 70 }, (_, i) => q.reserve(1000 + i)),
      q.releaseHold(500, first.holdId),
      ...Array.from({ length: 5 }, () => q.reserve(500, first.holdId)),
    ];
    await Promise.all(work);
    await expectInvariants(50);
  });

  test('releasing a hold gives its room to the next user; so does its expiry', async () => {
    const q = quota();
    const a = await q.createHold(1, 20) as any;
    await q.createHold(2, 10);
    expect(await q.createHold(3, 10)).toMatchObject({ ok: false, reason: 'hold-capacity' });
    await q.releaseHold(1, a.holdId);
    expect(await q.createHold(3, 10)).toMatchObject({ ok: true });
    expect(await held()).toBe(20);

    await run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() - interval '1 second'`);
    expect(await held()).toBe(0);                                                   // expired holds hold nothing
    for (const user of [4, 5, 6]) expect(await q.createHold(user, 10)).toMatchObject({ ok: true });
    expect(await q.createHold(7, 10)).toMatchObject({ ok: false, reason: 'hold-capacity' });
    await expectInvariants();
  });

  test('using a hold does not change what is held in total: a slot becomes a request', async () => {
    const q = quota();
    const a = await q.createHold(1, 20) as any;
    await q.createHold(2, 10);
    for (let i = 0; i < 20; i++) await q.reserve(1, a.holdId);
    expect(await held()).toBe(10);
    expect(await used()).toBe(20);
    expect(await q.createHold(3, 20)).toMatchObject({ ok: true });                  // the 20 slots of the first export are free of the cap now
    await expectInvariants();
  });

  test('the room of the quota itself still comes first: a hold the quota has no room for is refused as such', async () => {
    await run(sql`INSERT INTO labelary_requests (sent_at, user_id) SELECT clock_timestamp() - interval '1 hour', 9 FROM generate_series(1, 90)`);
    const refused = await quota().createHold(1, 15);                                // cap allows it, only 10 of the quota are left
    expect(refused).toMatchObject({ ok: false, reason: 'quota-internal', remaining: 10 });
    expect(await holds()).toBe(0);
  });
});

describe('the rules keep the invariant over a long, mixed sequence (seeded)', () => {
  test('300 mixed operations in batches: after each batch, used + held <= limit, held <= cap, one hold per user', async () => {
    let seed = 20261118;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const q = quota({ limit: 60 });
    const live: { user: number; id: string }[] = [];
    for (let batch = 0; batch < 30; batch++) {
      const ops: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        const kind = rnd(5);
        if (kind === 0) ops.push(q.createHold(rnd(8) + 1, rnd(PER_USER) + 1).then(r => { if (r.ok) live.push({ user: 0, id: r.holdId }); }));
        else if (kind === 1) ops.push(q.reserve(rnd(8) + 1));
        else if (kind === 2 && live.length) { const h = live[rnd(live.length)]; ops.push(q.reserve(null, h.id)); }
        else if (kind === 3) ops.push(run(sql`UPDATE labelary_holds SET expires_at = clock_timestamp() - interval '1 second' WHERE id = (SELECT id FROM labelary_holds ORDER BY random() LIMIT 1)`));
        else ops.push(q.reserve(rnd(8) + 1));
      }
      await Promise.all(ops);
      await expectInvariants(60);
    }
  });
});
