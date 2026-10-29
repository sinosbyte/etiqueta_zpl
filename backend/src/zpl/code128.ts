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
 * Symbol length in modules: 11 per symbol plus start (11), check (11) and
 * stop (13). Subset C packs two digits per symbol.
 */
export function code128Modules(value: string, codeSet?: Code128Set): number {
  const chars = value.includes('{{') ? CODE128_PLACEHOLDER_CHARS : value.length || 8;
  const symbols = codeSet === 'C' ? Math.ceil(chars / 2) : chars;
  return 11 * symbols + 35;
}
