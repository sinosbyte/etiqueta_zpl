import { create } from 'zustand';
import { ExpandResult } from '../types';
import { LabelRenderer, activeRenderer, setActiveRenderer } from '../utils/labelRenderer';
import { RenderError } from '../utils/renderQueue';
import { useSimulationStore } from './useSimulationStore';

// The rendered picture of each label of the simulation on screen, asked for as the user looks at them: the
// selected label first, its neighbours after it, the rest only when selected (a long simulation would otherwise spend
// the service's limit on pictures nobody looks at). It belongs to one simulation result: a new result drops every
// picture and cancels what was waiting, and a result that went out of date stops asking for more.

export interface LabelPicture {
  status: 'loading' | 'ready' | 'error';
  url?: string;               // object URL of the PNG (owned by the cache, not revoked here)
  error?: string;
  retriable?: boolean;
}

interface LabelRenderStore {
  pictures: Record<number, LabelPicture>;
  show(index: number): void;      // the selected label and, behind it, its neighbours
  retry(index: number): void;
  reset(): void;
}

const SELECTED = 10;
const NEIGHBOUR = 0;

let owner: ExpandResult | null = null;
let group = '';
let groups = 0;

/** For the tests: the renderer in use. */
export function setLabelRenderer(r: LabelRenderer): void { setActiveRenderer(r); }

function request(index: number, priority: number): void {
  const sim = useSimulationStore.getState();
  const { result, size } = sim;
  if (!result || !size || sim.stale) return;
  const label = result.labels.find(l => l.index === index);
  if (!label) return;
  const mine = result;
  const current = useLabelRenderStore.getState().pictures[index];
  if (current?.status === 'ready') return;
  if (current?.status === 'loading') { activeRenderer().prioritize(label.zpl, size.width, size.height, priority); return; }

  const hit = activeRenderer().peek(label.zpl, size.width, size.height);
  if (hit) { put(index, { status: 'ready', url: hit.url }); return; }

  put(index, { status: 'loading' });
  activeRenderer().render({ zpl: label.zpl, width: size.width, height: size.height, priority, group }).then(
    entry => { if (owner === mine) put(index, { status: 'ready', url: entry.url }); },
    (e: unknown) => {
      if (owner !== mine) return;
      const cancelled = e instanceof RenderError && e.cancelled;
      if (cancelled) { drop(index); return; }
      put(index, { status: 'error', error: e instanceof Error ? e.message : String(e), retriable: !(e instanceof RenderError) || e.retriable });
    },
  );
}

const put = (index: number, picture: LabelPicture) =>
  useLabelRenderStore.setState(s => ({ pictures: { ...s.pictures, [index]: picture } }));
const drop = (index: number) =>
  useLabelRenderStore.setState(s => { const { [index]: _gone, ...rest } = s.pictures; return { pictures: rest }; });

export const useLabelRenderStore = create<LabelRenderStore>(() => ({
  pictures: {},

  show(index) {
    request(index, SELECTED);
    request(index + 1, NEIGHBOUR);
    request(index - 1, NEIGHBOUR);
  },

  retry(index) {
    const current = useLabelRenderStore.getState().pictures[index];
    if (current?.status !== 'error') return;
    drop(index);
    request(index, SELECTED);
  },

  reset() {
    activeRenderer().cancel(group);
    owner = null;
    useLabelRenderStore.setState({ pictures: {} });
  },
}));

// A new result: the pictures of the old one mean nothing now. A result gone out of date: stop asking for more.
useSimulationStore.subscribe((s, prev) => {
  if (s.result !== prev.result) {
    activeRenderer().cancel(group);
    owner = s.result;
    group = `sim-${++groups}`;
    useLabelRenderStore.setState({ pictures: {} });
  } else if (s.stale && !prev.stale) {
    activeRenderer().cancel(group);
    // What was still loading will not arrive: it is not shown as loading for ever
    useLabelRenderStore.setState(st => ({
      pictures: Object.fromEntries(Object.entries(st.pictures).filter(([, p]) => p.status !== 'loading')),
    }));
  }
});
