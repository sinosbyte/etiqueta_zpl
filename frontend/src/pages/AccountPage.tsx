import React, { useEffect, useState } from 'react';
import { requestLogout } from '../utils/logout';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useAccountStore } from '../store/useAccountStore';
import { roleKey } from '../utils/admin';
import { toast } from '../store/useToastStore';
import { updateMyEmail } from '../utils/accountClient';
import { validEmail } from '../utils/signup';

/** The own e-mail: it also signs in, so the current password confirms the change */
function EmailForm({ current, onDone }: { current: string | null; onDone: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const next = email.trim().toLowerCase();
    if (!validEmail(next)) { setError(t('signup.problem.email')); return; }
    if (next === (current ?? '')) { setError(t('account.emailSame')); return; }
    if (!password) { setError(t('password.problem.current')); return; }
    setBusy(true);
    try {
      await updateMyEmail(next, password);
      setEmail(''); setPassword('');
      toast.success(t('account.emailChanged'));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.title'));
    } finally { setBusy(false); }
  };
  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--chrome-text-faint)', marginBottom: 4 };
  return (
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="email-form">
      <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5, margin: 0 }}>{t(current ? 'account.emailHelp' : 'account.emailMissing')}</p>
      <div>
        <label htmlFor="account-email" style={label}>{t('account.newEmail')}</label>
        <input id="account-email" className="chrome-input" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="account-email-password" style={label}>{t('password.current')}</label>
        <input id="account-email-password" className="chrome-input" type="password" autoComplete="current-password" maxLength={72} value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      {error && <div role="alert" style={{ fontSize: 11, color: 'var(--status-error)' }}>{error}</div>}
      <button type="submit" disabled={busy} className="chrome-btn chrome-btn-primary" style={{ alignSelf: 'flex-start' }}>
        {busy ? t('login.wait') : t('account.saveEmail')}
      </button>
    </form>
  );
}

const card: React.CSSProperties = { background: 'var(--chrome-surface)', border: '1px solid var(--chrome-border)', borderRadius: 8, padding: 16 };

/** The header of the pages outside the editor: back to the editor, the title, the language */
export function PageHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const t = useT();
  return (
    <div style={{ height: 44, background: 'var(--chrome-surface)', borderBottom: '1px solid var(--chrome-border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
      {onBack && (
        <>
          <button onClick={onBack} className="chrome-btn chrome-btn-ghost" style={{ gap: 6, fontSize: 12 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {t('designs.editor')}
          </button>
          <div style={{ width: 1, height: 18, background: 'var(--chrome-border)' }} />
        </>
      )}
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{title}</span>
      <div style={{ flex: 1 }} />
      <LanguageSelect />
    </div>
  );
}

/** My account: who I am, my company and role, and the change of my password */
export function AccountPage({ onBack }: { onBack: () => void }) {
  const t = useT();
  const { me, load } = useAccountStore();
  useEffect(() => { void load(); }, [load]);
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
      <span style={{ width: 110, color: 'var(--chrome-text-faint)' }}>{label}</span>
      <span style={{ color: 'var(--chrome-text)' }}>{value}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
      <PageHeader title={t('account.title')} onBack={onBack} />
      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="account-info">
            {me ? (
              <>
                {row(t('account.username'), me.username)}
                {row(t('account.email'), me.email ?? '—')}
                {row(t('account.company'), me.company.name)}
                {row(t('account.role'), t(roleKey(me.role)))}
              </>
            ) : <span style={{ fontSize: 13, color: 'var(--chrome-text-faint)' }}>{t('login.wait')}</span>}
          </div>
          {me && (
            <div style={card}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 12 }}>{t('account.emailTitle')}</h2>
              <EmailForm current={me.email} onDone={() => void load()} />
            </div>
          )}
          <div style={card}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 12 }}>{t('password.title')}</h2>
            <ChangePasswordForm onDone={() => toast.success(t('password.changed'))} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The first login with a temporary password: nothing else is reachable until it is changed */
export function ChangePasswordPage() {
  const t = useT();
  return (
    <div style={{ minHeight: '100vh', background: 'var(--chrome-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} data-testid="forced-password-change">
      <div style={{ width: '100%', maxWidth: 380, ...card, padding: 24 }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 6 }}>{t('password.forcedTitle')}</h1>
        <p style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.6, marginBottom: 18 }}>{t('password.forcedHelp')}</p>
        <ChangePasswordForm onDone={() => toast.success(t('password.changed'))} />
        <button type="button" onClick={() => void requestLogout()} className="chrome-btn chrome-btn-ghost" style={{ marginTop: 12, width: '100%', justifyContent: 'center', fontSize: 12 }}>
          {t('toolbar.logout')}
        </button>
      </div>
    </div>
  );
}
