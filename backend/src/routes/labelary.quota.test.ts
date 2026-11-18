process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
// A small quota (3 requests in 24 hours) and a fast gate, so the whole rule can be seen in a few requests
process.env.LABELARY_DAILY_LIMIT = '3';
process.env.LABELARY_RATE_PER_SECOND = '20';
process.env.LABELARY_CONCURRENCY = '2';
process.env.LABELARY_QUEUE_MAX_WAIT_MS = '4000';
process.env.LABELARY_TIMEOUT_MS = '300';

import request from 'supertest';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import {
  designsTable, designVersionsTable, labelaryBlockTable, labelaryHoldsTable, labelaryRequestsTable, templatesTable, usersTable,
} from '../db/schema';
import { labelaryGate, labelaryQuota } from '../labelary';

// The routes that reach Labelary with a quota of 3: what is let through, what is refused and told, what is never sent,
// what each failure of the service is called, and that the rest of the app does not notice.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const body = (marker = 'x') => ({ zpl: `^XA^FD${marker}^FS^XZ`, labelWidth: 800, labelHeight: 1200 });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const server = app.listen(0);

let alice: string;
let bob: string;
let fetchMock: jest.SpyInstance;
const calls: { marker: string; accept: string }[] = [];

const png = () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
const markerOf = (init: any) => /\^FD(\w+)\^FS/.exec(String(init?.body))?.[1] ?? '';

function pretendLabelary(answer: (marker: string, n: number, signal?: AbortSignal | null) => Promise<Response> | Response = () => png()) {
  fetchMock.mockImplementation(async (_url: any, init: any) => {
    const marker = markerOf(init);
    calls.push({ marker, accept: init?.headers?.Accept });
    return answer(marker, calls.filter(c => c.marker === marker).length, init?.signal);
  });
}

const rows = async (): Promise<number> => (await getDb().select().from(labelaryRequestsTable)).length;
const holdRows = async () => getDb().select().from(labelaryHoldsTable);
const blockRows = async () => getDb().select().from(labelaryBlockTable);

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
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

afterEach(() => { fetchMock.mockRestore(); jest.restoreAllMocks(); labelaryGate.resetForTests(); });
afterAll(async () => { await new Promise(res => server.close(res)); await _resetDb(); });

const preview = (token: string, marker = 'x', headers: Record<string, string> = {}) =>
  request(server).post('/api/preview').set(bearer(token)).set(headers).send(body(marker));

describe('the limit (3 in 24 hours)', () => {
  test('1, 2, 3 are drawn; the 4th is refused with a clear answer and never reaches the service', async () => {
    for (const m of ['one', 'two', 'three']) await preview(alice, m).expect(200);
    expect(calls).toHaveLength(3);
    expect(await rows()).toBe(3);

    const res = await preview(alice, 'four').expect(429);
    expect(res.body).toMatchObject({ error: 'Labelary daily limit of this server reached', code: 'quota-internal', remaining: 0 });
    expect(Date.parse(res.body.retryAt)).toBeGreaterThan(Date.now());
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(calls).toHaveLength(3);                                    // nothing was sent
    expect(await rows()).toBe(3);                                     // and nothing was counted
  });

  test('the limit is shared by every user', async () => {
    await preview(alice, 'a1').expect(200);
    await preview(bob, 'b1').expect(200);
    await preview(alice, 'a2').expect(200);
    expect((await preview(bob, 'b2').expect(429)).body.code).toBe('quota-internal');
  });

  test('20 requests at once from two users: exactly 3 are sent to the service', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => preview(i % 2 ? alice : bob, `m${i}`)));
    expect(results.filter(r => r.status === 200)).toHaveLength(3);
    expect(results.filter(r => r.status === 429)).toHaveLength(17);
    expect(calls).toHaveLength(3);
    expect(await rows()).toBe(3);
  });

  test('exports (every format) count like previews', async () => {
    await request(server).post('/api/export').set(bearer(alice)).send({ ...body('p'), format: 'pdf' }).expect(200);
    await request(server).post('/api/export').set(bearer(alice)).send({ ...body('z'), format: 'zpl' }).expect(200);
    await preview(alice, 'q').expect(200);
    await request(server).post('/api/export').set(bearer(alice)).send({ ...body('n'), format: 'png' }).expect(429);
    expect(calls.map(c => c.accept)).toEqual(['application/pdf', 'application/zpl', 'image/png']);
  });
});

describe('every try that is sent counts; what was not sent does not', () => {
  test('a try after the service said wait (its pace) is another request', async () => {
    pretendLabelary((_m, n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } }) : png()));
    await preview(alice, 'again').expect(200);
    expect(calls).toHaveLength(2);
    expect(await rows()).toBe(2);
  }, 15_000);

  test('a request that waited in the queue and was cancelled is never counted', async () => {
    const release: (() => void)[] = [];
    pretendLabelary(() => new Promise<Response>(res => release.push(() => res(png()))));
    const holders = [preview(alice, 'h1'), preview(alice, 'h2')];
    holders.forEach(h => h.then(() => undefined, () => undefined));
    await sleep(300);
    const waiting = preview(bob, 'late');
    waiting.then(() => undefined, () => undefined);
    await sleep(200);
    waiting.abort();
    await sleep(200);
    release.splice(0).forEach(r => r());
    await Promise.all(holders);
    await sleep(200);
    expect(calls.map(c => c.marker)).toEqual(['h1', 'h2']);
    expect(await rows()).toBe(2);                                     // the third was never sent, so it is not in the count
  });

  test('a bad request (not valid) is refused before anything is reserved', async () => {
    await request(app).post('/api/preview').set(bearer(alice)).send({ zpl: 1 }).expect(400);
    expect(await rows()).toBe(0);
  });
});

describe('what the service answers is told apart', () => {
  test('400 and 413: this label was refused, 422, and it is never asked again', async () => {
    pretendLabelary(() => new Response('invalid zpl', { status: 400 }));
    const a = await preview(alice, 'bad').expect(422);
    expect(a.body).toEqual({ error: 'The rendering service rejected this label', code: 'zpl-rejected' });
    pretendLabelary(() => new Response('too big', { status: 413 }));
    expect((await preview(alice, 'big').expect(422)).body.code).toBe('zpl-rejected');
    expect(calls).toHaveLength(2);                                    // one try each: the server does not insist
  });

  test('a problem of the service: 502 upstream; no answer: 502 network; too slow: 504 timeout', async () => {
    pretendLabelary(() => new Response('oops', { status: 500 }));
    expect((await preview(alice, 'u').expect(502)).body).toEqual({ error: 'Labelary API error', code: 'upstream' });
    pretendLabelary(() => { throw new TypeError('fetch failed'); });
    expect((await preview(alice, 'n').expect(502)).body).toEqual({ error: 'Could not reach Labelary API', code: 'network' });
  });

  test('a service that does not answer in time is a 504 timeout, not a "cannot reach"', async () => {
    pretendLabelary((_m, _n, signal) => new Promise<Response>((_res, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const t0 = Date.now();
    const res = await preview(alice, 'slow').expect(504);
    expect(res.body).toEqual({ error: 'Labelary API timed out', code: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('a 429 that is only the pace is "rate-limited" and blocks nothing', async () => {
    pretendLabelary(() => new Response('too many requests per second', { status: 429, headers: { 'Retry-After': '1' } }));
    const res = await preview(alice, 'pace').expect(429);
    expect(res.body).toEqual({ error: 'Labelary rate limit reached, please retry later', code: 'rate-limited' });
    expect(await blockRows()).toHaveLength(0);
  }, 15_000);
});

describe('the quota of the service itself is used up', () => {
  test('a 429 that says "day": 429 quota-external, recorded, and nothing more is sent by anyone', async () => {
    pretendLabelary(() => new Response('Daily quota exceeded', { status: 429, headers: { 'Retry-After': '7200' } }));
    const first = await preview(alice, 'q1').expect(429);
    expect(first.body).toMatchObject({ error: 'Labelary quota is used up for now', code: 'quota-external' });
    expect(Math.abs(Date.parse(first.body.retryAt) - (Date.now() + 7_200_000))).toBeLessThan(10_000);
    expect(Number(first.headers['retry-after'])).toBeGreaterThan(7000);
    expect(calls).toHaveLength(1);                                    // it was not tried again
    const block = await blockRows();
    expect(block).toHaveLength(1);
    expect(block[0].reason).toBe('external-429');

    const next = await preview(bob, 'q2').expect(429);                // another user: from the database, with no call
    expect(next.body.code).toBe('quota-external');
    expect(calls).toHaveLength(1);
  });

  test('a long Retry-After alone (a minute or more) is the daily quota; a short one is not', async () => {
    pretendLabelary(() => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    expect((await preview(alice, 'long').expect(429)).body.code).toBe('quota-external');
    expect(await blockRows()).toHaveLength(1);
  });

  test('the words of the body decide nothing: "daily" or "per day" with no Retry-After is only the pace, and blocks nothing', async () => {
    for (const text of ['Daily quota exceeded', 'You exceeded your requests per day', 'Too many requests today']) {
      pretendLabelary(() => new Response(text, { status: 429 }));
      const res = await preview(alice, 'noheader').expect(429);
      expect(res.body).toEqual({ error: 'Labelary rate limit reached, please retry later', code: 'rate-limited' });
      expect(await blockRows()).toHaveLength(0);
      labelaryGate.resetForTests();
    }
  }, 40_000);

  test('a message that names both limits, with a Retry-After of 1 second, is the pace (not a block of an hour)', async () => {
    pretendLabelary(() => new Response('Rate limit: 3 requests per second (5,000 per day)', { status: 429, headers: { 'Retry-After': '1' } }));
    const res = await preview(alice, 'both').expect(429);
    expect(res.body.code).toBe('rate-limited');
    expect(await blockRows()).toHaveLength(0);
  }, 15_000);

  test('an HTTP date in Retry-After is read: hours away is the daily quota, and every instance keeps away until then', async () => {
    const at = new Date(Date.now() + 3 * 3_600_000);
    pretendLabelary(() => new Response('', { status: 429, headers: { 'Retry-After': at.toUTCString() } }));
    const res = await preview(alice, 'date').expect(429);
    expect(res.body.code).toBe('quota-external');
    expect(Math.abs(Date.parse(res.body.retryAt) - at.getTime())).toBeLessThan(5_000);
    expect(calls).toHaveLength(1);
    // another instance (a new LabelaryQuota on the same database) sees the block
    const { LabelaryQuota } = require('../labelary/quota');
    const other = new LabelaryQuota({ limit: 3, lowThreshold: 1, holdTtlMs: 60_000 });
    expect(await other.reserve(1)).toMatchObject({ ok: false, reason: 'quota-external' });
    expect(Math.abs((await blockRows())[0].until.getTime() - at.getTime())).toBeLessThan(5_000);
  });

  test('an HTTP date a couple of seconds away is the pace, a date already past or not valid is the usual short pause', async () => {
    pretendLabelary((_m, n) => (n === 1 ? new Response('', { status: 429, headers: { 'Retry-After': new Date(Date.now() + 2_500).toUTCString() } }) : png()));
    await preview(alice, 'soon').expect(200);                          // waited out by the server, tried again, counted twice
    expect(calls).toHaveLength(2);
    expect(await rows()).toBe(2);
    expect(await blockRows()).toHaveLength(0);
  }, 15_000);

  test('the block survives a restart of the gate and ends when its time is over', async () => {
    await labelaryQuota.blockUntil(60_000, 'external-429');
    labelaryGate.resetForTests();
    await preview(alice, 'blocked').expect(429);
    expect(calls).toHaveLength(0);
    await getDb().execute(require('drizzle-orm').sql`UPDATE labelary_block SET until = clock_timestamp() - interval '1 second'`);
    await preview(alice, 'free').expect(200);
  });
});

describe('when the quota cannot be checked: fail closed', () => {
  test('503 quota-unavailable and nothing is sent', async () => {
    jest.spyOn(labelaryQuota, 'reserve').mockResolvedValue({ ok: false, reason: 'quota-unavailable', retryAt: null, remaining: 0 });
    const res = await preview(alice, 'x').expect(503);
    expect(res.body).toEqual({ error: 'Labelary quota control unavailable', code: 'quota-unavailable' });
    expect(calls).toHaveLength(0);
  });

  test('the state cannot be read either: 503, the editor is told', async () => {
    jest.spyOn(labelaryQuota, 'status').mockRejectedValue(new Error('db down'));
    expect((await request(server).get('/api/labelary/status').set(bearer(alice)).expect(503)).body.code).toBe('quota-unavailable');
  });
});

describe('GET /api/labelary/status', () => {
  const status = (token = alice) => request(server).get('/api/labelary/status').set(bearer(token));

  test('needs a signed-in user', async () => {
    await request(server).get('/api/labelary/status').expect(401);
  });

  test('an integration token cannot ask (it is read-only for designs and templates)', async () => {
    const created = await request(app).post('/api/tokens').set(bearer(alice)).send({ name: 'sap' }).expect(201);
    await request(server).get('/api/labelary/status').set({ Authorization: `Bearer ${created.body.token}` }).expect(403);
  });

  test('ok, low and blocked, with what is left, and nothing about how it is kept', async () => {
    expect((await status().expect(200)).body).toEqual({ state: 'ok', remaining: 3, retryAt: null });
    await preview(alice, 'a').expect(200);
    expect((await status().expect(200)).body).toEqual({ state: 'ok', remaining: 2, retryAt: null });
    await preview(alice, 'b').expect(200);
    expect((await status().expect(200)).body).toEqual({ state: 'low', remaining: 1, retryAt: null });
    await preview(alice, 'c').expect(200);
    const blocked = (await status().expect(200)).body;
    expect(blocked).toMatchObject({ state: 'blocked', remaining: 0 });
    expect(Date.parse(blocked.retryAt)).toBeGreaterThan(Date.now());
    expect(Object.keys(blocked).sort()).toEqual(['remaining', 'retryAt', 'state']);
  });

  test('an external block shows as blocked with its time', async () => {
    await labelaryQuota.blockUntil(3_600_000, 'external-429');
    const s = (await status().expect(200)).body;
    expect(s.state).toBe('blocked');
    expect(Math.abs(Date.parse(s.retryAt) - (Date.now() + 3_600_000))).toBeLessThan(10_000);
  });

  test('the counter cannot be written from outside: there is no such route', async () => {
    await request(server).post('/api/labelary/status').set(bearer(alice)).send({ remaining: 9999 }).expect(404);
    await request(server).put('/api/labelary/status').set(bearer(alice)).send({ remaining: 9999 }).expect(404);
    expect((await status().expect(200)).body.remaining).toBe(3);
  });
});

describe('a mass export: room kept before it starts', () => {
  const hold = (token: string, count: number) => request(server).post('/api/labelary/holds').set(bearer(token)).send({ count });
  const release = (token: string, id: string) => request(server).delete(`/api/labelary/holds/${id}`).set(bearer(token));

  test('room for all the export or none: it does not start if it could not finish', async () => {
    await preview(bob, 'one').expect(200);                            // 1 of 3 used: 2 left
    const refused = await hold(alice, 3).expect(429);
    expect(refused.body).toMatchObject({ code: 'quota-internal', remaining: 2 });
    expect(await holdRows()).toHaveLength(0);
    await getDb().delete(labelaryRequestsTable);
    const granted = await hold(alice, 3).expect(201);
    expect(granted.body).toMatchObject({ slots: 3 });
    expect(typeof granted.body.holdId).toBe('string');
  });

  test('the export that kept its room finishes, and nobody else can take it meanwhile', async () => {
    const { holdId } = (await hold(alice, 3).expect(201)).body;
    await preview(bob, 'other').expect(429);                          // held: not for others
    for (const m of ['p1', 'p2', 'p3']) await preview(alice, m, { 'X-Render-Hold': holdId, 'X-Render-Priority': 'bulk' }).expect(200);
    expect(calls.map(c => c.marker)).toEqual(['p1', 'p2', 'p3']);
    expect(await rows()).toBe(3);
    expect(await holdRows()).toHaveLength(1);                         // used up, still there until released
    await release(alice, holdId).expect(204);
    expect(await holdRows()).toHaveLength(0);
  });

  test('cancelled: what was not used is given back at once', async () => {
    const { holdId } = (await hold(alice, 3).expect(201)).body;
    await preview(alice, 'p1', { 'X-Render-Hold': holdId }).expect(200);
    await release(alice, holdId).expect(204);
    expect((await request(server).get('/api/labelary/status').set(bearer(bob)).expect(200)).body.remaining).toBe(2);
    await preview(bob, 'b1').expect(200);
  });

  test('a try of one of its labels that is not covered by the hold is an ordinary request (and may be refused)', async () => {
    const { holdId } = (await hold(alice, 3).expect(201)).body;
    for (const m of ['p1', 'p2', 'p3']) await preview(alice, m, { 'X-Render-Hold': holdId }).expect(200);
    const extra = await preview(alice, 'again', { 'X-Render-Hold': holdId }).expect(429);
    expect(extra.body.code).toBe('quota-internal');
  });

  test('a hold that is not valid is ignored, not trusted: it is an ordinary request', async () => {
    await preview(alice, 'x1', { 'X-Render-Hold': 'not-a-uuid' }).expect(200);
    await preview(alice, 'x2', { 'X-Render-Hold': '00000000-0000-4000-8000-000000000000' }).expect(200);
    expect(await rows()).toBe(2);
  });

  test('only the owner can release it, and a wrong id is a 400', async () => {
    const { holdId } = (await hold(alice, 2).expect(201)).body;
    await release(bob, holdId).expect(204);
    expect(await holdRows()).toHaveLength(1);
    await release(alice, 'nope').expect(400);
    await hold(alice, 0).expect(400);
    await hold(alice, 601).expect(400);
  });

  test('a second export of the same user is refused, and the first keeps its room exactly as it was', async () => {
    const first = (await hold(alice, 2).expect(201)).body;
    const before = (await holdRows())[0];
    const second = await hold(alice, 1).expect(409);
    expect(second.body).toMatchObject({ error: 'An export of yours is already holding room', code: 'hold-active' });
    expect(Date.parse(second.body.retryAt)).toBeGreaterThan(Date.now());
    const after = await holdRows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first.holdId, slots: 2 });  // the same hold, with its slots...
    expect(after[0].expiresAt.getTime()).toBe(before.expiresAt.getTime());   // ...and its time, not renewed
    // and the first export goes on using it
    await preview(alice, 'p1', { 'X-Render-Hold': first.holdId }).expect(200);
    await preview(alice, 'p2', { 'X-Render-Hold': first.holdId }).expect(200);
  });

  test('when the room that may be held at once is taken, another user is refused with a code of its own, and nothing is spent', async () => {
    const a = (await hold(alice, 2).expect(201)).body;
    const refused = await hold(bob, 2).expect(429);                   // 2 + 2 is more than the 3 that may be held
    expect(refused.body).toMatchObject({ error: 'Export capacity is busy, try again in a few minutes', code: 'hold-capacity', remaining: 1 });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(await holdRows()).toHaveLength(1);
    expect(await rows()).toBe(0);
    await release(alice, a.holdId).expect(204);                       // the room goes back: now it fits
    await hold(bob, 2).expect(201);
  });

  test('an external block refuses the hold with its time', async () => {
    await labelaryQuota.blockUntil(3_600_000, 'external-429');
    const res = await hold(alice, 1).expect(429);
    expect(res.body.code).toBe('quota-external');
  });
});

describe('the editor does not notice: everything that does not need Labelary still works with no quota left', () => {
  test('generating, simulating and reading the designs answer normally while previews are refused', async () => {
    for (const m of ['a', 'b', 'c']) await preview(alice, m).expect(200);
    await preview(alice, 'd').expect(429);
    const label = { labelWidth: 800, labelHeight: 600, elements: [{ id: 't', type: 'text', x: 10, y: 10, width: 100, height: 40, value: 'Hi', fontSize: 30, fontName: '0' }] };
    expect((await request(server).post('/api/generate-zpl').set(bearer(alice)).send(label).expect(200)).body.zpl).toContain('^FDHi^FS');
    expect((await request(server).post('/api/expand-zpl').set(bearer(alice)).send(label).expect(200)).body.labels).toHaveLength(1);
    expect((await request(server).post('/api/parse-zpl').set(bearer(alice)).send({ zpl: '^XA^FO1,1^FDx^FS^XZ' }).expect(200)).body.elements).toHaveLength(1);
    await request(server).get('/api/designs').set(bearer(alice)).expect(200);
    const saved = await request(server).post('/api/designs').set(bearer(alice)).send({ name: 'D', zpl: '^XA^XZ', elements: label.elements, labelWidth: 800, labelHeight: 600 });
    expect(saved.status).toBe(201);
  });
});

