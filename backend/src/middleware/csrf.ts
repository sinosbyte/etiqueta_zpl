import { Request, Response, NextFunction } from 'express';
import { FRONTEND_URL, isProduction } from '../config';

/** The origins the app answers to: the frontend's address (and, in development, any localhost port). Shared with CORS. */
export function isAllowedOrigin(origin: string): boolean {
  return origin === FRONTEND_URL || (!isProduction && origin.startsWith('http://localhost:'));
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The origin a browser says the request came from: the Origin header, or the origin of the Referer when there is none. */
function requestOrigin(req: Request): string | null {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return 'null';
  }
}

/**
 * CSRF protection for the requests that carry cookies (the refresh-token cookie of /api/auth).
 *
 * A request that changes something (not GET/HEAD/OPTIONS) and carries a cookie is refused with 403 when the browser
 * says it came from another site: the Origin header (or, without it, the Referer) must be the app itself (the
 * frontend's address or the address of the request). A browser always sends Origin on a cross-site POST, and a page
 * cannot remove it. Requests without cookies are not affected (the Bearer token cannot be forged by another site), nor
 * are clients that send neither header (the SAP, scripts): they are not browsers, so there is no forged request.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !req.headers.cookie) {
    next();
    return;
  }
  const origin = requestOrigin(req);
  if (origin === null) {
    next();
    return;
  }
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === self || isAllowedOrigin(origin)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Cross-site request refused' });
}
