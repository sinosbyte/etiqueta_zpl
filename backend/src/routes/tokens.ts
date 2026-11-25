import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createToken, deleteToken, listTokens, revokeToken } from '../tokens/tokensService';
import { isAdminRole } from '../auth/account';

export const tokensRouter = Router();

const IdParam = z.coerce.number().int().positive();

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/**
 * Tokens are managed only from a signed-in session, never with a token (a token cannot mint tokens), and only by an
 * administrator of the company: a token gives a system outside read access to every design of the company (Fase 06).
 */
function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.viaToken) {
    res.status(403).json({ error: 'API tokens are read-only' });
    return;
  }
  // The platform company reads no designs, so it has no integration tokens (Fase 06, etapa 2)
  if (req.user?.role === 'platform_admin') {
    res.status(403).json({ error: 'Not available for Sinosbyte administrators' });
    return;
  }
  if (!req.user || !isAdminRole(req.user.role)) {
    res.status(403).json({ error: 'Administrator access required' });
    return;
  }
  next();
}

tokensRouter.use(requireSession);

// The company's tokens: name, prefix, who generated it and dates. The token itself is never returned again.
tokensRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await listTokens(req.user!.companyId) });
  } catch (e) {
    next(e);
  }
});

// Creates a token. The response is the only time the full token is shown.
tokensRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const { token, summary } = await createToken({ userId: req.user!.userId, companyId: req.user!.companyId }, parsed.data.name, parsed.data.expiresInDays);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ token, ...summary });
  } catch (e) {
    if (e instanceof Error && e.message === 'TOKEN_LIMIT') {
      res.status(409).json({ error: 'Token limit reached' });
    } else {
      next(e);
    }
  }
});

// Revokes one of the company's tokens (another company's token is the same as one that does not exist).
tokensRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid token ID' }); return; }
  try {
    if (!(await revokeToken(req.user!.companyId, id.data))) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Deletes one of the company's tokens for good (it also stops working, if it was active).
tokensRouter.delete('/:id/permanent', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid token ID' }); return; }
  try {
    if (!(await deleteToken(req.user!.companyId, id.data))) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
