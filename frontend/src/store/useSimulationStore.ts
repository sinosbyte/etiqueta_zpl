import { create } from 'zustand';
import { DataRecord, ExpandResult } from '../types';
import { expandZpl } from '../utils/zplClient';
import { EditorState, SimulationView, expandPayload, viewOf } from '../utils/simulation';
import { editorSignature } from '../utils/unsaved';
import { savableRecords } from '../utils/pages';
import { useDesignerStore } from './useDesignerStore';

// The result of the last simulation. It is not part of the design: it is not saved, not in the undo history and
// not a change to save. It is only valid for the exact state of the editor it was worked out from: when the
// elements, the pages, the test records, the example values or the label size change, it is marked out of date
// and the canvas goes back to the editing preview.

interface SimulationStore {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  result: ExpandResult | null;
  sent: DataRecord[];          // the records the request carried (the ones the labels refer to)
  signature: string;           // the editor state the result is for
  size: { width: number; height: number } | null;   // label size (dots) the result was worked out for; what the pictures are rendered at
  stale: boolean;              // the editor changed after the result was worked out
  selected: number;            // 1-based label being looked at; 0 = none
  viewing: boolean;            // the canvas shows the selected label
  view: SimulationView | null; // what the canvas draws: set only while the result is valid and being viewed
  run(): Promise<void>;
  select(index: number): void;
  setViewing(on: boolean): void;
  reset(): void;
}

const editorState = (): EditorState => {
  const s = useDesignerStore.getState();
  return { elements: s.elements, labelWidth: s.labelWidth, labelHeight: s.labelHeight, sampleValues: s.sampleValues, pages: s.pages, records: s.records };
};

let runId = 0;

const derive = (s: Pick<SimulationStore, 'result' | 'sent' | 'stale' | 'viewing' | 'selected'>): SimulationView | null =>
  s.result && !s.stale && s.viewing && s.selected > 0 ? viewOf(s.result, s.sent, s.selected) : null;

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  status: 'idle',
  error: '',
  result: null,
  sent: [],
  signature: '',
  size: null,
  stale: false,
  selected: 0,
  viewing: false,
  view: null,

  async run() {
    const state = editorState();
    const signature = editorSignature(state);
    const id = ++runId;
    set({ status: 'loading', error: '' });
    try {
      const result = await expandZpl(expandPayload(state));
      if (id !== runId) return;   // a newer run replaced this one
      // The editor may have changed while the request was out: then the answer is already out of date
      const stale = editorSignature(editorState()) !== signature;
      const sent = savableRecords(state.records);
      const next = { status: 'ready' as const, error: '', result, sent, signature, size: { width: state.labelWidth, height: state.labelHeight }, stale, selected: result.labels.length > 0 ? 1 : 0, viewing: true };
      set({ ...next, view: derive(next) });
    } catch (e) {
      if (id !== runId) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), result: null, sent: [], size: null, selected: 0, viewing: false, view: null });
    }
  },

  select(index) {
    const { result } = get();
    if (!result || index < 1 || index > result.labels.length) return;
    const next = { ...get(), selected: index, viewing: true };
    set({ selected: index, viewing: true, view: derive(next) });
  },

  setViewing(on) {
    const next = { ...get(), viewing: on };
    set({ viewing: on, view: derive(next) });
  },

  reset() {
    runId++;
    set({ status: 'idle', error: '', result: null, sent: [], signature: '', size: null, stale: false, selected: 0, viewing: false, view: null });
  },
}));

// What the result was worked out from: if any of it changes the result stops being valid
useDesignerStore.subscribe((s, prev) => {
  const sim = useSimulationStore.getState();
  if (!sim.result || sim.stale) return;
  if (
    s.elements === prev.elements && s.pages === prev.pages && s.records === prev.records
    && s.sampleValues === prev.sampleValues && s.labelWidth === prev.labelWidth && s.labelHeight === prev.labelHeight
  ) return;
  if (editorSignature(editorState()) !== sim.signature) useSimulationStore.setState({ stale: true, view: null });
});
