import React, { useEffect, useState } from 'react';
import { MessageKey, useT } from '../i18n';
import { MAX_NAME_LENGTH, nameProblem } from '../utils/testVariants';

interface Props {
  title: string;
  hint: string;
  confirmLabel: string;
  initial: string;
  /** The variants that exist (to refuse a name that is taken). */
  others: { id: string; name: string }[];
  /** The variant being renamed: its own name is not a duplicate. */
  exceptId?: string;
  onCancel(): void;
  /** Resolves true when done; the dialog stays open (with the name) when it resolves false. */
  onConfirm(name: string): Promise<boolean>;
}

/** Asks for the name of a variant (a new one, a copy or a rename), checking it as the user types. */
export function VariantNameModal({ title, hint, confirmLabel, initial, others, exceptId, onCancel, onConfirm }: Props) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const problem = nameProblem(name, others, exceptId);
  const shown = touched || problem === 'taken' ? problem : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(name.trim())) return;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => !busy && onCancel()}>
      <div
        className="modal-card" role="dialog" aria-modal="true" aria-labelledby="variant-name-title"
        style={{ width: 380, maxWidth: 'calc(100vw - 32px)' }} onClick={e => e.stopPropagation()}
      >
        <h2 id="variant-name-title" style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 4 }}>{title}</h2>
        <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5, marginBottom: 14 }}>{hint}</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label
              htmlFor="variant-name"
              style={{ display: 'block', fontSize: 10, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}
            >
              {t('variants.nameLabel')}
            </label>
            <input
              id="variant-name" autoFocus className="chrome-input" value={name} data-testid="variant-name-input"
              maxLength={MAX_NAME_LENGTH + 20} onChange={e => { setName(e.target.value); setTouched(false); }}
              aria-invalid={!!shown}
            />
            {shown && (
              <p role="alert" data-testid="variant-name-error" style={{ fontSize: 11, color: 'var(--status-error, #dc2626)', margin: '4px 0 0' }}>
                {t(`variants.name.${shown}` as MessageKey, { max: MAX_NAME_LENGTH })}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onCancel} disabled={busy} className="chrome-btn chrome-btn-ghost">{t('common.cancel')}</button>
            <button type="submit" disabled={busy} className="chrome-btn chrome-btn-primary" data-testid="variant-name-confirm" style={{ opacity: busy ? 0.6 : 1 }}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
