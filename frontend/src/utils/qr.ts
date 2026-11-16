import QRCode from 'qrcode';
import { DesignElement } from '../types';

// QR code (^BQ) size on the canvas. The printed side is modules x magnification
// dots, and the modules depend on the data and the error correction level.
// Checked against Labelary for levels L, M, Q and H, 3 to 120 characters and
// magnifications 1 to 10: the module count of the `qrcode` library is the same,
// and the side is exactly modules x magnification.

export const QR_MIN_MAGNIFICATION = 1;
export const QR_MAX_MAGNIFICATION = 10;

// Before the magnification field, a QR code took it from its box: width / 33.
// An element without the field keeps doing so.
const LEGACY_DOTS_PER_MAGNIFICATION = 33;

// Characters assumed for a {{variable}} with no sample value: the real length is
// only known when the label is printed.
export const QR_PLACEHOLDER_CHARS = 20;

// What the canvas has always drawn for an empty value
const EMPTY_TEXT = 'https://example.com';

type Samples = Record<string, string> | null | undefined;
type Level = NonNullable<DesignElement['qrErrorCorrection']>;

const clampMagnification = (n: number): number =>
  Math.max(QR_MIN_MAGNIFICATION, Math.min(QR_MAX_MAGNIFICATION, Math.round(n)));

/** The magnification the printer will use: the stored one, or the one the box width gives. */
export const qrMagnification = (el: DesignElement): number =>
  el.qrMagnification !== undefined
    ? clampMagnification(el.qrMagnification)
    : clampMagnification(Math.floor(el.width / LEGACY_DOTS_PER_MAGNIFICATION));

/**
 * The text the QR code carries, with sample values in place of {{variables}}.
 * A variable without a sample counts as QR_PLACEHOLDER_CHARS letters (estimated).
 */
export function qrText(el: DesignElement, samples?: Samples): { text: string; estimated: boolean } {
  const value = el.dynamic && el.variableName ? `{{${el.variableName}}}` : (el.value ?? '');
  let estimated = false;
  const text = value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_marker, name: string) => {
    const sample = samples?.[name];
    if (sample) return sample;
    estimated = true;
    return 'A'.repeat(QR_PLACEHOLDER_CHARS);
  });
  return { text: text || EMPTY_TEXT, estimated };
}

// Building a symbol is not free and the canvas asks for the size often
const modulesCache = new Map<string, number | null>();

/** Modules per side of the symbol, or null when the data does not fit in a QR code. */
export function qrModules(text: string, level: Level): number | null {
  const key = `${level}${text}`;
  if (modulesCache.has(key)) return modulesCache.get(key)!;
  let modules: number | null;
  try {
    modules = QRCode.create(text, { errorCorrectionLevel: level }).modules.size;
  } catch {
    modules = null;
  }
  if (modulesCache.size > 300) modulesCache.clear();
  modulesCache.set(key, modules);
  return modules;
}

export interface QrPrinted {
  modules: number;
  magnification: number;
  /** Side of the printed symbol, in dots */
  size: number;
  /** True when a {{variable}} has no sample value, so the length of the data is a guess */
  estimated: boolean;
}

/** The size the QR code prints at, or null when the data does not fit. */
export function qrPrinted(el: DesignElement, samples?: Samples): QrPrinted | null {
  const { text, estimated } = qrText(el, samples);
  const modules = qrModules(text, el.qrErrorCorrection ?? 'M');
  if (modules === null) return null;
  const magnification = qrMagnification(el);
  return { modules, magnification, size: modules * magnification, estimated };
}

/**
 * Side of the box on the canvas for a QR code that has a stored magnification: the
 * printed size. Without one the box is the element's own width and height.
 */
export function qrBoxSide(el: DesignElement, samples?: Samples): number | null {
  if (el.qrMagnification === undefined) return null;
  return qrPrinted(el, samples)?.size ?? null;
}

/** Sets the magnification: the box becomes the printed size. */
export function qrMagnificationPatch(
  el: DesignElement, magnification: number, samples?: Samples,
): Partial<DesignElement> {
  const m = clampMagnification(magnification);
  const modules = qrPrinted({ ...el, qrMagnification: m }, samples)?.modules;
  const side = modules ? modules * m : m * LEGACY_DOTS_PER_MAGNIFICATION;
  return { qrMagnification: m, width: side, height: side };
}

/** Resizing a QR code with a stored magnification changes the magnification, in whole steps. */
export function resizeQrPatch(
  el: DesignElement, width: number, height: number, samples?: Samples,
): Partial<DesignElement> {
  const modules = qrPrinted(el, samples)?.modules ?? LEGACY_DOTS_PER_MAGNIFICATION;
  return qrMagnificationPatch(el, Math.max(width, height) / modules, samples);
}
