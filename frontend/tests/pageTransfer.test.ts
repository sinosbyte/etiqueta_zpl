// Etapa 2: moving and copying elements between the pages of a design. The plan (plain functions), the
// store (one change, one step of undo), the messages, saving and opening, and the Duplicate that now
// copies deeply. The designer store and the designs store are real; the network is a small fake.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockServer = { designs: new Map<number, any[]>(), nextId: 1, zpl: [] as any[] };

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => {
    mockServer.zpl.push(JSON.parse(JSON.stringify(payload)));
    return `ZPL(${payload.elements.length} elements, ${payload.pages ? payload.pages.length : 1} page)`;
  }),
  parseZpl: jest.fn(),
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
    apiCreateDesign: jest.fn(async (_name: string, payload: any) => {
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

// elementBox measures text with a canvas; none of these tests needs real measures
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { EMPTY_SIGNATURE } from '../src/utils/unsaved';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useToastStore } from '../src/store/useToastStore';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { useLangStore } from '../src/i18n';
import { DesignElement } from '../src/types';
import { cloneElement, planTransfer } from '../src/utils/pageTransfer';
import { elementLabel, requestTransfer, transferMessage } from '../src/utils/pageTransferActions';
import { boundsIssue } from '../src/utils/labelBounds';

const designer = () => useDesignerStore.getState();
const designs = () => useDesignsStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const pastCount = () => history().pastStates.length;
// A setup is a change like any other: let the history keep its step, then forget it, so only what a test does is counted
const clearHistory = () => { jest.advanceTimersByTime(400); history().clear(); };
const undo = () => history().undo();
const redo = () => history().redo();
const settle = () => jest.advanceTimersByTimeAsync(400);

const rect = (id: string, extra: Partial<DesignElement> = {}): DesignElement =>
  ({ id, type: 'rect', x: 10, y: 20, width: 100, height: 50, ...extra });

const table = (id = 'tab', extra: Partial<DesignElement> = {}): DesignElement => ({
  id, type: 'table', x: 40, y: 100, width: 0, height: 0, rowsPerPage: 3, rowHeight: 36, headerRow: true, cellPadding: 5, fontSize: 22,
  columns: [
    { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' },
    { header: 'Qtd', field: 'QTD', width: 100, align: 'R' },
  ],
  ...extra,
});

// One of each kind of element the editor draws, with the properties that belong to it set
const RICH: DesignElement[] = [
  { id: 'text', type: 'text', x: 11, y: 12, width: 300, height: 40, value: 'Calçado {{QTD}}', fontSize: 34, fontWidth: 28, fontName: '0', fontSource: 'cf', reversed: true,
    orientation: 'N', hexUtf8: true, origin: 'FT', block: { maxLines: 3, lineSpacing: 2, justify: 'C', hangingIndent: 4 }, futureField: { nested: [1, { deep: true }] } } as any,
  { id: 'var', type: 'text', x: 5, y: 6, width: 100, height: 30, dynamic: true, variableName: 'UC', fontSize: 30, fontName: '0' },
  { id: 'bc', type: 'barcode128', x: 20, y: 200, width: 268, height: 100, value: '{{SSCC}}', moduleWidth: 3, expectedChars: 20, codeSet: 'C', codeAuto: false, printLine: false, orientation: 'R' },
  { id: 'i25', type: 'barcodeI2of5', x: 30, y: 210, width: 270, height: 90, value: '12345678', moduleWidth: 2, ratio: 3, checkDigit: true, lineAbove: true },
  { id: 'qr', type: 'qrcode', x: 40, y: 220, width: 100, height: 100, value: 'https://example.com/{{ID}}', qrMagnification: 6, qrErrorCorrection: 'H' },
  { id: 'dm', type: 'datamatrix', x: 50, y: 230, width: 48, height: 48, value: '1234567890', dmModuleSize: 5, dmSize: 24 },
  { id: 'box', type: 'rect', x: 60, y: 240, width: 200, height: 100, thickness: 6, color: 'W', rounding: 3, filled: false },
  { id: 'line', type: 'line', x: 70, y: 250, width: 300, height: 4 },
  { id: 'img', type: 'image', x: 80, y: 260, width: 64, height: 8, value: 'FF00FF00'.repeat(8), bytesPerRow: 8 },
  table('tbl', { thickness: 0 }),
];

const withPage = (el: DesignElement, page: number): DesignElement => ({ ...el, page });
const ids = (list: DesignElement[]) => list.map(e => e.id);
const on = (page: number) => designer().elements.filter(e => (e.page ?? 0) === page);

let counter = 0;
const makeId = () => `new-${++counter}`;

function closeEditor() {
  useDesignerStore.setState({
    elements: [], labelWidth: 800, labelHeight: 1200, selectedId: null, selectedIds: [], sampleValues: {}, zplCode: '^XA\n^PW800\n^LL1200\n^XZ',
    pages: [{ mode: 'first' }], activePage: 0, records: [],
  });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  clearHistory();
}

/** A design of two pages: page 1 has a, b, c (and the table when asked); page 2 has x. */
function twoPages(withTable = false) {
  useDesignerStore.setState({
    labelWidth: 800, labelHeight: 600, pages: [{ mode: 'first' }, { mode: 'repeat' }], activePage: 0, selectedId: null, selectedIds: [],
    elements: [
      withPage(rect('a', { x: 11, y: 12 }), 0), withPage(rect('b', { x: 21, y: 22 }), 0), withPage(rect('c', { x: 31, y: 32 }), 0),
      ...(withTable ? [withPage(table('t1'), 0)] : []),
      withPage(rect('x', { x: 41, y: 42 }), 1),
    ],
  });
  clearHistory();
}
const select = (...list: string[]) => useDesignerStore.setState({ selectedIds: list, selectedId: list[list.length - 1] ?? null });

beforeEach(() => {
  jest.useFakeTimers();
  mockServer.designs.clear(); mockServer.nextId = 1; mockServer.zpl.length = 0; counter = 0;
  useToastStore.setState({ toasts: [] });
  useLangStore.setState({ lang: 'pt-BR' });
  closeEditor();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('planTransfer: moving', () => {
  const base = [withPage(rect('a'), 0), withPage(rect('b'), 0), withPage(rect('x'), 1)];

  test('1. page 1 to page 2: same id, now on page 2, the others untouched', () => {
    const plan = planTransfer(base, ['a'], 1, 'move', makeId);
    expect(plan.refused).toEqual([]);
    expect(plan.done.map(e => [e.id, e.page])).toEqual([['a', 1]]);
    expect(plan.elements.find(e => e.id === 'b')).toBe(base[1]);   // not even a new object
    expect(plan.elements.find(e => e.id === 'x')).toBe(base[2]);
    expect(plan.elements).toHaveLength(3);
  });

  test('2. page 2 to page 1', () => {
    const plan = planTransfer(base, ['x'], 0, 'move', makeId);
    expect(plan.done.map(e => [e.id, e.page])).toEqual([['x', 0]]);
    expect(plan.elements.filter(e => e.page === 0).map(e => e.id).sort()).toEqual(['a', 'b', 'x']);
  });

  test('the moved elements go on top of the target page, in the order they had among themselves', () => {
    const list = [withPage(rect('a'), 0), withPage(rect('x'), 1), withPage(rect('b'), 0), withPage(rect('y'), 1), withPage(rect('c'), 0)];
    // selected in the reverse order: the order of the layers decides, not the order of the clicks
    const plan = planTransfer(list, ['c', 'a'], 1, 'move', makeId);
    expect(ids(plan.elements.filter(e => e.page === 1))).toEqual(['x', 'y', 'a', 'c']);
    expect(ids(plan.elements.filter(e => e.page === 0))).toEqual(['b']);
    expect(ids(plan.done)).toEqual(['a', 'c']);
  });

  test('nothing is lost or repeated: the same ids before and after', () => {
    const plan = planTransfer(base, ['a', 'b'], 1, 'move', makeId);
    expect(ids(plan.elements).sort()).toEqual(['a', 'b', 'x']);
  });

  test('every property stays as it was; only the page changes (a property no version knows included)', () => {
    for (const el of RICH.filter(e => e.type !== 'table')) {
      const plan = planTransfer([withPage(el, 0)], [el.id], 1, 'move', makeId);
      expect(plan.done[0]).toEqual({ ...el, page: 1 });
    }
  });
});

describe('planTransfer: copying', () => {
  const base = [withPage(rect('a'), 0), withPage(rect('x'), 1)];

  test('3. the original stays and a copy appears on the other page, at the same position', () => {
    const plan = planTransfer(base, ['a'], 1, 'copy', makeId);
    expect(plan.elements).toHaveLength(3);
    expect(plan.elements[0]).toBe(base[0]);
    expect(plan.done).toHaveLength(1);
    expect(plan.done[0]).toMatchObject({ type: 'rect', x: 10, y: 20, width: 100, height: 50, page: 1 });
  });

  test('4. the copies have ids of their own, never one in use', () => {
    const taken = [withPage(rect('a'), 0), withPage(rect('new-1'), 1), withPage(rect('new-2'), 1)];
    const plan = planTransfer(taken, ['a'], 1, 'copy', makeId);
    expect(plan.done[0].id).toBe('new-3');
    const all = ids(plan.elements);
    expect(new Set(all).size).toBe(all.length);
  });

  test('several copies get different ids and keep their order among themselves', () => {
    const plan = planTransfer([withPage(rect('a'), 0), withPage(rect('b'), 0)], ['b', 'a'], 1, 'copy', makeId);
    expect(plan.done.map(e => e.x)).toEqual([10, 10]);
    expect(new Set(ids(plan.done)).size).toBe(2);
    // the layers order of the originals: a below b
    expect(plan.done.map(e => (e as any).value ?? e.id).length).toBe(2);
    expect(ids(plan.elements.slice(2))).toEqual(ids(plan.done));
  });

  test('5. the copy shares nothing with the original: changing what is inside it leaves the original as it was', () => {
    const text = RICH[0];
    const tbl = RICH[RICH.length - 1];
    const plan = planTransfer([withPage(text, 0), withPage(tbl, 0)], ['text', 'tbl'], 1, 'copy', makeId);
    const [textCopy, tableCopy] = plan.done as any[];
    expect(textCopy.block).not.toBe(text.block);
    expect(tableCopy.columns).not.toBe(tbl.columns);
    expect(tableCopy.columns[0]).not.toBe(tbl.columns![0]);
    expect(textCopy.futureField.nested[1]).not.toBe((text as any).futureField.nested[1]);

    textCopy.block.maxLines = 9;
    tableCopy.columns[0].header = 'CHANGED';
    tableCopy.columns[1].width = 1;
    textCopy.futureField.nested[1].deep = false;
    expect(text.block!.maxLines).toBe(3);
    expect(tbl.columns![0].header).toBe('Material');
    expect(tbl.columns![1].width).toBe(100);
    expect((text as any).futureField.nested[1].deep).toBe(true);
  });

  test('6/7/8. every property of every kind of element is in the copy, variables included', () => {
    for (const el of RICH) {
      const plan = planTransfer([withPage(el, 0)], [el.id], 1, 'copy', makeId);
      const { id: _id, page: _page, ...rest } = plan.done[0] as any;
      const { id: _oid, page: _opage, ...original } = el as any;
      expect(rest).toEqual(original);
      expect(plan.done[0].id).not.toBe(el.id);
      expect(plan.done[0].page).toBe(1);
    }
    // the variables: a dynamic field, a marker inside a text, in a barcode, in a QR, and the fields of a table
    const copies = planTransfer(RICH.map(e => withPage(e, 0)), ids(RICH), 1, 'copy', makeId).done as any[];
    const get = (i: string) => copies[ids(RICH).indexOf(i)];
    expect(get('var')).toMatchObject({ dynamic: true, variableName: 'UC' });
    expect(get('text').value).toBe('Calçado {{QTD}}');
    expect(get('bc').value).toBe('{{SSCC}}');
    expect(get('qr').value).toContain('{{ID}}');
    expect(get('tbl').columns.map((c: any) => c.field)).toEqual(['MATERIAL', 'QTD']);
  });

  test('cloneElement keeps what is undefined and what is nested', () => {
    const el = { ...rect('a'), color: undefined, block: { maxLines: 1, lineSpacing: 0, justify: 'L', hangingIndent: 0 } } as DesignElement;
    const copy = cloneElement(el);
    expect(copy).toEqual(el);
    expect(copy).not.toBe(el);
    expect(copy.block).not.toBe(el.block);
  });
});

describe('planTransfer: tables and refusals', () => {
  test('a table goes to a page that has none, with its columns and capacity', () => {
    const list = [withPage(table('t'), 0), withPage(rect('x'), 1)];
    const moved = planTransfer(list, ['t'], 1, 'move', makeId);
    expect(moved.refused).toEqual([]);
    expect(moved.done[0]).toMatchObject({ id: 't', page: 1, rowsPerPage: 3 });
    const copied = planTransfer(list, ['t'], 1, 'copy', makeId);
    expect(copied.elements.filter(e => e.type === 'table').map(e => e.page).sort()).toEqual([0, 1]);
  });

  test('a page that already has a table does not take a second one, and the rest of the selection goes anyway', () => {
    const list = [withPage(table('t0'), 0), withPage(rect('a'), 0), withPage(table('t1'), 1)];
    for (const mode of ['move', 'copy'] as const) {
      const plan = planTransfer(list, ['t0', 'a'], 1, mode, makeId);
      expect(plan.refused.map(r => [r.element.id, r.reason])).toEqual([['t0', 'tableOnDestination']]);
      expect(plan.done.map(e => e.type)).toEqual(['rect']);
      // no table lost or made twice: still one on each page
      expect(plan.elements.filter(e => e.type === 'table').map(e => [e.id, e.page]).sort()).toEqual([['t0', 0], ['t1', 1]]);
    }
  });

  test('if nothing can be transferred the list is the very same one', () => {
    const list = [withPage(table('t0'), 0), withPage(table('t1'), 1)];
    const plan = planTransfer(list, ['t0'], 1, 'copy', makeId);
    expect(plan.done).toEqual([]);
    expect(plan.elements).toBe(list);
  });

  test('an element already on the target page is refused', () => {
    const list = [withPage(rect('a'), 0), withPage(rect('x'), 1)];
    const plan = planTransfer(list, ['x', 'a'], 1, 'move', makeId);
    expect(plan.refused.map(r => [r.element.id, r.reason])).toEqual([['x', 'samePage']]);
    expect(ids(plan.done)).toEqual(['a']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('store: moving', () => {
  test('moves the selection, shows the other page, selects what moved and asks for the ZPL again', async () => {
    twoPages();
    select('b');
    const plan = designer().moveSelectedToPage(1)!;
    expect(ids(plan.done)).toEqual(['b']);
    expect(ids(on(0))).toEqual(['a', 'c']);
    expect(ids(on(1))).toEqual(['x', 'b']);
    expect(designer().activePage).toBe(1);
    expect(designer().selectedIds).toEqual(['b']);
    expect(designer().selectedId).toBe('b');
    await settle();
    expect(mockServer.zpl.length).toBeGreaterThan(0);
    expect(mockServer.zpl[mockServer.zpl.length - 1].pages).toHaveLength(2);
  });

  test('the coordinates stay: the label is the same size on both pages', () => {
    twoPages();
    select('b');
    designer().moveSelectedToPage(1);
    expect(designer().elements.find(e => e.id === 'b')).toMatchObject({ x: 21, y: 22, width: 100, height: 50, page: 1 });
    expect([designer().labelWidth, designer().labelHeight]).toEqual([800, 600]);
  });

  test('page 2 to page 1', () => {
    twoPages();
    useDesignerStore.setState({ activePage: 1 });
    select('x');
    designer().moveSelectedToPage(0);
    expect(ids(on(0))).toEqual(['a', 'b', 'c', 'x']);
    expect(ids(on(1))).toEqual([]);
    expect(designer().activePage).toBe(0);
  });

  test('several at once are one step', () => {
    twoPages();
    select('a', 'c');
    const before = pastCount();
    designer().moveSelectedToPage(1);
    expect(pastCount()).toBe(before + 1);
    expect(ids(on(1))).toEqual(['x', 'a', 'c']);
    undo();
    expect(ids(on(0))).toEqual(['a', 'b', 'c']);
  });

  test('the page it came from is not touched', () => {
    twoPages();
    const before = JSON.stringify(on(1));
    select('a');
    designer().moveSelectedToPage(1);
    expect(JSON.stringify(on(1).filter(e => e.id === 'x'))).toBe(JSON.stringify(JSON.parse(before)));
  });

  test('9. undo takes the element back to its page, and the page being edited; redo moves it again', () => {
    twoPages();
    select('b');
    designer().moveSelectedToPage(1);
    undo();
    expect(ids(on(0))).toEqual(['a', 'b', 'c']);
    expect(ids(on(1))).toEqual(['x']);
    expect(designer().activePage).toBe(0);
    expect(designer().elements.find(e => e.id === 'b')).toMatchObject({ page: 0, x: 21, y: 22 });
    redo();
    expect(ids(on(1))).toEqual(['x', 'b']);
    expect(designer().activePage).toBe(1);
    expect(designer().elements.find(e => e.id === 'b')).toMatchObject({ page: 1, x: 21, y: 22 });
  });

  test('marks the design as not saved', async () => {
    twoPages();
    await designs().saveNewDesign('D');
    expect(isDirtyNow()).toBe(false);
    select('a');
    designer().moveSelectedToPage(1);
    expect(isDirtyNow()).toBe(true);
    undo();
    expect(isDirtyNow()).toBe(false);
  });
});

describe('store: copying', () => {
  test('keeps the original, adds an independent copy on the other page and selects it', () => {
    twoPages();
    select('a');
    const plan = designer().copySelectedToPage(1)!;
    const copy = plan.done[0];
    expect(copy.id).not.toBe('a');
    expect(ids(on(0))).toEqual(['a', 'b', 'c']);
    expect(ids(on(1))).toEqual(['x', copy.id]);
    expect(designer().activePage).toBe(1);
    expect(designer().selectedIds).toEqual([copy.id]);
    expect(copy).toMatchObject({ x: 11, y: 12, width: 100, height: 50, page: 1 });

    // changing the copy leaves the original as it was, and the other way round
    designer().updateElement(copy.id, { x: 500, width: 7 });
    expect(designer().elements.find(e => e.id === 'a')).toMatchObject({ x: 11, width: 100, page: 0 });
    designer().updateElement('a', { y: 900 });
    expect(designer().elements.find(e => e.id === copy.id)).toMatchObject({ x: 500, y: 12, width: 7 });
  });

  test('10. undo removes the copy; redo brings it back with the same id and properties', () => {
    twoPages();
    select('a');
    const copy = designer().copySelectedToPage(1)!.done[0];
    const snapshot = JSON.parse(JSON.stringify(copy));
    undo();
    expect(ids(designer().elements)).toEqual(['a', 'b', 'c', 'x']);
    redo();
    const back = designer().elements.find(e => e.id === copy.id);
    expect(back).toEqual(snapshot);
    expect(designer().elements).toHaveLength(5);
  });

  test('copies several, tables included when the other page has none', () => {
    twoPages(true);
    select('a', 't1');
    const plan = designer().copySelectedToPage(1)!;
    expect(plan.done.map(e => e.type)).toEqual(['rect', 'table']);
    expect(designer().elements.filter(e => e.type === 'table')).toHaveLength(2);
    const copy = designer().elements.find(e => e.type === 'table' && e.page === 1) as any;
    const original = designer().elements.find(e => e.id === 't1') as any;
    expect(copy.columns).toEqual(original.columns);
    expect(copy.columns).not.toBe(original.columns);
  });
});

describe('store: every operation is a step of its own, however soon it comes', () => {
  test('11. two moves in a row, with no time between them, are two steps that undo one at a time', () => {
    twoPages();
    select('a');
    designer().moveSelectedToPage(1);
    select('b');           // the page being edited is now 2, the selection is by id: b is on page 1
    designer().moveSelectedToPage(1);
    expect(pastCount()).toBe(2);
    expect(ids(on(1))).toEqual(['x', 'a', 'b']);
    undo();
    expect(ids(on(1))).toEqual(['x', 'a']);
    expect(ids(on(0))).toEqual(['b', 'c']);
    undo();
    expect(ids(on(1))).toEqual(['x']);
    expect(ids(on(0))).toEqual(['a', 'b', 'c']);
    expect(pastCount()).toBe(0);
  });

  test('a copy and then a move, back to back, are two steps', () => {
    twoPages();
    select('a');
    const copy = designer().copySelectedToPage(1)!.done[0];
    select('b');
    designer().moveSelectedToPage(1);
    expect(pastCount()).toBe(2);
    undo();                                   // the move
    expect(ids(designer().elements).sort()).toEqual(['a', 'b', 'c', copy.id, 'x'].sort());
    expect(designer().elements.find(e => e.id === 'b')!.page).toBe(0);
    undo();                                   // the copy
    expect(ids(designer().elements).sort()).toEqual(['a', 'b', 'c', 'x']);
    redo();
    redo();
    expect(designer().elements.find(e => e.id === copy.id)).toBeDefined();
    expect(designer().elements.find(e => e.id === 'b')!.page).toBe(1);
  });

  test('an edit just before is kept as its own step, not joined to the move', () => {
    twoPages();
    designer().updateElement('a', { x: 99 });      // waiting out the 300 ms
    select('a');
    designer().moveSelectedToPage(1);
    expect(pastCount()).toBe(2);
    undo();                                       // only the move
    expect(designer().elements.find(e => e.id === 'a')).toMatchObject({ x: 99, page: 0 });
    undo();                                       // then the edit
    expect(designer().elements.find(e => e.id === 'a')).toMatchObject({ x: 11, page: 0 });
  });

  test('the step is there at once: it does not wait for the delay, and the delay does not add another', async () => {
    twoPages();
    select('a');
    designer().moveSelectedToPage(1);
    expect(pastCount()).toBe(1);
    await settle();
    expect(pastCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(pastCount()).toBe(1);
  });

  test('an edit right after a move is a step of its own too', async () => {
    twoPages();
    select('a');
    designer().moveSelectedToPage(1);
    designer().updateElement('a', { x: 77 });
    await settle();
    expect(pastCount()).toBe(2);
    undo();
    expect(designer().elements.find(e => e.id === 'a')).toMatchObject({ x: 11, page: 1 });
    undo();
    expect(designer().elements.find(e => e.id === 'a')).toMatchObject({ page: 0 });
  });

  test('a new operation clears what was undone, as any change does', () => {
    twoPages();
    select('a');
    designer().moveSelectedToPage(1);
    undo();
    expect(history().futureStates).toHaveLength(1);
    select('b');
    designer().copySelectedToPage(1);
    expect(history().futureStates).toHaveLength(0);
  });

  test('the rest of the history is as it was: two ordinary edits in 300 ms are still one step', async () => {
    twoPages();
    designer().updateElement('a', { x: 1 });
    designer().updateElement('a', { x: 2 });
    await settle();
    expect(pastCount()).toBe(1);
    designer().updateElement('a', { x: 3 });
    await settle();
    expect(pastCount()).toBe(2);
    undo();
    expect(designer().elements.find(e => e.id === 'a')!.x).toBe(2);
  });

  test('the history keeps its limit of 100 steps', () => {
    twoPages();
    for (let i = 0; i < 105; i++) {
      select('a');
      designer().moveSelectedToPage(i % 2 === 0 ? 1 : 0);
    }
    expect(pastCount()).toBe(100);
  });

  test('while the history is paused a transfer is not recorded (as no other change is)', () => {
    twoPages();
    history().pause();
    select('a');
    designer().moveSelectedToPage(1);
    history().resume();
    expect(pastCount()).toBe(0);
    expect(ids(on(1))).toEqual(['x', 'a']);
  });
});

describe('store: refusals and nothing to do', () => {
  test('a table the other page has no room for is left, the rest goes, and it is one step', () => {
    twoPages(true);
    useDesignerStore.setState({ elements: [...designer().elements, withPage(table('t2'), 1)] });
    clearHistory();
    select('t1', 'a');
    const plan = designer().moveSelectedToPage(1)!;
    expect(plan.refused.map(r => [r.element.id, r.reason])).toEqual([['t1', 'tableOnDestination']]);
    expect(designer().elements.filter(e => e.type === 'table').map(e => [e.id, e.page]).sort()).toEqual([['t1', 0], ['t2', 1]]);
    expect(designer().elements.find(e => e.id === 'a')!.page).toBe(1);
    expect(pastCount()).toBe(1);
  });

  test('when nothing can be done nothing changes: no step, same page, same list', () => {
    twoPages(true);
    useDesignerStore.setState({ elements: [...designer().elements, withPage(table('t2'), 1)] });
    clearHistory();
    const list = designer().elements;
    select('t1');
    const plan = designer().copySelectedToPage(1)!;
    expect(plan.done).toEqual([]);
    expect(designer().elements).toBe(list);
    expect(designer().activePage).toBe(0);
    expect(pastCount()).toBe(0);
  });

  test('no selection, or a page that does not exist, does nothing', () => {
    twoPages();
    expect(designer().moveSelectedToPage(1)).toBeNull();
    select('a');
    expect(designer().moveSelectedToPage(2)).toBeNull();
    expect(designer().copySelectedToPage(-1)).toBeNull();
    expect(designer().copySelectedToPage(1.5)).toBeNull();
    expect(pastCount()).toBe(0);
  });

  test('15. a design of one page has no page to go to', () => {
    designer().addElement('rect', 5, 5, { id: 'only' });
    designer().selectElement('only');
    expect(designer().moveSelectedToPage(1)).toBeNull();
    expect(designer().copySelectedToPage(0)?.done ?? []).toEqual([]);
    expect(designer().elements).toHaveLength(1);
    expect(designer().elements[0].page).toBeUndefined();
  });
});

describe('13. the label-limit warnings keep working after a transfer', () => {
  test('an element that is out of the label is still reported on the other page, and nothing is moved to fit', () => {
    twoPages();
    useDesignerStore.setState({ elements: designer().elements.map(e => (e.id === 'a' ? { ...e, x: 760, y: 580 } : e)) });
    select('a');
    designer().copySelectedToPage(1);
    const copy = designer().elements.find(e => e.id !== 'a' && e.x === 760)!;
    expect(copy).toMatchObject({ x: 760, y: 580, page: 1 });                   // not moved to fit
    expect(boundsIssue(copy, 800, 600)).toMatchObject({ right: 60, bottom: 30 });
    expect(boundsIssue(designer().elements.find(e => e.id === 'a')!, 800, 600)).not.toBeNull();
  });

  test('a table too tall for the label is refused nothing: it goes and is reported there', () => {
    twoPages();
    useDesignerStore.setState({ elements: [...designer().elements, withPage(table('big', { rowsPerPage: 30 }), 0)] });
    select('big');
    const plan = designer().moveSelectedToPage(1)!;
    expect(plan.refused).toEqual([]);
    const moved = designer().elements.find(e => e.id === 'big')!;
    expect(moved.page).toBe(1);
    expect(boundsIssue(moved, 800, 600)).toMatchObject({ bottom: expect.any(Number) });
  });
});

describe('12. pages and the size of the label', () => {
  test('all the pages share the size of the label, so a transfer never rescales or moves an element', () => {
    twoPages();
    select('a', 'b', 'c');
    const before = designer().elements.filter(e => ['a', 'b', 'c'].includes(e.id)).map(e => [e.id, e.x, e.y, e.width, e.height]);
    designer().moveSelectedToPage(1);
    const after = designer().elements.filter(e => ['a', 'b', 'c'].includes(e.id)).map(e => [e.id, e.x, e.y, e.width, e.height]);
    expect(after).toEqual(before);
    designer().setLabelSize(400, 300);
    expect([designer().labelWidth, designer().labelHeight]).toEqual([400, 300]);   // one size for both pages
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('14. the other pages are not touched', () => {
  test('moving or copying leaves every other element exactly as it was (same objects)', () => {
    twoPages(true);
    const before = new Map(designer().elements.map(e => [e.id, e]));
    select('b');
    designer().copySelectedToPage(1);
    select('c');
    designer().moveSelectedToPage(1);
    for (const id of ['a', 'b', 't1', 'x']) expect(designer().elements.find(e => e.id === id)).toBe(before.get(id));
  });

  test('records, test values and the other settings of the design are not changed', () => {
    twoPages(true);
    useDesignerStore.setState({ records: [{ MATERIAL: '1' }], sampleValues: { A: 'b' }, zoom: 1.5 });
    select('a');
    designer().copySelectedToPage(1);
    expect(designer().records).toEqual([{ MATERIAL: '1' }]);
    expect(designer().sampleValues).toEqual({ A: 'b' });
    expect(designer().pages).toEqual([{ mode: 'first' }, { mode: 'repeat' }]);
    expect(designer().zoom).toBe(1.5);
  });
});

describe('persistence: save, close and open', () => {
  test('move and copy, save, close, open: every element on its page, nothing lost or repeated, copies independent', async () => {
    twoPages(true);
    select('a');
    const copy = designer().copySelectedToPage(1)!.done[0];
    select('b');
    designer().moveSelectedToPage(1);
    const expected = designer().elements.map(e => JSON.parse(JSON.stringify(e)));
    await designs().saveNewDesign('Two pages');
    const id = designs().activeDesignId!;

    const sent = mockServer.designs.get(id)![0];
    expect(sent.pagesConfig.pages).toHaveLength(2);
    expect(sent.elements.map((e: any) => [e.id, e.page ?? 0]).sort()).toEqual(expected.map(e => [e.id, e.page ?? 0]).sort());

    closeEditor();
    expect(designer().elements).toHaveLength(0);
    await designs().loadVersion(id, 1);

    expect(designer().pages).toHaveLength(2);
    expect(designer().elements).toEqual(expected);
    expect(isDirtyNow()).toBe(false);
    const all = ids(designer().elements);
    expect(new Set(all).size).toBe(all.length);
    expect(designer().elements.filter(e => e.type === 'table')).toHaveLength(1);

    // the copy is still its own element after the round trip
    designer().updateElement(copy.id, { x: 123 });
    expect(designer().elements.find(e => e.id === 'a')!.x).toBe(11);
    expect(isDirtyNow()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('what the user is told', () => {
  const t0 = withPage(table('t0'), 0);
  const list = [t0, withPage(rect('a'), 0), withPage({ id: 'txt', type: 'text', x: 1, y: 1, width: 10, height: 10, value: 'Hello world' }, 0), withPage(table('t1'), 1)];

  test('everything moved: success, singular and plural', () => {
    expect(transferMessage(planTransfer(list, ['a'], 1, 'move', makeId))).toEqual({ type: 'success', text: 'Elemento movido para a página 2.' });
    expect(transferMessage(planTransfer(list, ['a', 'txt'], 1, 'move', makeId))).toEqual({ type: 'success', text: '2 elementos movidos para a página 2.' });
    expect(transferMessage(planTransfer(list, ['a'], 1, 'copy', makeId)).text).toBe('Elemento copiado para a página 2.');
    expect(transferMessage(planTransfer(list, ['a', 'txt'], 1, 'copy', makeId)).text).toBe('2 elementos copiados para a página 2.');
  });

  test('only part: says what was done and what was refused, with the reason', () => {
    const message = transferMessage(planTransfer(list, ['t0', 'txt'], 1, 'copy', makeId));
    expect(message.type).toBe('info');
    expect(message.text).toBe('Elemento copiado para a página 2. Recusado: Tabela (a página 2 já tem uma tabela e cada página aceita uma).');
  });

  test('nothing: an error that says why', () => {
    const message = transferMessage(planTransfer(list, ['t0'], 1, 'move', makeId));
    expect(message.type).toBe('error');
    expect(message.text).toBe('Nada foi movido. Recusado: Tabela (a página 2 já tem uma tabela e cada página aceita uma).');
  });

  test('several refused are all named, a text by its content', () => {
    const more = [...list, withPage(table('t9'), 0)];
    const plan = planTransfer(more.filter(e => e.id !== 't0'), ['t9', 'txt'], 1, 'copy', makeId);
    expect(plan.refused).toHaveLength(1);
    expect(elementLabel(list[2])).toBe('Texto "Hello world"');
    expect(elementLabel({ ...list[2], value: 'A very long text that does not fit in a message' })).toBe('Texto "A very long text that do…"');
  });

  test('in English', () => {
    useLangStore.setState({ lang: 'en' });
    expect(transferMessage(planTransfer(list, ['a'], 1, 'move', makeId)).text).toBe('Element moved to page 2.');
    expect(transferMessage(planTransfer(list, ['t0', 'txt'], 1, 'move', makeId)).text)
      .toBe('Element moved to page 2. Refused: Table (page 2 already has a table and each page takes one).');
  });

  test('requestTransfer shows the toast and does the operation', () => {
    twoPages(true);
    select('a', 't1');
    useDesignerStore.setState({ elements: [...designer().elements, withPage(table('t2'), 1)] });
    clearHistory();
    const plan = requestTransfer('move', 1)!;
    expect(ids(plan.done)).toEqual(['a']);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('info');
    expect(toasts[0].message).toContain('Elemento movido para a página 2.');
    expect(toasts[0].message).toContain('Recusado: Tabela');
    expect(requestTransfer('move', 1)).not.toBeNull();   // the selection is still there: it is the page it is on that decides
  });

  test('requestTransfer with nothing selected says nothing and does nothing', () => {
    twoPages();
    expect(requestTransfer('copy', 1)).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  test('the texts exist in both languages', () => {
    const keys = ['transfer.title', 'transfer.on1', 'transfer.onN', 'transfer.move', 'transfer.copy', 'transfer.moved1', 'transfer.movedN',
      'transfer.copied1', 'transfer.copiedN', 'transfer.noneMove', 'transfer.noneCopy', 'transfer.refused', 'transfer.refusedItem',
      'transfer.reason.tableOnDestination', 'transfer.reason.samePage'] as const;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { translate } = require('../src/i18n');
    for (const lang of ['pt-BR', 'en']) for (const key of keys) expect(translate(lang, key)).not.toBe(key);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Duplicate copies deeply and behaves as before', () => {
  test('a duplicated text does not share its block, and the new element is 16 dots away with a new id', () => {
    designer().addElement('text', 50, 60, { id: 'txt', value: 'Hi', block: { maxLines: 2, lineSpacing: 1, justify: 'L', hangingIndent: 0 } });
    designer().selectElement('txt');
    designer().duplicateSelected();
    const [original, copy] = designer().elements as any[];
    expect(copy.id).not.toBe('txt');
    expect([copy.x, copy.y]).toEqual([66, 76]);
    expect(copy.block).toEqual(original.block);
    expect(copy.block).not.toBe(original.block);
    copy.block.maxLines = 9;
    expect(original.block.maxLines).toBe(2);
    expect(designer().selectedIds).toEqual([copy.id]);
  });

  test('several are duplicated together, in order, a table is not, and the page is the one they are on', () => {
    twoPages(true);
    useDesignerStore.setState({ activePage: 0 });
    select('a', 't1', 'b');
    designer().duplicateSelected();
    const copies = designer().elements.slice(-2);
    expect(copies.map(e => [e.x, e.y, e.page])).toEqual([[27, 28, 0], [37, 38, 0]]);
    expect(designer().elements.filter(e => e.type === 'table')).toHaveLength(1);
    expect(designer().selectedIds).toEqual(copies.map(e => e.id));
  });

  test('a design of one page is duplicated as it always was: no page field appears', () => {
    designer().addElement('rect', 10, 10, { id: 'r' });
    designer().selectElement('r');
    designer().duplicateSelected();
    expect(designer().elements).toHaveLength(2);
    expect(designer().elements.every(e => e.page === undefined)).toBe(true);
    expect(designer().pages).toEqual([{ mode: 'first' }]);
  });
});
