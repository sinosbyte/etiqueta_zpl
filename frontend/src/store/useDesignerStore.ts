import { create } from 'zustand';
import { temporal } from 'zundo';
import { DesignElement, ElementType } from '../types';
import { generateZpl, parseZpl, previewZpl } from '../utils/zplClient';

let idCounter = 0;
const nextId = () => `el-${Date.now()}-${++idCounter}`;

const DEFAULT_SIZES: Record<ElementType, { width: number; height: number }> = {
  text: { width: 200, height: 40 },
  barcode128: { width: 300, height: 100 },
  qrcode: { width: 100, height: 100 },
  rect: { width: 200, height: 100 },
  line: { width: 200, height: 8 },
  comment: { width: 0, height: 0 },
  raw: { width: 0, height: 0 },
};

const DEFAULT_VALUES: Partial<Record<ElementType, Partial<DesignElement>>> = {
  text: { value: 'New Text', fontSize: 34, fontName: '0' },
  barcode128: { value: '123456789' },
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
  gridSize: number;
  setLabelSize(width: number, height: number): void;
  addElement(type: ElementType, x?: number, y?: number): void;
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
  snapToGrid: false,
  gridSize: 8,

  setLabelSize(width, height) {
    set({ labelWidth: width, labelHeight: height });
    get().syncToCode();
  },

  addElement(type, x = 50, y = 50) {
    const el: DesignElement = {
      id: nextId(),
      type,
      x,
      y,
      ...DEFAULT_SIZES[type],
      ...DEFAULT_VALUES[type],
    };
    set(s => ({ elements: [...s.elements, el], selectedId: el.id }));
    get().syncToCode();
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

    const minX = Math.min(...selected.map(e => e.x));
    const maxX = Math.max(...selected.map(e => e.x + e.width));
    const minY = Math.min(...selected.map(e => e.y));
    const maxY = Math.max(...selected.map(e => e.y + e.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const patches = new Map<string, Partial<DesignElement>>(
      selected.map(el => {
        switch (alignment) {
          case 'left':     return [el.id, { x: minX }];
          case 'center-h': return [el.id, { x: Math.round(centerX - el.width / 2) }];
          case 'right':    return [el.id, { x: maxX - el.width }];
          case 'top':      return [el.id, { y: minY }];
          case 'center-v': return [el.id, { y: Math.round(centerY - el.height / 2) }];
          case 'bottom':   return [el.id, { y: maxY - el.height }];
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
