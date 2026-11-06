process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, usersTable } from '../db/schema';

const base = { zpl: '^XA^FO10,10^A0N,30,30^FD{{UC}}^FS^XZ', elements: [], labelWidth: 800, labelHeight: 1200 };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let jwt: string;

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await request(app).post('/api/auth/register').send({ username: 'alice', password: 'password123' }).expect(201);
  jwt = (await request(app).post('/api/auth/login').send({ username: 'alice', password: 'password123' }).expect(200)).body.token;
});

afterAll(async () => { await _resetDb(); });

const version = async (designId: number, n: number) =>
  (await request(app).get(`/api/designs/${designId}/versions/${n}`).set(bearer(jwt)).expect(200)).body;

describe('sample values saved with a design version', () => {
  test('are saved with the design and come back when it is opened', async () => {
    const created = await request(app).post('/api/designs').set(bearer(jwt))
      .send({ name: 'D', ...base, sampleValues: { UC: '00385007041000067434', LOTE: 'L1' } }).expect(201);
    expect((await version(created.body.designId, 1)).sampleValues).toEqual({ UC: '00385007041000067434', LOTE: 'L1' });
  });

  test('a version saved without them (every one before this change) reads back as empty', async () => {
    const created = await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'D', ...base }).expect(201);
    expect((await version(created.body.designId, 1)).sampleValues).toEqual({});
  });

  test('each version keeps its own, and a new version can change them', async () => {
    const id = (await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'D', ...base, sampleValues: { UC: '1' } }).expect(201)).body.designId;
    await request(app).post(`/api/designs/${id}/versions`).set(bearer(jwt)).send({ ...base, sampleValues: { UC: '2' } }).expect(201);
    expect((await version(id, 1)).sampleValues).toEqual({ UC: '1' });
    expect((await version(id, 2)).sampleValues).toEqual({ UC: '2' });
  });

  test('overwriting a version replaces them; leaving them out keeps the saved ones', async () => {
    const id = (await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'D', ...base, sampleValues: { UC: '1' } }).expect(201)).body.designId;
    await request(app).put(`/api/designs/${id}/versions/1`).set(bearer(jwt)).send({ ...base }).expect(200);
    expect((await version(id, 1)).sampleValues).toEqual({ UC: '1' });
    await request(app).put(`/api/designs/${id}/versions/1`).set(bearer(jwt)).send({ ...base, sampleValues: { UC: '9' } }).expect(200);
    expect((await version(id, 1)).sampleValues).toEqual({ UC: '9' });
    await request(app).put(`/api/designs/${id}/versions/1`).set(bearer(jwt)).send({ ...base, sampleValues: {} }).expect(200);
    expect((await version(id, 1)).sampleValues).toEqual({});
  });

  test('invalid values are rejected: odd variable names, long values, too many', async () => {
    await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'A', ...base, sampleValues: { 'bad name': 'x' } }).expect(400);
    await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'B', ...base, sampleValues: { UC: 'x'.repeat(256) } }).expect(400);
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`V${i}`, 'x']));
    await request(app).post('/api/designs').set(bearer(jwt)).send({ name: 'C', ...base, sampleValues: many }).expect(400);
  });
});
