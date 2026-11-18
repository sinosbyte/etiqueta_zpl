import { apiFetch, HttpError, QUOTA_CODES } from './apiClient';
import { parseRetryAt } from './quotaText';

// What the editor asks the server about the use of the preview service (Labelary): how much is left, and room kept for a
// mass export. The server is the only one that counts; nothing here writes the counter.

export type QuotaState = 'ok' | 'low' | 'blocked';

export interface LabelaryStatus {
  state: QuotaState;
  remaining: number;
  retryAt: Date | null;     // when there may be room again (set when blocked)
}

/** Why the server would not keep room for an export, besides the quota itself: one of the user is in use, or all the room for exports is taken. */
const HOLD_REFUSALS: ReadonlySet<string> = new Set(['hold-active', 'hold-capacity', 'hold-too-large']);

export async function fetchStatus(): Promise<LabelaryStatus> {
  const r = await apiFetch<{ state: QuotaState; remaining: number; retryAt: string | null }>('/api/labelary/status');
  return { state: r.state, remaining: r.remaining, retryAt: parseRetryAt(r.retryAt) ?? null };
}

/** The server would not keep room for the export: why, what is left, and when there may be room again. */
export class HoldDenied extends Error {
  constructor(message: string, readonly code: string, readonly remaining: number, readonly retryAt?: Date) {
    super(message);
    this.name = 'HoldDenied';
  }
}

export interface Hold { holdId: string; slots: number }

// The room this tab has kept and not (yet) given back, so that an export that could not give it back (no network at the end)
// does not keep the user from the next one for the half hour the server waits before giving it back itself
let lastHold: string | null = null;

/** A try of one of the labels may need to be sent again; room is kept for a few of those too (10%, between 2 and 50). */
export const retryAllowance = (needed: number): number => Math.min(50, Math.max(2, Math.ceil(needed * 0.1)));

async function createHold(count: number): Promise<Hold> {
  try {
    const r = await apiFetch<{ holdId: string; slots: number }>('/api/labelary/holds', { method: 'POST', body: JSON.stringify({ count }) });
    lastHold = r.holdId;
    return { holdId: r.holdId, slots: r.slots };
  } catch (e) {
    if (e instanceof HttpError && e.code && (QUOTA_CODES.has(e.code) || HOLD_REFUSALS.has(e.code))) throw new HoldDenied(e.message, e.code, e.remaining ?? 0, e.retryAt);
    throw e;
  }
}

/**
 * Room for a mass export before it starts, as a whole or not at all: the labels it will render and a few extra for tries
 * that have to be repeated. If there is room for the labels but not for the extra, it keeps just the labels. When there
 * is not room for the labels the export is not started (HoldDenied), instead of being stopped halfway by the limit.
 */
export async function holdForExport(needed: number): Promise<Hold> {
  const want = needed + retryAllowance(needed);
  try {
    return await createHold(want);
  } catch (e) {
    if (e instanceof HoldDenied && e.code === 'quota-internal' && e.remaining >= needed) return createHold(needed);
    // The user already has an export holding room. If it is one of THIS tab that could not give it back, it is given back
    // now and the request is made again, once; if it is another export (another tab), this one is refused and the other goes on
    if (e instanceof HoldDenied && e.code === 'hold-active' && lastHold) {
      const mine = lastHold;
      await releaseHold(mine);
      if (lastHold === mine) lastHold = null;
      return createHold(want).catch(second => {
        if (second instanceof HoldDenied && second.code === 'quota-internal' && second.remaining >= needed) return createHold(needed);
        throw second;
      });
    }
    throw e;
  }
}

/** Gives back the room an export did not use. A failure is not an error: the hold expires by itself. */
export async function releaseHold(holdId: string): Promise<void> {
  try {
    await apiFetch(`/api/labelary/holds/${holdId}`, { method: 'DELETE' });
    if (lastHold === holdId) lastHold = null;
  } catch { /* the server gives it back when it expires; this tab remembers it and gives it back before its next export */ }
}

/** For the tests: forget the room this tab remembered. */
export const forgetHoldForTests = (): void => { lastHold = null; };
