// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim, so editing the
// canvas never drops commands the editor does not understand.
export type ElementType = 'text' | 'barcode128' | 'barcodeI2of5' | 'qrcode' | 'datamatrix' | 'rect' | 'line' | 'image' | 'comment' | 'raw' | 'table';

export type Orientation = 'N' | 'R' | 'I' | 'B';

// How a page of the design is printed: 'first' once, on the first label; 'repeat' on the labels that
// follow, as many times as the records left over need
export type PageMode = 'first' | 'repeat';

export interface PageConfig {
  mode: PageMode;
}

// What is saved with a design version about its pages (NULL = a design of one page)
export interface PagesConfig {
  pages: PageConfig[];
  records?: Record<string, string>[];  // the test records the tables show, for the simulation
}

// One column of a table: the title printed in the header row, and the {{variable}} (field) its cells
// print for each record
export interface TableColumn {
  header: string;
  field: string;
  width: number;  // ZPL dots
  align: 'L' | 'C' | 'R';
}

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
  qrMagnification?: number;  // QR code ^BQ magnification, 1 to 10 dots per module; omitted = width / 33 (how designs saved before this field were sized)
  dmModuleSize?: number;  // datamatrix ^BX h: dots per module, 1 to 20; omitted = 4
  dmSize?: number;        // datamatrix symbol side in modules (^BX c,r, a square ECC 200 size); omitted = the printer takes the smallest that fits
  origin?: 'FT';       // text positioned with ^FT (baseline); x/y stay the top-left on the canvas
  hexUtf8?: boolean;   // text written as ^FH\^CI28 ^FD..^FS ^CI27 (ZebraDesigner): value is plain text, non-ASCII goes out as \HH; omitted = plain ^FD
  block?: FieldBlock;  // text inside a ^FB block; the block width is the element width
  orientation?: Orientation;  // text, barcode128 and barcodeI2of5 rotation; omitted = N
  moduleWidth?: number;       // barcode ^BY narrow bar width in dots
  expectedChars?: number;     // barcode128 with a {{variable}}: characters of the value printed, for its length on the canvas
  ratio?: number;             // barcodeI2of5 ^BY wide-to-narrow ratio
  printLine?: boolean;        // barcode interpretation line below the bars; omitted = true
  codeSet?: 'A' | 'B' | 'C';  // barcode128 start code in ^FD (>9, >:, >;); omitted = none
  codeAuto?: boolean;         // barcode128 mode A (^BC ...,A): the printer packs digit runs in subset C; omitted = mode N
  lineAbove?: boolean;        // barcodeI2of5 interpretation line above the bars
  checkDigit?: boolean;       // barcodeI2of5 Mod 10 check digit
  dynamic?: boolean;
  variableName?: string;
  bytesPerRow?: number;       // image: ^GFA bytes per row; value holds the ^GFA data
  page?: number;              // page of the design the element is on, 0 or 1; omitted = 0 (the only page of a design saved before pages existed)
  columns?: TableColumn[];    // table: its columns, left to right; the table width is their sum
  rowHeight?: number;         // table: height of every row in dots; omitted = 40
  headerRow?: boolean;        // table: a header row with the column titles; omitted = true
  rowsPerPage?: number;       // table: records it holds on each label (its capacity); omitted = 1
  cellPadding?: number;       // table: dots between a column edge and its text; omitted = 6
  // A table's font is fontName / fontSize / fontWidth (omitted: 0, 24, as tall) and its border is
  // thickness (omitted = 2; 0 = no lines)
}

export interface LabelDimensions {
  labelWidth: number;   // ZPL dots
  labelHeight: number;  // ZPL dots
}

export interface GenerateRequest extends LabelDimensions {
  elements: Element[];
  pages?: PageConfig[];  // omitted = one page, or two (first + repeat) when an element is on page 1
}

export interface ParseResult extends LabelDimensions {
  elements: Element[];
  unknownCommands: string[];
}
