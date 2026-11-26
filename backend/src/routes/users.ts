import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { loadAccount } from '../auth/account';
import {
  UsersError, listUsers, createUser, updateUser, resetPassword, listCompanies, createCompany, updateCompany, updateOwnEmail,
} from '../users/usersService';

/** Users and companies are managed only from a signed-in session (an integration token is refused before this, too). */
function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.viaToken) { res.status(403).json({ error: 'API tokens are read-only' }); return; }
  next();
}

function fail(e: unknown, res: Response, next: NextFunction) {
  if (e instanceof UsersError) { res.status(e.status).json({ error: e.message }); return; }
  next(e);
}

const IdParam = z.coerce.number().int().positive();
const Username = z.string().trim().min(3).max(50);
const Email = z.string().trim().toLowerCase().max(254).email();
const Role = z.enum(['platform_admin', 'company_admin', 'member']);
const CompanyName = z.string().trim().min(2).max(100);

const bad = (res: Response, e: z.ZodError) => res.status(400).json({ error: e.flatten() });
const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

// ---------- who am I ----------

export const meRouter = Router();

meRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const a = await loadAccount(req.user!.userId);
    if (!a) { res.status(401).json({ error: 'Account disabled' }); return; }
    res.json({
      userId: a.userId, username: a.username, email: a.email, role: a.role,
      company: { id: a.companyId, name: a.companyName, isPlatform: a.companyIsPlatform }, mustChangePassword: a.mustChangePassword,
    });
  } catch (e) { next(e); }
});

// The own e-mail (it also signs in): confirmed with the current password; only from a signed-in session
const OwnEmail = z.object({ email: Email, currentPassword: z.string().min(1).max(72) }).strict();

meRouter.patch('/', requireSession, async (req: Request, res: Response, next: NextFunction) => {
  if (req.user!.mustChangePassword) { res.status(403).json({ error: 'Password change required' }); return; }
  const p = OwnEmail.safeParse(req.body);
  if (!p.success) { bad(res, p.error); return; }
  try { res.json(await updateOwnEmail(req.user!.userId, p.data.email, p.data.currentPassword)); } catch (e) { fail(e, res, next); }
});

// ---------- users ----------

export const usersRouter = Router();
usersRouter.use(requireSession);

usersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const q = z.object({ companyId: IdParam.optional() }).safeParse(req.query);
  if (!q.success) { bad(res, q.error); return; }
  try { res.json({ items: await listUsers(req.user!, q.data.companyId) }); } catch (e) { fail(e, res, next); }
});

const CreateUser = z.object({ username: Username, email: Email, role: Role.default('member'), companyId: IdParam.optional() });

usersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const p = CreateUser.safeParse(req.body);
  if (!p.success) { bad(res, p.error); return; }
  try {
    const created = await createUser(req.user!, p.data);
    noStore(res);
    res.status(201).json(created);
  } catch (e) { fail(e, res, next); }
});

const UpdateUser = z.object({ email: Email.optional(), role: Role.optional(), active: z.boolean().optional() })
  .refine(v => Object.keys(v).length > 0, 'Nothing to change');

usersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  const p = UpdateUser.safeParse(req.body);
  if (!p.success) { bad(res, p.error); return; }
  try { res.json(await updateUser(req.user!, id.data, p.data)); } catch (e) { fail(e, res, next); }
});

usersRouter.post('/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid user ID' }); return; }
  try {
    const r = await resetPassword(req.user!, id.data);
    noStore(res);
    res.json(r);
  } catch (e) { fail(e, res, next); }
});

// ---------- companies (Sinosbyte administrators) ----------

export const companiesRouter = Router();
companiesRouter.use(requireSession);
companiesRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user!.role !== 'platform_admin') { res.status(403).json({ error: 'Administrator access required' }); return; }
  next();
});

companiesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json({ items: await listCompanies() }); } catch (e) { next(e); }
});

const CreateCompany = z.object({ name: CompanyName, admin: z.object({ username: Username, email: Email }) });

companiesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const p = CreateCompany.safeParse(req.body);
  if (!p.success) { bad(res, p.error); return; }
  try {
    const created = await createCompany(p.data);
    noStore(res);
    res.status(201).json(created);
  } catch (e) { fail(e, res, next); }
});

const UpdateCompany = z.object({ name: CompanyName.optional(), active: z.boolean().optional() })
  .refine(v => Object.keys(v).length > 0, 'Nothing to change');

companiesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = IdParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Invalid company ID' }); return; }
  const p = UpdateCompany.safeParse(req.body);
  if (!p.success) { bad(res, p.error); return; }
  try { res.json(await updateCompany(req.user!, id.data, p.data)); } catch (e) { fail(e, res, next); }
});
