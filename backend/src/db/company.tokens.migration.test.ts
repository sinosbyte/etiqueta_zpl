process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';

import fs from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { initDb, _resetDb, getDb } from './database';

/**
 * Migration 0013 (Fase 06, etapa 1): integration tokens belong to the company. Every existing token must keep reading
 * the same designs (the company of its owner today), nothing else may change, and deleting the user who generated a
 * token must no longer delete the token.
 */

const dir = path.join(__dirname, '..', '..', 'drizzle');
const migration = fs.readFileSync(path.join(dir, '0013_company_tokens.sql'), 'utf8');
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];

async function clean() {
  await run(sql`DELETE FROM api_tokens`);
  await run(sql`DELETE FROM refresh_tokens`);
  await run(sql`DELETE FROM design_versions`);
  await run(sql`DELETE FROM designs`);
  await run(sql`DELETE FROM users`);
  await run(sql`DELETE FROM companies`);
}

/** The api_tokens table as it was before 0013: owned by a user, deleted with them */
async function before0013() {
  await run(sql`ALTER TABLE api_tokens DROP CONSTRAINT IF EXISTS api_tokens_user_id_users_id_fk`);
  await run(sql`ALTER TABLE api_tokens DROP CONSTRAINT IF EXISTS api_tokens_user_id_fkey`);
  await run(sql`DROP INDEX IF EXISTS idx_api_tokens_company_id`);
  await run(sql`ALTER TABLE api_tokens DROP COLUMN IF EXISTS company_id`);
  await run(sql`ALTER TABLE api_tokens ALTER COLUMN user_id SET NOT NULL`);
  await run(sql`ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
}

async function seed() {
  await run(sql`INSERT INTO companies (name) VALUES ('Sinosbyte'), ('Acme')`);
  const c = (name: string) => sql`(SELECT id FROM companies WHERE name = ${name})`;
  await run(sql`INSERT INTO users (username, password_hash, role, company_id) VALUES
    ('guilherme.f', 'h1', 'platform_admin', ${c('Sinosbyte')}),
    ('ana',         'h2', 'company_admin',  ${c('Acme')}),
    ('joao',        'h3', 'member',         ${c('Acme')})`);
  await run(sql`INSERT INTO api_tokens (user_id, name, token_hash, prefix, last_used_at)
    SELECT id, 'SAP ' || username, 'hash-' || username, 'zpd_' || left(username, 4), now() FROM users`);
  await run(sql`UPDATE api_tokens SET revoked_at = now() WHERE name = 'SAP joao'`);
}
const tokens = () => rows(sql`SELECT t.id, t.user_id, t.name, t.token_hash, t.prefix, t.created_at, t.last_used_at, t.expires_at, t.revoked_at
  FROM api_tokens t ORDER BY t.id`);

beforeAll(async () => { await initDb(); });
beforeEach(async () => { await clean(); await before0013(); });
afterEach(async () => { await clean(); await before0013(); await run(sql.raw(migration)); });   // back to the final shape
afterAll(async () => { await _resetDb(); });

describe('migration 0013', () => {
  test('every token gets the company of its owner, and nothing else about the tokens changes', async () => {
    await seed();
    const before = await tokens();
    await run(sql.raw(migration));
    expect(await tokens()).toEqual(before);
    const owners = await rows(sql`SELECT u.username, c.name AS company FROM api_tokens t
      JOIN users u ON u.id = t.user_id JOIN companies c ON c.id = t.company_id ORDER BY t.id`);
    expect(owners).toEqual([
      { username: 'guilherme.f', company: 'Sinosbyte' },
      { username: 'ana', company: 'Acme' },
      { username: 'joao', company: 'Acme' },
    ]);
  });

  test('users, companies and designs are untouched', async () => {
    await seed();
    await run(sql`INSERT INTO designs (user_id, company_id, name) SELECT id, company_id, 'D-' || username FROM users`);
    const u = await rows(sql`SELECT * FROM users ORDER BY id`);
    const c = await rows(sql`SELECT * FROM companies ORDER BY id`);
    const d = await rows(sql`SELECT * FROM designs ORDER BY id`);
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT * FROM users ORDER BY id`)).toEqual(u);
    expect(await rows(sql`SELECT * FROM companies ORDER BY id`)).toEqual(c);
    expect(await rows(sql`SELECT * FROM designs ORDER BY id`)).toEqual(d);
  });

  test('afterwards, deleting the user who generated a token keeps the token, without a user', async () => {
    await seed();
    await run(sql.raw(migration));
    await run(sql`DELETE FROM users WHERE username = 'ana'`);
    expect(await rows(sql`SELECT name, user_id FROM api_tokens WHERE name = 'SAP ana'`)).toEqual([{ name: 'SAP ana', user_id: null }]);
  });

  test('the company is required and the old cascade is gone', async () => {
    await seed();
    await run(sql.raw(migration));
    await expect(run(sql`INSERT INTO api_tokens (name, token_hash, prefix) VALUES ('x', 'h-x', 'zpd_x')`)).rejects.toThrow();
    const fks = await rows(sql`SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = 'api_tokens'::regclass AND contype = 'f' ORDER BY conname`);
    // a = no action (company), n = set null (user)
    expect(fks.map(f => [f.conname, f.confdeltype])).toEqual([
      ['api_tokens_company_id_fkey', 'a'],
      ['api_tokens_user_id_users_id_fk', 'n'],
    ]);
  });

  test('an empty table migrates, and running it again changes nothing', async () => {
    await run(sql.raw(migration));
    await seed().catch(() => undefined);   // seeding without company_id fails now: tokens need a company
    await clean();
    await before0013();
    await seed();
    await run(sql.raw(migration));
    const once = await rows(sql`SELECT id, company_id, user_id FROM api_tokens ORDER BY id`);
    await run(sql.raw(migration));
    expect(await rows(sql`SELECT id, company_id, user_id FROM api_tokens ORDER BY id`)).toEqual(once);
  });

  test('is registered in the journal', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
    expect(journal.entries.find(e => e.tag === '0013_company_tokens')?.idx).toBe(13);
  });
});
