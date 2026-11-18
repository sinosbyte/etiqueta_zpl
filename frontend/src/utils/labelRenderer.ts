import { CacheEntry, RenderCache, renderKey } from './renderCache';
import { RenderQueue } from './renderQueue';
import { previewBlob } from './zplClient';

// One label's rendering: the cache first, the queue otherwise. This is the only way the editor asks Labelary for a
// label picture (through the backend's /api/preview, which keeps the service's address and the timeout).

export interface RenderRequest {
  zpl: string;       // the ZPL of this one label (never the consolidated ZPL of all of them)
  width: number;     // label size in dots, as configured
  height: number;
  priority?: number;
  group?: string;
  bulk?: boolean;    // part of a mass export (the PDF)
  hold?: string;     // the room the server kept for that export
}

export class LabelRenderer {
  constructor(readonly queue: RenderQueue, readonly cache: RenderCache) {}

  /** The picture if it is already known, without any request. */
  peek(zpl: string, width: number, height: number): CacheEntry | undefined {
    return this.cache.get(renderKey(zpl, width, height));
  }

  /** The picture: from the cache when the same ZPL and size were rendered before, else rendered through the queue. */
  async render(r: RenderRequest): Promise<CacheEntry> {
    const key = renderKey(r.zpl, r.width, r.height);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const blob = await this.queue.enqueue({ key, zpl: r.zpl, width: r.width, height: r.height, priority: r.priority, group: r.group, bulk: r.bulk, hold: r.hold });
    return this.cache.get(key) ?? this.cache.set(key, blob);
  }

  /** The selected label jumps ahead of the ones waiting. */
  prioritize(zpl: string, width: number, height: number, priority: number): void {
    this.queue.prioritize(renderKey(zpl, width, height), priority);
  }

  cancel(group: string): void {
    this.queue.cancelGroup(group);
  }
}

/** The renderer of the app. */
export const labelRenderer = new LabelRenderer(
  new RenderQueue({ fetch: (zpl, w, h, signal, job) => previewBlob(zpl, w, h, signal, !!job.bulk, job.hold) }),
  new RenderCache(),
);

// The renderer in use: always the app's, except in tests, which give it a queue of their own
let current: LabelRenderer = labelRenderer;
export const activeRenderer = (): LabelRenderer => current;
export const setActiveRenderer = (r: LabelRenderer): void => { current = r; };
