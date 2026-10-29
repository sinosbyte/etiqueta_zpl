// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim.
export type ElementType = 'text' | 'barcode128' | 'barcodeI2of5' | 'qrcode' | 'rect' | 'line' | 'comment' | 'raw';

export type Orientation = 'N' | 'R' | 'I' | 'B';

// ^FB field block: text aligned inside a box whose width is the element width
export interface FieldBlock {
  maxLines: number;
  lineSpacing: number;
  justify: 'L' | 'C' | 'R' | 'J';
  hangingIndent: number;
}

export interface DesignElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string;
  fontSize?: number;
  fontWidth?: number;   // ^A width in dots; omitted = same as fontSize
  fontName?: string;
  fontSource?: 'cf' | 'a';
  reversed?: boolean;
  filled?: boolean;
  thickness?: number;
  color?: 'B' | 'W';    // ^GB line color
  rounding?: number;    // ^GB corner rounding, 0 (none) to 8 (heaviest)
  qrErrorCorrection?: 'H' | 'Q' | 'M' | 'L';
  origin?: 'FT';              // text positioned with ^FT (baseline); x/y stay the top-left
  block?: FieldBlock;         // text inside a ^FB block
  orientation?: Orientation;  // barcodeI2of5; omitted = N
  moduleWidth?: number;       // barcode ^BY narrow bar width
  ratio?: number;             // barcodeI2of5 ^BY wide-to-narrow ratio
  printLine?: boolean;        // barcode interpretation line; omitted = true
  codeSet?: 'A' | 'B' | 'C';  // barcode128 start code in ^FD (>9, >:, >;); omitted = none
  lineAbove?: boolean;
  checkDigit?: boolean;
  dynamic?: boolean;
  variableName?: string;
}

// Text shown on the canvas for value-bearing elements. Dynamic elements
// render their {{variableName}} placeholder rather than a static value.
export const displayValue = (el: DesignElement): string | undefined =>
  el.dynamic && el.variableName ? `{{${el.variableName}}}` : el.value;

// Raw ZPL that is a printed field (has data or graphics) rather than a
// label-level setting such as ^CI28 or ^MMT, which has nothing to draw.
export const isRawField = (el: DesignElement): boolean =>
  el.type === 'raw' && /\^(FD|FS|G[BCDEF]|FV)/.test(el.value ?? '');
