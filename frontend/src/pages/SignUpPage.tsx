import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useT, MessageKey } from '../i18n';
import { navigate, redirect } from '../utils/navigation';
import { signUpProblem, signUpPayload, SignUpForm } from '../utils/signup';
import { AuthShell, AuthError, authLabel } from './LoginPage';

const MAX: Record<keyof SignUpForm, number> = { companyName: 100, username: 50, email: 254, password: 72, confirm: 72 };

/**
 * A company signs itself up (2026-11-26): the company, its first administrator and the password. The server makes the
 * person the administrator of the new company and answers a session, so they land in the editor already signed in.
 */
export function SignUpPage() {
  const t = useT();
  const signUp = useAuthStore(s => s.signUp);
  const [form, setForm] = useState<SignUpForm>({ companyName: '', username: '', email: '', password: '', confirm: '' });
  // Left empty by people; robots that fill every field are refused by the server
  const [website, setWebsite] = useState('');
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof SignUpForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const p = signUpProblem(form);
    setProblem(p);
    if (p) return;
    setLoading(true);
    try {
      await signUp(signUpPayload(form, website));
      redirect('designer');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.title'));
    } finally {
      setLoading(false);
    }
  };

  const field = (k: keyof SignUpForm, label: MessageKey, type: string, autoComplete: string, hint?: MessageKey, autoFocus = false) => (
    <div>
      <label htmlFor={`signup-${k}`} style={authLabel}>{t(label)}</label>
      <input id={`signup-${k}`} name={k} className="chrome-input" type={type} autoComplete={autoComplete} autoFocus={autoFocus}
        value={form[k]} onChange={set(k)} maxLength={MAX[k]} />
      {hint && <div style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 4 }}>{t(hint)}</div>}
    </div>
  );

  return (
    <AuthShell subtitle={t('signup.subtitle')} width={380}>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="signup-form">
        {field('companyName', 'signup.company', 'text', 'organization', undefined, true)}
        {field('username', 'signup.username', 'text', 'username', 'signup.usernameHint')}
        {field('email', 'signup.email', 'email', 'email', 'signup.emailHint')}
        {field('password', 'signup.password', 'password', 'new-password', 'signup.passwordHint')}
        {field('confirm', 'signup.confirm', 'password', 'new-password')}
        {/* Hidden from people (moved off screen; some robots skip fields with display none) */}
        <div aria-hidden="true" style={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="signup-website">Website</label>
          <input id="signup-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
        </div>

        {(problem || error) && <AuthError text={problem ? t(problem) : error} />}

        <button type="submit" disabled={loading} className="chrome-btn chrome-btn-primary"
          style={{ justifyContent: 'center', padding: '9px 0', fontSize: 13, opacity: loading ? 0.7 : 1 }}>
          {loading ? t('login.wait') : t('signup.submit')}
        </button>
        <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', lineHeight: 1.5, margin: 0 }}>{t('signup.note')}</p>
      </form>
      <div style={{ borderTop: '1px solid var(--chrome-border)', margin: '14px 0 0', paddingTop: 12, textAlign: 'center', fontSize: 12, color: 'var(--chrome-text-muted)' }}>
        {t('signup.haveAccount')}{' '}
        <a href="/" data-testid="login-link" onClick={e => { e.preventDefault(); navigate('designer'); }} style={{ color: 'var(--accent)', fontWeight: 500 }}>
          {t('login.signIn')}
        </a>
      </div>
    </AuthShell>
  );
}
