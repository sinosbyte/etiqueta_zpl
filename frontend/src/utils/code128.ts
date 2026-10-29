import { DesignElement } from '../types';
import { extractVariables, substituteVariables } from './variables';

// Code 128 (^BC) size on the canvas, matching backend/src/zpl/code128.ts.

// Characters assumed for a value with {{variables}} and no sample value: the
// real length is only known when the label is printed.
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
 * Symbol length in modules: 11 per symbol plus start (11), check (11) and
 * stop (13). Subset C packs two digits per symbol.
 */
export function code128Modules(value: string, codeSet?: DesignElement['codeSet']): number {
  const chars = value.includes('{{') ? CODE128_PLACEHOLDER_CHARS : value.length || 8;
  const symbols = codeSet === 'C' ? Math.ceil(chars / 2) : chars;
  return 11 * symbols + 35;
}

// Printed width in dots. Elements without a stored ^BY bar width keep their box width.
export function code128Width(el: DesignElement, samples?: Record<string, string> | null): number {
  if (!el.moduleWidth) return el.width;
  return el.moduleWidth * code128Modules(code128Value(el, samples), el.codeSet);
}

// Resizing a Code 128 changes the bar width (^BY); the height is the bar height
export function resizeCode128Patch(
  el: DesignElement, width: number, height: number, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const modules = code128Modules(code128Value(el, samples), el.codeSet);
  const moduleWidth = Math.max(1, Math.min(10, Math.round(width / modules)));
  return { moduleWidth, width: moduleWidth * modules, height: Math.max(1, Math.round(height)) };
}
