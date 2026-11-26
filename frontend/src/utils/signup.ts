import type { MessageKey } from '../i18n';

// Self-service sign-up of a company (2026-11-26): the checks before sending. The server checks the same again
// (and decides the role and the company); these only spare a round trip and say what is wrong in plain words.

export interface SignUpForm {
  companyName: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validEmail = (email: string): boolean => EMAIL.test(email.trim()) && email.trim().length <= 254;

/** The first thing to fix, or null when the form can be sent */
export function signUpProblem(f: SignUpForm): MessageKey | null {
  const company = f.companyName.trim();
  if (company.length < 2 || company.length > 100) return 'signup.problem.company';
  const user = f.username.trim();
  if (user.length < 3 || user.length > 50 || /[\s@]/.test(user)) return 'signup.problem.username';
  if (!validEmail(f.email)) return 'signup.problem.email';
  if (f.password.length < 8 || f.password.length > 72) return 'signup.problem.password';
  if (f.password !== f.confirm) return 'signup.problem.confirm';
  return null;
}

/** What goes to the server: trimmed, the e-mail in small letters, and never the confirmation */
export function signUpPayload(f: SignUpForm, website = ''): Record<string, string> {
  return {
    companyName: f.companyName.trim(),
    username: f.username.trim(),
    email: f.email.trim().toLowerCase(),
    password: f.password,
    website,
  };
}
