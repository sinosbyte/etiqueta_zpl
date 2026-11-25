import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/database';
import { companiesTable, refreshTokensTable, usersTable, UserRole } from '../db/schema';
import { RequestUser, isAdminRole } from '../auth/account';

/**
 * Administration of users and companies (Fase 05, etapa 3).
 *
 *  - A Sinosbyte administrator (platform_admin) belongs to the platform company (Fase 06, etapa 2). They manage the
 *    companies, the other Sinosbyte administrators and only the ADMINISTRATORS of each client company (create, reset the
 *    password, deactivate): never the client's other users, and they change nobody's role.
 *  - A company administrator (company_admin) manages the users of their own company, but never a platform_admin and
 *    never gives that role.
 *  - Nobody changes their own role or status; a company keeps at least one active administrator, and the platform at
 *    least one active platform_admin; the account the SAP integration logs in with (legacy mode) cannot be disabled.
 *  - Users are never deleted (their designs belong to the company): they are deactivated.
 *  - A new or reset password is generated here, returned once, and must be changed at the first login.
 */

export class UsersError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'UsersError';
  }
}

const err = {
  notFound: () => new UsersError(404, 'User not found'),
  companyNotFound: () => new UsersError(404, 'Company not found'),
  forbidden: () => new UsersError(403, 'Administrator access required'),
  roleNotAllowed: () => new UsersError(403, 'You cannot give this role'),
  usernameTaken: () => new UsersError(409, 'Username already taken'),
  emailTaken: () => new UsersError(409, 'E-mail already in use'),
  self: () => new UsersError(409, 'You cannot change your own role or status'),
  selfReset: () => new UsersError(409, 'Use the change of your own password instead'),
  lastAdmin: () => new UsersError(409, 'A company needs at least one active administrator'),
  lastPlatformAdmin: () => new UsersError(409, 'At least one active Sinosbyte administrator is needed'),
  protectedAccount: () => new UsersError(409, 'This account is used by the SAP integration and cannot be disabled'),
  companyNameTaken: () => new UsersError(409, 'Company name already taken'),
  ownCompany: () => new UsersError(409, 'You cannot disable your own company'),
  platformScope: () => new UsersError(403, 'Sinosbyte administrators manage only the administrators of a company'),
};

/** The account the SAP capture logs in with while the legacy mode exists (see CLAUDE.md §8.2) */
export const PROTECTED_USERNAMES: readonly string[] = ['sinosbyte'];

export interface UserSummary {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  companyId: number;
  createdAt: string;
}

export interface CompanySummary {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  userCount: number;
  designCount: number;
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const userColumns = {
  id: usersTable.id,
  username: usersTable.username,
  email: usersTable.email,
  role: usersTable.role,
  active: usersTable.active,
  mustChangePassword: usersTable.mustChangePassword,
  companyId: usersTable.companyId,
  createdAt: usersTable.createdAt,
};

const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
const toSummary = (r: any): UserSummary => ({ ...r, createdAt: iso(r.createdAt) });

// ---------- temporary passwords ----------

/** No 0/O, 1/l/I: it is read on a screen and typed by someone else. 14 characters from 55 = ~80 bits. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export function temporaryPassword(length = 14): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

const hash = (password: string) => bcrypt.hash(password, 10);

/** The constraint behind a unique violation, if any (drizzle wraps the driver error in `cause`) */
function violated(e: unknown): string | null {
  let cur: any = e;
  while (cur) {
    if (cur.code === '23505') return String(cur.constraint ?? '');
    cur = cur.cause;
  }
  return null;
}
function rethrowUnique(e: unknown): never {
  const c = violated(e);
  if (c === null) throw e;
  if (c.includes('email')) throw err.emailTaken();
  throw err.usernameTaken();
}

// ---------- who may do what ----------

/** The company a list or a new user refers to: an administrator of a company only ever reaches their own */
function companyFor(actor: RequestUser, companyId?: number): number {
  if (actor.role === 'platform_admin') return companyId ?? actor.companyId;
  if (actor.role === 'company_admin') {
    if (companyId !== undefined && companyId !== actor.companyId) throw err.forbidden();
    return actor.companyId;
  }
  throw err.forbidden();
}

/**
 * The role a new user may get. In the platform company only Sinosbyte administrators exist; a Sinosbyte administrator
 * creates only the administrators of a client company; a company administrator never gives the Sinosbyte role.
 */
function mayGive(actor: RequestUser, role: UserRole, platformCompany: boolean): boolean {
  if (actor.role === 'platform_admin') return platformCompany ? role === 'platform_admin' : role === 'company_admin';
  return actor.role === 'company_admin' && role !== 'platform_admin' && !platformCompany;
}

async function isPlatformCompany(db: Db | Tx, companyId: number): Promise<boolean> {
  const [c] = await db.select({ isPlatform: companiesTable.isPlatform }).from(companiesTable).where(eq(companiesTable.id, companyId));
  return !!c?.isPlatform;
}

/** The user `id` as the actor may see it: another company's user is "not found"; a platform_admin is off limits to a company admin */
async function reachable(db: Db | Tx, actor: RequestUser, id: number) {
  if (!isAdminRole(actor.role)) throw err.forbidden();
  const [target] = await db.select(userColumns).from(usersTable).where(eq(usersTable.id, id));
  if (!target) throw err.notFound();
  if (actor.role === 'company_admin') {
    if (target.companyId !== actor.companyId) throw err.notFound();
    if (target.role === 'platform_admin') throw err.forbidden();
  }
  // A Sinosbyte administrator reaches the other Sinosbyte administrators and the administrators of a client company
  if (actor.role === 'platform_admin' && target.role === 'member') throw err.platformScope();
  return target;
}

/** Sessions end at once (the next refresh fails); the access token in hand is refused by the check on every request */
const revokeUserSessions = (db: Db | Tx, userId: number) => db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, userId));
const revokeCompanySessions = (db: Db | Tx, companyId: number) =>
  db.execute(sql`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = ${companyId})`);

// ---------- users ----------

export async function listUsers(actor: RequestUser, companyId?: number): Promise<UserSummary[]> {
  const company = companyFor(actor, companyId);
  const rows = await getDb().select(userColumns).from(usersTable).where(eq(usersTable.companyId, company)).orderBy(asc(usersTable.username));
  // A Sinosbyte administrator sees only the administrators of a client company, not its other users
  const shown = actor.role === 'platform_admin' ? rows.filter(r => r.role !== 'member') : rows;
  return shown.map(toSummary);
}

export interface NewUser { username: string; email: string; role: UserRole; companyId?: number }

export async function createUser(actor: RequestUser, input: NewUser): Promise<{ user: UserSummary; temporaryPassword: string }> {
  const company = companyFor(actor, input.companyId);
  const db = getDb();
  const [c] = await db.select({ id: companiesTable.id, isPlatform: companiesTable.isPlatform }).from(companiesTable).where(eq(companiesTable.id, company));
  if (!c) throw err.companyNotFound();
  if (!mayGive(actor, input.role, c.isPlatform)) throw err.roleNotAllowed();
  const password = temporaryPassword();
  try {
    const [row] = await db.insert(usersTable).values({
      username: input.username, email: input.email, role: input.role, isAdmin: input.role === 'platform_admin',
      companyId: company, passwordHash: await hash(password), mustChangePassword: true,
    }).returning(userColumns);
    return { user: toSummary(row), temporaryPassword: password };
  } catch (e) {
    rethrowUnique(e);
  }
}

export interface UserChanges { email?: string; role?: UserRole; active?: boolean }

export async function updateUser(actor: RequestUser, id: number, changes: UserChanges): Promise<UserSummary> {
  try {
    return await getDb().transaction(async tx => {
      const target = await reachable(tx, actor, id);
      const roleChanges = changes.role !== undefined && changes.role !== target.role;
      const activeChanges = changes.active !== undefined && changes.active !== target.active;
      if ((roleChanges || activeChanges) && target.id === actor.userId) throw err.self();
      // Nobody moves a user in or out of the Sinosbyte role, and a Sinosbyte administrator changes no client's role
      if (roleChanges && (actor.role === 'platform_admin' || target.role === 'platform_admin' || changes.role === 'platform_admin'
        || !mayGive(actor, changes.role!, await isPlatformCompany(tx, target.companyId)))) throw err.roleNotAllowed();
      if (changes.active === false && target.active && PROTECTED_USERNAMES.includes(target.username)) throw err.protectedAccount();

      const nextRole = changes.role ?? target.role;
      const nextActive = changes.active ?? target.active;

      // A client company keeps an active administrator (the row lock serialises two changes in the same company); the
      // platform company is covered by the rule below
      if (target.active && target.role === 'company_admin' && (!nextActive || !isAdminRole(nextRole))) {
        await tx.execute(sql`SELECT id FROM companies WHERE id = ${target.companyId} FOR UPDATE`);
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM users
          WHERE company_id = ${target.companyId} AND active AND role IN ('platform_admin', 'company_admin') AND id <> ${target.id}`)).rows as any[];
        if (n === 0) throw err.lastAdmin();
      }
      // The platform keeps an active Sinosbyte administrator
      if (target.active && target.role === 'platform_admin' && (!nextActive || nextRole !== 'platform_admin')) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7240914)`);
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM users
          WHERE active AND role = 'platform_admin' AND id <> ${target.id}`)).rows as any[];
        if (n === 0) throw err.lastPlatformAdmin();
      }

      const [row] = await tx.update(usersTable).set({
        ...(changes.email !== undefined ? { email: changes.email } : {}),
        role: nextRole,
        isAdmin: nextRole === 'platform_admin',
        active: nextActive,
      }).where(eq(usersTable.id, target.id)).returning(userColumns);
      if (!nextActive) await revokeUserSessions(tx, target.id);
      return toSummary(row);
    });
  } catch (e) {
    if (e instanceof UsersError) throw e;
    rethrowUnique(e);
  }
}

export async function resetPassword(actor: RequestUser, id: number): Promise<{ user: UserSummary; temporaryPassword: string }> {
  const db = getDb();
  const target = await reachable(db, actor, id);
  if (target.id === actor.userId) throw err.selfReset();
  const password = temporaryPassword();
  const [row] = await db.update(usersTable).set({ passwordHash: await hash(password), mustChangePassword: true })
    .where(eq(usersTable.id, target.id)).returning(userColumns);
  await revokeUserSessions(db, target.id);
  return { user: toSummary(row), temporaryPassword: password };
}

// ---------- companies (Sinosbyte administrators only; the route checks the role) ----------

/** The client companies: the platform company is never listed */
export async function listCompanies(): Promise<CompanySummary[]> {
  return companiesWhere(getDb(), sql`NOT c.is_platform`);
}

async function companiesWhere(db: Db | Tx, where: ReturnType<typeof sql>): Promise<CompanySummary[]> {
  const rows = (await db.execute(sql`
    SELECT c.id, c.name, c.active, c.created_at AS "createdAt",
           (SELECT count(*)::int FROM users u WHERE u.company_id = c.id) AS "userCount",
           (SELECT count(*)::int FROM designs d WHERE d.company_id = c.id) AS "designCount"
      FROM companies c WHERE ${where} ORDER BY lower(c.name), c.id`)).rows as any[];
  return rows.map(r => ({ ...r, createdAt: iso(r.createdAt) }));
}

/** Names are unique whatever the case; checked under a lock, since two administrators could create at once */
async function nameFree(tx: Tx, name: string, except?: number): Promise<boolean> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(7240915)`);
  const rows = (await tx.execute(sql`SELECT 1 FROM companies WHERE lower(name) = lower(${name}) ${except !== undefined ? sql`AND id <> ${except}` : sql``}`)).rows;
  return rows.length === 0;
}

export interface NewCompany { name: string; admin: { username: string; email: string } }

export async function createCompany(input: NewCompany): Promise<{ company: CompanySummary; user: UserSummary; temporaryPassword: string }> {
  const password = temporaryPassword();
  const passwordHash = await hash(password);
  try {
    return await getDb().transaction(async tx => {
      if (!(await nameFree(tx, input.name))) throw err.companyNameTaken();
      const [company] = await tx.insert(companiesTable).values({ name: input.name }).returning();
      const [user] = await tx.insert(usersTable).values({
        username: input.admin.username, email: input.admin.email, role: 'company_admin', isAdmin: false,
        companyId: company.id, passwordHash, mustChangePassword: true,
      }).returning(userColumns);
      return {
        company: { id: company.id, name: company.name, active: company.active, createdAt: iso(company.createdAt), userCount: 1, designCount: 0 },
        user: toSummary(user),
        temporaryPassword: password,
      };
    });
  } catch (e) {
    if (e instanceof UsersError) throw e;
    rethrowUnique(e);
  }
}

export interface CompanyChanges { name?: string; active?: boolean }

export async function updateCompany(actor: RequestUser, id: number, changes: CompanyChanges): Promise<CompanySummary> {
  return getDb().transaction(async tx => {
    const [company] = await tx.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!company || company.isPlatform) throw err.companyNotFound();
    if (changes.active === false && company.id === actor.companyId) throw err.ownCompany();
    if (changes.name !== undefined && !(await nameFree(tx, changes.name, id))) throw err.companyNameTaken();
    await tx.update(companiesTable).set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.active !== undefined ? { active: changes.active } : {}),
    }).where(eq(companiesTable.id, id));
    if (changes.active === false) await revokeCompanySessions(tx, id);
    return (await companiesWhere(tx, sql`c.id = ${id}`))[0];
  });
}

