import React, { useEffect, useState } from 'react';
import { useT, MessageKey } from '../i18n';
import { TEMPLATE_CATEGORIES, TemplateCategory } from '../utils/templateCategories';

interface Props {
  /** Category preselected (the tab that is open on the Templates screen). */
  defaultCategory: TemplateCategory;
  onCancel(): void;
  onPublish(name: string, description: string, category: TemplateCategory): Promise<void>;
}

/** Asks for the name, description and category of the template about to be published. */
export function PublishTemplateModal({ defaultCategory, onCancel, onPublish }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TemplateCategory>(defaultCategory);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onPublish(name.trim(), description.trim(), category); }
    finally { setBusy(false); }
  };

  const label: React.CSSProperties = {
    display: 'block', fontSize: 10, color: 'var(--chrome-text-faint)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal-card" role="dialog" aria-modal="true" style={{ width: 380, maxWidth: 'calc(100vw - 32px)' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 4 }}>{t('templates.publishDialogTitle')}</h2>
        <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5, marginBottom: 16 }}>{t('templates.publishDialogHint')}</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={label} htmlFor="tpl-name">{t('templates.nameLabel')}</label>
            <input id="tpl-name" autoFocus className="chrome-input" value={name} onChange={e => setName(e.target.value)} maxLength={100} required />
          </div>
          <div>
            <label style={label} htmlFor="tpl-desc">{t('templates.descriptionLabel')}</label>
            <input id="tpl-desc" className="chrome-input" value={description} onChange={e => setDescription(e.target.value)} maxLength={300} />
          </div>
          <div>
            <label style={label} htmlFor="tpl-cat">{t('templates.categoryLabel')}</label>
            <select id="tpl-cat" className="chrome-input" value={category} onChange={e => setCategory(e.target.value as TemplateCategory)}>
              {TEMPLATE_CATEGORIES.map(c => (
                <option key={c} value={c}>{t(`templates.cat.${c}` as MessageKey)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onCancel} disabled={busy} className="chrome-btn chrome-btn-ghost">{t('common.cancel')}</button>
            <button type="submit" disabled={busy || !name.trim()} className="chrome-btn chrome-btn-primary" style={{ opacity: busy ? 0.6 : 1 }}>
              {t('templates.publishConfirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
