import React, { useState } from 'react';
import { useT } from '../i18n';
import { copyText } from '../utils/copyText';

interface Props {
  username: string;
  password: string;
  onClose(): void;
}

/** The temporary password of a new or reset user. It exists only here, in memory: closing it, it is gone for good. */
export function TemporaryPassword({ username, password, onClose }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div data-testid="temporary-password" style={{
      border: '1px solid var(--accent)', borderRadius: 8, padding: 14, background: 'var(--chrome-elevated)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <strong style={{ fontSize: 13, color: 'var(--chrome-text)' }}>{t('admin.temp.title', { name: username })}</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code data-testid="temporary-password-value" style={{
          fontSize: 15, padding: '6px 10px', borderRadius: 6, background: 'var(--chrome-bg)', color: 'var(--chrome-text)',
          letterSpacing: '0.04em', userSelect: 'all',
        }}>{password}</code>
        <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }}
          onClick={async () => setCopied(await copyText(password))}>
          {copied ? t('admin.temp.copied') : t('admin.temp.copy')}
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} onClick={onClose}>
          {t('admin.temp.done')}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5, margin: 0 }}>{t('admin.temp.help')}</p>
    </div>
  );
}
