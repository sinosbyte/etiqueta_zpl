// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim, so editing the
// canvas never drops commands the editor does not understand.
export type ElementType = 'text' | 'barcode128' | 'qrcode' | 'rect' | 'line' | 'comment' | 'raw';

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
