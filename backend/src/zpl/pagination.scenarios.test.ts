import { expandLabels } from './pagination';
import { Element } from './types';

// The four distributions the simulation is checked against (Etapa 6). The backend is the source of truth for them.

const table = (page: number | undefined, rowsPerPage: number): Element => ({
  id: `t${page ?? 0}`, type: 'table', x: 10, y: 10, width: 0, height: 0, rowsPerPage, rowHeight: 40,
  ...(page !== undefined && { page }),
  columns: [{ header: 'Material', field: 'MATERIAL', width: 200, align: 'L' }],
} as Element);
const rect = (page: number): Element => ({ id: `r${page}`, type: 'rect', x: 5, y: 5, width: 50, height: 50, page } as Element);
const records = (n: number) => Array.from({ length: n }, (_, i) => ({ MATERIAL: `M${i + 1}` }));
const shape = (r: ReturnType<typeof expandLabels>) => r.labels.map(l => [l.page, l.recordStart, l.recordCount]);
const twoPages = [{ mode: 'first' as const }, { mode: 'repeat' as const }];

describe('distribution scenarios', () => {
  test('A: two pages with tables, 10 records, capacity 2 and 4 -> 3 labels: 1-2, 3-6, 7-10', () => {
    const r = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [table(0, 2), table(1, 4)], pages: twoPages, records: records(10) });
    expect(shape(r)).toEqual([[0, 0, 2], [1, 2, 4], [1, 6, 4]]);
    expect(r.unplaced).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  test('B: first page without a table, 10 records, page 2 holds 3 -> 5 labels: none, 1-3, 4-6, 7-9, 10', () => {
    const r = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [rect(0), table(1, 3)], pages: twoPages, records: records(10) });
    expect(shape(r)).toEqual([[0, 0, 0], [1, 0, 3], [1, 3, 3], [1, 6, 3], [1, 9, 1]]);
    expect(r.unplaced).toBe(0);
  });

  test('C: one page with a table (a new design, and one saved before pages existed) -> one label', () => {
    const fresh = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [table(undefined, 3)], records: records(3) });
    expect(shape(fresh)).toEqual([[0, 0, 3]]);
    const old = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [{ id: 'a', type: 'rect', x: 1, y: 1, width: 10, height: 10 } as Element] });
    expect(shape(old)).toEqual([[0, 0, 0]]);
    expect(old.totalRecords).toBe(0);
    expect(old.warnings).toEqual([]);
  });

  test('D: more records than a single page holds -> the rest is reported, not dropped', () => {
    const r = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [table(undefined, 3)], records: records(10) });
    expect(shape(r)).toEqual([[0, 0, 3]]);
    expect(r.unplaced).toBe(7);
    expect(r.warnings).toContain('unplaced-records');
    // the labels and the unplaced records together are every record, once, in order
    const placed = r.labels.reduce((n, l) => n + l.recordCount, 0);
    expect(placed + r.unplaced).toBe(r.totalRecords);
  });

  test('a repeat page without a table cannot place what is left: warned', () => {
    const r = expandLabels({ labelWidth: 800, labelHeight: 600, elements: [table(0, 2), rect(1)], pages: twoPages, records: records(5) });
    expect(shape(r)).toEqual([[0, 0, 2]]);
    expect(r.unplaced).toBe(3);
    expect(r.warnings).toEqual(expect.arrayContaining(['repeat-page-without-table', 'unplaced-records']));
  });
});
