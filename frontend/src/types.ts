// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim.
export type ElementType = 'text' | 'barcode128' | 'qrcode' | 'rect' | 'line' | 'comment' | 'raw';

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
  dynamic?: boolean;
  variableName?: string;
}

// Text shown on the canvas for value-bearing elements. Dynamic elements
// render their {{variableName}} placeholder rather than a static value.
export const displayValue = (el: DesignElement): string | undefined =>
  el.dynamic && el.variableName ? `{{${el.variableName}}}` : el.value;
