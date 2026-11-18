import { expandLabels } from './pagination';
import { Element } from './types';

// Values per label (a volume number, a UC): a variable that is not a cell of the table takes the value of the
// FIRST record of the label; with no value there, the one every label shares; and the distribution is untouched.

const text = (id: string, value: string, page: number): Element =>
  ({ id, type: 'text', x: 10, y: 10, width: 200, height: 30, value, fontSize: 30, fontName: '0', page } as Element);
const table = (page: number, rowsPerPage: number): Element => ({
  id: `t${page}`, type: 'table', x: 10, y: 60, width: 0, height: 0, rowsPerPage, rowHeight: 40, page,
  columns: [{ header: 'Material', field: 'MATERIAL', width: 200, align: 'L' }],
} as Element);
const pages = [{ mode: 'first' as const }, { mode: 'repeat' as const }];
const design = [text('h', 'Remessa {{REMESSA}} vol {{VOL}}', 0), table(0, 1), text('u', 'UC {{UC}} vol {{VOL}}', 1), table(1, 2)];
const records = [
  { MATERIAL: 'M1', UC: 'UC-A', VOL: '00001' },
  { MATERIAL: 'M2', UC: 'UC-B', VOL: '00002' },
  { MATERIAL: 'M3', UC: 'UC-B', VOL: '00002' },
  { MATERIAL: 'M4', UC: 'UC-C', VOL: '00003' },
  { MATERIAL: 'M5', UC: 'UC-C', VOL: '00003' },
];
const run = (extra: object = {}) => expandLabels({ labelWidth: 800, labelHeight: 600, elements: design, pages, records, values: { REMESSA: '777', VOL: 'common', UC: 'common-uc' }, ...extra });
const FD = (zpl: string) => [...zpl.matchAll(/\^FD([^^]*)\^FS/g)].map(m => m[1]);

describe('values per label', () => {
  test('each label prints the UC and the volume of its first record', () => {
    const r = run();
    expect(r.labels).toHaveLength(3);                                              // 1 + 2 + 2 records
    expect(FD(r.labels[0].zpl)).toContain('Remessa 777 vol 00001');
    expect(FD(r.labels[1].zpl)).toContain('UC UC-B vol 00002');                    // records 2 and 3: the first one's values
    expect(FD(r.labels[2].zpl)).toContain('UC UC-C vol 00003');
  });

  test('what every label shares (the Remessa) is the same on all of them', () => {
    expect(run().labels[0].zpl).toContain('Remessa 777');
  });

  test('the distribution is exactly the same with or without these values', () => {
    const plain = expandLabels({ labelWidth: 800, labelHeight: 600, elements: design, pages, records: records.map(r => ({ MATERIAL: r.MATERIAL })), values: { REMESSA: '777', VOL: 'c', UC: 'c' } });
    const withValues = run();
    const shape = (x: typeof plain) => x.labels.map(l => [l.page, l.recordStart, l.recordCount]);
    expect(shape(withValues)).toEqual(shape(plain));
    expect(withValues.unplaced).toBe(plain.unplaced);
    expect(withValues.warnings).toEqual(plain.warnings);
  });

  test('without the value in the record, the shared one is used', () => {
    const r = run({ records: records.map(({ MATERIAL }) => ({ MATERIAL })) });
    expect(FD(r.labels[1].zpl)).toContain('UC common-uc vol common');
  });

  test('an empty value in the record means "not given": the shared one is used, not an empty text', () => {
    const r = run({ records: records.map(r => ({ ...r, UC: r.MATERIAL === 'M2' ? '' : r.UC })) });
    expect(FD(r.labels[1].zpl)).toContain('UC common-uc vol 00002');
  });

  test('a label with no record (the first page without a table) uses the shared values', () => {
    const noTable = [text('h', 'vol {{VOL}}', 0), text('u', 'UC {{UC}}', 1), table(1, 2)];
    const r = expandLabels({ labelWidth: 800, labelHeight: 600, elements: noTable, pages, records, values: { VOL: 'shared' } });
    expect(r.labels[0].recordCount).toBe(0);
    expect(FD(r.labels[0].zpl)).toContain('vol shared');
    expect(FD(r.labels[1].zpl)).toContain('UC UC-A');                                // label 2 starts at record 1
  });

  test('the names are matched without telling upper from lower case, and a cell of the table keeps its own value', () => {
    const r = run({ records: [{ material: 'm1', uc: 'low-uc', Vol: '9' }, { MATERIAL: 'm2' }] });
    expect(FD(r.labels[0].zpl)).toContain('Remessa 777 vol 9');
    expect(r.labels[0].zpl).toContain('^FDm1^FS');                                   // the cell is the record's MATERIAL, as before
    expect(FD(r.labels[1].zpl)).toContain('UC common-uc vol common');                 // label 2 starts at record 2, which gives none: the shared ones
  });

  test('^ and ~ in these values become a space, as everywhere else', () => {
    const r = run({ records: [{ MATERIAL: 'x', UC: 'a^b~c' }, { MATERIAL: 'y', UC: 'ok' }] });
    expect(r.labels[1].zpl).toContain('UC ok');
    expect(r.labels[0].zpl).not.toMatch(/a\^b/);
  });

  test('a design that has no such variables, or no records, generates what it always did', () => {
    const plainDesign = [text('h', 'fixed text', 0), table(0, 3)];
    const withExtras = expandLabels({ labelWidth: 800, labelHeight: 600, elements: plainDesign, records: records.map(r => ({ ...r })) });
    const without = expandLabels({ labelWidth: 800, labelHeight: 600, elements: plainDesign, records: records.map(({ MATERIAL }) => ({ MATERIAL })) });
    expect(withExtras.labels.map(l => l.zpl)).toEqual(without.labels.map(l => l.zpl));
    expect(expandLabels({ labelWidth: 800, labelHeight: 600, elements: plainDesign }).labels).toHaveLength(1);
  });
});
