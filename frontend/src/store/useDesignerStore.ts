import { create } from 'zustand';
import { t } from '../i18n';
import { ZOOM_100 } from '../utils/units';
import { temporal } from 'zundo';
import { DataRecord, DesignElement, ElementType, PageConfig } from '../types';
import { isStructured, isValidPages, MAX_PAGES, pageOf, singlePage } from '../utils/pages';
import { generateZpl, parseZpl } from '../utils/zplClient';
import { elementBox } from '../utils/zplText';
import { newTableFields, tableOnPage } from '../utils/tableEdit';
import { Box, Guide, SNAP_DISTANCE_PX, SnapOptions, snappingSuspended } from '../utils/snap';
import { cloneElement, planTransfer, TransferMode, TransferPlan } from '../utils/pageTransfer';

let idCounter = 0;
const nextId = () => `el-${Date.now()}-${++idCounter}`;

const DEFAULT_SIZES: Record<ElementType, { width: number; height: number }> = {
  text: { width: 200, height: 40 },
  // '123456789' in subset B, ^BY2: (11 * 9 + 35) modules x 2 dots
  barcode128: { width: 268, height: 100 },
  // 14 digits, ^BY2,3: (14 * 9 + 9) modules x 2 dots
  barcodeI2of5: { width: 270, height: 100 },
  qrcode: { width: 100, height: 100 },
  // '1234567890' is a 12 x 12 symbol, 4 dots per module
  datamatrix: { width: 48, height: 48 },
  rect: { width: 200, height: 100 },
  line: { width: 200, height: 8 },
  image: { width: 0, height: 0 },  // set from the picture
  comment: { width: 0, height: 0 },
  raw: { width: 0, height: 0 },
  table: { width: 0, height: 0 },  // always drawn from its columns (see tableBox), never from these
};

const DEFAULT_VALUES: Partial<Record<ElementType, Partial<DesignElement>>> = {
  text: { value: 'New Text', fontSize: 34, fontName: '0' },
  barcode128: { value: '123456789', moduleWidth: 2 },
  barcodeI2of5: { value: '17896380197511', moduleWidth: 2, ratio: 3 },
  qrcode: { value: 'https://example.com' },
  datamatrix: { value: '1234567890', dmModuleSize: 4 },
};

interface DesignerStore {
  labelWidth: number;
  labelHeight: number;
  elements: DesignElement[];
  selectedId: string | null;
  selectedIds: string[];
  activeTab: 'design' | 'code' | 'split';
  zplCode: string;
  zplError: string;
  zoom: number;
  snapToGrid: boolean;
  snapToElements: boolean;               // magnetic: edges and centres snap to other elements and the label
  gridSize: number;                      // grid step in dots
  guides: Guide[];                       // alignment lines shown while dragging or resizing
  sampleValues: Record<string, string>;  // example value per {{variable}}, for Preview/Export and the canvas
  showSamples: boolean;                  // canvas shows sample values instead of {{variable}}
  pages: PageConfig[];                   // the pages of the design: one, or two (first, then repeat)
  activePage: number;                    // the page being edited: index into pages
  records: DataRecord[];                 // test records the tables show (the simulation); saved with the design
  setLabelSize(width: number, height: number): void;
  addElement(type: ElementType, x?: number, y?: number, fields?: Partial<DesignElement>): string;
  addTable(x?: number, y?: number): string | null;
  updateElement(id: string, patch: Partial<DesignElement>): void;
  deleteElement(id: string): void;
  deleteSelected(): void;
  clearAll(): void;
  duplicateSelected(): void;
  moveSelectedToPage(target: number): TransferPlan | null;
  copySelectedToPage(target: number): TransferPlan | null;
  bringForward(): void;
  sendBackward(): void;
  bringToFront(): void;
  sendToBack(): void;
  selectElement(id: string | null): void;
  toggleSelectElement(id: string): void;
  clearSelection(): void;
  alignElements(alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'): void;
  distributeElements(axis: 'x' | 'y'): void;
  setActiveTab(tab: 'design' | 'code' | 'split'): void;
  setZoom(zoom: number): void;
  toggleSnapToGrid(): void;
  toggleSnapToElements(): void;
  setGridSize(dots: number): void;
  setGuides(guides: Guide[]): void;
  moveSelected(dx: number, dy: number): void;
  setSampleValues(values: Record<string, string>): void;
  setShowSamples(show: boolean): void;
  addPage(): boolean;
  removePage(): boolean;
  setActivePage(index: number): boolean;
  updatePage(index: number, patch: Partial<PageConfig>): boolean;
  setRecords(records: DataRecord[]): void;
  onCodeChange(code: string): void;
  syncToCode(): Promise<void>;
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let parseTimeout: ReturnType<typeof setTimeout> | null = null;
let syncAbort: AbortController | null = null;
let parseAbort: AbortController | null = null;

let lastCanvasZpl = '';

// Snapping settings are remembered in this browser (storage may be unavailable)
type SnapSettings = Partial<Pick<DesignerStore, 'snapToGrid' | 'snapToElements' | 'gridSize'>>;
const SNAP_KEY = 'zpl-designer-snap';
const savedSnap: SnapSettings = (() => {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) ?? '{}') as SnapSettings; } catch { return {}; }
})();
function saveSnap({ snapToGrid, snapToElements, gridSize }: SnapSettings) {
  try { localStorage.setItem(SNAP_KEY, JSON.stringify({ snapToGrid, snapToElements, gridSize })); } catch { /* not saved */ }
}

/**
 * What snapping needs for the elements being moved or resized: the canvas
 * boxes of every other drawn element and the options in dots at this zoom.
 * Null while snapping is off or suspended (Alt held).
 */
export function snapContext(
  movingIds: string[],
): { others: Box[]; label: { width: number; height: number }; opts: SnapOptions } | null {
  const {
    elements, showSamples, sampleValues, snapToGrid, snapToElements, gridSize, zoom, labelWidth, labelHeight,
  } = useDesignerStore.getState();
  if ((!snapToGrid && !snapToElements) || snappingSuspended()) return null;
  const samples = showSamples ? sampleValues : null;
  const moving = new Set(movingIds);
  // Only what is on the page being moved on: another page is another label
  const movingFirst = elements.find(e => moving.has(e.id));
  const page = movingFirst ? pageOf(movingFirst) : useDesignerStore.getState().activePage;
  const others = elements
    .filter(e => !moving.has(e.id) && pageOf(e) === page && e.type !== 'raw' && e.type !== 'comment')
    .map(e => ({ x: e.x, y: e.y, ...elementBox(e, samples) }));
  return {
    others,
    label: { width: labelWidth, height: labelHeight },
    opts: { grid: snapToGrid ? gridSize : null, magnet: snapToElements, threshold: SNAP_DISTANCE_PX / zoom },
  };
}

// ── History ─────────────────────────────────────────────────────────────────────────────────────────────
// What is tracked for undo/redo, and when two states are the same one
const HISTORY_LIMIT = 100;
const HISTORY_DELAY_MS = 300;

const tracked = (state: DesignerStore) => ({
  elements: state.elements,
  labelWidth: state.labelWidth,
  labelHeight: state.labelHeight,
  pages: state.pages,
  activePage: state.activePage,
  records: state.records,
});
type Tracked = ReturnType<typeof tracked>;

// A change that leaves what is tracked as it was is not a step of the history: the ZPL arriving after
// an edit (it is not tracked, but it is a change of the store) and switching the page being edited used
// to leave an empty step, so the first undo after any edit did nothing
const sameTracked = (a: Tracked, b: Tracked): boolean =>
  a.elements === b.elements && a.labelWidth === b.labelWidth && a.labelHeight === b.labelHeight
  && a.pages === b.pages && a.records === b.records;

// The history waits HISTORY_DELAY_MS after a change before it keeps the step, so a drag or typing is one
// step; two changes inside that time are one step (the first one cannot be undone on its own).
let historyTimer: ReturnType<typeof setTimeout> | null = null;
let historyPending: (() => void) | null = null;

function runPendingStep() {
  const run = historyPending;
  historyTimer = null;
  historyPending = null;
  run?.();
}

/** Keeps now the step that is waiting out the delay, if there is one, so what comes next cannot be joined to it. */
function flushHistory() {
  if (historyTimer) clearTimeout(historyTimer);
  runPendingStep();
}

/**
 * Makes `apply` (one change of the store) a step of the history of its own, at once: the step that was
 * waiting is kept first, the change is not left to the delay, and what it changed is one step however soon
 * the next change comes. Only the operations that ask for it use this (moving and copying between pages);
 * every other change goes through the delay as before.
 */
function applyAsOwnStep(apply: () => void) {
  flushHistory();
  const history = useDesignerStore.temporal;
  const before = tracked(useDesignerStore.getState());
  const wasTracking = history.getState().isTracking;
  history.getState().pause();   // so the delayed path does not keep this change a second time
  try { apply(); } finally { if (wasTracking) history.getState().resume(); }
  if (!wasTracking) return;
  if (sameTracked(before, tracked(useDesignerStore.getState()))) return;
  history.setState(h => ({
    pastStates: [...(h.pastStates.length >= HISTORY_LIMIT ? h.pastStates.slice(1) : h.pastStates), before],
    futureStates: [],
  }));
}

/** Moves or copies the selection to the page `target` as one step; null when there is nothing to do it with. */
function transferSelected(mode: TransferMode, target: number): TransferPlan | null {
  const { selectedId, selectedIds, elements, pages } = useDesignerStore.getState();
  if (!Number.isInteger(target) || target < 0 || target >= pages.length) return null;
  const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
  if (ids.length === 0) return null;
  const plan = planTransfer(elements, ids, target, mode, nextId);
  if (plan.done.length === 0) return plan;
  const doneIds = plan.done.map(el => el.id);
  applyAsOwnStep(() => useDesignerStore.setState({
    elements: plan.elements, activePage: target, selectedId: doneIds[doneIds.length - 1], selectedIds: doneIds,
  }));
  useDesignerStore.getState().syncToCode();
  return plan;
}

export const useDesignerStore = create<DesignerStore>()(
  temporal(
    (set, get) => ({
  labelWidth: 800,
  labelHeight: 1200,
  elements: [],
  selectedId: null,
  selectedIds: [],
  activeTab: 'design',
  zplCode: '^XA\n^PW800\n^LL1200\n^XZ',
  zplError: '',
  zoom: ZOOM_100,
  snapToGrid: savedSnap.snapToGrid ?? false,
  snapToElements: savedSnap.snapToElements ?? true,
  gridSize: savedSnap.gridSize ?? 8,
  guides: [],
  sampleValues: {},
  showSamples: false,
  pages: singlePage(),
  activePage: 0,
  records: [],

  setLabelSize(width, height) {
    set({ labelWidth: width, labelHeight: height });
    get().syncToCode();
  },

  addElement(type, x = 50, y = 50, fields) {
    // A design of one page keeps its elements as they always were (no page field)
    const { pages, activePage } = get();
    const el: DesignElement = {
      id: nextId(),
      type,
      x,
      y,
      ...DEFAULT_SIZES[type],
      ...DEFAULT_VALUES[type],
      ...(pages.length > 1 && { page: activePage }),
      ...fields,
    };
    set(s => ({ elements: [...s.elements, el], selectedId: el.id, selectedIds: [el.id] }));
    get().syncToCode();
    return el.id;
  },

  addTable(x = 50, y = 50) {
    // A page holds one table (the generator and the distribution of the records work with one per page)
    const { elements, activePage, labelWidth } = get();
    if (tableOnPage(elements, activePage)) return null;
    return get().addElement('table', x, y, newTableFields(labelWidth, x));
  },

  updateElement(id, patch) {
    set(s => ({ elements: s.elements.map(e => e.id === id ? { ...e, ...patch } : e) }));
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => get().syncToCode(), 200);
  },

  deleteElement(id) {
    set(s => ({
      elements: s.elements.filter(e => e.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      selectedIds: s.selectedIds.filter(sid => sid !== id),
    }));
    get().syncToCode();
  },

  deleteSelected() {
    const { selectedIds, selectedId } = get();
    const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);
    if (ids.size === 0) return;
    set(s => ({
      elements: s.elements.filter(e => !ids.has(e.id)),
      selectedId: null,
      selectedIds: [],
    }));
    get().syncToCode();
  },

  clearAll() {
    // With two pages only the one being edited is cleared
    set(s => ({
      elements: s.pages.length > 1 ? s.elements.filter(e => pageOf(e) !== s.activePage) : [],
      selectedId: null,
      selectedIds: [],
    }));
    get().syncToCode();
  },

  duplicateSelected() {
    const { selectedId, selectedIds, elements } = get();
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const offset = 16;
    const newEls = elements
      // A page holds one table: a table is not duplicated (it would be a second one on the same page)
      .filter(e => ids.includes(e.id) && e.type !== 'table')
      .map(e => ({ ...cloneElement(e), id: nextId(), x: e.x + offset, y: e.y + offset }));
    if (newEls.length === 0) return;
    const newSelectedId = newEls[newEls.length - 1].id;
    const newSelectedIds = newEls.map(e => e.id);
    set(s => ({
      elements: [...s.elements, ...newEls],
      selectedId: newSelectedId,
      selectedIds: newSelectedIds,
    }));
    get().syncToCode();
  },

  // Moves the selected elements to another page (same ids, same properties, on top of that page)
  moveSelectedToPage(target) {
    return transferSelected('move', target);
  },

  // Copies the selected elements to another page (new ids, deep copies; the originals stay)
  copySelectedToPage(target) {
    return transferSelected('copy', target);
  },

  bringForward() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx === -1 || idx === elements.length - 1) return;
    // The next element on the same page: elements of the other page between them stay where they are
    const other = elements.findIndex((e, i) => i > idx && pageOf(e) === pageOf(elements[idx]));
    if (other === -1) return;
    const next = [...elements];
    [next[idx], next[other]] = [next[other], next[idx]];
    set({ elements: next });
    get().syncToCode();
  },

  sendBackward() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx <= 0) return;
    let other = -1;
    for (let i = idx - 1; i >= 0; i--) if (pageOf(elements[i]) === pageOf(elements[idx])) { other = i; break; }
    if (other === -1) return;
    const next = [...elements];
    [next[idx], next[other]] = [next[other], next[idx]];
    set({ elements: next });
    get().syncToCode();
  },

  bringToFront() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx === -1 || idx === elements.length - 1) return;
    const next = [...elements.filter(e => e.id !== selectedId), elements[idx]];
    set({ elements: next });
    get().syncToCode();
  },

  sendToBack() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx <= 0) return;
    const next = [elements[idx], ...elements.filter(e => e.id !== selectedId)];
    set({ elements: next });
    get().syncToCode();
  },

  clearSelection() {
    set({ selectedId: null, selectedIds: [] });
  },

  selectElement(id) {
    set({ selectedId: id, selectedIds: id ? [id] : [] });
  },

  toggleSelectElement(id) {
    set(s => {
      const already = s.selectedIds.includes(id);
      const selectedIds = already
        ? s.selectedIds.filter(sid => sid !== id)
        : [...s.selectedIds, id];
      const selectedId = already
        ? (selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null)
        : id;
      return { selectedIds, selectedId };
    });
  },

  alignElements(alignment) {
    const { elements, selectedIds } = get();
    const selected = elements.filter(e => selectedIds.includes(e.id));
    if (selected.length < 2) return;

    // Canvas box of each element (text is sized like the printed text)
    const samples = get().showSamples ? get().sampleValues : null;
    const box = new Map(selected.map(e => [e.id, elementBox(e, samples)]));
    const w = (e: DesignElement) => box.get(e.id)!.width;
    const h = (e: DesignElement) => box.get(e.id)!.height;

    const minX = Math.min(...selected.map(e => e.x));
    const maxX = Math.max(...selected.map(e => e.x + w(e)));
    const minY = Math.min(...selected.map(e => e.y));
    const maxY = Math.max(...selected.map(e => e.y + h(e)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const patches = new Map<string, Partial<DesignElement>>(
      selected.map(el => {
        switch (alignment) {
          case 'left':     return [el.id, { x: minX }];
          case 'center-h': return [el.id, { x: Math.round(centerX - w(el) / 2) }];
          case 'right':    return [el.id, { x: Math.round(maxX - w(el)) }];
          case 'top':      return [el.id, { y: minY }];
          case 'center-v': return [el.id, { y: Math.round(centerY - h(el) / 2) }];
          case 'bottom':   return [el.id, { y: Math.round(maxY - h(el)) }];
          default:         return [el.id, {}];
        }
      })
    );

    set(s => ({ elements: s.elements.map(e => patches.has(e.id) ? { ...e, ...patches.get(e.id)! } : e) }));
    if (syncTimeout) clearTimeout(syncTimeout);
    get().syncToCode();
  },

  distributeElements(axis) {
    const { elements, selectedIds } = get();
    const selected = elements.filter(e => selectedIds.includes(e.id));
    if (selected.length < 3) return;

    // The first and last elements stay; the ones between get equal gaps
    const samples = get().showSamples ? get().sampleValues : null;
    const items = selected
      .map(e => {
        const box = elementBox(e, samples);
        return { id: e.id, start: axis === 'x' ? e.x : e.y, size: axis === 'x' ? box.width : box.height };
      })
      .sort((a, b) => a.start - b.start);
    const first = items[0];
    const last = items[items.length - 1];
    const used = items.reduce((sum, i) => sum + i.size, 0);
    const gap = (last.start + last.size - first.start - used) / (items.length - 1);

    const patches = new Map<string, Partial<DesignElement>>();
    let at = first.start;
    for (const item of items) {
      patches.set(item.id, { [axis]: Math.round(at) });
      at += item.size + gap;
    }

    set(s => ({ elements: s.elements.map(e => patches.has(e.id) ? { ...e, ...patches.get(e.id)! } : e) }));
    if (syncTimeout) clearTimeout(syncTimeout);
    get().syncToCode();
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setZoom(zoom) {
    set({ zoom: Math.min(6, Math.max(ZOOM_100 * 0.1, zoom)) });
  },

  toggleSnapToGrid() {
    set(s => ({ snapToGrid: !s.snapToGrid }));
    saveSnap(get());
  },

  toggleSnapToElements() {
    set(s => ({ snapToElements: !s.snapToElements }));
    saveSnap(get());
  },

  setGridSize(dots) {
    set({ gridSize: dots });
    saveSnap(get());
  },

  setGuides(guides) {
    // Avoid re-rendering the canvas when there were and are no guides
    if (guides.length === 0 && get().guides.length === 0) return;
    set({ guides });
  },

  moveSelected(dx, dy) {
    const { selectedIds, selectedId } = get();
    const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);
    if (ids.size === 0) return;
    set(s => ({
      elements: s.elements.map(e => ids.has(e.id) ? { ...e, x: Math.max(0, e.x + dx), y: Math.max(0, e.y + dy) } : e),
    }));
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => get().syncToCode(), 200);
  },

  setSampleValues(values) {
    set(s => ({ sampleValues: { ...s.sampleValues, ...values } }));
  },

  setShowSamples(show) {
    set({ showSamples: show });
  },

  // A second page (first, then repeat): at most two. It becomes the page being edited. One set, so
  // undo takes the page and the view back together.
  addPage() {
    const { pages } = get();
    if (pages.length >= MAX_PAGES) return false;
    set({ pages: [...pages, { mode: 'repeat' }], activePage: pages.length, selectedId: null, selectedIds: [] });
    get().syncToCode();
    return true;
  },

  // Back to one page: the elements of the second page go with it
  removePage() {
    const { pages } = get();
    if (pages.length <= 1) return false;
    set(s => ({
      pages: pages.slice(0, 1),
      activePage: 0,
      elements: s.elements.filter(e => pageOf(e) === 0),
      selectedId: null,
      selectedIds: [],
    }));
    get().syncToCode();
    return true;
  },

  // Switching pages only changes which one is being edited: no element is touched
  setActivePage(index) {
    const { pages, activePage } = get();
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return false;
    if (index !== activePage) set({ activePage: index, selectedId: null, selectedIds: [] });
    return true;
  },

  // A property of a page. Today the only one is its mode, which the rules fix by position (the first
  // page is 'first', the second 'repeat'), so a change that breaks them is refused.
  updatePage(index, patch) {
    const { pages } = get();
    if (index < 0 || index >= pages.length) return false;
    const next = pages.map((p, i) => (i === index ? { ...p, ...patch } : p));
    if (!isValidPages(next)) return false;
    if (next.every((p, i) => p.mode === pages[i].mode)) return true;  // nothing changes
    set({ pages: next });
    get().syncToCode();
    return true;
  },

  setRecords(records) {
    set({ records });
  },

  onCodeChange(code: string) {
    // A design of two pages or with a table is not read back from its code: the parser would flatten
    // the pages and break the table into lines and text. The code tab shows it read-only.
    if (isStructured(get().pages, get().elements)) return;
    set({ zplCode: code });

    if (code === lastCanvasZpl) return;

    if (parseTimeout) clearTimeout(parseTimeout);
    parseTimeout = setTimeout(async () => {
      // Cancel any previous in-flight parse request
      if (parseAbort) parseAbort.abort();
      parseAbort = new AbortController();
      const signal = parseAbort.signal;

      try {
        const result = await parseZpl(code, signal);
        if (signal.aborted) return;
        if (result.labelWidth > 0 || result.labelHeight > 0 || result.elements.length > 0) {
          lastCanvasZpl = code;
          set({
            elements: result.elements,
            labelWidth: result.labelWidth || get().labelWidth,
            labelHeight: result.labelHeight || get().labelHeight,
            selectedId: null,
            selectedIds: [],
            zplError: '',
          });
        } else {
          set({ zplError: '' });
        }
      } catch (e) {
        if (signal.aborted) return;
        set({ zplError: e instanceof Error ? e.message : t('zpl.invalid') });
      }
    }, 600);
  },

  async syncToCode() {
    const { labelWidth, labelHeight, elements, pages } = get();

    // Cancel any previous in-flight sync request
    if (syncAbort) syncAbort.abort();
    syncAbort = new AbortController();
    const signal = syncAbort.signal;

    try {
      const zpl = await generateZpl({ labelWidth, labelHeight, elements, ...(pages.length > 1 && { pages }) }, signal);
      if (signal.aborted) return;
      lastCanvasZpl = zpl;
      set({ zplCode: zpl, zplError: '' });
    } catch (e) {
      if (signal.aborted) return;
      set({ zplError: t('zpl.syncFailed', { message: e instanceof Error ? e.message : t('zpl.unknownError') }) });
    }
  },

    }),
    {
      limit: HISTORY_LIMIT,
      partialize: tracked,
      equality: sameTracked,
      handleSet: (handleSet) => (...args: Parameters<typeof handleSet>) => {
        if (historyTimer) clearTimeout(historyTimer);
        historyPending = () => handleSet(...args);
        historyTimer = setTimeout(runPendingStep, HISTORY_DELAY_MS);
      },
    },
  ),
);
