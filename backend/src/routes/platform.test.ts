process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { sql } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import { registerUser } from '../auth/authService';

/**
 * Fase 06, etapa 2: the Sinosbyte administrators belong to the platform company. They keep the companies, the other
 * Sinosbyte administrators and the templates; they have no designs and no integration tokens, and still use the label
 * tools (generate, preview) to keep the templates.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^FO10,10^A0N,30,30^FDX^FS^XZ', elements: [], labelWidth: 800, labelHeight: 600 };
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const jwtOf = async (username: string) =>
  (await request(app).post('/api/auth/login').send({ username, password: 'password123' }).expect(200)).body.token as string;
const NOT_AVAILABLE = 'Not available for Sinosbyte administrators';

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  for (const t of ['api_tokens', 'refresh_tokens', 'design_test_variants', 'design_versions', 'designs', 'templates', 'users', 'companies']) {
    await run(sql.raw(`DELETE FROM ${t}`));
  }
  await registerUser('plataforma', 'password123');
  await run(sql`UPDATE users SET role = 'platform_admin', is_admin = true WHERE username = 'plataforma'`);
  await run(sql`UPDATE companies SET name = 'Plataforma Sinosbyte', is_platform = true WHERE id = (SELECT company_id FROM users WHERE username = 'plataforma')`);
  await registerUser('cliente', 'password123');
});
afterAll(async () => { await _resetDb(); });

describe('the platform company', () => {
  test('/api/me says the company is the platform', async () => {
    const me = (await request(app).get('/api/me').set(bearer(await jwtOf('plataforma'))).expect(200)).body;
    expect(me.company).toMatchObject({ name: 'Plataforma Sinosbyte', isPlatform: true });
    const client = (await request(app).get('/api/me').set(bearer(await jwtOf('cliente'))).expect(200)).body;
    expect(client.company.isPlatform).toBe(false);
  });

  test('has no designs: listing, creating and opening are refused', async () => {
    const plat = await jwtOf('plataforma');
    expect((await request(app).get('/api/designs').set(bearer(plat)).expect(403)).body.error).toBe(NOT_AVAILABLE);
    await request(app).post('/api/designs').set(bearer(plat)).send({ name: 'X', ...base }).expect(403);
    const id = (await request(app).post('/api/designs').set(bearer(await jwtOf('cliente'))).send({ name: 'Do cliente', ...base }).expect(201)).body.designId;
    await request(app).get(`/api/designs/${id}`).set(bearer(plat)).expect(403);
    await request(app).get(`/api/designs/${id}/variants`).set(bearer(plat)).expect(403);
  });

  test('has no integration tokens', async () => {
    const plat = await jwtOf('plataforma');
    expect((await request(app).get('/api/tokens').set(bearer(plat)).expect(403)).body.error).toBe(NOT_AVAILABLE);
    await request(app).post('/api/tokens').set(bearer(plat)).send({ name: 'SAP' }).expect(403);
  });

  test('keeps the templates and uses the label tools', async () => {
    const plat = await jwtOf('plataforma');
    await request(app).post('/api/templates').set(bearer(plat)).send({ name: 'Picking', description: '', ...base }).expect(201);
    await request(app).post('/api/generate-zpl').set(bearer(plat)).send({ labelWidth: 800, labelHeight: 600, elements: [] }).expect(200);
    const list = (await request(app).get('/api/templates').set(bearer(await jwtOf('cliente'))).expect(200)).body.items;
    expect(list.map((t: { name: string }) => t.name)).toEqual(['Picking']);
  });

  test('is not listed among the client companies', async () => {
    const list = (await request(app).get('/api/companies').set(bearer(await jwtOf('plataforma'))).expect(200)).body.items;
    expect(list.map((c: { name: string }) => c.name)).toEqual(['cliente']);
  });

  test('a client administrator cannot create users in it nor see it', async () => {
    const client = await jwtOf('cliente');
    const plat = (await run(sql`SELECT id FROM companies WHERE is_platform`)).rows[0] as { id: number };
    await request(app).get(`/api/users?companyId=${plat.id}`).set(bearer(client)).expect(403);
    await request(app).post('/api/users').set(bearer(client)).send({ username: 'intruso', email: 'i@x.com', role: 'company_admin', companyId: plat.id }).expect(403);
  });
});
