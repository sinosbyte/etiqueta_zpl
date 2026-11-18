// The test data grid (records) and the simulation. The simulation talks to the backend's real distribution
// (expandLabels), so what is checked here is what the server does with what the editor sends.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockNet = { fail: null as null | string, delay: null as null | Promise<void>, requests: [] as any[] };

jest.mock('../src/utils/zplClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { expandLabels } = require('../../backend/src/zpl/pagination');
  return {
    generateZpl: jest.fn(async (payload: any) => `ZPL(${payload.elements.length})`),
    parseZpl: jest.fn(),
    previewZpl: jest.fn(),
    exportZpl: jest.fn(),
    expandZpl: jest.fn(async (payload: any) => {
      const body = JSON.parse(JSON.stringify(payload));   // what travels over the network
      mockNet.requests.push(body);
      if (mockNet.delay) await mockNet.delay;
      if (mockNet.fail) throw new Error(mockNet.fail);
      return JSON.parse(JSON.stringify(expandLabels(body)));
    }),
  };
});
jest.mock('../src/utils/designsClient', () => {
  const clone = (v: any) => JSON.parse(JSON.stringify(v));
  const store = new Map<number, any>();
  let next = 1;
  return {
    apiCreateDesign: jest.fn(async (_n: string, p: any) => { const id = next++; store.set(id, clone(p)); return { designId: id, versionId: id }; }),
    apiGetVersion: jest.fn(async (id: number) => ({ id, versionNumber: 1, createdAt: 'now', sampleValues: {}, ...clone(store.get(id)), pagesConfig: clone(store.get(id).pagesConfig ?? null) })),
    apiCreateVersion: jest.fn(), apiUpdateVersion: jest.fn(), apiListDesigns: jest.fn(), apiListVersions: jest.fn(), apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
  };
});

(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { EMPTY_SIGNATURE } from '../src/utils/unsaved';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { DataRecord, DesignElement } from '../src/types';
import {
  MAX_RECORDS, MAX_VALUE_LENGTH, addLabelField, addRecords, candidateLabelFields, dataFields, deleteRecord, labelFields, labelValueConflicts,
  labelVariables, orphanFields, parsePaste, recordIssues, recordValue, removeOrphans, setCell,
} from '../src/utils/testData';
import { usePanelStore } from '../src/store/usePanelStore';
import { expandPayload, firstUnplaced, labelRecords, tableData, unplacedRecords, viewOf } from '../src/utils/simulation';
import { visibleRecords, tableOverflows } from '../src/utils/tableEdit';
import { variableCatalog } from '../src/utils/variableCatalog';

const designer = () => useDesignerStore.getState();
const sim = () => useSimulationStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const settle = () => jest.advanceTimersByTimeAsync(400);

const tableEl = (page: number | undefined, rowsPerPage: number, fields: string[] = ['MATERIAL', 'DESCRICAO']): DesignElement => ({
  id: `t${page ?? 0}`, type: 'table', x: 10, y: 10, width: 0, height: 0, rowsPerPage, rowHeight: 40,
  ...(page !== undefined && { page }),
  columns: fields.map(f => ({ header: f, field: f, width: 200, align: 'L' as const })),
});
const rect = (id: string, page?: number): DesignElement => ({ id, type: 'rect', x: 5, y: 5, width: 50, height: 50, ...(page !== undefined && { page }) });
const rows = (n: number): DataRecord[] => Array.from({ length: n }, (_, i) => ({ MATERIAL: `M${i + 1}`, DESCRICAO: `Produto ${i + 1}` }));
const two = [{ mode: 'first' as const }, { mode: 'repeat' as const }];

function load(elements: DesignElement[], records: DataRecord[], pages = [{ mode: 'first' as const }] as any[]) {
  useDesignerStore.setState({ elements, records, pages, activePage: 0, selectedId: null, selectedIds: [] });
  history().clear();
}
function closeEditor() {
  useDesignerStore.setState({
    elements: [], labelWidth: 800, labelHeight: 600, selectedId: null, selectedIds: [], sampleValues: {}, showSamples: false,
    zplCode: '', pages: [{ mode: 'first' }], activePage: 0, records: [],
  });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  useSimulationStore.getState().reset();
  history().clear();
}

beforeEach(() => { jest.useFakeTimers(); mockNet.fail = null; mockNet.delay = null; mockNet.requests.length = 0; closeEditor(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('the fields of the grid come from the tables', () => {
  test('the variable of each column of each table, once, in order; none without a table', () => {
    expect(dataFields([rect('a')])).toEqual([]);
    expect(dataFields([tableEl(0, 1, ['A', 'B']), tableEl(1, 1, ['B', 'C'])])).toEqual(['A', 'B', 'C']);
    expect(dataFields([tableEl(0, 1, ['MATERIAL']), tableEl(1, 1, ['material'])])).toEqual(['MATERIAL']);   // one name, whatever the case
  });

  test('they follow a column that is added, renamed or removed', () => {
    load([tableEl(0, 1, ['A', 'B'])], []);
    expect(dataFields(designer().elements)).toEqual(['A', 'B']);
    designer().updateElement('t0', { columns: [...designer().elements[0].columns!, { header: 'C', field: 'C', width: 50, align: 'L' }] });
    expect(dataFields(designer().elements)).toEqual(['A', 'B', 'C']);
    designer().updateElement('t0', { columns: designer().elements[0].columns!.filter(c => c.field !== 'B') });
    expect(dataFields(designer().elements)).toEqual(['A', 'C']);
  });
});

describe('records', () => {
  test('adding one or several blank records, with every field, up to the limit', () => {
    const fields = ['MATERIAL', 'DESCRICAO'];
    const one = addRecords([], fields, 1)!;
    expect(one).toEqual([{ MATERIAL: '', DESCRICAO: '' }]);
    expect(addRecords(one, fields, 5)!).toHaveLength(6);
    expect(addRecords([], fields, 0)).toBeNull();
    expect(addRecords([], [], 1)).toBeNull();                       // nothing to fill: there is no table
    expect(addRecords(addRecords([], fields, MAX_RECORDS)!, fields, 1)).toBeNull();
    expect(addRecords(addRecords([], fields, MAX_RECORDS - 1)!, fields, 2)).toBeNull();   // does not half-add
  });

  test('editing a value changes that cell only, and leaves the input as it was', () => {
    const before = rows(3);
    const copy = JSON.parse(JSON.stringify(before));
    const after = setCell(before, 1, 'DESCRICAO', 'Novo')!;
    expect(after[1]).toEqual({ MATERIAL: 'M2', DESCRICAO: 'Novo' });
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(before).toEqual(copy);
    expect(setCell(before, 1, 'DESCRICAO', 'Produto 2')).toBe(before);   // same value: nothing to change
  });

  test('a value over the limit, a row that does not exist or a bad field name is refused', () => {
    expect(setCell(rows(2), 0, 'MATERIAL', 'x'.repeat(MAX_VALUE_LENGTH + 1))).toBeNull();
    expect(setCell(rows(2), 0, 'MATERIAL', 'x'.repeat(MAX_VALUE_LENGTH))).not.toBeNull();
    expect(setCell(rows(2), 5, 'MATERIAL', 'x')).toBeNull();
    expect(setCell(rows(2), 0, 'COM ESPACO', 'x')).toBeNull();
  });

  test('a value goes into the key the record already has, whatever its case', () => {
    expect(setCell([{ material: 'a' }], 0, 'MATERIAL', 'b')).toEqual([{ material: 'b' }]);
    expect(recordValue({ material: 'a' }, 'MATERIAL')).toBe('a');
  });

  test('deleting a record keeps the others, in order', () => {
    expect(deleteRecord(rows(4), 1)!.map(r => r.MATERIAL)).toEqual(['M1', 'M3', 'M4']);
    expect(deleteRecord(rows(2), 9)).toBeNull();
  });

  test('pasting from a spreadsheet: with a header (any order), without one, blank cells, and the limit', () => {
    const fields = ['MATERIAL', 'DESCRICAO'];
    const withHeader = parsePaste('descricao\tmaterial\r\nParafuso\tM1\r\nPorca\tM2\r\n', fields);
    expect(withHeader.header).toBe(true);
    expect(withHeader.records).toEqual([{ MATERIAL: 'M1', DESCRICAO: 'Parafuso' }, { MATERIAL: 'M2', DESCRICAO: 'Porca' }]);
    const without = parsePaste('M1\tParafuso\nM2', fields);
    expect(without.header).toBe(false);
    expect(without.records).toEqual([{ MATERIAL: 'M1', DESCRICAO: 'Parafuso' }, { MATERIAL: 'M2', DESCRICAO: '' }]);
    expect(parsePaste('', fields).records).toEqual([]);
    expect(parsePaste('a\tb', []).records).toEqual([]);
    const many = parsePaste(Array.from({ length: MAX_RECORDS + 3 }, (_, i) => `M${i}`).join('\n'), fields);
    expect(many.records).toHaveLength(MAX_RECORDS);
    expect(many.skipped).toBe(3);
  });

  test('what is wrong with the data is named: empty record, empty values, too long, ^ and ~', () => {
    const fields = ['MATERIAL', 'DESCRICAO'];
    const issues = recordIssues([
      { MATERIAL: '', DESCRICAO: '' },
      { MATERIAL: 'M2', DESCRICAO: '' },
      { MATERIAL: 'a^b', DESCRICAO: 'c~d' },
      { MATERIAL: 'x'.repeat(MAX_VALUE_LENGTH + 1), DESCRICAO: 'ok' },
      { MATERIAL: 'M5', DESCRICAO: 'ok' },
    ], fields);
    expect(issues).toEqual([
      { kind: 'emptyRecord', row: 0 },
      { kind: 'emptyValues', row: 1, fields: ['DESCRICAO'] },
      { kind: 'control', row: 2, field: 'MATERIAL' },
      { kind: 'control', row: 2, field: 'DESCRICAO' },
      { kind: 'tooLong', row: 3, field: 'MATERIAL' },
    ]);
    expect(recordIssues(rows(3), fields)).toEqual([]);
  });
});

describe('the data in the store', () => {
  test('is the one place the records live: pagesConfig.records, saved, reopened, and a change to save', async () => {
    load([tableEl(0, 3)], []);
    designer().setRecords(addRecords([], ['MATERIAL', 'DESCRICAO'], 2)!);
    designer().setRecords(setCell(designer().records, 0, 'MATERIAL', 'M1')!);
    expect(isDirtyNow()).toBe(true);
    await useDesignsStore.getState().saveNewDesign('Dados');
    expect(isDirtyNow()).toBe(false);
    const saved = designer().records;
    closeEditor();
    await useDesignsStore.getState().loadVersion(1, 1);
    expect(designer().records).toEqual(saved);
    expect(designer().records[0].MATERIAL).toBe('M1');
    expect(isDirtyNow()).toBe(false);
    designer().setRecords(setCell(designer().records, 1, 'MATERIAL', 'M2')!);
    expect(isDirtyNow()).toBe(true);
  });

  test('undo and redo take back an added record and an edited value', async () => {
    load([tableEl(0, 3)], []);
    await settle();
    designer().setRecords(addRecords([], ['MATERIAL', 'DESCRICAO'], 1)!);
    await settle();
    designer().setRecords(setCell(designer().records, 0, 'MATERIAL', 'M1')!);
    await settle();
    history().undo();
    expect(designer().records[0].MATERIAL).toBe('');
    history().undo();
    expect(designer().records).toEqual([]);
    history().redo(); history().redo();
    expect(designer().records[0].MATERIAL).toBe('M1');
  });

  test('a column that is removed or renamed does not delete the data: its field is reported, the values stay', () => {
    load([tableEl(0, 2, ['MATERIAL', 'DESCRICAO'])], rows(3));
    designer().updateElement('t0', { columns: [{ header: 'M', field: 'MATERIAL', width: 100, align: 'L' }, { header: 'T', field: 'TEXTO', width: 100, align: 'L' }] });
    const fields = dataFields(designer().elements);
    expect(fields).toEqual(['MATERIAL', 'TEXTO']);
    expect(orphanFields(designer().records, fields)).toEqual(['DESCRICAO']);
    expect(designer().records[2].DESCRICAO).toBe('Produto 3');                   // nothing was touched
    // only an explicit action drops them
    expect(removeOrphans(designer().records, fields)[2]).toEqual({ MATERIAL: 'M3' });
    expect(designer().records[2].DESCRICAO).toBe('Produto 3');                   // and it returns a new list
  });

  test('a design with no table keeps its records, and the grid has no field to show', () => {
    load([rect('a')], rows(2));
    expect(dataFields(designer().elements)).toEqual([]);
    expect(designer().records).toHaveLength(2);
    expect(addRecords(designer().records, [], 1)).toBeNull();
  });

  test('the catalog lists the variables the table prints, and the test data fills them', () => {
    load([tableEl(0, 2)], rows(2));
    expect(variableCatalog(designer().elements).map(v => v.name)).toEqual(['MATERIAL_1', 'MATERIAL_2', 'DESCRICAO_1', 'DESCRICAO_2']);
    designer().updateElement('t0', { columns: [{ header: 'Q', field: 'QTD', width: 100, align: 'L' }] });
    expect(variableCatalog(designer().elements).map(v => v.name)).toEqual(['QTD_1', 'QTD_2']);
  });
});

describe('what the canvas draws', () => {
  const t0 = tableEl(0, 2);
  const t1 = tableEl(1, 4);

  test('the editing preview: page 1 shows the first records that fit; page 2 shows none (it is the simulation that says which reach it)', () => {
    expect(visibleRecords(t0, rows(10)).map(r => r.MATERIAL)).toEqual(['M1', 'M2']);
    expect(visibleRecords(t1, rows(10))).toEqual([]);
    expect(tableData(t1, rows(10), null)).toEqual({ data: [], simulated: false });
  });

  test('while a label is being viewed, the table of its page draws the records of that label, and the table of the other page only its variables', () => {
    const view = { index: 2, total: 3, page: 1, records: rows(10).slice(2, 6), firstRecord: 3 };
    expect(tableData(t1, rows(10), view)).toEqual({ data: rows(10).slice(2, 6), simulated: true });
    expect(tableData(t0, rows(10), view)).toEqual({ data: [], simulated: false });   // not on this label: variables only
  });

  test('the width check looks at the records a table can get: page 1 its first ones, page 2 any', () => {
    const wide = { ...tableEl(1, 1, ['MATERIAL']), columns: [{ header: 'M', field: 'MATERIAL', width: 60, align: 'L' as const }] };
    const long = [{ MATERIAL: 'a' }, { MATERIAL: 'um valor bem comprido que nao cabe' }];
    expect(tableOverflows(wide, long)).toHaveLength(1);
    expect(tableOverflows({ ...wide, page: 0 }, long)).toEqual([]);                 // on page 1 only the first record is on the label
  });
});

describe('the simulation', () => {
  test('sends the design and the records as the contract says, and shows what the backend answers', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    designer().setSampleValues({ CLIENTE: 'ACME' });
    await sim().run();
    const body = mockNet.requests[0];
    expect(Object.keys(body).sort()).toEqual(['elements', 'labelHeight', 'labelWidth', 'pages', 'records', 'values']);
    expect(body.pages).toEqual(two);
    expect(body.records).toHaveLength(10);
    expect(sim().status).toBe('ready');
    expect(sim().result!.labels).toHaveLength(3);
  });

  test('a design of one page sends no pages, as when generating', async () => {
    load([tableEl(undefined, 3)], rows(2));
    expect(expandPayload({ ...designer() } as any)).not.toHaveProperty('pages');
  });

  test('A: two pages with tables, 10 records, capacity 2 and 4: three labels with the records 1-2, 3-6 and 7-10', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    await sim().run();
    const r = sim().result!;
    expect(r.labels.map(l => [l.page, l.recordStart, l.recordCount])).toEqual([[0, 0, 2], [1, 2, 4], [1, 6, 4]]);
    expect(r.labels.map(l => labelRecords(l, sim().sent).map(x => x.MATERIAL))).toEqual([['M1', 'M2'], ['M3', 'M4', 'M5', 'M6'], ['M7', 'M8', 'M9', 'M10']]);
    expect(r.unplaced).toBe(0);
    expect(r.warnings).toEqual([]);
  });

  test('B: page 1 without a table, page 2 holds 3: five labels, the first without records', async () => {
    load([rect('a', 0), tableEl(1, 3)], rows(10), two);
    await sim().run();
    expect(sim().result!.labels.map(l => [l.page, l.recordCount])).toEqual([[0, 0], [1, 3], [1, 3], [1, 3], [1, 1]]);
    expect(viewOf(sim().result!, sim().sent, 1)!.records).toEqual([]);
    expect(viewOf(sim().result!, sim().sent, 5)!.records.map(r => r.MATERIAL)).toEqual(['M10']);
    expect(viewOf(sim().result!, sim().sent, 5)!.firstRecord).toBe(10);
  });

  test('C: one page with a table, in a design saved before pages existed (no page on the elements) and in a new one', async () => {
    load([tableEl(undefined, 3)], rows(3));
    await sim().run();
    expect(sim().result!.labels).toHaveLength(1);
    expect(sim().result!.labels[0].recordCount).toBe(3);
    load([rect('old')], []);
    await sim().run();
    expect(sim().result!.labels).toHaveLength(1);
    expect(sim().result!.warnings).toEqual([]);
  });

  test('D: records that fit nowhere are counted, listed in order, and not dropped from the data', async () => {
    load([tableEl(undefined, 3)], rows(10));
    await sim().run();
    const r = sim().result!;
    expect(r.unplaced).toBe(7);
    expect(r.warnings).toContain('unplaced-records');
    const rest = unplacedRecords(r, sim().sent);
    expect(rest.map(x => x.MATERIAL)).toEqual(['M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']);
    expect(firstUnplaced(r, sim().sent)).toBe(4);
    expect(designer().records).toHaveLength(10);                                    // the data is untouched
  });

  test('order is kept and nothing is duplicated or lost: labels plus unplaced are the records, once each', async () => {
    for (const [first, repeat, n] of [[2, 4, 10], [1, 1, 7], [3, 3, 3], [5, 2, 0], [2, 3, 1]] as const) {
      load([tableEl(0, first), tableEl(1, repeat)], rows(n), two);
      await sim().run();
      const r = sim().result!;
      const seen = r.labels.flatMap(l => labelRecords(l, sim().sent)).concat(unplacedRecords(r, sim().sent)).map(x => x.MATERIAL);
      expect(seen).toEqual(rows(n).map(x => x.MATERIAL));
    }
  });

  test('the labels can be walked: selecting one shows it on the canvas, and going back to editing hides it', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    await sim().run();
    expect(sim().selected).toBe(1);
    expect(sim().view).toMatchObject({ index: 1, total: 3, page: 0 });
    sim().select(3);
    expect(sim().view).toMatchObject({ index: 3, page: 1, firstRecord: 7 });
    expect(sim().view!.records.map(r => r.MATERIAL)).toEqual(['M7', 'M8', 'M9', 'M10']);
    sim().select(99);
    expect(sim().selected).toBe(3);                                                  // there is no label 99
    sim().setViewing(false);
    expect(sim().view).toBeNull();
    expect(sim().result).not.toBeNull();                                             // the result itself stays
    sim().setViewing(true);
    expect(sim().view!.index).toBe(3);
  });

  test('it stops being valid when the data, a table, the pages, the example values or the size change', async () => {
    const changes: [string, () => void][] = [
      ['a value', () => designer().setRecords(setCell(designer().records, 0, 'MATERIAL', 'outro')!)],
      ['a record', () => designer().setRecords(deleteRecord(designer().records, 0)!)],
      ['the capacity', () => designer().updateElement('t0', { rowsPerPage: 3 })],
      ['a column', () => designer().updateElement('t1', { columns: [{ header: 'X', field: 'X', width: 100, align: 'L' }] })],
      ['an element', () => designer().addElement('rect', 1, 1, { id: 'new' })],
      ['the second page', () => designer().removePage()],
      ['an example value', () => designer().setSampleValues({ CLIENTE: 'ACME' })],
      ['the label size', () => designer().setLabelSize(700, 500)],
    ];
    for (const [what, change] of changes) {
      load([tableEl(0, 2), tableEl(1, 4), { id: 'c', type: 'text', x: 1, y: 1, width: 10, height: 10, value: '{{CLIENTE}}' }], rows(10), two);
      designer().setSampleValues({});
      designer().setLabelSize(800, 600);
      await sim().run();
      expect([what, sim().stale]).toEqual([what, false]);
      expect([what, sim().view !== null]).toEqual([what, true]);
      change();
      expect([what, sim().stale]).toEqual([what, true]);
      expect([what, sim().view]).toEqual([what, null]);                              // the canvas goes back to editing
      expect(sim().result).not.toBeNull();                                           // the old result stays visible, marked
    }
  });

  test('an example value of a variable the design does not use changes nothing, so it does not invalidate', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    await sim().run();
    designer().setSampleValues({ NAO_USADA: '1' });
    expect(sim().stale).toBe(false);
  });

  test('moving the selection or switching pages is not a change: the simulation stays valid', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    await sim().run();
    designer().selectElement('t0');
    designer().setActivePage(1);
    designer().setZoom(1);
    expect(sim().stale).toBe(false);
    expect(sim().view).not.toBeNull();
  });

  test('running again makes it valid again, for the new state', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    await sim().run();
    designer().setRecords(rows(4));
    expect(sim().stale).toBe(true);
    await sim().run();
    expect(sim().stale).toBe(false);
    expect(sim().result!.totalRecords).toBe(4);
    expect(sim().view).not.toBeNull();
  });

  test('a change made while the request is out makes the answer arrive already out of date', async () => {
    load([tableEl(0, 2), tableEl(1, 4)], rows(10), two);
    let release!: () => void;
    mockNet.delay = new Promise<void>(res => { release = res; });
    const running = sim().run();
    expect(sim().status).toBe('loading');
    designer().setRecords(rows(3));
    release();
    await running;
    expect(sim().result!.totalRecords).toBe(10);
    expect(sim().stale).toBe(true);
    expect(sim().view).toBeNull();
  });

  test('an error of the server is shown, and no result is kept', async () => {
    load([tableEl(0, 2)], rows(3));
    mockNet.fail = 'Page 1 has more than one table (only one per page is supported)';
    await sim().run();
    expect(sim().status).toBe('error');
    expect(sim().error).toMatch(/more than one table/);
    expect(sim().result).toBeNull();
  });

  test('the warning of a repeat page without a table comes from the backend', async () => {
    load([tableEl(0, 2), rect('r', 1)], rows(5), two);
    await sim().run();
    expect(sim().result!.warnings).toEqual(expect.arrayContaining(['repeat-page-without-table', 'unplaced-records']));
    expect(sim().result!.unplaced).toBe(3);
  });

  test('the simulation is not part of the design: it is no change to save and not in the undo history', async () => {
    load([tableEl(0, 2)], rows(3));
    await settle();
    await useDesignsStore.getState().saveNewDesign('S');
    expect(isDirtyNow()).toBe(false);
    const past = history().pastStates.length;
    await sim().run();
    sim().select(1);
    expect(isDirtyNow()).toBe(false);
    await settle();
    expect(history().pastStates.length).toBe(past);
  });
});

describe('what did not change', () => {
  test('a design of one page and common elements edit as before, with no records', () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    designer().addElement('text', 2, 2, { id: 'b', value: 'x' });
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'b']);
    expect(designer().records).toEqual([]);
    expect(sim().result).toBeNull();
  });
});

describe('values per label (Volumes, UC)', () => {
  const text = (id: string, value: string, page?: number): DesignElement => ({ id, type: 'text', x: 1, y: 1, width: 100, height: 20, value, fontSize: 20, ...(page !== undefined && { page }) });
  const design = (): DesignElement[] => [text('h', 'Remessa {{REMESSA}} vol {{VOL}}', 0), tableEl(0, 1, ['MATERIAL']), text('u', 'UC {{UC}}', 1), tableEl(1, 2, ['MATERIAL'])];
  const recs = (): DataRecord[] => [1, 2, 3, 4, 5].map(n => ({ MATERIAL: `M${n}` }));

  test('the variables that can differ per label are the ones outside the tables', () => {
    expect(labelVariables(design())).toEqual(['REMESSA', 'UC', 'VOL']);
    expect(labelVariables([tableEl(0, 1, ['MATERIAL'])])).toEqual([]);
    expect(labelVariables([text('a', '{{MATERIAL}} {{OTHER}}', 0), tableEl(0, 1, ['MATERIAL'])])).toEqual(['OTHER']);   // a table field is never a per-label one
  });

  test('a column exists once the records carry it; before that it is offered', () => {
    expect(labelFields(design(), recs())).toEqual([]);
    expect(candidateLabelFields(design(), recs())).toEqual(['REMESSA', 'UC', 'VOL']);
    const withUc = addLabelField(recs(), 'UC')!;
    expect(labelFields(design(), withUc)).toEqual(['UC']);
    expect(candidateLabelFields(design(), withUc)).toEqual(['REMESSA', 'VOL']);
  });

  test('adding a column keeps every value, adds it empty to all records, and refuses what makes no sense', () => {
    const before = recs();
    const after = addLabelField(before, 'UC')!;
    expect(after.map(r => r.MATERIAL)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
    expect(after.every(r => r.UC === '')).toBe(true);
    expect(before[0]).toEqual({ MATERIAL: 'M1' });                                   // the input is not changed
    expect(addLabelField([], 'UC')).toBeNull();                                     // no record to hold it
    expect(addLabelField(after, 'uc')).toBeNull();                                  // already there (names match without case)
    expect(addLabelField(recs(), 'COM ESPACO')).toBeNull();
  });

  test('such a column is not an orphan; a field no table and no variable asks for still is', () => {
    const records = [{ MATERIAL: 'a', UC: 'x', ANTIGO: 'y' }];
    const known = [...dataFields(design()), ...labelFields(design(), records)];
    expect(orphanFields(records, known)).toEqual(['ANTIGO']);
  });

  test('pasting a header that names a per-label variable brings its column; one that is not in the header does not appear', () => {
    const fields = ['MATERIAL'];
    const extra = candidateLabelFields(design(), recs());
    const r = parsePaste(['MATERIAL', 'UC'].join('\t') + '\n' + ['M1', 'UC-1'].join('\t') + '\n' + ['M2', 'UC-2'].join('\t'), fields, extra);
    expect(r.header).toBe(true);
    expect(r.records).toEqual([{ MATERIAL: 'M1', UC: 'UC-1' }, { MATERIAL: 'M2', UC: 'UC-2' }]);
    expect(Object.keys(r.records[0])).not.toContain('VOL');
    expect(parsePaste(['MATERIAL', 'NAOEXISTE'].join('\t') + '\n' + ['M1', 'x'].join('\t'), fields, extra).header).toBe(false);   // an unknown name is not a header
  });

  test('records of one label that disagree are reported, empty values and a single record are not', () => {
    expect(labelValueConflicts([{ UC: 'a' }, { UC: 'a' }], ['UC'])).toEqual([]);
    expect(labelValueConflicts([{ UC: 'a' }, { UC: 'b' }], ['UC'])).toEqual(['UC']);
    expect(labelValueConflicts([{ UC: 'a' }, { UC: '' }], ['UC'])).toEqual([]);
    expect(labelValueConflicts([{ UC: 'a' }], ['UC'])).toEqual([]);
  });

  test('the simulation sends the columns and each label prints the value of its first record (real backend)', async () => {
    const records = recs().map((r, i) => ({ ...r, UC: `UC-${i + 1}`, VOL: `0000${Math.floor(i / 2) + 1}` }));
    load(design(), records, two);
    designer().setSampleValues({ REMESSA: '777', UC: 'comum', VOL: 'comum' });
    await sim().run();
    const r = sim().result!;
    expect(r.labels.map(l => [l.page, l.recordStart, l.recordCount])).toEqual([[0, 0, 1], [1, 1, 2], [1, 3, 2]]);
    const text = (z: string) => [...z.matchAll(/\^FD([^^]*)\^FS/g)].map(m => m[1]);
    expect(text(r.labels[0].zpl)).toContain('Remessa 777 vol 00001');
    expect(text(r.labels[1].zpl)).toContain('UC UC-2');                              // label 2 starts at record 2
    expect(text(r.labels[2].zpl)).toContain('UC UC-4');
    expect(mockNet.requests[0].records[1]).toMatchObject({ UC: 'UC-2' });
  });

  test('the same design without the columns prints the shared values on every label', async () => {
    load(design(), recs(), two);
    designer().setSampleValues({ REMESSA: '777', UC: 'comum', VOL: 'comum' });
    await sim().run();
    const text = (z: string) => [...z.matchAll(/\^FD([^^]*)\^FS/g)].map(m => m[1]);
    expect(text(sim().result!.labels[1].zpl)).toContain('UC comum');
  });

  test('editing the column is a change: the simulation goes out of date and the design is unsaved', async () => {
    const records = recs().map(r => ({ ...r, UC: 'a' }));
    load(design(), records, two);
    await sim().run();
    expect(sim().stale).toBe(false);
    designer().setRecords(setCell(designer().records, 1, 'UC', 'b')!);
    expect(sim().stale).toBe(true);
  });
});

describe('the test data bar can be opened from elsewhere', () => {
  test('show() opens it on the tab asked for (what the Preview and Export buttons do)', () => {
    usePanelStore.setState({ open: false, tab: 'data' });
    usePanelStore.getState().show('sim');
    expect(usePanelStore.getState()).toMatchObject({ open: true, tab: 'sim' });
    usePanelStore.getState().setOpen(false);
    expect(usePanelStore.getState().open).toBe(false);
  });
});
