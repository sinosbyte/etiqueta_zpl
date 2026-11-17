// The PDF: the file the writer makes (read back byte by byte) and the export session (order, failures, retry, validity).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { deflateSync, inflateSync } from 'zlib';
import { buildPdf, dotsToPoints, PdfPage } from '../src/utils/pdfWriter';
import { PdfExport } from '../src/utils/pdfExport';

const grey = (w: number, h: number, fill: number) => new Uint8Array(w * h).fill(fill);
const imageOf = (w: number, h: number, fill: number) => ({ width: w, height: h, data: new Uint8Array(deflateSync(Buffer.from(grey(w, h, fill)))) });
const page = (wDots: number, hDots: number, fill: number, px = [8, 12]): PdfPage =>
  ({ widthPt: dotsToPoints(wDots), heightPt: dotsToPoints(hDots), image: imageOf(px[0], px[1], fill) });

/** What a PDF reader sees: the pages (size, picture) in order, and whether the cross-reference table is right. */
function read(bytes: Uint8Array) {
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const xrefAt = text.indexOf('xref\n0 ');
  const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) (\d{5}) ([nf]) \n/g)].map(m => ({ offset: Number(m[1]), kind: m[3] }));
  const offsetsOk = entries.slice(1).every((e, i) => e.kind === 'n' && text.startsWith(`${i + 1} 0 obj\n`, e.offset));
  const pages = [...text.matchAll(/\/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => ({ w: Number(m[1]), h: Number(m[2]) }));
  const images = [...text.matchAll(/\/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g)].map(m => {
    const start = m.index! + m[0].length;
    const raw = inflateSync(buf.subarray(start, start + Number(m[3])));
    return { w: Number(m[1]), h: Number(m[2]), bytes: raw.length, first: raw[0] };
  });
  return { text, startxref, xrefAt, offsetsOk, pages, images, count: Number(/\/Type \/Pages \/Count (\d+)/.exec(text)![1]) };
}

describe('the PDF writer', () => {
  test('one label: one page of the real physical size, with its picture', () => {
    const r = read(buildPdf([page(800, 1200, 200)]));
    expect(r.text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(r.count).toBe(1);
    expect(r.pages).toEqual([{ w: 283.46, h: 425.2 }]);                              // 100 x 150 mm in points
    expect(r.images).toEqual([{ w: 8, h: 12, bytes: 96, first: 200 }]);              // the picture comes back out whole
    expect(r.offsetsOk).toBe(true);
    expect(r.startxref).toBe(r.xrefAt);
  });

  test('several labels: one page each, in the order given, the content of each in its own page', () => {
    const r = read(buildPdf([page(800, 1200, 10), page(800, 1200, 20), page(800, 1200, 30), page(800, 1200, 40)]));
    expect(r.count).toBe(4);
    expect(r.pages).toHaveLength(4);
    expect(r.images.map(i => i.first)).toEqual([10, 20, 30, 40]);
    expect(r.offsetsOk).toBe(true);
  });

  test('every page keeps the physical size of its label and the proportion, whatever the label', () => {
    const labels: [number, number][] = [[800, 1200], [800, 560], [687, 408], [400, 400], [1200, 800]];
    const r = read(buildPdf(labels.map(([w, h]) => page(w, h, 0))));
    r.pages.forEach((p, i) => {
      const [w, h] = labels[i];
      expect(p.w).toBeCloseTo((w / 8 / 25.4) * 72, 1);
      expect(p.h).toBeCloseTo((h / 8 / 25.4) * 72, 1);
      expect(p.w / p.h).toBeCloseTo(w / h, 2);
    });
  });

  test('the picture fills the page: no margin (the drawing is the page size from the corner)', () => {
    const r = read(buildPdf([page(800, 1200, 0)]));
    expect(r.text).toContain('q 283.46 0 0 425.2 0 0 cm /Im0 Do Q');
  });

  test('a label wider than a page of the same height and its picture of other pixels keep the page size from the label, not the picture', () => {
    const r = read(buildPdf([page(800, 1200, 0, [801, 1200])]));                      // the service may draw a pixel more
    expect(r.pages[0]).toEqual({ w: 283.46, h: 425.2 });
    expect(r.images[0].w).toBe(801);
  });

  test('a big one: many pages, still a valid table', () => {
    const r = read(buildPdf(Array.from({ length: 200 }, (_, i) => page(800, 1200, i % 250, [4, 4]))));
    expect(r.count).toBe(200);
    expect(r.pages).toHaveLength(200);
    expect(r.offsetsOk).toBe(true);
    expect(r.images[199].first).toBe(199);
  });

  test('without a page there is no PDF', () => {
    expect(() => buildPdf([])).toThrow();
  });

  test('points from dots: 8 dots to the millimetre, 72 points to the inch', () => {
    expect(dotsToPoints(8)).toBeCloseTo(72 / 25.4, 5);
    expect(dotsToPoints(800)).toBeCloseTo(283.4646, 3);
  });
});

describe('the export of the labels of a simulation', () => {
  const labels = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i + 1, zpl: `^XA^FD${i + 1}^FS^XZ` }));
  const entry = (zpl: string) => ({ blob: new Blob([zpl]), url: `blob:${zpl}`, bytes: zpl.length });
  // The "picture" of a label is its ZPL; encoding it gives an image whose first pixel is the label's number
  const baseEncode = async (blob: Blob) => {
    const t = await blob.text();
    return imageOf(2, 2, Number(/\^FD(\d+)/.exec(t)![1]));
  };
  const make = (n: number, opts: { fail?: number[]; valid?: () => boolean; delay?: boolean } = {}) => {
    const rendered: number[] = [];
    const deps = {
      render: jest.fn(async (r: any) => {
        const i = Number(/\^FD(\d+)/.exec(r.zpl)![1]);
        rendered.push(i);
        if (opts.fail?.includes(i)) throw new Error(`label ${i} failed`);
        return entry(r.zpl);
      }),
      cancel: jest.fn(),
      encode: jest.fn(baseEncode),
      isValid: opts.valid ?? (() => true),
    };
    return { exp: new PdfExport(labels(n), 800, 1200, deps), deps, rendered };
  };

  test('one label', async () => {
    const { exp } = make(1);
    const out = await exp.run();
    expect(out).toMatchObject({ complete: true, failed: [], invalid: false, cancelled: false });
    expect(read(exp.build()).count).toBe(1);
  });

  test('several labels: one page each, in the order of the simulation, all of them (also the one with few records)', async () => {
    const { exp } = make(5);
    const out = await exp.run();
    expect(out.complete).toBe(true);
    const r = read(exp.build());
    expect(r.count).toBe(5);
    expect(r.images.map(i => i.first)).toEqual([1, 2, 3, 4, 5]);
    expect(r.pages.every(p => p.w === 283.46 && p.h === 425.2)).toBe(true);
  });

  test('it renders the individual ZPL of each label, at the size of the label', async () => {
    const { exp, deps } = make(3);
    await exp.run();
    expect(deps.render.mock.calls.map(c => [c[0].zpl, c[0].width, c[0].height])).toEqual([
      ['^XA^FD1^FS^XZ', 800, 1200], ['^XA^FD2^FS^XZ', 800, 1200], ['^XA^FD3^FS^XZ', 800, 1200],
    ]);
  });

  test('the order is the simulation\'s even when a retry fills in a label late', async () => {
    const { exp } = make(4, { fail: [2] });
    await exp.run();
    (exp as any).deps.render = jest.fn(async (r: any) => entry(r.zpl));              // the service is back
    expect((await exp.run()).complete).toBe(true);
    expect(read(exp.build()).images.map(i => i.first)).toEqual([1, 2, 3, 4]);
  });

  test('a label that cannot be rendered is reported, the PDF is not built silently incomplete, and the others are kept', async () => {
    const { exp } = make(5, { fail: [2, 4] });
    const out = await exp.run();
    expect(out.complete).toBe(false);
    expect(out.failed.map(f => f.index)).toEqual([2, 4]);
    expect(out.failed[0].message).toMatch(/label 2 failed/);
    expect(exp.done).toBe(3);
    expect(() => exp.build()).toThrow(/2, 4/);
  });

  test('the user can choose to leave them out: then the PDF has the others, in order', async () => {
    const { exp } = make(5, { fail: [2, 4] });
    await exp.run();
    expect(read(exp.build(true)).images.map(i => i.first)).toEqual([1, 3, 5]);
  });

  test('trying again renders only the labels that are missing', async () => {
    const { exp, deps, rendered } = make(5, { fail: [3] });
    await exp.run();
    expect(rendered).toEqual([1, 2, 3, 4, 5]);
    deps.render.mockImplementation(async (r: any) => { rendered.push(Number(/\^FD(\d+)/.exec(r.zpl)![1]) + 100); return entry(r.zpl); });
    const out = await exp.run();
    expect(out.complete).toBe(true);
    expect(rendered.slice(5)).toEqual([103]);
  });

  test('progress counts the labels as they are done, up to the total', async () => {
    const { exp } = make(4);
    const seen: [number, number][] = [];
    await exp.run((d, t) => seen.push([d, t]));
    expect(seen[0]).toEqual([0, 4]);
    expect(seen[seen.length - 1]).toEqual([4, 4]);
    expect(seen.map(s => s[0])).toEqual([...seen.map(s => s[0])].sort((a, b) => a - b));
  });

  test('progress also counts a label that failed (it was dealt with)', async () => {
    const { exp } = make(3, { fail: [2] });
    const seen: number[] = [];
    await exp.run(d => seen.push(d));
    expect(seen[seen.length - 1]).toBe(3);
  });

  test('a simulation that is no longer valid stops it and builds nothing', async () => {
    let valid = true;
    const { exp, deps } = make(5, { valid: () => valid });
    deps.encode.mockImplementation(async (b: Blob) => { valid = false; return baseEncode(b); });   // it goes out of date after the first label
    const out = await exp.run();
    expect(out.invalid).toBe(true);
    expect(out.complete).toBe(false);
    expect(deps.cancel).toHaveBeenCalled();
    expect(() => exp.build()).toThrow(/out of date/);
  });

  test('an export asked for an out-of-date simulation asks for nothing at all', async () => {
    const { exp, deps } = make(3, { valid: () => false });
    const out = await exp.run();
    expect(out.invalid).toBe(true);
    expect(deps.render).not.toHaveBeenCalled();
  });

  test('cancelling stops it and cancels what was waiting in the renderer', async () => {
    const controller = new AbortController();
    const { exp, deps } = make(10);
    deps.encode.mockImplementation(async (b: Blob) => { controller.abort(); return baseEncode(b); });
    const out = await exp.run(undefined, controller.signal);
    expect(out.cancelled).toBe(true);
    expect(out.complete).toBe(false);
    expect(deps.cancel).toHaveBeenCalled();
    expect(exp.done).toBeLessThan(10);
  });

  test('a big simulation is asked for a few at a time, not all at once', async () => {
    const { exp, deps } = make(40);
    let max = 0;
    deps.encode.mockImplementation(async (b: Blob) => { max = Math.max(max, deps.render.mock.calls.length - exp.done); return baseEncode(b); });
    await exp.run();
    expect(max).toBeLessThanOrEqual(7);
    expect(exp.done).toBe(40);
  });
});
