import crypto from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/database';
import { apiTokensTable, usersTable, companiesTable } from '../db/schema';
import { JWT_SECRET } from '../config';

/** Every integration token starts with this, so it is easy to recognise (and to scan for in leaks). */
export const TOKEN_PREFIX = 'zpd_';

/** Active tokens one company may hold at the same time. */
export const MAX_ACTIVE_TOKENS = 10;

/** last_used_at is refreshed at most this often, so reading designs does not write on every request. */
const LAST_USED_REFRESH_MINUTES = 5;

// All times (created, last used, expiry, revocation) come from the database clock, never from the
// Node process: mixing the two shows hours of difference when their time zones differ.
//
// A token belongs to the COMPANY (Fase 06, etapa 1): it reads the designs of its company while the company is active,
// whoever generated it. Deactivating or deleting that person does not stop it. Only administrators manage them.

export interface TokenSummary {
  id: number;
  name: string;
  /** First characters of the token, to tell tokens apart. The rest is never stored. */
  prefix: string;
  /** Who generated it; null once that user no longer exists */
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** What a valid token stands for: its company (not a person) */
export interface TokenOwner {
  tokenId: number;
  companyId: number;
}

// Tokens are 256 random bits, so a fast keyed hash is the right tool (a slow password hash adds nothing).
// HMAC-SHA256 with a key derived from the server secret: a leaked database alone cannot be used to check
// guesses, and the key is separate from the one that signs JWTs. Changing JWT_SECRET invalidates the tokens.
const HASH_KEY = Buffer.from(crypto.hkdfSync('sha256', JWT_SECRET, '', 'zpl-api-token-hash', 32));

const hashToken = (raw: string): string => crypto.createHmac('sha256', HASH_KEY).update(raw).digest('hex');

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Who acts on the tokens: an administrator of the company */
export interface TokenActor {
  userId: number;
  companyId: number;
}

/**
 * Creates a token of the actor's company and returns it. This is the ONLY time the raw token exists:
 * the database keeps only its keyed hash (HMAC-SHA256). Throws TOKEN_LIMIT past MAX_ACTIVE_TOKENS.
 */
export async function createToken(
  actor: TokenActor,
  name: string,
  expiresInDays?: number,
): Promise<{ token: string; summary: TokenSummary }> {
  const db = getDb();
  const active = await db.select({ n: sql<number>`count(*)::int` }).from(apiTokensTable).where(and(
    eq(apiTokensTable.companyId, actor.companyId),
    sql`${apiTokensTable.revokedAt} is null`,
    sql`(${apiTokensTable.expiresAt} is null or ${apiTokensTable.expiresAt} > now())`,
  ));
  if ((active[0]?.n ?? 0) >= MAX_ACTIVE_TOKENS) throw new Error('TOKEN_LIMIT');

  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = expiresInDays ? sql`now() + (${expiresInDays} * interval '1 day')` : null;
  const [row] = await db.insert(apiTokensTable).values({
    companyId: actor.companyId,
    userId: actor.userId,
    name,
    tokenHash: hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    expiresAt,
  }).returning({ id: apiTokensTable.id });
  const [summary] = await summaries(eq(apiTokensTable.id, row.id));
  return { token, summary };
}

/** The tokens matching `where`, with the name of who generated each, newest first. Never includes the hash. */
async function summaries(where: ReturnType<typeof eq>): Promise<TokenSummary[]> {
  const rows = await getDb().select({
    id: apiTokensTable.id,
    name: apiTokensTable.name,
    prefix: apiTokensTable.prefix,
    createdBy: usersTable.username,
    createdAt: apiTokensTable.createdAt,
    lastUsedAt: apiTokensTable.lastUsedAt,
    expiresAt: apiTokensTable.expiresAt,
    revokedAt: apiTokensTable.revokedAt,
  }).from(apiTokensTable)
    .leftJoin(usersTable, eq(usersTable.id, apiTokensTable.userId))
    .where(where)
    .orderBy(desc(apiTokensTable.createdAt), desc(apiTokensTable.id));
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: iso(r.lastUsedAt),
    expiresAt: iso(r.expiresAt),
    revokedAt: iso(r.revokedAt),
  }));
}

/** The company's tokens, newest first. */
export async function listTokens(companyId: number): Promise<TokenSummary[]> {
  return summaries(eq(apiTokensTable.companyId, companyId));
}

/** Revokes one of the company's tokens. False when it is another company's, does not exist or is already revoked. */
export async function revokeToken(companyId: number, tokenId: number): Promise<boolean> {
  const rows = await getDb().update(apiTokensTable)
    .set({ revokedAt: sql`now()` })
    .where(and(
      eq(apiTokensTable.id, tokenId),
      eq(apiTokensTable.companyId, companyId),
      sql`${apiTokensTable.revokedAt} is null`,
    ))
    .returning({ id: apiTokensTable.id });
  return rows.length > 0;
}

/**
 * Deletes one of the company's tokens for good (an active one stops working too).
 * False when it is another company's or does not exist.
 */
export async function deleteToken(companyId: number, tokenId: number): Promise<boolean> {
  const rows = await getDb().delete(apiTokensTable)
    .where(and(eq(apiTokensTable.id, tokenId), eq(apiTokensTable.companyId, companyId)))
    .returning({ id: apiTokensTable.id });
  return rows.length > 0;
}

/** The company of a valid token (not revoked, not expired, company active), or null. */
export async function authenticateToken(raw: string): Promise<TokenOwner | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const db = getDb();
  const rows = await db.select({
    id: apiTokensTable.id,
    companyId: apiTokensTable.companyId,
    companyActive: companiesTable.active,
    revokedAt: apiTokensTable.revokedAt,
    expired: sql<boolean>`(${apiTokensTable.expiresAt} is not null and ${apiTokensTable.expiresAt} <= now())`,
    stale: sql<boolean>`(${apiTokensTable.lastUsedAt} is null or ${apiTokensTable.lastUsedAt} < now() - (${LAST_USED_REFRESH_MINUTES} * interval '1 minute'))`,
  }).from(apiTokensTable)
    .innerJoin(companiesTable, eq(companiesTable.id, apiTokensTable.companyId))
    .where(eq(apiTokensTable.tokenHash, hashToken(raw)));
  const row = rows[0];
  // A token of an inactive company stops working (it is not revoked: it works again if the company is reactivated)
  if (!row || row.revokedAt || row.expired || !row.companyActive) return null;

  if (row.stale) {
    await db.update(apiTokensTable).set({ lastUsedAt: sql`now()` }).where(eq(apiTokensTable.id, row.id));
  }
  return { tokenId: row.id, companyId: row.companyId };
}

/**
 * The integration token carried by an Authorization header, or null when the header has none.
 * Two forms are accepted: `Bearer zpd_...` (API clients) and HTTP Basic with the token as the
 * password (`Basic base64(user:zpd_...)`), which is how an SAP SM59 destination sends it.
 * Anything else (including a JWT) is not a token: the caller falls back to the JWT check.
 */
export function parseAuthHeader(header: string | undefined): string | null {
  if (!header) return null;
  if (header.startsWith('Bearer ')) {
    const value = header.slice(7).trim();
    return value.startsWith(TOKEN_PREFIX) ? value : null;
  }
  if (header.startsWith('Basic ')) {
    let decoded: string;
    try {
      decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    } catch {
      return null;
    }
    const tail = decoded.slice(decoded.indexOf(':') + 1);
    return tail.startsWith(TOKEN_PREFIX) ? tail : null;
  }
  return null;
}
