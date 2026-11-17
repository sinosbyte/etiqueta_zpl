import { generatePageZpl, generateZpl, pageCountOf } from './generator';
import { ElementSchema, PagesSchema } from './schema';
import { Element, GenerateRequest } from './types';

const text = (id: string, extra: Partial<Element> = {}): Element =>
  ({ id, type: 'text', x: 50, y: 50, width: 200, height: 40, value: id, fontSize: 30, fontName: '0', ...extra });

const table = (extra: Partial<Element> = {}): Element => ({
  id: 't', type: 'table', x: 40, y: 100, width: 0, height: 0,
  columns: [
    { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' },
    { header: 'Descricao', field: 'DESCRICAO', width: 300, align: 'L' },
    { header: 'Qtd', field: 'QTD', width: 100, align: 'R' },
  ],
  ...extra,
});

const req = (elements: Element[], extra: Partial<GenerateRequest> = {}): GenerateRequest =>
  ({ labelWidth: 800, labelHeight: 600, elements, ...extra });

const blocks = (zpl: string) => zpl.split('\n^XA').map((b, i) => (i === 0 ? b : '^XA' + b));

describe('pages: a design with one page stays the one label it always was', () => {
  const one = [text('a'), text('b', { x: 100 })];

  test('elements without a page, with page 0, and a one-page config give the same ZPL', () => {
    const base = generateZpl(req(one));
    expect(generateZpl(req(one.map(e => ({ ...e, page: 0 }))))).toBe(base);
    expect(generateZpl(req(one, { pages: [{ mode: 'first' }] }))).toBe(base);
    expect(base.match(/\^XA/g)).toHaveLength(1);
    expect(base.match(/\^XZ/g)).toHaveLength(1);
  });

  test('no elements is still an empty label', () => {
    expect(generateZpl(req([]))).toBe('^XA\n^PW800\n^LL600\n^XZ');
  });

  test('pageCountOf counts the configured pages or the highest page used', () => {
    expect(pageCountOf(req([]))).toBe(1);
    expect(pageCountOf(req(one))).toBe(1);
    expect(pageCountOf(req(one, { pages: [{ mode: 'first' }, { mode: 'repeat' }] }))).toBe(2);
    expect(pageCountOf(req([text('a', { page: 1 })]))).toBe(2);
  });
});

describe('pages: one label (^XA ... ^XZ) for each page', () => {
  const two = req([text('first', { page: 0 }), text('second', { page: 1, x: 70 })], { pages: [{ mode: 'first' }, { mode: 'repeat' }] });

  test('each page has its own label, in order, with the label size', () => {
    const zpl = generateZpl(two);
    const [a, b] = blocks(zpl);
    expect(zpl.match(/\^XA/g)).toHaveLength(2);
    expect(zpl.match(/\^XZ/g)).toHaveLength(2);
    expect(a).toContain('^FDfirst^FS');
    expect(a).not.toContain('second');
    expect(b).toContain('^FO70,50');
    expect(b).toContain('^FDsecond^FS');
    expect(b).not.toContain('first');
    for (const block of [a, b]) {
      expect(block).toMatch(/^\^XA\n\^PW800\n\^LL600\n/);
      expect(block).toMatch(/\^XZ$/);
    }
  });

  test('the order of the elements inside a page is kept', () => {
    const zpl = generateZpl(req([text('p1b', { page: 1 }), text('p0', { page: 0 }), text('p1a', { page: 1 })]));
    expect(zpl.indexOf('p1b')).toBeLessThan(zpl.indexOf('p1a'));
    expect(zpl.indexOf('p0')).toBeLessThan(zpl.indexOf('p1b'));
  });

  test('a page with no element is an empty label, and a config with two pages is two labels', () => {
    const zpl = generateZpl(req([text('only')], { pages: [{ mode: 'first' }, { mode: 'repeat' }] }));
    expect(blocks(zpl)[1]).toBe('^XA\n^PW800\n^LL600\n^XZ');
  });

  test('the font of ^CF is written again in each label', () => {
    const cf = (id: string, page: number) => text(id, { page, fontSource: 'cf' });
    const [a, b] = blocks(generateZpl(req([cf('x', 0), cf('y', 1)])));
    expect(a).toContain('^CF0,30');
    expect(b).toContain('^CF0,30');
  });

  test('generatePageZpl gives one page alone', () => {
    expect(generatePageZpl(two, 1)).toBe(blocks(generateZpl(two))[1]);
    expect(generatePageZpl(two, 0)).toBe(blocks(generateZpl(two))[0]);
  });
});

describe('table: drawn with ^GB lines and one ^FD per cell', () => {
  test('a table with the defaults: header and one record', () => {
    const lines = generateZpl(req([table()])).split('\n');
    // outer box, the line under the header, the two lines between the columns
    expect(lines).toContain('^FO40,100^GB600,80,2^FS');
    expect(lines).toContain('^FO40,140^GB600,2,2^FS');
    expect(lines).toContain('^FO240,100^GB2,80,2^FS');
    expect(lines).toContain('^FO540,100^GB2,80,2^FS');
    // header cells: title, font 0 size 24, centered in the 40 dot row, inside the 6 dot padding
    expect(lines).toContain('^FO46,108^A0N,24,24^FB188,1,0,L,0^FDMaterial^FS');
    expect(lines).toContain('^FO246,108^A0N,24,24^FB288,1,0,L,0^FDDescricao^FS');
    expect(lines).toContain('^FO546,108^A0N,24,24^FB88,1,0,R,0^FDQtd^FS');
    // the record: the variable of each column
    expect(lines).toContain('^FO46,148^A0N,24,24^FB188,1,0,L,0^FD{{MATERIAL}}^FS');
    expect(lines).toContain('^FO246,148^A0N,24,24^FB288,1,0,L,0^FD{{DESCRICAO}}^FS');
    expect(lines).toContain('^FO546,148^A0N,24,24^FB88,1,0,R,0^FD{{QTD}}^FS');
    expect(lines.filter(l => l.includes('^GB'))).toHaveLength(4);
    expect(lines.filter(l => l.includes('^FD'))).toHaveLength(6);
  });

  test('a table that holds several records numbers its variables', () => {
    const lines = generateZpl(req([table({ rowsPerPage: 3 })])).split('\n');
    expect(lines).toContain('^FO40,100^GB600,160,2^FS');  // header + 3 rows of 40
    for (const n of [1, 2, 3]) {
      expect(lines.some(l => l.endsWith(`^FD{{MATERIAL_${n}}}^FS`))).toBe(true);
      expect(lines.some(l => l.endsWith(`^FD{{QTD_${n}}}^FS`))).toBe(true);
    }
    expect(lines.some(l => l.includes('{{MATERIAL}}'))).toBe(false);
    // header line + 3 lines between the 4 rows + ... = box, 3 horizontal, 2 vertical
    expect(lines.filter(l => l.includes('^GB'))).toHaveLength(1 + 3 + 2);
  });

  test('row height, padding, font and border follow the element', () => {
    const lines = generateZpl(req([table({ rowHeight: 60, cellPadding: 10, fontName: 'A', fontSize: 30, fontWidth: 20, thickness: 4 })])).split('\n');
    expect(lines).toContain('^FO40,100^GB600,120,4^FS');
    expect(lines).toContain('^FO50,115^AAN,30,20^FB180,1,0,L,0^FDMaterial^FS');
  });

  test('without a header row there are only the record rows', () => {
    const lines = generateZpl(req([table({ headerRow: false })])).split('\n');
    expect(lines).toContain('^FO40,100^GB600,40,2^FS');
    expect(lines.some(l => l.includes('Material'))).toBe(false);
    expect(lines).toContain('^FO46,108^A0N,24,24^FB188,1,0,L,0^FD{{MATERIAL}}^FS');
  });

  test('a border of 0 draws no lines, only the cells', () => {
    const lines = generateZpl(req([table({ thickness: 0 })])).split('\n');
    expect(lines.some(l => l.includes('^GB'))).toBe(false);
    expect(lines.filter(l => l.includes('^FD'))).toHaveLength(6);
  });

  test('a table with no column prints nothing', () => {
    expect(generateZpl(req([table({ columns: [] })]))).toBe('^XA\n^PW800\n^LL600\n^XZ');
    expect(generateZpl(req([table({ columns: undefined })]))).toBe('^XA\n^PW800\n^LL600\n^XZ');
  });

  test('positions are whole dots, and ^ and ~ never reach a title', () => {
    const lines = generateZpl(req([table({
      x: 40.4, y: 100.6,
      columns: [{ header: 'A^B~C', field: 'F', width: 100.4, align: 'C' }],
    })])).split('\n');
    expect(lines).toContain('^FO40,101^GB100,80,2^FS');
    expect(lines.some(l => l.endsWith('^FDA B C^FS'))).toBe(true);
    expect(lines.some(l => l.includes('^FB88,1,0,C,0'))).toBe(true);
  });

  test('the table goes on the page it belongs to, and coexists with other elements', () => {
    const zpl = generateZpl(req([text('title', { page: 0 }), table({ page: 1 })]));
    const [a, b] = blocks(zpl);
    expect(a).toContain('^FDtitle^FS');
    expect(a).not.toContain('^GB');
    expect(b).toContain('^GB600,80,2');
    expect(b).not.toContain('title');
  });

  test('no line of a table gets near the 255 characters the SAP accepts', () => {
    const wide = table({ columns: [{ header: 'H'.repeat(60), field: 'F'.repeat(60), width: 9000, align: 'L' }], rowsPerPage: 50 });
    for (const line of generateZpl(req([wide])).split('\n')) expect(line.length).toBeLessThan(255);
  });
});

describe('schema: the new fields reach the generator (Zod drops what it does not list)', () => {
  const full = {
    ...table({ page: 1, rowHeight: 50, headerRow: false, rowsPerPage: 4, cellPadding: 8 }),
  };

  test('a table element keeps all of its fields', () => {
    const parsed = ElementSchema.parse(full);
    expect(parsed).toEqual(full);
  });

  test('a text element on page 0 or 1', () => {
    expect(ElementSchema.parse(text('a', { page: 0 })).page).toBe(0);
    expect(ElementSchema.parse(text('a', { page: 1 })).page).toBe(1);
    expect(ElementSchema.parse(text('a')).page).toBeUndefined();
  });

  test.each([
    ['page 2', { page: 2 }],
    ['page -1', { page: -1 }],
    ['page 0.5', { page: 0.5 }],
    ['no column', { columns: [] }],
    ['13 columns', { columns: Array.from({ length: 13 }, () => ({ header: 'h', field: 'F', width: 10, align: 'L' })) }],
    ['a field with a space', { columns: [{ header: 'h', field: 'MAT ERIAL', width: 10, align: 'L' }] }],
    ['an empty field', { columns: [{ header: 'h', field: '', width: 10, align: 'L' }] }],
    ['a field of 61 characters', { columns: [{ header: 'h', field: 'F'.repeat(61), width: 10, align: 'L' }] }],
    ['a column of width 0', { columns: [{ header: 'h', field: 'F', width: 0, align: 'L' }] }],
    ['an unknown alignment', { columns: [{ header: 'h', field: 'F', width: 10, align: 'J' }] }],
    ['a header of 61 characters', { columns: [{ header: 'h'.repeat(61), field: 'F', width: 10, align: 'L' }] }],
    ['rowsPerPage 0', { rowsPerPage: 0 }],
    ['rowsPerPage 51', { rowsPerPage: 51 }],
    ['rowHeight 7', { rowHeight: 7 }],
    ['cellPadding -1', { cellPadding: -1 }],
  ])('rejects %s', (_name, patch) => {
    expect(ElementSchema.safeParse({ ...full, ...patch }).success).toBe(false);
  });

  test('an old element (no new field) is still valid and unchanged', () => {
    const old = { id: 'a', type: 'text', x: 1, y: 2, width: 3, height: 4, value: 'v', fontSize: 30 };
    expect(ElementSchema.parse(old)).toEqual(old);
  });

  test('the config of the pages: first, then repeat, at most two', () => {
    expect(PagesSchema.safeParse([{ mode: 'first' }]).success).toBe(true);
    expect(PagesSchema.safeParse([{ mode: 'first' }, { mode: 'repeat' }]).success).toBe(true);
    expect(PagesSchema.safeParse([]).success).toBe(false);
    expect(PagesSchema.safeParse([{ mode: 'repeat' }]).success).toBe(false);
    expect(PagesSchema.safeParse([{ mode: 'first' }, { mode: 'first' }]).success).toBe(false);
    expect(PagesSchema.safeParse([{ mode: 'first' }, { mode: 'repeat' }, { mode: 'repeat' }]).success).toBe(false);
    expect(PagesSchema.safeParse([{ mode: 'once' }]).success).toBe(false);
  });
});
