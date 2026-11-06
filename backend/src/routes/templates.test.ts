process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, templatesTable, usersTable } from '../db/schema';
import { TEMPLATE_CATEGORIES } from '../templates/categories';

const payload = { zpl: '^XA^FO10,10^A0N,30,30^FDX^FS^XZ', elements: [], labelWidth: 800, labelHeight: 1200 };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let admin: string;
let guest: string;

async function signUp(username: string): Promise<string> {
  await request(app).post('/api/auth/register').send({ username, password: 'password123' }).expect(201);
  const res = await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200);
  return res.body.token;
}

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  admin = await signUp('sinosbyte');
  guest = await signUp('guilherme');
  await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.username, 'sinosbyte'));
});

afterAll(async () => { await _resetDb(); });

const list = async (token: string) => (await request(app).get('/api/templates').set(bearer(token)).expect(200)).body.items;

describe('template categories', () => {
  test('a template published without a category goes to "outros"', async () => {
    await request(app).post('/api/templates').set(bearer(admin)).send({ name: 'Sem categoria', description: '', ...payload }).expect(201);
    expect(await list(guest)).toEqual([expect.objectContaining({ name: 'Sem categoria', category: 'outros' })]);
  });

  test('a template can be published with a category, and every user sees it', async () => {
    await request(app).post('/api/templates').set(bearer(admin)).send({ name: 'Pick', description: '', category: 'picking', ...payload }).expect(201);
    expect(await list(guest)).toEqual([expect.objectContaining({ name: 'Pick', category: 'picking' })]);
    const id = (await list(guest))[0].id;
    const detail = await request(app).get(`/api/templates/${id}`).set(bearer(guest)).expect(200);
    expect(detail.body.category).toBe('picking');
  });

  test('every category in the list is accepted; an unknown one is rejected', async () => {
    for (const category of TEMPLATE_CATEGORIES) {
      await request(app).post('/api/templates').set(bearer(admin)).send({ name: `T ${category}`, description: '', category, ...payload }).expect(201);
    }
    expect(await list(admin)).toHaveLength(TEMPLATE_CATEGORIES.length);
    await request(app).post('/api/templates').set(bearer(admin)).send({ name: 'Bad', description: '', category: 'inventado', ...payload }).expect(400);
  });

  test('the admin can change the category; replacing the label keeps it', async () => {
    await request(app).post('/api/templates').set(bearer(admin)).send({ name: 'T', description: '', category: 'estoque', ...payload }).expect(201);
    const id = (await list(admin))[0].id;
    // replace the label only: the category stays
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ payload }).expect(200);
    expect((await list(admin))[0].category).toBe('estoque');
    // change the category only: the name stays
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ category: 'patrimonio' }).expect(200);
    expect(await list(admin)).toEqual([expect.objectContaining({ name: 'T', category: 'patrimonio' })]);
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ category: 'inventado' }).expect(400);
  });

  test('permissions are unchanged: a regular user cannot publish, change or delete', async () => {
    await request(app).post('/api/templates').set(bearer(guest)).send({ name: 'X', description: '', category: 'picking', ...payload }).expect(403);
    await request(app).post('/api/templates').set(bearer(admin)).send({ name: 'T', description: '', ...payload }).expect(201);
    const id = (await list(guest))[0].id;
    await request(app).patch(`/api/templates/${id}`).set(bearer(guest)).send({ category: 'picking' }).expect(403);
    await request(app).delete(`/api/templates/${id}`).set(bearer(guest)).expect(403);
    await request(app).delete(`/api/templates/${id}`).set(bearer(admin)).expect(204);
    expect(await list(guest)).toEqual([]);
  });
});

describe('migration 0005', () => {
  test('the category column exists with the default, so existing rows stay valid', async () => {
    // a row written without a category (as before the migration) reads back as "outros"
    await getDb().insert(templatesTable).values({
      name: 'Antigo', zpl: payload.zpl, elementsJson: [], labelWidth: 800, labelHeight: 1200,
    });
    expect(await list(guest)).toEqual([expect.objectContaining({ name: 'Antigo', category: 'outros' })]);
  });
});
