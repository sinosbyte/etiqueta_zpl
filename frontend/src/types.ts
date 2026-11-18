// 'raw' holds ZPL the editor cannot represent (e.g. ^FT, ^FB, ^B2, ^CI, ~SD).
// It is not drawn on the canvas and is emitted back verbatim.
export type ElementType = 'text' | 'barcode128' | 'barcodeI2of5' | 'qrcode' | 'datamatrix' | 'rect' | 'line' | 'image' | 'comment' | 'raw' | 'table';

export type Orientation = 'N' | 'R' | 'I' | 'B';

// How a page of the design prints: 'first' once, on the first label; 'repeat' on the labels that follow,
// as many times as the records left over need (same names as the backend)
export type PageMode = 'first' | 'repeat';

export interface PageConfig {
  mode: PageMode;
}

// A record of the test data: the value of each field (the `field` of a table column)
export type DataRecord = Record<string, string>;

// What is saved with a design version about its pages; null/absent = a design of one page
export interface PagesConfig {
  pages: PageConfig[];
  records?: DataRecord[];
}

// What POST /api/expand-zpl answers (backend/src/zpl/pagination.ts): the labels a design prints for some records
export interface ExpandedLabel {
  index: number;         // 1-based, in print order
  page: number;          // page of the design the label comes from: 0 = page 1, 1 = page 2
  recordStart: number;   // index of the first record on the label
  recordCount: number;   // records on the label
  zpl: string;
}

export interface ExpandResult {
  labels: ExpandedLabel[];
  totalRecords: number;
  unplaced: number;      // records no label has room for
  warnings: string[];    // codes: 'repeat-page-without-table', 'unplaced-records', 'variable-collision'
  zpl: string;
}

// One column of a table: the title in its header row and the {{variable}} its cells print
export interface TableColumn {
  header: string;
  field: string;
  width: number;
  align: 'L' | 'C' | 'R';
}

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
  qrMagnification?: number;   // QR code ^BQ magnification, 1 to 10 dots per module; omitted = width / 33 (designs saved before this field)
  dmModuleSize?: number;      // datamatrix ^BX h: dots per module, 1 to 20; omitted = 4
  dmSize?: number;            // datamatrix symbol side in modules (^BX c,r, a square ECC 200 size); omitted = the printer takes the smallest that fits
  origin?: 'FT';              // text positioned with ^FT (baseline); x/y stay the top-left
  hexUtf8?: boolean;          // text imported as ^FH\^CI28 ^FD..^FS ^CI27 (ZebraDesigner): plain text here, \HH escapes in the ZPL
  block?: FieldBlock;         // text inside a ^FB block
  orientation?: Orientation;  // text, barcode128 and barcodeI2of5 rotation; omitted = N
  moduleWidth?: number;       // barcode ^BY narrow bar width
  expectedChars?: number;     // barcode128 with a {{variable}}: characters of the value printed, for its length on the canvas
  ratio?: number;             // barcodeI2of5 ^BY wide-to-narrow ratio
  printLine?: boolean;        // barcode interpretation line; omitted = true
  codeSet?: 'A' | 'B' | 'C';  // barcode128 start code in ^FD (>9, >:, >;); omitted = none
  codeAuto?: boolean;         // barcode128 mode A (^BC ...,A): the printer packs digit runs in subset C; omitted = mode N
  lineAbove?: boolean;
  checkDigit?: boolean;
  dynamic?: boolean;
  variableName?: string;
  bytesPerRow?: number;       // image: ^GFA bytes per row; value holds the ^GFA data
  page?: number;              // page of the design the element is on, 0 or 1; omitted = 0 (the only page of a design saved before pages existed)
  columns?: TableColumn[];    // table: its columns, left to right
  rowHeight?: number;         // table: height of every row in dots; omitted = 40
  headerRow?: boolean;        // table: a header row with the column titles; omitted = true
  rowsPerPage?: number;       // table: records it holds on each label; omitted = 1
  cellPadding?: number;       // table: dots between a column edge and its text; omitted = 6
}

// Text shown on the canvas for value-bearing elements. Dynamic elements
// render their {{variableName}} placeholder rather than a static value.
export const displayValue = (el: DesignElement): string | undefined =>
  el.dynamic && el.variableName ? `{{${el.variableName}}}` : el.value;

// Raw ZPL that is a printed field (has data or graphics) rather than a
// label-level setting such as ^CI28 or ^MMT, which has nothing to draw.
export const isRawField = (el: DesignElement): boolean =>
  el.type === 'raw' && /\^(FD|FS|G[BCDEF]|FV)/.test(el.value ?? '');
