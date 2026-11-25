process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/etiqueta_test';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { sql } from 'drizzle-orm';
import app from '../app';
import { initDb, _resetDb, getDb } from '../db/database';
import {
  usersTable, companiesTable, designsTable, designVersionsTable, designTestVariantsTable, apiTokensTable, refreshTokensTable,
} from '../db/schema';
import { registerUser } from '../auth/authService';
import { updateUser } from './usersService';

/**
 * Fase 05, etapa 3: sign-up closed, roles applied, user and company status checked on every request, administration
 * of users and companies, temporary passwords, and who may delete a design.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = { zpl: '^XA^XZ', elements: [], labelWidth: 800, labelHeight: 600 };
const run = (q: ReturnType<typeof sql>) => getDb().execute(q);
const one = async (q: ReturnType<typeof sql>) => ((await run(q)).rows as any[])[0];

const login = (username: string, password = 'password123') => request(app).post('/api/auth/login').send({ username, password });
const jwtOf = async (username: string, password = 'password123') => (await login(username, password).expect(200)).body.token as string;
const idOf = async (username: string) => (await one(sql`SELECT id FROM users WHERE username = ${username}`)).id as number;

/** A user in the company of `company` (the name of a user whose company it is), with a role */
async function user(username: string, role: 'platform_admin' | 'company_admin' | 'member', companyOf?: string) {
  await registerUser(username, 'password123');
  if (companyOf) {
    // moved into that company; the company of their own that sign-up made is left empty, so it goes
    await run(sql`UPDATE users SET company_id = (SELECT company_id FROM users WHERE username = ${companyOf}) WHERE username = ${username}`);
    await run(sql`DELETE FROM companies c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id)`);
  }
  await run(sql`UPDATE users SET role = ${role}, is_admin = ${role === 'platform_admin'} WHERE username = ${username}`);
}

beforeAll(async () => { await initDb(); });
beforeEach(async () => {
  const db = getDb();
  await db.delete(designTestVariantsTable);
  await db.delete(designVersionsTable);
  await db.delete(designsTable);
  await db.delete(apiTokensTable);
  await db.delete(refreshTokensTable);
  await db.delete(usersTable);
  await db.delete(companiesTable);
  // Sinosbyte: sinosbyte (platform_admin) and guilherme (company_admin), as in production; Acme: ana (admin) and joao (member)
  await user('sinosbyte', 'platform_admin');
  await run(sql`UPDATE companies SET name = 'Sinosbyte' WHERE id = (SELECT company_id FROM users WHERE username = 'sinosbyte')`);
  await user('guilherme', 'company_admin', 'sinosbyte');
  await user('ana', 'company_admin');
  await run(sql`UPDATE companies SET name = 'Acme' WHERE id = (SELECT company_id FROM users WHERE username = 'ana')`);
  await user('joao', 'member', 'ana');
});
afterAll(async () => { await _resetDb(); });

describe('sign-up', () => {
  test('is closed: the address answers 403 and creates nobody', async () => {
    const before = (await one(sql`SELECT count(*)::int AS n FROM users`)).n;
    const r = await request(app).post('/api/auth/register').send({ username: 'intruso', password: 'password123' }).expect(403);
    expect(r.body.error).toBe('Sign-up is closed');
    expect((await one(sql`SELECT count(*)::int AS n FROM users`)).n).toBe(before);
  });
});

describe('who am I', () => {
  test('/api/me says the role and the company; login says whether the password must be changed', async () => {
    const r = await login('joao').expect(200);
    expect(r.body.mustChangePassword).toBe(false);
    const me = (await request(app).get('/api/me').set(bearer(r.body.token)).expect(200)).body;
    expect(me).toMatchObject({ username: 'joao', role: 'member', company: { name: 'Acme' }, mustChangePassword: false });
  });
});

describe('a deactivated user or company', () => {
  test('a user loses access at once: the token in hand, the refresh, the login (only with the right password) and their integration token', async () => {
    const agent = request.agent(app);
    const token = (await agent.post('/api/auth/login').send({ username: 'joao', password: 'password123' }).expect(200)).body.token;
    const apiToken = (await request(app).post('/api/tokens').set(bearer(token)).send({ name: 'SAP' }).expect(201)).body.token;
    await request(app).get('/api/designs').set(bearer(apiToken)).expect(200);

    await request(app).patch(`/api/users/${await idOf('joao')}`).set(bearer(await jwtOf('ana'))).send({ active: false }).expect(200);

    expect((await request(app).get('/api/designs').set(bearer(token)).expect(401)).body.error).toBe('Account disabled');
    await agent.post('/api/auth/refresh').expect(401);
    expect((await login('joao').expect(403)).body.error).toBe('Account disabled');
    expect((await login('joao', 'wrong-password').expect(401)).body.error).toBe('Invalid username or password');
    await request(app).get('/api/designs').set(bearer(apiToken)).expect(401);

    await request(app).patch(`/api/users/${await idOf('joao')}`).set(bearer(await jwtOf('ana'))).send({ active: true }).expect(200);
    await login('joao').expect(200);
    await request(app).get('/api/designs').set(bearer(apiToken)).expect(200);       // the token works again (it was not revoked)
  });

  test('a deactivated company locks out all of its users and their tokens', async () => {
    const token = await jwtOf('ana');
    const apiToken = (await request(app).post('/api/tokens').set(bearer(token)).send({ name: 'SAP' }).expect(201)).body.token;
    const acme = (await one(sql`SELECT company_id FROM users WHERE username = 'ana'`)).company_id;
    await request(app).patch(`/api/companies/${acme}`).set(bearer(await jwtOf('sinosbyte'))).send({ active: false }).expect(200);
    await request(app).get('/api/designs').set(bearer(token)).expect(401);
    await login('joao').expect(403);
    await request(app).get('/api/designs').set(bearer(apiToken)).expect(401);
  });
});

describe('who may manage users', () => {
  test('a member may not; a company admin sees only their company; a Sinosbyte admin sees any', async () => {
    await request(app).get('/api/users').set(bearer(await jwtOf('joao'))).expect(403);
    const ana = await jwtOf('ana');
    expect((await request(app).get('/api/users').set(bearer(ana)).expect(200)).body.items.map((u: any) => u.username)).toEqual(['ana', 'joao']);
    const sinos = (await one(sql`SELECT company_id FROM users WHERE username = 'sinosbyte'`)).company_id;
    await request(app).get(`/api/users?companyId=${sinos}`).set(bearer(ana)).expect(403);
    const acme = (await one(sql`SELECT company_id FROM users WHERE username = 'ana'`)).company_id;
    expect((await request(app).get(`/api/users?companyId=${acme}`).set(bearer(await jwtOf('sinosbyte'))).expect(200)).body.items).toHaveLength(2);
  });

  test('an integration token cannot reach the administration', async () => {
    const apiToken = (await request(app).post('/api/tokens').set(bearer(await jwtOf('ana'))).send({ name: 'SAP' }).expect(201)).body.token;
    await request(app).get('/api/users').set(bearer(apiToken)).expect(403);
    await request(app).get('/api/companies').set(bearer(apiToken)).expect(403);
  });

  test('a company admin cannot touch a user of another company (not found) nor a Sinosbyte admin of their own (forbidden)', async () => {
    await request(app).patch(`/api/users/${await idOf('joao')}`).set(bearer(await jwtOf('guilherme'))).send({ active: false }).expect(404);
    await request(app).patch(`/api/users/${await idOf('sinosbyte')}`).set(bearer(await jwtOf('guilherme'))).send({ role: 'member' }).expect(403);
    await request(app).post(`/api/users/${await idOf('sinosbyte')}/reset-password`).set(bearer(await jwtOf('guilherme'))).expect(403);
  });
});

describe('creating a user', () => {
  test('with a temporary password shown once; the new user must change it before anything else', async () => {
    const r = await request(app).post('/api/users').set(bearer(await jwtOf('ana'))).send({ username: 'maria', email: 'Maria@Acme.com', role: 'member' }).expect(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
    expect(r.body.user).toMatchObject({ username: 'maria', email: 'maria@acme.com', role: 'member', active: true, mustChangePassword: true });

    const first = await login('maria', r.body.temporaryPassword).expect(200);
    expect(first.body.mustChangePassword).toBe(true);
    expect((await request(app).get('/api/designs').set(bearer(first.body.token)).expect(403)).body.error).toBe('Password change required');
    await request(app).get('/api/me').set(bearer(first.body.token)).expect(200);

    const change = (body: object) => request(app).post('/api/auth/change-password').set(bearer(first.body.token)).send(body);
    await change({ currentPassword: 'wrong', newPassword: 'nova-senha-123' }).expect(400);
    await change({ currentPassword: r.body.temporaryPassword, newPassword: r.body.temporaryPassword }).expect(400);
    await change({ currentPassword: r.body.temporaryPassword, newPassword: 'curta' }).expect(400);
    const changed = await change({ currentPassword: r.body.temporaryPassword, newPassword: 'nova-senha-123' }).expect(200);
    await request(app).get('/api/designs').set(bearer(changed.body.token)).expect(200);
    expect((await login('maria', 'nova-senha-123').expect(200)).body.mustChangePassword).toBe(false);
    await login('maria', r.body.temporaryPassword).expect(401);
  });

  test('a company admin may create members and admins, not Sinosbyte admins; a Sinosbyte admin may', async () => {
    const ana = await jwtOf('ana');
    await request(app).post('/api/users').set(bearer(ana)).send({ username: 'adm2', email: 'adm2@acme.com', role: 'company_admin' }).expect(201);
    expect((await request(app).post('/api/users').set(bearer(ana)).send({ username: 'xyz', email: 'x@acme.com', role: 'platform_admin' }).expect(403)).body.error).toBe('You cannot give this role');
    const sinos = await jwtOf('sinosbyte');
    const created = (await request(app).post('/api/users').set(bearer(sinos)).send({ username: 'suporte', email: 'suporte@sinosbyte.com', role: 'platform_admin' }).expect(201)).body.user;
    expect((await one(sql`SELECT is_admin FROM users WHERE id = ${created.id}`)).is_admin).toBe(true);   // mirrors the role
  });

  test('the user name and the e-mail are unique (the e-mail whatever the case); a bad e-mail is refused', async () => {
    const ana = await jwtOf('ana');
    await request(app).post('/api/users').set(bearer(ana)).send({ username: 'maria', email: 'maria@acme.com' }).expect(201);
    expect((await request(app).post('/api/users').set(bearer(ana)).send({ username: 'maria', email: 'outra@acme.com' }).expect(409)).body.error).toBe('Username already taken');
    expect((await request(app).post('/api/users').set(bearer(ana)).send({ username: 'maria2', email: 'MARIA@acme.com' }).expect(409)).body.error).toBe('E-mail already in use');
    await request(app).post('/api/users').set(bearer(ana)).send({ username: 'maria3', email: 'nao-e-email' }).expect(400);
    await request(app).post('/api/users').set(bearer(ana)).send({ username: 'maria4' }).expect(400);           // e-mail required
  });
});

describe('the protections', () => {
  test('nobody changes their own role or status', async () => {
    const ana = await jwtOf('ana');
    expect((await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(ana)).send({ active: false }).expect(409)).body.error).toBe('You cannot change your own role or status');
    await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(ana)).send({ role: 'member' }).expect(409);
    await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(ana)).send({ email: 'ana@acme.com' }).expect(200);   // the rest is fine
  });

  test('a company keeps an active administrator', async () => {
    const sinos = await jwtOf('sinosbyte');
    const r = await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(sinos)).send({ role: 'member' }).expect(409);
    expect(r.body.error).toBe('A company needs at least one active administrator');
    await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(sinos)).send({ active: false }).expect(409);
    await request(app).patch(`/api/users/${await idOf('joao')}`).set(bearer(sinos)).send({ role: 'company_admin' }).expect(200);
    await request(app).patch(`/api/users/${await idOf('ana')}`).set(bearer(sinos)).send({ role: 'member' }).expect(200);   // now there is another
  });

  test('the platform keeps an active Sinosbyte administrator', async () => {
    const actor = { userId: -1, username: 'x', role: 'platform_admin' as const, companyId: 0, mustChangePassword: false };
    await expect(updateUser(actor, await idOf('sinosbyte'), { role: 'company_admin' })).rejects.toThrow('At least one active Sinosbyte administrator is needed');
  });

  test('the account the SAP integration uses cannot be disabled', async () => {
    await user('outro_admin', 'platform_admin', 'sinosbyte');
    const r = await request(app).patch(`/api/users/${await idOf('sinosbyte')}`).set(bearer(await jwtOf('outro_admin'))).send({ active: false }).expect(409);
    expect(r.body.error).toBe('This account is used by the SAP integration and cannot be disabled');
  });

  test('a password reset gives a new temporary password and ends the sessions; not for oneself', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: 'joao', password: 'password123' }).expect(200);
    const ana = await jwtOf('ana');
    const r = await request(app).post(`/api/users/${await idOf('joao')}/reset-password`).set(bearer(ana)).expect(200);
    expect(r.body.temporaryPassword).toHaveLength(14);
    await agent.post('/api/auth/refresh').expect(401);
    await login('joao').expect(401);
    expect((await login('joao', r.body.temporaryPassword).expect(200)).body.mustChangePassword).toBe(true);
    await request(app).post(`/api/users/${await idOf('ana')}/reset-password`).set(bearer(ana)).expect(409);
  });
});

describe('companies', () => {
  test('only a Sinosbyte admin manages them', async () => {
    await request(app).get('/api/companies').set(bearer(await jwtOf('ana'))).expect(403);
    await request(app).get('/api/companies').set(bearer(await jwtOf('guilherme'))).expect(403);
    const list = (await request(app).get('/api/companies').set(bearer(await jwtOf('sinosbyte'))).expect(200)).body.items;
    expect(list.map((c: any) => [c.name, c.userCount])).toEqual([['Acme', 2], ['Sinosbyte', 2]]);
  });

  test('a company is created with its first administrator (temporary password); names are unique whatever the case', async () => {
    const sinos = await jwtOf('sinosbyte');
    const r = await request(app).post('/api/companies').set(bearer(sinos)).send({ name: 'Neugebauer', admin: { username: 'neu_admin', email: 'ti@neu.com' } }).expect(201);
    expect(r.body.company).toMatchObject({ name: 'Neugebauer', active: true, userCount: 1 });
    expect(r.body.user).toMatchObject({ username: 'neu_admin', role: 'company_admin', mustChangePassword: true });
    expect((await login('neu_admin', r.body.temporaryPassword).expect(200)).body.mustChangePassword).toBe(true);
    expect((await request(app).post('/api/companies').set(bearer(sinos)).send({ name: 'neugebauer', admin: { username: 'neu2', email: 'n2@neu.com' } }).expect(409)).body.error).toBe('Company name already taken');
    expect((await one(sql`SELECT count(*)::int AS n FROM users WHERE username = 'neu2'`)).n).toBe(0);   // nothing half done
  });

  test('a company can be renamed (not to a name in use) and not disabled by its own administrator', async () => {
    const sinos = await jwtOf('sinosbyte');
    const acme = (await one(sql`SELECT company_id FROM users WHERE username = 'ana'`)).company_id;
    const own = (await one(sql`SELECT company_id FROM users WHERE username = 'sinosbyte'`)).company_id;
    expect((await request(app).patch(`/api/companies/${acme}`).set(bearer(sinos)).send({ name: 'Acme Ltda' }).expect(200)).body.name).toBe('Acme Ltda');
    await request(app).patch(`/api/companies/${acme}`).set(bearer(sinos)).send({ name: 'SINOSBYTE' }).expect(409);
    expect((await request(app).patch(`/api/companies/${own}`).set(bearer(sinos)).send({ active: false }).expect(409)).body.error).toBe('You cannot disable your own company');
  });
});

describe('deleting a design of the company', () => {
  test('only its creator or an administrator of the company may', async () => {
    const ana = await jwtOf('ana');
    await user('pedro', 'member', 'ana');
    const id = (await request(app).post('/api/designs').set(bearer(await jwtOf('joao'))).send({ name: 'Do Joao', ...base }).expect(201)).body.designId;
    const r = await request(app).delete(`/api/designs/${id}`).set(bearer(await jwtOf('pedro'))).expect(403);
    expect(r.body.error).toBe('Only the creator or an administrator can delete this design');
    await request(app).patch(`/api/designs/${id}`).set(bearer(await jwtOf('pedro'))).send({ name: 'Renomeado' }).expect(200);   // renaming: anyone of the company
    await request(app).delete(`/api/designs/${id}`).set(bearer(ana)).expect(204);
    const own = (await request(app).post('/api/designs').set(bearer(await jwtOf('pedro'))).send({ name: 'Do Pedro', ...base }).expect(201)).body.designId;
    await request(app).delete(`/api/designs/${own}`).set(bearer(await jwtOf('pedro'))).expect(204);
  });
});

describe('templates follow the role', () => {
  test('a company admin is not a Sinosbyte admin; a platform admin manages templates', async () => {
    expect((await request(app).get('/api/templates').set(bearer(await jwtOf('ana'))).expect(200)).body.canManage).toBe(false);
    expect((await request(app).get('/api/templates').set(bearer(await jwtOf('sinosbyte'))).expect(200)).body.canManage).toBe(true);
  });
});
