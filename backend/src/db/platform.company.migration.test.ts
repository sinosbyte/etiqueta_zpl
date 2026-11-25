process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from './database';

/**
 * Migration 0014 (Fase 06, etapa 2): the platform company. The Sinosbyte administrators move into it; everything else
 * (the client company, its users, its designs, its integration token) stays where it is. Seeded as production is today.
 */

const dir = path.join(__dirname, '..', '..', 'drizzle');
const migration = fs.readFileSync(path.join(dir, '0014_platform_company.sql'), 'utf8');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

async function clean() {
  await run(sql`DELETE FROM api_tokens`);
  await run(sql`DELETE FROM refresh_tokens`);
  await run(sql`DELETE FROM design_test_variants`);
  await run(sql`DELETE FROM design_versions`);
  await run(sql`DELETE FROM designs`);
  await run(sql`DELETE FROM users`);
  await run(sql`DELETE FROM companies`);
}

/** The companies table as it was before 0014 */
async function before0014() {
  await run(sql`DROP INDEX IF EXISTS uq_companies_platform`);
  await run(sql`ALTER TABLE companies DROP COLUMN IF EXISTS is_platform`);
}

/** Production on 25/11/2026: one company, Sinosbyte, with the platform admin, a company admin and a member */
async function seed() {
  await run(sql`INSERT INTO companies (name) VALUES ('Sinosbyte'), ('Acme')`);
  const c = (name: string) => sql`(SELECT id FROM companies WHERE name = ${name})`;
  await run(sql`INSERT INTO users (username, password_hash, role, is_admin, company_id) VALUES
    ('guilherme.f',    'h1', 'platform_admin', true,  ${c('Sinosbyte')}),
    ('diego.dapont',   'h2', 'company_admin',  false, ${c('Sinosbyte')}),
    ('gabriel.chagas', 'h3', 'member',         false, ${c('Sinosbyte')}),
    ('ana',            'h4', 'company_admin',  false, ${c('Acme')})`);
  await run(sql`INSERT INTO designs (id, user_id, company_id, name)
    SELECT 81, id, company_id, 'UC Entrada' FROM users WHERE username = 'guilherme.f'`);
  await run(sql`INSERT INTO designs (id, user_id, company_id, name)
    SELECT 91, id, company_id, 'UC EWM' FROM users WHERE username = 'guilherme.f'`);
  await run(sql`INSERT INTO api_tokens (user_id, company_id, name, token_hash, prefix)
    SELECT id, company_id, 'SAP A4H - destino ZETIQ', 'hash-zetiq', 'zpd_abc' FROM users WHERE username = 'guilherme.f'`);
}
const where = () => rows(sql`SELECT u.username, c.name AS company FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`);

beforeAll(async () => { await initDb(); });
beforeEach(async () => { await clean(); await before0014(); });
afterEach(async () => { await clean(); await before0014(); await run(sql.raw(migration)); });   // back to the final shape
afterAll(async () => { await _resetDb(); });

describe('migration 0014', () => {
  test('creates the platform company and moves the Sinosbyte administrators into it; nobody else moves', async () => {
    await seed();
    await run(sql.raw(migration));
    expect(await where()).toEqual([
      { username: 'guilherme.f', company: 'Plataforma Sinosbyte' },
      { username: 'diego.dapont', company: 'Sinosbyte' },
      { username: 'gabriel.chagas', company: 'Sinosbyte' },
      { username: 'ana', company: 'Acme' },
    ]);
    expect(await rows(sql`SELECT name, is_platform FROM companies ORDER BY id`)).toEqual([
      { name: 'Sinosbyte', is_platform: false },
      { name: 'Acme', is_platform: false },
      { name: 'Plataforma Sinosbyte', is_platform: true },
    ]);
  });

  test('the designs (same numbers) and the integration token stay in the client company', async () => {
    await seed();
    const designs = await rows(sql`SELECT * FROM designs ORDER BY id`);
    const tokens = await rows(sql`SELECT * FROM api_tokens ORDER BY id`);
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT * FROM designs ORDER BY id`)).toEqual(designs);
    expect(await rows(sql`SELECT * FROM api_tokens ORDER BY id`)).toEqual(tokens);
    const owner = await rows(sql`SELECT c.name FROM api_tokens t JOIN companies c ON c.id = t.company_id`);
    expect(owner).toEqual([{ name: 'Sinosbyte' }]);
  });

  test('only one platform company may exist, and running it again changes nothing', async () => {
    await seed();
    await run(sql.raw(migration));
    const once = await rows(sql`SELECT id, name, is_platform FROM companies ORDER BY id`);
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT id, name, is_platform FROM companies ORDER BY id`)).toEqual(once);
    await expect(run(sql`INSERT INTO companies (name, is_platform) VALUES ('Outra plataforma', true)`)).rejects.toThrow();
  });

  test('an empty database gets the platform company too', async () => {
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT name, is_platform FROM companies`)).toEqual([{ name: 'Plataforma Sinosbyte', is_platform: true }]);
  });

  test('is registered in the journal', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find(e => e.tag === '0014_platform_company')?.idx).toBe(14);
  });
});
