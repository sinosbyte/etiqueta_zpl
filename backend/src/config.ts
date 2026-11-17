/**
 * Central configuration + env-var resolution.
 *
 * A single source of truth for the JWT secret and environment mode so that
 * auth signing and verification can never drift apart, and so that
 * dev-only conveniences (permissive CORS, verbose errors) are gated on
 * NODE_ENV in exactly one place.
 */

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

/** Timeout (ms) for outbound requests to the Labelary API. */
export const LABELARY_TIMEOUT_MS = 10_000;

/** Base URL of the Labelary rendering API (HTTPS). */
export const LABELARY_BASE_URL = 'https://api.labelary.com/v1/printers/8dpmm/labels';

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
