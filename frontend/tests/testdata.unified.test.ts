// The single Test data environment: every variable of the label in one list, the records of the tables beside it,
// and one preview (the simulation of the backend, the queue and the cache) for every kind of design.

/* eslint-disable @typescript-eslint/no-explicit-any */
const net = { requests: [] as any[], fail: null as null | string, previews: [] as string[], failPreview: new Set<string>() };

jest.mock('../src/utils/zplClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { expandLabels } = require('../../backend/src/zpl/pagination');
  return {
    generateZpl: jest.fn(async () => 'ZPL'),
    parseZpl: jest.fn(), previewZpl: jest.fn(), exportZpl: jest.fn(),
    // the picture of a label: counted, and refused for the ZPLs the test asks to fail
    previewBlob: jest.fn(async (zpl: string) => {
      net.previews.push(zpl);
      if ([...net.failPreview].some(m => zpl.includes(m))) throw Object.assign(new Error('bad request'), { status: 400 });
      return new Blob([zpl], { type: 'image/png' });
    }),
    expandZpl: jest.fn(async (payload: any) => {
      const body = JSON.parse(JSON.stringify(payload));
      net.requests.push(body);
      if (net.fail) throw new Error(net.fail);
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
    apiGetVersion: jest.fn(async (id: number) => ({ id, versionNumber: 1, createdAt: 'now', ...clone(store.get(id)), sampleValues: clone(store.get(id).sampleValues ?? {}), pagesConfig: clone(store.get(id).pagesConfig ?? null) })),
    apiCreateVersion: jest.fn(), apiUpdateVersion: jest.fn(), apiListDesigns: jest.fn(), apiListVersions: jest.fn(), apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
  };
});
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { EMPTY_SIGNATURE } from '../src/utils/unsaved';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { useLabelRenderStore } from '../src/store/useLabelRenderStore';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { DataRecord, DesignElement } from '../src/types';
import { addLabelField, dataFields, labelFields, labelVariables, removeLabelField, setCell, valueRows } from '../src/utils/testData';
import { variableCatalog } from '../src/utils/variableCatalog';

const designer = () => useDesignerStore.getState();
const sim = () => useSimulationStore.getState();
const text = (id: string, value: string, extra: Partial<DesignElement> = {}): DesignElement => ({ id, type: 'text', x: 5, y: 5, width: 200, height: 30, value, fontSize: 30, fontName: '0', ...extra });
const table = (page: number | undefined, rowsPerPage: number): DesignElement => ({
  id: `t${page ?? 0}`, type: 'table', x: 5, y: 80, width: 0, height: 0, rowsPerPage, rowHeight: 40, ...(page !== undefined && { page }),
  columns: [{ header: 'Material', field: 'MATERIAL', width: 200, align: 'L' }, { header: 'Qtd', field: 'QTD', width: 100, align: 'R' }],
});
const rec = (n: number): DataRecord[] => Array.from({ length: n }, (_, i) => ({ MATERIAL: `M${i + 1}`, QTD: `${(i + 1) * 10}` }));
const two = [{ mode: 'first' as const }, { mode: 'repeat' as const }];
const fds = (zpl: string) => [...zpl.matchAll(/\^FD([^^]*)\^FS/g)].map(m => m[1]);

function load(elements: DesignElement[], records: DataRecord[] = [], pages: any[] = [{ mode: 'first' }], samples: Record<string, string> = {}) {
  useDesignerStore.setState({ elements, records, pages, activePage: 0, selectedId: null, selectedIds: [], sampleValues: samples, labelWidth: 800, labelHeight: 600 });
  (useDesignerStore as any).temporal.getState().clear();
}
function closeEditor() {
  useDesignerStore.setState({ elements: [], records: [], pages: [{ mode: 'first' }], activePage: 0, sampleValues: {}, showSamples: false, selectedId: null, selectedIds: [], labelWidth: 800, labelHeight: 600 });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
  useSimulationStore.getState().reset();
  useLabelRenderStore.getState().reset();
}
const wait = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

beforeEach(() => { net.requests.length = 0; net.previews.length = 0; net.fail = null; net.failPreview.clear(); closeEditor(); });

describe('every variable of the label, in one list', () => {
  const dynamicDesign = (): DesignElement[] => [
    text('t', 'Cliente {{CLIENTE}}'),
    { id: 'b', type: 'barcode128', x: 5, y: 50, width: 268, height: 80, value: '{{COD}}', moduleWidth: 2 },
    { id: 'q', type: 'qrcode', x: 300, y: 50, width: 100, height: 100, value: '{{REMESSA}}', qrMagnification: 4 },
    { id: 'm', type: 'datamatrix', x: 420, y: 50, width: 48, height: 48, value: '{{DM}}', dmModuleSize: 4 },
    text('d', '', { dynamic: true, variableName: 'NOME', y: 200 }),
  ];

  test('text, barcode, QR code, Data Matrix and dynamic fields all appear, each with what uses it', () => {
    const rows = valueRows(dynamicDesign());
    expect(rows.map(r => r.name).sort()).toEqual(['CLIENTE', 'COD', 'DM', 'NOME', 'REMESSA']);
    const used = Object.fromEntries(rows.map(r => [r.name, r.types]));
    expect(used.CLIENTE).toEqual(['text']);
    expect(used.COD).toEqual(['barcode128']);
    expect(used.REMESSA).toEqual(['qrcode']);
    expect(used.DM).toEqual(['datamatrix']);
    expect(used.NOME).toEqual(['text']);
  });

  test('a variable that several elements share is one row, with all of them as users', () => {
    const rows = valueRows([text('a', 'Remessa {{REMESSA}}'), { id: 'q', type: 'qrcode', x: 1, y: 1, width: 100, height: 100, value: '{{REMESSA}}', qrMagnification: 4 }, text('c', '{{REMESSA}} / {{OUTRA}}', { y: 60 })]);
    const remessa = rows.filter(r => r.name === 'REMESSA');
    expect(remessa).toHaveLength(1);
    expect(remessa[0].elementIds).toEqual(['a', 'q', 'c']);
    expect(remessa[0].types).toEqual(['text', 'qrcode']);
  });

  test('table cells are not in the list (they are records); the variables outside the tables are', () => {
    const rows = valueRows([text('h', 'Remessa {{REMESSA}}'), table(0, 2)]);
    expect(rows.map(r => r.name)).toEqual(['REMESSA']);
    expect(dataFields([text('h', '{{REMESSA}}'), table(0, 2)])).toEqual(['MATERIAL', 'QTD']);
  });

  test('a new element or variable shows up on its own, and a removed one leaves the list', () => {
    load([text('a', 'x {{UM}}')]);
    expect(valueRows(designer().elements).map(r => r.name)).toEqual(['UM']);
    designer().addElement('text', 5, 60, { id: 'b', value: '{{DOIS}}' });
    expect(valueRows(designer().elements).map(r => r.name)).toEqual(['DOIS', 'UM']);
    designer().deleteElement('a');
    expect(valueRows(designer().elements).map(r => r.name)).toEqual(['DOIS']);
  });

  test('a design without variables has an empty list, and without a table no per-label option makes sense', () => {
    expect(valueRows([text('a', 'fixed')])).toEqual([]);
    expect(dataFields([text('a', 'fixed')])).toEqual([]);
  });

  test('the list and the catalog agree on what the design has', () => {
    const els = [...dynamicDesign(), table(0, 1)];
    expect(variableCatalog(els).map(v => v.name)).toEqual(expect.arrayContaining(valueRows(els).map(r => r.name)));
  });
});

describe('one preview for every kind of design', () => {
  test('1 + 3 + 4: a simple label with variables, QR and barcode, with the values entered', async () => {
    load([
      text('t', 'Cliente {{CLIENTE}}'),
      { id: 'b', type: 'barcode128', x: 5, y: 50, width: 268, height: 80, value: '{{COD}}', moduleWidth: 2 },
      { id: 'q', type: 'qrcode', x: 300, y: 50, width: 100, height: 100, value: '{{REMESSA}}', qrMagnification: 4 },
    ], [], [{ mode: 'first' }], { CLIENTE: 'ACME', COD: '12345', REMESSA: '87279517' });
    await sim().run();
    const r = sim().result!;
    expect(r.labels).toHaveLength(1);                                              // no table, no page break: one label, no special mode
    const z = r.labels[0].zpl;
    expect(fds(z)).toEqual(expect.arrayContaining(['Cliente ACME']));
    expect(z).toContain('12345');                                                  // the barcode
    expect(z).toContain('87279517');                                               // the QR code
    expect(z).not.toContain('{{');
  });

  test('2: several dynamic elements at once', async () => {
    load([text('t', 'A {{UM}} B {{DOIS}}'), text('u', '', { dynamic: true, variableName: 'TRES', y: 60 })], [], [{ mode: 'first' }], { UM: '1', DOIS: '2', TRES: '3' });
    await sim().run();
    expect(fds(sim().result!.labels[0].zpl)).toEqual(expect.arrayContaining(['A 1 B 2', '3']));
  });

  test('9: a variable shared between elements gets the same value in all of them', async () => {
    load([text('a', 'Remessa {{REMESSA}}'), { id: 'q', type: 'qrcode', x: 1, y: 60, width: 100, height: 100, value: '{{REMESSA}}', qrMagnification: 4 }], [], [{ mode: 'first' }], { REMESSA: 'R777' });
    await sim().run();
    const z = sim().result!.labels[0].zpl;
    expect(z.match(/R777/g)!.length).toBe(2);
  });

  test('5 + 6 + 8: a table with several records, no page break', async () => {
    load([text('h', 'Remessa {{REMESSA}}'), table(undefined, 3)], rec(7), [{ mode: 'first' }], { REMESSA: 'R1' });
    await sim().run();
    const r = sim().result!;
    expect(r.labels.map(l => l.recordCount)).toEqual([3]);                         // one page: what does not fit is reported, as always
    expect(r.unplaced).toBe(4);
    expect(fds(r.labels[0].zpl)).toEqual(expect.arrayContaining(['Remessa R1', 'M1', 'M2', 'M3']));
  });

  test('7: with a page break the same preview shows every label, each with its records', async () => {
    load([text('h', 'Remessa {{REMESSA}}', { page: 0 }), table(0, 1), text('u', 'Remessa {{REMESSA}} UC {{UC}}', { page: 1 }), table(1, 2)],
      rec(5).map((r, i) => ({ ...r, UC: `UC-${i + 1}` })), two, { REMESSA: 'R1' });
    await sim().run();
    const r = sim().result!;
    expect(r.labels.map(l => [l.page, l.recordStart, l.recordCount])).toEqual([[0, 0, 1], [1, 1, 2], [1, 3, 2]]);
    expect(fds(r.labels[1].zpl)).toEqual(expect.arrayContaining(['Remessa R1 UC UC-2', 'M2', 'M3']));
    expect(fds(r.labels[2].zpl)).toEqual(expect.arrayContaining(['Remessa R1 UC UC-4', 'M4', 'M5']));
  });

  test('the shared value (Remessa) and the per-label one (UC) are not mixed: the shared one is the same on every label', async () => {
    load([text('u', 'R {{REMESSA}} UC {{UC}}', { page: 1 }), table(1, 1)], rec(3).map((r, i) => ({ ...r, UC: `UC-${i + 1}` })), two, { REMESSA: 'R1', UC: 'comum' });
    await sim().run();
    const texts = sim().result!.labels.flatMap(l => fds(l.zpl)).filter(x => x.startsWith('R '));
    expect(texts.sort()).toEqual(['R R1 UC UC-1', 'R R1 UC UC-2', 'R R1 UC UC-3']);
  });
});

describe('changing values and updating the preview', () => {
  test('10: changing a value after the preview marks it out of date and sends nothing', async () => {
    load([text('a', 'Cliente {{CLIENTE}}')], [], [{ mode: 'first' }], { CLIENTE: 'A' });
    await sim().run();
    const requests = net.requests.length;
    designer().setSampleValues({ CLIENTE: 'B' });
    designer().setSampleValues({ CLIENTE: 'BB' });
    designer().setSampleValues({ CLIENTE: 'BBB' });                                // typing: three changes
    expect(sim().stale).toBe(true);
    expect(sim().view).toBeNull();
    expect(net.requests.length).toBe(requests);                                    // nothing was sent while typing
    expect(sim().result).not.toBeNull();                                           // the old preview stays, marked
  });

  test('11: updating the preview keeps every value and record, and uses the new ones', async () => {
    load([text('a', 'Cliente {{CLIENTE}}'), table(undefined, 2)], rec(2), [{ mode: 'first' }], { CLIENTE: 'A' });
    await sim().run();
    designer().setSampleValues({ CLIENTE: 'B' });
    designer().setRecords(setCell(designer().records, 0, 'MATERIAL', 'NOVO')!);
    const before = JSON.stringify({ s: designer().sampleValues, r: designer().records });
    await sim().run();
    expect(JSON.stringify({ s: designer().sampleValues, r: designer().records })).toBe(before);   // nothing was lost
    expect(sim().stale).toBe(false);
    expect(fds(sim().result!.labels[0].zpl)).toEqual(expect.arrayContaining(['Cliente B', 'NOVO']));
  });

  test('15: ensure() (the top-bar button) sends nothing when the preview is valid or is being made, and makes it otherwise', async () => {
    load([text('a', '{{X}}')], [], [{ mode: 'first' }], { X: '1' });
    await sim().ensure();
    expect(net.requests).toHaveLength(1);
    await sim().ensure();
    await sim().ensure();
    expect(net.requests).toHaveLength(1);                                          // valid: no new request
    designer().setSampleValues({ X: '2' });
    const a = sim().ensure();
    const b = sim().ensure();                                                      // a second click while it is being made
    await Promise.all([a, b]);
    expect(net.requests).toHaveLength(2);
  });

  test('15: the label pictures are not asked for again when the same ZPL comes back', async () => {
    load([text('a', 'V {{X}}')], [], [{ mode: 'first' }], { X: '1' });
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => useLabelRenderStore.getState().pictures[1]?.status === 'ready');
    expect(net.previews).toHaveLength(1);
    await sim().run();                                                             // same values: same ZPL
    useLabelRenderStore.getState().show(1);
    await wait(() => useLabelRenderStore.getState().pictures[1]?.status === 'ready');
    expect(net.previews).toHaveLength(1);                                          // from the cache
    designer().setSampleValues({ X: '2' });
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => useLabelRenderStore.getState().pictures[1]?.status === 'ready');
    expect(net.previews).toHaveLength(2);                                          // another value: another picture
  });
});

describe('failures', () => {
  test('14: a failed simulation is reported and nothing the user typed is lost', async () => {
    load([text('a', '{{X}}'), table(undefined, 1)], rec(2), [{ mode: 'first' }], { X: '1' });
    net.fail = 'Page 1 has more than one table';
    await sim().run();
    expect(sim().status).toBe('error');
    expect(designer().sampleValues).toEqual({ X: '1' });
    expect(designer().records).toHaveLength(2);
    net.fail = null;
    await sim().run();                                                             // and the next click works
    expect(sim().status).toBe('ready');
  });

  test('14: a picture that cannot be rendered fails alone; the values, the records and the ZPL are still there', async () => {
    load([text('a', 'V {{X}}')], [], [{ mode: 'first' }], { X: 'FALHA' });
    net.failPreview.add('FALHA');
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => useLabelRenderStore.getState().pictures[1]?.status === 'error');
    expect(sim().result!.labels[0].zpl).toContain('FALHA');
    expect(designer().sampleValues).toEqual({ X: 'FALHA' });
  });
});

describe('per-label values and the records', () => {
  const els = (): DesignElement[] => [text('h', 'R {{REMESSA}} UC {{UC}}', { page: 0 }), table(0, 2)];

  test('turning "changes per label" on adds the column to every record, keeping their values', () => {
    const next = addLabelField(rec(3), 'UC')!;
    expect(next.map(r => r.MATERIAL)).toEqual(['M1', 'M2', 'M3']);
    expect(labelFields(els(), next)).toEqual(['UC']);
    expect(labelVariables(els())).toEqual(['REMESSA', 'UC']);                       // the list still has UC once
  });

  test('turning it off removes the column and says how many values were in it, so the user is asked first', () => {
    let records = addLabelField(rec(3), 'UC')!;
    records = setCell(records, 0, 'UC', 'a')!;
    records = setCell(records, 2, 'UC', 'c')!;
    const { records: after, filled } = removeLabelField(records, 'UC');
    expect(filled).toBe(2);
    expect(after.every(r => !('UC' in r))).toBe(true);
    expect(after.map(r => r.MATERIAL)).toEqual(['M1', 'M2', 'M3']);                // the rest is untouched
    expect(removeLabelField(addLabelField(rec(2), 'UC')!, 'UC').filled).toBe(0);    // an empty column goes without asking
  });

  test('a removed variable leaves its per-label column as an orphan with its data, nothing is deleted', () => {
    const records = setCell(addLabelField(rec(2), 'UC')!, 0, 'UC', 'keep')!;
    const withoutUc = [text('h', 'R {{REMESSA}}', { page: 0 }), table(0, 2)];     // the text that used {{UC}} is gone
    expect(labelFields(withoutUc, records)).toEqual([]);
    expect(records[0].UC).toBe('keep');                                            // the value is still in the record
  });

  test('the table records keep working: add, edit, delete', () => {
    load([table(undefined, 2)], rec(2), [{ mode: 'first' }]);
    designer().setRecords([...designer().records, { MATERIAL: 'M3', QTD: '30' }]);
    designer().setRecords(setCell(designer().records, 0, 'QTD', '99')!);
    designer().setRecords(designer().records.filter((_, i) => i !== 1));
    expect(designer().records).toEqual([{ MATERIAL: 'M1', QTD: '99' }, { MATERIAL: 'M3', QTD: '30' }]);
  });
});

describe('persistence', () => {
  test('12 + 13: the values, the records and the per-label columns are saved and come back when the design is reopened', async () => {
    const records = setCell(addLabelField(rec(3), 'UC')!, 1, 'UC', 'UC-9')!;
    load([text('h', 'R {{REMESSA}} UC {{UC}}', { page: 0 }), table(0, 2)], records, [{ mode: 'first' }], { REMESSA: 'R1', UC: 'comum' });
    await useDesignsStore.getState().saveNewDesign('Unificado');
    expect(isDirtyNow()).toBe(false);
    const saved = { s: designer().sampleValues, r: designer().records };
    closeEditor();
    await useDesignsStore.getState().loadVersion(1, 1);
    expect(designer().sampleValues).toEqual(saved.s);
    expect(designer().records).toEqual(saved.r);
    expect(labelFields(designer().elements, designer().records)).toEqual(['UC']);
    expect(isDirtyNow()).toBe(false);
    await sim().run();                                                             // and the preview works from what was reopened
    expect(fds(sim().result!.labels[0].zpl)).toEqual(expect.arrayContaining(['R R1 UC comum']));
  });

  test('changing a test value is an unsaved change', async () => {
    load([text('a', '{{X}}')], [], [{ mode: 'first' }], { X: '1' });
    await useDesignsStore.getState().saveNewDesign('Valores');
    expect(isDirtyNow()).toBe(false);
    designer().setSampleValues({ X: '2' });
    expect(isDirtyNow()).toBe(true);
  });
});
