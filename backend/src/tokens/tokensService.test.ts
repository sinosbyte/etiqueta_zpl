process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from '../db/database';
import { apiTokensTable, designsTable, designVersionsTable, templatesTable, usersTable } from '../db/schema';
import { registerUser } from '../auth/authService';
import {
  createToken, listTokens, revokeToken, authenticateToken, extractApiToken, MAX_ACTIVE_TOKENS, TOKEN_PREFIX,
} from './tokensService';

let aliceId: number;
let bobId: number;

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
  await registerUser('alice', 'password123');
  await registerUser('bob', 'password123');
  const users = await db.select().from(usersTable);
  aliceId = users.find(u => u.username === 'alice')!.id;
  bobId = users.find(u => u.username === 'bob')!.id;
});

afterAll(async () => {
  await _resetDb();
});

describe('createToken', () => {
  test('returns a zpd_ token and stores only its SHA-256 hash', async () => {
    const { token, summary } = await createToken(aliceId, 'SAP A4H');
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(summary.name).toBe('SAP A4H');
    expect(summary.prefix).toBe(token.slice(0, TOKEN_PREFIX.length + 6));

    const rows = await getDb().select().from(apiTokensTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // the raw token is nowhere in the table
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('two tokens are never equal', async () => {
    const a = await createToken(aliceId, 'a');
    const b = await createToken(aliceId, 'b');
    expect(a.token).not.toBe(b.token);
  });

  test('refuses a new token past the active limit; revoked tokens do not count', async () => {
    const first = await createToken(aliceId, 't0');
    for (let i = 1; i < MAX_ACTIVE_TOKENS; i++) await createToken(aliceId, `t${i}`);
    await expect(createToken(aliceId, 'one too many')).rejects.toThrow('TOKEN_LIMIT');
    await revokeToken(aliceId, first.summary.id);
    await expect(createToken(aliceId, 'now it fits')).resolves.toBeDefined();
  });
});

describe('authenticateToken', () => {
  test('returns the owner of a valid token', async () => {
    const { token } = await createToken(aliceId, 'sap');
    await expect(authenticateToken(token)).resolves.toEqual({ userId: aliceId, username: 'alice' });
  });

  test('records last use', async () => {
    const { token, summary } = await createToken(aliceId, 'sap');
    expect(summary.lastUsedAt).toBeNull();
    await authenticateToken(token);
    const [row] = await listTokens(aliceId);
    expect(row.lastUsedAt).not.toBeNull();
  });

  test('rejects unknown, malformed and wrong-prefix tokens', async () => {
    await expect(authenticateToken('zpd_doesnotexist')).resolves.toBeNull();
    await expect(authenticateToken('not-a-token')).resolves.toBeNull();
    await expect(authenticateToken('')).resolves.toBeNull();
  });

  test('rejects a revoked token', async () => {
    const { token, summary } = await createToken(aliceId, 'sap');
    await revokeToken(aliceId, summary.id);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });

  test('rejects an expired token', async () => {
    const { token, summary } = await createToken(aliceId, 'sap', 30);
    await getDb().update(apiTokensTable)
      .set({ expiresAt: sql`now() - interval '1 day'` })
      .where(sql`${apiTokensTable.id} = ${summary.id}`);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });

  test('stops working when the user is deleted', async () => {
    const { token } = await createToken(aliceId, 'sap');
    await getDb().delete(usersTable).where(sql`${usersTable.id} = ${aliceId}`);
    await expect(authenticateToken(token)).resolves.toBeNull();
  });
});

describe('ownership', () => {
  test('listTokens shows only the caller own tokens and never a hash or the token', async () => {
    const mine = await createToken(aliceId, 'mine');
    await createToken(bobId, 'his');
    const list = await listTokens(aliceId);
    expect(list.map(t => t.name)).toEqual(['mine']);
    expect(Object.keys(list[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt']);
    expect(JSON.stringify(list)).not.toContain(mine.token);
  });

  test('a user cannot revoke another user token', async () => {
    const { token, summary } = await createToken(aliceId, 'alice sap');
    await expect(revokeToken(bobId, summary.id)).resolves.toBe(false);
    await expect(authenticateToken(token)).resolves.toEqual({ userId: aliceId, username: 'alice' });
  });

  test('revoking twice or an unknown id returns false', async () => {
    const { summary } = await createToken(aliceId, 'x');
    await expect(revokeToken(aliceId, summary.id)).resolves.toBe(true);
    await expect(revokeToken(aliceId, summary.id)).resolves.toBe(false);
    await expect(revokeToken(aliceId, 999999)).resolves.toBe(false);
  });
});

describe('extractApiToken', () => {
  const basic = (user: string, pass: string) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

  test('reads a Bearer integration token', () => {
    expect(extractApiToken('Bearer zpd_abc123')).toBe('zpd_abc123');
  });

  test('reads the password of an HTTP Basic header (SM59)', () => {
    expect(extractApiToken(basic('guilherme.f', 'zpd_abc123'))).toBe('zpd_abc123');
  });

  test('a password that itself contains a colon is kept whole', () => {
    expect(extractApiToken(basic('u', 'zpd_a:b'))).toBe('zpd_a:b');
  });

  test('ignores JWTs, other Basic passwords, other schemes and no header', () => {
    expect(extractApiToken('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x')).toBeNull();
    expect(extractApiToken(basic('u', 'plain-password'))).toBeNull();
    expect(extractApiToken('Digest abc')).toBeNull();
    expect(extractApiToken(undefined)).toBeNull();
    expect(extractApiToken('')).toBeNull();
  });
});
