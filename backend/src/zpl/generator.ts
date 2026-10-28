import { Element, GenerateRequest } from './types';
import { i2of5DigitCount, i2of5Modules } from './i2of5';

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

  for (const el of req.elements) {
    const fo = `^FO${el.x},${el.y}`;

    switch (el.type) {
      case 'text': {
        const fontName = el.fontName ?? '0';
        const fontSize = el.fontSize ?? 30;
        const data = fieldData(el);
        // ^FT positions the baseline (of the last line of a ^FB block): the canvas
        // top-left plus the font height, plus the lines above the last one
        const linesAbove = el.block ? (el.block.maxLines - 1) * (fontSize + el.block.lineSpacing) : 0;
        const origin = el.origin === 'FT' ? `^FT${el.x},${el.y + fontSize + linesAbove}` : fo;
        // ^FB block width follows the element width, so resizing on the canvas resizes the block
        const fb = el.block
          ? `^FB${Math.round(el.width)},${el.block.maxLines},${el.block.lineSpacing},${el.block.justify},${el.block.hangingIndent}`
          : '';

        if (el.fontSource === 'cf') {
          // Emit or reuse a ^CF context line
          const fontWidth = el.fontWidth ?? null;
          if (cfFontName !== fontName || cfFontSize !== fontSize || cfFontWidth !== fontWidth) {
            lines.push(`^CF${fontName},${fontSize}${fontWidth !== null ? `,${fontWidth}` : ''}`);
            cfFontName = fontName;
            cfFontSize = fontSize;
            cfFontWidth = fontWidth;
          }
          lines.push(`${origin}${fb}^FD${data}^FS`);
        } else {
          // Explicit ^A inline font; width defaults to the height
          lines.push(`${origin}^A${fontName}N,${fontSize},${el.fontWidth ?? fontSize}${fb}^FD${data}^FS`);
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
          `${fo}^BY${moduleWidth},${ratio}^B2${orientation},${barHeight},` +
          `${yn(el.printLine ?? true)},${yn(el.lineAbove ?? false)},${yn(checkDigit)}^FD${value}^FS`,
        );
        break;
      }
      case 'barcode128': {
        const value = fieldData(el);
        const charCount = value.length || 8;
        // Code128 total modules = 11*(chars+2 start/check) + 13 stop = 11*chars + 35
        const totalModules = 11 * charCount + 35;
        const moduleWidth = Math.max(1, Math.floor(el.width / totalModules));
        lines.push(`${fo}^BY${moduleWidth}^BCN,${el.height},Y,N,N^FD${value}^FS`);
        break;
      }
      case 'qrcode': {
        const mag = Math.max(1, Math.min(10, Math.floor(el.width / 33)));
        lines.push(`${fo}^BQN,2,${mag}^FD${el.qrErrorCorrection ?? 'M'}A,${fieldData(el)}^FS`);
        break;
      }
      case 'rect': {
        const thickness = el.filled ? Math.min(el.width, el.height) : (el.thickness ?? 8);
        const fr = el.reversed ? '^FR' : '';
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
        lines.push(`${fo}^GB${el.width},${el.height},${t}${gbExtras(el)}^FS`);
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
