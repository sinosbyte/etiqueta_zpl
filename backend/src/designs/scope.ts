import { eq, sql, SQL } from 'drizzle-orm';
import { designsTable } from '../db/schema';
import type { RequestUser } from '../auth/account';

/**
 * Who is reading designs: a person (their user id) or an integration token (the company it belongs to, Fase 06).
 * Writing is only ever done by a person, so the functions that change designs still take a user id.
 */
export type Who = number | { companyId: number };

/** The `Who` of a request: the company of the token, or the signed-in user */
export const whoOf = (user: RequestUser): Who => (user.viaToken ? { companyId: user.companyId } : user.userId);

/**
 * The designs one may reach: the ones of the company (Fase 05, etapa 2). For a person the company is read in the same
 * query, so a user without one (or an unknown id) matches nothing: it fails closed. A token reads its own company.
 */
export function inCompanyOf(who: Who): SQL {
  if (typeof who === 'number') {
    return eq(designsTable.companyId, sql`(SELECT "company_id" FROM "users" WHERE "id" = ${who})`);
  }
  return eq(designsTable.companyId, who.companyId);
}
