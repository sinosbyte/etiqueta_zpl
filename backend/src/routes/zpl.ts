import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { generateZpl } from '../zpl/generator';
import { parseZpl } from '../zpl/parser';
import { ElementSchema, PagesSchema, RecordsSchema, ValuesSchema } from '../zpl/schema';
import { ExpandError, expandLabels } from '../zpl/pagination';
import { LABELARY_BASE_URL, LABELARY_TIMEOUT_MS, MAX_ZPL_LENGTH } from '../config';
import { labelaryGate } from '../labelary';

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

type LabelaryAnswer = { buffer: Buffer } | { error: 'upstream' | 'network' } | { error: 'rate-limited'; retryAfterMs: number };

/** Used when the service says 429 without a usable Retry-After. */
const DEFAULT_RETRY_AFTER_MS = 5_000;

/**
 * One request to the Labelary rendering API over HTTPS, with a timeout so a hung upstream connection can't tie up
 * the request indefinitely. It is only ever called through the gate (see labelary/gate.ts), which paces all users.
 * `signal` is the client going away. A 429 keeps its meaning (and its Retry-After) instead of becoming a generic error.
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
  const timeout = setTimeout(() => controller.abort(), LABELARY_TIMEOUT_MS);
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
      const seconds = Number(response.headers.get('Retry-After'));
      return { error: 'rate-limited', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS };
    }
    if (!response.ok) {
      return { error: 'upstream' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer };
  } catch {
    return { error: 'network' };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Renders a label through the gate for the user making the request. A single preview (the default) goes before the
 * mass export the PDF makes, which says so with `X-Render-Priority: bulk`. Answers the client itself on any failure
 * and returns null; returns the picture/file otherwise. A client that went away is not answered at all.
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
  const priority = req.get('X-Render-Priority') === 'bulk' ? 'bulk' : 'interactive';
  const gone = new AbortController();
  const onClose = () => { if (!res.writableEnded) gone.abort(); };
  res.on('close', onClose);

  try {
    const result = await labelaryGate.run<LabelaryAnswer>(async signal => {
      const answer = await callLabelary(zpl, labelWidth, labelHeight, accept, signal);
      if ('buffer' in answer) return { kind: 'ok', value: answer };
      if (answer.error === 'rate-limited') return { kind: 'rate-limited', retryAfterMs: answer.retryAfterMs };
      return { kind: 'failed', value: answer };
    }, { user, priority, signal: gone.signal });

    const retryAfter = (ms: number) => res.set('Retry-After', String(Math.max(1, Math.ceil(ms / 1000))));
    switch (result.kind) {
      case 'ok':
        return (result.value as { buffer: Buffer }).buffer;
      case 'failed': {
        const error = (result.value as { error: string }).error;
        res.status(502).json({ error: error === 'upstream' ? 'Labelary API error' : 'Could not reach Labelary API' });
        return null;
      }
      case 'rate-limited':
        retryAfter(result.retryAfterMs);
        res.status(429).json({ error: 'Labelary rate limit reached, please retry later' });
        return null;
      case 'busy':
        retryAfter(result.retryAfterMs);
        if (result.reason === 'wait-timeout') res.status(503).json({ error: 'Labelary API busy, please retry later' });
        else if (result.reason === 'paused') res.status(429).json({ error: 'Labelary rate limit reached, please retry later' });
        else res.status(429).json({ error: 'Too many requests, please slow down' });
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
