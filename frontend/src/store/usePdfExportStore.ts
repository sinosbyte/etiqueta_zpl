import { create } from 'zustand';
import { ExpandResult } from '../types';
import { activeRenderer } from '../utils/labelRenderer';
import { LabelFailure, PdfExport, downloadPdf, encodePng } from '../utils/pdfExport';
import { useSimulationStore } from './useSimulationStore';

// The PDF export of the simulation on screen. It works only from a valid simulation: out of date, it does not
// start, and a simulation that goes out of date (or is replaced) during the export stops it.

export type ExportStatus = 'idle' | 'running' | 'failed' | 'done' | 'invalid' | 'error';

interface PdfExportStore {
  status: ExportStatus;
  done: number;
  total: number;
  failed: LabelFailure[];     // labels that could not be rendered (kept for the user to retry or to leave out)
  error: string;
  start(): Promise<void>;
  retry(): Promise<void>;
  exportWithout(): void;      // the user's explicit choice: a PDF without the labels that failed
  cancel(): void;
  dismiss(): void;
}

let session: PdfExport | null = null;
let controller: AbortController | null = null;
let forResult: ExpandResult | null = null;

export const FILENAME = 'etiquetas.pdf';

const validNow = () => {
  const s = useSimulationStore.getState();
  return !!s.result && !s.stale && s.result === forResult;
};

async function work(): Promise<void> {
  if (!session) return;
  controller = new AbortController();
  usePdfExportStore.setState({ status: 'running', error: '', failed: [] });
  const mine = session;
  try {
    const outcome = await mine.run((done, total) => usePdfExportStore.setState({ done, total }), controller.signal);
    if (mine !== session) return;
    // Stopped because the simulation went out of date (not because the user cancelled): that is what is told
    if (outcome.invalid || (outcome.cancelled && !validNow())) { usePdfExportStore.setState({ status: 'invalid' }); return; }
    if (outcome.cancelled) { usePdfExportStore.setState({ status: 'idle' }); return; }
    if (!outcome.complete) { usePdfExportStore.setState({ status: 'failed', failed: outcome.failed }); return; }
    downloadPdf(mine.build(), FILENAME);
    usePdfExportStore.setState({ status: 'done' });
  } catch (e) {
    if (mine === session) usePdfExportStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    controller = null;
  }
}

export const usePdfExportStore = create<PdfExportStore>(() => ({
  status: 'idle',
  done: 0,
  total: 0,
  failed: [],
  error: '',

  async start() {
    const sim = useSimulationStore.getState();
    if (usePdfExportStore.getState().status === 'running') return;
    if (!sim.result || !sim.size || sim.stale) { usePdfExportStore.setState({ status: 'invalid', failed: [] }); return; }
    forResult = sim.result;
    session = new PdfExport(
      sim.result.labels.map(l => ({ index: l.index, zpl: l.zpl })),
      sim.size.width, sim.size.height,
      { render: r => activeRenderer().render(r), cancel: g => activeRenderer().cancel(g), encode: encodePng, isValid: validNow },
    );
    usePdfExportStore.setState({ done: 0, total: session.total });
    await work();
  },

  async retry() {
    if (!session || usePdfExportStore.getState().status === 'running') return;
    if (!validNow()) { usePdfExportStore.setState({ status: 'invalid' }); return; }
    await work();
  },

  exportWithout() {
    if (!session) return;
    try {
      downloadPdf(session.build(true), FILENAME);
      usePdfExportStore.setState({ status: 'done' });
    } catch (e) {
      usePdfExportStore.setState({ status: validNow() ? 'error' : 'invalid', error: e instanceof Error ? e.message : String(e) });
    }
  },

  cancel() {
    controller?.abort();
  },

  dismiss() {
    if (usePdfExportStore.getState().status === 'running') return;
    session = null;
    usePdfExportStore.setState({ status: 'idle', done: 0, total: 0, failed: [], error: '' });
  },
}));

// The simulation replaced or out of date: what is running stops, and what was kept is not used
useSimulationStore.subscribe((s, prev) => {
  if (s.result !== prev.result) {
    // A new simulation: this export belongs to the old one
    controller?.abort();
    session = null;
    usePdfExportStore.setState({ status: 'idle', done: 0, total: 0, failed: [], error: '' });
  } else if (s.stale && !prev.stale) {
    controller?.abort();
    const { status } = usePdfExportStore.getState();
    if (status === 'running' || status === 'failed') usePdfExportStore.setState({ status: 'invalid' });
  }
});
