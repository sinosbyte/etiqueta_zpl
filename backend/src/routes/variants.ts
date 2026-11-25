import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { whoOf } from '../designs/scope';
import { ValuesSchema, RecordsSchema } from '../zpl/schema';
import {
  listVariants, getVariant, createVariant, updateVariant, deleteVariant, MAX_VARIANTS_PER_DESIGN,
} from '../designs/variantsService';

/** Mounted at /api/designs/:id/variants (mergeParams: the design id comes from the parent path). */
export const variantsRouter = Router({ mergeParams: true });

const IdParam = z.coerce.number().int().positive();
const UuidParam = z.string().uuid();

// Trimmed, never empty; the same name in another case is the same name (the database enforces it)
const NameSchema = z.string().trim().min(1).max(100);

const CreateSchema = z.object({
  name: NameSchema,
  sampleValues: ValuesSchema.default({}),
  records: RecordsSchema.default([]),
});

const PatchSchema = z.object({
  name: NameSchema.optional(),
  sampleValues: ValuesSchema.optional(),
  records: RecordsSchema.optional(),
}).refine(b => b.name !== undefined || b.sampleValues !== undefined || b.records !== undefined, 'Nothing to update');

function fail(e: unknown, res: Response, next: NextFunction) {
  if (e instanceof Error && e.message === 'VARIANT_NAME_TAKEN') {
    res.status(409).json({ error: 'Variant name already taken' });
  } else if (e instanceof Error && e.message === 'VARIANT_LIMIT') {
    res.status(409).json({ error: `A design can have at most ${MAX_VARIANTS_PER_DESIGN} test variants` });
  } else {
    next(e);
  }
}

function ids(req: Request, res: Response, withVariant: boolean): { designId: number; id: string } | undefined {
  const d = IdParam.safeParse(req.params.id);
  if (!d.success) { res.status(400).json({ error: 'Invalid design ID' }); return undefined; }
  let id = '';
  if (withVariant) {
    const v = UuidParam.safeParse(req.params.variantId);
    if (!v.success) { res.status(400).json({ error: 'Invalid variant ID' }); return undefined; }
    id = v.data;
  }
  return { designId: d.data, id };
}

variantsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const p = ids(req, res, false); if (!p) return;
  try {
    const items = await listVariants(whoOf(req.user!), p.designId);
    if (!items) { res.status(404).json({ error: 'Design not found' }); return; }
    res.json({ items, max: MAX_VARIANTS_PER_DESIGN });
  } catch (e) { next(e); }
});

variantsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const p = ids(req, res, false); if (!p) return;
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const created = await createVariant(req.user!.userId, p.designId, parsed.data);
    if (!created) { res.status(404).json({ error: 'Design not found' }); return; }
    res.status(201).json(created);
  } catch (e) { fail(e, res, next); }
});

variantsRouter.get('/:variantId', async (req: Request, res: Response, next: NextFunction) => {
  const p = ids(req, res, true); if (!p) return;
  try {
    const v = await getVariant(whoOf(req.user!), p.designId, p.id);
    if (!v) { res.status(404).json({ error: 'Variant not found' }); return; }
    res.json(v);
  } catch (e) { next(e); }
});

variantsRouter.patch('/:variantId', async (req: Request, res: Response, next: NextFunction) => {
  const p = ids(req, res, true); if (!p) return;
  const parsed = PatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const v = await updateVariant(req.user!.userId, p.designId, p.id, parsed.data);
    if (!v) { res.status(404).json({ error: 'Variant not found' }); return; }
    res.json(v);
  } catch (e) { fail(e, res, next); }
});

variantsRouter.delete('/:variantId', async (req: Request, res: Response, next: NextFunction) => {
  const p = ids(req, res, true); if (!p) return;
  try {
    const ok = await deleteVariant(req.user!.userId, p.designId, p.id);
    if (!ok) { res.status(404).json({ error: 'Variant not found' }); return; }
    res.status(204).end();
  } catch (e) { next(e); }
});
