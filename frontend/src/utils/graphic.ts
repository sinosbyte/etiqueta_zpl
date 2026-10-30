import { DesignElement } from '../types';

// ^GFA images: a 1-bit bitmap (1 = black dot) stored as ASCII hex with ZPL
// compression, matching backend/src/zpl/graphic.ts.

export interface Bitmap {
  width: number;   // dots
  height: number;  // dots (rows)
  bytesPerRow: number;
  bits: Uint8Array;  // bytesPerRow * height bytes, most significant bit = leftmost dot
}

// Repeat counts: G..Y = 1..19, g..z = 20..400 in steps of 20
const COUNTS: Record<string, number> = {};
for (let i = 0; i < 19; i++) COUNTS[String.fromCharCode(71 + i)] = i + 1;
for (let i = 0; i < 20; i++) COUNTS[String.fromCharCode(103 + i)] = (i + 1) * 20;

/** Decodes ^GFA data into a bitmap, or null when it is not valid ^GFA data. */
export function decodeGraphic(data: string, bytesPerRow: number): Bitmap | null {
  const rowLength = bytesPerRow * 2;
  if (rowLength <= 0) return null;
  const rows: string[] = [];
  let row = '';
  let count = 0;
  const endRow = (fill: string) => {
    rows.push(row + fill.repeat(rowLength - row.length));
    row = '';
  };
  for (const ch of data.replace(/\s+/g, '')) {
    if (COUNTS[ch] !== undefined) { count += COUNTS[ch]; continue; }
    if (/[0-9A-Fa-f]/.test(ch)) {
      row += ch.toUpperCase().repeat(Math.max(1, count));
      count = 0;
      if (row.length > rowLength) return null;
      if (row.length === rowLength) endRow('');
      continue;
    }
    if (count > 0) return null;
    if (ch === ',') { endRow('0'); continue; }
    if (ch === '!') { endRow('F'); continue; }
    if (ch === ':') {
      if (row !== '' || rows.length === 0) return null;
      rows.push(rows[rows.length - 1]);
      continue;
    }
    return null;
  }
  if (count > 0) return null;
  if (row !== '') endRow('0');

  const bits = new Uint8Array(bytesPerRow * rows.length);
  rows.forEach((hex, r) => {
    for (let b = 0; b < bytesPerRow; b++) bits[r * bytesPerRow + b] = parseInt(hex.substr(b * 2, 2), 16);
  });
  return { width: bytesPerRow * 8, height: rows.length, bytesPerRow, bits };
}

// Count letters for a run of n identical hex digits (counts add up)
function countLetters(n: number): string {
  let out = '';
  while (n >= 400) { out += 'z'; n -= 400; }
  if (n >= 20) { out += String.fromCharCode(102 + Math.floor(n / 20)); n %= 20; }
  if (n > 0) out += String.fromCharCode(70 + n);
  return out;
}

/** Encodes a bitmap as compressed ^GFA data. */
export function encodeGraphic(bitmap: Bitmap): string {
  let out = '';
  let previous = '';
  for (let r = 0; r < bitmap.height; r++) {
    let hex = '';
    for (let b = 0; b < bitmap.bytesPerRow; b++) {
      hex += bitmap.bits[r * bitmap.bytesPerRow + b].toString(16).toUpperCase().padStart(2, '0');
    }
    if (r > 0 && hex === previous) { out += ':'; continue; }
    previous = hex;
    // Trailing zeros (white) end the row with ",", trailing F (black) with "!"
    let end = '';
    const zeros = hex.match(/0+$/);
    const ones = hex.match(/F+$/);
    if (zeros) { hex = hex.slice(0, -zeros[0].length); end = ','; }
    else if (ones && ones[0].length > 1) { hex = hex.slice(0, -ones[0].length); end = '!'; }
    for (let i = 0; i < hex.length;) {
      let j = i;
      while (j < hex.length && hex[j] === hex[i]) j++;
      out += (j - i > 1 ? countLetters(j - i) : '') + hex[i];
      i = j;
    }
    out += end;
  }
  return out;
}

// Image element fields for a bitmap
export const imagePatch = (bitmap: Bitmap): Partial<DesignElement> => ({
  width: bitmap.bytesPerRow * 8,
  height: bitmap.height,
  bytesPerRow: bitmap.bytesPerRow,
  value: encodeGraphic(bitmap),
});

const blankBitmap = (width: number, height: number): Bitmap => {
  const bytesPerRow = Math.ceil(width / 8);
  return { width, height, bytesPerRow, bits: new Uint8Array(bytesPerRow * height) };
};

const setDot = (bm: Bitmap, x: number, y: number) => {
  bm.bits[y * bm.bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
};

const getDot = (bm: Bitmap, x: number, y: number): boolean =>
  (bm.bits[y * bm.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) !== 0;

// Pictures uploaded in this session, kept so that resizing redraws from the
// original instead of stretching dots. Not saved: a reopened label resizes its dots.
export interface ImageSource { image: HTMLImageElement; threshold: number }
export const imageSources = new Map<string, ImageSource>();

export const DEFAULT_THRESHOLD = 128;

/** Draws a picture at the given width in dots: darker than the threshold prints black. */
export function rasterize(source: ImageSource, width: number): Bitmap {
  const { image, threshold } = source;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(w * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';  // transparent parts print white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const bm = blankBitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luminance < threshold) setDot(bm, x, y);
    }
  }
  return bm;
}

/** Resizes an image element to a width in dots, keeping its proportions. */
export function resizeImagePatch(el: DesignElement, width: number): Partial<DesignElement> {
  const source = imageSources.get(el.id);
  if (source) return imagePatch(rasterize(source, width));
  const current = decodeGraphic(el.value ?? '', el.bytesPerRow ?? Math.ceil(el.width / 8));
  if (!current) return {};
  // No original picture: scale the dots (nearest neighbour)
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(w * current.height / current.width));
  const bm = blankBitmap(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (getDot(current, Math.floor(x * current.width / w), Math.floor(y * current.height / h))) setDot(bm, x, y);
    }
  }
  return imagePatch(bm);
}

/** Asks the user for a picture file and loads it; null when cancelled. */
export function chooseImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      loadImageFile(file).then(resolve, reject);
    };
    input.click();
  });
}

// Width in dots of a new picture: its own size, at most half the label
export const initialImageWidth = (image: HTMLImageElement, labelWidth: number, labelHeight: number): number =>
  Math.max(8, Math.round(Math.min(
    image.naturalWidth,
    labelWidth / 2,
    (labelHeight / 2) * image.naturalWidth / image.naturalHeight,
  )));

/** Loads a picture file. */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      // An SVG without width/height has no size to draw at
      image.onload = () => image.naturalWidth && image.naturalHeight
        ? resolve(image)
        : reject(new Error('This picture has no size; save it as PNG and try again'));
      image.onerror = () => reject(new Error('This file is not a picture the browser can open'));
      image.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/** PNG of the bitmap for the canvas: black dots, transparent elsewhere. */
export function bitmapToDataUrl(bm: Bitmap, ink: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = bm.width;
  canvas.height = bm.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(bm.width, bm.height);
  const [r, g, b] = ink === 'white' ? [255, 255, 255] : [0, 0, 0];
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (!getDot(bm, x, y)) continue;
      const i = (y * bm.width + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}
