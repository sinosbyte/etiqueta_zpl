// Etapa 3 (P6): variables written by the user and cells of a table can have the same name. The editor finds the cases
// (variableOrigin), shows them where the user looks (the list of values, the catalog, the panels, the variants) and the
// backend says so when it happens. What is checked against the REAL expansion (expandLabels of the backend), so that
// what the editor says is what the server does.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockServer = { designs: new Map<number, any[]>(), nextId: 1 };

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async () => 'ZPL'),
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

(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { DesignElement } from '../src/types';
import { EMPTY_SIGNATURE, usedSamples } from '../src/utils/unsaved';
import { fieldVariables, valueIsUsed, variableConflicts, conflictsOfElement, conflictsOfTable, pagesText } from '../src/utils/variableOrigin';
import { variableCatalog } from '../src/utils/variableCatalog';
import { valueRows, dataFields, labelVariables } from '../src/utils/testData';
import { compatibility, isCompatible, testDataOf } from '../src/utils/testVariants';
import { translate } from '../src/i18n';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';

const { expandLabels } = require('../../backend/src/zpl/pagination');

const base = { labelWidth: 800, labelHeight: 600 };
const two = [{ mode: 'first' }, { mode: 'repeat' }];

const col = (field: string) => ({ header: field, field, width: 200, align: 'L' as const });
const table = (fields: string[], cap: number, page?: number): DesignElement => ({
  id: `t${page ?? 0}`, type: 'table', x: 40, y: 200, width: 0, height: 0, rowsPerPage: cap, columns: fields.map(col), ...(page !== undefined && { page }),
} as DesignElement);
const text = (value: string, page?: number, id?: string): DesignElement => ({
  id: id ?? `f${page ?? 0}`, type: 'text', x: 10, y: 10, width: 200, height: 40, value, fontSize: 30, fontName: '0', ...(page !== undefined && { page }),
} as DesignElement);
const dyn = (name: string, id = 'dyn'): DesignElement =>
  ({ id, type: 'text', x: 10, y: 60, width: 200, height: 40, dynamic: true, variableName: name, fontSize: 30, fontName: '0' } as DesignElement);

const names = (list: { name: string }[]) => list.map(c => c.name);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('variableConflicts: which names are in the two places', () => {
  test('1. a free variable and no table: nothing to find', () => {
    expect(variableConflicts([text('{{UC}}')])).toEqual([]);
  });

  test('2. a table and no free variable: nothing to find', () => {
    expect(variableConflicts([table(['PRODUTO'], 3)])).toEqual([]);
  });

  test('3. different names: nothing to find', () => {
    expect(variableConflicts([text('{{UC}}'), table(['PRODUTO'], 3)])).toEqual([]);
  });

  test('5. a free variable named like the first cell (CAMPO_1) collides', () => {
    const [c] = variableConflicts([text('{{PRODUTO_1}}'), table(['PRODUTO'], 3)]);
    expect(c).toMatchObject({ name: 'PRODUTO_1', severity: 'collision', freeIds: ['f0'], tableIds: ['t0'], collidingPages: [0], usedPages: [] });
  });

  test('6. and the second one (CAMPO_2)', () => {
    expect(names(variableConflicts([text('{{PRODUTO_2}}'), table(['PRODUTO'], 3)]))).toEqual(['PRODUTO_2']);
  });

  test('a name past the capacity is not a cell', () => {
    expect(variableConflicts([text('{{PRODUTO_4}}'), table(['PRODUTO'], 3)])).toEqual([]);
    expect(variableConflicts([text('{{PRODUTO_0}}'), table(['PRODUTO'], 3)])).toEqual([]);
  });

  test('7. the capacity decides the cells: with 1 the cell is CAMPO, with 3 it is CAMPO_1..3', () => {
    expect(names(variableConflicts([text('{{PRODUTO}}'), table(['PRODUTO'], 1)]))).toEqual(['PRODUTO']);
    expect(variableConflicts([text('{{PRODUTO}}'), table(['PRODUTO'], 3)])).toEqual([]);
    expect(variableConflicts([text('{{PRODUTO_1}}'), table(['PRODUTO'], 1)])).toEqual([]);
  });

  test('a change of the capacity creates or removes the collision', () => {
    const free = text('{{PRODUTO_4}}');
    expect(variableConflicts([free, table(['PRODUTO'], 3)])).toEqual([]);
    expect(names(variableConflicts([free, table(['PRODUTO'], 4)]))).toEqual(['PRODUTO_4']);
    expect(variableConflicts([free, table(['PRODUTO'], 2)])).toEqual([]);
  });

  test('upper and lower case are the same name, as for the SAP and the backend', () => {
    const [c] = variableConflicts([text('{{produto_1}}'), table(['PRODUTO'], 3)]);
    expect(c).toMatchObject({ name: 'produto_1', severity: 'collision' });
  });

  test('every kind of element that writes a marker counts: text, dynamic field, barcode, QR, Data Matrix', () => {
    const t = table(['PRODUTO'], 3);
    const writers: DesignElement[] = [
      text('Lote {{PRODUTO_1}}'), dyn('PRODUTO_1'),
      { id: 'b', type: 'barcode128', x: 0, y: 0, width: 200, height: 50, value: '{{PRODUTO_1}}', moduleWidth: 2 } as DesignElement,
      { id: 'q', type: 'qrcode', x: 0, y: 0, width: 100, height: 100, value: 'u/{{PRODUTO_1}}' } as DesignElement,
      { id: 'm', type: 'datamatrix', x: 0, y: 0, width: 48, height: 48, value: '{{PRODUTO_1}}' } as DesignElement,
    ];
    for (const w of writers) expect(names(variableConflicts([w, t]))).toEqual(['PRODUTO_1']);
  });

  test('a marker in a title of the table is the table\'s own text, not a free variable', () => {
    const t = table(['PRODUTO'], 3);
    (t.columns as any)[0].header = '{{PRODUTO_1}}';
    expect(variableConflicts([t])).toEqual([]);
  });

  test('8. two pages: the same name is a collision where the table is and ambiguous where it is not', () => {
    const elements = [text('{{PRODUTO_1}}', 0), table(['PRODUTO'], 3, 1)];
    const [c] = variableConflicts(elements);
    expect(c).toMatchObject({ severity: 'ambiguous', freePages: [0], cellPages: [1], collidingPages: [], usedPages: [0] });
    const both = variableConflicts([text('{{PRODUTO_1}}', 0), text('{{PRODUTO_1}}', 1, 'g'), table(['PRODUTO'], 3, 1)])[0];
    expect(both).toMatchObject({ severity: 'collision', freePages: [0, 1], cellPages: [1], collidingPages: [1], usedPages: [0] });
  });

  test('tables of different capacities on the two pages: each page has its own cells', () => {
    const elements = [text('{{PRODUTO_3}}', 0, 'a'), text('{{PRODUTO_3}}', 1, 'b'), table(['PRODUTO'], 2, 0), table(['PRODUTO'], 4, 1)];
    const [c] = variableConflicts(elements);
    expect(c).toMatchObject({ severity: 'collision', collidingPages: [1], cellPages: [1], usedPages: [0] });
  });

  test('which elements and which table are involved', () => {
    const els = [text('{{PRODUTO_1}}', undefined, 'a'), text('{{UC}}', undefined, 'b'), table(['PRODUTO'], 3)];
    expect(conflictsOfElement(els, 'a').map(c => c.name)).toEqual(['PRODUTO_1']);
    expect(conflictsOfElement(els, 'b')).toEqual([]);
    expect(conflictsOfTable(els, 't0').map(c => c.name)).toEqual(['PRODUTO_1']);
    expect(conflictsOfTable(els, 'nope')).toEqual([]);
  });

  test('a value is asked for only where it can be used', () => {
    const only = variableConflicts([text('{{PRODUTO_1}}', 0), table(['PRODUTO'], 3, 0)])[0];
    expect(valueIsUsed(only)).toBe(false);
    const elsewhere = variableConflicts([text('{{PRODUTO_1}}', 0), text('{{PRODUTO_1}}', 1, 'g'), table(['PRODUTO'], 3, 0)])[0];
    expect(valueIsUsed(elsewhere)).toBe(true);
    expect(valueIsUsed(undefined)).toBe(true);
  });

  test('pages as people count them', () => {
    expect(pagesText([0, 1])).toBe('1, 2');
  });

  test('the same list is returned for the same elements, and a changed list is looked at again', () => {
    const els = [text('{{PRODUTO_1}}'), table(['PRODUTO'], 3)];
    expect(variableConflicts(els)).toBe(variableConflicts(els));
    expect(variableConflicts([...els.slice(0, 1)])).toEqual([]);
  });
});

describe('fieldVariables: a free variable named like a column', () => {
  test('with a capacity above 1 it takes the field of the first record, and is not a collision', () => {
    const els = [text('{{PRODUTO}}'), table(['PRODUTO'], 3)];
    expect(variableConflicts(els)).toEqual([]);
    expect(fieldVariables(els)).toEqual([{ name: 'PRODUTO', field: 'PRODUTO', freeIds: ['f0'] }]);
  });

  test('with a capacity of 1 the name is the cell: a collision, not a field variable', () => {
    const els = [text('{{PRODUTO}}'), table(['PRODUTO'], 1)];
    expect(names(variableConflicts(els))).toEqual(['PRODUTO']);
    expect(fieldVariables(els)).toEqual([]);
  });

  test('a name that is neither is in neither list', () => {
    expect(fieldVariables([text('{{UC}}'), table(['PRODUTO'], 3)])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('the list of values (Dados de teste)', () => {
  test('a name that is a cell has a row that says it, and when the value would never be used it is not asked for', () => {
    const rows = valueRows([text('{{PRODUTO_1}}'), table(['PRODUTO'], 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'PRODUTO_1', inputOffered: false, conflict: { severity: 'collision' } });
    // the table is not listed as a user of the variable any more
    expect(rows[0].types).toEqual(['text']);
    expect(rows[0].elementIds).toEqual(['f0']);
  });

  test('a name that is the cell of capacity 1 (hidden before) is listed too', () => {
    const rows = valueRows([text('{{MATERIAL}}'), table(['MATERIAL'], 1)]);
    expect(rows.map(r => [r.name, r.inputOffered])).toEqual([['MATERIAL', false]]);
  });

  test('where the value can still be used the input stays, with the conflict attached', () => {
    const rows = valueRows([text('{{PRODUTO_1}}', 0), text('{{PRODUTO_1}}', 1, 'g'), table(['PRODUTO'], 3, 1)]);
    expect(rows[0]).toMatchObject({ name: 'PRODUTO_1', inputOffered: true, conflict: { severity: 'collision', usedPages: [0] } });
  });

  test('a name that is a cell on another page only keeps its input and says so', () => {
    const rows = valueRows([text('{{PRODUTO_1}}', 0), table(['PRODUTO'], 3, 1)]);
    expect(rows[0]).toMatchObject({ inputOffered: true, conflict: { severity: 'ambiguous' } });
  });

  test('a name like a column (capacity above 1) is listed as filled by the first record, with no input', () => {
    const rows = valueRows([text('{{PRODUTO}}'), table(['PRODUTO'], 3)]);
    expect(rows).toEqual([expect.objectContaining({ name: 'PRODUTO', fromField: 'PRODUTO', inputOffered: false, types: ['text'] })]);
  });

  test('3/16. variables with no relation to a table are as they were: one row each, with an input', () => {
    const rows = valueRows([text('{{UC}} {{VOL}}'), dyn('LOTE'), table(['PRODUTO'], 3)]);
    expect(rows.map(r => [r.name, r.inputOffered, r.conflict, r.fromField])).toEqual([
      ['LOTE', true, undefined, undefined], ['UC', true, undefined, undefined], ['VOL', true, undefined, undefined],
    ]);
  });

  test('labelVariables, the per-label columns and the data fields are not changed by this', () => {
    const els = [text('{{PRODUTO_1}} {{UC}}'), table(['PRODUTO'], 3)];
    expect(labelVariables(els)).toEqual(['PRODUTO_1', 'UC']);
    expect(dataFields(els)).toEqual(['PRODUTO']);
  });

  test('an element with no table at all gives the rows it always gave', () => {
    const rows = valueRows([text('{{A}} {{B}}')]);
    expect(rows.map(r => r.name)).toEqual(['A', 'B']);
    expect(rows.every(r => r.inputOffered && !r.conflict && !r.fromField)).toBe(true);
  });
});

describe('the catalog of variables', () => {
  test('separates the elements that write the marker from the table whose cell has the name, and carries the conflict', () => {
    const cat = variableCatalog([text('{{PRODUTO_1}}'), table(['PRODUTO'], 3)]);
    const entry = cat.find(v => v.name === 'PRODUTO_1')!;
    expect(entry.elementIds).toEqual(['f0', 't0']);                 // as before
    expect(entry.freeElementIds).toEqual(['f0']);
    expect(entry.conflict).toMatchObject({ severity: 'collision' });
    const cell = cat.find(v => v.name === 'PRODUTO_2')!;
    expect(cell.freeElementIds).toEqual([]);
    expect(cell.conflict).toBeUndefined();
  });

  test('a name that differs only by case is still flagged as before', () => {
    const cat = variableCatalog([text('{{PRODUTO_1}}'), dyn('produto_1'), table(['QTD'], 1)]);
    expect(cat.find(v => v.name === 'produto_1')!.clashesWith).toEqual(['PRODUTO_1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('saved test values and variants', () => {
  test('15. a variant with a value for a name a table fills is told so: the value is kept, not used', () => {
    const els = [text('{{PRODUTO_1}} {{UC}}'), table(['PRODUTO'], 3)];
    const c = compatibility(els, testDataOf({ PRODUTO_1: 'x', UC: 'u' }, []));
    expect(c.ignoredValues).toEqual(['PRODUTO_1']);
    expect(c.missingValues).toEqual([]);          // nothing is asked for it
    expect(c.unusedValues).toEqual([]);
    expect(isCompatible(c)).toBe(false);
  });

  test('a variant that has no such value is as compatible as before', () => {
    const els = [text('{{PRODUTO_1}} {{UC}}'), table(['PRODUTO'], 3)];
    const c = compatibility(els, testDataOf({ UC: 'u' }, [{ PRODUTO: 'A' }]));
    expect(c).toEqual({ unusedValues: [], missingValues: [], unknownColumns: [], missingColumns: [], ignoredValues: [] });
    expect(isCompatible(c)).toBe(true);
  });

  test('a variable that is filled by the first record is not reported as a missing value', () => {
    const els = [text('{{PRODUTO}}'), table(['PRODUTO'], 3)];
    expect(compatibility(els, testDataOf({}, [{ PRODUTO: 'A' }])).missingValues).toEqual([]);
  });

  test('14. what is saved with a design is what it always was: the used names, with a value', () => {
    const els = [text('{{PRODUTO_1}} {{UC}}'), table(['PRODUTO'], 2)];
    // the value of a name in conflict is kept (the user may rename the variable later), the others as ever
    expect(usedSamples(els, { PRODUTO_1: 'x', UC: 'u', OUTRA: 'z' })).toEqual({ PRODUTO_1: 'x', UC: 'u' });
  });
});

describe('13/14. saving and opening', () => {
  const designer = () => useDesignerStore.getState();
  beforeEach(() => {
    mockServer.designs.clear(); mockServer.nextId = 1;
    useDesignerStore.setState({
      elements: [], labelWidth: 800, labelHeight: 600, selectedId: null, selectedIds: [], sampleValues: {}, pages: [{ mode: 'first' }], activePage: 0, records: [],
    });
    useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  });

  test('a design with a collision is saved and opened as it was, with its values and records, and is flagged again', async () => {
    const elements = [text('{{PRODUTO_1}} {{UC}}'), table(['PRODUTO'], 3)];
    useDesignerStore.setState({ elements, sampleValues: { PRODUTO_1: 'x', UC: 'u' }, records: [{ PRODUTO: 'A' }, { PRODUTO: 'B' }] });
    await useDesignsStore.getState().saveNewDesign('D');
    const id = useDesignsStore.getState().activeDesignId!;
    useDesignerStore.setState({ elements: [], sampleValues: {}, records: [] });
    await useDesignsStore.getState().loadVersion(id, 1);

    expect(designer().elements).toEqual(elements);
    expect(designer().sampleValues).toEqual({ PRODUTO_1: 'x', UC: 'u' });
    expect(designer().records).toEqual([{ PRODUTO: 'A' }, { PRODUTO: 'B' }]);
    expect(names(variableConflicts(designer().elements))).toEqual(['PRODUTO_1']);
  });

  test('a design saved before tables existed has nothing to report', async () => {
    const elements = [text('{{PRODUTO_1}} {{UC}}')];
    useDesignerStore.setState({ elements });
    expect(variableConflicts(elements)).toEqual([]);
    expect(valueRows(elements).every(r => r.inputOffered)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('16/17. nothing is overwritten without the editor saying so (checked against the real expansion)', () => {
  const POOL = ['PRODUTO', 'PRODUTO_1', 'PRODUTO_3', 'produto_2', 'UC', 'QTD_1', 'QTD', 'OUTRO'];
  const FIELDS = ['PRODUTO', 'QTD'];
  const CAPACITIES = [1, 2, 3];
  const LAYOUTS: { free: number[]; tables: number[] }[] = [
    { free: [0], tables: [0] }, { free: [1], tables: [1] }, { free: [0], tables: [1] }, { free: [1], tables: [0] },
    { free: [0, 1], tables: [1] }, { free: [0, 1], tables: [0, 1] }, { free: [0], tables: [0, 1] },
  ];
  const SAMPLE = 'SAMPLE-X';
  const records = [1, 2, 3, 4, 5].map(n => ({ PRODUTO: `P${n}`, QTD: `Q${n}` }));

  test('for every combination: the value of a free variable is not used exactly when the editor reports it', () => {
    let checked = 0;
    for (const name of POOL) for (const cap of CAPACITIES) for (const layout of LAYOUTS) {
      const elements: DesignElement[] = [
        ...layout.free.map(p => text(`{{${name}}}`, p)),
        ...layout.tables.map(p => table(FIELDS, cap, p)),
      ];
      const result = expandLabels({ ...base, pages: two, elements, values: { [name]: SAMPLE }, records });
      const conflict = variableConflicts(elements).find(c => c.name.toUpperCase() === name.toUpperCase());
      const field = fieldVariables(elements).find(f => f.name.toUpperCase() === name.toUpperCase());

      let someOverwritten = false;
      for (const label of result.labels) {
        if (!layout.free.includes(label.page)) continue;
        const printed = (label.zpl.match(/\^FO10,10\^A0N,30,30\^FD([^^]*)\^FS/) ?? [])[1];
        const used = printed === SAMPLE;
        const inCollision = !!conflict && conflict.collidingPages.includes(label.page);
        const fromFirstRecord = !!field && label.recordCount > 0;
        if (!used) {
          someOverwritten = true;
          // overwritten: the editor must have said it (collision on that page) or listed it as filled by the record
          expect(inCollision || fromFirstRecord).toBe(true);
        } else {
          // used: the editor must not claim the opposite
          expect(inCollision).toBe(false);
        }
        checked++;
      }
      // and the backend reports a collision whenever the editor finds one on a page that printed
      const printedPages = new Set<number>(result.labels.map((l: any) => l.page));
      const expectWarning = !!conflict && conflict.collidingPages.some(p => printedPages.has(p));
      expect(result.warnings.includes('variable-collision')).toBe(expectWarning);
      void someOverwritten;
    }
    expect(checked).toBeGreaterThan(300);
  });

  test('the ZPL uses the value the editor says it uses: the sample where there is no collision, the cell where there is', () => {
    const noClash = expandLabels({ ...base, elements: [text('{{UC}}'), table(FIELDS, 3)], values: { UC: SAMPLE }, records });
    expect(noClash.labels[0].zpl).toContain(`^FD${SAMPLE}^FS`);
    const clash = expandLabels({ ...base, elements: [text('{{QTD_1}}'), table(FIELDS, 3)], values: { QTD_1: SAMPLE }, records });
    expect(clash.labels[0].zpl).not.toContain(SAMPLE);
    expect(clash.labels[0].zpl).toContain('^FDQ1^FS');
  });

  test('9/10/11/12. empty values, accents, several records and several labels with a collision keep their usual result', () => {
    const els = [text('{{QTD_2}} {{UC}}'), table(['PRODUTO', 'QTD'], 2)];
    const recs = [{ PRODUTO: 'café', QTD: '' }, { PRODUTO: 'p2', QTD: 'qç' }, { PRODUTO: 'p3', QTD: 'q3' }];
    const r = expandLabels({ ...base, elements: els, values: { UC: 'u^~' }, records: recs });
    expect(r.labels).toHaveLength(1);
    expect(r.unplaced).toBe(1);
    expect(r.labels[0].zpl).toContain('^FDqç u  ^FS');
    expect(r.warnings).toEqual(['unplaced-records', 'variable-collision']);
  });
});

describe('texts, in both languages', () => {
  const keys = ['conflict.rowCollision', 'conflict.rowIgnored', 'conflict.rowAmbiguous', 'conflict.fromField', 'conflict.element', 'conflict.elementAmbiguous',
    'conflict.table', 'conflict.tableAmbiguous', 'sim.warn.variable-collision', 'variants.compatIgnored'] as const;

  test.each(['pt-BR', 'en'] as const)('every key has a text in %s', lang => {
    for (const key of keys) expect(translate(lang, key)).not.toBe(key);
  });

  test('the parameters are filled in', () => {
    expect(translate('pt-BR', 'conflict.rowCollision', { pages: '1, 2' })).toContain('(página 1, 2)');
    expect(translate('en', 'conflict.element', { names: '{{A}}', pages: '2' })).toContain('{{A}}');
    expect(translate('en', 'conflict.table', { names: '{{A}}', pages: '2' })).toContain('(page 2)');
  });
});
