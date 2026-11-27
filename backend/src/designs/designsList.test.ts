process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { sql } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { designsTable, designVersionsTable, designTestVariantsTable, usersTable, companiesTable, apiTokensTable } from '../db/schema';
import { registerUser } from '../auth/authService';
import { likeLiteral } from './designsService';

/**
 * Etapa 4 (27/11/2026): the list of designs searches the name on the server (in all the designs of the company, not
 * only the page loaded) and says who created each design. Without `search` the list is as it was.
 */

jest.setTimeout(30000);

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^XZ', elements: [], labelWidth: 800, labelHeight: 600 };
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const jwt: Record<string, string> = {};

async function signUp(username: string): Promise<void> {
  await registerUser(username, 'password123');
  jwt[username] = (await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200)).body.token;
}
const design = (who: string, name: string) => request(app).post('/api/designs').set(bearer(jwt[who])).send({ name, ...base }).expect(201);
const list = (who: string, query = '') => request(app).get(`/api/designs${query}`).set(bearer(jwt[who]));
const names = (body: any) => body.items.map((d: any) => d.name).sort();

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  const db = getDb();
  await db.delete(designTestVariantsTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(apiTokensTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
  for (const u of ['alice', 'bob', 'carol']) await signUp(u);
  await run(sql`UPDATE users SET company_id = (SELECT company_id FROM users WHERE username = 'alice') WHERE username = 'bob'`);
});
afterAll(async () => { await _resetDb(); });

describe('search on the server', () => {
  test('finds the name anywhere, whatever the case, and the total counts only what matches', async () => {
    await design('alice', 'Etiqueta UC Picking');
    await design('bob', 'Remessa');
    await design('alice', 'uc de entrada');
    const r = (await list('alice', '?search=UC').expect(200)).body;
    expect(names(r)).toEqual(['Etiqueta UC Picking', 'uc de entrada']);
    expect(r.total).toBe(2);
    expect((await list('alice', '?search=%20remessa%20').expect(200)).body.total).toBe(1);    // spaces around are ignored
  });

  test('searches every design of the company, not just the page asked for', async () => {
    for (let i = 1; i <= 7; i++) await design('alice', `Lote ${i}`);
    await design('alice', 'Achado');
    const r = (await list('alice', '?limit=3&offset=0&search=achado').expect(200)).body;
    expect(names(r)).toEqual(['Achado']);
    expect(r.total).toBe(1);
  });

  test('%, _ and \\ in the search are just characters', async () => {
    await design('alice', '100% algodao');
    await design('alice', 'Cod_A');
    await design('alice', 'CodXA');
    await design('alice', 'C:\\temp');
    expect(names((await list('alice', `?search=${encodeURIComponent('%')}`).expect(200)).body)).toEqual(['100% algodao']);
    expect(names((await list('alice', `?search=${encodeURIComponent('d_A')}`).expect(200)).body)).toEqual(['Cod_A']);
    expect(names((await list('alice', `?search=${encodeURIComponent(':\\t')}`).expect(200)).body)).toEqual(['C:\\temp']);
    expect(likeLiteral('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  test('another company is never found', async () => {
    await design('carol', 'Remessa da Carol');
    expect((await list('alice', '?search=remessa').expect(200)).body.items).toEqual([]);
  });

  test('without search the list is as before; empty search is no search; too long is refused', async () => {
    await design('alice', 'A');
    await design('bob', 'B');
    expect(names((await list('alice').expect(200)).body)).toEqual(['A', 'B']);
    expect(names((await list('alice', '?search=').expect(200)).body)).toEqual(['A', 'B']);
    await list('alice', `?search=${'x'.repeat(101)}`).expect(400);
  });
});

describe('who created each design', () => {
  test('each item says who created it (id and user name); the other fields stay as they were', async () => {
    await design('alice', 'Da Alice');
    await design('bob', 'Do Bob');
    const items = (await list('bob').expect(200)).body.items;
    const byName = Object.fromEntries(items.map((d: any) => [d.name, d]));
    expect(byName['Da Alice'].createdBy).toMatchObject({ username: 'alice' });
    expect(byName['Do Bob'].createdBy).toMatchObject({ username: 'bob' });
    expect(typeof byName['Da Alice'].createdBy.id).toBe('number');
    expect(Object.keys(byName['Da Alice']).sort()).toEqual(['createdAt', 'createdBy', 'id', 'name', 'updatedAt', 'versionCount']);
    expect(byName['Da Alice'].versionCount).toBe(1);
  });
});
