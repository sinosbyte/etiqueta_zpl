import { apiFetch } from './apiClient';
import { saveToken } from './authClient';

// The account of who is signed in, and the administration of users and companies (Fase 05, etapa 4).
// The server decides who may do what; these calls only ask.

export type Role = 'platform_admin' | 'company_admin' | 'member';

export interface Me {
  userId: number;
  username: string;
  email: string | null;
  role: Role;
  /** isPlatform: the company of the Sinosbyte administrators (Fase 06): no designs, no tokens */
  company: { id: number; name: string; isPlatform?: boolean };
  mustChangePassword: boolean;
}

export interface UserSummary {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  companyId: number;
  createdAt: string;
}

export interface CompanySummary {
  id: number;
  name: string;
  active: boolean;
  createdAt: string;
  userCount: number;
  designCount: number;
}

/** A password made by the server for a new or reset user: shown once, never again */
export interface WithTemporaryPassword { temporaryPassword: string }

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const getMe = () => apiFetch<Me>('/api/me');

/** Changes the own password; the server ends the other sessions and answers a fresh one for this browser */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const r = await apiFetch<{ token: string }>('/api/auth/change-password', { ...json('POST', { currentPassword, newPassword }), credentials: 'include' });
  saveToken(r.token);
}

export const listUsers = (companyId?: number) =>
  apiFetch<{ items: UserSummary[] }>(`/api/users${companyId ? `?companyId=${companyId}` : ''}`).then(r => r.items);

export const createUser = (input: { username: string; email: string; role: Role; companyId?: number }) =>
  apiFetch<{ user: UserSummary } & WithTemporaryPassword>('/api/users', json('POST', input));

export const updateUser = (id: number, changes: { email?: string; role?: Role; active?: boolean }) =>
  apiFetch<UserSummary>(`/api/users/${id}`, json('PATCH', changes));

export const resetPassword = (id: number) =>
  apiFetch<{ user: UserSummary } & WithTemporaryPassword>(`/api/users/${id}/reset-password`, json('POST'));

export const listCompanies = () => apiFetch<{ items: CompanySummary[] }>('/api/companies').then(r => r.items);

export const createCompany = (input: { name: string; admin: { username: string; email: string } }) =>
  apiFetch<{ company: CompanySummary; user: UserSummary } & WithTemporaryPassword>('/api/companies', json('POST', input));

export const updateCompany = (id: number, changes: { name?: string; active?: boolean }) =>
  apiFetch<CompanySummary>(`/api/companies/${id}`, json('PATCH', changes));
