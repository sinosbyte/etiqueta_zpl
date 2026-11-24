process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { sql } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, designTestVariantsTable, usersTable, companiesTable, apiTokensTable } from '../db/schema';

/**
 * Fase 05, etapa 2: a design belongs to a company. Every user of the company reaches it (list, open, save a version,
 * rename, delete, variants); another company does not; the name is unique inside the company. Integration tokens read
 * the designs of the company of their owner.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^FO10,10^A0N,30,30^FD{{UC}}^FS^XZ', elements: [], labelWidth: 800, labelHeight: 600 };
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

const jwt: Record<string, string> = {};
async function signUp(username: string): Promise<string> {
  await request(app).post('/api/auth/register').send({ username, password: 'password123' }).expect(201);
  jwt[username] = (await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200)).body.token;
  return jwt[username];
}
/** Puts `who` in the company of `of` (what the administration of users will do in a later stage) */
async function joinCompany(who: string, of: string) {
  await run(sql`UPDATE users SET company_id = (SELECT company_id FROM users WHERE username = ${of}) WHERE username = ${who}`);
}
const design = (token: string, name: string) => request(app).post('/api/designs').set(bearer(token)).send({ name, ...base });
const list = async (token: string) => (await request(app).get('/api/designs').set(bearer(token)).expect(200)).body.items.map((d: any) => d.name).sort();

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  const db = getDb();
  await db.delete(designTestVariantsTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(apiTokensTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
  for (const u of ['alice', 'bob', 'carol']) await signUp(u);
  await joinCompany('bob', 'alice');              // alice and bob: one company; carol: another
});
afterAll(async () => { await _resetDb(); });

describe('inside the company', () => {
  test('a colleague lists the designs of the company, whoever created them', async () => {
    await design(jwt.alice, 'Da Alice').expect(201);
    await design(jwt.bob, 'Do Bob').expect(201);
    expect(await list(jwt.alice)).toEqual(['Da Alice', 'Do Bob']);
    expect(await list(jwt.bob)).toEqual(['Da Alice', 'Do Bob']);
  });

  test('a colleague opens it, saves a new version, changes a version, renames and deletes it', async () => {
    const id = (await design(jwt.alice, 'Remessa').expect(201)).body.designId;
    await request(app).get(`/api/designs/${id}`).set(bearer(jwt.bob)).expect(200);
    await request(app).get(`/api/designs/${id}/versions/1`).set(bearer(jwt.bob)).expect(200);
    await request(app).post(`/api/designs/${id}/versions`).set(bearer(jwt.bob)).send(base).expect(201);
    await request(app).put(`/api/designs/${id}/versions/1`).set(bearer(jwt.bob)).send({ ...base, labelWidth: 640 }).expect(200);
    expect((await request(app).get(`/api/designs/${id}/versions/1`).set(bearer(jwt.alice)).expect(200)).body.labelWidth).toBe(640);
    expect((await request(app).get(`/api/designs/${id}/versions`).set(bearer(jwt.bob)).expect(200)).body.items).toHaveLength(2);
    await request(app).patch(`/api/designs/${id}`).set(bearer(jwt.bob)).send({ name: 'Remessa nova' }).expect(200);
    expect(await list(jwt.alice)).toEqual(['Remessa nova']);
    await request(app).delete(`/api/designs/${id}`).set(bearer(jwt.bob)).expect(204);
    expect(await list(jwt.alice)).toEqual([]);
  });

  test('the design keeps who created it, and belongs to the company', async () => {
    const id = (await design(jwt.bob, 'Do Bob').expect(201)).body.designId;
    const [d] = await rows(sql`SELECT d.user_id, d.company_id, b.id AS bob_id, a.company_id AS company FROM designs d, users b, users a WHERE d.id = ${id} AND b.username = 'bob' AND a.username = 'alice'`);
    expect(d.user_id).toBe(d.bob_id);
    expect(d.company_id).toBe(d.company);
  });

  test('the name is unique inside the company: a colleague cannot take it, nor rename to it', async () => {
    await design(jwt.alice, 'Remessa').expect(201);
    await design(jwt.bob, 'Remessa').expect(409);
    const other = (await design(jwt.bob, 'Outra').expect(201)).body.designId;
    await request(app).patch(`/api/designs/${other}`).set(bearer(jwt.alice)).send({ name: 'Remessa' }).expect(409);
    await design(jwt.alice, 'Remessa').expect(409);                      // same user: as before
  });

  test('colleagues share the variants of a design too', async () => {
    const id = (await design(jwt.alice, 'Remessa').expect(201)).body.designId;
    const v = (await request(app).post(`/api/designs/${id}/variants`).set(bearer(jwt.bob)).send({ name: 'Cenario', sampleValues: { UC: '1' } }).expect(201)).body;
    expect((await request(app).get(`/api/designs/${id}/variants`).set(bearer(jwt.alice)).expect(200)).body.items.map((x: any) => x.name)).toEqual(['Cenario']);
    await request(app).patch(`/api/designs/${id}/variants/${v.id}`).set(bearer(jwt.alice)).send({ name: 'Cenario 2' }).expect(200);
    await request(app).delete(`/api/designs/${id}/variants/${v.id}`).set(bearer(jwt.bob)).expect(204);
  });
});

describe('another company', () => {
  test('sees nothing of it: list, open, versions, save, rename, delete and variants answer as if it did not exist', async () => {
    const id = (await design(jwt.alice, 'Remessa').expect(201)).body.designId;
    expect(await list(jwt.carol)).toEqual([]);
    await request(app).get(`/api/designs/${id}`).set(bearer(jwt.carol)).expect(404);
    // the list of versions of a design that is not theirs is empty, as it always was (it does not say whether the design exists)
    expect((await request(app).get(`/api/designs/${id}/versions`).set(bearer(jwt.carol)).expect(200)).body).toMatchObject({ items: [], total: 0 });
    await request(app).get(`/api/designs/${id}/versions/1`).set(bearer(jwt.carol)).expect(404);
    await request(app).post(`/api/designs/${id}/versions`).set(bearer(jwt.carol)).send(base).expect(404);
    await request(app).put(`/api/designs/${id}/versions/1`).set(bearer(jwt.carol)).send(base).expect(404);
    await request(app).patch(`/api/designs/${id}`).set(bearer(jwt.carol)).send({ name: 'X' }).expect(404);
    await request(app).delete(`/api/designs/${id}`).set(bearer(jwt.carol)).expect(404);
    await request(app).get(`/api/designs/${id}/variants`).set(bearer(jwt.carol)).expect(404);
    await request(app).post(`/api/designs/${id}/variants`).set(bearer(jwt.carol)).send({ name: 'V' }).expect(404);
    expect(await list(jwt.alice)).toEqual(['Remessa']);                  // and nothing was touched
  });

  test('can use the same name for its own design', async () => {
    await design(jwt.alice, 'Remessa').expect(201);
    await design(jwt.carol, 'Remessa').expect(201);
    expect(await list(jwt.carol)).toEqual(['Remessa']);
  });

  test('a user who leaves the company loses the access at once (the login token carries no company)', async () => {
    const id = (await design(jwt.alice, 'Remessa').expect(201)).body.designId;
    await request(app).get(`/api/designs/${id}`).set(bearer(jwt.bob)).expect(200);
    await run(sql`UPDATE users SET company_id = (SELECT company_id FROM users WHERE username = 'carol') WHERE username = 'bob'`);
    await request(app).get(`/api/designs/${id}`).set(bearer(jwt.bob)).expect(404);
    expect(await list(jwt.bob)).toEqual([]);
  });

  test('a user of a company other than the creator who moves in later sees the designs from then on', async () => {
    await design(jwt.alice, 'Remessa').expect(201);
    expect(await list(jwt.carol)).toEqual([]);
    await joinCompany('carol', 'alice');
    expect(await list(jwt.carol)).toEqual(['Remessa']);
  });
});

describe('integration tokens (SAP)', () => {
  async function tokenOf(who: string): Promise<string> {
    return (await request(app).post('/api/tokens').set(bearer(jwt[who])).send({ name: 'SAP' }).expect(201)).body.token;
  }

  test('a token reads the designs of the company of its owner', async () => {
    await design(jwt.alice, 'Da Alice').expect(201);
    const id = (await design(jwt.bob, 'Do Bob').expect(201)).body.designId;
    const token = await tokenOf('bob');
    expect((await request(app).get('/api/designs').set(bearer(token)).expect(200)).body.items.map((d: any) => d.name).sort()).toEqual(['Da Alice', 'Do Bob']);
    await request(app).get(`/api/designs/${id}/versions/1`).set(bearer(token)).expect(200);
  });

  test('a token of another company sees nothing, and a token is still read only', async () => {
    const id = (await design(jwt.alice, 'Da Alice').expect(201)).body.designId;
    const carolToken = await tokenOf('carol');
    expect((await request(app).get('/api/designs').set(bearer(carolToken)).expect(200)).body.items).toEqual([]);
    await request(app).get(`/api/designs/${id}/versions/1`).set(bearer(carolToken)).expect(404);
    const bobToken = await tokenOf('bob');
    await request(app).post('/api/designs').set(bearer(bobToken)).send({ name: 'X', ...base }).expect(403);
    await request(app).delete(`/api/designs/${id}`).set(bearer(bobToken)).expect(403);
  });
});

describe('what stays personal', () => {
  test('integration tokens: a colleague does not see the tokens of another', async () => {
    await request(app).post('/api/tokens').set(bearer(jwt.alice)).send({ name: 'Da Alice' }).expect(201);
    expect((await request(app).get('/api/tokens').set(bearer(jwt.bob)).expect(200)).body.items).toEqual([]);
  });

  test('the login token still carries only the user, and an unknown user id reaches no design', async () => {
    const payload = JSON.parse(Buffer.from(jwt.alice.split('.')[1], 'base64').toString());
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'userId', 'username']);
    const { listDesigns } = await import('./designsService');
    await design(jwt.alice, 'Remessa').expect(201);
    expect((await listDesigns(987654, { limit: 50, offset: 0 })).items).toEqual([]);
  });
});
