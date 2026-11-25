process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, designTestVariantsTable, usersTable } from '../db/schema';
import { MAX_VARIANTS_PER_DESIGN } from '../designs/variantsService';
import { registerUser } from '../auth/authService';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^FO10,10^A0N,30,30^FD{{UC}}^FS^XZ', elements: [], labelWidth: 800, labelHeight: 600 };

let alice: string;
let bob: string;
let designA: number;
let designB: number;

async function login(username: string): Promise<string> {
  await registerUser(username, 'password123');
  return (await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200)).body.token;
}

beforeAll(async () => { await initDb(); });

beforeEach(async () => {
  const db = getDb();
  await db.delete(designTestVariantsTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  alice = await login('alice');
  bob = await login('bob');
  designA = (await request(app).post('/api/designs').set(bearer(alice)).send({ name: 'Remessa', ...base }).expect(201)).body.designId;
  designB = (await request(app).post('/api/designs').set(bearer(alice)).send({ name: 'Outro', ...base }).expect(201)).body.designId;
});

afterAll(async () => { await _resetDb(); });

const url = (d: number, v?: string) => `/api/designs/${d}/variants${v ? `/${v}` : ''}`;
const make = (d: number, body: object, token = alice) => request(app).post(url(d)).set(bearer(token)).send(body);
const records = [
  { MATERIAL: 'M3', DESCRICAO: 'Terceiro', QTD: '3' },
  { MATERIAL: 'M1', DESCRICAO: 'Primeiro', QTD: '' },
  { MATERIAL: 'M2', DESCRICAO: 'Segundo', QTD: '2' },
];

describe('saving', () => {
  test('values only', async () => {
    const r = await make(designA, { name: 'Remessa 1', sampleValues: { UC: '123', CLIENTE: 'ACME' } }).expect(201);
    expect(r.body).toMatchObject({ name: 'Remessa 1', sampleValues: { UC: '123', CLIENTE: 'ACME' }, records: [], recordCount: 0, valueCount: 2 });
    expect(r.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.createdAt).toBeTruthy();
    expect(r.body.updatedAt).toBeTruthy();
  });

  test('table records only, keeping the order and the empty fields', async () => {
    const r = await make(designA, { name: 'Itens', records }).expect(201);
    const back = (await request(app).get(url(designA, r.body.id)).set(bearer(alice)).expect(200)).body;
    expect(back.records).toEqual(records);
    expect(back.records.map((x: { MATERIAL: string }) => x.MATERIAL)).toEqual(['M3', 'M1', 'M2']);
    expect(back.records[1].QTD).toBe('');
    expect(back.sampleValues).toEqual({});
  });

  test('values and records together', async () => {
    const r = await make(designA, { name: 'Tudo', sampleValues: { UC: '9' }, records }).expect(201);
    const back = (await request(app).get(url(designA, r.body.id)).set(bearer(alice)).expect(200)).body;
    expect(back.sampleValues).toEqual({ UC: '9' });
    expect(back.records).toEqual(records);
  });

  test('several variants of the same design are listed without their data, oldest first', async () => {
    await make(designA, { name: 'B', records }).expect(201);
    await make(designA, { name: 'A', sampleValues: { UC: '1' } }).expect(201);
    const list = (await request(app).get(url(designA)).set(bearer(alice)).expect(200)).body;
    expect(list.items.map((v: { name: string }) => v.name)).toEqual(['B', 'A']);
    expect(list.items[0]).toMatchObject({ recordCount: 3, valueCount: 0 });
    expect(list.items[0]).not.toHaveProperty('records');
    expect(list.max).toBe(MAX_VARIANTS_PER_DESIGN);
  });

  test('is rejected with a clear status when invalid', async () => {
    await make(designA, { name: '   ' }).expect(400);
    await make(designA, { name: 'x'.repeat(101) }).expect(400);
    await make(designA, { sampleValues: {} }).expect(400);
    await make(designA, { name: 'V', sampleValues: { 'bad name': '1' } }).expect(400);
    await make(designA, { name: 'V', records: Array.from({ length: 501 }, () => ({})) }).expect(400);
    await make(designA, { name: 'V', records: [{ A: 'x'.repeat(256) }] }).expect(400);
    expect((await request(app).get(url(designA)).set(bearer(alice))).body.items).toEqual([]);
  });

  test('a name is trimmed', async () => {
    const r = await make(designA, { name: '  Com espaços  ' }).expect(201);
    expect(r.body.name).toBe('Com espaços');
  });

  test('500 records of a few columns are accepted', async () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ MATERIAL: `M${i}`, DESCRICAO: 'Descrição '.repeat(5), QTD: String(i) }));
    const r = await make(designA, { name: 'Grande', records: big }).expect(201);
    expect(r.body.recordCount).toBe(500);
  });
});

describe('duplicate names', () => {
  test('the same name, in any case, is refused in the same design and nothing is overwritten', async () => {
    const first = await make(designA, { name: 'Remessa 1', sampleValues: { UC: '1' } }).expect(201);
    await make(designA, { name: 'remessa 1', sampleValues: { UC: '2' } }).expect(409);
    await make(designA, { name: ' REMESSA 1 ' }).expect(409);
    const back = (await request(app).get(url(designA, first.body.id)).set(bearer(alice))).body;
    expect(back.sampleValues).toEqual({ UC: '1' });
    expect((await request(app).get(url(designA)).set(bearer(alice))).body.items).toHaveLength(1);
  });

  test('another design may use the same name', async () => {
    await make(designA, { name: 'Remessa 1' }).expect(201);
    await make(designB, { name: 'Remessa 1' }).expect(201);
  });

  test('renaming to a name that exists is refused and keeps both', async () => {
    await make(designA, { name: 'Um' }).expect(201);
    const two = (await make(designA, { name: 'Dois' }).expect(201)).body;
    await request(app).patch(url(designA, two.id)).set(bearer(alice)).send({ name: 'um' }).expect(409);
    expect((await request(app).get(url(designA, two.id)).set(bearer(alice))).body.name).toBe('Dois');
  });

  test('renaming only the case of its own name is allowed', async () => {
    const v = (await make(designA, { name: 'um' }).expect(201)).body;
    const r = await request(app).patch(url(designA, v.id)).set(bearer(alice)).send({ name: 'Um' }).expect(200);
    expect(r.body.name).toBe('Um');
  });
});

describe('update, rename and delete', () => {
  test('updating the data keeps id, name and creation date, and moves the update date', async () => {
    const v = (await make(designA, { name: 'V', sampleValues: { UC: '1' }, records }).expect(201)).body;
    await new Promise(r => setTimeout(r, 15));
    const u = (await request(app).patch(url(designA, v.id)).set(bearer(alice))
      .send({ sampleValues: { UC: '2' }, records: [{ MATERIAL: 'X' }] }).expect(200)).body;
    expect(u).toMatchObject({ id: v.id, name: 'V', createdAt: v.createdAt, sampleValues: { UC: '2' }, records: [{ MATERIAL: 'X' }] });
    expect(new Date(u.updatedAt).getTime()).toBeGreaterThan(new Date(v.updatedAt).getTime());
  });

  test('renaming leaves the data alone', async () => {
    const v = (await make(designA, { name: 'V', sampleValues: { UC: '1' }, records }).expect(201)).body;
    const u = (await request(app).patch(url(designA, v.id)).set(bearer(alice)).send({ name: 'Novo' }).expect(200)).body;
    expect(u).toMatchObject({ name: 'Novo', sampleValues: { UC: '1' }, records });
  });

  test('a patch with nothing to change, or invalid, is a 400', async () => {
    const v = (await make(designA, { name: 'V' }).expect(201)).body;
    await request(app).patch(url(designA, v.id)).set(bearer(alice)).send({}).expect(400);
    await request(app).patch(url(designA, v.id)).set(bearer(alice)).send({ name: '' }).expect(400);
  });

  test('deleting removes only that variant and does not touch the design, its versions or the other variants', async () => {
    const keep = (await make(designA, { name: 'Fica', sampleValues: { UC: '1' } }).expect(201)).body;
    const gone = (await make(designA, { name: 'Sai' }).expect(201)).body;
    await request(app).delete(url(designA, gone.id)).set(bearer(alice)).expect(204);
    await request(app).get(url(designA, gone.id)).set(bearer(alice)).expect(404);
    await request(app).delete(url(designA, gone.id)).set(bearer(alice)).expect(404);
    expect((await request(app).get(url(designA, keep.id)).set(bearer(alice)).expect(200)).body.sampleValues).toEqual({ UC: '1' });
    const d = (await request(app).get(`/api/designs/${designA}`).set(bearer(alice)).expect(200)).body;
    expect(d.versionCount).toBe(1);
    expect(d.version.zpl).toBe(base.zpl);
  });

  test('deleting the design removes its variants', async () => {
    await make(designA, { name: 'V' }).expect(201);
    await request(app).delete(`/api/designs/${designA}`).set(bearer(alice)).expect(204);
    expect(await getDb().select().from(designTestVariantsTable)).toHaveLength(0);
  });
});

describe('persistence and isolation', () => {
  test('a variant is read back after a new login (another session) and does not depend on any design version', async () => {
    const v = (await make(designA, { name: 'V', sampleValues: { UC: '7' }, records }).expect(201)).body;
    // a new version of the design does not touch it
    await request(app).post(`/api/designs/${designA}/versions`).set(bearer(alice)).send(base).expect(201);
    const again = (await request(app).post('/api/auth/login').send({ username: 'alice', password: 'password123' }).expect(200)).body.token;
    const back = (await request(app).get(url(designA, v.id)).set(bearer(again)).expect(200)).body;
    expect(back).toMatchObject({ id: v.id, sampleValues: { UC: '7' }, records });
  });

  test('variants of one design are not seen in another design', async () => {
    const v = (await make(designA, { name: 'V' }).expect(201)).body;
    expect((await request(app).get(url(designB)).set(bearer(alice))).body.items).toEqual([]);
    await request(app).get(url(designB, v.id)).set(bearer(alice)).expect(404);
    await request(app).patch(url(designB, v.id)).set(bearer(alice)).send({ name: 'Y' }).expect(404);
    await request(app).delete(url(designB, v.id)).set(bearer(alice)).expect(404);
    await request(app).get(url(designA, v.id)).set(bearer(alice)).expect(200);
  });

  test('another user sees nothing and cannot change anything', async () => {
    const v = (await make(designA, { name: 'V', sampleValues: { UC: '1' } }).expect(201)).body;
    await request(app).get(url(designA)).set(bearer(bob)).expect(404);
    await request(app).get(url(designA, v.id)).set(bearer(bob)).expect(404);
    await make(designA, { name: 'Intruso' }, bob).expect(404);
    await request(app).patch(url(designA, v.id)).set(bearer(bob)).send({ name: 'X' }).expect(404);
    await request(app).delete(url(designA, v.id)).set(bearer(bob)).expect(404);
    expect((await request(app).get(url(designA, v.id)).set(bearer(alice))).body.name).toBe('V');
  });

  test('needs a login, and rejects bad ids', async () => {
    await request(app).get(url(designA)).expect(401);
    await request(app).get(url(0)).set(bearer(alice)).expect(400);
    await request(app).get(url(designA, 'not-a-uuid')).set(bearer(alice)).expect(400);
    await request(app).get(url(designA, '00000000-0000-4000-8000-000000000000')).set(bearer(alice)).expect(404);
    await request(app).get(url(99999)).set(bearer(alice)).expect(404);
  });
});

describe('limit', () => {
  test(`a design holds at most ${MAX_VARIANTS_PER_DESIGN} variants; the next is refused clearly`, async () => {
    const db = getDb();
    await db.insert(designTestVariantsTable).values(
      Array.from({ length: MAX_VARIANTS_PER_DESIGN }, (_, i) => ({ designId: designA, name: `V${i}` })),
    );
    const r = await make(designA, { name: 'Uma a mais' }).expect(409);
    expect(r.body.error).toMatch(/at most/);
    await make(designB, { name: 'Outro design' }).expect(201);
  });
});
