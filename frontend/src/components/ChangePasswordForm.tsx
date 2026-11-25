import React, { useState } from 'react';
import { useT } from '../i18n';
import { changePassword } from '../utils/accountClient';
import { passwordProblem } from '../utils/admin';
import { useAccountStore } from '../store/useAccountStore';
import { useAuthStore } from '../store/useAuthStore';
import { getToken } from '../utils/authClient';

interface Props {
  onDone?(): void;
}

/** Changes the own password: the current one (or the temporary one), the new one twice. */
export function ChangePasswordForm({ onDone }: Props) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(current, next, confirm);
    if (problem) { setError(t(problem)); return; }
    setError('');
    setBusy(true);
    try {
      await changePassword(current, next);
      // the server answered a fresh session (the others ended): the store uses the new token
      useAuthStore.setState({ token: getToken() });
      useAccountStore.getState().passwordChanged();
      setCurrent(''); setNext(''); setConfirm('');
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.title'));
    } finally {
      setBusy(false);
    }
  };

  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--chrome-text-faint)', marginBottom: 4 };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="change-password">
      <div>
        <label style={label}>{t('password.current')}</label>
        <input className="chrome-input" style={{ width: '100%' }} type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
      </div>
      <div>
        <label style={label}>{t('password.new')}</label>
        <input className="chrome-input" style={{ width: '100%' }} type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder={t('password.newPlaceholder')} />
      </div>
      <div>
        <label style={label}>{t('password.confirm')}</label>
        <input className="chrome-input" style={{ width: '100%' }} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--status-error)', background: 'var(--status-error-subtle)', borderRadius: 5, padding: '7px 10px' }}>
          {error}
        </div>
      )}
      <button type="submit" disabled={busy} className="chrome-btn chrome-btn-primary" style={{ justifyContent: 'center', fontSize: 13 }}>
        {busy ? t('login.wait') : t('password.submit')}
      </button>
    </form>
  );
}
