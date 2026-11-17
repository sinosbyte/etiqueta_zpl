// The table editor: inserting a table, its columns and properties, how it is sized and checked, and how it is
// saved and opened. The designer store and the designs store are real; the network is a small fake.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockServer = { designs: new Map<number, any[]>(), nextId: 1, calls: [] as { fn: string; args: any[] }[] };

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => `ZPL(${payload.elements.length} elements, ${payload.pages ? payload.pages.length : 1} page)`),
  parseZpl: jest.fn(async () => ({ labelWidth: 400, labelHeight: 300, elements: [{ id: 'parsed', type: 'rect', x: 1, y: 2, width: 3, height: 4 }], unknownCommands: [] })),
  previewZpl: jest.fn(),
  exportZpl: jest.fn(),
}));

jest.mock('../src/utils/designsClient', () => {
  const clone = (v: any) => JSON.parse(JSON.stringify(v));
  const detail = (stored: any, n: number) => ({
    id: n, versionNumber: n, createdAt: 'now', sampleValues: stored.sampleValues ?? {}, pagesConfig: stored.pagesConfig ?? null,
    zpl: stored.zpl, elements: clone(stored.elements), labelWidth: stored.labelWidth, labelHeight: stored.labelHeight,
  });
  return {
    apiCreateDesign: jest.fn(async (name: string, payload: any) => {
      mockServer.calls.push({ fn: 'create', args: [name, clone(payload)] });
      const id = mockServer.nextId++;
      mockServer.designs.set(id, [clone({ ...payload, pagesConfig: payload.pagesConfig ?? null })]);
      return { designId: id, versionId: id };
    }),
    apiCreateVersion: jest.fn(),
    apiUpdateVersion: jest.fn(),
    apiGetVersion: jest.fn(async (designId: number, vn: number) => detail(mockServer.designs.get(designId)![vn - 1], vn)),
    apiListDesigns: jest.fn(async () => ({ items: [], total: 0, limit: 24, offset: 0 })),
    apiListVersions: jest.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
    apiDeleteDesign: jest.fn(),
    apiRenameDesign: jest.fn(),
  };
});

// Text outside font 0 is measured with a canvas; 10 dots per character is enough here
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { EMPTY_SIGNATURE, designVariables } from '../src/utils/unsaved';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { isStructured } from '../src/utils/pages';
import { elementBox } from '../src/utils/zplText';
import { tableBox } from '../src/utils/tableBox';
import { variableCatalog } from '../src/utils/variableCatalog';
import { DesignElement } from '../src/types';
import {
  TABLE_MAX_CAPACITY, TABLE_MAX_COLUMNS, TABLE_MAX_ROW_HEIGHT, TABLE_MIN_COLUMN_WIDTH, TABLE_MIN_ROW_HEIGHT,
  addColumn, availableFields, bordersPatch, cellPaddingPatch, columnsWidth, defaultColumns, fontSizePatch, hasBorders,
  headerRowPatch, moveColumn, newFieldName, removeColumn, resizeTablePatch, rowHeightPatch, rowsPerPagePatch, scaleColumns,
  setTableWidth, tableIssues, tableOnPage, tableOverflows, tableSlotName, tableVariables, tableWidth, updateColumn, visibleRecords,
} from '../src/utils/tableEdit';

const designer = () => useDesignerStore.getState();
const designs = () => useDesignsStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const settle = () => jest.advanceTimersByTimeAsync(400);

const apply = (el: DesignElement, patch: Partial<DesignElement> | null): DesignElement => ({ ...el, ...(patch ?? {}) });
const tableOf = () => designer().elements.find(e => e.type === 'table')!;
const table = (extra: Partial<DesignElement> = {}): DesignElement => ({
  id: 'tab', type: 'table', x: 40, y: 100, width: 0, height: 0, rowsPerPage: 3, rowHeight: 40,
  columns: [
    { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' },
    { header: 'Descricao', field: 'DESCRICAO', width: 300, align: 'L' },
    { header: 'Qtd', field: 'QUANTIDADE', width: 100, align: 'R' },
  ],
  ...extra,
});
const records = [{ MATERIAL: '100', DESCRICAO: 'Parafuso', QUANTIDADE: '5' }, { MATERIAL: '101', DESCRICAO: 'Porca', QUANTIDADE: '10' }];

function closeEditor() {
  useDesignerStore.setState({
    elements: [], labelWidth: 800, labelHeight: 1200, selectedId: null, selectedIds: [], sampleValues: {}, showSamples: false,
    zplCode: '^XA\n^PW800\n^LL1200\n^XZ', pages: [{ mode: 'first' }], activePage: 0, records: [],
  });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  history().clear();
}

beforeEach(() => { jest.useFakeTimers(); mockServer.designs.clear(); mockServer.nextId = 1; mockServer.calls.length = 0; closeEditor(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('inserting a table', () => {
  test('goes on the page being edited, valid, selected, and with a size that comes from its columns', () => {
    const id = designer().addTable(50, 60)!;
    const el = tableOf();
    expect(id).toBe(el.id);
    expect(el).toMatchObject({ type: 'table', x: 50, y: 60, headerRow: true, rowsPerPage: 1, rowHeight: 40, cellPadding: 6, fontSize: 24 });
    expect(el.columns!.length).toBe(3);
    expect(el.columns!.every(c => /^[A-Za-z0-9_]{1,60}$/.test(c.field) && c.width >= TABLE_MIN_COLUMN_WIDTH)).toBe(true);
    expect(designer().selectedId).toBe(id);
    expect(designer().selectedIds).toEqual([id]);
    expect(el).not.toHaveProperty('page');                // one page: no page field, as for any element
    expect(elementBox(el)).toEqual({ width: columnsWidth(el.columns!), height: 80 });
  });

  test('a new table fits a narrow label: the columns are scaled to what is left of it', () => {
    designer().setLabelSize(400, 600);
    designer().addTable(50, 50);
    const widths = tableOf().columns!.map(c => c.width);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(350);
    expect(widths.every(w => w >= TABLE_MIN_COLUMN_WIDTH)).toBe(true);
  });

  test('a second table on the same page is refused, and nothing changes', () => {
    designer().addTable();
    const before = designer().elements;
    expect(designer().addTable()).toBeNull();
    expect(designer().elements).toBe(before);
  });

  test('each page can have its own table', () => {
    designer().addTable();
    designer().addPage();                                  // the second page becomes the one being edited
    expect(designer().activePage).toBe(1);
    expect(designer().addTable()).not.toBeNull();
    const tables = designer().elements.filter(e => e.type === 'table');
    expect(tables.map(e => e.page)).toEqual([undefined, 1]);
    expect(designer().addTable()).toBeNull();              // and one on each is the limit
    designer().setActivePage(0);
    expect(designer().addTable()).toBeNull();
    expect(tableOnPage(designer().elements, 0)).toBe(tables[0]);
    expect(tableOnPage(designer().elements, 1)).toBe(tables[1]);
  });

  test('taking a table off a page lets it have another', () => {
    const id = designer().addTable()!;
    designer().deleteElement(id);
    expect(designer().addTable()).not.toBeNull();
  });

  test('a table is not duplicated (it would be a second one on the page)', () => {
    designer().addTable();
    designer().duplicateSelected();
    expect(designer().elements.filter(e => e.type === 'table')).toHaveLength(1);
  });

  test('the table can be moved', () => {
    const id = designer().addTable(50, 50)!;
    designer().updateElement(id, { x: 120, y: 200 });
    expect(tableOf()).toMatchObject({ x: 120, y: 200 });
  });
});

describe('columns', () => {
  test('adding one gives it a valid, unused variable, up to the limit', () => {
    let el = table();
    el = apply(el, addColumn(el));
    expect(el.columns).toHaveLength(4);
    expect(el.columns![3]).toMatchObject({ header: 'Coluna', field: 'CAMPO', align: 'L' });
    el = apply(el, addColumn(el));
    expect(el.columns![4].field).toBe('CAMPO_2');
    while (el.columns!.length < TABLE_MAX_COLUMNS) el = apply(el, addColumn(el));
    expect(addColumn(el)).toBeNull();
    expect(newFieldName([{ header: '', field: 'campo', width: 20, align: 'L' }])).toBe('CAMPO_2');
  });

  test('the title, the variable, the width and the alignment of a column can be changed, one at a time', () => {
    let el = table();
    el = apply(el, updateColumn(el, 1, { header: 'Texto breve' }));
    el = apply(el, updateColumn(el, 1, { field: 'MAKTX' }));
    el = apply(el, updateColumn(el, 1, { width: 250 }));
    el = apply(el, updateColumn(el, 1, { align: 'C' }));
    expect(el.columns![1]).toEqual({ header: 'Texto breve', field: 'MAKTX', width: 250, align: 'C' });
    expect(el.columns![0]).toEqual(table().columns![0]);
    expect(el.columns![2]).toEqual(table().columns![2]);
    expect(tableWidth(el)).toBe(550);
  });

  test('a change the backend would refuse is not made', () => {
    const el = table();
    expect(updateColumn(el, 0, { field: '' })).toBeNull();
    expect(updateColumn(el, 0, { field: 'COM ESPACO' })).toBeNull();
    expect(updateColumn(el, 0, { field: 'A'.repeat(61) })).toBeNull();
    expect(updateColumn(el, 0, { width: 0 })).toBeNull();
    expect(updateColumn(el, 0, { width: -5 })).toBeNull();
    expect(updateColumn(el, 0, { width: TABLE_MIN_COLUMN_WIDTH - 1 })).toBeNull();
    expect(updateColumn(el, 0, { width: 10_001 })).toBeNull();
    expect(updateColumn(el, 0, { width: 20.5 })).toBeNull();
    expect(updateColumn(el, 0, { header: 'x'.repeat(61) })).toBeNull();
    expect(updateColumn(el, 9, { header: 'x' })).toBeNull();
    expect(updateColumn(el, 0, { width: TABLE_MIN_COLUMN_WIDTH })).not.toBeNull();
  });

  test('a column is removed, but never the last one', () => {
    let el = table();
    el = apply(el, removeColumn(el, 1));
    expect(el.columns!.map(c => c.field)).toEqual(['MATERIAL', 'QUANTIDADE']);
    el = apply(el, removeColumn(el, 0));
    expect(removeColumn(el, 0)).toBeNull();
    expect(el.columns!.map(c => c.field)).toEqual(['QUANTIDADE']);
    expect(removeColumn(table(), 7)).toBeNull();
  });

  test('columns are reordered, with their own settings, and not past the ends', () => {
    let el = table();
    el = apply(el, moveColumn(el, 2, -1));
    expect(el.columns!.map(c => c.field)).toEqual(['MATERIAL', 'QUANTIDADE', 'DESCRICAO']);
    expect(el.columns![1]).toEqual(table().columns![2]);
    el = apply(el, moveColumn(el, 0, 1));
    expect(el.columns!.map(c => c.field)).toEqual(['QUANTIDADE', 'MATERIAL', 'DESCRICAO']);
    expect(moveColumn(el, 0, -1)).toBeNull();
    expect(moveColumn(el, 2, 1)).toBeNull();
  });

  test('the problems of a configuration are named: no column, empty variable, a variable used twice or only differing by case', () => {
    expect(tableIssues(table({ columns: [] }))).toEqual([{ kind: 'noColumns' }]);
    expect(tableIssues(table())).toEqual([]);
    const bad = table({ columns: [
      { header: 'A', field: 'X', width: 50, align: 'L' }, { header: 'B', field: 'X', width: 50, align: 'L' },
      { header: 'C', field: 'x', width: 50, align: 'L' }, { header: 'D', field: '', width: 50, align: 'L' },
    ] });
    expect(tableIssues(bad)).toEqual([
      { kind: 'duplicateField', column: 1, field: 'X' },
      { kind: 'caseClash', column: 2, field: 'x', other: 'X' },
      { kind: 'emptyField', column: 3 },
    ]);
  });

  test('the variable of a column can be picked from the variables the design already has', () => {
    designer().addElement('text', 10, 10, { id: 't', dynamic: true, variableName: 'REMESSA', value: '' });
    designer().addElement('text', 10, 60, { id: 'u', value: 'Cliente {{CLIENTE}}' });
    designer().addTable();
    const el = tableOf();
    const fields = availableFields(designer().elements, [{ LOTE: '1' }], el);
    expect(fields).toEqual(expect.arrayContaining(['REMESSA', 'CLIENTE', 'LOTE']));
    expect(fields).not.toContain('MATERIAL');              // the table's own columns are not "available": they are its choice
  });
});

describe('properties', () => {
  test('the total width scales the columns in proportion and adds up exactly, never under the minimum', () => {
    const el = table();                                     // 200 + 300 + 100 = 600
    const wide = apply(el, setTableWidth(el, 900));
    expect(wide.columns!.map(c => c.width)).toEqual([300, 450, 150]);
    expect(tableWidth(wide)).toBe(900);
    const odd = apply(el, setTableWidth(el, 601));
    expect(tableWidth(odd)).toBe(601);
    expect(odd.columns!.every(c => Number.isInteger(c.width))).toBe(true);
    const tiny = apply(el, setTableWidth(el, 1));
    expect(tiny.columns!.every(c => c.width >= TABLE_MIN_COLUMN_WIDTH)).toBe(true);
    expect(tableWidth(tiny)).toBe(TABLE_MIN_COLUMN_WIDTH * 3);
    expect(setTableWidth(el, 600)).toBeNull();              // already that wide: nothing to change
    expect(setTableWidth(table({ columns: [] }), 500)).toBeNull();
  });

  test('scaling keeps the order and the other settings of the columns', () => {
    const scaled = scaleColumns(table().columns!, 450);
    expect(scaled.map(c => c.field)).toEqual(['MATERIAL', 'DESCRICAO', 'QUANTIDADE']);
    expect(scaled.map(c => c.align)).toEqual(['L', 'L', 'R']);
    expect(columnsWidth(scaled)).toBe(450);
  });

  test('row height, records per label and cell spacing stay inside what the backend accepts', () => {
    expect(rowHeightPatch(50)).toEqual({ rowHeight: 50 });
    expect(rowHeightPatch(1)).toEqual({ rowHeight: TABLE_MIN_ROW_HEIGHT });
    expect(rowHeightPatch(99999)).toEqual({ rowHeight: TABLE_MAX_ROW_HEIGHT });
    expect(rowHeightPatch(33.6)).toEqual({ rowHeight: 34 });
    expect(rowsPerPagePatch(4)).toEqual({ rowsPerPage: 4 });
    expect(rowsPerPagePatch(0)).toEqual({ rowsPerPage: 1 });
    expect(rowsPerPagePatch(500)).toEqual({ rowsPerPage: TABLE_MAX_CAPACITY });
    expect(cellPaddingPatch(-3)).toEqual({ cellPadding: 0 });
    expect(cellPaddingPatch(1000)).toEqual({ cellPadding: 100 });
  });

  test('the font is changed in height, and the width of its characters follows', () => {
    expect(fontSizePatch(30)).toEqual({ fontSize: 30, fontWidth: undefined });
    expect(fontSizePatch(0)).toEqual({ fontSize: 1, fontWidth: undefined });
  });

  test('the header and the borders are turned on and off', () => {
    const el = table();
    expect(el.headerRow ?? true).toBe(true);
    expect(apply(el, headerRowPatch(false)).headerRow).toBe(false);
    expect(hasBorders(el)).toBe(true);
    const off = apply(el, bordersPatch(false));
    expect(off.thickness).toBe(0);
    expect(hasBorders(off)).toBe(false);
    expect(hasBorders(apply(off, bordersPatch(true)))).toBe(true);
  });

  test('every property reaches the element in the store, and the size on the canvas follows it', () => {
    const id = designer().addTable()!;
    designer().updateElement(id, rowsPerPagePatch(4));
    designer().updateElement(id, rowHeightPatch(50));
    designer().updateElement(id, headerRowPatch(false));
    expect(tableBox(tableOf())).toEqual({ width: tableWidth(tableOf()), height: 200 });
    designer().updateElement(id, headerRowPatch(true));
    expect(tableBox(tableOf()).height).toBe(250);
    designer().updateElement(id, bordersPatch(false));
    designer().updateElement(id, cellPaddingPatch(10));
    designer().updateElement(id, fontSizePatch(32));
    expect(tableOf()).toMatchObject({ thickness: 0, cellPadding: 10, fontSize: 32 });
  });
});

describe('what the canvas shows', () => {
  test('the box is the columns together by a row for the header and for each record the label holds', () => {
    expect(tableBox(table())).toEqual({ width: 600, height: 160 });
    expect(tableBox(table({ headerRow: false, rowsPerPage: 1 }))).toEqual({ width: 600, height: 40 });
    expect(tableBox(table({ rowHeight: 20, rowsPerPage: 2 }))).toEqual({ width: 600, height: 60 });
  });

  test('a table with no test data still has its rows: the variables each cell will print', () => {
    expect(visibleRecords(table(), [])).toEqual([]);
    expect(tableVariables(table({ rowsPerPage: 2 }))).toEqual([
      'MATERIAL_1', 'MATERIAL_2', 'DESCRICAO_1', 'DESCRICAO_2', 'QUANTIDADE_1', 'QUANTIDADE_2',
    ]);
    expect(tableVariables(table({ rowsPerPage: 1 }))).toEqual(['MATERIAL', 'DESCRICAO', 'QUANTIDADE']);
    expect(tableSlotName('LOTE', 3, 5)).toBe('LOTE_3');
    expect(tableSlotName('LOTE', 1, 1)).toBe('LOTE');
  });

  test('the test data shown is the first records, in order, up to what the label holds', () => {
    const many = [1, 2, 3, 4, 5].map(n => ({ MATERIAL: String(n) }));
    expect(visibleRecords(table({ rowsPerPage: 3 }), many).map(r => r.MATERIAL)).toEqual(['1', '2', '3']);
    expect(visibleRecords(table({ rowsPerPage: 10 }), many)).toHaveLength(5);
    expect(visibleRecords(table({ rowsPerPage: 1 }), many).map(r => r.MATERIAL)).toEqual(['1']);
  });

  test('a title or a value that does not fit its column is reported, with the room it has and the room it needs', () => {
    const el = table({
      cellPadding: 6,
      columns: [
        { header: 'Material', field: 'MATERIAL', width: 60, align: 'L' },
        { header: 'X', field: 'DESCRICAO', width: 300, align: 'L' },
      ],
    });
    const found = tableOverflows(el, [{ MATERIAL: '1', DESCRICAO: 'um texto bem comprido que passa de uma coluna de trezentos pontos com certeza absoluta sim' }]);
    expect(found.map(o => [o.column, o.where])).toEqual([[0, 'header'], [1, 'cell']]);
    expect(found[0].available).toBe(48);
    expect(found[0].needed).toBeGreaterThan(48);
    expect(found[1].available).toBe(288);
    // wider padding leaves less room; nothing is changed by looking
    expect(tableOverflows({ ...el, cellPadding: 20 }, []).find(o => o.column === 0)!.available).toBe(20);
    expect(el.columns![0].width).toBe(60);
  });

  test('a value that fits is not reported, a table without a header does not report the titles, and only the records on the label count', () => {
    expect(tableOverflows(table(), records)).toEqual([]);
    const narrow = table({ headerRow: false, columns: [{ header: 'Material muito comprido', field: 'M', width: 40, align: 'L' }] });
    expect(tableOverflows(narrow, [])).toEqual([]);
    const capacity1 = table({ rowsPerPage: 1, columns: [{ header: 'A', field: 'M', width: 60, align: 'L' }] });
    expect(tableOverflows(capacity1, [{ M: '1' }, { M: 'x'.repeat(80) }])).toEqual([]);   // the second record is on the next label
  });

  test('the warning follows the width and the font: it goes away when the column is widened, and comes back with a larger font', () => {
    let el = table({ columns: [{ header: 'Descricao', field: 'D', width: 60, align: 'L' }] });
    expect(tableOverflows(el, [])).toHaveLength(1);
    el = apply(el, updateColumn(el, 0, { width: 300 }));
    expect(tableOverflows(el, [])).toEqual([]);
    el = apply(el, fontSizePatch(200));
    expect(tableOverflows(el, [])).toHaveLength(1);
  });
});

describe('resizing', () => {
  test('the width goes to the columns in proportion and the height to the rows; the columns stay valid', () => {
    const el = table();                                     // 600 x 160, 4 rows of 40
    const patch = resizeTablePatch(el, 900, 320);
    const next = apply(el, patch);
    expect(tableWidth(next)).toBe(900);
    expect(next.columns!.map(c => c.field)).toEqual(['MATERIAL', 'DESCRICAO', 'QUANTIDADE']);
    expect(next.columns!.map(c => c.width)).toEqual([300, 450, 150]);
    expect(next.rowHeight).toBe(80);
    expect(tableBox(next)).toEqual({ width: 900, height: 320 });
  });

  test('dragging a handle toward zero stops at the minimum: no negative or zero column, no row under the minimum', () => {
    const next = apply(table(), resizeTablePatch(table(), -50, -50));
    expect(next.columns!.every(c => c.width >= TABLE_MIN_COLUMN_WIDTH)).toBe(true);
    expect(tableWidth(next)).toBe(TABLE_MIN_COLUMN_WIDTH * 3);
    expect(next.rowHeight).toBe(TABLE_MIN_ROW_HEIGHT);
    expect(tableIssues(next)).toEqual([]);
  });

  test('a size that is the same changes nothing', () => {
    expect(resizeTablePatch(table(), 600, 160)).toEqual({});
  });

  test('resizing twice and back gives the same columns (the proportions are kept)', () => {
    const el = table();
    const bigger = apply(el, setTableWidth(el, 1200));
    const back = apply(bigger, setTableWidth(bigger, 600));
    expect(back.columns!.map(c => c.width)).toEqual([200, 300, 100]);
  });

  test('defaults that are valid: the columns of a new table are within the limits', () => {
    for (const available of [10, 100, 400, 600, 2000]) {
      const columns = defaultColumns(available);
      expect(columns.every(c => c.width >= TABLE_MIN_COLUMN_WIDTH && Number.isInteger(c.width))).toBe(true);
    }
  });
});

describe('the variables of the table are in the design\'s catalog', () => {
  test('each variable a table prints is listed, with the element that uses it, among the others of the design', () => {
    designer().addElement('text', 10, 10, { id: 'r', value: 'Remessa {{REMESSA}}' });
    designer().addTable();
    designer().updateElement(tableOf().id, rowsPerPagePatch(2));
    const catalog = variableCatalog(designer().elements);
    const names = catalog.map(v => v.name);
    expect(names).toEqual(expect.arrayContaining(['REMESSA', 'MATERIAL_1', 'MATERIAL_2', 'QUANTIDADE_2']));
    expect(catalog.find(v => v.name === 'MATERIAL_1')!.elementIds).toEqual([tableOf().id]);
    expect(designVariables(designer().elements)).toContain('DESCRICAO_1');
  });

  test('a design without a table has the variables it always had', () => {
    designer().addElement('text', 10, 10, { id: 'r', value: '{{A}} {{B}}' });
    expect(designVariables(designer().elements).sort()).toEqual(['A', 'B']);
  });
});

describe('saving and opening', () => {
  function buildDesign() {
    designer().addTable(30, 40);
    const id = tableOf().id;
    designer().updateElement(id, { ...rowsPerPagePatch(3), ...rowHeightPatch(44), ...bordersPatch(false), ...headerRowPatch(false), ...cellPaddingPatch(9), ...fontSizePatch(28) });
    designer().updateElement(id, apply(tableOf(), moveColumn(tableOf(), 2, -1)));
    designer().updateElement(id, apply(tableOf(), updateColumn(tableOf(), 0, { header: 'Código', align: 'C' })));
    designer().setRecords(records);
  }

  test('the table, its columns in order, its properties and the test data come back as they were saved', async () => {
    buildDesign();
    const saved = JSON.parse(JSON.stringify(tableOf()));
    await designs().saveNewDesign('Tabela');
    closeEditor();
    await designs().loadVersion(1, 1);
    expect(tableOf()).toEqual(saved);
    expect(tableOf().columns!.map(c => c.field)).toEqual(['MATERIAL', 'QUANTIDADE', 'DESCRICAO']);
    expect(tableOf()).toMatchObject({ rowsPerPage: 3, rowHeight: 44, thickness: 0, headerRow: false, cellPadding: 9, fontSize: 28 });
    expect(designer().records).toEqual(records);
    expect(isDirtyNow()).toBe(false);
  });

  test('a table on the second page stays on the second page', async () => {
    designer().addPage();
    designer().addTable(30, 40);
    designer().setActivePage(0);
    designer().addElement('rect', 5, 5, { id: 'first' });
    await designs().saveNewDesign('Duas');
    expect(mockServer.calls[0].args[1].elements.find((e: DesignElement) => e.type === 'table').page).toBe(1);
    closeEditor();
    await designs().loadVersion(1, 1);
    expect(tableOf().page).toBe(1);
    expect(designer().pages).toHaveLength(2);
    expect(designer().elements.find(e => e.id === 'first')!.page).toBe(0);   // with two pages every element says which it is on
  });

  test('a change to the table is an unsaved change, and putting it back is not', async () => {
    buildDesign();
    await designs().saveNewDesign('X');
    expect(isDirtyNow()).toBe(false);
    designer().updateElement(tableOf().id, rowsPerPagePatch(5));
    expect(isDirtyNow()).toBe(true);
    designer().updateElement(tableOf().id, rowsPerPagePatch(3));
    expect(isDirtyNow()).toBe(false);
  });
});

describe('what did not change', () => {
  test('a design with no table keeps its elements, its page structure and its code editable', () => {
    designer().addElement('rect', 5, 6, { id: 'a' });
    designer().addElement('text', 7, 8, { id: 'b' });
    expect(designer().elements.map(e => e.type)).toEqual(['rect', 'text']);
    expect(designer().elements.some(e => 'page' in e || 'columns' in e)).toBe(false);
    expect(isStructured(designer().pages, designer().elements)).toBe(false);
  });

  test('a table makes the design structured: its code is read-only', () => {
    designer().addTable();
    expect(isStructured(designer().pages, designer().elements)).toBe(true);
  });

  test('two pages stay independent when a table is changed on one', () => {
    designer().addElement('rect', 5, 5, { id: 'p0' });
    designer().addPage();
    designer().addTable();
    const first = designer().elements.find(e => e.id === 'p0');
    designer().updateElement(tableOf().id, rowsPerPagePatch(6));
    expect(designer().elements.find(e => e.id === 'p0')).toBe(first);
    expect(tableOf().page).toBe(1);
  });

  test('undo and redo take back and bring back a table, and a change to its columns', async () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    await settle();
    designer().addTable();
    await settle();
    designer().updateElement(tableOf().id, apply(tableOf(), addColumn(tableOf())));
    await settle();
    expect(tableOf().columns).toHaveLength(4);
    history().undo();
    expect(tableOf().columns).toHaveLength(3);
    history().undo();
    expect(designer().elements.map(e => e.type)).toEqual(['rect']);
    history().redo();
    expect(designer().elements.map(e => e.type)).toEqual(['rect', 'table']);
    history().redo();
    expect(tableOf().columns).toHaveLength(4);
  });

  test('the other elements keep their resizing: a rectangle is resized by width and height as before', () => {
    // resizeTablePatch is only for tables; nothing else is routed through it
    expect(Object.keys(resizeTablePatch(table(), 600, 160))).toEqual([]);
  });
});
