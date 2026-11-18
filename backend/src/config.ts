/**
 * Central configuration + env-var resolution.
 *
 * A single source of truth for the JWT secret and environment mode so that
 * auth signing and verification can never drift apart, and so that
 * dev-only conveniences (permissive CORS, verbose errors) are gated on
 * NODE_ENV in exactly one place.
 */
import { readLabelaryLimits } from './labelaryConfig';

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const isProduction = NODE_ENV === 'production';
export const isTest = NODE_ENV === 'test';

/**
 * The JWT signing/verification secret. In production a missing secret is a
 * hard error (see index.ts, which validates at boot). Outside production we
 * fall back to a well-known dev value so local dev and tests work without
 * extra setup.
 */
export const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction) {
    // Should never reach here: index.ts refuses to boot without it in prod.
    throw new Error('JWT_SECRET env var is required in production');
  }
  return 'dev-secret';
})();

/** JWTs are signed and verified with HS256 only (pin the algorithm). */
export const JWT_ALGORITHM = 'HS256' as const;

/** Access-token lifetime. Short-lived; renewed silently via the refresh token. */
export const JWT_EXPIRES_IN = '60m' as const;

/** Refresh-token lifetime (ms). Long-lived, opaque, stored hashed in the DB. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Name of the httpOnly cookie carrying the opaque refresh token. */
export const REFRESH_COOKIE_NAME = 'zpl_refresh';

/**
 * Cookie options for the refresh token. httpOnly keeps it out of JS (XSS-safe),
 * sameSite=lax blocks cross-site CSRF while allowing same-site XHR, and the path
 * scopes it so it's only ever sent to the auth endpoints that need it.
 */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_TTL_MS,
} as const;

/** Allowed CORS origin for the frontend. */
export const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

/** Max accepted JSON request body size. Caps ZPL payloads sent for preview/export. */
export const MAX_BODY_SIZE = '512kb';

/** Upper bound on a single ZPL string field (characters). */
export const MAX_ZPL_LENGTH = 100_000;

const envNumber = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Timeout (ms) for outbound requests to the Labelary API. */
export const LABELARY_TIMEOUT_MS = envNumber('LABELARY_TIMEOUT_MS', 10_000);

/** Base URL of the Labelary rendering API (HTTPS). Overridable for tests and for the private host of a paid plan. */
export const LABELARY_BASE_URL = process.env.LABELARY_BASE_URL || 'https://api.labelary.com/v1/printers/8dpmm/labels';

// The gate in front of Labelary (see labelary/gate.ts). The public service allows 3 requests a second and 5,000 a day
// from one address, and every user of this server shares that address, so the server paces itself below it.
const positive = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Requests a second the server starts at the service, for all users together. */
export const LABELARY_RATE_PER_SECOND = positive('LABELARY_RATE_PER_SECOND', 2);

/** Requests to the service in flight at once. */
export const LABELARY_CONCURRENCY = positive('LABELARY_CONCURRENCY', 2);

/** Longest (ms) a request waits in the queue before it is turned away as busy. */
export const LABELARY_QUEUE_MAX_WAIT_MS = positive('LABELARY_QUEUE_MAX_WAIT_MS', 30_000);

/** Requests one user may have waiting, and all users together. */
export const LABELARY_MAX_QUEUED_PER_USER = positive('LABELARY_MAX_QUEUED_PER_USER', 100);
export const LABELARY_MAX_QUEUED = positive('LABELARY_MAX_QUEUED', 1000);

// The use of the service over time (see labelary/quota.ts). The public service allows 5,000 requests a day; the server
// stops at 4,000 (80%) in any window of 24 hours. The 20% left covers what the service does not document: whether a
// refused request counts, and whether the quota is per address (another program on the same address would share it).
// The limits of the service may change, so this is read from the environment.

// Checked when the application starts (see labelaryConfig.ts): a value that is set and wrong stops it, with a message.
const LABELARY_LIMITS = readLabelaryLimits(process.env);

/** Requests the server may send to the service in any 24 hours, all users together (1 to 5,000; default 4,000). */
export const LABELARY_DAILY_LIMIT = LABELARY_LIMITS.dailyLimit;

/** At or below this many requests left the state is 'low' (0 to the limit; 10% of the limit unless set). */
export const LABELARY_LOW_THRESHOLD = LABELARY_LIMITS.lowThreshold;

/** Requests that may be held at once for mass exports, all users together: min(1,200, the daily limit). Fixed: no variable sets it. */
export const LABELARY_HOLD_LIMIT = LABELARY_LIMITS.holdLimit;

/** Requests one user may hold for an export (600, and never more than the whole limit of holds). */
export const LABELARY_HOLD_MAX_PER_USER = LABELARY_LIMITS.holdMaxPerUser;

/** How long (ms) room kept for an export is held without being used before it is given back. */
export const LABELARY_HOLD_TTL_MS = positive('LABELARY_HOLD_TTL_MS', 30 * 60 * 1000);

/** A 429 that asks to wait at least this long (ms) is the daily quota; a shorter one is only the pace (see labelary/retryAfter.ts). */
export const LABELARY_DAILY_RETRY_AFTER_MS = positive('LABELARY_DAILY_RETRY_AFTER_MS', 60_000);

/** The longest a block from the service's own answer is believed (ms): the quota is daily. */
export const LABELARY_EXTERNAL_BLOCK_MAX_MS = 24 * 60 * 60 * 1000;
