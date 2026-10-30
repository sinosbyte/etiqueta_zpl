import { create } from 'zustand';
import { temporal } from 'zundo';
import { DesignElement, ElementType } from '../types';
import { generateZpl, parseZpl, previewZpl } from '../utils/zplClient';
import { elementBox } from '../utils/zplText';
import { Box, Guide, SNAP_DISTANCE_PX, SnapOptions, snappingSuspended } from '../utils/snap';

let idCounter = 0;
const nextId = () => `el-${Date.now()}-${++idCounter}`;

const DEFAULT_SIZES: Record<ElementType, { width: number; height: number }> = {
  text: { width: 200, height: 40 },
  // '123456789' in subset B, ^BY2: (11 * 9 + 35) modules x 2 dots
  barcode128: { width: 268, height: 100 },
  // 14 digits, ^BY2,3: (14 * 9 + 9) modules x 2 dots
  barcodeI2of5: { width: 270, height: 100 },
  qrcode: { width: 100, height: 100 },
  rect: { width: 200, height: 100 },
  line: { width: 200, height: 8 },
  image: { width: 0, height: 0 },  // set from the picture
  comment: { width: 0, height: 0 },
  raw: { width: 0, height: 0 },
};

const DEFAULT_VALUES: Partial<Record<ElementType, Partial<DesignElement>>> = {
  text: { value: 'New Text', fontSize: 34, fontName: '0' },
  barcode128: { value: '123456789', moduleWidth: 2 },
  barcodeI2of5: { value: '17896380197511', moduleWidth: 2, ratio: 3 },
  qrcode: { value: 'https://example.com' },
};

interface DesignerStore {
  labelWidth: number;
  labelHeight: number;
  elements: DesignElement[];
  selectedId: string | null;
  selectedIds: string[];
  activeTab: 'design' | 'code';
  zplCode: string;
  zplError: string;
  previewUrl: string | null;
  previewLoading: boolean;
  previewError: string;
  zoom: number;
  snapToGrid: boolean;
  snapToElements: boolean;               // magnetic: edges and centres snap to other elements and the label
  gridSize: number;                      // grid step in dots
  guides: Guide[];                       // alignment lines shown while dragging or resizing
  sampleValues: Record<string, string>;  // example value per {{variable}}, for Preview/Export and the canvas
  showSamples: boolean;                  // canvas shows sample values instead of {{variable}}
  setLabelSize(width: number, height: number): void;
  addElement(type: ElementType, x?: number, y?: number, fields?: Partial<DesignElement>): string;
  updateElement(id: string, patch: Partial<DesignElement>): void;
  deleteElement(id: string): void;
  deleteSelected(): void;
  clearAll(): void;
  duplicateSelected(): void;
  bringForward(): void;
  sendBackward(): void;
  bringToFront(): void;
  sendToBack(): void;
  selectElement(id: string | null): void;
  toggleSelectElement(id: string): void;
  clearSelection(): void;
  alignElements(alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'): void;
  setActiveTab(tab: 'design' | 'code'): void;
  setZoom(zoom: number): void;
  toggleSnapToGrid(): void;
  toggleSnapToElements(): void;
  setGridSize(dots: number): void;
  setGuides(guides: Guide[]): void;
  moveSelected(dx: number, dy: number): void;
  setSampleValues(values: Record<string, string>): void;
  setShowSamples(show: boolean): void;
  onCodeChange(code: string): void;
  syncToCode(): Promise<void>;
  setPreviewUrl(url: string | null): void;
  fetchPreview(zplOverride?: string): Promise<void>;
  closePreview(): void;
}

let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let parseTimeout: ReturnType<typeof setTimeout> | null = null;
let syncAbort: AbortController | null = null;
let parseAbort: AbortController | null = null;

let lastCanvasZpl = '';
let lastPreviewZpl = '';

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
  const others = elements
    .filter(e => !moving.has(e.id) && e.type !== 'raw' && e.type !== 'comment')
    .map(e => ({ x: e.x, y: e.y, ...elementBox(e, samples) }));
  return {
    others,
    label: { width: labelWidth, height: labelHeight },
    opts: { grid: snapToGrid ? gridSize : null, magnet: snapToElements, threshold: SNAP_DISTANCE_PX / zoom },
  };
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
  previewUrl: null,
  previewLoading: false,
  previewError: '',
  zoom: 2,
  snapToGrid: savedSnap.snapToGrid ?? false,
  snapToElements: savedSnap.snapToElements ?? true,
  gridSize: savedSnap.gridSize ?? 8,
  guides: [],
  sampleValues: {},
  showSamples: false,

  setLabelSize(width, height) {
    set({ labelWidth: width, labelHeight: height });
    get().syncToCode();
  },

  addElement(type, x = 50, y = 50, fields) {
    const el: DesignElement = {
      id: nextId(),
      type,
      x,
      y,
      ...DEFAULT_SIZES[type],
      ...DEFAULT_VALUES[type],
      ...fields,
    };
    set(s => ({ elements: [...s.elements, el], selectedId: el.id, selectedIds: [el.id] }));
    get().syncToCode();
    return el.id;
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
    set({ elements: [], selectedId: null, selectedIds: [] });
    get().syncToCode();
  },

  duplicateSelected() {
    const { selectedId, selectedIds, elements } = get();
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    if (ids.length === 0) return;
    const offset = 16;
    const newEls = elements
      .filter(e => ids.includes(e.id))
      .map(e => ({ ...e, id: nextId(), x: e.x + offset, y: e.y + offset }));
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

  bringForward() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx === -1 || idx === elements.length - 1) return;
    const next = [...elements];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    set({ elements: next });
    get().syncToCode();
  },

  sendBackward() {
    const { selectedId, elements } = get();
    if (!selectedId) return;
    const idx = elements.findIndex(e => e.id === selectedId);
    if (idx <= 0) return;
    const next = [...elements];
    [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
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
          case 'right':    return [el.id, { x: maxX - w(el) }];
          case 'top':      return [el.id, { y: minY }];
          case 'center-v': return [el.id, { y: Math.round(centerY - h(el) / 2) }];
          case 'bottom':   return [el.id, { y: maxY - h(el) }];
          default:         return [el.id, {}];
        }
      })
    );

    set(s => ({ elements: s.elements.map(e => patches.has(e.id) ? { ...e, ...patches.get(e.id)! } : e) }));
    if (syncTimeout) clearTimeout(syncTimeout);
    get().syncToCode();
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setZoom(zoom) {
    set({ zoom: Math.min(6, Math.max(0.5, zoom)) });
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

  onCodeChange(code: string) {
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
        set({ zplError: e instanceof Error ? e.message : 'Invalid ZPL' });
      }
    }, 600);
  },

  async syncToCode() {
    const { labelWidth, labelHeight, elements } = get();

    // Cancel any previous in-flight sync request
    if (syncAbort) syncAbort.abort();
    syncAbort = new AbortController();
    const signal = syncAbort.signal;

    try {
      const zpl = await generateZpl({ labelWidth, labelHeight, elements }, signal);
      if (signal.aborted) return;
      lastCanvasZpl = zpl;
      lastPreviewZpl = ''; // invalidate preview cache when canvas changes
      set({ zplCode: zpl, zplError: '' });
    } catch (e) {
      if (signal.aborted) return;
      set({ zplError: `Canvas sync failed: ${e instanceof Error ? e.message : 'unknown error'}` });
    }
  },

  setPreviewUrl(url) {
    set({ previewUrl: url });
  },

  async fetchPreview(zplOverride?: string) {
    const { zplCode, labelWidth, labelHeight, previewUrl } = get();
    const zpl = zplOverride ?? zplCode;

    // Skip fetch if ZPL hasn't changed since last successful preview
    if (!zplOverride && zpl === lastPreviewZpl && previewUrl) return;

    set({ previewLoading: true, previewError: '' });
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = await previewZpl(zpl, labelWidth, labelHeight);
      lastPreviewZpl = zpl;
      set({ previewUrl: url, previewLoading: false });
    } catch (e) {
      set({
        previewLoading: false,
        previewError: e instanceof Error ? e.message : 'Preview failed',
      });
    }
  },

  closePreview() {
    const { previewUrl } = get();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    lastPreviewZpl = '';
    set({ previewUrl: null, previewError: '' });
  },
    }),
    {
      limit: 100,
      partialize: (state) => ({
        elements: state.elements,
        labelWidth: state.labelWidth,
        labelHeight: state.labelHeight,
      }),
      handleSet: (handleSet) => {
        let t: ReturnType<typeof setTimeout> | null = null;
        return (...args: Parameters<typeof handleSet>) => {
          if (t) clearTimeout(t);
          t = setTimeout(() => handleSet(...args), 300);
        };
      },
    },
  ),
);
