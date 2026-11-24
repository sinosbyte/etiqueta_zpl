process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from './database';
import { usersTable, designsTable, designVersionsTable, companiesTable } from './schema';
import { registerUser, loginUser } from '../auth/authService';
import { createDesign, listDesigns } from '../designs/designsService';

/**
 * Fase 05, etapa 1: companies. The migration adds columns and fills them for the users and designs that exist, and
 * the code only fills them for new ones. Nothing that existed changes: who sees which design is still decided by the
 * user, and the login (JWT) is the same.
 */

const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'drizzle', '0010_companies_users.sql'), 'utf8');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

const payload = { elements: [], zpl: '^XA^XZ', labelWidth: 800, labelHeight: 1200 } as any;

async function clean() {
  const db = getDb();
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
}

/** The state before the migration: users and designs with no company (what production has) */
async function legacy() {
  await run(sql`INSERT INTO users (username, password_hash, is_admin) VALUES
    ('sinosbyte', 'h1', false), ('boss', 'h2', true), ('alice', 'h3', false), ('bob', 'h4', false)`);
  await run(sql`INSERT INTO designs (user_id, name) SELECT id, 'D-' || username FROM users WHERE username IN ('alice', 'sinosbyte', 'bob')`);
  await run(sql`UPDATE users SET company_id = NULL, role = 'member', active = true`);
  await run(sql`UPDATE designs SET company_id = NULL`);
}

const oldColumns = () => rows(sql`SELECT id, username, password_hash, is_admin, created_at FROM users ORDER BY id`);
const designsNow = () => rows(sql`SELECT id, user_id, name, created_at, updated_at FROM designs ORDER BY id`);

beforeAll(async () => { await initDb(); });
beforeEach(clean);
afterAll(async () => { await clean(); await _resetDb(); });

describe('the migration', () => {
  test('puts the administrators and the sinosbyte account in the company Sinosbyte, everybody else in a company of their own', async () => {
    await legacy();
    await run(sql.raw(migration));
    const users = await rows(sql`SELECT u.username, u.role, c.name AS company, u.company_id FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`);
    expect(users.map(u => [u.username, u.role, u.company])).toEqual([
      ['sinosbyte', 'company_admin', 'Sinosbyte'],
      ['boss', 'platform_admin', 'Sinosbyte'],
      ['alice', 'company_admin', 'alice'],
      ['bob', 'company_admin', 'bob'],
    ]);
    expect(users[0].company_id).toBe(users[1].company_id);                       // the two are in the same company
    expect(new Set(users.map(u => u.company_id)).size).toBe(3);                  // Sinosbyte + alice + bob
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(3);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users WHERE company_id IS NULL`))[0].n).toBe(0);
  });

  test('a design belongs to the company of its user', async () => {
    await legacy();
    await run(sql.raw(migration));
    const d = await rows(sql`SELECT d.name, u.username, d.company_id = u.company_id AS same FROM designs d JOIN users u ON u.id = d.user_id ORDER BY d.id`);
    expect(d.length).toBe(3);
    expect(d.every(r => r.same === true)).toBe(true);
  });

  test('it changes nothing that existed: same users, passwords, administrators, designs and dates', async () => {
    await legacy();
    const users = await oldColumns();
    const designs = await designsNow();
    await run(sql.raw(migration));
    expect(await oldColumns()).toEqual(users);
    expect(await designsNow()).toEqual(designs);
  });

  test('run again it changes nothing and creates no company', async () => {
    await legacy();
    await run(sql.raw(migration));
    const users = await rows(sql`SELECT id, company_id, role FROM users ORDER BY id`);
    const companies = await rows(sql`SELECT id, name FROM companies ORDER BY id`);
    await run(sql.raw(migration));
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT id, company_id, role FROM users ORDER BY id`)).toEqual(users);
    expect(await rows(sql`SELECT id, name FROM companies ORDER BY id`)).toEqual(companies);
  });

  test('on an empty database it runs and creates nothing', async () => {
    await run(sql.raw(migration));
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(0);
  });

  test('a user whose name is Sinosbyte in other letters still gets a company of their own, apart from the real one', async () => {
    await run(sql`INSERT INTO users (username, password_hash, is_admin) VALUES ('sinosbyte', 'h', false), ('Sinosbyte', 'h', false)`);
    await run(sql`UPDATE users SET company_id = NULL`);
    await run(sql.raw(migration));
    const users = await rows(sql`SELECT username, company_id FROM users ORDER BY id`);
    expect(users[0].company_id).not.toBe(users[1].company_id);
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(2);
  });

  test('the new columns: nullable company ids, role defaults to member, active to true, e-mail optional', async () => {
    const cols = await rows(sql`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE (table_name = 'users' AND column_name IN ('company_id', 'email', 'role', 'active')) OR (table_name = 'designs' AND column_name = 'company_id')
      ORDER BY table_name, column_name`);
    const by = Object.fromEntries(cols.map(c => [`${c.table_name}.${c.column_name}`, c]));
    expect(by['users.company_id']).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(by['designs.company_id']).toMatchObject({ data_type: 'integer', is_nullable: 'YES' });
    expect(by['users.email']).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    expect(by['users.role']).toMatchObject({ is_nullable: 'NO' });
    expect(by['users.role'].column_default).toContain('member');
    expect(by['users.active']).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
  });
});

describe('new users and designs', () => {
  test('a new user gets a company of their own, named after the username, and is its administrator', async () => {
    await registerUser('carol', 'password123');
    const [u] = await rows(sql`SELECT u.role, u.active, u.email, u.is_admin, c.name, c.active AS company_active FROM users u JOIN companies c ON c.id = u.company_id WHERE u.username = 'carol'`);
    expect(u).toMatchObject({ role: 'company_admin', active: true, email: null, is_admin: false, name: 'carol', company_active: true });
  });

  test('two new users have two companies', async () => {
    await registerUser('carol', 'password123');
    await registerUser('dave', 'password123');
    expect((await rows(sql`SELECT count(DISTINCT company_id)::int AS n FROM users`))[0].n).toBe(2);
  });

  test('a username already taken leaves no company behind', async () => {
    await registerUser('carol', 'password123');
    await expect(registerUser('carol', 'other-password')).rejects.toThrow('USERNAME_TAKEN');
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(1);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(1);
  });

  test('a design created through the service belongs to the company of its user', async () => {
    await registerUser('erin', 'password123');
    const [erin] = await rows(sql`SELECT id, company_id FROM users WHERE username = 'erin'`);
    const { designId } = await createDesign(erin.id, 'Etiqueta', payload);
    const [d] = await rows(sql`SELECT company_id, user_id FROM designs WHERE id = ${designId}`);
    expect(d).toEqual({ company_id: erin.company_id, user_id: erin.id });
  });

  test('a design of a user without a company is still created (the column accepts no company)', async () => {
    await run(sql`INSERT INTO users (username, password_hash) VALUES ('legacy', 'h')`);
    const [u] = await rows(sql`SELECT id FROM users WHERE username = 'legacy'`);
    const { designId } = await createDesign(u.id, 'Old', payload);
    expect((await rows(sql`SELECT company_id FROM designs WHERE id = ${designId}`))[0].company_id).toBeNull();
  });
});

describe('nothing else changed', () => {
  test('the login token still carries only the user (no company, no role)', async () => {
    await registerUser('frank', 'password123');
    const decoded = jwt.decode(await loginUser('frank', 'password123')) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'userId', 'username']);
  });

  test('two users of the same company still see only their own designs', async () => {
    await registerUser('gina', 'password123');
    await registerUser('hugo', 'password123');
    const [gina] = await rows(sql`SELECT id FROM users WHERE username = 'gina'`);
    const [hugo] = await rows(sql`SELECT id FROM users WHERE username = 'hugo'`);
    await run(sql`UPDATE users SET company_id = (SELECT company_id FROM users WHERE id = ${gina.id}) WHERE id = ${hugo.id}`);
    await createDesign(gina.id, 'Da Gina', payload);
    await createDesign(hugo.id, 'Do Hugo', payload);
    expect((await listDesigns(gina.id, { limit: 50, offset: 0 })).items.map((d: any) => d.name)).toEqual(['Da Gina']);
    expect((await listDesigns(hugo.id, { limit: 50, offset: 0 })).items.map((d: any) => d.name)).toEqual(['Do Hugo']);
  });

  test('every migration file is in the journal and the last one is this', () => {
    const dir = path.join(__dirname, '..', '..', 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.map(e => e.idx)).toEqual(journal.entries.map((_, i) => i));
    expect(journal.entries[journal.entries.length - 1].tag).toBe('0010_companies_users');
  });
});
