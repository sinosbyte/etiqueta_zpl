import { eq } from 'drizzle-orm';
import { getDb } from '../db/database';
import { usersTable, companiesTable, UserRole } from '../db/schema';

/**
 * Who is making a request, read from the database on every request (Fase 05, etapa 3). The login token carries only
 * the user id and name; the role, the company and whether the user and the company are active come from here, so that
 * deactivating someone or changing their role takes effect at once.
 */
export interface Account {
  userId: number;
  username: string;
  email: string | null;
  role: UserRole;
  companyId: number;
  companyName: string;
  active: boolean;
  companyActive: boolean;
  mustChangePassword: boolean;
}

/** What a route sees as `req.user` */
export interface RequestUser {
  userId: number;
  username: string;
  role: UserRole;
  companyId: number;
  mustChangePassword: boolean;
  /** Set only when the request was authenticated with an integration token (read-only) */
  viaToken?: boolean;
}

export async function loadAccount(userId: number): Promise<Account | null> {
  const rows = await getDb()
    .select({
      userId: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      role: usersTable.role,
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
      active: usersTable.active,
      companyActive: companiesTable.active,
      mustChangePassword: usersTable.mustChangePassword,
    })
    .from(usersTable)
    .innerJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
    .where(eq(usersTable.id, userId));
  return rows[0] ?? null;
}

/** An account that may use the application: the user and the company are active */
export const isUsable = (a: Account | null): a is Account => !!a && a.active && a.companyActive;

/** Administrators of a company: its company_admin users and the Sinosbyte platform administrators in it */
export const isAdminRole = (role: UserRole): boolean => role === 'platform_admin' || role === 'company_admin';

export const ROLES: readonly UserRole[] = ['platform_admin', 'company_admin', 'member'];
