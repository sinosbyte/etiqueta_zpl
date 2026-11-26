process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { sql } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';

/**
 * Self-service sign-up (2026-11-26): a company registers itself and its first administrator. Public, so the role and
 * the company are decided by the server; the e-mail belongs to one user (so to one company) whatever the case; the
 * company and the user are created together or not at all; login by user name or e-mail.
 */

jest.setTimeout(30000);

const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const rows = async (q: ReturnType<typeof sql>) => (await run(q)).rows as any[];
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^XZ', elements: [], labelWidth: 800, labelHeight: 600 };

const form = (over: Record<string, unknown> = {}) => ({
  companyName: 'Industria Alfa', username: 'admin.alfa', email: 'ti@alfa.com', password: 'senha-forte-1', ...over,
});
const signUp = (over: Record<string, unknown> = {}) => request(app).post('/api/auth/signup').send(form(over));
const login = (username: string, password = 'senha-forte-1') => request(app).post('/api/auth/login').send({ username, password });

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  for (const t of ['api_tokens', 'refresh_tokens', 'design_test_variants', 'design_versions', 'designs', 'templates', 'users', 'companies']) {
    await run(sql.raw(`DELETE FROM ${t}`));
  }
});
afterAll(async () => { await _resetDb(); });

describe('signing up', () => {
  test('creates the company and its first administrator, and signs them in', async () => {
    const r = await signUp().expect(201);
    expect(r.body.token).toBeTruthy();
    expect(r.body.mustChangePassword).toBe(false);
    expect(String(r.headers['set-cookie'])).toContain('zpl_refresh=');

    const [u] = await rows(sql`SELECT u.username, u.email, u.role, u.is_admin, u.active, u.must_change_password, c.name, c.is_platform, c.active AS company_active
      FROM users u JOIN companies c ON c.id = u.company_id`);
    expect(u).toEqual({
      username: 'admin.alfa', email: 'ti@alfa.com', role: 'company_admin', is_admin: false, active: true, must_change_password: false,
      name: 'Industria Alfa', is_platform: false, company_active: true,
    });
    const me = (await request(app).get('/api/me').set(bearer(r.body.token)).expect(200)).body;
    expect(me).toMatchObject({ username: 'admin.alfa', role: 'company_admin', company: { name: 'Industria Alfa', isPlatform: false } });
  });

  test('the e-mail is kept trimmed and in small letters', async () => {
    await signUp({ email: '  TI@Alfa.COM ' }).expect(201);
    expect((await rows(sql`SELECT email FROM users`))[0].email).toBe('ti@alfa.com');
  });

  test('refuses bad fields and creates nothing', async () => {
    for (const bad of [
      { companyName: 'A' }, { companyName: '' }, { username: 'ab' }, { username: 'com espaco' }, { username: 'a@b' },
      { email: 'nao-e-email' }, { email: '' }, { password: 'curta' }, { password: 'x'.repeat(73) },
    ]) {
      await signUp(bad).expect(400);
    }
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies`))[0].n).toBe(0);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(0);
  });

  test('never takes the role or the company from the request, and the hidden field stops robots', async () => {
    await signUp({ role: 'platform_admin' }).expect(400);
    await signUp({ companyId: 1 }).expect(400);
    await signUp({ isPlatform: true }).expect(400);
    await signUp({ website: 'http://spam' }).expect(400);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(0);
    await signUp({ website: '' }).expect(201);   // left empty, as a person leaves it
    expect((await rows(sql`SELECT role FROM users`))[0].role).toBe('company_admin');
  });

  test('a company name, user name or e-mail in use is refused (the e-mail whatever the case), and nothing is left half done', async () => {
    await signUp().expect(201);
    expect((await signUp({ companyName: 'INDUSTRIA ALFA', username: 'outro', email: 'outro@x.com' }).expect(409)).body.error).toBe('Company name already taken');
    expect((await signUp({ companyName: 'Beta', username: 'admin.alfa', email: 'b@b.com' }).expect(409)).body.error).toBe('Username already taken');
    expect((await signUp({ companyName: 'Beta', username: 'admin.beta', email: 'TI@ALFA.com' }).expect(409)).body.error).toBe('E-mail already in use');
    // the user failed after the company was inserted: the transaction took the company back
    expect((await rows(sql`SELECT name FROM companies ORDER BY id`)).map(c => c.name)).toEqual(['Industria Alfa']);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(1);
  });

  test('simultaneous sign-ups with the same e-mail: exactly one wins, no company is left without its user', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      signUp({ companyName: `Empresa ${i}`, username: `admin${i}`, email: 'MESMO@x.com' })));
    expect(all.filter(r => r.status === 201)).toHaveLength(1);
    expect(all.filter(r => r.status === 409)).toHaveLength(7);
    expect((await rows(sql`SELECT count(*)::int AS n FROM users`))[0].n).toBe(1);
    expect((await rows(sql`SELECT count(*)::int AS n FROM companies c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id)`))[0].n).toBe(0);
  });

  test('the address of the old sign-up stays closed', async () => {
    expect((await request(app).post('/api/auth/register').send({ username: 'x', password: 'y' }).expect(403)).body.error).toBe('Sign-up is closed');
  });
});

describe('signing in', () => {
  test('by user name or by e-mail (any case, spaces around); wrong password or unknown says the same', async () => {
    await signUp().expect(201);
    await login('admin.alfa').expect(200);
    await login('ti@alfa.com').expect(200);
    await login('  TI@ALFA.COM ').expect(200);
    expect((await login('ti@alfa.com', 'errada-123').expect(401)).body.error).toBe('Invalid username or password');
    expect((await login('ninguem@alfa.com').expect(401)).body.error).toBe('Invalid username or password');
  });

  test('a deactivated user is refused by e-mail too, only after the right password', async () => {
    await signUp().expect(201);
    await run(sql`UPDATE users SET active = false`);
    expect((await login('ti@alfa.com').expect(403)).body.error).toBe('Account disabled');
    await login('ti@alfa.com', 'errada-123').expect(401);
  });

  test('the user name comes first: an account named like an e-mail keeps signing in by its name', async () => {
    await signUp().expect(201);
    // a user created by an administrator whose name looks like the e-mail of someone else (names with @ are still allowed there)
    const alfa = (await rows(sql`SELECT company_id FROM users WHERE username = 'admin.alfa'`))[0].company_id;
    const hash = (await rows(sql`SELECT password_hash FROM users WHERE username = 'admin.alfa'`))[0].password_hash;
    await run(sql`INSERT INTO users (username, password_hash, company_id, role) VALUES ('ti@alfa.com', ${hash}, ${alfa}, 'member')`);
    const t = (await login('ti@alfa.com').expect(200)).body.token;
    expect((await request(app).get('/api/me').set(bearer(t)).expect(200)).body.username).toBe('ti@alfa.com');
  });
});

describe('the company that signed itself up', () => {
  async function two() {
    const alfa = (await signUp().expect(201)).body.token as string;
    const beta = (await signUp({ companyName: 'Industria Beta', username: 'admin.beta', email: 'ti@beta.com' }).expect(201)).body.token as string;
    return { alfa, beta };
  }

  test('its administrator creates users in it; an e-mail of another company (or of a deactivated user) is refused', async () => {
    const { alfa } = await two();
    const r = await request(app).post('/api/users').set(bearer(alfa)).send({ username: 'joao.s', email: 'joao@alfa.com', role: 'member' }).expect(201);
    const companyOf = async (u: string) => (await rows(sql`SELECT c.name FROM users x JOIN companies c ON c.id = x.company_id WHERE x.username = ${u}`))[0].name;
    expect(await companyOf('joao.s')).toBe('Industria Alfa');
    await request(app).post('/api/users').set(bearer(alfa)).send({ username: 'adm2', email: 'adm2@alfa.com', role: 'company_admin' }).expect(201);
    expect((await request(app).post('/api/users').set(bearer(alfa)).send({ username: 'xyz1', email: 'TI@BETA.com', role: 'member' }).expect(409)).body.error).toBe('E-mail already in use');
    await request(app).patch(`/api/users/${r.body.user.id}`).set(bearer(alfa)).send({ active: false }).expect(200);
    expect((await signUp({ companyName: 'Gama', username: 'admin.gama', email: 'joao@alfa.com' }).expect(409)).body.error).toBe('E-mail already in use');
  });

  test('Alfa and Beta do not reach each other: users, companies and designs', async () => {
    const { alfa, beta } = await two();
    const betaCompany = (await rows(sql`SELECT company_id FROM users WHERE username = 'admin.beta'`))[0].company_id;
    await request(app).get(`/api/users?companyId=${betaCompany}`).set(bearer(alfa)).expect(403);
    await request(app).post('/api/users').set(bearer(alfa)).send({ username: 'intruso', email: 'i@x.com', role: 'member', companyId: betaCompany }).expect(403);
    expect((await request(app).get('/api/users').set(bearer(beta)).expect(200)).body.items.map((u: any) => u.username)).toEqual(['admin.beta']);
    await request(app).get('/api/companies').set(bearer(alfa)).expect(403);

    const id = (await request(app).post('/api/designs').set(bearer(alfa)).send({ name: 'Etiqueta Alfa', ...base }).expect(201)).body.designId;
    expect((await request(app).get('/api/designs').set(bearer(beta)).expect(200)).body.items).toEqual([]);
    await request(app).get(`/api/designs/${id}`).set(bearer(beta)).expect(404);
    await request(app).delete(`/api/designs/${id}`).set(bearer(beta)).expect(404);
  });

  test('sees the templates, and its integration token reads only its designs', async () => {
    const { alfa, beta } = await two();
    await run(sql`INSERT INTO templates (name, zpl, elements_json, label_width, label_height) VALUES ('Picking', '^XA^XZ', '[]', 800, 600)`);
    expect((await request(app).get('/api/templates').set(bearer(beta)).expect(200)).body.items.map((t: any) => t.name)).toEqual(['Picking']);
    await request(app).post('/api/designs').set(bearer(alfa)).send({ name: 'Etiqueta Alfa', ...base }).expect(201);
    const token = (await request(app).post('/api/tokens').set(bearer(beta)).send({ name: 'SAP' }).expect(201)).body.token;
    expect((await request(app).get('/api/designs').set(bearer(token)).expect(200)).body.items).toEqual([]);
  });
});
