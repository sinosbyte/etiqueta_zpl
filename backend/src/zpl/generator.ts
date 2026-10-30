import { Element, GenerateRequest } from './types';
import { i2of5DigitCount, i2of5Modules } from './i2of5';
import { CODE128_START } from './code128';
import { compactGraphicData } from './graphic';

// Field data emitted into ^FD. Dynamic elements emit a {{variableName}}
// placeholder for the API caller to substitute; others emit their value.
const fieldData = (el: Element): string =>
  el.dynamic && el.variableName ? `{{${el.variableName}}}` : (el.value ?? '');

// Optional ^GB color/rounding parameters, emitted only when they differ from
// the ZPL defaults (black, no rounding).
const gbExtras = (el: Element): string =>
  el.color === 'W' || (el.rounding ?? 0) > 0 ? `,${el.color ?? 'B'},${el.rounding ?? 0}` : '';

const yn = (flag: boolean): string => (flag ? 'Y' : 'N');

export function generateZpl(req: GenerateRequest): string {
  const lines: string[] = [
    '^XA',
    `^PW${req.labelWidth}`,
    `^LL${req.labelHeight}`,
  ];

  let cfFontName: string | null = null;
  let cfFontSize: number | null = null;
  let cfFontWidth: number | null = null;

  for (const field of req.elements) {
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
        const data = fieldData(el);
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
          lines.push(`${origin}${fb}${fr}^FD${data}^FS`);
        } else {
          // Explicit ^A inline font (^CF has no orientation); width defaults to the height
          lines.push(`${origin}^A${fontName}${orientation},${fontSize},${el.fontWidth ?? fontSize}${fb}${fr}^FD${data}^FS`);
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
        const start = el.codeSet ? CODE128_START[el.codeSet] : '';
        // ^FO is the top-left of the bars, also when rotated; the digits print outside them
        lines.push(
          `${fo}${fr}^BY${moduleWidth}^BC${el.orientation ?? 'N'},${el.height},${yn(el.printLine ?? true)},N,N` +
          `^FD${start}${value}^FS`,
        );
        break;
      }
      case 'qrcode': {
        const mag = Math.max(1, Math.min(10, Math.floor(el.width / 33)));
        lines.push(`${fo}${fr}^BQN,2,${mag}^FD${el.qrErrorCorrection ?? 'M'}A,${fieldData(el)}^FS`);
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
        lines.push(`${fo}${fr}^GFA,${total},${total},${bytesPerRow},${compactGraphicData(el.value ?? '')}^FS`);
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
      default: {
        const _exhaustive: never = el.type;
        break;
      }
    }
  }

  lines.push('^XZ');
  return lines.join('\n');
}
