import React, { useMemo, useState } from 'react';
import { useDesignsStore } from '../store/useDesignsStore';
import { useDesignerStore } from '../store/useDesignerStore';
import { checkSapCompat, SAP_MAX_LINE } from '../utils/sapCompat';
import { useT } from '../i18n';

type Mode = 'overwrite' | 'version' | 'new';

export function SaveDesignModal() {
  const {
    activeDesignId, activeDesignName, activeVersionNumber,
    closeSaveModal, saveNewDesign, saveVersion, overwriteVersion, error, setError,
  } = useDesignsStore();

  const t = useT();
  const defaultMode: Mode = activeDesignId
    ? (activeVersionNumber !== null ? 'overwrite' : 'version')
    : 'new';

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Whether the SAP could capture and print what is about to be saved
  const zplCode = useDesignerStore(s => s.zplCode);
  const sapIssues = useMemo(() => checkSapCompat(zplCode), [zplCode]);
  const shownIssues = sapIssues.slice(0, 4);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'overwrite') {
        await overwriteVersion();
      } else if (mode === 'version') {
        await saveVersion();
        closeSaveModal();
      } else {
        await saveNewDesign(name.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('save.failed'));
    } finally {
      setLoading(false);
    }
  };

  const modeTabs = [
    ...(activeVersionNumber !== null ? [{ id: 'overwrite' as Mode, label: t('save.overwriteTab', { n: activeVersionNumber }) }] : []),
    { id: 'version' as Mode, label: t('save.versionTab') },
    { id: 'new' as Mode, label: t('save.newTab') },
  ];

  return (
    <div className="modal-overlay" onClick={closeSaveModal}>
      <div className="modal-card" style={{ width: 360 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 16 }}>{t('save.title')}</h2>

        {activeDesignId && (
          <div style={{
            display: 'flex',
            background: 'var(--chrome-elevated)',
            borderRadius: 6,
            padding: 2,
            gap: 2,
            marginBottom: 16,
          }}>
            {modeTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: 'none',
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  background: mode === tab.id ? 'var(--chrome-surface)' : 'transparent',
                  color: mode === tab.id ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
                  boxShadow: mode === tab.id ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                  transition: 'background 0.1s, color 0.1s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'overwrite' && (
            <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5 }}>
              {t('save.replacePre')}<strong style={{ color: 'var(--chrome-text)' }}>v{activeVersionNumber}</strong>{t('save.replacePost', { name: activeDesignName })}
            </p>
          )}

          {mode === 'new' && (
            <div>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                {t('save.designName')}
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="chrome-input"
                placeholder={t('save.placeholder')}
              />
            </div>
          )}

          {sapIssues.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--status-success)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('sap.compatible')}
            </p>
          ) : (
            <div role="alert" style={{
              fontSize: 11, lineHeight: 1.5, padding: '8px 10px', borderRadius: 6,
              background: 'rgba(255, 179, 64, 0.1)', border: '1px solid rgba(255, 179, 64, 0.45)', color: 'var(--chrome-text)',
            }}>
              <strong style={{ display: 'block', marginBottom: 4, color: 'var(--status-warning)' }}>{t('sap.incompatible')}</strong>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {shownIssues.map(issue => (
                  <li key={`${issue.kind}-${issue.line}`} style={{ marginBottom: 3 }}>
                    {issue.kind === 'longLine'
                      ? t('sap.longLine', { line: issue.line, length: issue.length, max: SAP_MAX_LINE })
                      : t('sap.badMarker', { line: issue.line })}
                    <br />
                    <code style={{ fontSize: 10, color: 'var(--chrome-text-faint)', wordBreak: 'break-all' }}>{issue.excerpt}</code>
                  </li>
                ))}
              </ul>
              {sapIssues.length > shownIssues.length && (
                <p style={{ margin: '4px 0 0' }}>{t('sap.more', { n: sapIssues.length - shownIssues.length })}</p>
              )}
              <p style={{ margin: '6px 0 0', color: 'var(--chrome-text-muted)' }}>{t('sap.canSave')}</p>
            </div>
          )}

          {error && (
            <p style={{
              fontSize: 11,
              color: 'var(--status-error)',
              background: 'var(--status-error-subtle)',
              border: '1px solid rgba(247,92,92,0.3)',
              borderRadius: 5,
              padding: '6px 10px',
            }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={closeSaveModal} className="chrome-btn chrome-btn-ghost">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="chrome-btn chrome-btn-primary"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? t('save.saving') : mode === 'overwrite' ? t('save.overwrite') : mode === 'version' ? t('save.saveVersion') : t('save.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
