import { Element, GenerateRequest } from './types';
import { i2of5DigitCount, i2of5Modules } from './i2of5';
import { CODE128_START } from './code128';
import { wrapGraphicData } from './graphic';
import { encodeHexUtf8 } from './hexText';
import {
  DATAMATRIX_DEFAULT_MODULE, DATAMATRIX_MAX_MODULE, DATAMATRIX_MIN_MODULE, DATAMATRIX_SIZES,
} from './datamatrix';
import { TABLE_DEFAULT_BORDER, TABLE_DEFAULT_FONT_SIZE, TABLE_DEFAULT_PADDING, tableGeometry, tableSlotName } from './table';

// Field data emitted into ^FD. Dynamic elements emit a {{variableName}}
// placeholder for the API caller to substitute; others emit their value.
const fieldData = (el: Element): string =>
  el.dynamic && el.variableName ? `{{${el.variableName}}}` : (el.value ?? '');

// Optional ^GB color/rounding parameters, emitted only when they differ from
// the ZPL defaults (black, no rounding).
const gbExtras = (el: Element): string =>
  el.color === 'W' || (el.rounding ?? 0) > 0 ? `,${el.color ?? 'B'},${el.rounding ?? 0}` : '';

const yn = (flag: boolean): string => (flag ? 'Y' : 'N');

// Cells of a table as ZPL: a ^GB box with the lines between rows and columns, then one ^FD per cell.
// The header cells print their title; the others print the {{variable}} of the column, numbered
// when the table holds several records (see tableSlotName).
function tableLines(el: Element): string[] {
  const g = tableGeometry(el);
  const columns = el.columns ?? [];
  if (!g) return [];

  const lines: string[] = [];
  const border = Math.max(0, Math.round(el.thickness ?? TABLE_DEFAULT_BORDER));
  const padding = Math.max(0, Math.round(el.cellPadding ?? TABLE_DEFAULT_PADDING));
  const fontName = el.fontName ?? '0';
  const fontSize = Math.max(1, Math.round(el.fontSize ?? TABLE_DEFAULT_FONT_SIZE));
  const fontWidth = Math.max(1, Math.round(el.fontWidth ?? fontSize));
  const rows = g.capacity + (g.headerRow ? 1 : 0);

  if (border > 0) {
    lines.push(`^FO${el.x},${el.y}^GB${g.width},${g.height},${border}^FS`);
    for (let r = 1; r < rows; r++) {
      lines.push(`^FO${el.x},${el.y + r * g.rowHeight}^GB${g.width},${border},${border}^FS`);
    }
    for (let c = 1; c < columns.length; c++) {
      lines.push(`^FO${el.x + g.colX[c]},${el.y}^GB${border},${g.height},${border}^FS`);
    }
  }

  const textTop = Math.max(0, Math.round((g.rowHeight - fontSize) / 2));
  for (let r = 0; r < rows; r++) {
    const isHeader = g.headerRow && r === 0;
    const slot = r - (g.headerRow ? 1 : 0) + 1;
    columns.forEach((col, c) => {
      // ^ and ~ start ZPL commands: they cannot be part of a title
      const text = isHeader ? col.header.replace(/[\^~]/g, ' ') : `{{${tableSlotName(col.field, slot, g.capacity)}}}`;
      if (text === '') return;
      const left = el.x + g.colX[c] + padding;
      const width = Math.max(1, g.colW[c] - 2 * padding);
      const top = el.y + r * g.rowHeight + textTop;
      lines.push(`^FO${left},${top}^A${fontName}N,${fontSize},${fontWidth}^FB${width},1,0,${col.align},0^FD${text}^FS`);
    });
  }
  return lines;
}

// One label (^XA ... ^XZ) with the given elements
function generateBlock(labelWidth: number, labelHeight: number, elements: Element[]): string {
  const lines: string[] = [
    '^XA',
    `^PW${labelWidth}`,
    `^LL${labelHeight}`,
  ];

  let cfFontName: string | null = null;
  let cfFontSize: number | null = null;
  let cfFontWidth: number | null = null;

  for (const field of elements) {
    // The printer works in whole dots: a position or size from the canvas may be fractional
    const el = {
      ...field,
      x: Math.round(field.x), y: Math.round(field.y),
      width: Math.round(field.width), height: Math.round(field.height),
    };
    const fo = `^FO${el.x},${el.y}`;
    // ^FR prints the field in reverse (white on black, black on white)
    const fr = el.reversed ? '^FR' : '';

    switch (el.type) {
      case 'text': {
        const fontName = el.fontName ?? '0';
        const fontSize = el.fontSize ?? 30;
        // Text imported as ^FH\^CI28 ^FD..^FS ^CI27: escapes for what is not plain ASCII, and the
        // wrapper is written back exactly as ZebraDesigner wrote it
        const hex = el.hexUtf8 === true;
        const data = hex ? encodeHexUtf8(fieldData(el)) : fieldData(el);
        const hexOpen = hex ? '^FH\\^CI28' : '';
        const hexClose = hex ? '^CI27' : '';
        // ^FT positions the baseline (of the last line of a ^FB block): the canvas
        // top-left plus the font height, plus the lines above the last one
        const linesAbove = el.block ? (el.block.maxLines - 1) * (fontSize + el.block.lineSpacing) : 0;
        // Rotated text is placed with ^FO (the top-left of the rotated text) and has no ^FB
        const orientation = el.orientation ?? 'N';
        const rotated = orientation !== 'N';
        const origin = el.origin === 'FT' && !rotated ? `^FT${el.x},${el.y + fontSize + linesAbove}` : fo;
        // ^FB block width follows the element width, so resizing on the canvas resizes the block
        const fb = el.block && !rotated
          ? `^FB${Math.round(el.width)},${el.block.maxLines},${el.block.lineSpacing},${el.block.justify},${el.block.hangingIndent}`
          : '';

        if (el.fontSource === 'cf' && !rotated) {
          // Emit or reuse a ^CF context line
          const fontWidth = el.fontWidth ?? null;
          if (cfFontName !== fontName || cfFontSize !== fontSize || cfFontWidth !== fontWidth) {
            lines.push(`^CF${fontName},${fontSize}${fontWidth !== null ? `,${fontWidth}` : ''}`);
            cfFontName = fontName;
            cfFontSize = fontSize;
            cfFontWidth = fontWidth;
          }
          lines.push(`${origin}${fb}${fr}${hexOpen}^FD${data}^FS${hexClose}`);
        } else {
          // Explicit ^A inline font (^CF has no orientation); width defaults to the height
          lines.push(`${origin}^A${fontName}${orientation},${fontSize},${el.fontWidth ?? fontSize}${fb}${fr}${hexOpen}^FD${data}^FS${hexClose}`);
        }
        break;
      }
      case 'barcodeI2of5': {
        const value = fieldData(el);
        const orientation = el.orientation ?? 'N';
        const rotated = orientation === 'R' || orientation === 'B';
        // The canvas box is bars length x bar height, swapped when rotated
        const length = rotated ? el.height : el.width;
        const barHeight = Math.round(rotated ? el.width : el.height);
        const ratio = el.ratio ?? 3;
        const checkDigit = el.checkDigit ?? false;
        const modules = i2of5Modules(i2of5DigitCount(value), ratio, checkDigit);
        const moduleWidth = Math.max(1, Math.round(length / modules));
        lines.push(
          `${fo}${fr}^BY${moduleWidth},${ratio}^B2${orientation},${barHeight},` +
          `${yn(el.printLine ?? true)},${yn(el.lineAbove ?? false)},${yn(checkDigit)}^FD${value}^FS`,
        );
        break;
      }
      case 'barcode128': {
        const value = fieldData(el);
        // Elements without a stored ^BY derive it from the width:
        // Code128 total modules = 11*(chars+2 start/check) + 13 stop = 11*chars + 35
        const moduleWidth = el.moduleWidth ?? Math.max(1, Math.floor(el.width / (11 * (value.length || 8) + 35)));
        // Mode A packs digits in subset C by itself; the start codes are for mode N
        const start = !el.codeAuto && el.codeSet ? CODE128_START[el.codeSet] : '';
        const mode = el.codeAuto ? ',A' : '';
        // ^FO is the top-left of the bars, also when rotated; the digits print outside them
        lines.push(
          `${fo}${fr}^BY${moduleWidth}^BC${el.orientation ?? 'N'},${el.height},${yn(el.printLine ?? true)},N,N${mode}` +
          `^FD${start}${value}^FS`,
        );
        break;
      }
      case 'qrcode': {
        // An explicit magnification wins; without one the box width decides, as it always did
        const mag = el.qrMagnification !== undefined
          ? Math.max(1, Math.min(10, Math.round(el.qrMagnification)))
          : Math.max(1, Math.min(10, Math.floor(el.width / 33)));
        lines.push(`${fo}${fr}^BQN,2,${mag}^FD${el.qrErrorCorrection ?? 'M'}A,${fieldData(el)}^FS`);
        break;
      }
      case 'datamatrix': {
        // ECC 200 (quality 200). The side is modules x the module size; asking for a symbol size
        // (c,r) keeps it the same whatever the data is, otherwise the printer takes the smallest
        const moduleSize = Math.max(DATAMATRIX_MIN_MODULE,
          Math.min(DATAMATRIX_MAX_MODULE, Math.round(el.dmModuleSize ?? DATAMATRIX_DEFAULT_MODULE)));
        const side = el.dmSize !== undefined && DATAMATRIX_SIZES.includes(el.dmSize) ? `,${el.dmSize},${el.dmSize}` : '';
        lines.push(`${fo}${fr}^BXN,${moduleSize},200${side}^FD${fieldData(el)}^FS`);
        break;
      }
      case 'rect': {
        const thickness = el.filled ? Math.min(el.width, el.height) : (el.thickness ?? 8);
        lines.push(`${fo}${fr}^GB${el.width},${el.height},${thickness}${gbExtras(el)}^FS`);
        break;
      }
      case 'line': {
        // A line is a solid bar: its thickness is always its shorter dimension,
        // derived from the bounding box rather than a stored value. This keeps
        // the ZPL a line (w===t or h===t) no matter how the box is resized —
        // dragging the perpendicular edge thickens the line instead of turning
        // it into a hollow box (e.g. ^GB200,163,3).
        const t = Math.min(el.width, el.height);
        lines.push(`${fo}${fr}^GB${el.width},${el.height},${t}${gbExtras(el)}^FS`);
        break;
      }
      case 'image': {
        // ^GFA bitmap: value holds the hex data (possibly compressed), one row per dot of height
        const bytesPerRow = el.bytesPerRow ?? Math.ceil(el.width / 8);
        const total = bytesPerRow * Math.round(el.height);
        lines.push(`${fo}${fr}^GFA,${total},${total},${bytesPerRow},${wrapGraphicData(el.value ?? '')}^FS`);
        break;
      }
      case 'comment': {
        lines.push(`^FX ${el.value ?? ''}`);
        break;
      }
      case 'raw': {
        // ZPL the editor cannot represent — emitted exactly as it was read
        lines.push(el.value ?? '');
        break;
      }
      case 'table': {
        lines.push(...tableLines(el));
        break;
      }
      default: {
        const _exhaustive: never = el.type;
        break;
      }
    }
  }

  lines.push('^XZ');
  return lines.join('\n');
}

/** Pages of the design: the ones configured, or the highest page an element is on. At least one. */
export function pageCountOf(req: GenerateRequest): number {
  let count = Math.max(1, req.pages?.length ?? 1);
  for (const el of req.elements) count = Math.max(count, (el.page ?? 0) + 1);
  return count;
}

/** The label (^XA ... ^XZ) of one page of the design, with its {{variables}} as they are. */
export function generatePageZpl(req: GenerateRequest, page: number): string {
  return generateBlock(req.labelWidth, req.labelHeight, req.elements.filter(el => (el.page ?? 0) === page));
}

/**
 * The ZPL of the design: one label per page, in order. A design with one page (every design saved
 * before pages existed) is exactly the single label it always was.
 */
export function generateZpl(req: GenerateRequest): string {
  if (pageCountOf(req) <= 1) return generateBlock(req.labelWidth, req.labelHeight, req.elements);
  const blocks: string[] = [];
  for (let page = 0; page < pageCountOf(req); page++) blocks.push(generatePageZpl(req, page));
  return blocks.join('\n');
}
