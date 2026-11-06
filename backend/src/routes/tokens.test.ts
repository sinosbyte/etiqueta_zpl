process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { apiTokensTable, designsTable, designVersionsTable, templatesTable, usersTable } from '../db/schema';
import { LOG_REDACT_PATHS } from '../logger';

const payload = { zpl: '^XA^FO10,10^A0N,30,30^FDX^FS^XZ', elements: [], labelWidth: 800, labelHeight: 1200 };

interface Session { jwt: string; tokenId?: number }
let owner: Session;   // admin ("sinosbyte")
let guest: Session;   // regular user

async function signUp(username: string): Promise<Session> {
  await request(app).post('/api/auth/register').send({ username, password: 'password123' }).expect(201);
  const res = await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200);
  return { jwt: res.body.token };
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const basic = (user: string, pass: string) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') });

async function newToken(session: Session, name = 'SAP'): Promise<string> {
  const res = await request(app).post('/api/tokens').set(bearer(session.jwt)).send({ name }).expect(201);
  session.tokenId = res.body.id;
  return res.body.token as string;
}

beforeAll(async () => {
  await initDb();
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(apiTokensTable);
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  owner = await signUp('sinosbyte');
  guest = await signUp('guilherme');
  await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.username, 'sinosbyte'));
});

afterAll(async () => {
  await _resetDb();
});

describe('existing JWT behaviour is unchanged', () => {
  test('a JWT still reads designs, creates them and reaches the owner-only template routes', async () => {
    await request(app).get('/api/designs').set(bearer(owner.jwt)).expect(200);
    await request(app).post('/api/designs').set(bearer(owner.jwt)).send({ name: 'a', ...payload }).expect(201);
    await request(app).post('/api/templates').set(bearer(owner.jwt)).send({ name: 'T', description: '', ...payload }).expect(201);
    // a regular user still cannot publish a template
    await request(app).post('/api/templates').set(bearer(guest.jwt)).send({ name: 'T2', description: '', ...payload }).expect(403);
  });

  test('missing and invalid credentials keep their messages', async () => {
    const none = await request(app).get('/api/designs').expect(401);
    expect(none.body.error).toBe('Missing or invalid Authorization header');
    const bad = await request(app).get('/api/designs').set(bearer('eyJhbGciOiJIUzI1NiJ9.e30.x')).expect(401);
    expect(bad.body.error).toBe('Invalid or expired token');
  });
});

describe('managing tokens', () => {
  test('creates a token (shown once), lists it without the secret, and revokes it', async () => {
    const created = await request(app).post('/api/tokens').set(bearer(guest.jwt)).send({ name: 'SAP A4H' }).expect(201);
    expect(created.body.token).toMatch(/^zpd_/);
    expect(created.headers['cache-control']).toBe('no-store');

    const list = await request(app).get('/api/tokens').set(bearer(guest.jwt)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBe('SAP A4H');
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);
    expect(list.body.items[0]).not.toHaveProperty('token');
    expect(list.body.items[0]).not.toHaveProperty('tokenHash');

    await request(app).delete(`/api/tokens/${created.body.id}`).set(bearer(guest.jwt)).expect(204);
    await request(app).get('/api/designs').set(bearer(created.body.token)).expect(401);
  });

  test('validates the name and the id', async () => {
    await request(app).post('/api/tokens').set(bearer(guest.jwt)).send({ name: '' }).expect(400);
    await request(app).post('/api/tokens').set(bearer(guest.jwt)).send({}).expect(400);
    await request(app).delete('/api/tokens/abc').set(bearer(guest.jwt)).expect(400);
    await request(app).delete('/api/tokens/999999').set(bearer(guest.jwt)).expect(404);
  });

  test('needs a signed-in session', async () => {
    await request(app).get('/api/tokens').expect(401);
    await request(app).post('/api/tokens').send({ name: 'x' }).expect(401);
  });

  test("a user cannot see or revoke another user's token", async () => {
    const aliceToken = await newToken(owner);
    const list = await request(app).get('/api/tokens').set(bearer(guest.jwt)).expect(200);
    expect(list.body.items).toHaveLength(0);
    await request(app).delete(`/api/tokens/${owner.tokenId}`).set(bearer(guest.jwt)).expect(404);
    await request(app).get('/api/designs').set(bearer(aliceToken)).expect(200);   // still valid
  });

  test('a token cannot manage tokens', async () => {
    const token = await newToken(guest);
    await request(app).get('/api/tokens').set(bearer(token)).expect(403);
    await request(app).post('/api/tokens').set(bearer(token)).send({ name: 'minted' }).expect(403);
    await request(app).delete(`/api/tokens/${guest.tokenId}`).set(bearer(token)).expect(403);
  });
});

describe('using a token (what the SAP does)', () => {
  test('reads only the designs of the token owner (Bearer)', async () => {
    await request(app).post('/api/designs').set(bearer(owner.jwt)).send({ name: 'owner-label', ...payload }).expect(201);
    await request(app).post('/api/designs').set(bearer(guest.jwt)).send({ name: 'guest-label', ...payload }).expect(201);

    const guestToken = await newToken(guest);
    const res = await request(app).get('/api/designs').set(bearer(guestToken)).expect(200);
    expect(res.body.items.map((d: { name: string }) => d.name)).toEqual(['guest-label']);
  });

  test('works with HTTP Basic, the token as password (SM59 destination)', async () => {
    const guestToken = await newToken(guest);
    const created = await request(app).post('/api/designs').set(bearer(guest.jwt)).send({ name: 'g1', ...payload }).expect(201);
    const list = await request(app).get('/api/designs').set(basic('whatever', guestToken)).expect(200);
    expect(list.body.items).toHaveLength(1);
    const one = await request(app).get(`/api/designs/${created.body.designId}`).set(basic('guilherme', guestToken)).expect(200);
    expect(one.body.version.zpl).toBe(payload.zpl);
  });

  test('cannot read the design of someone else', async () => {
    const created = await request(app).post('/api/designs').set(bearer(owner.jwt)).send({ name: 'secret', ...payload }).expect(201);
    const guestToken = await newToken(guest);
    await request(app).get(`/api/designs/${created.body.designId}`).set(bearer(guestToken)).expect(404);
  });

  test('reads the published templates', async () => {
    await request(app).post('/api/templates').set(bearer(owner.jwt)).send({ name: 'Picking', description: 'd', ...payload }).expect(201);
    const guestToken = await newToken(guest);
    const list = await request(app).get('/api/templates').set(bearer(guestToken)).expect(200);
    expect(list.body.items.map((t: { name: string }) => t.name)).toEqual(['Picking']);
    expect(list.body.canManage).toBe(false);
  });

  test('is read-only: any write is refused, even for the owner', async () => {
    const ownerToken = await newToken(owner);
    await request(app).post('/api/designs').set(bearer(ownerToken)).send({ name: 'x', ...payload }).expect(403);
    await request(app).post('/api/templates').set(bearer(ownerToken)).send({ name: 'X', description: '', ...payload }).expect(403);
    await request(app).patch('/api/templates/1').set(bearer(ownerToken)).send({ description: 'y' }).expect(403);
    await request(app).delete('/api/templates/1').set(bearer(ownerToken)).expect(403);
    await request(app).delete('/api/designs/1').set(bearer(ownerToken)).expect(403);
    await request(app).post('/api/preview').set(bearer(ownerToken)).send({ zpl: payload.zpl, labelWidth: 800, labelHeight: 1200 }).expect(403);
    await request(app).post('/api/generate-zpl').set(bearer(ownerToken)).send({ labelWidth: 800, labelHeight: 1200, elements: [] }).expect(403);
  });

  test("an owner's token never turns into owner permissions", async () => {
    const ownerToken = await newToken(owner);
    const list = await request(app).get('/api/templates').set(bearer(ownerToken)).expect(200);
    expect(list.body.canManage).toBe(true); // it is still read-only: only GETs get through
    const res = await request(app).post('/api/templates').set(bearer(ownerToken)).send({ name: 'X', description: '', ...payload });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('API tokens are read-only');
  });

  test('a revoked, unknown or expired token gets a clear 401', async () => {
    const token = await newToken(guest);
    await request(app).delete(`/api/tokens/${guest.tokenId}`).set(bearer(guest.jwt)).expect(204);
    const revoked = await request(app).get('/api/designs').set(bearer(token)).expect(401);
    expect(revoked.body.error).toBe('Invalid or revoked API token');
    const unknown = await request(app).get('/api/designs').set(bearer('zpd_notarealtoken')).expect(401);
    expect(unknown.body.error).toBe('Invalid or revoked API token');
  });

  test('stops at the user: deleting the user kills the token', async () => {
    const token = await newToken(guest);
    await getDb().delete(usersTable).where(eq(usersTable.username, 'guilherme'));
    await request(app).get('/api/designs').set(bearer(token)).expect(401);
  });
});

describe('credentials stay out of the logs', () => {
  test('the redaction paths hide Authorization, Cookie and Set-Cookie', () => {
    const lines: string[] = [];
    const log = pino({ redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } }, { write: (s: string) => { lines.push(s); } });
    log.info({
      req: { headers: { authorization: 'Bearer zpd_SECRET', cookie: 'zpl_refresh=SECRETREFRESH', host: 'x' } },
      res: { headers: { 'set-cookie': 'zpl_refresh=SECRETREFRESH2' } },
    }, 'request completed');
    const out = lines.join('');
    expect(out).not.toContain('zpd_SECRET');
    expect(out).not.toContain('SECRETREFRESH');
    expect(out).toContain('[redacted]');
    expect(out).toContain('"host":"x"');
  });
});
