import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  registerUser, verifyCredentials, issueTokens, rotateRefreshToken, revokeRefreshToken,
} from '../auth/authService';
import { loginLimiter, registerLimiter, refreshLimiter } from '../middleware/rateLimit';
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

authRouter.post('/register', registerLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await registerUser(parsed.data.username, parsed.data.password);
    res.status(201).json({ message: 'User created' });
  } catch (e) {
    if (e instanceof Error && e.message === 'USERNAME_TAKEN') {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      next(e);
    }
  }
});

authRouter.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const payload = await verifyCredentials(parsed.data.username, parsed.data.password);
    const { accessToken, refreshToken } = await issueTokens(payload);
    setRefreshCookie(res, refreshToken);
    res.json({ token: accessToken });
  } catch (e) {
    if (e instanceof Error && e.message === 'INVALID_CREDENTIALS') {
      res.status(401).json({ error: 'Invalid username or password' });
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
