import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useT } from '../i18n';

export function PreviewPanel() {
  const { previewUrl, previewLoading, previewError, closePreview, refreshPreview, previewSource, zplCode, labelWidth, zoom } = useDesignerStore();
  const t = useT();

  if (!previewUrl && !previewError && !previewLoading) return null;

  const colWidth = labelWidth * zoom;
  // The design was edited after this preview was rendered
  const stale = !!previewUrl && previewSource !== zplCode;

  return (
    <div
      style={{
        height: '100%',
        width: colWidth, minWidth: colWidth, maxWidth: colWidth,
        background: 'var(--chrome-surface)',
        borderLeft: '1px solid var(--chrome-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--chrome-border)',
        flexShrink: 0,
      }}>
        <span className="panel-label">{t('preview.title')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {stale && !previewLoading && (
          <span style={{ fontSize: 10, color: 'var(--status-warning, #d9a441)' }}>{t('preview.outdated')}</span>
        )}
        <button
          onClick={refreshPreview}
          disabled={previewLoading}
          className={`chrome-btn ${stale ? 'chrome-btn-primary' : 'chrome-btn-ghost'}`}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={t('preview.refreshTitle')}
        >
          ↻ {t('preview.refresh')}
        </button>
        <button
          onClick={closePreview}
          className="chrome-btn chrome-btn-ghost"
          style={{ fontSize: 11, padding: '2px 8px' }}
        >
          {t('common.close')}
        </button>
        </div>
      </div>

      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {previewLoading && (
          <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>{t('preview.rendering')}</p>
        )}
        {previewError && (
          <div style={{
            fontSize: 11,
            color: 'var(--status-error)',
            background: 'var(--status-error-subtle)',
            border: '1px solid rgba(247,92,92,0.3)',
            borderRadius: 6,
            padding: '8px 10px',
          }}>
            {previewError}
          </div>
        )}
        {previewUrl && (
          <img
            src={previewUrl}
            alt={t('preview.alt')}
            style={{
              imageRendering: 'pixelated',
              width: colWidth - 24,
              display: 'block',
              borderRadius: 4,
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            }}
          />
        )}
      </div>
    </div>
  );
}
