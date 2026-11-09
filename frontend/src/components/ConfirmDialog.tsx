import React, { useEffect } from 'react';
import { useDialogStore } from '../store/useDialogStore';
import { useT } from '../i18n';

/** Renders the confirmation requested through askConfirm. Mounted once, at the root of the app. */
export function ConfirmDialog() {
  const t = useT();
  const pending = useDialogStore(s => s.pending);
  const settle = useDialogStore(s => s.settle);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  if (!pending) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => settle(false)}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        style={{ width: 380, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="confirm-title" style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 10 }}>
          {pending.title ?? t('dialog.title')}
        </h2>
        <p id="confirm-message" style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
          {pending.message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button autoFocus={pending.danger} type="button" onClick={() => settle(false)} className="chrome-btn chrome-btn-ghost">
            {t('common.cancel')}
          </button>
          <button
            autoFocus={!pending.danger}
            type="button"
            onClick={() => settle(true)}
            className={pending.danger ? 'chrome-btn chrome-btn-danger' : 'chrome-btn chrome-btn-primary'}
          >
            {pending.confirmLabel ?? t('dialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
