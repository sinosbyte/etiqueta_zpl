import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isTest } from '../config';

/**
 * Rate limiters. Disabled under NODE_ENV=test so the suite isn't throttled.
 * `skip` short-circuits the middleware entirely in that case.
 */

/**
 * Login limiter against credential brute-force. Failed logins are counted per
 * IP + username, so someone mistyping their own password never locks out
 * the other people behind the same IP (a client's network, the VM, the SAP
 * integration). Successful logins are not counted.
 * 10 failed attempts / 15 min / IP + username.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: req => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${username}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts, please try again later' },
  skip: () => isTest,
});

/**
 * Wider net per IP for the same endpoint, so guessing many usernames from one
 * place is still stopped. 100 failed logins / 15 min / IP.
 */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts, please try again later' },
  skip: () => isTest,
});

/**
 * Limiter for account creation. Users behind one IP create accounts too, so it
 * is wider than the login one: 30 requests / 15 min / IP.
 */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
  skip: () => isTest,
});

/**
 * Limiter for the silent token-refresh endpoint. More generous than the login
 * limiter (refreshes are legitimate and frequent) but still bounded. 60 / 15 min / IP.
 */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts, please try again later' },
  skip: () => isTest,
});

/**
 * Limiter for the Labelary proxy endpoints, which relay arbitrary bodies to a
 * third party. 60 requests / min / IP keeps the relay from being abused as an
 * amplification vector while staying generous for interactive preview.
 */
export const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
  skip: () => isTest,
});

/**
 * Limiter for the templates endpoints, which read and write the database.
 * 300 requests / min / IP: generous, since people share a client IP.
 */
export const templatesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
  skip: () => isTest,
});

/**
 * Limiter for the token-management endpoints (create, list, revoke). 60 requests / min / IP.
 * Placed before authenticate, which is where CodeQL looks for it.
 */
export const tokensLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
  skip: () => isTest,
});
