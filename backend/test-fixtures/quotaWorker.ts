// A process of its own for the test of the quota with several processes (src/labelary/quota.processes.test.ts): it has its
// own connection pool and its own LabelaryQuota, and asks for room as the test tells it, all at once. It prints one line of JSON.
// Run with: node -r ts-node/register/transpile-only test-fixtures/quotaWorker.ts '<json>'
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres@localhost/etiqueta_test';
process.env.NODE_ENV = 'test';

import { _resetDb } from '../src/db/database';
import { LabelaryQuota } from '../src/labelary/quota';
import { readLabelaryLimits } from '../src/labelaryConfig';

interface Job {
  limit: number;
  holdLimit?: number;       // explicit caps, or...
  holdMaxPerUser?: number;
  dailyLimit?: number;     // ...the caps the server derives from this daily limit, as in production
  user: number;            // the user of this process (its hold and its requests)
  holds: number;           // how many holds this process asks for (all for its user, at once)
  holdSize: number;
  singles: number;         // single requests, all at once
  startAt: number;         // wall-clock time (ms) when all processes start, so that they ask at the same moment
}

async function main() {
  const job: Job = JSON.parse(process.argv[2]);
  const derived = job.dailyLimit !== undefined ? readLabelaryLimits({ LABELARY_DAILY_LIMIT: String(job.dailyLimit) } as NodeJS.ProcessEnv) : null;
  const quota = derived
    ? new LabelaryQuota({ limit: derived.dailyLimit, lowThreshold: 1, holdTtlMs: 60_000, holdLimit: derived.holdLimit, holdMaxPerUser: derived.holdMaxPerUser })
    : new LabelaryQuota({ limit: job.limit, lowThreshold: 1, holdTtlMs: 60_000, holdLimit: job.holdLimit, holdMaxPerUser: job.holdMaxPerUser });
  await quota.status();                                         // connected before the start
  await new Promise(r => setTimeout(r, Math.max(0, job.startAt - Date.now())));
  const results = await Promise.all([
    ...Array.from({ length: job.holds }, () => quota.createHold(job.user, job.holdSize)),
    ...Array.from({ length: job.singles }, () => quota.reserve(job.user)),
  ]);
  const holdResults = results.slice(0, job.holds);
  const singleResults = results.slice(job.holds);
  console.log(JSON.stringify({
    user: job.user,
    holdsGranted: holdResults.filter(r => r.ok).length,
    holdReasons: holdResults.filter(r => !r.ok).map(r => (r as { reason: string }).reason),
    singlesAccepted: singleResults.filter(r => r.ok).length,
  }));
  await _resetDb();
}

main().catch(e => { console.error(e); process.exit(1); });
