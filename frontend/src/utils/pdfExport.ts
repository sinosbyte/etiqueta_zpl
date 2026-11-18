import { CacheEntry } from './renderCache';
import { PdfImage, PdfPage, buildPdf, dotsToPoints } from './pdfWriter';
import { Hold } from './labelaryClient';

// The export of the labels of a simulation as one PDF. Each label is rendered through the same renderer as the
// preview (so the ones already seen come from the cache and cost no request), turned into a PDF page as soon as it
// arrives, and only that small compressed page is kept: the pictures are not all held in memory. A label that
// cannot be rendered is reported, never skipped silently, and a retry renders only the ones missing.

export interface ExportLabel { index: number; zpl: string; }

export interface LabelFailure { index: number; message: string; }

export interface ExportOutcome {
  complete: boolean;                // every label has its page
  failed: LabelFailure[];
  invalid: boolean;                 // the simulation stopped being valid: nothing was built from it
  cancelled: boolean;
}

/** The server would not keep room for the export (the quota could not hold it): nothing was rendered. */
export class ExportRefused extends Error {
  constructor(message: string, readonly code: string, readonly needed: number, readonly remaining: number) {
    super(message);
    this.name = 'ExportRefused';
  }
}

export interface ExportDeps {
  render(r: { zpl: string; width: number; height: number; priority?: number; group?: string; bulk?: boolean; hold?: string }): Promise<CacheEntry>;
  cancel(group: string): void;
  encode(png: Blob): Promise<PdfImage>;
  /** Whether the simulation the labels come from is still the valid one. */
  isValid(): boolean;
  /** Whether the picture of this label is already known (it costs no request). */
  isCached?(zpl: string, width: number, height: number): boolean;
  /**
   * Keeps room for `needed` requests before any is made; refuses (ExportRefused) when the quota cannot hold the export.
   * Without it the labels are rendered as ever, each asking for room of its own.
   */
  hold?(needed: number): Promise<Hold>;
  /** Gives back what the export did not use. */
  release?(holdId: string): Promise<void>;
}

// What the server says when the quota is out or cannot be checked: the rest of the labels would be refused for the same
// reason, so they are not asked for (they are reported as not rendered, never skipped silently)
const QUOTA_STOP: ReadonlySet<string> = new Set(['quota-internal', 'quota-external', 'quota-unavailable']);

/** How many labels are asked for ahead of the one being turned into a page. */
const WINDOW = 6;
let groupSeq = 0;

export class PdfExport {
  private pages = new Map<number, PdfPage>();
  private failures = new Map<number, string>();
  private group = `pdf-${++groupSeq}`;

  constructor(
    private labels: ExportLabel[],
    private width: number,            // label size in dots
    private height: number,
    private deps: ExportDeps,
  ) {}

  get total(): number { return this.labels.length; }
  /** Labels with a page already. */
  get done(): number { return this.pages.size; }
  get failed(): LabelFailure[] { return [...this.failures].map(([index, message]) => ({ index, message })); }

  /** Renders the labels that have no page yet (all of them the first time, only the failed ones on a retry). */
  async run(onProgress: (done: number, total: number) => void = () => undefined, signal?: AbortSignal): Promise<ExportOutcome> {
    const todo = this.labels.filter(l => !this.pages.has(l.index));
    this.failures.clear();
    onProgress(this.done, this.total);
    const onAbort = () => this.deps.cancel(this.group);
    signal?.addEventListener('abort', onAbort);
    let invalid = false;
    let hold: Hold | undefined;
    try {
      // Before anything is rendered: room for the labels that are not in the cache (those cost no request). An export
      // the quota cannot hold is not started, instead of being stopped halfway by the limit
      const needed = todo.filter(l => !this.deps.isCached?.(l.zpl, this.width, this.height)).length;
      if (needed > 0 && this.deps.hold) hold = await this.deps.hold(needed);
      if (signal?.aborted) return { complete: false, failed: [], invalid: false, cancelled: true };
      const inFlight = new Map<number, Promise<CacheEntry>>();
      const ask = (label: ExportLabel) => {
        if (!inFlight.has(label.index)) {
          const p = this.deps.render({ zpl: label.zpl, width: this.width, height: this.height, priority: 0, group: this.group, bulk: true, hold: hold?.holdId });
          p.catch(() => undefined);   // handled where it is awaited
          inFlight.set(label.index, p);
        }
      };
      for (let i = 0; i < todo.length; i++) {
        if (signal?.aborted) break;
        if (!this.deps.isValid()) { invalid = true; this.deps.cancel(this.group); break; }
        for (let k = i; k < Math.min(todo.length, i + WINDOW); k++) ask(todo[k]);
        const label = todo[i];
        try {
          const entry = await inFlight.get(label.index)!;
          if (signal?.aborted) break;
          const image = await this.deps.encode(entry.blob);
          this.pages.set(label.index, { widthPt: dotsToPoints(this.width), heightPt: dotsToPoints(this.height), image });
        } catch (e) {
          if (signal?.aborted) break;
          const message = e instanceof Error ? e.message : String(e);
          this.failures.set(label.index, message);
          const code = (e as { code?: unknown } | null)?.code;
          if (typeof code === 'string' && QUOTA_STOP.has(code)) {
            for (let k = i + 1; k < todo.length; k++) this.failures.set(todo[k].index, message);
            this.deps.cancel(this.group);
            onProgress(this.done + this.failures.size, this.total);
            break;
          }
        } finally {
          inFlight.delete(label.index);
        }
        onProgress(this.done + this.failures.size, this.total);
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      // Done, cancelled, failed or invalid: what was kept and not used goes back to everybody
      if (hold && this.deps.release) await this.deps.release(hold.holdId);
    }
    const cancelled = !!signal?.aborted;
    return { complete: !cancelled && !invalid && this.failures.size === 0 && this.done === this.total, failed: this.failed, invalid, cancelled };
  }

  /**
   * The PDF, in the order of the labels. With a label missing it refuses unless `allowPartial` is set, which is the
   * user's explicit choice to leave those out. It also refuses when the simulation is no longer valid.
   */
  build(allowPartial = false): Uint8Array {
    if (!this.deps.isValid()) throw new Error('The simulation is out of date');
    const missing = this.labels.filter(l => !this.pages.has(l.index));
    if (missing.length > 0 && !allowPartial) throw new Error(`Labels not rendered: ${missing.map(l => l.index).join(', ')}`);
    const ordered = this.labels.filter(l => this.pages.has(l.index)).map(l => this.pages.get(l.index)!);
    return buildPdf(ordered);
  }
}

/** The picture as a PDF image: grey 8-bit (the labels are black on white), zlib-compressed. Runs in the browser. */
export async function encodePng(blob: Blob): Promise<PdfImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No canvas');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const grey = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < grey.length; i++) {
      grey[i] = Math.round(rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114);
    }
    return { width: canvas.width, height: canvas.height, data: await deflate(grey) };
  } finally {
    bitmap.close();
  }
}

/** zlib (what PDF's FlateDecode expects), with the browser's own compressor. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Hands the file to the browser as a download. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
