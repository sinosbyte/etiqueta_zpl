import express from 'express';
import request from 'supertest';
import { generateZpl } from './generator';
import { zplRouter } from '../routes/zpl';

// Only the ZPL router: no database and no login needed
const app = express();
app.use(express.json());
app.use('/api', zplRouter);

const col = { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' };
const table = (page: number, rowsPerPage: number, id = `t${page}`) =>
  ({ id, type: 'table', x: 40, y: 100, width: 0, height: 0, page, rowsPerPage, columns: [col] });
const text = { id: 'a', type: 'text', x: 50, y: 50, width: 200, height: 40, value: 'Hello', fontSize: 30, fontName: '0' };
const base = { labelWidth: 800, labelHeight: 600 };
const two = [{ mode: 'first' }, { mode: 'repeat' }];

describe('POST /api/generate-zpl with pages and tables', () => {
  test('a request from before pages existed gives the same ZPL as the generator', async () => {
    const body = { ...base, elements: [text] };
    const res = await request(app).post('/api/generate-zpl').send(body).expect(200);
    expect(res.body.zpl).toBe(generateZpl(body as never));
    expect(res.body.zpl.match(/\^XA/g)).toHaveLength(1);
  });

  test('two pages give two labels, and the table is written', async () => {
    const res = await request(app).post('/api/generate-zpl')
      .send({ ...base, pages: two, elements: [{ ...text, page: 0 }, table(1, 2)] }).expect(200);
    expect(res.body.zpl.match(/\^XA/g)).toHaveLength(2);
    expect(res.body.zpl).toContain('^FD{{MATERIAL_2}}^FS');
  });

  test.each([
    ['three pages', { pages: [...two, { mode: 'repeat' }] }],
    ['the first page set to repeat', { pages: [{ mode: 'repeat' }] }],
    ['an element on page 2', { elements: [{ ...text, page: 2 }] }],
    ['a table with a bad field name', { elements: [{ ...table(0, 1), columns: [{ ...col, field: 'a b' }] }] }],
  ])('rejects %s', async (_name, patch) => {
    await request(app).post('/api/generate-zpl').send({ ...base, elements: [text], ...patch }).expect(400);
  });
});

describe('POST /api/expand-zpl', () => {
  const records = Array.from({ length: 10 }, (_, i) => ({ MATERIAL: `M${i + 1}` }));

  test('shares 10 records among the labels', async () => {
    const res = await request(app).post('/api/expand-zpl')
      .send({ ...base, pages: two, records, values: { CLIENTE: 'ACME' }, elements: [table(0, 2), table(1, 4)] }).expect(200);
    expect(res.body.labels.map((l: { recordCount: number }) => l.recordCount)).toEqual([2, 4, 4]);
    expect(res.body.totalRecords).toBe(10);
    expect(res.body.unplaced).toBe(0);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.zpl).toContain('^FDM10^FS');
  });

  test('a design without tables and records gives its one label', async () => {
    const res = await request(app).post('/api/expand-zpl').send({ ...base, elements: [text] }).expect(200);
    expect(res.body.labels).toHaveLength(1);
    expect(res.body.labels[0].zpl).toBe(generateZpl({ ...base, elements: [text] } as never));
  });

  test('two tables on one page: 400 with the reason', async () => {
    const res = await request(app).post('/api/expand-zpl')
      .send({ ...base, pages: two, records, elements: [table(0, 1), table(0, 1, 'other')] }).expect(400);
    expect(res.body.error).toMatch(/more than one table/);
  });

  test.each([
    ['more than 500 records', { records: Array.from({ length: 501 }, () => ({ MATERIAL: 'x' })) }],
    ['a field name with a space', { records: [{ 'MAT ERIAL': 'x' }] }],
    ['a value of 256 characters', { records: [{ MATERIAL: 'x'.repeat(256) }] }],
    ['values that are not text', { values: { CLIENTE: 5 } }],
  ])('rejects %s', async (_name, patch) => {
    await request(app).post('/api/expand-zpl').send({ ...base, elements: [text], ...patch }).expect(400);
  });
});
