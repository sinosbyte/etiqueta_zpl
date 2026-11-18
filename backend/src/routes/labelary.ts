import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { labelaryQuota } from '../labelary';
import { LABELARY_HOLD_MAX_PER_USER } from '../config';
import logger from '../logger';

/**
 * What the editor may ask about the use of the Labelary service, and the one thing it may do with it: keep room for a
 * mass export. The counter is not in its hands: only the server writes it, when it sends a request (labelary/quota.ts).
 * What is told is what a screen needs (the state, how much is left, when it is back) and nothing of how it is kept.
 */
export const labelaryRouter = Router();

// A PDF of up to 501 labels (see MAX_EXPAND_LABELS) and the tries that may be needed again for some of them: 600 (see labelaryConfig.ts)
const MAX_HOLD = LABELARY_HOLD_MAX_PER_USER;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const unavailable = (res: Response) =>
  res.status(503).json({ error: 'Labelary quota control unavailable', code: 'quota-unavailable' });

labelaryRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const s = await labelaryQuota.status();
    res.json({ state: s.state, remaining: s.remaining, retryAt: iso(s.retryAt) });
  } catch (e) {
    logger.error({ err: e }, 'Labelary quota could not be read');
    unavailable(res);
  }
});

const HoldSchema = z.object({ count: z.number().int().min(1).max(MAX_HOLD) });

labelaryRouter.post('/holds', async (req: Request, res: Response) => {
  const parsed = HoldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const userId = req.user?.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  const r = await labelaryQuota.createHold(userId, parsed.data.count);
  if (r.ok) {
    res.status(201).json({ holdId: r.holdId, slots: r.slots, expiresAt: r.expiresAt.toISOString() });
    return;
  }
  if (r.retryAt) res.set('Retry-After', String(Math.max(1, Math.ceil((r.retryAt.getTime() - Date.now()) / 1000))));
  if (r.reason === 'quota-unavailable') {
    unavailable(res);
  } else if (r.reason === 'hold-active') {
    // An export of this user already has its room (maybe in another tab): it is not touched, the new one is refused
    res.status(409).json({ error: 'An export of yours is already holding room', code: 'hold-active', retryAt: iso(r.retryAt) });
  } else if (r.reason === 'hold-capacity') {
    res.status(429).json({ error: 'Export capacity is busy, try again in a few minutes', code: 'hold-capacity', retryAt: iso(r.retryAt), remaining: r.remaining });
  } else if (r.reason === 'hold-too-large') {
    res.status(400).json({ error: 'Too many labels for one export', code: 'hold-too-large', remaining: r.remaining });
  } else if (r.reason === 'quota-external') {
    res.status(429).json({ error: 'Labelary quota is used up for now', code: 'quota-external', retryAt: iso(r.retryAt), remaining: 0 });
  } else {
    res.status(429).json({ error: 'Labelary daily limit of this server reached', code: 'quota-internal', retryAt: iso(r.retryAt), remaining: r.remaining });
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Giving the room back. Safe to repeat, and only the owner's hold is ever touched
labelaryRouter.delete('/holds/:id', async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const id = String(req.params.id);
  if (typeof userId !== 'number' || !UUID.test(id)) {
    res.status(400).json({ error: 'Invalid hold ID' });
    return;
  }
  try {
    await labelaryQuota.releaseHold(userId, id);
    res.status(204).end();
  } catch (e) {
    logger.error({ err: e }, 'Labelary hold could not be released');
    unavailable(res);
  }
});
