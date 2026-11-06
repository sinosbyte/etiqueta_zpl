import { DesignElement } from '../types';
import { CODE128_PLACEHOLDER_CHARS, code128Modules, code128Value } from './code128';
import { turnedSize } from './rotation';
import { elementBox } from './zplText';

// Things a Code 128 must not print over
const OBSTACLES: ReadonlySet<DesignElement['type']> = new Set(['text', 'barcode128', 'barcodeI2of5', 'qrcode', 'image']);

export interface BarcodeFit {
  chars: number;              // characters of the value the check assumes
  sampleChars: number;        // characters of the sample value (0 = none)
  length: number;             // printed length of the bars, in dots
  overlaps: DesignElement[];  // elements the bars would print over
  outside: boolean;           // the bars run past the label
}

/** A Code 128 whose value has a {{variable}}: its printed length is only known when it prints. */
export const isVariableCode128 = (el: DesignElement): boolean =>
  el.type === 'barcode128' && !!el.moduleWidth && code128Value(el).includes('{{');

const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

/**
 * Checks where a Code 128 with a {{variable}} would print. The length depends on
 * the value, so the check uses the larger of the characters set in the element
 * and the sample value: if either one does not fit, it can happen on the label.
 * Returns null for anything else, whose size the canvas already shows.
 */
export function barcodeFit(
  el: DesignElement,
  elements: DesignElement[],
  sampleValues: Record<string, string>,
  showSamples: boolean,
  labelWidth: number,
  labelHeight: number,
): BarcodeFit | null {
  if (!isVariableCode128(el)) return null;
  const sampled = code128Value(el, sampleValues);
  const sampleChars = sampled.includes('{{') ? 0 : sampled.length;
  const chars = Math.max(el.expectedChars ?? 0, sampleChars) || CODE128_PLACEHOLDER_CHARS;
  const length = el.moduleWidth! * code128Modules(code128Value(el), el.codeSet, chars, el.codeAuto);
  const size = turnedSize(el.orientation, length, el.height);
  const mine = { x: el.x, y: el.y, ...size };
  // The others are as the canvas shows them
  const shown = showSamples ? sampleValues : null;
  const overlaps = elements.filter(other =>
    other.id !== el.id && OBSTACLES.has(other.type) && overlap(mine, { x: other.x, y: other.y, ...elementBox(other, shown) }));
  const outside = mine.x + mine.width > labelWidth + 1 || mine.y + mine.height > labelHeight + 1;
  return { chars, sampleChars, length, overlaps, outside };
}
