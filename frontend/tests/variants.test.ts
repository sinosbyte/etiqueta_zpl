// Test variants: named sets of test data (values + records) of a design. The "server" is an in-memory copy of the
// API's rules (unique name in any case per design, a limit, isolation between designs); the stores are the real ones.

/* eslint-disable @typescript-eslint/no-explicit-any */
const net = { expand: 0, previews: 0 };
const answers: boolean[] = [];
const asked: any[] = [];

jest.mock('../src/utils/zplClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { expandLabels } = require('../../backend/src/zpl/pagination');
  return {
    generateZpl: jest.fn(async () => 'ZPL'),
    parseZpl: jest.fn(), previewZpl: jest.fn(), exportZpl: jest.fn(),
    previewBlob: jest.fn(async (zpl: string) => { net.previews++; return new Blob([zpl], { type: 'image/png' }); }),
    expandZpl: jest.fn(async (payload: any) => { net.expand++; return JSON.parse(JSON.stringify(expandLabels(JSON.parse(JSON.stringify(payload))))); }),
  };
});
jest.mock('../src/utils/designsClient', () => ({
  apiCreateDesign: jest.fn(), apiGetVersion: jest.fn(), apiCreateVersion: jest.fn(), apiUpdateVersion: jest.fn(),
  apiListDesigns: jest.fn(), apiListVersions: jest.fn(), apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
}));
jest.mock('../src/store/useDialogStore', () => ({
  askConfirm: jest.fn(async (o: any) => { asked.push(o); return answers.length ? answers.shift() : true; }),
}));
jest.mock('../src/utils/variantsClient', () => {
  const clone = (v: any) => JSON.parse(JSON.stringify(v));
  // designId -> variants, oldest first
  const db = new Map<number, any[]>();
  const err = (m: string) => new Error(m);
  const list = (d: number) => { if (!db.has(d)) db.set(d, []); return db.get(d)!; };
  const summary = (v: any) => ({ id: v.id, name: v.name, valueCount: Object.keys(v.sampleValues).length, recordCount: v.records.length, createdAt: v.createdAt, updatedAt: v.updatedAt });
  let n = 0;
  return {
    __db: db,
    apiListVariants: jest.fn(async (d: number) => ({ items: list(d).map(summary), max: 50 })),
    apiGetVariant: jest.fn(async (d: number, id: string) => { const v = list(d).find(x => x.id === id); if (!v) throw err('Variant not found'); return clone(v); }),
    apiCreateVariant: jest.fn(async (d: number, name: string, data: any) => {
      const trimmed = name.trim();
      if (!trimmed) throw err('invalid');
      if (list(d).some(v => v.name.toLowerCase() === trimmed.toLowerCase())) throw err('Variant name already taken');
      if (list(d).length >= 50) throw err('limit');
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString();
      const v = { id: `id-${n}`, name: trimmed, sampleValues: clone(data.sampleValues), records: clone(data.records), createdAt: now, updatedAt: now };
      list(d).push(v);
      return clone(v);
    }),
    apiUpdateVariantData: jest.fn(async (d: number, id: string, data: any) => {
      const v = list(d).find(x => x.id === id); if (!v) throw err('Variant not found');
      v.sampleValues = clone(data.sampleValues); v.records = clone(data.records); v.updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, ++n)).toISOString();
      return clone(v);
    }),
    apiRenameVariant: jest.fn(async (d: number, id: string, name: string) => {
      const v = list(d).find(x => x.id === id); if (!v) throw err('Variant not found');
      if (list(d).some(o => o.id !== id && o.name.toLowerCase() === name.trim().toLowerCase())) throw err('Variant name already taken');
      v.name = name.trim(); return clone(v);
    }),
    apiDeleteVariant: jest.fn(async (d: number, id: string) => {
      const items = list(d); const i = items.findIndex(x => x.id === id); if (i < 0) throw err('Variant not found'); items.splice(i, 1);
    }),
  };
});
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { EMPTY_SIGNATURE } from '../src/utils/unsaved';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { useVariantsStore, isModified } from '../src/store/useVariantsStore';
import { DataRecord, DesignElement } from '../src/types';
import { compatibility, copyName, nameProblem, testDataOf, testDataSignature } from '../src/utils/testVariants';

const variants = () => useVariantsStore.getState();
const designer = () => useDesignerStore.getState();
const text = (id: string, value: string, y = 5): DesignElement => ({ id, type: 'text', x: 5, y, width: 200, height: 30, value, fontSize: 30, fontName: '0' });
const table = (): DesignElement => ({
  id: 't', type: 'table', x: 5, y: 80, width: 0, height: 0, rowsPerPage: 3, rowHeight: 40,
  columns: [{ header: 'Material', field: 'MATERIAL', width: 200, align: 'L' }, { header: 'Qtd', field: 'QTD', width: 100, align: 'R' }],
});
const design = () => [text('a', 'Remessa {{REMESSA}}'), text('b', 'Cliente {{CLIENTE}}', 40), table()];
const rec = (...m: string[]): DataRecord[] => m.map((x, i) => ({ MATERIAL: x, QTD: String((i + 1) * 10) }));

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
async function openDesign(id: number, elements: DesignElement[] = design()) {
  useDesignerStore.setState({ elements, pages: [{ mode: 'first' }], activePage: 0, records: [], sampleValues: {}, selectedId: null, selectedIds: [], labelWidth: 800, labelHeight: 600 });
  (useDesignerStore as any).temporal.getState().clear();
  useDesignsStore.setState({ activeDesignId: id });
  await flush();
}
const setData = (sampleValues: Record<string, string>, records: DataRecord[]) => useDesignerStore.setState({ sampleValues, records });

beforeEach(async () => {
  net.expand = 0; net.previews = 0; answers.length = 0; asked.length = 0;
  (require('../src/utils/variantsClient') as any).__db.clear();
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  await flush();
  useSimulationStore.getState().reset();
  await openDesign(1);
});

describe('saving', () => {
  test('values only', async () => {
    setData({ REMESSA: 'R-1', CLIENTE: 'ACME' }, []);
    expect(await variants().saveAs('Só valores')).toBe(true);
    const v = (require('../src/utils/variantsClient') as any).__db.get(1)[0];
    expect(v.sampleValues).toEqual({ CLIENTE: 'ACME', REMESSA: 'R-1' });
    expect(v.records).toEqual([]);
    expect(variants().items.map(i => i.name)).toEqual(['Só valores']);
  });

  test('table records only, in order, with the empty fields', async () => {
    setData({}, [{ MATERIAL: 'M3', QTD: '' }, { MATERIAL: 'M1', QTD: '1' }]);
    await variants().saveAs('Itens');
    const v = (require('../src/utils/variantsClient') as any).__db.get(1)[0];
    expect(v.records).toEqual([{ MATERIAL: 'M3', QTD: '' }, { MATERIAL: 'M1', QTD: '1' }]);
    expect(v.sampleValues).toEqual({});
  });

  test('values and records together, including a per-label column and a value of a variable the design no longer uses', async () => {
    setData({ REMESSA: 'R-9', ANTIGA: 'x' }, [{ MATERIAL: 'A', QTD: '1', UC: 'UC-1' }]);
    await variants().saveAs('Tudo');
    const v = (require('../src/utils/variantsClient') as any).__db.get(1)[0];
    expect(v.sampleValues).toEqual({ ANTIGA: 'x', REMESSA: 'R-9' });
    expect(v.records).toEqual([{ MATERIAL: 'A', QTD: '1', UC: 'UC-1' }]);
  });

  test('several variants of one design', async () => {
    setData({ REMESSA: '1' }, []);
    await variants().saveAs('Um');
    setData({ REMESSA: '2' }, rec('X'));
    await variants().saveAs('Dois');
    expect(variants().items.map(i => i.name)).toEqual(['Um', 'Dois']);
    expect(variants().items[1].recordCount).toBe(1);
  });

  test('after saving, the saved variant is the loaded one and the screen is not "modified"', async () => {
    setData({ REMESSA: '1' }, rec('X'));
    await variants().saveAs('Remessa 1');
    expect(variants().loadedName).toBe('Remessa 1');
    expect(isModified(variants().baseline, designer().sampleValues, designer().records)).toBe(false);
  });

  test('a variant needs a saved design: with none open nothing is saved', async () => {
    useDesignsStore.setState({ activeDesignId: null });
    await flush();
    setData({ REMESSA: '1' }, []);
    expect(await variants().saveAs('X')).toBe(false);
  });
});

describe('loading', () => {
  test('replaces the values and the records, and does not touch the design', async () => {
    setData({ REMESSA: 'A' }, rec('M1', 'M2'));
    await variants().saveAs('A');
    setData({ REMESSA: 'B', CLIENTE: 'Z' }, rec('Q'));
    await variants().saveAs('B');
    const before = { elements: designer().elements, pages: designer().pages, w: designer().labelWidth };
    answers.push(true);
    expect(await variants().load(variants().items[0].id)).toBe(true);
    expect(designer().sampleValues).toEqual({ REMESSA: 'A' });
    expect(designer().records).toEqual(rec('M1', 'M2'));
    expect(designer().elements).toBe(before.elements);
    expect(designer().pages).toBe(before.pages);
    expect(designer().labelWidth).toBe(before.w);
    expect(variants().loadedName).toBe('A');
  });

  test('invalidates a simulation already made, and sends nothing to the preview service', async () => {
    setData({ REMESSA: 'A' }, rec('M1', 'M2', 'M3', 'M4'));
    await variants().saveAs('A');
    await useSimulationStore.getState().run();
    expect(useSimulationStore.getState().stale).toBe(false);
    const expands = net.expand;
    setData({ REMESSA: 'B' }, rec('Q'));
    await variants().saveAs('B');
    await useSimulationStore.getState().run();
    const afterRun = net.expand;
    expect(afterRun).toBe(expands + 1);
    answers.push(true);
    await variants().load(variants().items[0].id);
    expect(useSimulationStore.getState().stale).toBe(true);
    expect(useSimulationStore.getState().result).not.toBeNull();   // the old picture stays visible, out of date
    expect(net.expand).toBe(afterRun);                             // nothing was asked of the service
    expect(net.previews).toBe(0);
  });

  test('loading the same variant that is loaded and unchanged does nothing and asks nothing', async () => {
    setData({ REMESSA: 'A' }, []);
    await variants().saveAs('A');
    expect(await variants().load(variants().loadedId!)).toBe(true);
    expect(asked).toHaveLength(0);
  });

  test('a variant that does not exist leaves the editor as it was', async () => {
    setData({ REMESSA: 'keep' }, rec('K'));
    await variants().saveAs('A');
    setData({ REMESSA: 'edit' }, rec('K'));
    answers.push(true);
    expect(await variants().load('nope')).toBe(false);
    expect(designer().sampleValues).toEqual({ REMESSA: 'edit' });
  });
});

describe('unsaved test data', () => {
  async function two() {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    setData({ REMESSA: 'B' }, rec('M2'));
    await variants().saveAs('B');
    return variants().items.map(i => i.id);
  }

  test('modified = different from the loaded variant; editing back to the same data is not modified', async () => {
    await two();
    const { baseline } = variants();
    expect(isModified(baseline, designer().sampleValues, designer().records)).toBe(false);
    setData({ REMESSA: 'changed' }, designer().records);
    expect(isModified(baseline, designer().sampleValues, designer().records)).toBe(true);
    setData({ REMESSA: 'B' }, designer().records);
    expect(isModified(baseline, designer().sampleValues, designer().records)).toBe(false);
    expect(isModified(null, { X: '1' }, [])).toBe(false);   // no variant loaded: nothing to differ from
  });

  test('loading another variant over modified data warns with the agreed text, and cancel changes nothing', async () => {
    const [a] = await two();
    setData({ REMESSA: 'unsaved' }, rec('U'));
    answers.push(false);
    expect(await variants().load(a)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toBe('Existem alterações nos dados de teste que ainda não foram salvas em uma variante. Deseja continuar e carregar outra variante? Essas alterações serão substituídas.');
    expect(asked[0].danger).toBe(true);
    expect(designer().sampleValues).toEqual({ REMESSA: 'unsaved' });
    expect(variants().loadedName).toBe('B');
    answers.push(true);
    expect(await variants().load(a)).toBe(true);
    expect(designer().sampleValues).toEqual({ REMESSA: 'A' });
  });

  test('no warning when the data on screen is exactly the loaded variant', async () => {
    const [a] = await two();
    await variants().load(a);
    expect(asked).toHaveLength(0);
  });

  test('with no variant loaded, data on screen is not saved anywhere: it warns; with nothing on screen it does not', async () => {
    const [a] = await two();
    useVariantsStore.setState({ loadedId: null, loadedName: '', baseline: null });
    setData({ REMESSA: 'typed' }, []);
    answers.push(false);
    expect(await variants().load(a)).toBe(false);
    expect(asked).toHaveLength(1);
    asked.length = 0;
    setData({}, []);
    expect(await variants().load(a)).toBe(true);
    expect(asked).toHaveLength(0);
  });
});

describe('update, save as, rename, delete', () => {
  test('Update changes only the selected variant and the screen becomes "not modified"', async () => {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    setData({ REMESSA: 'B' }, rec('M2'));
    await variants().saveAs('B');
    const [a, b] = variants().items.map(i => i.id);
    setData({ REMESSA: 'B2' }, rec('M2', 'M3'));
    expect(await variants().updateLoaded()).toBe(true);
    const db = (require('../src/utils/variantsClient') as any).__db.get(1);
    expect(db.find((v: any) => v.id === b)).toMatchObject({ name: 'B', sampleValues: { REMESSA: 'B2' }, records: rec('M2', 'M3') });
    expect(db.find((v: any) => v.id === a)).toMatchObject({ sampleValues: { REMESSA: 'A' }, records: rec('M1') });
    expect(isModified(variants().baseline, designer().sampleValues, designer().records)).toBe(false);
  });

  test('Save as from a loaded variant creates a new one and leaves the original as it was', async () => {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    const a = variants().loadedId!;
    setData({ REMESSA: 'changed' }, rec('M1', 'M9'));
    expect(await variants().saveAs('A - cópia')).toBe(true);
    const db = (require('../src/utils/variantsClient') as any).__db.get(1);
    expect(db).toHaveLength(2);
    expect(db.find((v: any) => v.id === a)).toMatchObject({ sampleValues: { REMESSA: 'A' }, records: rec('M1') });
    expect(variants().loadedName).toBe('A - cópia');
  });

  test('rename keeps the data and updates the loaded name; a name taken is refused with nothing changed', async () => {
    setData({ REMESSA: 'A' }, []);
    await variants().saveAs('A');
    setData({ REMESSA: 'B' }, []);
    await variants().saveAs('B');
    const [a, b] = variants().items.map(i => i.id);
    expect(await variants().rename(b, 'a')).toBe(false);          // same as "A" in another case
    expect(variants().items.map(i => i.name)).toEqual(['A', 'B']);
    expect(await variants().rename(b, 'Novo')).toBe(true);
    expect(variants().loadedName).toBe('Novo');
    expect((require('../src/utils/variantsClient') as any).__db.get(1)[1].sampleValues).toEqual({ REMESSA: 'B' });
    void a;
  });

  test('delete removes only that variant; the data on screen, the design and the other variants stay', async () => {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    setData({ REMESSA: 'B' }, rec('M2'));
    await variants().saveAs('B');
    const [a, b] = variants().items.map(i => i.id);
    const elements = designer().elements;
    expect(await variants().remove(b)).toBe(true);
    expect(variants().items.map(i => i.id)).toEqual([a]);
    expect(variants().loadedId).toBeNull();                         // no longer linked to a variant
    expect(designer().sampleValues).toEqual({ REMESSA: 'B' });      // the loaded data is still there
    expect(designer().records).toEqual(rec('M2'));
    expect(designer().elements).toBe(elements);
  });
});

describe('duplicate names', () => {
  test('the same name in any case, or with spaces around, is a problem; empty and too long as well', () => {
    const others = [{ id: '1', name: 'Remessa 1' }];
    expect(nameProblem('remessa 1', others)).toBe('taken');
    expect(nameProblem('  REMESSA 1 ', others)).toBe('taken');
    expect(nameProblem('Remessa 2', others)).toBeNull();
    expect(nameProblem('   ', others)).toBe('empty');
    expect(nameProblem('x'.repeat(101), others)).toBe('tooLong');
    expect(nameProblem('Remessa 1', others, '1')).toBeNull();      // its own name, when renaming
  });

  test('saving a name that exists is refused and the existing variant is not overwritten', async () => {
    setData({ REMESSA: 'A' }, []);
    await variants().saveAs('Remessa 1');
    setData({ REMESSA: 'OTHER' }, []);
    expect(await variants().saveAs('remessa 1')).toBe(false);
    expect((require('../src/utils/variantsClient') as any).__db.get(1)).toHaveLength(1);
    expect((require('../src/utils/variantsClient') as any).__db.get(1)[0].sampleValues).toEqual({ REMESSA: 'A' });
  });

  test('a suggested copy name is free', () => {
    expect(copyName('A', [{ name: 'A' }], 'cópia')).toBe('A - cópia');
    expect(copyName('A', [{ name: 'A - cópia' }], 'cópia')).toBe('A - cópia 2');
  });
});

describe('persistence and isolation', () => {
  test('after closing and reopening the design the list is back, and a variant loads', async () => {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    // another session: the editor and the stores start over, the "server" keeps the variants
    useDesignsStore.setState({ activeDesignId: null });
    await flush();
    expect(variants().items).toEqual([]);
    await openDesign(1);
    expect(variants().items.map(i => i.name)).toEqual(['A']);
    expect(designer().sampleValues).toEqual({});
    expect(await variants().load(variants().items[0].id)).toBe(true);
    expect(designer().sampleValues).toEqual({ REMESSA: 'A' });
    expect(designer().records).toEqual(rec('M1'));
  });

  test('variants of one design are not seen in another, and opening another design drops the loaded one', async () => {
    setData({ REMESSA: 'A' }, rec('M1'));
    await variants().saveAs('A');
    await openDesign(2);
    expect(variants().items).toEqual([]);
    expect(variants().loadedId).toBeNull();
    setData({ REMESSA: 'B' }, []);
    await variants().saveAs('A');                                   // the same name is fine in another design
    expect(variants().items).toHaveLength(1);
    await openDesign(1);
    expect(variants().items.map(i => i.name)).toEqual(['A']);
    expect(variants().items[0].recordCount).toBe(1);
  });
});

describe('a design that changed after the variant was saved', () => {
  test('values of a variable that no longer exists are kept and reported; new variables are not filled in with a guess', async () => {
    setData({ REMESSA: 'A', CLIENTE: 'ACME' }, rec('M1'));
    await variants().saveAs('Antiga');
    // the design changes: CLIENTE goes away, TRANSP is new
    const elements = [text('a', 'Remessa {{REMESSA}}'), text('c', 'Transp {{TRANSP}}', 40), table()];
    useDesignerStore.setState({ elements });
    setData({}, []);
    await variants().load(variants().items[0].id);
    expect(designer().sampleValues).toEqual({ CLIENTE: 'ACME', REMESSA: 'A' });   // nothing dropped, nothing invented
    expect(designer().sampleValues.TRANSP).toBeUndefined();
    const c = compatibility(elements, testDataOf(designer().sampleValues, designer().records));
    expect(c.unusedValues).toEqual(['CLIENTE']);
    expect(c.missingValues).toEqual(['TRANSP']);
    expect(designer().elements).toBe(elements);                    // the design was not touched
  });

  test('records keep working while the table fields are compatible; unknown and missing columns are reported', () => {
    const elements = design();
    const ok = compatibility(elements, testDataOf({ REMESSA: '1', CLIENTE: 'c' }, rec('A', 'B')));
    expect(ok).toEqual({ unusedValues: [], missingValues: [], unknownColumns: [], missingColumns: [] });
    const changed = compatibility(elements, testDataOf({ REMESSA: '1', CLIENTE: 'c' }, [{ MATERIAL: 'A', LOTE: 'L1' }]));
    expect(changed.unknownColumns).toEqual(['LOTE']);
    expect(changed.missingColumns).toEqual(['QTD']);
  });

  test('case does not matter, as the SAP replaces without it', () => {
    const c = compatibility([text('a', '{{REMESSA}}')], testDataOf({ remessa: 'x' }, []));
    expect(c.unusedValues).toEqual([]);
    expect(c.missingValues).toEqual([]);
  });
});

describe('the snapshot', () => {
  test('empty values are not stored, the order of records and the empty fields are kept, equal data has one signature', () => {
    const d = testDataOf({ A: '1', B: '', 'bad name': 'x' }, [{ X: '2', Y: '' }, { X: '1', Y: '' }]);
    expect(d.sampleValues).toEqual({ A: '1' });
    expect(d.records).toEqual([{ X: '2', Y: '' }, { X: '1', Y: '' }]);
    expect(testDataSignature({ A: '1', B: '2' }, [{ X: '1', Y: '2' }])).toBe(testDataSignature({ B: '2', A: '1' }, [{ Y: '2', X: '1' }]));
    expect(testDataSignature({}, [{ X: '1' }, { X: '2' }])).not.toBe(testDataSignature({}, [{ X: '2' }, { X: '1' }]));
  });
});
