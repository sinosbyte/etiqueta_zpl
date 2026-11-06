import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../auth/authService';
import { JWT_SECRET, JWT_ALGORITHM } from '../config';
import { authenticateToken, extractApiToken } from '../tokens/tokensService';

/** Integration tokens may only read designs and templates. */
const TOKEN_READ_PATH = /^\/api\/(designs|templates)(\/|$)/;

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;

  // Personal integration token (Bearer, or the password of an HTTP Basic header): read-only
  const apiToken = extractApiToken(header);
  if (apiToken) {
    try {
      const owner = await authenticateToken(apiToken);
      if (!owner) {
        res.status(401).json({ error: 'Invalid or revoked API token' });
        return;
      }
      if (req.method !== 'GET' || !TOKEN_READ_PATH.test(req.originalUrl.split('?')[0])) {
        res.status(403).json({ error: 'API tokens are read-only' });
        return;
      }
      req.user = { ...owner, viaToken: true };
      next();
    } catch (e) {
      next(e);
    }
    return;
  }

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
