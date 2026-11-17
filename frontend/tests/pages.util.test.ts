import {
  isStructured, isValidPages, MAX_PAGES, pageOf, pagesConfigOf, pagesFromConfig, recordsFromConfig, savableRecords, singlePage,
} from '../src/utils/pages';
import { editorSignature, signatureOf } from '../src/utils/unsaved';
import { DesignElement } from '../src/types';

const el = (id: string, extra: Partial<DesignElement> = {}): DesignElement =>
  ({ id, type: 'rect', x: 10, y: 20, width: 100, height: 50, ...extra });

const table = (extra: Partial<DesignElement> = {}): DesignElement => ({
  id: 't', type: 'table', x: 40, y: 100, width: 0, height: 0, page: 1, rowsPerPage: 3,
  columns: [{ header: 'Material', field: 'MATERIAL', width: 200, align: 'L' }],
  ...extra,
});

describe('pages: what the editor knows about them', () => {
  test('a design has one page by default: the first, which prints once', () => {
    expect(singlePage()).toEqual([{ mode: 'first' }]);
    expect(MAX_PAGES).toBe(2);
  });

  test('an element saved before pages existed is on the first page', () => {
    expect(pageOf(el('a'))).toBe(0);
    expect(pageOf(el('a', { page: 0 }))).toBe(0);
    expect(pageOf(el('a', { page: 1 }))).toBe(1);
  });

  test('the first page is "first", the second "repeat", at most two', () => {
    expect(isValidPages([{ mode: 'first' }])).toBe(true);
    expect(isValidPages([{ mode: 'first' }, { mode: 'repeat' }])).toBe(true);
    expect(isValidPages([])).toBe(false);
    expect(isValidPages([{ mode: 'repeat' }])).toBe(false);
    expect(isValidPages([{ mode: 'first' }, { mode: 'first' }])).toBe(false);
    expect(isValidPages([{ mode: 'first' }, { mode: 'repeat' }, { mode: 'repeat' }])).toBe(false);
  });

  test('a design with no configuration (null or absent) is one page without records', () => {
    for (const config of [null, undefined]) {
      expect(pagesFromConfig(config)).toEqual(singlePage());
      expect(recordsFromConfig(config)).toEqual([]);
    }
  });

  test('a configuration that breaks the rules falls back to one page instead of failing', () => {
    expect(pagesFromConfig({ pages: [{ mode: 'repeat' }] })).toEqual(singlePage());
    expect(pagesFromConfig({ pages: [{ mode: 'first' }, { mode: 'repeat' }, { mode: 'repeat' }] })).toEqual(singlePage());
  });

  test('the pages and records of a configuration are copied, not shared', () => {
    const config = { pages: [{ mode: 'first' as const }, { mode: 'repeat' as const }], records: [{ A: '1' }] };
    const pages = pagesFromConfig(config);
    const records = recordsFromConfig(config);
    pages[0].mode = 'first';
    records[0].A = 'changed';
    expect(config.records[0].A).toBe('1');
  });

  test('a design is "structured" with two pages or a table: its code is not read back', () => {
    expect(isStructured(singlePage(), [el('a')])).toBe(false);
    expect(isStructured([{ mode: 'first' }, { mode: 'repeat' }], [el('a')])).toBe(true);
    expect(isStructured(singlePage(), [el('a'), table({ page: 0 })])).toBe(true);
  });
});

describe('pagesConfigOf: what is saved about the pages', () => {
  test('one page with no records saves nothing (null), as every design before pages', () => {
    expect(pagesConfigOf(singlePage(), [])).toBeNull();
  });

  test('two pages are saved, without a records key when there are none', () => {
    expect(pagesConfigOf([{ mode: 'first' }, { mode: 'repeat' }], [])).toEqual({ pages: [{ mode: 'first' }, { mode: 'repeat' }] });
  });

  test('records are saved with the pages, in order', () => {
    const records = [{ A: '1' }, { A: '2' }, { A: '3' }];
    expect(pagesConfigOf([{ mode: 'first' }, { mode: 'repeat' }], records)).toEqual({
      pages: [{ mode: 'first' }, { mode: 'repeat' }], records,
    });
    expect(pagesConfigOf(singlePage(), records)).toEqual({ pages: [{ mode: 'first' }], records });
  });

  test('records are held to what the backend accepts', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ A: String(i) }));
    expect(savableRecords(many)).toHaveLength(500);
    expect(savableRecords(many)[499]).toEqual({ A: '499' });
    expect(savableRecords([{ 'bad name': 'x', GOOD_1: 'y' }])).toEqual([{ GOOD_1: 'y' }]);
    expect(savableRecords([{ A: 'x'.repeat(300) }])[0].A).toHaveLength(255);
    const wide = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`F${i}`, 'x']));
    expect(Object.keys(savableRecords([wide])[0])).toHaveLength(200);
  });
});

describe('the signature of the editor (what "Não salvo" compares)', () => {
  const state = (extra: object = {}) => ({
    elements: [el('a')], labelWidth: 800, labelHeight: 600, sampleValues: {}, pages: singlePage(), records: [], ...extra,
  });

  test('a design of one page has the signature it had before pages existed', () => {
    const old = signatureOf([el('a')], 800, 600, {});
    expect(editorSignature(state())).toBe(old);
    expect(signatureOf([el('a')], 800, 600, {}, null)).toBe(old);
  });

  test('a second page, the records and the elements each change it', () => {
    const base = editorSignature(state());
    expect(editorSignature(state({ pages: [{ mode: 'first' }, { mode: 'repeat' }] }))).not.toBe(base);
    expect(editorSignature(state({ records: [{ A: '1' }] }))).not.toBe(base);
    expect(editorSignature(state({ elements: [el('a'), el('b')] }))).not.toBe(base);
    expect(editorSignature(state({ elements: [el('a', { page: 1 })] }))).not.toBe(base);
  });

  test('the same content gives the same signature whatever the order of the fields', () => {
    const a = editorSignature(state({ elements: [table()], pages: [{ mode: 'first' }, { mode: 'repeat' }] }));
    const reordered = { rowsPerPage: 3, page: 1, id: 't', columns: [{ align: 'L', width: 200, field: 'MATERIAL', header: 'Material' }], height: 0, width: 0, y: 100, x: 40, type: 'table' };
    const b = editorSignature(state({ elements: [reordered], pages: [{ mode: 'first' }, { mode: 'repeat' }] }));
    expect(b).toBe(a);
  });

  test('a table property changes it', () => {
    const pages = [{ mode: 'first' as const }, { mode: 'repeat' as const }];
    const a = editorSignature(state({ elements: [table()], pages }));
    expect(editorSignature(state({ elements: [table({ rowsPerPage: 4 })], pages }))).not.toBe(a);
    expect(editorSignature(state({ elements: [table({ columns: [{ header: 'Material', field: 'MATERIAL', width: 250, align: 'L' }] })], pages }))).not.toBe(a);
  });
});
