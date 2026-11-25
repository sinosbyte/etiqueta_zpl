// Users and companies screens (Fase 05, etapa 4): who is offered what, the checks before sending, the account store
// and the forced change of a temporary password.

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => 'jwt', saveToken: jest.fn(), triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => null) }));

const meAnswer: any = { current: null };
jest.mock('../src/utils/accountClient', () => ({
  getMe: jest.fn(async () => { if (meAnswer.current instanceof Error) throw meAnswer.current; return meAnswer.current; }),
}));

import {
  isAdmin, canManageCompanies, assignableRoles, lockReason, newUserProblem, companyNameProblem, passwordProblem, roleKey, PROTECTED_USERNAMES,
  hasDesigns, managesTokens,
} from '../src/utils/admin';
import { useAccountStore } from '../src/store/useAccountStore';
import { apiFetch } from '../src/utils/apiClient';
import { viewFromPath, pathOf } from '../src/utils/navigation';

const me = (role: any, userId = 1): any => ({ userId, username: 'eu', email: null, role, company: { id: 10, name: 'Acme' }, mustChangePassword: false });
const target = (role: any, id = 2): any => ({ id, username: 'outro', email: 'o@a.com', role, active: true, mustChangePassword: false, companyId: 10, createdAt: '' });

describe('who is offered what', () => {
  test('administrators: the company admin and the Sinosbyte admin; companies: only the Sinosbyte admin', () => {
    expect([isAdmin('platform_admin'), isAdmin('company_admin'), isAdmin('member'), isAdmin(undefined)]).toEqual([true, true, false, false]);
    expect([canManageCompanies('platform_admin'), canManageCompanies('company_admin'), canManageCompanies('member')]).toEqual([true, false, false]);
  });

  test('a company admin never offers the Sinosbyte role; a Sinosbyte admin offers only it in the platform and only company admin in a client; a member offers nothing', () => {
    expect(assignableRoles('platform_admin', true)).toEqual(['platform_admin']);
    expect(assignableRoles('platform_admin', false)).toEqual(['company_admin']);
    expect(assignableRoles('company_admin')).toEqual(['member', 'company_admin']);
    expect(assignableRoles('member')).toEqual([]);
  });

  test('the Sinosbyte administrators have no designs and no tokens; only a company admin manages tokens', () => {
    expect([hasDesigns('platform_admin'), hasDesigns('company_admin'), hasDesigns('member')]).toEqual([false, true, true]);
    expect([managesTokens('platform_admin'), managesTokens('company_admin'), managesTokens('member')]).toEqual([false, true, false]);
  });

  test('locked rows: one\'s own, and a Sinosbyte admin seen by a company admin', () => {
    expect(lockReason(me('company_admin', 2), target('member', 2))).toBe('admin.lock.self');
    expect(lockReason(me('company_admin'), target('platform_admin'))).toBe('admin.lock.platform');
    expect(lockReason(me('platform_admin'), target('platform_admin'))).toBeNull();
    expect(lockReason(me('company_admin'), target('member'))).toBeNull();
  });

  test('the account of the SAP integration is protected, and every role has a name', () => {
    expect(PROTECTED_USERNAMES).toContain('sinosbyte');
    expect(['platform_admin', 'company_admin', 'member'].map(r => roleKey(r as any))).toEqual(['admin.role.platform_admin', 'admin.role.company_admin', 'admin.role.member']);
  });
});

describe('checks before sending', () => {
  test('a new user needs 3 to 50 characters and a valid e-mail', () => {
    expect(newUserProblem('ab', 'a@b.com')).toBe('admin.problem.username');
    expect(newUserProblem('x'.repeat(51), 'a@b.com')).toBe('admin.problem.username');
    expect(newUserProblem('maria', 'nao-e-email')).toBe('admin.problem.email');
    expect(newUserProblem('maria', 'maria@acme')).toBe('admin.problem.email');
    expect(newUserProblem(' maria ', ' maria@acme.com ')).toBeNull();
  });

  test('a company name needs 2 to 100 characters', () => {
    expect(companyNameProblem('A')).toBe('admin.problem.companyName');
    expect(companyNameProblem('Acme')).toBeNull();
  });

  test('a new password: the current one, 8 to 72 characters, the same twice, different from the current', () => {
    expect(passwordProblem('', 'novasenha1', 'novasenha1')).toBe('password.problem.current');
    expect(passwordProblem('atual', 'curta', 'curta')).toBe('password.problem.length');
    expect(passwordProblem('atual', 'novasenha1', 'novasenha2')).toBe('password.problem.confirm');
    expect(passwordProblem('novasenha1', 'novasenha1', 'novasenha1')).toBe('password.problem.same');
    expect(passwordProblem('atual', 'novasenha1', 'novasenha1')).toBeNull();
  });
});

describe('the account store', () => {
  beforeEach(() => { useAccountStore.getState().clear(); meAnswer.current = null; });

  test('loads who is signed in and whether the password must be changed', async () => {
    meAnswer.current = { ...me('member'), mustChangePassword: true };
    await useAccountStore.getState().load();
    expect(useAccountStore.getState().me?.role).toBe('member');
    expect(useAccountStore.getState().mustChangePassword).toBe(true);
    useAccountStore.getState().passwordChanged();
    expect(useAccountStore.getState().mustChangePassword).toBe(false);
    expect(useAccountStore.getState().me?.mustChangePassword).toBe(false);
  });

  test('a failed load leaves nothing half done, and clear forgets everything', async () => {
    meAnswer.current = new Error('offline');
    await useAccountStore.getState().load();
    expect(useAccountStore.getState()).toMatchObject({ me: null, loading: false, mustChangePassword: false });
    meAnswer.current = me('company_admin');
    await useAccountStore.getState().load();
    useAccountStore.getState().clear();
    expect(useAccountStore.getState()).toMatchObject({ me: null, mustChangePassword: false });
  });

  test('any call refused with "Password change required" brings the change screen', async () => {
    (globalThis as any).fetch = jest.fn(async () => ({
      status: 403, ok: false, headers: { get: () => null },
      text: async () => JSON.stringify({ error: 'Password change required' }),
    }));
    await expect(apiFetch('/api/designs')).rejects.toBeTruthy();
    expect(useAccountStore.getState().mustChangePassword).toBe(true);
  });

  test('another 403 does not', async () => {
    useAccountStore.getState().clear();
    (globalThis as any).fetch = jest.fn(async () => ({
      status: 403, ok: false, headers: { get: () => null },
      text: async () => JSON.stringify({ error: 'Administrator access required' }),
    }));
    await expect(apiFetch('/api/users')).rejects.toBeTruthy();
    expect(useAccountStore.getState().mustChangePassword).toBe(false);
  });
});

describe('the addresses', () => {
  test('/admin and /account are screens of their own', () => {
    expect(pathOf('admin')).toBe('/admin');
    expect(pathOf('account')).toBe('/account');
    expect(viewFromPath('/admin')).toBe('admin');
    expect(viewFromPath('/account/')).toBe('account');
  });
});
