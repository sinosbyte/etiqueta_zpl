process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, templatesTable, usersTable } from '../db/schema';

const text = (page?: number) => ({
  id: 'a', type: 'text', x: 10, y: 10, width: 200, height: 40, value: 'x', fontSize: 30, fontName: '0',
  ...(page === undefined ? {} : { page }),
});
const payload = { zpl: '^XA^FO10,10^A0N,30,30^FDX^FS^XZ', elements: [text()], labelWidth: 800, labelHeight: 600 };
const twoPages = { pages: [{ mode: 'first' }, { mode: 'repeat' }] };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let admin: string;

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await request(app).post('/api/auth/register').send({ username: 'sinosbyte', password: 'password123' }).expect(201);
  admin = (await request(app).post('/api/auth/login').send({ username: 'sinosbyte', password: 'password123' }).expect(200)).body.token;
  await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.username, 'sinosbyte'));
});

afterAll(async () => { await _resetDb(); });

const post = (body: object) => request(app).post('/api/templates').set(bearer(admin)).send({ name: 'T', description: '', ...payload, ...body });
const count = async () => (await getDb().select().from(templatesTable)).length;

describe('a template is one page', () => {
  test('a one-page design is published as always, with or without a page field on its elements', async () => {
    await post({}).expect(201);
    await post({ name: 'T2', elements: [text(0)] }).expect(201);
    await post({ name: 'T3', pagesConfig: null }).expect(201);
    await post({ name: 'T4', pagesConfig: { pages: [{ mode: 'first' }] } }).expect(201);
    expect(await count()).toBe(4);
  });

  test.each([
    ['a configuration with two pages', { pagesConfig: twoPages }],
    ['an element on the second page', { elements: [text(0), text(1)] }],
    ['an element on the second page with no configuration', { elements: [text(1)] }],
    ['two pages with their test records', { pagesConfig: { ...twoPages, records: [{ A: '1' }] } }],
  ])('refuses to publish %s, and nothing is stored', async (_name, patch) => {
    await post(patch).expect(400);
    expect(await count()).toBe(0);
  });

  test('replacing a template (PATCH) with a design of two pages is refused as well, and the template stays as it was', async () => {
    await post({}).expect(201);
    const id = (await getDb().select().from(templatesTable))[0].id;
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ payload: { ...payload, pagesConfig: twoPages } }).expect(400);
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ payload: { ...payload, elements: [text(1)] } }).expect(400);
    const row = (await getDb().select().from(templatesTable))[0];
    expect(row.elementsJson).toEqual([text()]);
    // one page still replaces it
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ payload: { ...payload, elements: [text(), { ...text(), id: 'b' }] } }).expect(200);
    expect((await getDb().select().from(templatesTable))[0].elementsJson).toHaveLength(2);
  });

  test('renaming or recategorising does not need a payload and is not affected', async () => {
    await post({}).expect(201);
    const id = (await getDb().select().from(templatesTable))[0].id;
    await request(app).patch(`/api/templates/${id}`).set(bearer(admin)).send({ name: 'Renamed', category: 'picking' }).expect(200);
  });

  test('the configuration is never stored with a template', async () => {
    await post({ pagesConfig: { pages: [{ mode: 'first' }], records: [{ A: '1' }] } }).expect(201);
    const row = (await getDb().select().from(templatesTable))[0] as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('records');
  });
});
