import { eq, sql, SQL } from 'drizzle-orm';
import { designsTable } from '../db/schema';

/**
 * The designs a user may reach: the ones of the company the user belongs to (Fase 05, etapa 2). The company is read in
 * the same query, so a user without one (or an unknown id) matches nothing: it fails closed.
 *
 * Integration tokens read through the same functions, so a token sees the designs of the company of its owner.
 */
export function inCompanyOf(userId: number): SQL {
  return eq(designsTable.companyId, sql`(SELECT "company_id" FROM "users" WHERE "id" = ${userId})`);
}
