import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';

export function LoginPage() {
  const { login, register } = useAuthStore();
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.title'));
    } finally {
      setLoading(false);
    }
  };

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
      <div style={{ width: '100%', maxWidth: 340 }}>
        {/* Mark + wordmark */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
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
            {t('login.tagline')}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--chrome-surface)',
          border: '1px solid var(--chrome-border)',
          borderRadius: 10,
          padding: 24,
        }}>
          {/* Mode toggle */}
          <div style={{
            display: 'flex',
            background: 'var(--chrome-elevated)',
            borderRadius: 6,
            padding: 2,
            marginBottom: 20,
          }}>
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); }}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  borderRadius: 4,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  background: mode === m ? 'var(--chrome-bg)' : 'transparent',
                  color: mode === m ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
                  boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {m === 'login' ? t('login.signIn') : t('login.createAccount')}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                {t('login.username')}
              </label>
              <input
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
              <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                {t('login.password')}
              </label>
              <input
                className="chrome-input"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
              />
            </div>

            {error && (
              <div style={{
                fontSize: 11,
                color: 'var(--status-error)',
                background: 'var(--status-error-subtle)',
                border: '1px solid rgba(247,92,92,0.3)',
                borderRadius: 5,
                padding: '7px 10px',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="chrome-btn chrome-btn-primary"
              style={{ justifyContent: 'center', padding: '9px 0', fontSize: 13, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? t('login.wait') : mode === 'login' ? t('login.signIn') : t('login.createAccount')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
