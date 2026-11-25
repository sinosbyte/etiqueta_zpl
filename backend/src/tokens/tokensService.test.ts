process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from '../db/database';
import { apiTokensTable, companiesTable, designsTable, designVersionsTable, templatesTable, usersTable } from '../db/schema';
import { registerUser } from '../auth/authService';
import {
  createToken, listTokens, revokeToken, deleteToken, authenticateToken, parseAuthHeader, MAX_ACTIVE_TOKENS, TOKEN_PREFIX,
} from './tokensService';

// Tokens belong to the company (Fase 06, etapa 1): alice and carol are in company A, bob in company B.
let aliceId: number;
let carolId: number;
let bobId: number;
let companyA: number;
let companyB: number;
const alice = () => ({ userId: aliceId, companyId: companyA });
const carol = () => ({ userId: carolId, companyId: companyA });
const bob = () => ({ userId: bobId, companyId: companyB });

beforeAll(async () => {
  await initDb();
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(apiTokensTable);
  await db.delete(templatesTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
  await registerUser('alice', 'password123');
  await registerUser('bob', 'password123');
  const users = await db.select().from(usersTable);
  const a = users.find(u => u.username === 'alice')!;
  const b = users.find(u => u.username === 'bob')!;
  aliceId = a.id; companyA = a.companyId;
  bobId = b.id; companyB = b.companyId;
  const [c] = await db.insert(usersTable).values({ username: 'carol', passwordHash: 'x', companyId: companyA, role: 'member' }).returning();
  carolId = c.id;
});

afterAll(async () => {
  await _resetDb();
});

describe('createToken', () => {
  test('returns a zpd_ token and stores only its keyed hash, with the company and who generated it', async () => {
    const { token, summary } = await createToken(alice(), 'SAP A4H');
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(summary.name).toBe('SAP A4H');
    expect(summary.prefix).toBe(token.slice(0, TOKEN_PREFIX.length + 6));
    expect(summary.createdBy).toBe('alice');

    const rows = await getDb().select().from(apiTokensTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: companyA, userId: aliceId });
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // the raw token is nowhere in the table
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('the stored hash is keyed: it is not the plain SHA-256 of the token', async () => {
    const { token } = await createToken(alice(), 'sap');
    const [row] = await getDb().select().from(apiTokensTable);
    const plain = crypto.createHash('sha256').update(token).digest('hex');
    expect(row.tokenHash).not.toBe(plain);
    // and it is stable: the same token still authenticates
    await expect(authenticateToken(token)).resolves.toMatchObject({ companyId: companyA });
  });

  test('two tokens are never equal', async () => {
    const a = await createToken(alice(), 'a');
    const b = await createToken(alice(), 'b');
    expect(a.token).not.toBe(b.token);
  });

  test('the active limit is per company: colleagues share it, another company does not; revoked ones do not count', async () => {
    const first = await createToken(alice(), 't0');
    for (let i = 1; i < MAX_ACTIVE_TOKENS; i++) await createToken(i % 2 ? carol() : alice(), `t${i}`);
    await expect(createToken(carol(), 'one too many')).rejects.toThrow('TOKEN_LIMIT');
    await expect(createToken(bob(), 'other company')).resolves.toBeDefined();
    await revokeToken(companyA, first.summary.id);
    await expect(createToken(alice(), 'now it fits')).resolves.toBeDefined();
  });
});

describe('authenticateToken', () => {
  test('returns the company of a valid token (not a person)', async () => {
    const { token, summary } = await createToken(alice(), 'sap');
    await expect(authenticateToken(token)).resolves.toEqual({ tokenId: summary.id, companyId: companyA });
  });

  test('records last use', async () => {
    const { token, summary } = await createToken(alice(), 'sap');
    expect(summary.lastUsedAt).toBeNull();
    await authenticateToken(token);
    const [row] = await listTokens(companyA);
    expect(row.lastUsedAt).not.toBeNull();
  });

  test('rejects unknown, malformed and wrong-prefix tokens', async () => {
    await expect(authenticateToken('zpd_doesnotexist')).resolves.toBeNull();
    await expect(authenticateToken('not-a-token')).resolves.toBeNull();
    await expect(authenticateToken('')).resolves.toBeNull();
  });

  test('rejects a revoked token', async () => {
    const { token, summary } = await createToken(alice(), 'sap');
    await revokeToken(companyA, summary.id);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });

  test('rejects an expired token', async () => {
    const { token, summary } = await createToken(alice(), 'sap', 30);
    await getDb().update(apiTokensTable)
      .set({ expiresAt: sql`now() - interval '1 day'` })
      .where(sql`${apiTokensTable.id} = ${summary.id}`);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });

  test('keeps working when whoever generated it is deactivated or deleted (the token is the company one)', async () => {
    const { token, summary } = await createToken(alice(), 'sap');
    await getDb().update(usersTable).set({ active: false }).where(eq(usersTable.id, aliceId));
    await expect(authenticateToken(token)).resolves.toMatchObject({ companyId: companyA });
    await getDb().delete(usersTable).where(eq(usersTable.id, aliceId));
    await expect(authenticateToken(token)).resolves.toMatchObject({ companyId: companyA });
    const [row] = await listTokens(companyA);
    expect(row).toMatchObject({ id: summary.id, createdBy: null });
  });

  test('stops working while the company is deactivated, and works again when it is reactivated', async () => {
    const { token } = await createToken(alice(), 'sap');
    await getDb().update(companiesTable).set({ active: false }).where(eq(companiesTable.id, companyA));
    await expect(authenticateToken(token)).resolves.toBeNull();
    await getDb().update(companiesTable).set({ active: true }).where(eq(companiesTable.id, companyA));
    await expect(authenticateToken(token)).resolves.toMatchObject({ companyId: companyA });
  });
});

describe('belongs to the company', () => {
  test('listTokens shows the company tokens (from any colleague), never another company ones, a hash or the token', async () => {
    const mine = await createToken(alice(), 'mine');
    await createToken(carol(), 'colleague');
    await createToken(bob(), 'his');
    const list = await listTokens(companyA);
    expect(list.map(t => t.name).sort()).toEqual(['colleague', 'mine']);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'createdBy', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt']);
    expect(JSON.stringify(list)).not.toContain(mine.token);
  });

  test('a colleague can revoke a token another administrator of the company generated', async () => {
    const { token, summary } = await createToken(alice(), 'alice sap');
    await expect(revokeToken(companyA, summary.id)).resolves.toBe(true);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });

  test('another company cannot revoke or delete it', async () => {
    const { token, summary } = await createToken(alice(), 'alice sap');
    await expect(revokeToken(companyB, summary.id)).resolves.toBe(false);
    await expect(deleteToken(companyB, summary.id)).resolves.toBe(false);
    expect(await listTokens(companyA)).toHaveLength(1);
    await expect(authenticateToken(token)).resolves.toMatchObject({ companyId: companyA });
  });

  test('deleting removes the token for good (it leaves the list and stops working)', async () => {
    const { token, summary } = await createToken(alice(), 'to delete');
    await expect(deleteToken(companyA, summary.id)).resolves.toBe(true);
    expect(await listTokens(companyA)).toHaveLength(0);
    await expect(authenticateToken(token)).resolves.toBeNull();
    await expect(deleteToken(companyA, summary.id)).resolves.toBe(false);
  });

  test('a revoked token can be deleted too', async () => {
    const { summary } = await createToken(alice(), 'old');
    await revokeToken(companyA, summary.id);
    await expect(deleteToken(companyA, summary.id)).resolves.toBe(true);
    expect(await listTokens(companyA)).toHaveLength(0);
  });

  test('revoking twice or an unknown id returns false', async () => {
    const { summary } = await createToken(alice(), 'x');
    await expect(revokeToken(companyA, summary.id)).resolves.toBe(true);
    await expect(revokeToken(companyA, summary.id)).resolves.toBe(false);
    await expect(revokeToken(companyA, 999999)).resolves.toBe(false);
  });
});

describe('parseAuthHeader', () => {
  const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  test('reads a Bearer integration token', () => {
    expect(parseAuthHeader('Bearer zpd_abc123')).toBe('zpd_abc123');
  });

  test('reads the password of an HTTP Basic header (SM59)', () => {
    expect(parseAuthHeader(basic('guilherme.f', 'zpd_abc123'))).toBe('zpd_abc123');
  });

  test('a password that itself contains a colon is kept whole', () => {
    expect(parseAuthHeader(basic('u', 'zpd_a:b'))).toBe('zpd_a:b');
  });

  test('ignores JWTs, other Basic passwords, other schemes and no header', () => {
    expect(parseAuthHeader('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x')).toBeNull();
    expect(parseAuthHeader(basic('u', 'plain-password'))).toBeNull();
    expect(parseAuthHeader('Digest abc')).toBeNull();
    expect(parseAuthHeader(undefined)).toBeNull();
    expect(parseAuthHeader('')).toBeNull();
  });
});
