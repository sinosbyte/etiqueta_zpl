import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generateZpl } from '../zpl/generator';
import { parseZpl } from '../zpl/parser';
import { ElementSchema, PagesSchema, RecordsSchema, ValuesSchema } from '../zpl/schema';
import { ExpandError, expandLabels } from '../zpl/pagination';
import {
  LABELARY_BASE_URL, LABELARY_DAILY_RETRY_AFTER_MS, LABELARY_EXTERNAL_BLOCK_MAX_MS,
  LABELARY_TIMEOUT_MS, MAX_ZPL_LENGTH,
} from '../config';
import { labelaryGate, labelaryQuota } from '../labelary';
import { Denied } from '../labelary/quota';
import { classify429 } from '../labelary/retryAfter';
import logger from '../logger';

export const zplRouter = Router();

/** A ZPL string field, capped to prevent oversized relays to Labelary. */
const zplField = z.string().max(MAX_ZPL_LENGTH);

/** Label dimensions in dots, positive and upper-bounded to sane physical sizes. */
const dimension = z.number().positive().max(10_000);

const GenerateSchema = z.object({
  labelWidth: dimension,
  labelHeight: dimension,
  elements: z.array(ElementSchema),
  pages: PagesSchema.optional(),
});

const ExpandSchema = GenerateSchema.extend({
  values: ValuesSchema.optional(),
  records: RecordsSchema.optional(),
});

zplRouter.post('/generate-zpl', (req: Request, res: Response, next: NextFunction) => {
  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const zpl = generateZpl(parsed.data);
    res.json({ zpl });
  } catch (e) {
    next(e);
  }
});

// The labels a design prints for some records (the simulation): the first page once, then the second
// as many times as the records left need, each table holding as many as its capacity
zplRouter.post('/expand-zpl', (req: Request, res: Response, next: NextFunction) => {
  const parsed = ExpandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    res.json(expandLabels(parsed.data));
  } catch (e) {
    if (e instanceof ExpandError) {
      res.status(400).json({ error: e.message });
      return;
    }
    next(e);
  }
});

zplRouter.post('/parse-zpl', (req: Request, res: Response, next: NextFunction) => {
  const schema = z.object({ zpl: zplField });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = parseZpl(parsed.data.zpl);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

type LabelaryAnswer =
  | { buffer: Buffer }
  | { error: 'upstream' | 'network' | 'timeout' | 'rejected' }
  | { error: 'rate-limited' | 'quota-external'; retryAfterMs: number };

/** Used when the service says 429 without a usable Retry-After. */
const DEFAULT_RETRY_AFTER_MS = 5_000;

/**
 * One request to the Labelary rendering API over HTTPS, with a timeout so a hung upstream connection can't tie up
 * the request indefinitely. It is only ever called through the gate (see labelary/gate.ts), which paces all users, and
 * only after the quota has given room for it (labelary/quota.ts). `signal` is the client going away.
 *
 * What the service answers is told apart, because each needs a different reaction:
 *  - a 429 that asks to wait a minute or more is the DAILY quota ('quota-external': not retried, and the server stays
 *    away until the time the service said); any other 429 is only the pace ('rate-limited'), and a short wait is enough;
 *  - 400 and 413: the service refused THIS label (its ZPL or its size), so asking again would only spend the quota ('rejected');
 *  - anything else that is not 2xx: the service has a problem ('upstream'); no answer in time: 'timeout'; no answer at all: 'network'.
 */
async function callLabelary(
  zpl: string,
  labelWidth: number,
  labelHeight: number,
  accept: string,
  signal: AbortSignal,
): Promise<LabelaryAnswer> {
  const wIn = (labelWidth / 203.2).toFixed(2);
  const hIn = (labelHeight / 203.2).toFixed(2);
  const url = `${LABELARY_BASE_URL}/${wIn}x${hIn}/0/`;

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, LABELARY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': accept },
      body: zpl,
      signal: controller.signal,
    });
    if (response.status === 429) {
      // Only the Retry-After says which limit it is (labelary/retryAfter.ts); the words of the body are not read
      void response.arrayBuffer().catch(() => undefined);
      const c = classify429(response.headers.get('Retry-After'), Date.now(), {
        dailyAtMs: LABELARY_DAILY_RETRY_AFTER_MS, maxBlockMs: LABELARY_EXTERNAL_BLOCK_MAX_MS, defaultPauseMs: DEFAULT_RETRY_AFTER_MS,
      });
      return { error: c.kind === 'quota-external' ? 'quota-external' : 'rate-limited', retryAfterMs: c.retryAfterMs };
    }
    if (response.status === 400 || response.status === 413) return { error: 'rejected' };
    if (!response.ok) return { error: 'upstream' };
    return { buffer: Buffer.from(await response.arrayBuffer()) };
  } catch {
    return { error: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renders a label through the gate for the user making the request. A single preview (the default) goes before the
 * mass export the PDF makes, which says so with `X-Render-Priority: bulk` (and uses the room it kept, with
 * `X-Render-Hold`). Answers the client itself on any failure and returns null; returns the picture/file otherwise. A
 * client that went away is not answered at all. Each answer carries a `code` (the `error` text stays as it was), so the
 * editor can tell the reasons apart and decide whether another try could help.
 */
async function renderViaLabelary(
  req: Request,
  res: Response,
  zpl: string,
  labelWidth: number,
  labelHeight: number,
  accept: string,
): Promise<Buffer | null> {
  const user = String(req.user?.userId ?? req.ip ?? 'anonymous');
  const userId = typeof req.user?.userId === 'number' ? req.user.userId : null;
  const priority = req.get('X-Render-Priority') === 'bulk' ? 'bulk' : 'interactive';
  const hold = req.get('X-Render-Hold');
  const holdId = hold && UUID.test(hold) ? hold : undefined;
  const gone = new AbortController();
  const onClose = () => { if (!res.writableEnded) gone.abort(); };
  res.on('close', onClose);

  try {
    const result = await labelaryGate.run<LabelaryAnswer | Denied>(async signal => {
      // The room is taken when the request is about to be sent, not when it is asked for: one that waited and was
      // cancelled costs nothing, and every request sent (a second try included) is counted
      if (signal.aborted) return { kind: 'failed', value: { error: 'network' } };
      const reserved = await labelaryQuota.reserve(userId, holdId);
      if (!reserved.ok) return { kind: 'denied', value: reserved };

      const answer = await callLabelary(zpl, labelWidth, labelHeight, accept, signal);
      if ('buffer' in answer) return { kind: 'ok', value: answer };
      if (answer.error === 'rate-limited') return { kind: 'rate-limited', retryAfterMs: answer.retryAfterMs };
      if (answer.error === 'quota-external') {
        // The service's own daily quota is used up: remembered for every instance and restart, so nothing more is sent
        await labelaryQuota.blockUntil(answer.retryAfterMs, 'external-429').catch(e => logger.error({ err: e }, 'Could not record the Labelary block'));
        return { kind: 'denied', value: { ok: false, reason: 'quota-external', retryAt: new Date(Date.now() + answer.retryAfterMs), remaining: 0 } };
      }
      return { kind: 'failed', value: answer };
    }, { user, priority, signal: gone.signal });

    const retryAfter = (ms: number) => res.set('Retry-After', String(Math.max(1, Math.ceil(ms / 1000))));
    switch (result.kind) {
      case 'ok':
        return (result.value as { buffer: Buffer }).buffer;
      case 'failed': {
        const error = (result.value as { error: string }).error;
        if (error === 'rejected') res.status(422).json({ error: 'The rendering service rejected this label', code: 'zpl-rejected' });
        else if (error === 'timeout') res.status(504).json({ error: 'Labelary API timed out', code: 'timeout' });
        else if (error === 'upstream') res.status(502).json({ error: 'Labelary API error', code: 'upstream' });
        else res.status(502).json({ error: 'Could not reach Labelary API', code: 'network' });
        return null;
      }
      case 'denied': {
        const d = result.value as Denied;
        if (d.retryAt) retryAfter(d.retryAt.getTime() - Date.now());
        if (d.reason === 'quota-unavailable') {
          res.status(503).json({ error: 'Labelary quota control unavailable', code: 'quota-unavailable' });
        } else if (d.reason === 'quota-external') {
          res.status(429).json({ error: 'Labelary quota is used up for now', code: 'quota-external', retryAt: d.retryAt?.toISOString() ?? null, remaining: 0 });
        } else {
          res.status(429).json({ error: 'Labelary daily limit of this server reached', code: 'quota-internal', retryAt: d.retryAt?.toISOString() ?? null, remaining: d.remaining });
        }
        return null;
      }
      case 'rate-limited':
        retryAfter(result.retryAfterMs);
        res.status(429).json({ error: 'Labelary rate limit reached, please retry later', code: 'rate-limited' });
        return null;
      case 'busy':
        retryAfter(result.retryAfterMs);
        if (result.reason === 'wait-timeout') res.status(503).json({ error: 'Labelary API busy, please retry later', code: 'busy' });
        else if (result.reason === 'paused') res.status(429).json({ error: 'Labelary rate limit reached, please retry later', code: 'rate-limited' });
        else res.status(429).json({ error: 'Too many requests, please slow down', code: 'rate-limited' });
        return null;
      case 'cancelled':
        return null;
    }
  } finally {
    res.off('close', onClose);
  }
}

zplRouter.post('/preview', async (req: Request, res: Response) => {
  const schema = z.object({
    zpl: zplField,
    labelWidth: dimension,
    labelHeight: dimension,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { zpl, labelWidth, labelHeight } = parsed.data;
  const buffer = await renderViaLabelary(req, res, zpl, labelWidth, labelHeight, 'image/png');
  if (!buffer) return;
  res.set('Content-Type', 'image/png');
  res.send(buffer);
});

const EXPORT_FORMATS = {
  png:  { accept: 'image/png',        contentType: 'image/png',        ext: 'png'  },
  pdf:  { accept: 'application/pdf',  contentType: 'application/pdf',  ext: 'pdf'  },
  epl:  { accept: 'application/epl',  contentType: 'application/epl',  ext: 'epl'  },
  zpl:  { accept: 'application/zpl',  contentType: 'application/zpl',  ext: 'zpl'  },
} as const;

zplRouter.post('/export', async (req: Request, res: Response) => {
  const schema = z.object({
    zpl: zplField,
    labelWidth: dimension,
    labelHeight: dimension,
    format: z.enum(['png', 'pdf', 'epl', 'zpl']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { zpl, labelWidth, labelHeight, format } = parsed.data;
  const { accept, contentType, ext } = EXPORT_FORMATS[format];
  const buffer = await renderViaLabelary(req, res, zpl, labelWidth, labelHeight, accept);
  if (!buffer) return;
  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="label.${ext}"`);
  res.send(buffer);
});
