process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import { spawn } from 'child_process';
import path from 'path';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from '../db/database';

/**
 * The quota with SEPARATE PROCESSES (each with its own connection pool, as several instances of the server would be),
 * all asking at the same moment: the rules hold because they are decided in the database, not in a process. Each worker
 * is test-fixtures/quotaWorker.ts, run with ts-node.
 */

const ROOT = path.resolve(__dirname, '../..');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const num = async (q: ReturnType<typeof sql>) => Number(((await run(q)).rows[0] as any).n);

interface WorkerResult { user: number; holdsGranted: number; holdReasons: string[]; singlesAccepted: number }

function worker(job: Record<string, number>): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'test-fixtures/quotaWorker.ts', JSON.stringify(job)], {
      cwd: ROOT, env: { ...process.env, TS_NODE_PROJECT: path.join(ROOT, 'tsconfig.json'), TS_NODE_TRANSPILE_ONLY: 'true' },
    });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      const line = out.split('\n').find(l => l.startsWith('{"user"'));
      if (code === 0 && line) resolve(JSON.parse(line));
      else reject(new Error(`worker failed (${code}): ${err.slice(0, 600)}`));
    });
  });
}

/** Starts `n` workers that all ask at the same instant, a couple of seconds from now (when every process is connected). */
const together = (n: number, job: (i: number) => Record<string, number>) => {
  const startAt = Date.now() + 3_500;
  return Promise.all(Array.from({ length: n }, (_, i) => worker({ ...job(i), startAt })));
};

beforeAll(async () => { await initDb(); }, 60_000);
beforeEach(async () => {
  await run(sql`DELETE FROM labelary_requests`);
  await run(sql`DELETE FROM labelary_holds`);
  await run(sql`DELETE FROM labelary_block`);
});
afterAll(async () => { await _resetDb(); });

const widest = () => num(sql`SELECT max(c) AS n FROM (SELECT (SELECT count(*) FROM labelary_requests b WHERE b.sent_at >= a.sent_at AND b.sent_at <= a.sent_at + interval '24 hours') AS c FROM labelary_requests a) x`);

describe('separate processes asking at the same moment', () => {
  test('requests and holds from 4 processes: used + held never passes the limit, held never passes its cap, one hold per user', async () => {
    const results = await together(4, i => ({ limit: 100, holdLimit: 40, holdMaxPerUser: 30, user: i + 1, holds: 1, holdSize: 25, singles: 120 }));
    const used = await num(sql`SELECT count(*) AS n FROM labelary_requests`);
    const held = await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`);
    expect(used + held).toBeLessThanOrEqual(100);
    expect(held).toBeLessThanOrEqual(40);
    expect(results.reduce((n, r) => n + r.holdsGranted, 0)).toBe(1);                 // 25 + 25 > 40: only one fits
    expect(await widest()).toBeLessThanOrEqual(100);
    expect(results.reduce((n, r) => n + r.singlesAccepted, 0)).toBe(used);          // every request accepted is a row, none lost or counted twice
  }, 90_000);

  test('the same user asking for two holds from two processes at once: one is granted, the other is "hold-active"', async () => {
    const results = await together(2, () => ({ limit: 100, holdLimit: 60, holdMaxPerUser: 50, user: 7, holds: 1, holdSize: 20, singles: 0 }));
    expect(results.reduce((n, r) => n + r.holdsGranted, 0)).toBe(1);
    expect(results.flatMap(r => r.holdReasons)).toEqual(['hold-active']);
    expect(await num(sql`SELECT count(*) AS n FROM labelary_holds`)).toBe(1);
    expect(await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`)).toBe(20);
  }, 90_000);

  test('6 processes, each asking for a hold of 12 with 30 that may be held: exactly 2 are granted', async () => {
    const results = await together(6, i => ({ limit: 100, holdLimit: 30, holdMaxPerUser: 20, user: 20 + i, holds: 1, holdSize: 12, singles: 0 }));
    expect(results.reduce((n, r) => n + r.holdsGranted, 0)).toBe(2);
    expect(await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`)).toBe(24);
    expect(results.flatMap(r => r.holdReasons).every(x => x === 'hold-capacity')).toBe(true);
  }, 90_000);
});

describe('the fixed ceiling of room held for exports, with the caps the server derives from the daily limit', () => {
  test('daily limit 5000: 6 processes each asking for 600 from a different user: exactly 2 are granted (1,200), never more', async () => {
    const results = await together(6, i => ({ dailyLimit: 5_000, limit: 5_000, user: 40 + i, holds: 1, holdSize: 600, singles: 0 }));
    expect(results.reduce((n, r) => n + r.holdsGranted, 0)).toBe(2);
    expect(await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`)).toBe(1_200);
    expect(results.flatMap(r => r.holdReasons).every(x => x === 'hold-capacity')).toBe(true);
  }, 90_000);

  test('daily limit 4000 (the default): the same, 1,200 in all', async () => {
    const results = await together(5, i => ({ dailyLimit: 4_000, limit: 4_000, user: 50 + i, holds: 1, holdSize: 600, singles: 0 }));
    expect(results.reduce((n, r) => n + r.holdsGranted, 0)).toBe(2);
    expect(await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`)).toBe(1_200);
  }, 90_000);

  test('daily limit 100: the ceiling is 100: 4 processes asking for 40 and sending requests: used + held <= 100', async () => {
    const results = await together(4, i => ({ dailyLimit: 100, limit: 100, user: 60 + i, holds: 1, holdSize: 40, singles: 60 }));
    const used = await num(sql`SELECT count(*) AS n FROM labelary_requests`);
    const held = await num(sql`SELECT COALESCE(sum(slots), 0) AS n FROM labelary_holds`);
    expect(held).toBeLessThanOrEqual(100);
    expect(used + held).toBeLessThanOrEqual(100);
    expect(results.reduce((n, r) => n + r.holdsGranted, 0) * 40).toBe(held);
  }, 90_000);

  test('one user asking for more than 600 is refused whole, whatever the daily limit', async () => {
    const results = await together(1, () => ({ dailyLimit: 5_000, limit: 5_000, user: 70, holds: 1, holdSize: 601, singles: 0 }));
    expect(results[0].holdsGranted).toBe(0);
    expect(results[0].holdReasons).toEqual(['hold-too-large']);
    expect(await num(sql`SELECT count(*) AS n FROM labelary_holds`)).toBe(0);
  }, 90_000);
});
