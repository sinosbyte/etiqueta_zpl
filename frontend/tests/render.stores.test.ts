// The preview of each label and the PDF export, wired to the simulation: which labels are asked for and when, what
// each request carries, what happens when the simulation changes, and the export's states.

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockSim = { labels: 8, zplOf: (i: number) => `^XA^FD${i}^FS^XZ` };

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async () => 'ZPL'),
  parseZpl: jest.fn(), previewZpl: jest.fn(), exportZpl: jest.fn(), previewBlob: jest.fn(),
  expandZpl: jest.fn(async () => ({
    labels: Array.from({ length: mockSim.labels }, (_, i) => ({ index: i + 1, page: i === 0 ? 0 : 1, recordStart: i, recordCount: 1, zpl: mockSim.zplOf(i + 1) })),
    totalRecords: mockSim.labels, unplaced: 0, warnings: [], zpl: 'ALL',
  })),
}));
jest.mock('../src/utils/pdfExport', () => {
  const actual = jest.requireActual('../src/utils/pdfExport');
  return { ...actual, downloadPdf: jest.fn(), encodePng: jest.fn(async (blob: Blob) => ({ width: 2, height: 2, data: new Uint8Array([120, 156, 99, 96, 0, 0, 0, 2, 0, 1]), text: await blob.text() })) };
});
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { RenderCache } from '../src/utils/renderCache';
import { RenderQueue } from '../src/utils/renderQueue';
import { LabelRenderer } from '../src/utils/labelRenderer';
import { downloadPdf } from '../src/utils/pdfExport';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { setLabelRenderer, useLabelRenderStore } from '../src/store/useLabelRenderStore';
import { usePdfExportStore } from '../src/store/usePdfExportStore';

const designer = () => useDesignerStore.getState();
const sim = () => useSimulationStore.getState();
const pictures = () => useLabelRenderStore.getState().pictures;
const pdf = () => usePdfExportStore.getState();
const wait = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting'); await new Promise(r => setTimeout(r, 5)); }
};

let fetchMock: jest.Mock;
let renderer: LabelRenderer;
let gate: { hold: boolean; release: (() => void)[] };
let failing: Set<number>;

beforeEach(() => {
  mockSim.labels = 8;
  failing = new Set();
  gate = { hold: false, release: [] };
  fetchMock = jest.fn(async (zpl: string, _w: number, _h: number, signal: AbortSignal) => {
    if (gate.hold) await new Promise<void>((res, rej) => { gate.release.push(res); signal.addEventListener('abort', () => rej(new Error('aborted'))); });
    const n = Number(/\^FD(\d+)/.exec(zpl)![1]);
    if (failing.has(n)) throw Object.assign(new Error('bad request'), { status: 400 });
    return new Blob([zpl], { type: 'image/png' });
  });
  renderer = new LabelRenderer(new RenderQueue({ fetch: fetchMock, concurrency: 2, backoffBaseMs: 5 }), new RenderCache({ makeUrl: () => `blob:${Math.random()}`, revokeUrl: () => undefined }));
  setLabelRenderer(renderer);
  useSimulationStore.getState().reset();
  useDesignerStore.setState({ elements: [], records: [], pages: [{ mode: 'first' }], activePage: 0, labelWidth: 800, labelHeight: 560, sampleValues: {} });
  useLabelRenderStore.getState().reset();
  usePdfExportStore.getState().dismiss();
  (downloadPdf as jest.Mock).mockClear();
});

const requested = () => fetchMock.mock.calls.map(c => Number(/\^FD(\d+)/.exec(c[0])![1]));

describe('the picture of each label', () => {
  test('asks for the selected label and its neighbours, not for every label of a long simulation', async () => {
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready' && pictures()[2]?.status === 'ready');
    expect(requested().sort()).toEqual([1, 2]);                                      // 8 labels, 2 requests
    expect(pictures()[5]).toBeUndefined();
  });

  test('each request carries the ZPL of that one label (not the consolidated one) and the configured size', async () => {
    await sim().run();
    useLabelRenderStore.getState().show(3);
    await wait(() => pictures()[3]?.status === 'ready');
    const call = fetchMock.mock.calls.find(c => c[0] === '^XA^FD3^FS^XZ')!;
    expect(call.slice(0, 3)).toEqual(['^XA^FD3^FS^XZ', 800, 560]);
    expect(fetchMock.mock.calls.every(c => c[0] !== 'ALL')).toBe(true);
  });

  test('navigating while others are still loading: the selected one is rendered first and the screen is not blocked', async () => {
    await sim().run();
    gate.hold = true;
    useLabelRenderStore.getState().show(1);                                          // 1 and 2 are running, held
    await wait(() => fetchMock.mock.calls.length === 2);
    expect(pictures()[1]?.status).toBe('loading');
    sim().select(6);                                                                 // the user jumps: nothing waits for 1 and 2
    useLabelRenderStore.getState().show(6);
    expect(pictures()[6]?.status).toBe('loading');
    expect(sim().selected).toBe(6);
    gate.hold = false;
    gate.release.splice(0).forEach(r => r());
    await wait(() => pictures()[6]?.status === 'ready');
    expect(requested().indexOf(6)).toBeLessThan(requested().indexOf(7));            // 6 before its neighbours
  });

  test('a label already rendered is not rendered again, and the same label of a new simulation comes from the cache', async () => {
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[2]?.status === 'ready');
    const before = fetchMock.mock.calls.length;
    sim().select(2); useLabelRenderStore.getState().show(2);
    sim().select(1); useLabelRenderStore.getState().show(1);
    await new Promise(r => setTimeout(r, 30));
    expect(fetchMock.mock.calls.length).toBe(before + 1);                            // only label 3, the new neighbour of 2
    // a new simulation with the same labels: the pictures come back without a request
    await sim().run();
    const count = fetchMock.mock.calls.length;
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready');
    expect(fetchMock.mock.calls.length).toBe(count);
  });

  test('a ZPL or a size that changed is rendered again: an old picture is never reused for it', async () => {
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready');
    const first = pictures()[1].url;
    designer().setLabelSize(800, 400);
    await sim().run();                                                               // the size is part of what is rendered
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready');
    expect(pictures()[1].url).not.toBe(first);
    expect(fetchMock.mock.calls.some(c => c[2] === 400)).toBe(true);
    mockSim.zplOf = i => `^XA^FD${i}^FS^FDchanged^XZ`;
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('changed'))).toBe(true);
    mockSim.zplOf = i => `^XA^FD${i}^FS^XZ`;
  });

  test('a new simulation drops the pictures of the old one and cancels what was waiting', async () => {
    await sim().run();
    gate.hold = true;
    useLabelRenderStore.getState().show(1);
    await wait(() => fetchMock.mock.calls.length === 2);
    await sim().run();                                                               // a new result
    expect(pictures()).toEqual({});
    gate.hold = false;
    gate.release.splice(0).forEach(r => r());
    await new Promise(r => setTimeout(r, 30));
    expect(pictures()).toEqual({});                                                  // what arrived late is not shown for the new result
  });

  test('a simulation that went out of date asks for nothing more, and what was loading does not stay loading', async () => {
    await sim().run();
    gate.hold = true;
    useLabelRenderStore.getState().show(1);
    await wait(() => fetchMock.mock.calls.length === 2);
    designer().addElement('rect', 1, 1, { id: 'x' });                                // the design changes
    expect(sim().stale).toBe(true);
    expect(Object.values(pictures()).some(p => p.status === 'loading')).toBe(false);
    const n = fetchMock.mock.calls.length;
    useLabelRenderStore.getState().show(4);
    expect(fetchMock.mock.calls.length).toBe(n);
    expect(pictures()[4]).toBeUndefined();
  });

  test('a failure is shown on that label only, with a way to try again; the others are fine', async () => {
    failing = new Set([2]);
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'ready' && pictures()[2]?.status === 'error');
    expect(pictures()[2].retriable).toBe(false);
    expect(pictures()[2].error).toMatch(/bad request/);
    failing = new Set();
    useLabelRenderStore.getState().retry(2);
    await wait(() => pictures()[2]?.status === 'ready');
    expect(pictures()[1].status).toBe('ready');
  });

  test('the ZPL stays available whatever happens to the picture', async () => {
    failing = new Set([1]);
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[1]?.status === 'error');
    expect(sim().result!.labels[0].zpl).toBe('^XA^FD1^FS^XZ');
  });
});

describe('the PDF export', () => {
  test('an out-of-date simulation is not exported: nothing is asked for, nothing is downloaded, and the data is kept', async () => {
    designer().setRecords([{ A: '1' }]);
    await sim().run();
    designer().setRecords([{ A: '2' }]);
    expect(sim().stale).toBe(true);
    await pdf().start();
    expect(pdf().status).toBe('invalid');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(designer().records).toEqual([{ A: '2' }]);                                // the current work is untouched
    expect(sim().result).not.toBeNull();
  });

  test('a valid simulation: every label is rendered, one page each in order, and the file is handed over', async () => {
    mockSim.labels = 5;
    await sim().run();
    await pdf().start();
    expect(pdf().status).toBe('done');
    expect(pdf().done).toBe(5);
    expect(pdf().total).toBe(5);
    expect(requested().sort()).toEqual([1, 2, 3, 4, 5]);
    const [bytes, name] = (downloadPdf as jest.Mock).mock.calls[0];
    expect(name).toBe('etiquetas.pdf');
    const text = Buffer.from(bytes).toString('latin1');
    expect(/\/Type \/Pages \/Count (\d+)/.exec(text)![1]).toBe('5');
    expect([...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].every(m => m[1] === '283.46' && m[2] === '198.43')).toBe(true);   // 100 x 70 mm
  });

  test('labels already seen in the preview come from the cache: the export does not render them again', async () => {
    mockSim.labels = 4;
    await sim().run();
    useLabelRenderStore.getState().show(1);
    await wait(() => pictures()[2]?.status === 'ready');
    const before = fetchMock.mock.calls.length;
    await pdf().start();
    expect(fetchMock.mock.calls.length - before).toBe(2);                            // only labels 3 and 4
  });

  test('a label that fails is named, nothing is downloaded, and trying again finishes the job', async () => {
    mockSim.labels = 4;
    failing = new Set([2, 3]);
    await sim().run();
    await pdf().start();
    expect(pdf().status).toBe('failed');
    expect(pdf().failed.map(f => f.index)).toEqual([2, 3]);
    expect(downloadPdf).not.toHaveBeenCalled();
    failing = new Set();
    await pdf().retry();
    expect(pdf().status).toBe('done');
    expect(Buffer.from((downloadPdf as jest.Mock).mock.calls[0][0]).toString('latin1')).toContain('/Count 4');
  });

  test('the user may export without the failed labels, knowing: then the PDF has only the others', async () => {
    mockSim.labels = 4;
    failing = new Set([2]);
    await sim().run();
    await pdf().start();
    expect(pdf().status).toBe('failed');
    pdf().exportWithout();
    expect(pdf().status).toBe('done');
    expect(Buffer.from((downloadPdf as jest.Mock).mock.calls[0][0]).toString('latin1')).toContain('/Count 3');
  });

  test('progress is reported while it runs', async () => {
    mockSim.labels = 6;
    await sim().run();
    const seen: number[] = [];
    const unsubscribe = usePdfExportStore.subscribe(s => { if (s.status === 'running') seen.push(s.done); });
    await pdf().start();
    unsubscribe();
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(5);
    expect(pdf().done).toBe(6);
  });

  test('a design that goes out of date while exporting stops the export and downloads nothing', async () => {
    mockSim.labels = 6;
    await sim().run();
    gate.hold = true;
    const running = pdf().start();
    await wait(() => fetchMock.mock.calls.length >= 2);
    designer().addElement('rect', 1, 1, { id: 'late' });
    gate.hold = false;
    gate.release.splice(0).forEach(r => r());
    await running;
    expect(pdf().status).toBe('invalid');
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  test('cancelling stops it without a file', async () => {
    mockSim.labels = 6;
    await sim().run();
    gate.hold = true;
    const running = pdf().start();
    await wait(() => fetchMock.mock.calls.length >= 1);
    pdf().cancel();
    await running;
    expect(pdf().status).toBe('idle');
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  test('a new simulation drops the old export: its labels are not the new ones', async () => {
    mockSim.labels = 3;
    failing = new Set([2]);
    await sim().run();
    await pdf().start();
    expect(pdf().status).toBe('failed');
    await sim().run();
    expect(pdf().status).toBe('idle');
    expect(pdf().failed).toEqual([]);
  });

  test('exporting everything (all labels, also those with few records) is what start() does, not a partial export', async () => {
    mockSim.labels = 3;
    await sim().run();
    await pdf().start();
    expect(sim().result!.labels).toHaveLength(3);
    expect(Buffer.from((downloadPdf as jest.Mock).mock.calls[0][0]).toString('latin1')).toContain('/Count 3');
  });
});
