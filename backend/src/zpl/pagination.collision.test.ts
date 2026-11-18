import express from 'express';
import request from 'supertest';
import { expandLabels } from './pagination';
import { Element } from './types';
import { zplRouter } from '../routes/zpl';

/**
 * Etapa 3 (P6): a free variable with the name of a cell of the table of its page. The cell is printed and the value of
 * the variable is not used; that is how the markers have always been filled and it is kept as it is, but the answer now
 * says so with the warning 'variable-collision'. Nothing else about the expansion changes.
 */

const base = { labelWidth: 800, labelHeight: 600 };
const two = [{ mode: 'first' as const }, { mode: 'repeat' as const }];
const col = (field: string) => ({ header: field, field, width: 200, align: 'L' as const });
const table = (field: string, rowsPerPage: number, page?: number): Element =>
  ({ id: `t${page ?? 0}`, type: 'table', x: 40, y: 200, width: 0, height: 0, rowsPerPage, columns: [col(field)], ...(page !== undefined && { page }) });
const free = (value: string, page?: number, extra: Partial<Element> = {}): Element =>
  ({ id: `f${page ?? 0}`, type: 'text', x: 10, y: 10, width: 200, height: 40, value, fontSize: 30, fontName: '0', ...(page !== undefined && { page }), ...extra });
const rec = (field: string, ...values: string[]) => values.map(v => ({ [field]: v }));

/** What the free text prints on each label (its ^FD at y = 10). */
const printed = (r: ReturnType<typeof expandLabels>) =>
  r.labels.map(l => (l.zpl.match(/\^FO10,10\^A0N,30,30\^FD([^^]*)\^FS/) ?? [])[1] ?? null);

describe('the warning', () => {
  test('1. a free variable named like a cell (capacity 3): the cell is printed, the value is not used, and it is said', () => {
    const r = expandLabels({ ...base, elements: [free('{{PRODUTO_1}}'), table('PRODUTO', 3)], values: { PRODUTO_1: 'SAMPLE' }, records: rec('PRODUTO', 'P1', 'P2', 'P3') });
    expect(printed(r)).toEqual(['P1']);                       // the cell wins, as it always did
    expect(r.warnings).toEqual(['variable-collision']);
  });

  test('2. capacity 1: the cell has the plain name of the field', () => {
    const r = expandLabels({ ...base, elements: [free('{{MATERIAL}}'), table('MATERIAL', 1)], values: { MATERIAL: 'FIXO' }, records: rec('MATERIAL', 'M1') });
    expect(printed(r)).toEqual(['M1']);
    expect(r.warnings).toContain('variable-collision');
  });

  test('3. upper and lower case are the same name', () => {
    const r = expandLabels({ ...base, elements: [free('{{produto_2}}'), table('PRODUTO', 3)], values: { produto_2: 'x' }, records: rec('PRODUTO', 'P1', 'P2') });
    expect(printed(r)).toEqual(['P2']);
    expect(r.warnings).toContain('variable-collision');
  });

  test('4. a cell with no record on it still takes the place of the value (and the warning says so)', () => {
    const r = expandLabels({ ...base, elements: [free('{{PRODUTO_3}}'), table('PRODUTO', 3)], values: { PRODUTO_3: 'SAMPLE-3' }, records: rec('PRODUTO', 'P1') });
    expect(printed(r)).toEqual(['']);
    expect(r.warnings).toContain('variable-collision');
  });

  test('5. any kind of element that writes the marker counts: a dynamic field, a barcode, a QR code, text with the marker inside', () => {
    const kinds: Element[] = [
      free('', 0, { dynamic: true, variableName: 'PRODUTO_2' }),
      { id: 'b', type: 'barcode128', x: 10, y: 100, width: 268, height: 80, value: '{{PRODUTO_2}}', moduleWidth: 2 },
      { id: 'q', type: 'qrcode', x: 10, y: 100, width: 100, height: 100, value: 'https://x/{{PRODUTO_2}}' },
      free('Lote {{PRODUTO_2}} fim'),
    ];
    for (const el of kinds) {
      const r = expandLabels({ ...base, elements: [el, table('PRODUTO', 3)], values: {}, records: rec('PRODUTO', 'P1', 'P2') });
      expect(r.warnings).toContain('variable-collision');
    }
  });

  test('6. two pages: only the page that has the table collides, and only when that page prints', () => {
    const elements = [free('{{PRODUTO_1}}', 0), free('{{PRODUTO_1}}', 1, { id: 'g', y: 90 }), table('PRODUTO', 3, 1)];
    const withRecords = expandLabels({ ...base, pages: two, elements, values: { PRODUTO_1: 'FIXO' }, records: rec('PRODUTO', 'P1', 'P2', 'P3', 'P4') });
    expect(printed(withRecords)[0]).toBe('FIXO');                       // page 1: no table, its own value
    expect(withRecords.warnings).toContain('variable-collision');       // page 2: the cell
    // nothing reaches page 2: no label of it, so nothing is overwritten and nothing is said
    const without = expandLabels({ ...base, pages: two, elements, values: { PRODUTO_1: 'FIXO' }, records: [] });
    expect(without.labels).toHaveLength(1);
    expect(without.warnings).not.toContain('variable-collision');
  });
});

describe('no warning where there is nothing to say', () => {
  test('7. a free variable with another name, a table without free variables, and neither', () => {
    const records = rec('PRODUTO', 'P1', 'P2');
    expect(expandLabels({ ...base, elements: [free('{{UC}}'), table('PRODUTO', 3)], values: { UC: 'u' }, records }).warnings).toEqual([]);
    expect(expandLabels({ ...base, elements: [table('PRODUTO', 3)], records }).warnings).toEqual([]);
    expect(expandLabels({ ...base, elements: [free('{{UC}}')], values: { UC: 'u' } }).warnings).toEqual([]);
    expect(expandLabels({ ...base, elements: [free('plain')] }).warnings).toEqual([]);
  });

  test('8. the name of the field itself with a capacity above 1 is not a cell (it takes the first record, as always)', () => {
    const r = expandLabels({ ...base, elements: [free('{{PRODUTO}}'), table('PRODUTO', 3)], values: { PRODUTO: 'FIXO' }, records: rec('PRODUTO', 'P1', 'P2') });
    expect(printed(r)).toEqual(['P1']);
    expect(r.warnings).toEqual([]);
  });

  test('9. a number past the capacity is not a cell', () => {
    const r = expandLabels({ ...base, elements: [free('{{PRODUTO_4}}'), table('PRODUTO', 3)], values: { PRODUTO_4: 'S4' }, records: rec('PRODUTO', 'P1') });
    expect(printed(r)).toEqual(['S4']);
    expect(r.warnings).toEqual([]);
  });

  test('10. the table\'s own cells and header are not free variables', () => {
    const r = expandLabels({ ...base, elements: [table('PRODUTO', 3)], records: rec('PRODUTO', 'P1') });
    expect(r.warnings).toEqual([]);
  });

  test('a marker inside a title of the table is text of the table, not a free variable', () => {
    const t = table('PRODUTO', 2);
    (t.columns as any)[0].header = '{{PRODUTO_1}}';
    expect(expandLabels({ ...base, elements: [t], records: rec('PRODUTO', 'P1') }).warnings).toEqual([]);
  });
});

describe('the rest of the expansion is untouched', () => {
  const records = [{ PRODUTO: 'P1', UC: 'A' }, { PRODUTO: 'P2', UC: 'B' }, { PRODUTO: 'P3', UC: 'C' }, { PRODUTO: 'P4', UC: 'D' }];

  test('the warnings come after the existing ones, in the same order', () => {
    // a repeat page with no table, records left over, and a collision on page 1
    const r = expandLabels({ ...base, pages: two, elements: [free('{{PRODUTO_1}}', 0), table('PRODUTO', 2, 0)], records });
    expect(r.warnings).toEqual(['repeat-page-without-table', 'unplaced-records', 'variable-collision']);
  });

  test('11/12. several records and several labels fill the markers exactly as before', () => {
    const r = expandLabels({
      ...base, pages: two, elements: [free('{{UC}} {{PRODUTO}}', 0), table('PRODUTO', 1, 0), free('{{UC}}', 1, { id: 'g' }), table('PRODUTO', 2, 1)],
      values: { UC: 'DEFAULT' }, records,
    });
    expect(r.labels.map(l => [l.page, l.recordStart, l.recordCount])).toEqual([[0, 0, 1], [1, 1, 2], [1, 3, 1]]);
    expect(printed(r)[0]).toBe('A P1');
    expect(r.labels[1].zpl).toContain('^FDB^FS');
    expect(r.labels[2].zpl).toContain('^FDD^FS');
  });

  test('10/9. empty values, accents and control characters behave as before', () => {
    const r = expandLabels({ ...base, elements: [free('{{PRODUTO_1}}|{{UC}}'), table('PRODUTO', 2)], values: { UC: 'café^~' }, records: [{ PRODUTO: '' }] });
    expect(printed(r)).toEqual(['|café  ']);
    expect(r.warnings).toEqual(['variable-collision']);
  });

  test('the labels do not depend on the check: the same answer apart from the warning', () => {
    const colliding = expandLabels({ ...base, elements: [free('{{PRODUTO_1}}'), table('PRODUTO', 2)], values: { PRODUTO_1: 'S' }, records: rec('PRODUTO', 'P1') });
    const renamed = expandLabels({ ...base, elements: [free('{{OUTRA}}'), table('PRODUTO', 2)], values: { OUTRA: 'S' }, records: rec('PRODUTO', 'P1') });
    expect(colliding.labels.map(l => l.zpl.replace('{{PRODUTO_1}}', '').length)).toHaveLength(1);
    expect(printed(colliding)).toEqual(['P1']);
    expect(printed(renamed)).toEqual(['S']);
    expect(colliding.warnings).toEqual(['variable-collision']);
    expect(renamed.warnings).toEqual([]);
  });
});

describe('POST /api/expand-zpl', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', zplRouter);

  test('answers with the warning and the same shape as before', async () => {
    const res = await request(app).post('/api/expand-zpl')
      .send({ ...base, elements: [free('{{PRODUTO_1}}'), table('PRODUTO', 2)], values: { PRODUTO_1: 'S' }, records: rec('PRODUTO', 'P1') })
      .expect(200);
    expect(res.body.warnings).toEqual(['variable-collision']);
    expect(Object.keys(res.body).sort()).toEqual(['labels', 'totalRecords', 'unplaced', 'warnings', 'zpl']);
  });
});
