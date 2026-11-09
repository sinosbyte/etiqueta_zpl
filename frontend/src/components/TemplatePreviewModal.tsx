import React, { useEffect, useState } from 'react';
import { TemplateDetail, TemplateSummary } from '../utils/templatesClient';
import { cachedTemplate, loadTemplate } from '../utils/templateCache';
import { DOTS_PER_MM } from '../utils/units';
import { useT } from '../i18n';
import { LabelPreview } from './LabelPreview';

interface Props {
  template: TemplateSummary;
  onClose(): void;
  onUse(): void;
}

const mm = (dots: number) => parseFloat((dots / DOTS_PER_MM).toFixed(1)).toLocaleString();

/** The template's label at a comfortable size, opened by the eye button or by clicking the thumbnail. */
export function TemplatePreviewModal({ template, onClose, onUse }: Props) {
  const t = useT();
  const [detail, setDetail] = useState<TemplateDetail | null>(cachedTemplate(template) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTemplate(template).then(d => { if (alive) setDetail(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [template]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // As big as the window allows, in the label's real proportions
  const maxW = Math.min(560, window.innerWidth - 96);
  const maxH = Math.min(520, window.innerHeight - 260);
  const scale = Math.min(maxW / template.labelWidth, maxH / template.labelHeight);
  const width = Math.round(template.labelWidth * scale);
  const height = Math.round(template.labelHeight * scale);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={template.name}
        style={{ maxWidth: 'calc(100vw - 32px)', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width: '100%' }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', margin: 0 }}>{template.name}</h2>
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>{mm(template.labelWidth)} × {mm(template.labelHeight)} mm</span>
        </div>
        <div style={{ width, height, background: '#fff', position: 'relative', boxShadow: '0 2px 10px rgba(0,0,0,0.4)', flexShrink: 0 }}>
          {detail && <LabelPreview elements={detail.elements} labelWidth={detail.labelWidth} labelHeight={detail.labelHeight} scale={scale} />}
          {!detail && (
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: failed ? 'var(--status-error)' : '#6b7280' }}>
              {failed ? t('templates.previewFailed') : t('templates.previewLoading')}
            </span>
          )}
        </div>
        {template.description && (
          <p style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5, margin: 0, width: Math.max(width, 280), maxWidth: '100%' }}>{template.description}</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" onClick={onClose} className="chrome-btn chrome-btn-ghost">{t('common.close')}</button>
          <button type="button" onClick={onUse} className="chrome-btn chrome-btn-primary">{t('templates.use')}</button>
        </div>
      </div>
    </div>
  );
}
