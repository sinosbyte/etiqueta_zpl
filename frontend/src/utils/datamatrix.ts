import { create } from 'zustand';
import { DesignElement } from '../types';

// Data Matrix (^BX, ECC 200) size and drawing on the canvas. The printed side is modules x module
// size in dots, with no offset. The modules depend on the data, so they come from the bwip-js
// encoder, which is loaded the first time a Data Matrix is on the canvas (it is not in the main
// bundle). Checked against Labelary for 3 to 120 characters, digits, letters, URLs, accents and
// "_": the module count is the same, and so is a fixed symbol size (^BX ... ,c,r).

// Same values as backend/src/zpl/datamatrix.ts
export const DATAMATRIX_SIZES: readonly number[] = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132, 144,
];
export const DATAMATRIX_MIN_MODULE = 1;
export const DATAMATRIX_MAX_MODULE = 20;
export const DATAMATRIX_DEFAULT_MODULE = 4;

// Modules per side assumed while the encoder is loading (and by the ZPL parser for a first box)
const FALLBACK_MODULES = 16;

// Characters assumed for a {{variable}} with no sample value: the real length is only known when
// the label is printed.
export const DM_PLACEHOLDER_CHARS = 20;

// Drawn when the value is empty
const EMPTY_TEXT = 'DATAMATRIX';

type Samples = Record<string, string> | null | undefined;

// ---- the encoder, loaded on demand -------------------------------------------------------------

type RawSymbol = { pixs: number[]; pixx: number; pixy: number };
type RawFn = (options: Record<string, unknown>) => RawSymbol[];

interface EncoderState { ready: boolean; failed: boolean }
const useEncoderStore = create<EncoderState>(() => ({ ready: false, failed: false }));

/** Makes a component draw again when the encoder arrives (the size of a Data Matrix is known only then). */
export const useEncoder = (): EncoderState => useEncoderStore();

// The library object: raw() is called as its method, not detached from it
interface Encoder { raw: RawFn }
let encoder: Encoder | null = null;
let loading: Promise<void> | null = null;

export function loadEncoder(): Promise<void> {
  if (!loading) {
    loading = import('bwip-js/browser')
      .then(m => {
        const mod = m as unknown as Partial<Encoder> & { default?: Encoder };
        encoder = mod.default?.raw ? mod.default : (mod as Encoder);
        useEncoderStore.setState({ ready: true });
      })
      .catch(() => useEncoderStore.setState({ failed: true }));
  }
  return loading;
}

// ---- the symbol ---------------------------------------------------------------------------------

export interface DmSymbol {
  modules: number;
  /** Row by row, 1 = dark module */
  pixs: number[];
}

const cache = new Map<string, DmSymbol | 'nofit'>();

/**
 * The symbol for some data: the smallest square that holds it, or the fixed side when one is asked
 * for. 'nofit' when the data does not fit that side; null while the encoder is not loaded.
 */
export function dmSymbol(text: string, side?: number): DmSymbol | 'nofit' | null {
  if (!encoder) { void loadEncoder(); return null; }
  const key = `${side ?? 0}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let symbol: DmSymbol | 'nofit';
  try {
    const r = encoder.raw({ bcid: 'datamatrix', text, ...(side ? { rows: side, columns: side } : {}) })[0];
    symbol = r.pixx > 0 ? { modules: r.pixx, pixs: r.pixs } : 'nofit';
  } catch {
    symbol = 'nofit';
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, symbol);
  return symbol;
}

/** What the symbol carries, with sample values in place of {{variables}}; a variable without one counts as DM_PLACEHOLDER_CHARS letters. */
export function dmText(el: DesignElement, samples?: Samples): { text: string; estimated: boolean } {
  const value = el.dynamic && el.variableName ? `{{${el.variableName}}}` : (el.value ?? '');
  let estimated = false;
  const text = value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_marker, name: string) => {
    const sample = samples?.[name];
    if (sample) return sample;
    estimated = true;
    return 'A'.repeat(DM_PLACEHOLDER_CHARS);
  });
  return { text: text || EMPTY_TEXT, estimated };
}

export const dmModuleSize = (el: DesignElement): number =>
  Math.max(DATAMATRIX_MIN_MODULE, Math.min(DATAMATRIX_MAX_MODULE, Math.round(el.dmModuleSize ?? DATAMATRIX_DEFAULT_MODULE)));

export interface DmPrinted {
  modules: number;
  moduleSize: number;
  /** Side of the printed symbol, in dots */
  size: number;
  /** True when a {{variable}} has no sample value, so the length of the data is a guess */
  estimated: boolean;
  /** False when the data cannot be printed: too long for a fixed symbol size, or too long for any symbol */
  fits: boolean;
  /** When it does not fit: true if a fixed symbol size is the cause, false if no symbol can hold the data */
  fixed: boolean;
  symbol: DmSymbol | null;
}

/** The size the Data Matrix prints at; null until the encoder is loaded. */
export function dmPrinted(el: DesignElement, samples?: Samples): DmPrinted | null {
  const { text, estimated } = dmText(el, samples);
  const symbol = dmSymbol(text, el.dmSize);
  if (symbol === null) return null;
  const moduleSize = dmModuleSize(el);
  if (symbol === 'nofit') {
    const modules = el.dmSize ?? FALLBACK_MODULES;
    return { modules, moduleSize, size: modules * moduleSize, estimated, fits: false, fixed: el.dmSize !== undefined, symbol: null };
  }
  return { modules: symbol.modules, moduleSize, size: symbol.modules * moduleSize, estimated, fits: true, fixed: false, symbol };
}

/** Side of the box on the canvas: the printed symbol, or a guess while the encoder loads. */
export function dmBoxSide(el: DesignElement, samples?: Samples): number {
  return dmPrinted(el, samples)?.size ?? (el.dmSize ?? FALLBACK_MODULES) * dmModuleSize(el);
}

const clampModuleSize = (n: number): number =>
  Math.max(DATAMATRIX_MIN_MODULE, Math.min(DATAMATRIX_MAX_MODULE, Math.round(n)));

/** Sets the module size: the box becomes the printed size. */
export function dmModuleSizePatch(el: DesignElement, moduleSize: number, samples?: Samples): Partial<DesignElement> {
  const m = clampModuleSize(moduleSize);
  const side = dmBoxSide({ ...el, dmModuleSize: m }, samples);
  return { dmModuleSize: m, width: side, height: side };
}

/** Sets (or, with undefined, clears) the fixed symbol size: the box becomes the printed size. */
export function dmSizePatch(el: DesignElement, size: number | undefined, samples?: Samples): Partial<DesignElement> {
  const side = dmBoxSide({ ...el, dmSize: size }, samples);
  return { dmSize: size, width: side, height: side };
}

/** Resizing a Data Matrix changes the module size, in whole steps. */
export function resizeDmPatch(el: DesignElement, width: number, height: number, samples?: Samples): Partial<DesignElement> {
  const modules = dmPrinted(el, samples)?.modules ?? el.dmSize ?? FALLBACK_MODULES;
  return dmModuleSizePatch(el, Math.max(width, height) / modules, samples);
}
