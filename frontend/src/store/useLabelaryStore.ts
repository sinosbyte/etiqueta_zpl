import { create } from 'zustand';
import { HttpError, QuotaNotice, registerQuotaHandler } from '../utils/apiClient';
import { fetchStatus } from '../utils/labelaryClient';

// What the editor knows about the preview service (Labelary): whether there is room for more pictures. It is told by the
// server (GET /api/labelary/status) when a screen that uses the service is opened, and by any answer that says the
// quota is used up. It only shows and decides what to ask for; the server is the one that counts and refuses.

export type Availability = 'unknown' | 'ok' | 'low' | 'blocked' | 'unavailable';

interface LabelaryState {
  availability: Availability;
  remaining: number | null;    // pictures left (all users together), when known
  retryAt: Date | null;        // when there may be room again, when blocked and known
  refresh(): Promise<void>;
  apply(notice: QuotaNotice): void;
}

export const useLabelaryStore = create<LabelaryState>((set) => ({
  availability: 'unknown',
  remaining: null,
  retryAt: null,

  async refresh() {
    try {
      const s = await fetchStatus();
      set({ availability: s.state, remaining: s.remaining, retryAt: s.retryAt });
    } catch (e) {
      // The state cannot be read: said as such. Any other failure (no network, signed out) leaves what was known
      if (e instanceof HttpError && e.code === 'quota-unavailable') set({ availability: 'unavailable', remaining: null, retryAt: null });
    }
  },

  apply(n) {
    if (n.code === 'quota-unavailable') set({ availability: 'unavailable', remaining: null, retryAt: null });
    else set({ availability: 'blocked', remaining: 0, retryAt: n.retryAt ?? null });
  },
}));

registerQuotaHandler(n => useLabelaryStore.getState().apply(n));

/** Whether the pictures cannot be asked for now (the time it said it would be back has not come, or it did not say). */
export function previewBlocked(s: Pick<LabelaryState, 'availability' | 'retryAt'>, now: Date = new Date()): boolean {
  if (s.availability === 'unavailable') return true;
  if (s.availability !== 'blocked') return false;
  return !s.retryAt || s.retryAt.getTime() > now.getTime();
}

/** Whether the labels next to the one being looked at may be asked for ahead of time (not when the quota is low or out). */
export function mayPrefetch(s: Pick<LabelaryState, 'availability'>): boolean {
  return s.availability === 'ok' || s.availability === 'unknown';
}
