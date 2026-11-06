import { DesignElement } from '../types';
import { extractVariables, substituteVariables } from './variables';
import { isQuarterTurn } from './rotation';

// Code 128 (^BC) size on the canvas, matching backend/src/zpl/code128.ts.

// Characters assumed for a value with {{variables}} and no sample value: the
// real length is only known when the label is printed. The element can say
// better (expectedChars).
export const CODE128_PLACEHOLDER_CHARS = 12;

// JsBarcode format for the start code; without one the printer uses subset B
export const CODE128_FORMAT = { A: 'CODE128A', B: 'CODE128B', C: 'CODE128C' } as const;

// The value printed, with sample values in place of {{variables}} when known
export function code128Value(el: DesignElement, samples?: Record<string, string> | null): string {
  if (el.dynamic && el.variableName) return samples?.[el.variableName] || `{{${el.variableName}}}`;
  const value = el.value ?? '';
  if (!samples || extractVariables(value).some(v => !samples[v])) return value;
  return substituteVariables(value, samples);
}

/**
 * Symbols printed in mode A (automatic), matching backend/src/zpl/code128.ts: a
 * run of digits is packed in subset C, two digits per symbol, when it has 4 or
 * more at the start or end of the data and 6 or more in the middle. An estimate:
 * the printer decides the final packing.
 */
export function code128AutoSymbols(value: string): number {
  const parts = value.match(/\d+|\D/g) ?? [];
  let symbols = 0;
  parts.forEach((part, i) => {
    if (!/^\d/.test(part)) { symbols += 1; return; }
    const first = i === 0;
    const last = i === parts.length - 1;
    if (part.length < (first || last ? 4 : 6)) { symbols += part.length; return; }
    symbols += Math.floor(part.length / 2) + (part.length % 2) * 2 + (first ? 0 : 1) + (last ? 0 : 1);
  });
  return symbols;
}

/**
 * Symbol length in modules: 11 per symbol plus start (11), check (11) and
 * stop (13). Subset C packs two digits per symbol. In mode A a {{variable}}
 * is assumed to be digits, the case where the packing matters.
 */
export function code128Modules(
  value: string, codeSet?: DesignElement['codeSet'], placeholderChars = CODE128_PLACEHOLDER_CHARS, auto = false,
): number {
  const placeholder = value.includes('{{');
  const chars = placeholder ? placeholderChars : value.length || 8;
  if (auto) return 11 * code128AutoSymbols(placeholder || !value ? '0'.repeat(chars) : value) + 35;
  const symbols = codeSet === 'C' ? Math.ceil(chars / 2) : chars;
  return 11 * symbols + 35;
}

// Printed length of the bars in dots (unturned). Elements without a stored ^BY
// bar width keep their box width.
export function code128Width(el: DesignElement, samples?: Record<string, string> | null): number {
  if (!el.moduleWidth) return el.width;
  return el.moduleWidth * code128Modules(code128Value(el, samples), el.codeSet, el.expectedChars, el.codeAuto);
}

/**
 * Height of the digits printed below the bars, in dots: a 6-dot gap plus
 * digits about 7.2 bar widths high (measured on Labelary for ^BY1 to ^BY10).
 */
export const code128DigitsBand = (moduleWidth: number): number => 6 + Math.round(7.2 * moduleWidth);

/**
 * Resizing a Code 128 changes the bar width (^BY); the height is the bar height.
 * Width and height are the box on the canvas, which is turned for R and B.
 */
export function resizeCode128Patch(
  el: DesignElement, width: number, height: number, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const quarter = isQuarterTurn(el.orientation);
  const length = quarter ? height : width;
  const barsHeight = quarter ? width : height;
  const modules = code128Modules(code128Value(el, samples), el.codeSet, el.expectedChars, el.codeAuto);
  const moduleWidth = Math.max(1, Math.min(10, Math.round(length / modules)));
  return { moduleWidth, width: moduleWidth * modules, height: Math.max(1, Math.round(barsHeight)) };
}

/** Sets the bar width (^BY) directly: the length follows from it. */
export function barWidthPatch(
  el: DesignElement, moduleWidth: number, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const modules = code128Modules(code128Value(el, samples), el.codeSet, el.expectedChars, el.codeAuto);
  return { moduleWidth, width: moduleWidth * modules };
}

/** Sets how many characters a {{variable}} value is expected to have: the length follows from it. */
export function expectedCharsPatch(
  el: DesignElement, expectedChars: number, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const modules = code128Modules(code128Value(el, samples), el.codeSet, expectedChars, el.codeAuto);
  return { expectedChars, ...(el.moduleWidth ? { width: el.moduleWidth * modules } : {}) };
}

export type Code128Mode = 'N' | 'A';

/**
 * Chooses how the printer encodes the data: N is the default (subset B unless
 * the ZPL has a start code); A packs digits in pairs, so numbers print about
 * half as wide. The length follows from it.
 */
export function code128ModePatch(
  el: DesignElement, mode: Code128Mode, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const auto = mode === 'A';
  const patch: Partial<DesignElement> = { codeAuto: auto || undefined, codeSet: undefined };
  const modules = code128Modules(code128Value(el, samples), undefined, el.expectedChars, auto);
  return { ...patch, ...(el.moduleWidth ? { width: el.moduleWidth * modules } : {}) };
}
