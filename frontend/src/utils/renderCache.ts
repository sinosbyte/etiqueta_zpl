// Cache of the rendered labels (PNG from Labelary), in the browser's memory only: nothing is written to the server or
// to disk, and nothing outlives the page. It is bounded (entries and bytes), oldest-used first out, so a big
// simulation cannot fill the memory. An entry is reached only by the content that produced it, so a changed ZPL or
// label size can never get an old picture.

/** The density the preview is asked for (printers/8dpmm in the backend). Part of the key, so a change of it starts clean. */
export const RENDER_DPMM = 8;

/** What identifies a rendering: the density, the label size in dots and the whole ZPL. */
export const renderKey = (zpl: string, width: number, height: number): string => `${RENDER_DPMM}|${width}x${height}|${zpl}`;

export interface CacheEntry { blob: Blob; url: string; bytes: number; }

export interface RenderCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  makeUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
}

export class RenderCache {
  private map = new Map<string, CacheEntry>();
  private total = 0;
  private maxEntries: number;
  private maxBytes: number;
  private makeUrl: (blob: Blob) => string;
  private revokeUrl: (url: string) => void;

  constructor(o: RenderCacheOptions = {}) {
    this.maxEntries = o.maxEntries ?? 80;
    this.maxBytes = o.maxBytes ?? 24 * 1024 * 1024;
    this.makeUrl = o.makeUrl ?? (b => URL.createObjectURL(b));
    this.revokeUrl = o.revokeUrl ?? (u => { try { URL.revokeObjectURL(u); } catch { /* not in a browser */ } });
  }

  get size(): number { return this.map.size; }
  get bytes(): number { return this.total; }
  has(key: string): boolean { return this.map.has(key); }

  /** The entry, and it counts as just used. */
  get(key: string): CacheEntry | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, blob: Blob): CacheEntry {
    const old = this.map.get(key);
    if (old) this.drop(key, old);
    const entry: CacheEntry = { blob, url: this.makeUrl(blob), bytes: blob.size };
    this.map.set(key, entry);
    this.total += entry.bytes;
    // Oldest first out; the entry just stored always stays
    for (const [k, e] of this.map) {
      if (this.map.size <= 1 || (this.map.size <= this.maxEntries && this.total <= this.maxBytes)) break;
      if (k === key) continue;
      this.drop(k, e);
    }
    return entry;
  }

  clear(): void {
    for (const [k, e] of [...this.map]) this.drop(k, e);
  }

  private drop(key: string, entry: CacheEntry): void {
    this.map.delete(key);
    this.total -= entry.bytes;
    this.revokeUrl(entry.url);
  }
}
