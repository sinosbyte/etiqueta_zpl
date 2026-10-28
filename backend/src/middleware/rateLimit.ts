import rateLimit from 'express-rate-limit';
import { isTest } from '../config';

/**
 * Rate limiters. Disabled under NODE_ENV=test so the suite isn't throttled.
 * `skip` short-circuits the middleware entirely in that case.
 */

/**
 * Login limiter against credential brute-force: 10 failed logins / 15 min / IP.
 * Successful logins are not counted, so users sharing an IP (the SAP
 * integration, people on the same VM) are never locked out by normal use.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts, please try again later' },
  skip: () => isTest,
});

/**
 * Tight limiter for account creation. 10 requests / 15 min / IP.
 */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
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
