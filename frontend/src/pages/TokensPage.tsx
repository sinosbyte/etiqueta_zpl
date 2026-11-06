import React, { useCallback, useEffect, useState } from 'react';
import { toast } from '../store/useToastStore';
import { apiListTokens, apiCreateToken, apiRevokeToken, CreatedToken, TokenSummary } from '../utils/tokensClient';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';

interface Props {
  onBack: () => void;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * Copies text to the clipboard. Pages served over plain HTTP (as the app is on the internal network)
 * have no navigator.clipboard, so fall back to selecting a hidden field and the old copy command.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the old way
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(field);
  return ok;
}

export function TokensPage({ onBack }: Props) {
  const t = useT();
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState('0');
  const [creating, setCreating] = useState(false);
  // The full token is kept only here, in memory, until the user dismisses it
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens((await apiListTokens()).items);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('tokens.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the page (e.g. from the SAP window) shows the latest "last used"
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      setCreated(await apiCreateToken(name.trim(), Number(days) || undefined));
      setCopied(false);
      setName('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tokens.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    if (await copyText(created.token)) setCopied(true);
    else toast.error(t('tokens.copyFailed'));
  };

  const revoke = async (token: TokenSummary) => {
    if (!window.confirm(t('tokens.revokeConfirm', { name: token.name }))) return;
    try {
      await apiRevokeToken(token.id);
      if (created?.id === token.id) setCreated(null);
      toast.success(t('tokens.revoked', { name: token.name }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tokens.createFailed'));
    }
  };

  const status = (token: TokenSummary) => {
    if (token.revokedAt) return t('tokens.statusRevoked');
    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) return t('tokens.statusExpired');
    return t('tokens.statusActive');
  };

  const card: React.CSSProperties = {
    background: 'var(--chrome-surface)',
    border: '1px solid var(--chrome-border)',
    borderRadius: 8,
    padding: 16,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
      <div style={{
        height: 44,
        background: 'var(--chrome-surface)',
        borderBottom: '1px solid var(--chrome-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        flexShrink: 0,
      }}>
        <button onClick={onBack} className="chrome-btn chrome-btn-ghost" style={{ gap: 6, fontSize: 12 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t('designs.editor')}
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--chrome-border)' }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{t('sidebar.tokens')}</span>
        <div style={{ flex: 1 }} />
        <LanguageSelect />
      </div>

      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
        <p style={{ fontSize: 12, color: 'var(--chrome-text-faint)', lineHeight: 1.6 }}>{t('tokens.intro')}</p>

        <form onSubmit={create} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={{ fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 }}>{t('tokens.name')}</label>
            <input
              className="chrome-input"
              style={{ width: '100%' }}
              value={name}
              maxLength={100}
              placeholder={t('tokens.namePlaceholder')}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--chrome-text-faint)', display: 'block', marginBottom: 4 }}>{t('tokens.validity')}</label>
            <select className="chrome-input" value={days} onChange={e => setDays(e.target.value)}>
              <option value="0">{t('tokens.noExpiry')}</option>
              <option value="90">{t('tokens.days90')}</option>
              <option value="365">{t('tokens.year1')}</option>
            </select>
          </div>
          <button type="submit" disabled={creating || !name.trim()} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }}>
            {t('tokens.generate')}
          </button>
        </form>

        {created && (
          <div style={{ ...card, borderColor: 'var(--status-warning, #d9a441)' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 6 }}>{t('tokens.copyNow')}</p>
            <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', marginBottom: 10 }}>{t('tokens.copyNowHelp')}</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code onClick={e => window.getSelection()?.selectAllChildren(e.currentTarget)} style={{
                flex: 1, fontSize: 12, padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all', userSelect: 'all',
                background: 'var(--chrome-bg)', border: '1px solid var(--chrome-border)', color: 'var(--chrome-text)',
              }}>{created.token}</code>
              <button onClick={copy} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }}>
                {copied ? t('tokens.copied') : t('tokens.copy')}
              </button>
              <button onClick={() => setCreated(null)} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }}>
                {t('common.close')}
              </button>
            </div>
          </div>
        )}

        {loading && <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)' }}>{t('designs.loading')}</p>}
        {!loading && error && <p style={{ fontSize: 13, color: 'var(--status-error)' }}>{error}</p>}
        {!loading && !error && tokens.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)' }}>{t('tokens.empty')}</p>
        )}

        {tokens.map(token => (
          <div key={token.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'center', opacity: token.revokedAt ? 0.6 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)' }}>{token.name}</div>
              <div style={{ fontSize: 11, color: 'var(--chrome-text-faint)', marginTop: 4, lineHeight: 1.6 }}>
                <code>{token.prefix}…</code> · {status(token)}<br />
                {t('tokens.createdAt')}: {when(token.createdAt)} · {t('tokens.lastUsed')}: {when(token.lastUsedAt)} · {t('tokens.expires')}: {when(token.expiresAt)}
              </div>
            </div>
            {!token.revokedAt && (
              <button onClick={() => revoke(token)} className="chrome-btn chrome-btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}>
                {t('tokens.revoke')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
