// Removing the second page (with its confirmation), and the small pieces the canvas relies on to show a design
// of two pages or a table.

/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => `ZPL(${payload.elements.length} elements, ${payload.pages ? payload.pages.length : 1} page)`),
  parseZpl: jest.fn(),
  previewZpl: jest.fn(),
  exportZpl: jest.fn(),
}));
jest.mock('../src/store/useDialogStore', () => ({ askConfirm: jest.fn() }));

(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { askConfirm } from '../src/store/useDialogStore';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useLangStore, t } from '../src/i18n';
import { requestRemovePage } from '../src/utils/pageActions';
import { tableBox } from '../src/utils/tableBox';
import { elementBox } from '../src/utils/zplText';
import { layerList } from '../src/utils/layers';
import { DesignElement } from '../src/types';

const ask = askConfirm as jest.Mock;
const designer = () => useDesignerStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const settle = () => jest.advanceTimersByTimeAsync(400);

const rect = (id: string, extra: Partial<DesignElement> = {}): DesignElement => ({ id, type: 'rect', x: 10, y: 20, width: 100, height: 50, ...extra });
const table = (extra: Partial<DesignElement> = {}): DesignElement => ({
  id: 'tab', type: 'table', x: 40, y: 100, width: 0, height: 0,
  columns: [{ header: 'A', field: 'A', width: 200, align: 'L' }, { header: 'B', field: 'B', width: 100, align: 'R' }], ...extra,
});

function twoPages() {
  useDesignerStore.setState({
    elements: [rect('p0', { x: 5, y: 6 }), rect('p1', { page: 1, x: 7, y: 8 }), table({ page: 1 })],
    pages: [{ mode: 'first' }, { mode: 'repeat' }], activePage: 1, records: [{ A: '1' }], selectedId: null, selectedIds: [],
  });
  history().clear();
}

beforeEach(() => {
  jest.useFakeTimers();
  ask.mockReset();
  useLangStore.setState({ lang: 'pt-BR' });
  useDesignerStore.setState({ elements: [], pages: [{ mode: 'first' }], activePage: 0, records: [], selectedId: null, selectedIds: [], labelWidth: 800, labelHeight: 600 });
  history().clear();
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

describe('removing the second page', () => {
  test('asks with the warning that its elements are deleted, in a danger dialog', async () => {
    twoPages();
    ask.mockResolvedValue(false);
    await requestRemovePage();
    expect(ask).toHaveBeenCalledTimes(1);
    const options = ask.mock.calls[0][0];
    expect(options.danger).toBe(true);
    expect(options.message).toBe('Tem certeza de que deseja remover a segunda página? Todos os elementos associados a ela serão excluídos.');
    expect(options.title).toBe('Remover a segunda página');
  });

  test('the same warning in English', async () => {
    useLangStore.setState({ lang: 'en' });
    twoPages();
    ask.mockResolvedValue(false);
    await requestRemovePage();
    expect(ask.mock.calls[0][0].message).toBe(t('page.removeConfirm'));
    expect(ask.mock.calls[0][0].message).toMatch(/second page.*deleted/);
  });

  test('cancelling changes absolutely nothing: not a page, an element or the history', async () => {
    twoPages();
    await settle();          // the history records a change 300 ms after it: let the set-up one land first
    history().clear();
    const { pages, elements, activePage, records } = designer();
    const past = history().pastStates.length;
    ask.mockResolvedValue(false);
    expect(await requestRemovePage()).toBe(false);
    expect(designer().pages).toBe(pages);
    expect(designer().elements).toBe(elements);
    expect(designer().activePage).toBe(activePage);
    expect(designer().records).toBe(records);
    await settle();
    expect(history().pastStates.length).toBe(past);
  });

  test('confirming removes the page and its elements, and the first page stays as it was', async () => {
    twoPages();
    ask.mockResolvedValue(true);
    expect(await requestRemovePage()).toBe(true);
    expect(designer().pages).toEqual([{ mode: 'first' }]);
    expect(designer().activePage).toBe(0);
    expect(designer().elements).toEqual([rect('p0', { x: 5, y: 6 })]);
  });

  test('with one page there is nothing to remove and nothing is asked', async () => {
    ask.mockResolvedValue(true);
    expect(await requestRemovePage()).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  test('undo brings the page and its elements back, redo removes them again (and the same for creating it)', async () => {
    designer().addElement('rect', 1, 1, { id: 'first' });
    await settle();
    designer().addPage();
    await settle();
    designer().addElement('rect', 2, 2, { id: 'second' });
    await settle();
    const full = JSON.stringify(designer().elements);

    ask.mockResolvedValue(true);
    await requestRemovePage();
    await settle();
    expect(designer().pages).toHaveLength(1);
    expect(designer().elements.map(e => e.id)).toEqual(['first']);

    history().undo();  // the removal
    expect(designer().pages).toHaveLength(2);
    expect(JSON.stringify(designer().elements)).toBe(full);
    history().redo();
    expect(designer().pages).toHaveLength(1);
    expect(designer().elements.map(e => e.id)).toEqual(['first']);

    history().undo();  // and again, then one more: the element of page 2, then the page itself
    history().undo();
    expect(designer().elements.map(e => e.id)).toEqual(['first']);
    expect(designer().pages).toHaveLength(2);
    history().undo();
    expect(designer().pages).toHaveLength(1);
    history().redo();
    expect(designer().pages).toHaveLength(2);
  });
});

describe('what the canvas shows', () => {
  test('a table has the size its columns say: the columns together, a header row and a row for each record it holds', () => {
    expect(tableBox(table())).toEqual({ width: 300, height: 80 });
    expect(tableBox(table({ rowsPerPage: 3 }))).toEqual({ width: 300, height: 160 });
    expect(tableBox(table({ headerRow: false, rowHeight: 50 }))).toEqual({ width: 300, height: 50 });
  });

  test('a table with no column yet is still a box that can be found', () => {
    expect(tableBox(table({ columns: undefined }))).toEqual({ width: 300, height: 80 });
    expect(tableBox(table({ columns: [] }))).toEqual({ width: 300, height: 80 });
  });

  test('snapping and aligning see the table at that size, not the 0 x 0 it is stored with', () => {
    expect(elementBox(table())).toEqual({ width: 300, height: 80 });
    expect(elementBox(rect('r'))).toEqual({ width: 100, height: 50 });  // the others are as before
  });

  test('the layers list has the table', () => {
    const layers = layerList([rect('a'), table()]);
    expect(layers.map(l => [l.id, l.typeKey])).toEqual([['tab', 'element.table'], ['a', 'element.rect']]);
  });

  test('the notice of the read-only code tab says what was asked', () => {
    expect(t('code.readOnlyNotice')).toBe('Este modelo possui múltiplas páginas ou componentes dinâmicos. A edição manual do ZPL está desabilitada para preservar a estrutura do design.');
    expect(t('toolbar.addPage')).toBe('+ Quebra de página');
    expect(t('page.title', { n: 1 }) + ' — ' + t('page.first')).toBe('Página 1 — Somente primeira');
    expect(t('page.title', { n: 2 }) + ' — ' + t('page.repeat')).toBe('Página 2 — Repetir');
  });

  test('a table in a design does not break what the store does with elements', () => {
    useDesignerStore.setState({ elements: [rect('a'), table()], pages: [{ mode: 'first' }], activePage: 0 });
    designer().selectElement('tab');
    expect(() => {
      designer().moveSelected(5, 5);
      designer().duplicateSelected();
      designer().bringForward();
      designer().sendBackward();
      designer().alignElements('left');
      designer().deleteSelected();
    }).not.toThrow();
  });
});
