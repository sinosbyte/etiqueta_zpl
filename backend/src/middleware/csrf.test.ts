// CSRF protection (CodeQL alert 3): a request with cookies that changes something must come from the app itself.
import express from 'express';
import request from 'supertest';
import { csrfProtection, isAllowedOrigin } from './csrf';
import { FRONTEND_URL } from '../config';

function makeApp() {
  const app = express();
  app.use(csrfProtection);
  app.all('/x', (_req, res) => { res.status(200).json({ ok: true }); });
  return app;
}

const COOKIE = 'zpl_refresh=abc';
const EVIL = 'http://evil.example';

describe('csrfProtection', () => {
  const app = makeApp();

  test('a POST with the cookie from another site is refused (Origin)', async () => {
    const res = await request(app).post('/x').set('Cookie', COOKIE).set('Origin', EVIL);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Cross-site request refused' });
  });

  test('without Origin, the Referer decides; an unreadable Referer is refused', async () => {
    expect((await request(app).post('/x').set('Cookie', COOKIE).set('Referer', `${EVIL}/page`)).status).toBe(403);
    expect((await request(app).post('/x').set('Cookie', COOKIE).set('Referer', 'not a url')).status).toBe(403);
    expect((await request(app).post('/x').set('Cookie', COOKIE).set('Referer', `${FRONTEND_URL}/designs`)).status).toBe(200);
  });

  test('Origin "null" (sandboxed page, file) is refused', async () => {
    expect((await request(app).post('/x').set('Cookie', COOKIE).set('Origin', 'null')).status).toBe(403);
  });

  test('the frontend and the address of the request itself are accepted', async () => {
    expect((await request(app).post('/x').set('Cookie', COOKIE).set('Origin', FRONTEND_URL)).status).toBe(200);
    const res = await request(app).post('/x').set('Host', 'app.test:3001').set('Cookie', COOKIE).set('Origin', 'http://app.test:3001');
    expect(res.status).toBe(200);
  });

  test('every method that changes something is checked; reading is not', async () => {
    for (const m of ['put', 'patch', 'delete'] as const) {
      expect((await request(app)[m]('/x').set('Cookie', COOKIE).set('Origin', EVIL)).status).toBe(403);
    }
    expect((await request(app).get('/x').set('Cookie', COOKIE).set('Origin', EVIL)).status).toBe(200);
  });

  test('without cookies nothing changes (Bearer token, the SAP login)', async () => {
    expect((await request(app).post('/x').set('Origin', EVIL)).status).toBe(200);
    expect((await request(app).post('/x').set('Authorization', 'Bearer x')).status).toBe(200);
  });

  test('clients that send neither Origin nor Referer (not browsers) pass', async () => {
    expect((await request(app).post('/x').set('Cookie', COOKIE)).status).toBe(200);
  });

  test('allowed origins: the frontend; localhost only outside production', () => {
    expect(isAllowedOrigin(FRONTEND_URL)).toBe(true);
    expect(isAllowedOrigin(EVIL)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true); // tests run outside production
  });
});
