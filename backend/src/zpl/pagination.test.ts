import { ExpandError, expandLabels, planLabels } from './pagination';
import { Element } from './types';

const col = (field: string, width = 200) => ({ header: field, field, width, align: 'L' as const });

const table = (page: number, rowsPerPage: number, extra: Partial<Element> = {}): Element => ({
  id: `t${page}`, type: 'table', x: 40, y: 100, width: 0, height: 0, page, rowsPerPage,
  columns: [col('MATERIAL'), col('DESCRICAO', 300)],
  ...extra,
});

const text = (id: string, page: number, value: string): Element =>
  ({ id, type: 'text', x: 50, y: 20, width: 200, height: 40, value, fontSize: 30, fontName: '0', page });

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ MATERIAL: `M${i + 1}`, DESCRICAO: `D${i + 1}` }));
const base = { labelWidth: 800, labelHeight: 600 };
const two = [{ mode: 'first' as const }, { mode: 'repeat' as const }];

// Which records of the list a label printed: the M<n> in its cells
const printed = (zpl: string) => [...zpl.matchAll(/\^FDM(\d+)\^FS/g)].map(m => Number(m[1]));

describe('planLabels: how the records are shared among the labels', () => {
  test('10 records, 2 on page 1 and 4 on each repetition: 1-2, 3-6, 7-10', () => {
    const { plans, unplaced } = planLabels(10, 2, true, 4);
    expect(plans).toEqual([
      { page: 0, start: 0, count: 2 },
      { page: 1, start: 2, count: 4 },
      { page: 1, start: 6, count: 4 },
    ]);
    expect(unplaced).toBe(0);
  });

  test('10 records, 3 on a page and no table on page 1: the first label has none, then 3, 3, 3, 1', () => {
    const { plans, unplaced } = planLabels(10, 0, true, 3);
    expect(plans.map(p => [p.page, p.count])).toEqual([[0, 0], [1, 3], [1, 3], [1, 3], [1, 1]]);
    expect(unplaced).toBe(0);
  });

  test('one record that fits on page 1 makes no repetition', () => {
    expect(planLabels(1, 3, true, 3).plans).toEqual([{ page: 0, start: 0, count: 1 }]);
  });

  test('no records: only the first label', () => {
    expect(planLabels(0, 2, true, 4).plans).toEqual([{ page: 0, start: 0, count: 0 }]);
  });

  test('records that fit nowhere are counted, never dropped silently', () => {
    expect(planLabels(10, 2, false, 0).unplaced).toBe(8);   // one page only
    expect(planLabels(10, 2, true, 0).unplaced).toBe(8);    // page 2 without a table
    expect(planLabels(10, 0, false, 0).unplaced).toBe(10);
  });

  test('always in order, no record twice, none lost, never over a capacity (every combination up to 60 records)', () => {
    for (let total = 0; total <= 60; total++) {
      for (let cap1 = 0; cap1 <= 5; cap1++) {
        for (let cap2 = 1; cap2 <= 5; cap2++) {
          const { plans, unplaced } = planLabels(total, cap1, true, cap2);
          let next = 0;
          plans.forEach((p, i) => {
            expect(p.start).toBe(next);
            expect(p.page).toBe(i === 0 ? 0 : 1);
            expect(p.count).toBeLessThanOrEqual(i === 0 ? cap1 : cap2);
            if (i > 0) expect(p.count).toBeGreaterThan(0);  // no useless repetition
            next += p.count;
          });
          expect(next).toBe(total);
          expect(unplaced).toBe(0);
          const left = total - Math.min(cap1, total);
          expect(plans.length).toBe(1 + Math.ceil(left / cap2));
        }
      }
    }
  });
});

describe('expandLabels: the labels with the records in place', () => {
  test('page 1 holds 2 and page 2 holds 4: 3 labels, records 1-2, 3-6, 7-10', () => {
    const r = expandLabels({
      ...base, pages: two, records: records(10),
      elements: [text('c', 0, '{{CLIENTE}}'), table(0, 2), table(1, 4)],
    });
    expect(r.labels.map(l => l.page)).toEqual([0, 1, 1]);
    expect(r.labels.map(l => l.recordCount)).toEqual([2, 4, 4]);
    expect(r.labels.map(l => printed(l.zpl))).toEqual([[1, 2], [3, 4, 5, 6], [7, 8, 9, 10]]);
    expect(r.totalRecords).toBe(10);
    expect(r.unplaced).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.labels.map(l => l.index)).toEqual([1, 2, 3]);
    expect(r.zpl.match(/\^XA/g)).toHaveLength(3);
  });

  test('a description goes with its own material, in every cell', () => {
    const r = expandLabels({ ...base, pages: two, records: records(5), elements: [table(0, 2), table(1, 2)] });
    for (const label of r.labels) {
      for (const m of printed(label.zpl)) expect(label.zpl).toContain(`^FDD${m}^FS`);
    }
  });

  test('10 records, 3 per label, no table on page 1: the first label and 4 repetitions, the last one half empty', () => {
    const r = expandLabels({ ...base, pages: two, records: records(10), elements: [text('c', 0, 'Header'), table(1, 3)] });
    expect(r.labels.map(l => l.recordCount)).toEqual([0, 3, 3, 3, 1]);
    expect(printed(r.labels[0].zpl)).toEqual([]);
    expect(r.labels.flatMap(l => printed(l.zpl))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const last = r.labels[4].zpl;
    expect(printed(last)).toEqual([10]);
    // the two cells with no record are empty, not left as {{MATERIAL_2}}
    expect(last).not.toContain('{{');
    expect(last).toContain('^FD^FS');
  });

  test('every record exactly once, for 1, 5 and 10 records', () => {
    for (const n of [1, 5, 10]) {
      const r = expandLabels({ ...base, pages: two, records: records(n), elements: [table(0, 1), table(1, 3)] });
      expect(r.labels.flatMap(l => printed(l.zpl))).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(r.labels).toHaveLength(n === 1 ? 1 : 1 + Math.ceil((n - 1) / 3));
    }
  });

  test('a single record does not make a repetition', () => {
    const r = expandLabels({ ...base, pages: two, records: records(1), elements: [table(0, 3), table(1, 3)] });
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0].page).toBe(0);
  });

  test('no records: the first label alone, with empty cells', () => {
    const r = expandLabels({ ...base, pages: two, records: [], elements: [text('c', 0, '{{CLIENTE}}'), table(0, 2), table(1, 2)] });
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0].zpl).not.toContain('{{MATERIAL');
  });

  test('values of {{variables}} go on every label; a missing one stays as its name', () => {
    const r = expandLabels({
      ...base, pages: two, records: records(4), values: { cliente: 'ACME', TRANSP: '' },
      elements: [text('c', 0, '{{CLIENTE}}'), text('t', 0, '{{TRANSP}}'), table(0, 1), text('c2', 1, '{{CLIENTE}}'), table(1, 2)],
    });
    expect(r.labels[0].zpl).toContain('^FDACME^FS');
    expect(r.labels[0].zpl).toContain('^FDTRANSP^FS');
    expect(r.labels[1].zpl).toContain('^FDACME^FS');
    expect(r.labels[2].zpl).toContain('^FDACME^FS');
  });

  test('^ and ~ in a value become a space, in cells and in common values', () => {
    const r = expandLabels({
      ...base, pages: two, records: [{ MATERIAL: 'A^B~C', DESCRICAO: 'x' }], values: { CLIENTE: 'a^b' },
      elements: [text('c', 0, '{{CLIENTE}}'), table(0, 1)],
    });
    expect(r.labels[0].zpl).toContain('^FDA B C^FS');
    expect(r.labels[0].zpl).toContain('^FDa b^FS');
  });

  test('field names are matched without caring about case', () => {
    const r = expandLabels({ ...base, pages: two, records: [{ material: 'M1', descricao: 'D1' }], elements: [table(0, 1)] });
    expect(r.labels[0].zpl).toContain('^FDM1^FS');
    expect(r.labels[0].zpl).toContain('^FDD1^FS');
  });

  test('a record with a field missing prints an empty cell', () => {
    const r = expandLabels({ ...base, pages: two, records: [{ MATERIAL: 'M1' }], elements: [table(0, 1)] });
    expect(r.labels[0].zpl).toContain('^FDM1^FS');
    expect(r.labels[0].zpl).not.toContain('{{');
  });

  test('the data of one label does not get into another', () => {
    const r = expandLabels({ ...base, pages: two, records: records(7), elements: [table(0, 2), table(1, 2)] });
    const sets = r.labels.map(l => new Set(printed(l.zpl)));
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      for (const m of sets[i]) expect(sets[j].has(m)).toBe(false);
    }
  });

  test('a design of one page with a table: what does not fit is reported', () => {
    const r = expandLabels({ ...base, records: records(10), elements: [table(0, 3)] });
    expect(r.labels).toHaveLength(1);
    expect(r.unplaced).toBe(7);
    expect(r.warnings).toContain('unplaced-records');
  });

  test('a repeat page with no table is reported, and its records are not lost without notice', () => {
    const r = expandLabels({ ...base, pages: two, records: records(3), elements: [table(0, 1), text('x', 1, 'no table')] });
    expect(r.warnings).toContain('repeat-page-without-table');
    expect(r.warnings).toContain('unplaced-records');
    expect(r.unplaced).toBe(2);
  });

  test('two tables on a page cannot be worked out', () => {
    expect(() => expandLabels({ ...base, pages: two, records: records(2), elements: [table(0, 1), table(0, 1, { id: 'other' })] }))
      .toThrow(ExpandError);
  });

  test('a design with no table and no record: one label, as always', () => {
    const r = expandLabels({ ...base, elements: [text('a', 0, 'Hello')] });
    expect(r.labels).toHaveLength(1);
    expect(r.zpl).toContain('^FDHello^FS');
    expect(r.unplaced).toBe(0);
  });
});
