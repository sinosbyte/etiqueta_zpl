// Self-service sign-up of a company (2026-11-26, etapa 2): the checks before sending, what is sent, the address,
// and the sign-up that lands signed in.

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

import { signUpProblem, signUpPayload, validEmail, SignUpForm } from '../src/utils/signup';
import { viewFromPath, pathOf } from '../src/utils/navigation';
import { en } from '../src/i18n/en';
import { ptBR } from '../src/i18n/pt-BR';

const ok: SignUpForm = { companyName: 'Industria Alfa', username: 'admin.alfa', email: 'ti@alfa.com', password: 'senha-forte-1', confirm: 'senha-forte-1' };

describe('checks before sending', () => {
  test('a good form passes', () => {
    expect(signUpProblem(ok)).toBeNull();
    expect(signUpProblem({ ...ok, companyName: '  Alfa  ', username: ' admin ', email: ' TI@Alfa.com ' })).toBeNull();
  });

  test('each field says what is wrong, in the order of the form', () => {
    expect(signUpProblem({ ...ok, companyName: 'A' })).toBe('signup.problem.company');
    expect(signUpProblem({ ...ok, companyName: 'x'.repeat(101) })).toBe('signup.problem.company');
    expect(signUpProblem({ ...ok, username: 'ab' })).toBe('signup.problem.username');
    expect(signUpProblem({ ...ok, username: 'com espaco' })).toBe('signup.problem.username');
    expect(signUpProblem({ ...ok, username: 'a@b' })).toBe('signup.problem.username');
    expect(signUpProblem({ ...ok, email: 'nao-e-email' })).toBe('signup.problem.email');
    expect(signUpProblem({ ...ok, email: 'ti@alfa' })).toBe('signup.problem.email');
    expect(signUpProblem({ ...ok, password: 'curta', confirm: 'curta' })).toBe('signup.problem.password');
    expect(signUpProblem({ ...ok, password: 'x'.repeat(73), confirm: 'x'.repeat(73) })).toBe('signup.problem.password');
    expect(signUpProblem({ ...ok, confirm: 'outra-senha' })).toBe('signup.problem.confirm');
    expect(signUpProblem({ ...ok, companyName: 'A', email: 'x' })).toBe('signup.problem.company');
  });

  test('e-mails', () => {
    expect([validEmail('a@b.co'), validEmail(' a@b.co '), validEmail('a@b'), validEmail('a b@c.com'), validEmail('')]).toEqual([true, true, false, false, false]);
  });
});

describe('what is sent', () => {
  test('trimmed, e-mail in small letters, never the confirmation, the hidden field as it is', () => {
    expect(signUpPayload({ ...ok, companyName: ' Alfa ', username: ' admin ', email: ' TI@Alfa.COM ' }))
      .toEqual({ companyName: 'Alfa', username: 'admin', email: 'ti@alfa.com', password: 'senha-forte-1', website: '' });
    expect(signUpPayload(ok, 'robot').website).toBe('robot');
    expect(signUpPayload(ok)).not.toHaveProperty('confirm');
  });
});

describe('the address and the texts', () => {
  test('/cadastro is the sign-up page', () => {
    expect(pathOf('signup')).toBe('/cadastro');
    expect(viewFromPath('/cadastro')).toBe('signup');
    expect(viewFromPath('/cadastro/')).toBe('signup');
  });

  test('every sign-up text exists in both languages', () => {
    const keys = Object.keys(en).filter(k => k.startsWith('signup.') || k.startsWith('account.email') || ['login.newCompany', 'login.signUpLink', 'api.signupFailed'].includes(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect((ptBR as any)[k]).toBeTruthy();
    expect((ptBR as any)['login.username']).toBe('E-mail ou usuário');
  });
});

describe('signing up lands signed in', () => {
  test('the token answered is kept and the store is signed in; a refusal keeps the person signed out', async () => {
    const saveToken = jest.fn();
    const apiSignUp = jest.fn(async (_p: Record<string, string>) => 'novo-token');
    jest.doMock('../src/utils/authClient', () => ({
      getToken: () => null, saveToken, clearToken: jest.fn(), isTokenExpired: () => true, registerOn401Handler: jest.fn(),
      apiLogin: jest.fn(), apiLogout: jest.fn(), refreshAccessToken: jest.fn(async () => null), apiSignUp,
    }));
    const { useAuthStore } = await import('../src/store/useAuthStore');
    await useAuthStore.getState().signUp(signUpPayload(ok));
    expect(apiSignUp).toHaveBeenCalledWith(signUpPayload(ok));
    expect(saveToken).toHaveBeenCalledWith('novo-token');
    expect(useAuthStore.getState().token).toBe('novo-token');

    useAuthStore.setState({ token: null });
    apiSignUp.mockRejectedValueOnce(new Error('Esse e-mail ja esta em uso'));
    await expect(useAuthStore.getState().signUp(signUpPayload(ok))).rejects.toThrow('Esse e-mail ja esta em uso');
    expect(useAuthStore.getState().token).toBeNull();
  });
});
