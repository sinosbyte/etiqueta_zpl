import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createDesign, listDesigns, getDesignWithVersion, deleteDesign, renameDesign,
  createVersion, listVersions, getVersion, updateVersion,
} from '../designs/designsService';
import { variantsRouter } from './variants';
import { ElementSchema, PagesConfigSchema, elementsFitPages } from '../zpl/schema';

export const designsRouter = Router();

// Named sets of test data of a design
designsRouter.use('/:id/variants', variantsRouter);

/** Coerces and validates a route param that must be a positive integer. */
const IdParam = z.coerce.number().int().positive();

/** Pagination query params, with safe defaults and an upper bound on page size. */
const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Example value per {{variable}}: names as in the ZPL, a bounded number of short values
const SampleValuesSchema = z.record(z.string().regex(/^[A-Za-z0-9_]{1,60}$/), z.string().max(255))
  .refine(values => Object.keys(values).length <= 200, 'Too many sample values');

const VersionFields = z.object({
  zpl: z.string().min(1),
  elements: z.array(ElementSchema),
  labelWidth: z.number().positive(),
  labelHeight: z.number().positive(),
  sampleValues: SampleValuesSchema.optional(),
  // How the pages print + the test records of the tables. Omitted: not touched on an update, one page on a
  // new version. null: back to one page.
  pagesConfig: PagesConfigSchema.nullable().optional(),
});

// An element may only be on a page the design has. A new version with no configuration is one page; an update
// with none keeps the saved one, so the service checks the elements against that (PAGES_MISMATCH).
type PagesCheck = { elements: { page?: number }[]; pagesConfig?: { pages: unknown[] } | null };
const fitsNewVersion = (v: PagesCheck) => elementsFitPages(v.elements, v.pagesConfig ?? null);
const fitsWhenGiven = (v: PagesCheck) => v.pagesConfig === undefined || elementsFitPages(v.elements, v.pagesConfig);
const PAGES_MESSAGE = { message: 'Elements are on a page the design does not have', path: ['pagesConfig'] };

const NewVersionSchema = VersionFields.refine(fitsNewVersion, PAGES_MESSAGE);
const UpdateVersionSchema = VersionFields.refine(fitsWhenGiven, PAGES_MESSAGE);

const CreateDesignSchema = VersionFields.extend({
  name: z.string().min(1).max(100),
}).refine(fitsNewVersion, PAGES_MESSAGE);

designsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CreateDesignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  const userId = req.user!.userId;
  try {
    const { name, ...payload } = parsed.data;
    const result = await createDesign(userId, name, payload);
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof Error && e.message === 'DESIGN_NAME_TAKEN') {
      res.status(409).json({ error: 'Design name already taken' });
    } else {
      next(e);
    }
  }
});

designsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const page = PaginationSchema.safeParse(req.query);
  if (!page.success) { res.status(400).json({ error: 'Invalid pagination parameters' }); return; }
  try {
    res.json(await listDesigns(req.user!.userId, page.data));
  } catch (e) {
    next(e);
  }
});

designsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }

  const versionParam = req.query.version !== undefined
    ? IdParam.safeParse(req.query.version)
    : null;
  if (versionParam && !versionParam.success) {
    res.status(400).json({ error: 'Invalid version number' }); return;
  }

  try {
    const design = await getDesignWithVersion(
      req.user!.userId,
      idResult.data,
      versionParam?.data,
    );
    if (!design) { res.status(404).json({ error: 'Design not found' }); return; }
    res.json(design);
  } catch (e) {
    next(e);
  }
});

designsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await renameDesign(req.user!.userId, idResult.data, parsed.data.name);
    if (!result) { res.status(404).json({ error: 'Design not found' }); return; }
    res.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === 'DESIGN_NAME_TAKEN') {
      res.status(409).json({ error: 'Design name already taken' });
    } else {
      next(e);
    }
  }
});

designsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  try {
    const deleted = await deleteDesign(req.user!.userId, idResult.data);
    if (!deleted) { res.status(404).json({ error: 'Design not found' }); return; }
    res.status(204).end();
  } catch (e) {
    if (e instanceof Error && e.message === 'DELETE_NOT_ALLOWED') {
      res.status(403).json({ error: 'Only the creator or an administrator can delete this design' });
      return;
    }
    next(e);
  }
});

designsRouter.post('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  const parsed = NewVersionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const version = await createVersion(req.user!.userId, idResult.data, parsed.data);
    res.status(201).json(version);
  } catch (e) {
    if (e instanceof Error && e.message === 'DESIGN_NOT_FOUND') {
      res.status(404).json({ error: 'Design not found' });
    } else {
      next(e);
    }
  }
});

designsRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  const page = PaginationSchema.safeParse(req.query);
  if (!page.success) { res.status(400).json({ error: 'Invalid pagination parameters' }); return; }
  try {
    const versions = await listVersions(req.user!.userId, idResult.data, page.data);
    res.json(versions);
  } catch (e) {
    next(e);
  }
});

designsRouter.get('/:id/versions/:vn', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  const vnResult = IdParam.safeParse(req.params.vn);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  if (!vnResult.success) { res.status(400).json({ error: 'Invalid version number' }); return; }
  try {
    const version = await getVersion(req.user!.userId, idResult.data, vnResult.data);
    if (!version) { res.status(404).json({ error: 'Version not found' }); return; }
    res.json(version);
  } catch (e) {
    next(e);
  }
});

designsRouter.put('/:id/versions/:vn', async (req: Request, res: Response, next: NextFunction) => {
  const idResult = IdParam.safeParse(req.params.id);
  const vnResult = IdParam.safeParse(req.params.vn);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid design ID' }); return; }
  if (!vnResult.success) { res.status(400).json({ error: 'Invalid version number' }); return; }
  const parsed = UpdateVersionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const result = await updateVersion(req.user!.userId, idResult.data, vnResult.data, parsed.data);
    if (!result) { res.status(404).json({ error: 'Version not found' }); return; }
    res.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === 'PAGES_MISMATCH') {
      res.status(400).json({ error: PAGES_MESSAGE.message });
    } else {
      next(e);
    }
  }
});
