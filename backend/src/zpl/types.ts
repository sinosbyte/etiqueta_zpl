// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim, so editing the
// canvas never drops commands the editor does not understand.
export type ElementType = 'text' | 'barcode128' | 'barcodeI2of5' | 'qrcode' | 'rect' | 'line' | 'comment' | 'raw';

export type Orientation = 'N' | 'R' | 'I' | 'B';

// ^FB field block: text wrapped/aligned inside a box of fixed width
export interface FieldBlock {
  maxLines: number;     // default 1
  lineSpacing: number;  // dots added between lines, default 0
  justify: 'L' | 'C' | 'R' | 'J';
  hangingIndent: number;
}

export interface Element {
  id: string;
  type: ElementType;
  x: number;       // ZPL dots
  y: number;       // ZPL dots
  width: number;   // ZPL dots
  height: number;  // ZPL dots
  value?: string;
  fontSize?: number;
  fontWidth?: number;  // ^A width in dots; omitted = same as fontSize
  fontName?: string;
  fontSource?: 'cf' | 'a';
  reversed?: boolean;
  filled?: boolean;
  thickness?: number;  // ZPL dots; applies to line and non-filled rect border
  color?: 'B' | 'W';   // ^GB line color
  rounding?: number;   // ^GB corner rounding, 0 (none) to 8 (heaviest)
  qrErrorCorrection?: 'H' | 'Q' | 'M' | 'L';  // ^FD prefix of a QR code; omitted = M
  origin?: 'FT';       // text positioned with ^FT (baseline); x/y stay the top-left on the canvas
  block?: FieldBlock;  // text inside a ^FB block; the block width is the element width
  orientation?: Orientation;  // barcodeI2of5 orientation; omitted = N
  moduleWidth?: number;       // barcode ^BY narrow bar width in dots
  ratio?: number;             // barcodeI2of5 ^BY wide-to-narrow ratio
  printLine?: boolean;        // barcode interpretation line below the bars; omitted = true
  codeSet?: 'A' | 'B' | 'C';  // barcode128 start code in ^FD (>9, >:, >;); omitted = none
  lineAbove?: boolean;        // barcodeI2of5 interpretation line above the bars
  checkDigit?: boolean;       // barcodeI2of5 Mod 10 check digit
  dynamic?: boolean;
  variableName?: string;
}

export interface LabelDimensions {
  labelWidth: number;   // ZPL dots
  labelHeight: number;  // ZPL dots
}

export interface GenerateRequest extends LabelDimensions {
  elements: Element[];
}

export interface ParseResult extends LabelDimensions {
  elements: Element[];
  unknownCommands: string[];
}
