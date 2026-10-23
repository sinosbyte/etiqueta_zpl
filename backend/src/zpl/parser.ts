import { Element, ParseResult } from './types';

// A field whose entire data is {{name}} is a dynamic placeholder.
const DYNAMIC_RE = /^\{\{([A-Za-z0-9_]+)\}\}$/;

// QR field data prefix the editor can represent: error correction level +
// automatic input mode, e.g. "MA,https://...". Other prefixes (manual mode,
// e.g. "MM,A...") are kept verbatim as raw ZPL.
const QR_PREFIX_RE = /^([HQML])A,/;

// Commands that belong to a field (from its first command up to ^FS).
// Barcode commands (^B0..^BZ except ^BY) are field commands as well.
const FIELD_COMMANDS = new Set(['FO', 'FT', 'A', 'FD', 'FB', 'FH', 'FR', 'FN', 'FP', 'SN', 'SF', 'GB', 'TB', 'FV']);

// Field commands the canvas can represent. A field using any other command
// (e.g. ^FT, ^FB, ^FH, ^B2) is kept verbatim as a 'raw' element so that
// regenerating ZPL from the canvas never drops it.
const EDITABLE_FIELD_COMMANDS = new Set(['FO', 'A', 'FD', 'FR', 'BY', 'BC', 'BQ', 'GB', 'FS']);

const isFieldCommand = (cmd: string): boolean =>
  FIELD_COMMANDS.has(cmd) || (cmd.startsWith('B') && cmd !== 'BY');

let counter = 0;
function nextId(): string {
  counter += 1;
  return `parsed-${counter}`;
}

// Split ZPL into command tokens. Each token starts with ^ or ~ and runs
// until the next ^ / ~ or end-of-string.
function tokenize(zpl: string): string[] {
  const tokens: string[] = [];
  const raw = zpl.replace(/\r\n|\r/g, '\n');
  // Split on ^ or ~ keeping the delimiter
  const parts = raw.split(/(?=\^|~)/);
  for (const p of parts) {
    const t = p.trim();
    if (t.startsWith('^') || t.startsWith('~')) tokens.push(t);
  }
  return tokens;
}

// Parse a comma-separated parameter list from the tail of a command token.
// e.g. "BCN,100,Y,N,N" → ["N","100","Y","N","N"]
function params(tail: string): string[] {
  return tail.split(',');
}

// Determine whether a ^GB is a line, rect, or solid-filled rect.
// Priority order:
//   1. w==t AND h==t         → filled solid rect (e.g. ^GB100,100,100)
//   2. w==t OR  h==t         → line (one thin dimension, e.g. ^GB700,3,3)
//   3. t >= min(w, h)        → filled rect (nearly solid)
//   4. otherwise             → rect (border)
function gbType(w: number, h: number, t: number): 'rect' | 'line' {
  if (w === t && h === t) return 'rect';
  if (w === t || h === t) return 'line';
  if (t >= Math.min(w, h)) return 'rect';
  return 'rect';
}

const isYes = (v: string | undefined): boolean => (v ?? '').trim().toUpperCase() === 'Y';

export function parseZpl(zpl: string): ParseResult {
  counter = 0;

  let labelWidth = 0;
  let labelHeight = 0;
  const elements: Element[] = [];
  const unknownCommands: string[] = [];

  // Stateful defaults that persist across fields (reset per label)
  let defaultFontName = '0';
  let defaultFontHeight = 30;
  let defaultFontWidth = 0;   // 0 = proportional

  // ^BY defaults for barcodes
  let byModuleWidth = 2;
  let byHeight = 10;

  // Field-level state — reset after every ^FS
  let fieldX = 0;
  let fieldY = 0;
  let fieldReversed = false;
  let fieldFontName = '';
  let fieldFontHeight = 0;
  let fieldFontWidth = 0;
  let fieldData = '';
  let fieldHasFont = false;
  // Pending barcode command (set between ^FO and ^FD)
  type PendingBarcode = { kind: 'bc128'; orientation: string; height: number; printLine: boolean } |
                        { kind: 'bqr';   orientation: string; model: number; mag: number };
  let pendingBarcode: PendingBarcode | null = null;

  // Tokens of the field being read and whether the canvas can represent it
  let fieldTokens: string[] = [];
  let fieldEditable = true;

  function resetField() {
    fieldReversed = false;
    fieldFontName = '';
    fieldFontHeight = 0;
    fieldFontWidth = 0;
    fieldData = '';
    fieldHasFont = false;
    pendingBarcode = null;
    fieldTokens = [];
    fieldEditable = true;
  }

  function pushRaw(value: string) {
    elements.push({ id: nextId(), type: 'raw', x: 0, y: 0, width: 0, height: 0, value });
  }

  // A field left open (no ^FS before ^XZ / end of input) is kept verbatim
  function flushOpenField() {
    if (fieldTokens.length > 0) pushRaw(fieldTokens.join(''));
    resetField();
  }

  const tokens = tokenize(zpl);

  for (const token of tokens) {
    // Extract command name (letters after ^) and the rest
    // ZPL commands are 1–2 uppercase letters; stop there so data (e.g. "Hello", "N,100") stays in tail
    const cmdMatch = token.match(/^\^([A-Z]{1,2})([\s\S]*)/);

    // ~ commands (e.g. ~SD15, ~JSN) and anything unrecognisable are kept verbatim
    if (!cmdMatch) {
      unknownCommands.push(token);
      if (fieldTokens.length > 0) {
        fieldTokens.push(token);
        fieldEditable = false;
      } else {
        pushRaw(token);
      }
      continue;
    }

    let cmd = cmdMatch[1];
    let tail = cmdMatch[2].replace(/^\s*,?/, '');  // strip leading comma/space

    // ^A is special: the font letter is the FIRST character of the parameter, not part of
    // the command name. The tokenizer grabs 2 letters, so ^ABN,34,34 becomes cmd="AB"
    // tail="N,34,34" instead of cmd="A" tail="BN,34,34". Re-normalise here.
    if (cmd.length === 2 && cmd[0] === 'A' && /[0-9A-Z]/.test(cmd[1])) {
      tail = cmd[1] + tail;
      cmd = 'A';
    }

    // ── Comment — preserved as a comment element wherever it appears ──────
    if (cmd === 'FX') {
      elements.push({
        id: nextId(),
        type: 'comment',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        value: tail,
      });
      continue;
    }

    // ── Label start / end ───────────────────────────────────────────────────
    if (cmd === 'XA' || cmd === 'XZ') {
      flushOpenField();
      continue;
    }

    // ── Field commands ──────────────────────────────────────────────────────
    if (fieldTokens.length > 0 || isFieldCommand(cmd)) {
      fieldTokens.push(token);
      if (!EDITABLE_FIELD_COMMANDS.has(cmd)) {
        fieldEditable = false;
        unknownCommands.push(token);
      }

      switch (cmd) {
        // Field origin (^FO x, y, alignment)
        case 'FO': {
          const p = params(tail);
          fieldX = parseInt(p[0], 10) || 0;
          fieldY = parseInt(p[1], 10) || 0;
          break;
        }

        // Field reverse print
        case 'FR':
          fieldReversed = true;
          break;

        // Field font (^A fontName+orientation, height, width)
        case 'A': {
          const p = params(tail);
          const fontRaw = p[0] ?? '';
          // Only normal orientation can be drawn on the canvas
          const orientation = /[NRIB]$/.test(fontRaw) && fontRaw.length > 1 ? fontRaw.slice(-1) : 'N';
          if (orientation !== 'N') fieldEditable = false;
          // Strip trailing orientation letter (N/R/I/B) if present
          const fontName = fontRaw.length > 1 ? fontRaw.replace(/[NRIB]$/, '') : (fontRaw || defaultFontName);
          fieldFontName = fontName;
          fieldFontHeight = parseInt(p[1], 10) || defaultFontHeight;
          fieldFontWidth = parseInt(p[2], 10) || defaultFontWidth;
          fieldHasFont = true;
          break;
        }

        // Barcode defaults inside the field (^BY moduleWidth, widthRatio, height)
        case 'BY': {
          const p = params(tail);
          byModuleWidth = parseInt(p[0], 10) || byModuleWidth;
          if (p[2] !== undefined && p[2] !== '') byHeight = parseInt(p[2], 10) || byHeight;
          break;
        }

        // Code 128 barcode (^BC orientation, height, line, lineAbove, checkDigit, mode)
        case 'BC': {
          const p = params(tail);
          const orientation = (p[0] ?? '').trim() || 'N';
          // height defaults to ^BY height if omitted
          const height = (p[1] !== undefined && p[1] !== '') ? parseInt(p[1], 10) : byHeight;
          const printLine = (p[2] ?? 'Y').trim().toUpperCase() !== 'N';
          const mode = (p[5] ?? '').trim().toUpperCase();
          // The generator always emits ^BCN,h,Y,N,N — anything else stays raw
          if (orientation !== 'N' || !printLine || isYes(p[3]) || isYes(p[4]) || (mode !== '' && mode !== 'N')) {
            fieldEditable = false;
          }
          pendingBarcode = { kind: 'bc128', orientation, height, printLine };
          break;
        }

        // QR code (^BQ orientation, model, magnification, ...)
        case 'BQ': {
          const p = params(tail);
          const orientation = (p[0] ?? '').trim() || 'N';
          const model = parseInt(p[1], 10) || 2;
          const mag = parseInt(p[2], 10) || 2;
          if (model !== 2) fieldEditable = false;
          pendingBarcode = { kind: 'bqr', orientation, model, mag };
          break;
        }

        // Field data (^FD data)
        case 'FD':
          fieldData = tail;
          break;

        // Graphic box (^GB width, height, thickness, color, rounding)
        case 'GB': {
          if (!fieldEditable) break;  // emitted as raw at ^FS
          const p = params(tail);
          const w = parseInt(p[0], 10) || 1;
          const h = parseInt(p[1], 10) || 1;
          const t = parseInt(p[2], 10) || 1;
          const color = (p[3] ?? '').trim().toUpperCase();
          const rounding = Math.min(8, Math.max(0, parseInt(p[4], 10) || 0));
          const type = gbType(w, h, t);
          const isFilled = type === 'rect' && t >= Math.min(w, h);
          elements.push({
            id: nextId(),
            type,
            x: fieldX,
            y: fieldY,
            width: w,
            height: h,
            ...(isFilled ? { filled: true } : { thickness: t }),
            ...(color === 'W' ? { color: 'W' as const } : {}),
            ...(rounding > 0 ? { rounding } : {}),
            ...(fieldReversed ? { reversed: true } : {}),
          });
          // The box is complete; its trailing ^FS is a no-op
          resetField();
          break;
        }

        // Field separator — emit the pending text or barcode element
        case 'FS': {
          // QR data must start with a prefix the canvas can represent
          let qrErrorCorrection: 'H' | 'Q' | 'M' | 'L' | undefined;
          if (fieldEditable && pendingBarcode?.kind === 'bqr') {
            const qrMatch = fieldData.match(QR_PREFIX_RE);
            if (qrMatch) {
              qrErrorCorrection = qrMatch[1] as 'H' | 'Q' | 'M' | 'L';
              fieldData = fieldData.slice(qrMatch[0].length);
            } else {
              fieldEditable = false;
            }
          }

          if (!fieldEditable) {
            pushRaw(fieldTokens.join(''));
            resetField();
            break;
          }

          const dynMatch = fieldData.match(DYNAMIC_RE);
          const dyn = dynMatch ? { dynamic: true, variableName: dynMatch[1] } : {};
          if (pendingBarcode) {
            if (pendingBarcode.kind === 'bc128') {
              elements.push({
                id: nextId(),
                type: 'barcode128',
                x: fieldX,
                y: fieldY,
                width: byModuleWidth * (11 * (fieldData.length || 8) + 35),
                height: pendingBarcode.height,
                value: fieldData,
                ...dyn,
                ...(fieldReversed ? { reversed: true } : {}),
              });
            } else {
              // QR size: use same constant as generator (width / 33) so round-trip is stable
              const size = pendingBarcode.mag * 33;
              elements.push({
                id: nextId(),
                type: 'qrcode',
                x: fieldX,
                y: fieldY,
                width: size,
                height: size,
                value: fieldData,
                ...(qrErrorCorrection && qrErrorCorrection !== 'M' ? { qrErrorCorrection } : {}),
                ...dyn,
                ...(fieldReversed ? { reversed: true } : {}),
              });
            }
          } else if (fieldData !== '') {
            // Text element — use field font if set, else default font
            const fontName = fieldHasFont ? fieldFontName : defaultFontName;
            const fontSize = fieldHasFont ? fieldFontHeight : defaultFontHeight;
            const fontWidth = fieldHasFont ? fieldFontWidth : defaultFontWidth;
            const PROPORTIONAL_FONTS = new Set(['0', 'A', 'B', 'D', 'G', 'P']);
            const charWidth = PROPORTIONAL_FONTS.has(fontName) ? 0.75 : 0.65;
            const effectiveWidth = fontWidth > 0 ? fontWidth : fontSize;
            elements.push({
              id: nextId(),
              type: 'text',
              x: fieldX,
              y: fieldY,
              width: Math.max(200, Math.round(effectiveWidth * charWidth * fieldData.length)),
              height: fontSize + 10,
              value: fieldData,
              fontSize,
              ...(fontWidth > 0 && fontWidth !== fontSize ? { fontWidth } : {}),
              fontName,
              fontSource: fieldHasFont ? 'a' : 'cf',
              ...dyn,
              ...(fieldReversed ? { reversed: true } : {}),
            });
          }
          resetField();
          break;
        }

        default:
          // ^FT, ^FB, ^FH, ^FN, ^B2... — nothing to read; the field is kept raw
          break;
      }
      continue;
    }

    // ── Label-level commands ────────────────────────────────────────────────
    switch (cmd) {
      // Label dimensions
      case 'PW':
        labelWidth = parseInt(tail, 10) || labelWidth;
        break;

      case 'LL': {
        const p = params(tail);
        labelHeight = parseInt(p[0], 10) || labelHeight;
        break;
      }

      // Default font (^CF fontName, height, width)
      case 'CF': {
        const p = params(tail);
        if (p[0] !== undefined && p[0] !== '') defaultFontName = p[0];
        if (p[1] !== undefined && p[1] !== '') defaultFontHeight = parseInt(p[1], 10) || defaultFontHeight;
        if (p[2] !== undefined && p[2] !== '') defaultFontWidth = parseInt(p[2], 10) || 0;
        break;
      }

      // Barcode defaults (^BY moduleWidth, widthRatio, height). Kept verbatim
      // too, since barcodes preserved as raw ZPL depend on it.
      case 'BY': {
        const p = params(tail);
        byModuleWidth = parseInt(p[0], 10) || byModuleWidth;
        // p[1] is widthRatio — not used for canvas sizing
        if (p[2] !== undefined && p[2] !== '') byHeight = parseInt(p[2], 10) || byHeight;
        pushRaw(token);
        break;
      }

      // Stray field separator — nothing open to close
      case 'FS':
        break;

      // ^CI, ^LH, ^MM, ^LS, ^PQ, ^PR... — not drawable, kept verbatim
      default:
        unknownCommands.push(token);
        pushRaw(token);
        break;
    }
  }

  flushOpenField();

  return { labelWidth, labelHeight, elements, unknownCommands };
}
