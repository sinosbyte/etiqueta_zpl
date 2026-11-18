process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, usersTable } from '../db/schema';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^FO10,10^A0N,30,30^FD{{UC}}^FS^XZ', labelWidth: 800, labelHeight: 600 };

const text = (page?: number) => ({
  id: 'a', type: 'text', x: 10, y: 10, width: 200, height: 40, value: '{{CLIENTE}}', fontSize: 30, fontName: '0',
  ...(page === undefined ? {} : { page }),
});

// A table with every property it has
const fullTable = {
  id: 't1', type: 'table', page: 1, x: 40, y: 100, width: 600, height: 0,
  columns: [
    { header: 'Material', field: 'MATERIAL', width: 160, align: 'L' },
    { header: 'Descricao', field: 'DESCRICAO', width: 330, align: 'L' },
    { header: 'Qtd', field: 'QTD', width: 110, align: 'R' },
  ],
  rowHeight: 50, headerRow: false, rowsPerPage: 4, cellPadding: 8, thickness: 3,
  fontName: 'A', fontSize: 28, fontWidth: 20,
};

const twoPages = {
  pages: [{ mode: 'first' }, { mode: 'repeat' }],
  records: [
    { MATERIAL: '100', DESCRICAO: 'Bala de banana', QTD: '5' },
    { MATERIAL: '101', DESCRICAO: 'Bala de leite', QTD: '10' },
  ],
};

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

const create = (name: string, body: object) => request(app).post('/api/designs').set(bearer(jwt)).send({ name, ...base, ...body });
const version = async (designId: number, n: number) =>
  (await request(app).get(`/api/designs/${designId}/versions/${n}`).set(bearer(jwt)).expect(200)).body;
const put = (id: number, n: number, body: object) => request(app).put(`/api/designs/${id}/versions/${n}`).set(bearer(jwt)).send({ ...base, ...body });

describe('a design saved before pages existed', () => {
  test('is saved without pagesConfig and read back as one page, its elements untouched', async () => {
    const elements = [text()];
    const id = (await create('Old', { elements }).expect(201)).body.designId;
    const v = await version(id, 1);
    expect(v.pagesConfig).toBeNull();
    expect(v.elements).toEqual(elements);
    expect(v.elements[0]).not.toHaveProperty('page');
  });

  test('a version row written without the column (as every old one) reads without errors, by version and by design', async () => {
    const db = getDb();
    const [design] = await db.insert(designsTable).values({ userId: (await db.select().from(usersTable))[0].id, name: 'Legacy' }).returning();
    await db.insert(designVersionsTable).values({
      designId: design.id, versionNumber: 1, zpl: base.zpl, elementsJson: [text()] as object[], labelWidth: 800, labelHeight: 600,
    });
    expect((await version(design.id, 1)).pagesConfig).toBeNull();
    const whole = (await request(app).get(`/api/designs/${design.id}`).set(bearer(jwt)).expect(200)).body;
    expect(whole.version.pagesConfig).toBeNull();
    expect(whole.version.sampleValues).toEqual({});
  });

  test('pagesConfig: null on a new design is the same as leaving it out', async () => {
    const id = (await create('Null', { elements: [text()], pagesConfig: null }).expect(201)).body.designId;
    expect((await version(id, 1)).pagesConfig).toBeNull();
  });
});

describe('a design of two pages', () => {
  test('keeps both pages, their modes, the elements on each and the records', async () => {
    const elements = [text(0), fullTable];
    const id = (await create('Two', { elements, pagesConfig: twoPages }).expect(201)).body.designId;
    const v = await version(id, 1);
    expect(v.pagesConfig).toEqual(twoPages);
    expect(v.pagesConfig.pages.map((p: { mode: string }) => p.mode)).toEqual(['first', 'repeat']);
    expect(v.elements.map((e: { page?: number }) => e.page)).toEqual([0, 1]);
    expect(v.elements).toEqual(elements);
  });

  test('a table comes back with every property, columns in order', async () => {
    const id = (await create('Table', { elements: [text(0), fullTable], pagesConfig: { pages: twoPages.pages } }).expect(201)).body.designId;
    const [, table] = (await version(id, 1)).elements;
    expect(table).toEqual(fullTable);
    expect(table.columns.map((c: { field: string }) => c.field)).toEqual(['MATERIAL', 'DESCRICAO', 'QTD']);
    expect(table.columns[2]).toEqual({ header: 'Qtd', field: 'QTD', width: 110, align: 'R' });
  });

  test('the records keep their order, and a config without records reads back without them', async () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ MATERIAL: String(i), DESCRICAO: `D${i}` }));
    const a = (await create('A', { elements: [fullTable], pagesConfig: { pages: twoPages.pages, records } }).expect(201)).body.designId;
    expect((await version(a, 1)).pagesConfig.records).toEqual(records);
    const b = (await create('B', { elements: [fullTable], pagesConfig: { pages: twoPages.pages } }).expect(201)).body.designId;
    expect((await version(b, 1)).pagesConfig).toEqual({ pages: twoPages.pages });
  });

  test('is the same when the latest version of the design is opened', async () => {
    const id = (await create('Latest', { elements: [text(0), fullTable], pagesConfig: twoPages }).expect(201)).body.designId;
    const whole = (await request(app).get(`/api/designs/${id}`).set(bearer(jwt)).expect(200)).body;
    expect(whole.version.pagesConfig).toEqual(twoPages);
  });

  test('a new version has its own pages; the older one is not touched', async () => {
    const id = (await create('Versions', { elements: [text(0), fullTable], pagesConfig: twoPages }).expect(201)).body.designId;
    await request(app).post(`/api/designs/${id}/versions`).set(bearer(jwt)).send({ ...base, elements: [text()] }).expect(201);
    expect((await version(id, 1)).pagesConfig).toEqual(twoPages);
    expect((await version(id, 2)).pagesConfig).toBeNull();
  });

  test('is whole after the connection to the database is closed and opened again', async () => {
    const elements = [text(0), fullTable];
    const id = (await create('Reopen', { elements, pagesConfig: twoPages }).expect(201)).body.designId;
    await _resetDb();
    await initDb();
    const v = await version(id, 1);
    expect(v.pagesConfig).toEqual(twoPages);
    expect(v.elements).toEqual(elements);
  });
});

describe('overwriting a version (PUT)', () => {
  const setup = async () => {
    const id = (await create('Put', { elements: [text(0), fullTable], pagesConfig: twoPages }).expect(201)).body.designId;
    return id as number;
  };

  test('leaving pagesConfig out keeps the saved one, while the rest is replaced', async () => {
    const id = await setup();
    const res = await put(id, 1, { elements: [text(0), { ...fullTable, rowsPerPage: 2 }] }).expect(200);
    expect(res.body.pagesConfig).toEqual(twoPages);
    const v = await version(id, 1);
    expect(v.pagesConfig).toEqual(twoPages);
    expect(v.elements[1].rowsPerPage).toBe(2);
  });

  test('sending a new pagesConfig replaces it', async () => {
    const id = await setup();
    const next = { pages: twoPages.pages, records: [{ MATERIAL: '900', DESCRICAO: 'Novo', QTD: '1' }] };
    await put(id, 1, { elements: [text(0), fullTable], pagesConfig: next }).expect(200);
    expect((await version(id, 1)).pagesConfig).toEqual(next);
  });

  test('null takes the design back to one page, and only null does', async () => {
    const id = await setup();
    await put(id, 1, { elements: [text()], pagesConfig: null }).expect(200);
    expect((await version(id, 1)).pagesConfig).toBeNull();
  });

  test('a PUT that leaves pagesConfig out on a design that never had one keeps it at one page', async () => {
    const id = (await create('One', { elements: [text()] }).expect(201)).body.designId;
    await put(id, 1, { elements: [text(), { ...text(), id: 'b' }] }).expect(200);
    expect((await version(id, 1)).pagesConfig).toBeNull();
  });

  test('an element on page 2 is accepted when the saved design has two pages, refused when it has one', async () => {
    const two = await setup();
    await put(two, 1, { elements: [text(0), text(1)] }).expect(200);
    const one = (await create('OnePage', { elements: [text()] }).expect(201)).body.designId;
    await put(one, 1, { elements: [text(1)] }).expect(400);
    expect((await version(one, 1)).elements[0]).not.toHaveProperty('page');
  });

  test('a failed overwrite changes nothing', async () => {
    const id = await setup();
    await put(id, 1, { elements: [text(0)], pagesConfig: { pages: [{ mode: 'first' }, { mode: 'first' }] } }).expect(400);
    const v = await version(id, 1);
    expect(v.pagesConfig).toEqual(twoPages);
    expect(v.elements).toHaveLength(2);
  });
});

describe('what is refused', () => {
  const bad: [string, object][] = [
    ['three pages', { pagesConfig: { pages: [{ mode: 'first' }, { mode: 'repeat' }, { mode: 'repeat' }] } }],
    ['no page', { pagesConfig: { pages: [] } }],
    ['a first page that repeats', { pagesConfig: { pages: [{ mode: 'repeat' }] } }],
    ['a second page that is not repeat', { pagesConfig: { pages: [{ mode: 'first' }, { mode: 'first' }] } }],
    ['an unknown mode', { pagesConfig: { pages: [{ mode: 'once' }] } }],
    ['a config that is not an object', { pagesConfig: 'two' }],
    ['more than 500 records', { pagesConfig: { pages: [{ mode: 'first' }], records: Array.from({ length: 501 }, () => ({ A: 'x' })) } }],
    ['a record field with a space', { pagesConfig: { pages: [{ mode: 'first' }], records: [{ 'A B': 'x' }] } }],
    ['a record value over 255 characters', { pagesConfig: { pages: [{ mode: 'first' }], records: [{ A: 'x'.repeat(256) }] } }],
    ['an element on page 3', { elements: [{ ...text(), page: 2 }] }],
    ['an element on page 2 with no config', { elements: [text(1)] }],
    ['an element on page 2 with a one-page config', { elements: [text(1)], pagesConfig: { pages: [{ mode: 'first' }] } }],
    ['a table with a column that has no valid field', { elements: [{ ...fullTable, columns: [{ header: 'x', field: 'a b', width: 10, align: 'L' }] }] }],
    ['a table that holds 51 records', { elements: [{ ...fullTable, rowsPerPage: 51 }] }],
  ];

  test.each(bad)('a new design with %s', async (_name, patch) => {
    await create('Bad', { elements: [text()], ...patch }).expect(400);
    expect(await getDb().select().from(designsTable)).toHaveLength(0);
  });

  test('a new version with an element on page 2 and no config', async () => {
    const id = (await create('V', { elements: [text()] }).expect(201)).body.designId;
    await request(app).post(`/api/designs/${id}/versions`).set(bearer(jwt)).send({ ...base, elements: [text(1)] }).expect(400);
  });
});

describe('migration 0007', () => {
  const drizzleDir = path.join(__dirname, '..', '..', 'drizzle');
  const migration = fs.readFileSync(path.join(drizzleDir, '0007_design_pages_config.sql'), 'utf8');
  const snapshot = async () => (await getDb().execute(sql`
    SELECT id, design_id, version_number, zpl, elements_json, label_width, label_height, sample_values, created_at
    FROM design_versions ORDER BY id`)).rows;

  test('is in the journal, and every migration file is', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
    const tags = journal.entries.map(e => e.tag).sort();
    const files = fs.readdirSync(drizzleDir).filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, '')).sort();
    expect(tags).toEqual(files);
    expect(journal.entries[journal.entries.length - 1].tag).toBe('0009_labelary_quota');
  });

  test('adds one empty jsonb column and nothing else', async () => {
    const cols = (await getDb().execute(sql`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'design_versions' AND column_name = 'pages_config'`)).rows;
    expect(cols).toEqual([{ column_name: 'pages_config', data_type: 'jsonb', is_nullable: 'YES' }]);
  });

  test('applied to a table that already has versions, it leaves every one of them as it was (and again is harmless)', async () => {
    await create('Existing', { elements: [text()], sampleValues: { UC: '1' } }).expect(201);
    await create('Existing 2', { elements: [text(0), fullTable], sampleValues: { UC: '2' }, pagesConfig: twoPages }).expect(201);
    const db = getDb();
    try {
      await db.execute(sql`ALTER TABLE design_versions DROP COLUMN pages_config`);  // the table as it was before 0007
      const before = await snapshot();
      expect(before).toHaveLength(2);

      await db.execute(sql.raw(migration));
      expect(await snapshot()).toEqual(before);
      const filled = (await db.execute(sql`SELECT pages_config FROM design_versions`)).rows;
      expect(filled.every(r => r.pages_config === null)).toBe(true);

      await db.execute(sql.raw(migration));  // run twice: no error, no change
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.execute(sql`ALTER TABLE design_versions ADD COLUMN IF NOT EXISTS pages_config jsonb`);
    }
    const id = (await db.select().from(designsTable))[0].id;
    expect((await version(id, 1)).pagesConfig).toBeNull();
  });
});
