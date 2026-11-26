import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { navigate } from '../utils/navigation';

export const authLabel: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
};

/** An error under a form of the pages without a session */
export function AuthError({ text }: { text: string }) {
  return (
    <div role="alert" style={{
      fontSize: 11, color: 'var(--status-error)', background: 'var(--status-error-subtle)',
      border: '1px solid rgba(247,92,92,0.3)', borderRadius: 5, padding: '7px 10px',
    }}>
      {text}
    </div>
  );
}

/** The frame of the pages without a session (sign in, sign up): mark, name, a line under it and a card */
export function AuthShell({ subtitle, width = 340, children }: { subtitle: string; width?: number; children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--chrome-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      position: 'relative',
    }}>
      <LanguageSelect style={{ position: 'absolute', top: 16, right: 16 }} />
      <div style={{ width: '100%', maxWidth: width }}>
        {/* Mark + wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            background: 'var(--chrome-elevated)',
            border: '1px solid var(--chrome-border)',
            borderRadius: 12,
            marginBottom: 14,
          }}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <rect x="2" y="4" width="22" height="14" rx="2" stroke="var(--accent)" strokeWidth="1.5"/>
              <rect x="5" y="7" width="6" height="8" fill="var(--accent)" opacity="0.9"/>
              <rect x="14" y="7" width="8" height="2" fill="var(--chrome-text-muted)"/>
              <rect x="14" y="11" width="6" height="2" fill="var(--chrome-text-muted)"/>
              <rect x="6" y="21" width="14" height="1.5" rx="0.75" fill="var(--chrome-border)"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--chrome-text)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            ZPL Designer
          </h1>
          <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)', margin: 0 }}>
            {subtitle}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--chrome-surface)',
          border: '1px solid var(--chrome-border)',
          borderRadius: 10,
          padding: 24,
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuthStore();
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.title'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell subtitle={t('login.tagline')}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="login-user" style={authLabel}>{t('login.username')}</label>
          <input
            id="login-user"
            className="chrome-input"
            type="text"
            autoComplete="username"
            autoFocus
            required
            minLength={3}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder={t('login.usernamePlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="login-password" style={authLabel}>{t('login.password')}</label>
          <input
            id="login-password"
            className="chrome-input"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('login.passwordPlaceholder')}
          />
        </div>

        {error && <AuthError text={error} />}

        <button
          type="submit"
          disabled={loading}
          className="chrome-btn chrome-btn-primary"
          style={{ justifyContent: 'center', padding: '9px 0', fontSize: 13, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? t('login.wait') : t('login.signIn')}
        </button>
      </form>
      {/* Users of a company get their account from its administrator; a new company signs itself up */}
      <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', lineHeight: 1.5, margin: '14px 0 0', textAlign: 'center' }}>
        {t('login.noAccount')}
      </p>
      <div style={{ borderTop: '1px solid var(--chrome-border)', margin: '14px 0 0', paddingTop: 12, textAlign: 'center', fontSize: 12, color: 'var(--chrome-text-muted)' }}>
        {t('login.newCompany')}{' '}
        <a href="/cadastro" data-testid="signup-link" onClick={e => { e.preventDefault(); navigate('signup'); }} style={{ display: 'block', marginTop: 2, color: 'var(--accent)', fontWeight: 500 }}>
          {t('login.signUpLink')}
        </a>
      </div>
    </AuthShell>
  );
}
