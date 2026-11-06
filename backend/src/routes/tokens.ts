import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createToken, listTokens, revokeToken } from '../tokens/tokensService';

export const tokensRouter = Router();

const IdParam = z.coerce.number().int().positive();

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/** Tokens are managed only from a signed-in session, never with a token (a token cannot mint tokens). */
function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.viaToken) {
    res.status(403).json({ error: 'API tokens are read-only' });
    return;
  }
  next();
}

tokensRouter.use(requireSession);

// The user's own tokens: name, prefix and dates. The token itself is never returned again.
tokensRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await listTokens(req.user!.userId) });
  } catch (e) {
    next(e);
  }
});

// Creates a token. The response is the only time the full token is shown.
tokensRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const { token, summary } = await createToken(req.user!.userId, parsed.data.name, parsed.data.expiresInDays);
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

// Revokes one of the user's own tokens (someone else's token is the same as one that does not exist).
tokensRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid token ID' }); return; }
  try {
    if (!(await revokeToken(req.user!.userId, id.data))) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
