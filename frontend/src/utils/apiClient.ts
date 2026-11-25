import { API_BASE, getToken, triggerOn401, refreshAccessToken } from './authClient';
import { apiMessage, t, useLangStore } from '../i18n';
import { parseRetryAt, whenText } from './quotaText';

/**
 * An error answer of the API: still an Error with the same message, plus what a caller needs to decide to retry.
 * The answers about the Labelary quota also carry `code` (why it was refused), `retryAt` (when there may be room again)
 * and `remaining` (what is left of the quota).
 */
export class HttpError extends Error {
  constructor(
    message: string, readonly status: number, readonly retryAfterMs?: number,
    readonly code?: string, readonly retryAt?: Date, readonly remaining?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Why the quota of the preview service said no: what the editor must not try again, and what it should show. */
export const QUOTA_CODES: ReadonlySet<string> = new Set(['quota-internal', 'quota-external', 'quota-unavailable']);

// Told whenever an answer says the preview service is out of quota or cannot be checked, so the editor shows it
// wherever the user is (the store of the quota registers itself here; the client does not import it)
export interface QuotaNotice { code: string; retryAt?: Date; remaining?: number }
let onQuota: ((n: QuotaNotice) => void) | null = null;
export function registerQuotaHandler(handler: (n: QuotaNotice) => void) {
  onQuota = handler;
}

// Told when the server refuses a call because a temporary password must be changed first (the account store shows the change)
let onPasswordChange: (() => void) | null = null;
export function registerPasswordChangeHandler(handler: () => void) {
  onPasswordChange = handler;
}

/** The error of a failed answer: the text in the language on screen (with the time it is back, when it is known) and why. */
function failure(res: Response, data: any, fallback: string): HttpError {
  const seconds = Number(res.headers.get('Retry-After'));
  const retryAt = parseRetryAt(data?.retryAt);
  const code: string | undefined = typeof data?.code === 'string' ? data.code : undefined;
  const remaining = typeof data?.remaining === 'number' ? data.remaining : undefined;
  let message = apiMessage(data?.error, fallback as any);
  if (res.status === 403 && data?.error === 'Password change required') onPasswordChange?.();
  // When the room for exports is all taken it says when there may be some again (it is not the quota being out)
  if (code === 'hold-capacity' && retryAt) message += ` ${t('quota.availableAt', { when: whenText(retryAt, useLangStore.getState().lang) })}`;
  if (code && QUOTA_CODES.has(code)) {
    if (retryAt) message += ` ${t('quota.availableAt', { when: whenText(retryAt, useLangStore.getState().lang) })}`;
    // Room kept for an export that did not fit says the same code but the quota is not out (there is still some left)
    if (!(remaining !== undefined && remaining > 0)) onQuota?.({ code, retryAt, remaining });
  }
  // Retry-After is in seconds (or a date; only the seconds form is used)
  return new HttpError(message, res.status, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined, code, retryAt, remaining);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetch JSON from an API endpoint, with JWT auth attached.
 * On 401 it attempts a single silent token refresh and retries once; if that
 * fails it triggers auto-logout. Also handles 204 no-content and JSON errors.
 */
export async function apiFetch<T>(path: string, opts?: RequestInit, _retry = false): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers ?? {}) },
  });
  if (res.status === 401) {
    if (!_retry && (await refreshAccessToken())) {
      return apiFetch<T>(path, opts, true);
    }
    triggerOn401();
    throw new Error(t('api.sessionExpired'));
  }
  if (res.status === 204) {
    if (!res.ok) throw new Error(t('api.requestFailed'));
    return undefined as T;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw failure(res, data, 'api.requestFailed');
  return data as T;
}

/**
 * Fetch a binary response (image, PDF, etc.), with JWT auth attached.
 * On 401 it attempts a single silent token refresh and retries once, then
 * falls back to auto-logout.
 */
export async function apiFetchBlob(path: string, opts?: RequestInit, _retry = false): Promise<Blob> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders(), ...(opts?.headers ?? {}) },
  });
  if (res.status === 401) {
    if (!_retry && (await refreshAccessToken())) {
      return apiFetchBlob(path, opts, true);
    }
    triggerOn401();
    throw new Error(t('api.sessionExpired'));
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `${t('api.requestFailed')} (${res.status})` }));
    throw failure(res, err, 'api.requestFailed');
  }
  return res.blob();
}
