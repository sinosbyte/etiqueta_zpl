// A minimal PDF writer: one page per picture, each page exactly the size of the label and the picture filling it
// (no margins), in the order given. No library: the file is a header, a catalog, a page tree and, for each page, a
// page, a content stream that draws the picture and the picture (an 8-bit grey image, already compressed with zlib,
// which is what PDF's FlateDecode reads). The cross-reference table has the real byte offsets.

export interface PdfImage {
  width: number;                // pixels
  height: number;
  data: Uint8Array;             // grey pixels, row after row, zlib-compressed
}

export interface PdfPage {
  widthPt: number;              // page size in points (1/72 inch)
  heightPt: number;
  image: PdfImage;
}

const MM_PER_INCH = 25.4;
/** Printer dots per millimetre: the app works at 8 (203 dpi). */
export const DOTS_PER_MM = 8;

/** The size of a label of `dots` in points: its real physical size (dots / 8 = mm, 72 points to an inch). */
export const dotsToPoints = (dots: number): number => (dots / DOTS_PER_MM / MM_PER_INCH) * 72;

const encoder = new TextEncoder();
const num = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The PDF file for these pages. Throws when there is none (a PDF needs at least one page). */
export function buildPdf(pages: PdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];       // byte offset of each object, numbered from 1
  let length = 0;
  const push = (c: Uint8Array | string) => {
    const bytes = typeof c === 'string' ? encoder.encode(c) : c;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n');
  // 1 = catalog, 2 = page tree, then three objects for each page: the page, its contents and its picture
  const pageObj = (i: number) => 3 + i * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const page = pageObj(i);
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.widthPt)} ${num(p.heightPt)}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const content = `q ${num(p.widthPt)} 0 0 ${num(p.heightPt)} 0 0 cm /Im0 Do Q`;
    object(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(page + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.image.width} /Height ${p.image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${p.image.data.length} >>\nstream\n`,
      p.image.data,
      '\nendstream',
    ]);
  });

  const count = 2 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
