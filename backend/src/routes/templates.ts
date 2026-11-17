import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  isAdmin, listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
} from '../templates/templatesService';
import { ElementSchema, PagesConfigSchema } from '../zpl/schema';
import { TEMPLATE_CATEGORIES } from '../templates/categories';

export const templatesRouter = Router();

const IdParam = z.coerce.number().int().positive();

const PayloadFields = z.object({
  zpl: z.string().min(1),
  elements: z.array(ElementSchema),
  labelWidth: z.number().positive(),
  labelHeight: z.number().positive(),
  // Templates have one page in this version: the field is only accepted to be able to refuse a design of
  // two pages (it is never stored)
  pagesConfig: PagesConfigSchema.nullable().optional(),
});

// A template is one label. A design of two pages (an element on page 2, or a configuration with two
// pages) cannot be published, whatever the screen does.
const SINGLE_PAGE_MESSAGE = 'Templates cannot have more than one page';
const isSinglePage = (v: { elements: { page?: number }[]; pagesConfig?: { pages: unknown[] } | null }) =>
  (v.pagesConfig?.pages.length ?? 1) <= 1 && v.elements.every(el => (el.page ?? 0) === 0);
const SINGLE_PAGE = { message: SINGLE_PAGE_MESSAGE, path: ['pagesConfig'] };

const PayloadSchema = PayloadFields.refine(isSinglePage, SINGLE_PAGE);
const CreateSchema = PayloadFields.extend({
  name: z.string().min(1).max(100),
  description: z.string().max(300).default(''),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
}).refine(isSinglePage, SINGLE_PAGE);
const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(300).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  payload: PayloadSchema.optional(),
});

/** Only Sinosbyte administrators may change the templates. */
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user!.viaToken) {
    res.status(403).json({ error: 'API tokens are read-only' });
    return;
  }
  try {
    if (await isAdmin(req.user!.userId)) { next(); return; }
    res.status(403).json({ error: 'Administrator access required' });
  } catch (e) {
    next(e);
  }
}

// Every signed-in user sees the templates; canManage tells the UI whether to offer the admin actions.
templatesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ items: await listTemplates(), canManage: await isAdmin(req.user!.userId) });
  } catch (e) {
    next(e);
  }
});

templatesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid template ID' }); return; }
  try {
    const template = await getTemplate(id.data);
    if (!template) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(template);
  } catch (e) {
    next(e);
  }
});

templatesRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const { name, description, category, pagesConfig: _pages, ...payload } = parsed.data;
    res.status(201).json(await createTemplate(req.user!.userId, name, description, payload, category));
  } catch (e) {
    if (e instanceof Error && e.message === 'TEMPLATE_NAME_TAKEN') {
      res.status(409).json({ error: 'Template name already taken' });
    } else {
      next(e);
    }
  }
});

templatesRouter.patch('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid template ID' }); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
  try {
    const { payload: sent, ...fields } = parsed.data;
    const payload = sent && { zpl: sent.zpl, elements: sent.elements, labelWidth: sent.labelWidth, labelHeight: sent.labelHeight };
    if (!(await updateTemplate(id.data, fields, payload))) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json({ id: id.data });
  } catch (e) {
    if (e instanceof Error && e.message === 'TEMPLATE_NAME_TAKEN') {
      res.status(409).json({ error: 'Template name already taken' });
    } else {
      next(e);
    }
  }
});

templatesRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid template ID' }); return; }
  try {
    if (!(await deleteTemplate(id.data))) { res.status(404).json({ error: 'Template not found' }); return; }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
