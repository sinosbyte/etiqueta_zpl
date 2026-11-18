// Etapa 1, item 1.1: warnings for elements and tables that run past the edge of the label. The functions are
// pure; a few tests use the real designer store to check that the warning never changes the design.

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async () => 'ZPL'),
  parseZpl: jest.fn(),
  previewZpl: jest.fn(),
  exportZpl: jest.fn(),
}));
jest.mock('../src/utils/designsClient', () => ({}));

import { DesignElement } from '../src/types';
import { boundsIssue, boundsIssues, issueSides, tableRowsThatFit } from '../src/utils/labelBounds';
import { translate } from '../src/i18n';
import { useDesignerStore } from '../src/store/useDesignerStore';

const W = 800;
const H = 600;

const el = (patch: Partial<DesignElement>): DesignElement =>
  ({ id: 'e', type: 'rect', x: 0, y: 0, width: 100, height: 100, ...patch } as DesignElement);

const col = (field: string, width = 200) => ({ header: field, field, width, align: 'L' as const });
const table = (patch: Partial<DesignElement> = {}): DesignElement =>
  el({ id: 't', type: 'table', x: 40, y: 100, width: 0, height: 0, rowHeight: 40, rowsPerPage: 5, headerRow: true, columns: [col('A'), col('B')], ...patch });

describe('boundsIssue: what runs past the label', () => {
  test('an element inside is fine, also when it touches the edges', () => {
    expect(boundsIssue(el({ x: 0, y: 0, width: W, height: H }), W, H)).toBeNull();
    expect(boundsIssue(el({ x: 700, y: 500 }), W, H)).toBeNull();
  });

  test.each([
    ['right', { x: 750 }, { right: 50 }],
    ['bottom', { y: 560 }, { bottom: 60 }],
    ['left', { x: -30 }, { left: 30 }],
    ['top', { y: -12 }, { top: 12 }],
  ])('past the %s edge', (_side, patch, expected) => {
    expect(boundsIssue(el(patch), W, H)).toMatchObject({ left: 0, top: 0, right: 0, bottom: 0, ...expected });
  });

  test('past two edges at once, and an element that is wholly outside', () => {
    expect(boundsIssue(el({ x: 760, y: 580 }), W, H)).toMatchObject({ right: 60, bottom: 80 });
    expect(boundsIssue(el({ x: 900, y: 10 }), W, H)).toMatchObject({ right: 200 });
  });

  test('one dot past is not reported (the box of a text is an estimate), two are', () => {
    expect(boundsIssue(el({ x: 701 }), W, H)).toBeNull();
    expect(boundsIssue(el({ x: 702 }), W, H)).toMatchObject({ right: 2 });
  });

  test('comments and raw ZPL have no place on the label', () => {
    expect(boundsIssue(el({ type: 'comment', x: 5000, y: 5000, width: 0, height: 0 }), W, H)).toBeNull();
    expect(boundsIssue(el({ type: 'raw', x: 5000, y: 5000, width: 0, height: 0 }), W, H)).toBeNull();
  });

  test('a rotated text uses its turned box', () => {
    // 30 high text of 5 characters is about 100 wide; turned a quarter it is 30 wide and ~100 tall
    const text = el({ type: 'text', value: 'HELLO', fontSize: 30, orientation: 'R', x: 770, y: 560 });
    expect(boundsIssue(text, W, H)).not.toBeNull();
    expect(boundsIssue({ ...text, x: 10, y: 10 }, W, H)).toBeNull();
  });

  test('a Data Matrix and a QR Code are checked by the symbol they print, not by the stored size', () => {
    const dm = el({ type: 'datamatrix', value: '12345', dmModuleSize: 4, x: 780, y: 10 });
    expect(boundsIssue(dm, W, H)).not.toBeNull();
    expect(boundsIssue({ ...dm, x: 10 }, W, H)).toBeNull();
  });
});

describe('boundsIssue: tables', () => {
  test('the height of the table counts the header and every row it holds', () => {
    // 100 + 40 x (5 rows + header) = 340: it fits in 600
    expect(boundsIssue(table(), W, H)).toBeNull();
    // 12 records: 100 + 40 x 13 = 620 > 600
    expect(boundsIssue(table({ rowsPerPage: 12 }), W, H)).toMatchObject({ bottom: 20, right: 0 });
  });

  test('without the header row there is one row less', () => {
    expect(boundsIssue(table({ rowsPerPage: 12, headerRow: false }), W, H)).toBeNull();
    expect(boundsIssue(table({ rowsPerPage: 13, headerRow: false }), W, H)).toMatchObject({ bottom: 20 });
  });

  test('the width is the sum of the columns', () => {
    // x = 40 and 400 + 400 wide: it ends at 840 on a label 800 wide
    expect(boundsIssue(table({ columns: [col('A', 400), col('B', 400)] }), W, H)).toMatchObject({ right: 40 });
  });

  test('a table with no columns uses the small box the editor gives it', () => {
    expect(boundsIssue(table({ columns: [] }), W, H)).toBeNull();
  });

  test('tableRowsThatFit: records that fit from its position down', () => {
    // (600 - 100) / 40 = 12 rows, minus the header = 11
    expect(tableRowsThatFit(table(), H)).toBe(11);
    expect(tableRowsThatFit(table({ headerRow: false }), H)).toBe(12);
    expect(tableRowsThatFit(table({ y: 580 }), H)).toBe(0);
    expect(tableRowsThatFit(table({ y: 5000 }), H)).toBe(0);
  });

  test('lowering rowsPerPage to what fits makes the warning go away', () => {
    const t = table({ rowsPerPage: 30 });
    expect(boundsIssue(t, W, H)).not.toBeNull();
    expect(boundsIssue({ ...t, rowsPerPage: tableRowsThatFit(t, H) }, W, H)).toBeNull();
  });
});

describe('boundsIssues and issueSides', () => {
  test('lists only the elements that are out, in order', () => {
    const list = [el({ id: 'a' }), el({ id: 'b', x: 790 }), el({ id: 'c', y: 10 }), el({ id: 'd', y: 590 })];
    expect(boundsIssues(list, W, H).map(i => i.id)).toEqual(['b', 'd']);
  });

  test('issueSides names each side with its dots', () => {
    const issue = boundsIssue(el({ x: -20, y: 560, width: 100 }), W, H)!;
    expect(issueSides(issue)).toEqual([{ side: 'left', dots: 20 }, { side: 'bottom', dots: 60 }]);
  });

  test('the label size is the one of the design: a smaller label makes the same element go out', () => {
    const e = el({ x: 100, y: 100 });
    expect(boundsIssue(e, 800, 600)).toBeNull();
    expect(boundsIssue(e, 150, 600)).toMatchObject({ right: 50 });
  });
});

describe('the warning only says: it never changes the design', () => {
  beforeEach(() => {
    useDesignerStore.setState({
      labelWidth: W, labelHeight: H, pages: [{ mode: 'first' }], activePage: 0, records: [],
      elements: [table({ rowsPerPage: 30 }), el({ id: 'r', x: 790, y: 590 })],
    });
  });

  test('looking for the problems leaves every coordinate and size as it was', () => {
    const before = JSON.stringify(useDesignerStore.getState().elements);
    const { elements, labelWidth, labelHeight } = useDesignerStore.getState();
    expect(boundsIssues(elements, labelWidth, labelHeight)).toHaveLength(2);
    expect(JSON.stringify(useDesignerStore.getState().elements)).toBe(before);
  });
});

describe('texts of the warning (both languages)', () => {
  const keys = ['canvas.outOfBounds', 'bounds.panel', 'bounds.side.left', 'bounds.side.top', 'bounds.side.right',
    'bounds.side.bottom', 'bounds.table', 'bounds.summary1', 'bounds.summaryN', 'bounds.select'] as const;

  test.each(['pt-BR', 'en'] as const)('every key has a text in %s', lang => {
    for (const key of keys) expect(translate(lang, key)).not.toBe(key);
  });

  test('the parameters are filled in', () => {
    expect(translate('pt-BR', 'bounds.summaryN', { n: 3 })).toBe('3 elementos passam da borda da etiqueta.');
    expect(translate('en', 'bounds.panel', { sides: '5 mm on the right' })).toContain('5 mm on the right');
  });
});

describe('API messages of the expansion limits are translated', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { apiMessage } = require('../src/i18n');
  const tooMany = 'Too many labels: the records need more labels than one simulation can hold';
  const tooLarge = 'The labels are too large: together they would exceed the size limit of one simulation';

  test('a known message becomes the text of the language on screen, not the English one', () => {
    expect(apiMessage(tooMany, 'api.invalidData')).not.toBe(tooMany);
    expect(apiMessage(tooLarge, 'api.invalidData')).not.toBe(tooLarge);
    expect(apiMessage(tooLarge, 'api.invalidData').length).toBeGreaterThan(20);
  });
});
