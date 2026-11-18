import express from 'express';
import request from 'supertest';
import { generateZpl } from './generator';
import { parseZpl } from './parser';
import { zplRouter } from '../routes/zpl';

/**
 * ZPL with two or more ^XA...^XZ blocks pasted into a design of one page (Etapa 1, item 1.3).
 *
 * These tests pin down what the parser does TODAY; they do not say it is the ideal behavior. The
 * parser treats ^XA and ^XZ only as "close the open field", so the blocks are not kept apart:
 *  - every element of every block lands on the one page, in order, with the coordinates it had;
 *  - nothing is dropped, but the block structure (and so the number of labels) is lost;
 *  - ^PW and ^LL are read from every block, so the last block decides the label size;
 *  - the elements of the second block print over those of the first when the ZPL is generated again.
 * If one day the parser learns to read blocks as pages, these are the tests to change on purpose.
 */

const block = (w: number, h: number, body: string) => `^XA^PW${w}^LL${h}${body}^XZ`;
const text = (x: number, y: number, value: string) => `^FO${x},${y}^A0N,30,30^FD${value}^FS`;

const PAGE1 = block(800, 600, text(10, 10, 'PAGE1') + text(10, 60, 'P1-LINE2'));
const PAGE2 = block(800, 600, text(10, 10, 'PAGE2'));
const TWO = `${PAGE1}\n${PAGE2}`;

const values = (zpl: string) => parseZpl(zpl).elements.filter(e => e.type === 'text').map(e => e.value);
const count = (zpl: string, re: RegExp) => (zpl.match(re) ?? []).length;

describe('parseZpl with several ^XA...^XZ blocks', () => {
  test('keeps every element of every block, in order, with its coordinates', () => {
    const r = parseZpl(TWO);
    expect(r.elements.map(e => [e.type, e.x, e.y, e.value])).toEqual([
      ['text', 10, 10, 'PAGE1'],
      ['text', 10, 60, 'P1-LINE2'],
      ['text', 10, 10, 'PAGE2'],
    ]);
    expect(r.unknownCommands).toEqual([]);
  });

  test('does not tell the blocks apart: no element is put on a second page', () => {
    const r = parseZpl(TWO);
    expect(r.elements.every(e => e.page === undefined)).toBe(true);
  });

  test('a block with the same size as the first one keeps the label size', () => {
    const r = parseZpl(TWO);
    expect([r.labelWidth, r.labelHeight]).toEqual([800, 600]);
  });

  test('LIMITATION: with different sizes the last block decides and the first size is lost', () => {
    const r = parseZpl(`${PAGE1}\n${block(400, 300, text(10, 10, 'SMALL'))}`);
    expect([r.labelWidth, r.labelHeight]).toEqual([400, 300]);
    expect(values(`${PAGE1}\n${block(400, 300, text(10, 10, 'SMALL'))}`)).toEqual(['PAGE1', 'P1-LINE2', 'SMALL']);
  });

  test('three blocks are as flat as two', () => {
    const r = parseZpl(`${PAGE1}\n${PAGE2}\n${block(800, 600, text(10, 10, 'PAGE3'))}`);
    expect(r.elements).toHaveLength(4);
    expect(values(`${PAGE1}\n${PAGE2}\n${block(800, 600, text(10, 10, 'PAGE3'))}`)).toEqual(['PAGE1', 'P1-LINE2', 'PAGE2', 'PAGE3']);
  });

  test('a field left open at ^XZ is closed there and does not swallow the next block', () => {
    const r = parseZpl(`^XA^PW800^LL600^FO10,10^A0N,30,30^FDOPEN^XZ\n${PAGE2}`);
    const written = r.elements.map(e => e.value);
    expect(written).toContain('PAGE2');
    expect(r.elements.find(e => e.value === 'PAGE2')).toMatchObject({ type: 'text', x: 10, y: 10 });
  });

  test('a block with no ^XZ before the next ^XA still separates the fields', () => {
    expect(values('^XA^FO10,10^A0N,30,30^FDA^FS\n^XA^FO10,50^A0N,30,30^FDB^FS^XZ')).toEqual(['A', 'B']);
  });

  test('^PQ of each block stays as a raw element (kept, but no longer tied to its label)', () => {
    const r = parseZpl(`^XA${text(10, 10, 'A')}^PQ3^XZ\n^XA${text(10, 10, 'B')}^PQ2^XZ`);
    expect(r.elements.filter(e => e.type === 'raw').map(e => e.value)).toEqual(['^PQ3', '^PQ2']);
  });

  test('a ^CI28 in the first block becomes a raw element and applies to the whole generated label', () => {
    const r = parseZpl(`^XA^CI28${text(10, 10, 'A')}^XZ\n${PAGE2}`);
    expect(r.elements.find(e => e.type === 'raw')?.value).toBe('^CI28');
  });
});

describe('generating again after reading several blocks', () => {
  const regenerate = (zpl: string) => {
    const r = parseZpl(zpl);
    return generateZpl({ labelWidth: r.labelWidth, labelHeight: r.labelHeight, elements: r.elements });
  };

  test('LIMITATION: the blocks become ONE label (one ^XA/^XZ), so a second label disappears', () => {
    const out = regenerate(TWO);
    expect(count(TWO, /\^XA/g)).toBe(2);
    expect(count(out, /\^XA/g)).toBe(1);
    expect(count(out, /\^XZ/g)).toBe(1);
  });

  test('every field of every block is still in the generated ZPL, at the same coordinates', () => {
    const out = regenerate(TWO);
    expect(out).toContain('^FO10,10^A0N,30,30^FDPAGE1^FS');
    expect(out).toContain('^FO10,60^A0N,30,30^FDP1-LINE2^FS');
    expect(out).toContain('^FO10,10^A0N,30,30^FDPAGE2^FS');
  });

  test('LIMITATION: the first fields of both blocks share the same position, so they print over each other', () => {
    const out = regenerate(TWO);
    expect(count(out, /\^FO10,10\^/g)).toBe(2);
  });

  test('a ZPL of one block goes through unchanged: the same fields, one label', () => {
    const out = regenerate(PAGE1);
    expect(count(out, /\^XA/g)).toBe(1);
    expect(out).toContain('^FDPAGE1^FS');
    expect(out).toContain('^FDP1-LINE2^FS');
    expect(values(out)).toEqual(['PAGE1', 'P1-LINE2']);
  });
});

describe('POST /api/parse-zpl with several blocks', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', zplRouter);

  test('answers 200 with the flat list of elements and no error', async () => {
    const res = await request(app).post('/api/parse-zpl').send({ zpl: TWO }).expect(200);
    expect(res.body.elements).toHaveLength(3);
    expect(res.body.labelWidth).toBe(800);
    expect(res.body.unknownCommands).toEqual([]);
  });

  test('the answer says nothing about the number of blocks (the editor cannot warn from it)', async () => {
    const res = await request(app).post('/api/parse-zpl').send({ zpl: TWO }).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['elements', 'labelHeight', 'labelWidth', 'unknownCommands']);
  });
});
