process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
// A faster gate than production's, so the HTTP tests do not take minutes: 10 requests a second, 2 at a time, 4 s of waiting
process.env.LABELARY_RATE_PER_SECOND = '10';
process.env.LABELARY_CONCURRENCY = '2';
process.env.LABELARY_QUEUE_MAX_WAIT_MS = '4000';

import request from 'supertest';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, labelaryBlockTable, labelaryHoldsTable, labelaryRequestsTable, templatesTable, usersTable } from '../db/schema';
import { labelaryGate, labelaryQuota } from '../labelary';

// The routes that reach Labelary, with a pretend Labelary and several real users: what each client is told, and that
// they all go through the one gate.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const body = (marker = 'x') => ({ zpl: `^XA^FD${marker}^FS^XZ`, labelWidth: 800, labelHeight: 1200 });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

// One server for the whole file: a request that is aborted on purpose never closes a server of its own
const server = app.listen(0);

let alice: string;
let bob: string;
let fetchMock: jest.SpyInstance;
const calls: { marker: string; at: number; url: string; signal?: AbortSignal | null }[] = [];

const png = () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
const markerOf = (init: any) => /\^FD(\w+)\^FS/.exec(String(init?.body))?.[1] ?? '';

/** Replaces the service: `answer` decides each reply (and may take time). */
function pretendLabelary(answer: (marker: string, n: number, signal?: AbortSignal | null) => Promise<Response> | Response = () => png()) {
  fetchMock.mockImplementation(async (url: any, init: any) => {
    const marker = markerOf(init);
    calls.push({ marker, at: Date.now(), url: String(url), signal: init?.signal });
    return answer(marker, calls.filter(c => c.marker === marker).length, init?.signal);
  });
}

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  // The use of the service is kept in the database (labelary/quota.ts): every test starts with none used and no block
  await db.delete(labelaryRequestsTable);
  await db.delete(labelaryHoldsTable);
  await db.delete(labelaryBlockTable);
  await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' }).expect(201);
  await request(app).post('/api/auth/register').send({ username: 'bob', password: 'password123' }).expect(201);
  alice = (await request(app).post('/api/auth/login').send({ username: 'alice', password: 'password123' }).expect(200)).body.token;
  bob = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'password123' }).expect(200)).body.token;
  calls.length = 0;
  labelaryGate.resetForTests();
  fetchMock = jest.spyOn(global, 'fetch');
  pretendLabelary();
});

afterEach(() => { fetchMock.mockRestore(); labelaryGate.resetForTests(); });
afterAll(async () => { await new Promise(res => server.close(res)); await _resetDb(); });

const preview = (token: string, marker = 'x', headers: Record<string, string> = {}) =>
  request(server).post('/api/preview').set(bearer(token)).set(headers).send(body(marker));

describe('what already worked still does', () => {
  test('a preview is the PNG the service drew, for the size asked (single label, label size in inches)', async () => {
    const res = await preview(alice).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    expect(calls[0].url).toMatch(/\/3\.94x5\.91\/0\/$/);
  });

  test('an export keeps its file type and name', async () => {
    const res = await request(app).post('/api/export').set(bearer(alice)).send({ ...body(), format: 'pdf' }).expect(200);
    expect(res.headers['content-disposition']).toContain('label.pdf');
  });

  test('other failures of the service are still a 502 with the same messages', async () => {
    pretendLabelary(() => new Response('oops', { status: 500 }));
    expect((await preview(alice).expect(502)).body).toEqual({ error: 'Labelary API error', code: 'upstream' });
    pretendLabelary(() => { throw new TypeError('fetch failed'); });
    expect((await preview(alice).expect(502)).body).toEqual({ error: 'Could not reach Labelary API', code: 'network' });
  });

  test('a bad request is still a 400 and never reaches the service', async () => {
    await request(app).post('/api/preview').set(bearer(alice)).send({ zpl: 1 }).expect(400);
    expect(calls).toHaveLength(0);
  });
});

describe('HTTP 429 from the service', () => {
  test('a short Retry-After is waited out by the server and the client just gets its picture', async () => {
    pretendLabelary((_m, n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }) : png()));
    await preview(alice).expect(200);
    expect(calls).toHaveLength(2);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(950);                  // the whole Retry-After, not less
  }, 15_000);

  test('a service that keeps refusing: the client gets 429 (not 502) with the Retry-After, after one more try, not a loop', async () => {
    pretendLabelary(() => new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }));
    const res = await preview(alice).expect(429);
    expect(res.body).toEqual({ error: 'Labelary rate limit reached, please retry later', code: 'rate-limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(calls).toHaveLength(2);
  }, 15_000);

  test('a long Retry-After (the daily quota) is passed on straight away, and the next requests do not even try the service', async () => {
    pretendLabelary(() => new Response('quota', { status: 429, headers: { 'Retry-After': '3600' } }));
    const first = await preview(alice).expect(429);
    expect(Number(first.headers['retry-after'])).toBe(3600);
    expect(first.body.code).toBe('quota-external');                                 // the daily quota, not the pace
    expect(calls).toHaveLength(1);
    const next = await preview(bob).expect(429);                                    // another user: blocked for all, from the database
    expect(next.body.code).toBe('quota-external');
    expect(next.body.error).toMatch(/quota/);
    expect(Number(next.headers['retry-after'])).toBeGreaterThan(3500);
    expect(calls).toHaveLength(1);
  });

  test('a 429 without a usable Retry-After still stops everyone for a default time, and is told as a 429', async () => {
    pretendLabelary(() => new Response('no', { status: 429 }));
    const res = await preview(alice).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  }, 20_000);

  test('while the service is saying wait, another user\'s request waits for the pause too (and is not lost)', async () => {
    pretendLabelary((m, n) => (m === 'first' && n === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : png()));
    const first = preview(alice, 'first').then(r => r.status);
    await sleep(100);
    const t0 = Date.now();
    const second = preview(bob, 'second').then(r => ({ status: r.status, at: Date.now() - t0 }));
    expect(await first).toBe(200);
    const s = await second;
    expect(s.status).toBe(200);
    expect(s.at).toBeGreaterThanOrEqual(700);                                       // it waited for the pause
    expect(calls.map(c => c.marker)).toEqual(['first', 'first', 'second']);
  }, 15_000);
});

describe('several users at once', () => {
  test('everybody is served, one gate: starts are paced and never more than the concurrency are in flight', async () => {
    // This is about the pace of the gate. The quota (a few ms in the database, now and then 40) is taken just before each send
    // and would blur the 100 ms between sends this test measures, so here it answers at once (it has its own tests)
    const noQuota = jest.spyOn(labelaryQuota, 'reserve').mockResolvedValue({ ok: true });
    let active = 0;
    let most = 0;
    pretendLabelary(async () => { active++; most = Math.max(most, active); await sleep(120); active--; return png(); });
    const all = [
      ...Array.from({ length: 5 }, (_, i) => preview(alice, `a${i}`).then(r => r.status)),
      ...Array.from({ length: 5 }, (_, i) => preview(bob, `b${i}`).then(r => r.status)),
    ];
    expect(await Promise.all(all)).toEqual(Array(10).fill(200));
    expect(calls).toHaveLength(10);                                                 // none lost, none repeated
    expect(most).toBeLessThanOrEqual(2);
    const times = calls.map(c => c.at).sort((a, b) => a - b);
    expect(times.slice(1).every((t, i) => t - times[i] >= 80)).toBe(true);          // 10 a second: no bursts, from two users together
    noQuota.mockRestore();
  }, 20_000);

  test('both users are served in turn: neither waits for the other to finish', async () => {
    pretendLabelary(async () => { await sleep(60); return png(); });
    const all = [
      ...Array.from({ length: 6 }, (_, i) => preview(alice, `a${i}`)),
      ...Array.from({ length: 6 }, (_, i) => preview(bob, `b${i}`)),
    ];
    await Promise.all(all);
    const order = calls.map(c => c.marker[0]).join('');
    expect(order.slice(0, 6)).toContain('b');                                       // bob got in among alice's first six
    expect(order.slice(0, 6)).toContain('a');
  }, 20_000);

  test('single previews go before a mass export that was already waiting', async () => {
    pretendLabelary(async () => { await sleep(150); return png(); });
    const bulk = Array.from({ length: 8 }, (_, i) => preview(alice, `bulk${i}`, { 'X-Render-Priority': 'bulk' }).then(r => r.status));
    await sleep(300);                                                               // the export is running
    const single = preview(bob, 'single').then(r => r.status);
    expect(await Promise.all([...bulk, single])).toEqual(Array(9).fill(200));
    const order = calls.map(c => c.marker);
    const bulksBefore = order.slice(0, order.indexOf('single')).filter(m => m.startsWith('bulk')).length;
    expect(bulksBefore).toBeLessThanOrEqual(5);                                     // not behind all eight
    expect(order.indexOf('single')).toBeLessThan(order.indexOf('bulk7'));
  }, 20_000);

  test('the header says what a request is; anything else is a single preview', async () => {
    const run = jest.spyOn(labelaryGate, 'run');
    await preview(alice, 'p1').expect(200);
    await preview(alice, 'p2', { 'X-Render-Priority': 'bulk' }).expect(200);
    await preview(alice, 'p3', { 'X-Render-Priority': 'urgent' }).expect(200);
    expect(run.mock.calls.map(c => c[1].priority)).toEqual(['interactive', 'bulk', 'interactive']);
    expect(run.mock.calls.every(c => /^\d+$/.test(c[1].user))).toBe(true);          // by user, not by address
    run.mockRestore();
  });

  test('two users have two places in the turn even from the same address', async () => {
    const run = jest.spyOn(labelaryGate, 'run');
    await preview(alice, 'a').expect(200);
    await preview(bob, 'b').expect(200);
    const users = run.mock.calls.map(c => c[1].user);
    expect(new Set(users).size).toBe(2);
    run.mockRestore();
  });
});

describe('cancelling and waiting too long', () => {
  test('a client that goes away stops its request at the service', async () => {
    let seen: AbortSignal | null | undefined;
    pretendLabelary((_m, _n, signal) => { seen = signal; return new Promise<Response>((_res, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))); });
    const req = preview(alice, 'slow');
    req.then(() => undefined, () => undefined);
    await sleep(300);
    expect(calls).toHaveLength(1);
    req.abort();
    await sleep(300);
    expect(seen?.aborted).toBe(true);
    expect(labelaryGate.inFlight).toBe(0);                                          // its place was freed
  });

  test('a client that goes away while waiting its turn is never sent to the service', async () => {
    const release: (() => void)[] = [];
    pretendLabelary(() => new Promise<Response>(res => release.push(() => res(png()))));
    const holders = [preview(alice, 'h1'), preview(alice, 'h2')];                   // take both places
    holders.forEach(h => h.then(() => undefined, () => undefined));
    await sleep(300);
    const waiting = preview(bob, 'late');
    waiting.then(() => undefined, () => undefined);
    await sleep(200);
    waiting.abort();
    await sleep(200);
    release.splice(0).forEach(r => r());
    await Promise.all(holders);
    await sleep(300);
    expect(calls.map(c => c.marker)).toEqual(['h1', 'h2']);
  });

  test('a request that waits too long for its turn gets a 503 with a Retry-After, and the queue recovers', async () => {
    const release: (() => void)[] = [];
    pretendLabelary((m) => (m.startsWith('hold') ? new Promise<Response>(res => release.push(() => res(png()))) : png()));
    const holders = [preview(alice, 'hold1'), preview(alice, 'hold2')];
    holders.forEach(h => h.then(() => undefined, () => undefined));
    await sleep(300);
    const res = await preview(bob, 'tooLate').expect(503);
    expect(res.body).toEqual({ error: 'Labelary API busy, please retry later', code: 'busy' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(calls.map(c => c.marker)).toEqual(['hold1', 'hold2']);                   // it was never sent
    release.splice(0).forEach(r => r());
    await Promise.all(holders);
    await preview(bob, 'after').expect(200);                                        // the queue works again
  }, 20_000);

  test('after a failure the queue goes on: a refused request does not hold the next ones', async () => {
    pretendLabelary((m) => (m === 'bad' ? new Response('', { status: 500 }) : png()));
    const results = await Promise.all([preview(alice, 'bad'), preview(bob, 'good1'), preview(alice, 'good2')]);
    expect(results.map(r => r.status)).toEqual([502, 200, 200]);
    expect(labelaryGate.inFlight).toBe(0);
    expect(labelaryGate.waiting).toBe(0);
  });
});
