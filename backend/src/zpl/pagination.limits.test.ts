import express from 'express';
import request from 'supertest';
import { generatePageZpl } from './generator';
import {
  EXPAND_TOO_LARGE, EXPAND_TOO_MANY_LABELS, ExpandError, MAX_EXPAND_LABELS, MAX_EXPAND_ZPL_CHARS, expandLabels,
} from './pagination';
import { Element } from './types';
import { zplRouter } from '../routes/zpl';

/**
 * Limits of one expansion (Etapa 1, item 1.2): the number of labels and the characters of ZPL they add
 * up to. What was supported before must still come out as it did.
 */

const base = { labelWidth: 800, labelHeight: 600 };
const two = [{ mode: 'first' as const }, { mode: 'repeat' as const }];
const col = { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' as const };
const table = (page: number, rowsPerPage: number): Element =>
  ({ id: `t${page}`, type: 'table', x: 40, y: 100, width: 0, height: 0, page, rowsPerPage, columns: [col] });
const text: Element = { id: 'a', type: 'text', x: 50, y: 50, width: 200, height: 40, value: 'Hello', fontSize: 30, fontName: '0' };
const image = (page: number, hexChars: number): Element =>
  ({ id: `i${page}`, type: 'image', x: 0, y: 0, width: 64, height: 64, page, value: 'F'.repeat(hexChars) });
const records = (n: number) => Array.from({ length: n }, (_, i) => ({ MATERIAL: `M${i}` }));

describe('number of labels', () => {
  test('the limit is the most a valid request can ask for: 500 records and the first label', () => {
    expect(MAX_EXPAND_LABELS).toBe(501);
  });

  test('501 labels (the first one and 500 records of one per label) are worked out', () => {
    const r = expandLabels({ ...base, pages: two, elements: [text, table(1, 1)], records: records(500) });
    expect(r.labels).toHaveLength(501);
    expect(r.unplaced).toBe(0);
    expect(r.labels[500].zpl).toContain('^FDM499^FS');
  });

  test('one more is refused with a clear message, and nothing is half done', () => {
    const run = () => expandLabels({ ...base, pages: two, elements: [text, table(1, 1)], records: records(501) });
    expect(run).toThrow(ExpandError);
    expect(run).toThrow(EXPAND_TOO_MANY_LABELS);
  });

  test('records that need fewer labels are not counted as labels: 501 records in tables of 3 are fine', () => {
    const r = expandLabels({ ...base, pages: two, elements: [text, table(1, 3)], records: records(501) });
    expect(r.labels).toHaveLength(1 + 167);
  });
});

describe('size of the ZPL', () => {
  const heavy = [image(1, 100_000), table(1, 1)];
  const oneLabel = generatePageZpl({ ...base, pages: two, elements: [text, ...heavy] }, 1).length;
  const fit = Math.floor(MAX_EXPAND_ZPL_CHARS / oneLabel);

  test('a label as large as the biggest ZPL the app takes can repeat about a hundred times', () => {
    expect(oneLabel).toBeGreaterThan(100_000);
    expect(fit).toBeGreaterThanOrEqual(90);
  });

  test('up to the limit it works, and the answer is the same as without a limit would be', () => {
    const r = expandLabels({ ...base, pages: two, elements: [text, ...heavy], records: records(fit - 1) });
    expect(r.labels).toHaveLength(fit);
    expect(r.zpl.length).toBeLessThanOrEqual(MAX_EXPAND_ZPL_CHARS + r.labels.length);   // + the line breaks between labels
    expect(r.labels.every(l => l.zpl.startsWith('^XA'))).toBe(true);
  });

  test('past the limit it is refused with a clear message', () => {
    const run = () => expandLabels({ ...base, pages: two, elements: [text, ...heavy], records: records(fit + 20) });
    expect(run).toThrow(ExpandError);
    expect(run).toThrow(EXPAND_TOO_LARGE);
  });

  test('it stops as soon as the limit is passed instead of building every label first', () => {
    const t0 = Date.now();
    expect(() => expandLabels({ ...base, pages: two, elements: [text, ...heavy], records: records(500) })).toThrow(EXPAND_TOO_LARGE);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test('a design of one page, with or without records, is far from the limit', () => {
    expect(expandLabels({ ...base, elements: [text] }).labels).toHaveLength(1);
    const typical = expandLabels({ ...base, pages: two, elements: [text, table(0, 2), table(1, 5)], records: records(500) });
    expect(typical.labels.length).toBeGreaterThan(90);
    expect(typical.zpl.length).toBeLessThan(MAX_EXPAND_ZPL_CHARS / 10);
  });
});

describe('POST /api/expand-zpl', () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', zplRouter);

  test('answers 400 with the message of the limit, and the editor can translate it', async () => {
    const res = await request(app).post('/api/expand-zpl')
      .send({ ...base, pages: two, elements: [text, image(1, 100_000), table(1, 1)], records: records(150) })
      .expect(400);
    expect(res.body.error).toBe(EXPAND_TOO_LARGE);
  });

  test('the same design with few records still answers 200 with the usual shape', async () => {
    const res = await request(app).post('/api/expand-zpl')
      .send({ ...base, pages: two, elements: [text, image(1, 100_000), table(1, 1)], records: records(5) })
      .expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['labels', 'totalRecords', 'unplaced', 'warnings', 'zpl']);
    expect(res.body.labels).toHaveLength(6);
  });

  test('more than 500 records is still stopped by the schema, before the limit of labels', async () => {
    await request(app).post('/api/expand-zpl')
      .send({ ...base, pages: two, elements: [text, table(1, 1)], records: records(501) })
      .expect(400);
  });
});
