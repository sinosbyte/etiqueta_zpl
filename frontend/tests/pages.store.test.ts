// The editor's state with pages: the designer store and the designs store (save and open), with the
// network replaced by a small fake that keeps what the backend keeps.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockServer = {
  designs: new Map<number, any[]>(),  // design id -> versions (index = number - 1)
  nextId: 1,
  calls: [] as { fn: string; args: any[] }[],
  zpl: [] as any[],                   // what the editor asked the ZPL generator for
};

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => {
    mockServer.zpl.push(JSON.parse(JSON.stringify(payload)));
    return `ZPL(${payload.elements.length} elements, ${payload.pages ? payload.pages.length : 1} page)`;
  }),
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
    apiCreateVersion: jest.fn(async (designId: number, payload: any) => {
      mockServer.calls.push({ fn: 'version', args: [designId, clone(payload)] });
      const versions = mockServer.designs.get(designId)!;
      versions.push(clone({ ...payload, pagesConfig: payload.pagesConfig ?? null }));
      return detail(versions[versions.length - 1], versions.length);
    }),
    // As the backend does: what is left out stays as saved
    apiUpdateVersion: jest.fn(async (designId: number, vn: number, payload: any) => {
      mockServer.calls.push({ fn: 'put', args: [designId, vn, clone(payload)] });
      const versions = mockServer.designs.get(designId)!;
      const saved = versions[vn - 1];
      versions[vn - 1] = {
        ...saved, ...clone({ zpl: payload.zpl, elements: payload.elements, labelWidth: payload.labelWidth, labelHeight: payload.labelHeight }),
        ...(payload.sampleValues !== undefined && { sampleValues: clone(payload.sampleValues) }),
        ...(payload.pagesConfig !== undefined && { pagesConfig: clone(payload.pagesConfig) }),
      };
      return detail(versions[vn - 1], vn);
    }),
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
import { useDesignerStore, snapContext } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { DesignElement } from '../src/types';

const designer = () => useDesignerStore.getState();
const designs = () => useDesignsStore.getState();
// zundo's types need the bundler's module resolution, which the test setup does not use
const history = () => (useDesignerStore as any).temporal.getState();
const undo = () => history().undo();
const redo = () => history().redo();

// zundo records a change 300 ms after it, and the code is generated 200 ms after an edit
const settle = () => jest.advanceTimersByTimeAsync(400);

const rect = (id: string, extra: Partial<DesignElement> = {}): DesignElement =>
  ({ id, type: 'rect', x: 10, y: 20, width: 100, height: 50, ...extra });

const tableEl = (extra: Partial<DesignElement> = {}): DesignElement => ({
  id: 'tab', type: 'table', x: 40, y: 100, width: 0, height: 0, rowsPerPage: 3,
  columns: [
    { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' },
    { header: 'Qtd', field: 'QTD', width: 100, align: 'R' },
  ],
  ...extra,
});

const records = [{ MATERIAL: '100', QTD: '5' }, { MATERIAL: '101', QTD: '10' }, { MATERIAL: '102', QTD: '15' }];

// Closes the design: the editor goes back to empty (what the server holds stays)
function closeEditor() {
  useDesignerStore.setState({
    elements: [], labelWidth: 800, labelHeight: 1200, selectedId: null, selectedIds: [], sampleValues: {}, zplCode: '^XA\n^PW800\n^LL1200\n^XZ',
    pages: [{ mode: 'first' }], activePage: 0, records: [],
  });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  history().clear();
}

function resetEditor() {
  mockServer.designs.clear();
  mockServer.nextId = 1;
  mockServer.calls.length = 0;
  mockServer.zpl.length = 0;
  closeEditor();
}

// A design as an older version of the app saved it: no pagesConfig at all
function legacyDesign(): number {
  const id = mockServer.nextId++;
  mockServer.designs.set(id, [{
    zpl: '^XA^XZ', labelWidth: 800, labelHeight: 600, elements: [rect('a', { x: 11, y: 22 }), rect('b', { x: 33, y: 44, width: 5.5 })],
  }]);
  return id;
}

// A design of two pages, built in the editor
function buildTwoPageDesign() {
  designer().addElement('rect', 5, 6, { id: 'p0a', width: 10, height: 10 });
  designer().addPage();
  designer().addElement('rect', 7, 8, { id: 'p1a', width: 20, height: 20 });
  designer().addElement('table', 40, 100, { ...tableEl(), id: 'tab' });
  designer().setRecords(records);
}

beforeEach(() => { jest.useFakeTimers(); resetEditor(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('1. opening a design saved before pages existed', () => {
  test('is one page, no records, the elements exactly as saved, and nothing to save', async () => {
    const id = legacyDesign();
    await designs().loadVersion(id, 1);
    expect(designer().pages).toEqual([{ mode: 'first' }]);
    expect(designer().activePage).toBe(0);
    expect(designer().records).toEqual([]);
    expect(designer().elements).toEqual([rect('a', { x: 11, y: 22 }), rect('b', { x: 33, y: 44, width: 5.5 })]);
    designer().elements.forEach(e => expect(e).not.toHaveProperty('page'));
    expect(isDirtyNow()).toBe(false);
  });

  test('opening one after a design of two pages does not leave anything of it behind', async () => {
    buildTwoPageDesign();
    await designs().loadVersion(legacyDesign(), 1);
    expect(designer().pages).toHaveLength(1);
    expect(designer().records).toEqual([]);
    expect(designer().activePage).toBe(0);
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'b']);
  });

  test('a template opens as one page too', () => {
    buildTwoPageDesign();
    designs().openTemplate({ id: 1, name: 'T', description: '', category: 'outros', labelWidth: 800, labelHeight: 600, zpl: '^XA^XZ', elements: [rect('t1')] } as any);
    expect(designer().pages).toHaveLength(1);
    expect(designer().records).toEqual([]);
    expect(designer().elements.map(e => e.id)).toEqual(['t1']);
    expect(isDirtyNow()).toBe(false);
  });
});

describe('2. creating the second page', () => {
  test('is a "repeat" page, and the one being edited', async () => {
    expect(designer().addPage()).toBe(true);
    expect(designer().pages).toEqual([{ mode: 'first' }, { mode: 'repeat' }]);
    expect(designer().activePage).toBe(1);
  });

  test('the ZPL is generated with both pages; a design of one page is generated as before (no pages sent)', async () => {
    designer().addElement('rect', 1, 1, { id: 'x' });
    await settle();
    expect(mockServer.zpl[mockServer.zpl.length - 1]).not.toHaveProperty('pages');
    designer().addPage();
    await settle();
    expect(mockServer.zpl[mockServer.zpl.length - 1].pages).toEqual([{ mode: 'first' }, { mode: 'repeat' }]);
    expect(designer().zplCode).toBe('ZPL(1 elements, 2 page)');
  });

  test('new elements go to the page being edited; on one page they have no page at all', () => {
    designer().addElement('rect', 1, 1, { id: 'one' });
    expect(designer().elements[0]).not.toHaveProperty('page');
    designer().addPage();
    designer().addElement('rect', 2, 2, { id: 'two' });
    designer().setActivePage(0);
    designer().addElement('rect', 3, 3, { id: 'three' });
    const page = (id: string) => designer().elements.find(e => e.id === id)!.page;
    expect(page('one')).toBeUndefined();
    expect(page('two')).toBe(1);
    expect(page('three')).toBe(0);
  });
});

describe('3 and 4. switching pages', () => {
  test('goes to the page asked for, and refuses one that does not exist', () => {
    designer().addPage();
    expect(designer().setActivePage(0)).toBe(true);
    expect(designer().activePage).toBe(0);
    expect(designer().setActivePage(1)).toBe(true);
    expect(designer().activePage).toBe(1);
    for (const bad of [-1, 2, 0.5, NaN]) {
      expect(designer().setActivePage(bad)).toBe(false);
      expect(designer().activePage).toBe(1);
    }
  });

  test('on a design of one page there is no page 2 to go to', () => {
    expect(designer().setActivePage(1)).toBe(false);
    expect(designer().activePage).toBe(0);
  });

  test('no element is changed, moved, copied or lost, however often it is switched', () => {
    buildTwoPageDesign();
    const before = designer().elements;
    const snapshot = JSON.stringify(before);
    for (let i = 0; i < 6; i++) designer().setActivePage(i % 2);
    expect(designer().elements).toBe(before);  // the very same array: nothing was even rebuilt
    expect(JSON.stringify(designer().elements)).toBe(snapshot);
    expect(designer().elements.map(e => e.id)).toEqual(['p0a', 'p1a', 'tab']);
    expect(new Set(designer().elements.map(e => e.id)).size).toBe(3);
  });

  test('the selection does not follow to the other page', () => {
    buildTwoPageDesign();
    designer().selectElement('p1a');
    designer().setActivePage(0);
    expect(designer().selectedIds).toEqual([]);
    expect(designer().selectedId).toBeNull();
  });

  test('switching is not a change to save', () => {
    buildTwoPageDesign();
    useDesignsStore.setState({ savedSignature: require('../src/utils/unsaved').editorSignature(designer()) });
    expect(isDirtyNow()).toBe(false);
    designer().setActivePage(0);
    designer().setActivePage(1);
    expect(isDirtyNow()).toBe(false);
  });
});

describe('5. the properties of a page', () => {
  test('the mode is fixed by position, so a change that breaks the rules is refused', () => {
    designer().addPage();
    const pages = designer().pages;
    expect(designer().updatePage(0, { mode: 'repeat' })).toBe(false);
    expect(designer().updatePage(1, { mode: 'first' })).toBe(false);
    expect(designer().updatePage(2, { mode: 'repeat' })).toBe(false);
    expect(designer().updatePage(-1, { mode: 'first' })).toBe(false);
    expect(designer().pages).toBe(pages);
  });

  test('setting what it already is is accepted and changes nothing', () => {
    designer().addPage();
    const pages = designer().pages;
    expect(designer().updatePage(0, { mode: 'first' })).toBe(true);
    expect(designer().updatePage(1, { mode: 'repeat' })).toBe(true);
    expect(designer().pages).toBe(pages);
  });

  test('going back to one page takes the second page and its elements away, and nothing else', () => {
    buildTwoPageDesign();
    expect(designer().removePage()).toBe(true);
    expect(designer().pages).toEqual([{ mode: 'first' }]);
    expect(designer().activePage).toBe(0);
    expect(designer().elements.map(e => e.id)).toEqual(['p0a']);
    expect(designer().removePage()).toBe(false);
  });
});

describe('6. unsaved changes', () => {
  const saved = async () => {
    await designs().saveNewDesign('D');
    expect(isDirtyNow()).toBe(false);
  };

  test('an empty editor is not a change; a second page is', () => {
    expect(isDirtyNow()).toBe(false);
    designer().addPage();
    expect(isDirtyNow()).toBe(true);
  });

  test('adding or removing an element, changing a table, or the test data, are each a change', async () => {
    buildTwoPageDesign();
    await saved();

    designer().addElement('rect', 1, 1, { id: 'extra' });
    expect(isDirtyNow()).toBe(true);
    designer().deleteElement('extra');
    expect(isDirtyNow()).toBe(false);

    designer().updateElement('tab', { rowsPerPage: 5 });
    expect(isDirtyNow()).toBe(true);
    designer().updateElement('tab', { rowsPerPage: 3 });
    expect(isDirtyNow()).toBe(false);

    designer().updateElement('tab', { columns: [{ header: 'Material', field: 'MATERIAL', width: 260, align: 'L' }, tableEl().columns![1]] });
    expect(isDirtyNow()).toBe(true);
  });

  test('the test data is a change, and so is taking it back out', async () => {
    buildTwoPageDesign();
    await saved();
    designer().setRecords([...records, { MATERIAL: '103', QTD: '20' }]);
    expect(isDirtyNow()).toBe(true);
    designer().setRecords(records);
    expect(isDirtyNow()).toBe(false);
    designer().setRecords([{ ...records[0], QTD: '6' }, records[1], records[2]]);
    expect(isDirtyNow()).toBe(true);
  });

  test('removing the second page is a change', async () => {
    buildTwoPageDesign();
    await saved();
    designer().removePage();
    expect(isDirtyNow()).toBe(true);
  });

  test('saving makes it clean, and what was sent is what counts even if editing goes on meanwhile', async () => {
    buildTwoPageDesign();
    const saving = designs().saveNewDesign('D');
    designer().addElement('rect', 1, 1, { id: 'during' });  // edited while the request is on its way
    await saving;
    expect(isDirtyNow()).toBe(true);
  });
});

describe('7 and 9. saving the configuration and the test data', () => {
  test('a new design sends its pages, its elements with their pages, and the records', async () => {
    buildTwoPageDesign();
    await designs().saveNewDesign('Two');
    const [call] = mockServer.calls;
    expect(call.fn).toBe('create');
    const payload = call.args[1];
    expect(payload.pagesConfig).toEqual({ pages: [{ mode: 'first' }, { mode: 'repeat' }], records });
    expect(payload.elements.map((e: DesignElement) => e.page)).toEqual([undefined, 1, 1]);
    expect(payload.elements[2]).toEqual({ ...tableEl(), page: 1 });
  });

  test('a design of one page sends pagesConfig null: the same as a design saved before', async () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    await designs().saveNewDesign('One');
    expect(mockServer.calls[0].args[1].pagesConfig).toBeNull();
    expect(mockServer.calls[0].args[1].elements[0]).not.toHaveProperty('page');
  });

  test('a new version and an overwrite also send the current pages, and the server keeps them', async () => {
    buildTwoPageDesign();
    await designs().saveNewDesign('V');
    designer().setRecords([records[0]]);
    await designs().overwriteVersion();
    const put = mockServer.calls.find(c => c.fn === 'put')!;
    expect(put.args[2].pagesConfig).toEqual({ pages: [{ mode: 'first' }, { mode: 'repeat' }], records: [records[0]] });
    expect(mockServer.designs.get(1)![0].pagesConfig.records).toEqual([records[0]]);

    designer().removePage();
    await designs().saveVersion();
    const version = mockServer.calls.find(c => c.fn === 'version')!;
    expect(version.args[1].pagesConfig).toEqual({ pages: [{ mode: 'first' }], records: [records[0]] });
  });

  test('going back to one page without records saves null: the overwrite sends it, so it is not left as it was', async () => {
    buildTwoPageDesign();
    await designs().saveNewDesign('Back');
    designer().removePage();
    designer().setRecords([]);
    await designs().overwriteVersion();
    expect(mockServer.calls.find(c => c.fn === 'put')!.args[2].pagesConfig).toBeNull();
    expect(mockServer.designs.get(1)![0].pagesConfig).toBeNull();
  });

  test('the records are saved only as far as the backend accepts them', async () => {
    designer().addPage();
    designer().setRecords(Array.from({ length: 520 }, (_, i) => ({ MATERIAL: String(i), 'bad field': 'x' })));
    await designs().saveNewDesign('Many');
    const saved = mockServer.calls[0].args[1].pagesConfig.records;
    expect(saved).toHaveLength(500);
    expect(saved[0]).toEqual({ MATERIAL: '0' });
  });
});

describe('8. opening a design of two pages again', () => {
  test('comes back as it was saved: pages, page of each element, table and records', async () => {
    buildTwoPageDesign();
    const elements = designer().elements;
    await designs().saveNewDesign('Again');

    closeEditor();
    await designs().loadVersion(1, 1);

    expect(designer().pages).toEqual([{ mode: 'first' }, { mode: 'repeat' }]);
    expect(designer().activePage).toBe(0);
    expect(designer().records).toEqual(records);
    expect(designer().elements).toEqual(elements);
    expect(designer().elements.find(e => e.id === 'tab')).toEqual({ ...tableEl(), page: 1 });
    expect(isDirtyNow()).toBe(false);
  });

  test('it was saved before any edit of the records, and the records are copies (editing them does not touch what was loaded)', async () => {
    buildTwoPageDesign();
    await designs().saveNewDesign('Copy');
    closeEditor();
    await designs().loadVersion(1, 1);
    designer().records[0].MATERIAL = 'changed';
    expect(mockServer.designs.get(1)![0].pagesConfig.records[0].MATERIAL).toBe('100');
  });
});

describe('10. undo', () => {
  test('taking back the second page restores one page and the view of the first', async () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    await settle();
    designer().addPage();
    await settle();
    expect(designer().pages).toHaveLength(2);
    undo();
    expect(designer().pages).toEqual([{ mode: 'first' }]);
    expect(designer().activePage).toBe(0);
    redo();
    expect(designer().pages).toHaveLength(2);
    expect(designer().activePage).toBe(1);
  });

  test('taking back an element of the second page leaves the first page as it was', async () => {
    buildTwoPageDesign();
    await settle();
    designer().addElement('rect', 90, 90, { id: 'late' });
    await settle();
    expect(designer().elements.map(e => e.id)).toContain('late');
    undo();
    expect(designer().elements.map(e => e.id)).toEqual(['p0a', 'p1a', 'tab']);
    expect(designer().elements.find(e => e.id === 'p0a')).toEqual(expect.objectContaining({ x: 5, y: 6 }));
  });

  test('taking back a change of a table property, and one of the test data', async () => {
    buildTwoPageDesign();
    await settle();
    designer().updateElement('tab', { rowsPerPage: 6 });
    await settle();
    designer().setRecords([records[0]]);
    await settle();
    undo();
    expect(designer().records).toEqual(records);
    undo();
    expect(designer().elements.find(e => e.id === 'tab')!.rowsPerPage).toBe(3);
  });

  test('taking back the removal of the second page brings its elements back', async () => {
    buildTwoPageDesign();
    await settle();
    designer().removePage();
    await settle();
    expect(designer().elements).toHaveLength(1);
    undo();
    expect(designer().pages).toHaveLength(2);
    expect(designer().elements.map(e => e.id)).toEqual(['p0a', 'p1a', 'tab']);
  });

  test('after taking everything back the editor is the one that was saved: nothing unsaved', async () => {
    buildTwoPageDesign();
    await settle();
    await designs().saveNewDesign('U');
    designer().addElement('rect', 90, 90, { id: 'late' });
    await settle();
    expect(isDirtyNow()).toBe(true);
    undo();
    expect(isDirtyNow()).toBe(false);
  });
});

describe('11. what already worked, still does', () => {
  test('on one page, one undo takes back an edit (before, the first undo after any edit did nothing)', async () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    await settle();
    designer().addElement('rect', 2, 2, { id: 'b' });
    await settle();
    undo();
    expect(designer().elements.map(e => e.id)).toEqual(['a']);
    undo();
    expect(designer().elements).toEqual([]);
    redo();
    expect(designer().elements.map(e => e.id)).toEqual(['a']);
  });

  test('on one page, undo and redo of a size, a move and a delete', async () => {
    designer().addElement('rect', 1, 1, { id: 'a', width: 10, height: 10 });
    await settle();
    designer().updateElement('a', { width: 99 });
    await settle();
    designer().moveSelected(0, 0);
    designer().deleteElement('a');
    await settle();
    expect(designer().elements).toEqual([]);
    undo();
    expect(designer().elements[0].width).toBe(99);
    undo();
    expect(designer().elements[0].width).toBe(10);
    designer().setLabelSize(400, 300);
    await settle();
    undo();
    expect(designer().labelWidth).toBe(800);
  });

  test('on one page: add, duplicate, delete, move and order elements as always', () => {
    designer().addElement('rect', 1, 1, { id: 'a' });
    designer().addElement('rect', 2, 2, { id: 'b' });
    designer().addElement('rect', 3, 3, { id: 'c' });
    designer().selectElement('a');
    designer().bringForward();
    expect(designer().elements.map(e => e.id)).toEqual(['b', 'a', 'c']);
    designer().sendBackward();
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'b', 'c']);
    designer().bringToFront();
    expect(designer().elements.map(e => e.id)).toEqual(['b', 'c', 'a']);
    designer().sendToBack();
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'b', 'c']);

    designer().selectElement('b');
    designer().duplicateSelected();
    expect(designer().elements).toHaveLength(4);
    expect(designer().elements[3]).toEqual(expect.objectContaining({ x: 18, y: 18, type: 'rect' }));
    expect(designer().elements[3]).not.toHaveProperty('page');
    designer().deleteSelected();
    expect(designer().elements).toHaveLength(3);
    designer().moveSelected(5, 5);
    designer().clearAll();
    expect(designer().elements).toEqual([]);
  });

  test('ordering on two pages moves an element past the ones of its own page, not the other page', () => {
    // in the list: page 0, page 1, page 0, page 1, page 0
    useDesignerStore.setState({
      pages: [{ mode: 'first' }, { mode: 'repeat' }],
      elements: [rect('a', { page: 0 }), rect('x', { page: 1 }), rect('b', { page: 0 }), rect('y', { page: 1 }), rect('c', { page: 0 })],
    });
    designer().selectElement('a');
    designer().bringForward();  // a goes above b
    expect(designer().elements.filter(e => e.page === 0).map(e => e.id)).toEqual(['b', 'a', 'c']);
    expect(designer().elements.filter(e => e.page === 1).map(e => e.id)).toEqual(['x', 'y']);
    designer().sendBackward();  // and back
    expect(designer().elements.filter(e => e.page === 0).map(e => e.id)).toEqual(['a', 'b', 'c']);
    designer().selectElement('c');
    designer().bringForward();  // already the top of its page: nothing
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'x', 'b', 'y', 'c']);
    designer().selectElement('x');
    designer().sendBackward();  // x is the lowest of page 2: nothing
    expect(designer().elements.map(e => e.id)).toEqual(['a', 'x', 'b', 'y', 'c']);
  });

  test('duplicating on the second page stays on it', () => {
    designer().addPage();
    designer().addElement('rect', 1, 1, { id: 'a' });
    designer().duplicateSelected();
    expect(designer().elements.map(e => e.page)).toEqual([1, 1]);
  });

  test('"clear the label" on two pages clears the page being edited; on one page, everything', () => {
    buildTwoPageDesign();
    designer().clearAll();
    expect(designer().elements.map(e => e.id)).toEqual(['p0a']);
    designer().setActivePage(0);
    designer().clearAll();
    expect(designer().elements).toEqual([]);
    expect(designer().pages).toHaveLength(2);  // the pages stay
  });

  test('snapping sees only the elements of the page being moved', () => {
    useDesignerStore.setState({
      pages: [{ mode: 'first' }, { mode: 'repeat' }],
      elements: [rect('m', { page: 0 }), rect('same', { page: 0 }), rect('other', { page: 1 })],
      snapToElements: true,
    });
    const context = snapContext(['m'])!;
    expect(context.others).toHaveLength(1);
  });

  test('the code typed in the code tab is read back on one page, and ignored on a structured design', async () => {
    designer().onCodeChange('^XA^FO1,2^GB3,4,4^FS^XZ');
    await jest.advanceTimersByTimeAsync(700);  // the code is read back 600 ms after it was typed
    expect(designer().elements.map(e => e.id)).toEqual(['parsed']);

    designer().addPage();
    await settle();  // the code of the two pages arrives
    const before = designer().elements;
    const code = designer().zplCode;
    designer().onCodeChange('^XA^FO9,9^GB9,9,9^FS^XZ');
    await jest.advanceTimersByTimeAsync(700);
    expect(designer().elements).toBe(before);
    expect(designer().zplCode).toBe(code);
  });

  test('a design with a table on one page is structured as well', async () => {
    designer().addElement('table', 40, 100, { ...tableEl(), id: 'only' });
    const before = designer().elements;
    designer().onCodeChange('^XA^XZ');
    await jest.advanceTimersByTimeAsync(700);
    expect(designer().elements).toBe(before);
  });

  test('a barcode only worries about what is on its own page', () => {
    const { barcodeFit } = require('../src/utils/barcodeFit');
    const code = { id: 'c', type: 'barcode128', x: 10, y: 10, width: 200, height: 60, dynamic: true, variableName: 'UC', moduleWidth: 2, page: 0 } as DesignElement;
    const text = (page: number) => ({ id: `t${page}`, type: 'text', x: 20, y: 20, width: 100, height: 30, value: 'x', fontSize: 30, page } as DesignElement);
    expect(barcodeFit(code, [code, text(0)], {}, false, 800, 600).overlaps.map((e: DesignElement) => e.id)).toEqual(['t0']);
    expect(barcodeFit(code, [code, text(1)], {}, false, 800, 600).overlaps).toEqual([]);
  });
});

describe('12. at most two pages', () => {
  test('a third is refused and nothing changes', () => {
    expect(designer().addPage()).toBe(true);
    const pages = designer().pages;
    expect(designer().addPage()).toBe(false);
    expect(designer().pages).toBe(pages);
    expect(designer().pages).toHaveLength(2);
    expect(designer().activePage).toBe(1);
  });

  test('a saved design that has more than two pages (or an order that is not allowed) opens as one page', async () => {
    const id = mockServer.nextId++;
    mockServer.designs.set(id, [{
      zpl: '^XA^XZ', labelWidth: 800, labelHeight: 600, elements: [rect('a')],
      pagesConfig: { pages: [{ mode: 'first' }, { mode: 'repeat' }, { mode: 'repeat' }] },
    }]);
    await designs().loadVersion(id, 1);
    expect(designer().pages).toEqual([{ mode: 'first' }]);
  });
});
