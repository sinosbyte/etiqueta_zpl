process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from './database';
import { usersTable, designsTable, designVersionsTable, companiesTable, apiTokensTable, refreshTokensTable } from './schema';

/**
 * Migration 0012 (Fase 05, etapa 3): temporary passwords, unique e-mail, known roles only, is_admin lined up with the
 * role, and a user with designs that cannot be deleted. It must not fail on the data production may have, and must not
 * change anything else.
 */

const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'drizzle', '0012_users_admin.sql'), 'utf8');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

async function clean() {
  const db = getDb();
  await db.delete(apiTokensTable);
  await db.delete(refreshTokensTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
}

/** The tables as they were before 0012 */
async function before0012() {
  await run(sql`ALTER TABLE users DROP COLUMN IF EXISTS must_change_password`);
  await run(sql`DROP INDEX IF EXISTS uq_users_email`);
  await run(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await run(sql`ALTER TABLE designs DROP CONSTRAINT IF EXISTS designs_user_id_users_id_fk`);
  await run(sql`ALTER TABLE designs ADD CONSTRAINT designs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
}

async function seed() {
  await run(sql`INSERT INTO companies (name) VALUES ('Sinosbyte'), ('Acme')`);
  const c = (name: string) => sql`(SELECT id FROM companies WHERE name = ${name})`;
  await run(sql`INSERT INTO users (username, password_hash, is_admin, role, company_id, email) VALUES
    ('sinosbyte', 'h1', true,  'company_admin',  ${c('Sinosbyte')}, NULL),
    ('guilherme', 'h2', false, 'company_admin',  ${c('Sinosbyte')}, NULL),
    ('marcado',   'h3', false, 'platform_admin', ${c('Sinosbyte')}, NULL),
    ('ana',       'h4', false, 'company_admin',  ${c('Acme')}, 'Ana@Acme.com'),
    ('ana2',      'h5', false, 'member',         ${c('Acme')}, 'ana@acme.com'),
    ('estranho',  'h6', false, 'chefe',          ${c('Acme')}, NULL)`);
  await run(sql`INSERT INTO designs (user_id, company_id, name) SELECT id, company_id, 'D-' || username FROM users WHERE username IN ('ana', 'guilherme')`);
}
const users = () => rows(sql`SELECT username, is_admin, role, email FROM users ORDER BY id`);

beforeAll(async () => { await initDb(); });
beforeEach(async () => { await clean(); await before0012(); });
afterEach(async () => { await clean(); await run(sql.raw(migration)); });   // back to the final shape
afterAll(async () => { await _resetDb(); });

describe('migration 0012', () => {
  test('lines up is_admin and the role: an administrator becomes platform_admin, and is_admin follows the role', async () => {
    await seed();
    await run(sql.raw(migration));
    const u = Object.fromEntries((await users()).map(r => [r.username, [r.is_admin, r.role]]));
    expect(u.sinosbyte).toEqual([true, 'platform_admin']);
    expect(u.marcado).toEqual([true, 'platform_admin']);
    expect(u.guilherme).toEqual([false, 'company_admin']);
    expect(u.ana).toEqual([false, 'company_admin']);
  });

  test('an unknown role becomes member, and from then on only the three roles are accepted', async () => {
    await seed();
    await run(sql.raw(migration));
    expect((await rows(sql`SELECT role FROM users WHERE username = 'estranho'`))[0].role).toBe('member');
    await expect(run(sql`UPDATE users SET role = 'chefe' WHERE username = 'ana'`)).rejects.toThrow();
  });

  test('two users with the same e-mail in other letters: the older keeps it, the newer loses it; then the e-mail is unique', async () => {
    await seed();
    await run(sql.raw(migration));
    const u = Object.fromEntries((await users()).map(r => [r.username, r.email]));
    expect(u.ana).toBe('Ana@Acme.com');
    expect(u.ana2).toBeNull();
    await expect(run(sql`UPDATE users SET email = 'ANA@acme.com' WHERE username = 'guilherme'`)).rejects.toThrow();
    await run(sql`UPDATE users SET email = 'g@sinosbyte.com' WHERE username = 'guilherme'`);
    await run(sql`UPDATE users SET email = NULL WHERE username = 'sinosbyte'`);           // many may have none
  });

  test('every user starts without a password to change', async () => {
    await seed();
    await run(sql.raw(migration));
    expect((await rows(sql`SELECT bool_or(must_change_password) AS any FROM users`))[0].any).toBe(false);
  });

  test('a user with designs can no longer be deleted (their designs belong to the company); one without designs can', async () => {
    await seed();
    await run(sql.raw(migration));
    await expect(run(sql`DELETE FROM users WHERE username = 'ana'`)).rejects.toThrow();
    expect((await rows(sql`SELECT count(*)::int AS n FROM designs`))[0].n).toBe(2);
    await run(sql`DELETE FROM users WHERE username = 'estranho'`);
  });

  test('nothing else changes, and running it again changes nothing', async () => {
    await seed();
    const keep = () => rows(sql`SELECT id, username, password_hash, company_id, active, created_at FROM users ORDER BY id`);
    const designs = () => rows(sql`SELECT id, user_id, company_id, name FROM designs ORDER BY id`);
    const [u0, d0] = [await keep(), await designs()];
    await run(sql.raw(migration));
    const after = await users();
    await run(sql.raw(migration));
    await run(sql.raw(migration));
    expect(await keep()).toEqual(u0);
    expect(await designs()).toEqual(d0);
    expect(await users()).toEqual(after);
  });

  test('on an empty database it runs', async () => {
    await run(sql.raw(migration));
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(0);
  });

  test('it is in the journal', () => {
    const dir = path.join(__dirname, '..', '..', 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
    expect(journal.entries.some(e => e.tag === '0012_users_admin')).toBe(true);
  });
});
