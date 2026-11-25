process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from './database';
import { usersTable, designsTable, designVersionsTable, companiesTable, apiTokensTable } from './schema';

/**
 * Migration 0011 (Fase 05, etapa 2): designs belong to the company; the name is unique per company; the company of users
 * and designs is mandatory. It must not fail when production has two designs that would collide (that would keep the
 * server from starting), and it must not change anything else.
 */

const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'drizzle', '0011_designs_by_company.sql'), 'utf8');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

async function clean() {
  const db = getDb();
  await db.delete(apiTokensTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
}

/** The shape of the tables before 0011: no unique name per company, and a company is not mandatory */
async function before0011() {
  await run(sql`DROP INDEX IF EXISTS uq_designs_company_name`);
  await run(sql`ALTER TABLE users ALTER COLUMN company_id DROP NOT NULL`);
  await run(sql`ALTER TABLE designs ALTER COLUMN company_id DROP NOT NULL`);
}

/** Two companies: A has u1 and u2 (one company, as after moving a user), B has u3 */
async function seed() {
  await run(sql`INSERT INTO companies (name) VALUES ('A'), ('B')`);
  await run(sql`INSERT INTO users (username, password_hash, company_id, role) VALUES
    ('u1', 'h', (SELECT id FROM companies WHERE name = 'A'), 'company_admin'),
    ('u2', 'h', (SELECT id FROM companies WHERE name = 'A'), 'member'),
    ('u3', 'h', (SELECT id FROM companies WHERE name = 'B'), 'company_admin')`);
}
const design = (user: string, name: string, at: string) => run(sql`INSERT INTO designs (user_id, company_id, name, created_at, updated_at)
  SELECT id, company_id, ${name}, ${at}::timestamp, ${at}::timestamp FROM users WHERE username = ${user}`);

const names = async () => (await rows(sql`SELECT d.name, u.username FROM designs d JOIN users u ON u.id = d.user_id ORDER BY d.created_at, d.id`)).map(r => `${r.username}:${r.name}`);

beforeAll(async () => { await initDb(); });
beforeEach(async () => { await clean(); await before0011(); });
afterEach(async () => {
  await clean();
  // back to the final shape for the next suite (the migration itself did it, unless a test failed in the middle)
  await run(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_designs_company_name ON designs (company_id, name)`);
  await run(sql`ALTER TABLE users ALTER COLUMN company_id SET NOT NULL`);
  await run(sql`ALTER TABLE designs ALTER COLUMN company_id SET NOT NULL`);
});
afterAll(async () => { await _resetDb(); });

describe('two designs of one company with the same name', () => {
  test('the oldest keeps the name, the newer one gets its id added, nothing is deleted', async () => {
    await seed();
    await design('u1', 'Remessa', '2026-01-01 10:00');
    await design('u2', 'Remessa', '2026-01-02 10:00');
    await design('u3', 'Remessa', '2026-01-03 10:00');           // another company: not a collision
    const ids = (await rows(sql`SELECT id, name FROM designs ORDER BY created_at`)).map(r => r.id);
    await run(sql.raw(migration));
    expect(await names()).toEqual(['u1:Remessa', `u2:Remessa (${ids[1]})`, 'u3:Remessa']);
    expect((await rows(sql`SELECT count(*)::int AS n FROM designs`))[0].n).toBe(3);
  });

  test('three of them: the oldest stays, the other two are renamed apart', async () => {
    await seed();
    await design('u1', 'X', '2026-01-01 10:00');
    await design('u2', 'X', '2026-01-02 10:00');
    await design('u2', 'X', '2026-01-03 10:00');
    const ids = (await rows(sql`SELECT id FROM designs ORDER BY created_at`)).map(r => r.id);
    await run(sql.raw(migration));
    expect(await names()).toEqual(['u1:X', `u2:X (${ids[1]})`, `u2:X (${ids[2]})`]);
  });

  test('versions and variants of a renamed design stay with it', async () => {
    await seed();
    await design('u1', 'X', '2026-01-01 10:00');
    await design('u2', 'X', '2026-01-02 10:00');
    await run(sql`INSERT INTO design_versions (design_id, version_number, zpl, elements_json, label_width, label_height)
      SELECT id, 1, '^XA^XZ', '[]', 800, 600 FROM designs`);
    await run(sql.raw(migration));
    const v = await rows(sql`SELECT d.name, count(v.id)::int AS n FROM designs d JOIN design_versions v ON v.design_id = d.id GROUP BY d.id, d.name ORDER BY d.id`);
    expect(v.map(r => r.n)).toEqual([1, 1]);
  });
});

describe('when nothing collides', () => {
  test('no design is renamed (the same name in two companies is fine) and no other data changes', async () => {
    await seed();
    await design('u1', 'Remessa', '2026-01-01 10:00');
    await design('u2', 'Outra', '2026-01-02 10:00');
    await design('u3', 'Remessa', '2026-01-03 10:00');
    await run(sql`INSERT INTO api_tokens (user_id, company_id, name, token_hash, prefix) SELECT id, company_id, 'T', 'hash1', 'zpd_' FROM users WHERE username = 'u1'`);
    const users = await rows(sql`SELECT id, username, password_hash, is_admin, company_id, role FROM users ORDER BY id`);
    const designs = await rows(sql`SELECT id, user_id, company_id, name, created_at, updated_at FROM designs ORDER BY id`);
    const tokens = await rows(sql`SELECT id, user_id, token_hash FROM api_tokens`);
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT id, username, password_hash, is_admin, company_id, role FROM users ORDER BY id`)).toEqual(users);
    expect(await rows(sql`SELECT id, user_id, company_id, name, created_at, updated_at FROM designs ORDER BY id`)).toEqual(designs);
    expect(await rows(sql`SELECT id, user_id, token_hash FROM api_tokens`)).toEqual(tokens);
  });

  test('run again it changes nothing', async () => {
    await seed();
    await design('u1', 'Remessa', '2026-01-01 10:00');
    await design('u2', 'Remessa', '2026-01-02 10:00');
    await run(sql.raw(migration));
    const after = await names();
    await run(sql.raw(migration));
    await run(sql.raw(migration));
    expect(await names()).toEqual(after);
  });
});

describe('the new rules', () => {
  test('the name is unique per company, in the same letters; another company may repeat it; the old per-user rule is gone', async () => {
    await seed();
    await run(sql.raw(migration));
    await design('u1', 'Remessa', '2026-01-01 10:00');
    await expect(design('u2', 'Remessa', '2026-01-02 10:00')).rejects.toThrow();          // same company, other user
    await expect(design('u1', 'Remessa', '2026-01-02 10:00')).rejects.toThrow();          // same user: as before
    await design('u2', 'remessa', '2026-01-02 10:00');                                    // other letters: allowed, as before
    await design('u3', 'Remessa', '2026-01-03 10:00');                                    // another company
    const constraints = await rows(sql`SELECT conname FROM pg_constraint WHERE conrelid = 'designs'::regclass AND contype = 'u'`);
    expect(constraints).toEqual([]);                                                       // the (user_id, name) constraint is gone
  });

  test('a user and a design must have a company', async () => {
    await run(sql.raw(migration));
    await expect(run(sql`INSERT INTO users (username, password_hash) VALUES ('x', 'h')`)).rejects.toThrow();
    await seed();
    await expect(run(sql`INSERT INTO designs (user_id, name) SELECT id, 'Z' FROM users WHERE username = 'u1'`)).rejects.toThrow();
    const cols = await rows(sql`SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'company_id' AND table_name IN ('users', 'designs') ORDER BY table_name`);
    expect(cols.map(c => [c.table_name, c.is_nullable])).toEqual([['designs', 'NO'], ['users', 'NO']]);
  });
});

describe('the safety net', () => {
  test('a user and a design left without a company get one: an administrator in the existing Sinosbyte company, another user in a company of their own', async () => {
    await run(sql`INSERT INTO companies (name) VALUES ('Sinosbyte')`);
    await run(sql`INSERT INTO users (username, password_hash, is_admin) VALUES ('boss', 'h', true), ('late', 'h', false)`);
    await run(sql`INSERT INTO designs (user_id, name) SELECT id, 'D-' || username FROM users`);
    await run(sql.raw(migration));
    const u = await rows(sql`SELECT u.username, u.role, c.name AS company FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`);
    expect(u.map(r => [r.username, r.role, r.company])).toEqual([['boss', 'platform_admin', 'Sinosbyte'], ['late', 'company_admin', 'late']]);
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies WHERE name = 'Sinosbyte'`))[0].n).toBe(1);   // reused, not created twice
    expect((await rows(sql`SELECT count(*)::int AS n FROM designs d JOIN users u ON u.id = d.user_id WHERE d.company_id = u.company_id`))[0].n).toBe(2);
  });

  test('on an empty database it runs', async () => {
    await run(sql.raw(migration));
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(0);
  });

  test('it is in the journal', () => {
    const dir = path.join(__dirname, '..', '..', 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
    expect(journal.entries.some(e => e.tag === '0011_designs_by_company')).toBe(true);
  });
});
