import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  verifyCredentials, issueTokens, rotateRefreshToken, revokeRefreshToken, changePassword,
} from '../auth/authService';
import { loginLimiter, loginIpLimiter, registerLimiter, refreshLimiter, passwordLimiter } from '../middleware/rateLimit';
import { authenticate } from '../middleware/authenticate';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS } from '../config';

export const authRouter = Router();

const CredentialsSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(72), // bcrypt silently truncates beyond 72 bytes
});

/** Attach the opaque refresh token as an httpOnly cookie scoped to /api/auth. */
function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = REFRESH_COOKIE_OPTIONS;
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}

// Sign-up is closed (Fase 05, etapa 3): Sinosbyte creates the companies and their first administrator, and the
// administrator of a company creates its users (see routes/users.ts). The address stays, so old clients get a clear answer.
authRouter.post('/register', registerLimiter, (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Sign-up is closed' });
});

authRouter.post('/login', loginIpLimiter, loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const payload = await verifyCredentials(parsed.data.username, parsed.data.password);
    const { accessToken, refreshToken } = await issueTokens(payload);
    setRefreshCookie(res, refreshToken);
    // mustChangePassword: the password is a temporary one given by an administrator; only the change is allowed until then
    res.json({ token: accessToken, mustChangePassword: payload.mustChangePassword });
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_CREDENTIALS') {
      res.status(401).json({ error: 'Invalid username or password' });
    } else if (e instanceof Error && e.message === 'ACCOUNT_DISABLED') {
      res.status(403).json({ error: 'Account disabled' });
    } else {
      next(e);
    }
  }
});

// Exchange a valid refresh cookie for a fresh access token (rotating the refresh token).
authRouter.post('/refresh', refreshLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }
  try {
    const pair = await rotateRefreshToken(raw);
    if (!pair) {
      clearRefreshCookie(res);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    setRefreshCookie(res, pair.refreshToken);
    res.json({ token: pair.accessToken });
  } catch (e) {
    next(e);
  }
});

// Revoke the current refresh token and clear the cookie.
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  try {
    if (raw) await revokeRefreshToken(raw);
    clearRefreshCookie(res);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// The user changes their own password (also the temporary one). Answers a fresh session: the others end.
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
});

authRouter.post('/change-password', passwordLimiter, authenticate, async (req: Request, res: Response, next: NextFunction) => {
  if (req.user!.viaToken) { res.status(403).json({ error: 'API tokens are read-only' }); return; }
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await changePassword(req.user!.userId, parsed.data.currentPassword, parsed.data.newPassword);
    // A fresh session for this browser, as the login does (the others ended with the change)
    const { accessToken, refreshToken } = await issueTokens({ userId: req.user!.userId, username: req.user!.username });
    setRefreshCookie(res, refreshToken);
    res.json({ token: accessToken });
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_CREDENTIALS') {
      res.status(400).json({ error: 'Current password is wrong' });
    } else if (e instanceof Error && e.message === 'SAME_PASSWORD') {
      res.status(400).json({ error: 'The new password must be different' });
    } else {
      next(e);
    }
  }
});
