// Code 128 (^BC) geometry shared by the parser and the generator.

export type Code128Set = 'A' | 'B' | 'C';

// Start code written at the beginning of ^FD (mode N). Without one the printer
// starts in subset B, the same as ">:".
export const CODE128_START: Record<Code128Set, string> = { A: '>9', B: '>:', C: '>;' };

const START_RE = /^>([9:;])/;
const SET_BY_START: Record<string, Code128Set> = { '9': 'A', ':': 'B', ';': 'C' };

/**
 * Splits a leading start code off the field data. Returns null when the data
 * has other invocation codes (">" anywhere else), which the canvas cannot draw.
 */
export function splitCode128Start(data: string): { codeSet?: Code128Set; value: string } | null {
  const match = data.match(START_RE);
  const value = match ? data.slice(match[0].length) : data;
  if (value.includes('>')) return null;
  return match ? { codeSet: SET_BY_START[match[1]], value } : { value };
}

// Characters assumed for a value with {{variables}}: the real length is only
// known when the label is printed.
export const CODE128_PLACEHOLDER_CHARS = 12;

/**
 * Symbols printed in mode A (automatic): a run of digits is packed in subset C,
 * two digits per symbol, when it has 4 or more at the start or end of the data
 * and 6 or more in the middle. Entering and leaving subset C costs one symbol
 * each, and an odd digit left over costs a switch and a symbol. An estimate:
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
  value: string, codeSet?: Code128Set, placeholderChars = CODE128_PLACEHOLDER_CHARS, auto = false,
): number {
  const placeholder = value.includes('{{');
  const chars = placeholder ? placeholderChars : value.length || 8;
  if (auto) return 11 * code128AutoSymbols(placeholder || !value ? '0'.repeat(chars) : value) + 35;
  const symbols = codeSet === 'C' ? Math.ceil(chars / 2) : chars;
  return 11 * symbols + 35;
}
