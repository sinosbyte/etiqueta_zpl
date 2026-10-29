import { DesignElement, displayValue } from '../types';
import { getZplFont } from './zplFonts';
import { splitVariables } from './variables';
import { code128Width } from './code128';

// Lays text out the way the printer does, so the canvas matches the printed label.
// Font 0 metrics were measured from Labelary renders (8 dpmm); other fonts are
// approximated with the browser font.

// Font 0 character advances as a fraction of the ^A width. Positions scale
// linearly with the width (no per-character rounding).
const FONT0_ADVANCES: [number, string][] = [
  [0.2567, 'ijlíìîï'],
  [0.2750, 'IftÍÌÎÏ'],
  [0.2933, " !'(),./:;[]`"],
  [0.3317, 'r'],
  [0.3683, 'ºª'],
  [0.3867, 'z'],
  [0.4233, 's'],
  [0.4417, '?Jckvxyç'],
  [0.4600, 'aáàâãä'],
  [0.4783, '0123456789"#$*L\\eoéèêëóòôõö°§'],
  [0.4967, 'EFTZ_bdghnpqu{|}ÉÈÊËúùûüñ'],
  [0.5333, 'CSVÇ'],
  [0.5517, 'ABKPXYÁÀÂÃÄ'],
  [0.5717, 'OQÓÒÔÕÖ'],
  [0.5883, 'DGR'],
  [0.6083, '&HNUÚÙÛÜÑ'],
  [0.6633, 'w'],
  [0.7550, 'Mm'],
  [0.8100, 'W'],
  [0.9017, '%+-=@'],
  [0.9950, '<>'],
];
const FONT0_ADVANCE = new Map(FONT0_ADVANCES.flatMap(([adv, chars]) => [...chars].map(ch => [ch, adv] as const)));
const FONT0_DEFAULT_ADVANCE = 0.4783;

// Distance from the top of the character cell (^FO y) to the baseline, as a
// fraction of the ^A height. Capitals start at the top of the cell.
export const BASELINE_RATIO = 0.75;

// Canvas glyphs for font 0: a bold condensed font sized so its cap height
// (0.711 em) equals the printer's, narrowed so its letters fill the advances.
export const FONT0_GLYPH = {
  family: '"Roboto Condensed", "Arial Narrow", sans-serif',
  weight: 700,
  emPerHeight: BASELINE_RATIO / 0.711,
  scaleX: 0.93,
};

// The font 0 hyphen is a long bar, drawn as a rectangle. Fractions of the ^A
// width (from the character origin) and height (above the baseline).
export const FONT0_HYPHEN = { left: 0.17, width: 0.56, top: 0.35, height: 0.11 };

export interface FontMetrics {
  height: number;
  width: number;
  font0: boolean;
  uppercase: boolean;
}

export function fontMetrics(el: DesignElement): FontMetrics {
  const height = el.fontSize ?? 30;
  const font = getZplFont(el.fontName);
  return {
    height,
    width: el.fontWidth ?? height,
    font0: font.name === '0',
    uppercase: font.textTransform === 'uppercase',
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;

function charAdvance(ch: string, el: DesignElement, m: FontMetrics): number {
  if (m.font0) return (FONT0_ADVANCE.get(ch) ?? FONT0_DEFAULT_ADVANCE) * m.width;
  // Other fonts: browser font at 100px, scaled to the ^A width
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0.6 * m.width;
  const font = getZplFont(el.fontName);
  measureCtx.font = `${font.fontWeight} 100px ${font.cssFamily}`;
  return (measureCtx.measureText(ch).width / 100) * m.width;
}

export interface LaidOutLine {
  start: number;      // index of the first character in the text
  end: number;        // index after the last character
  x: number;          // left edge of the line inside the box
  baseline: number;   // baseline inside the box
}

export interface TextLayout {
  chars: string[];
  offsets: number[];  // x of each character from the start of the text (prefix sums)
  lines: LaidOutLine[];
  width: number;
  height: number;
  overflow: boolean;  // ^FB text needs more lines than allowed; extra lines overprint the last one
}

// Lines of a ^FB block, following the printer: \& forces a break, lines wrap
// at spaces, and a word wider than the block is split between characters.
function wrapBlock(chars: string[], offsets: number[], blockWidth: number): [number, number][] {
  const width = (a: number, b: number) => offsets[b] - offsets[a];
  const lines: [number, number][] = [];

  const paragraphs: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\\' && chars[i + 1] === '&') {
      paragraphs.push([start, i]);
      start = i + 2;
      i++;
    }
  }
  // A trailing \& does not add an empty line
  if (start < chars.length || paragraphs.length === 0) paragraphs.push([start, chars.length]);

  for (const [ps, pe] of paragraphs) {
    const before = lines.length;
    let ls = -1;
    let le = -1;
    let i = ps;
    while (i < pe) {
      if (chars[i] === ' ') { i++; continue; }
      let we = i;
      while (we < pe && chars[we] !== ' ') we++;
      const ws = i;
      i = we;

      if (ls >= 0 && width(ls, we) <= blockWidth) { le = we; continue; }
      if (ls >= 0) lines.push([ls, le]);
      ls = -1;
      if (width(ws, we) <= blockWidth) { ls = ws; le = we; continue; }

      // Word wider than the block: break between characters
      let a = ws;
      while (a < we) {
        let b = a + 1;
        while (b < we && width(a, b + 1) <= blockWidth) b++;
        if (b < we) { lines.push([a, b]); a = b; } else { ls = a; le = we; a = we; }
      }
    }
    if (ls >= 0) lines.push([ls, le]);
    if (lines.length === before) lines.push([ps, ps]);
  }
  return lines;
}

// Text layout in dots, relative to the element's top-left (x, y).
// ^FO: the top of the first line's cell is y. ^FT: the baseline of the last
// line is y + height of one line (see the parser), i.e. the box bottom.
export function layoutText(el: DesignElement, rawText: string): TextLayout {
  const m = fontMetrics(el);
  const text = m.uppercase ? rawText.toUpperCase() : rawText;
  const chars = [...text];
  const offsets = [0];
  for (const ch of chars) offsets.push(offsets[offsets.length - 1] + charAdvance(ch, el, m));
  const lineWidth = (a: number, b: number) => {
    while (b > a && chars[b - 1] === ' ') b--;
    return offsets[b] - offsets[a];
  };
  const firstBaseline = el.origin === 'FT' ? m.height : BASELINE_RATIO * m.height;

  if (!el.block) {
    return {
      chars,
      offsets,
      lines: [{ start: 0, end: chars.length, x: 0, baseline: firstBaseline }],
      width: Math.max(4, offsets[chars.length]),
      height: m.height,
      overflow: false,
    };
  }

  const { maxLines, lineSpacing, justify, hangingIndent } = el.block;
  const pitch = m.height + lineSpacing;
  const ranges = wrapBlock(chars, offsets, el.width);
  const lines = ranges.map(([start, end], i) => {
    const w = lineWidth(start, end);
    let x = justify === 'C' ? (el.width - w) / 2 : justify === 'R' ? el.width - w : 0;
    if (i > 0 && justify === 'L') x += hangingIndent;
    return { start, end, x, baseline: firstBaseline + Math.min(i, maxLines - 1) * pitch };
  });
  return {
    chars,
    offsets,
    lines,
    width: el.width,
    height: maxLines * m.height + (maxLines - 1) * lineSpacing,
    overflow: ranges.length > maxLines,
  };
}

// Text shown on the canvas, split into fixed parts and variables. With sample
// values, each {{name}} that has one is shown as its value.
export function canvasTextParts(el: DesignElement, samples?: Record<string, string> | null) {
  return splitVariables(displayValue(el) || 'Text').map(part =>
    part.variable && samples?.[part.variable] ? { text: samples[part.variable], variable: part.variable } : part
  );
}

// Size of the element on the canvas: a ^FB block has its own size; other text
// is exactly as wide as the printed text and one line high.
export function elementBox(el: DesignElement, samples?: Record<string, string> | null): { width: number; height: number } {
  if (el.type === 'barcode128') return { width: code128Width(el, samples), height: el.height };
  if (el.type !== 'text') return { width: el.width, height: el.height };
  const layout = layoutText(el, canvasTextParts(el, samples).map(p => p.text).join(''));
  return { width: Math.round(layout.width), height: Math.round(layout.height) };
}

// Resizing text that is not in a ^FB block changes the font: the height is the
// ^A height and the width stretches the ^A width.
export function resizeTextPatch(
  el: DesignElement, width: number, height: number, samples?: Record<string, string> | null,
): Partial<DesignElement> {
  const box = elementBox(el, samples);
  const { width: fontWidth } = fontMetrics(el);
  const fontSize = Math.max(8, Math.round(height));
  const newWidth = Math.max(4, Math.round(fontWidth * (width / Math.max(1, box.width))));
  return { fontSize, fontWidth: newWidth === fontSize ? undefined : newWidth };
}
