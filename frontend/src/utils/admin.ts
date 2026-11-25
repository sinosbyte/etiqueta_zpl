import type { Role, Me, UserSummary } from './accountClient';
import type { MessageKey } from '../i18n';

// Who may see and do what on the screens of users and companies. The server checks all of it again; this only decides
// what is offered, so that nobody is shown a button that would be refused.

export const isAdmin = (role: Role | undefined): boolean => role === 'platform_admin' || role === 'company_admin';
export const canManageCompanies = (role: Role | undefined): boolean => role === 'platform_admin';
/** The Sinosbyte administrators have no designs and no integration tokens (Fase 06): they keep companies and templates */
export const hasDesigns = (role: Role | undefined): boolean => role !== 'platform_admin';
/** The integration tokens are the company's and only its administrators manage them */
export const managesTokens = (role: Role | undefined): boolean => role === 'company_admin';

/**
 * The roles an administrator may give in a company (Fase 06): a company admin gives member or company admin; a
 * Sinosbyte admin gives only the Sinosbyte role in the platform company and only company admin in a client company.
 */
export function assignableRoles(actor: Role, platformCompany = false): Role[] {
  if (actor === 'platform_admin') return platformCompany ? ['platform_admin'] : ['company_admin'];
  if (actor === 'company_admin') return ['member', 'company_admin'];
  return [];
}

export const roleKey = (role: Role): MessageKey =>
  role === 'platform_admin' ? 'admin.role.platform_admin' : role === 'company_admin' ? 'admin.role.company_admin' : 'admin.role.member';

/** Why a user row cannot be changed by the one looking at it, or null when it can */
export function lockReason(actor: Me, target: UserSummary): MessageKey | null {
  if (target.id === actor.userId) return 'admin.lock.self';
  if (actor.role === 'company_admin' && target.role === 'platform_admin') return 'admin.lock.platform';
  return null;
}

/** The account the SAP integration logs in with while the legacy mode exists: never disabled */
export const PROTECTED_USERNAMES: readonly string[] = ['sinosbyte'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with a new user, or null (the server checks the same and more) */
export function newUserProblem(username: string, email: string): MessageKey | null {
  if (username.trim().length < 3 || username.trim().length > 50) return 'admin.problem.username';
  if (!EMAIL.test(email.trim()) || email.trim().length > 254) return 'admin.problem.email';
  return null;
}

export function companyNameProblem(name: string): MessageKey | null {
  return name.trim().length < 2 || name.trim().length > 100 ? 'admin.problem.companyName' : null;
}

/** What is wrong with a password change, or null */
export function passwordProblem(current: string, next: string, confirm: string): MessageKey | null {
  if (!current) return 'password.problem.current';
  if (next.length < 8 || next.length > 72) return 'password.problem.length';
  if (next !== confirm) return 'password.problem.confirm';
  if (next === current) return 'password.problem.same';
  return null;
}
