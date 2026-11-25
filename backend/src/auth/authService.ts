import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, isUniqueViolation } from '../db/database';
import { usersTable, refreshTokensTable, companiesTable } from '../db/schema';
import { loadAccount, isUsable } from './account';
import { JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRES_IN, REFRESH_TOKEN_TTL_MS } from '../config';

export interface JwtPayload {
  userId: number;
  username: string;
  /** Set only when the request was authenticated with an integration token (read-only). Never part of a JWT. */
  viaToken?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(username: string, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, 10);
  try {
    // While sign-up is still open every new user gets a company of their own (named after the username), as the
    // migration did for the existing ones; if the username is taken the whole thing is undone, company included
    await getDb().transaction(async tx => {
      const [company] = await tx.insert(companiesTable).values({ name: username }).returning({ id: companiesTable.id });
      await tx.insert(usersTable).values({ username, passwordHash: hash, companyId: company.id, role: 'company_admin' });
    });
  } catch (e) {
    // PG unique_violation — only the username constraint can fire here
    if (isUniqueViolation(e)) throw new Error('USERNAME_TAKEN');
    throw e;
  }
}

/**
 * Validate credentials, returning the JWT payload. Throws INVALID_CREDENTIALS; ACCOUNT_DISABLED when the password is
 * right but the user or the company is inactive (said only after the right password, so it does not tell which
 * accounts exist).
 */
export async function verifyCredentials(username: string, password: string): Promise<JwtPayload & { mustChangePassword: boolean }> {
  const rows = await getDb().select().from(usersTable).where(eq(usersTable.username, username));
  const row = rows[0];
  if (!row) throw new Error('INVALID_CREDENTIALS');
  const match = await bcrypt.compare(password, row.passwordHash);
  if (!match) throw new Error('INVALID_CREDENTIALS');
  if (!isUsable(await loadAccount(row.id))) throw new Error('ACCOUNT_DISABLED');
  return { userId: row.id, username: row.username, mustChangePassword: row.mustChangePassword };
}

/** Sign a short-lived access token. It carries only the user: role, company and status are read on every request. */
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign({ userId: payload.userId, username: payload.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM });
}

/** Backwards-compatible login helper: validate credentials → access token. */
export async function loginUser(username: string, password: string): Promise<string> {
  return signAccessToken(await verifyCredentials(username, password));
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Mint a new opaque refresh token, persisting only its hash. */
async function issueRefreshToken(userId: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await getDb().insert(refreshTokensTable).values({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return raw;
}

/** Issue a fresh access + refresh token pair for an authenticated user. */
export async function issueTokens(payload: JwtPayload): Promise<TokenPair> {
  const accessToken = signAccessToken(payload);
  const refreshToken = await issueRefreshToken(payload.userId);
  return { accessToken, refreshToken };
}

/**
 * Rotate a refresh token: consume the presented one (single-use) and, if it was
 * valid and unexpired, issue a fresh pair. Returns null for unknown/expired
 * tokens (the caller should treat this as "please log in again").
 */
export async function rotateRefreshToken(raw: string): Promise<TokenPair | null> {
  const db = getDb();
  const hash = hashToken(raw);
  const rows = await db.select().from(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, hash));
  const row = rows[0];
  if (!row) return null;

  // Single-use: delete on presentation regardless of validity.
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, row.id));
  if (row.expiresAt.getTime() < Date.now()) return null;

  // An inactive user or company gets no new session
  const account = await loadAccount(row.userId);
  if (!isUsable(account)) return null;

  return issueTokens({ userId: account.userId, username: account.username });
}

/**
 * The user changes their own password (also the temporary one an administrator gave). Every other session of the
 * user ends, and a fresh pair is returned for this one. Throws INVALID_CREDENTIALS (wrong current password) and
 * SAME_PASSWORD.
 */
export async function changePassword(userId: number, current: string, next: string): Promise<TokenPair> {
  const db = getDb();
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!row || !(await bcrypt.compare(current, row.passwordHash))) throw new Error('INVALID_CREDENTIALS');
  if (current === next) throw new Error('SAME_PASSWORD');
  await db.update(usersTable).set({ passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false }).where(eq(usersTable.id, userId));
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, userId));
  return issueTokens({ userId: row.id, username: row.username });
}

/** Revoke a refresh token (logout). No-op if it doesn't exist. */
export async function revokeRefreshToken(raw: string): Promise<void> {
  await getDb().delete(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, hashToken(raw)));
}
