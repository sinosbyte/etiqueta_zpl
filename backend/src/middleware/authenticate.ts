import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../auth/authService';
import { loadAccount, isUsable } from '../auth/account';
import { JWT_SECRET, JWT_ALGORITHM } from '../config';
import { authenticateToken, parseAuthHeader } from '../tokens/tokensService';

/** Integration tokens may only read designs and templates. */
const TOKEN_READ_PATH = /^\/api\/(designs|templates)(\/|$)/;

/** While a password must be changed, only these answer (who am I, and the change itself). */
const PASSWORD_CHANGE_PATH = /^\/api\/(me|auth\/change-password)(\/|$)/;

/**
 * Who is calling. The login token (JWT) only says which user; the role, the company and whether the user and the
 * company are active are read from the database on every request (Fase 05, etapa 3), so that deactivating someone
 * takes effect at once. If the database cannot be read the request fails (it is never let through).
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const path = req.originalUrl.split('?')[0];

  // Personal integration token (Bearer, or the password of an HTTP Basic header): read-only
  const presented = parseAuthHeader(header);
  if (presented) {
    try {
      const owner = await authenticateToken(presented);
      if (!owner) {
        res.status(401).json({ error: 'Invalid or revoked API token' });
        return;
      }
      if (req.method !== 'GET' || !TOKEN_READ_PATH.test(path)) {
        res.status(403).json({ error: 'API tokens are read-only' });
        return;
      }
      // A pending password change does not stop the SAP integration: the token is not the password
      req.user = { ...owner, mustChangePassword: false, viaToken: true };
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
  let payload: JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  try {
    const account = await loadAccount(payload.userId);
    if (!isUsable(account)) {
      res.status(401).json({ error: 'Account disabled' });
      return;
    }
    if (account.mustChangePassword && !PASSWORD_CHANGE_PATH.test(path)) {
      res.status(403).json({ error: 'Password change required' });
      return;
    }
    req.user = {
      userId: account.userId, username: account.username, role: account.role,
      companyId: account.companyId, mustChangePassword: account.mustChangePassword,
    };
    next();
  } catch (e) {
    next(e);
  }
}
