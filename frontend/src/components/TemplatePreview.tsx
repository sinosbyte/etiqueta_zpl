import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiGetTemplate, TemplateDetail, TemplateSummary } from '../utils/templatesClient';
import { DOTS_PER_MM } from '../utils/units';
import { useT } from '../i18n';
import { LabelPreview } from './LabelPreview';

interface Props {
  template: TemplateSummary;
  anchor: DOMRect;  // the card the preview belongs to
}

const MAX_WIDTH = 340;
const MAX_HEIGHT = 400;
const PADDING = 10;
const GAP = 12;
const MARGIN = 8;
const CAPTION = 22;

// Templates already fetched. A replaced template has a new updatedAt, so it is fetched again.
const loaded = new Map<string, TemplateDetail>();
const keyOf = (t: TemplateSummary) => `${t.id}:${t.updatedAt}`;

const mm = (dots: number) => parseFloat((dots / DOTS_PER_MM).toFixed(1)).toLocaleString();

/**
 * Floating preview of a template's label, next to its card. The size follows the
 * real proportions of the label; the position keeps it inside the window.
 */
export function TemplatePreview({ template, anchor }: Props) {
  const t = useT();
  const key = keyOf(template);
  const [detail, setDetail] = useState<TemplateDetail | null>(loaded.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = loaded.get(key);
    setFailed(false);
    if (cached) { setDetail(cached); return; }
    setDetail(null);
    let alive = true;
    apiGetTemplate(template.id)
      .then(d => { loaded.set(key, d); if (alive) setDetail(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [key, template.id]);

  const scale = Math.min(MAX_WIDTH / template.labelWidth, MAX_HEIGHT / template.labelHeight);
  const width = Math.round(template.labelWidth * scale);
  const height = Math.round(template.labelHeight * scale);
  const boxWidth = width + 2 * PADDING;
  const boxHeight = height + 2 * PADDING + CAPTION;

  // Beside the card, on the side with room; centred on it and kept inside the window
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + boxWidth > vw - MARGIN) left = anchor.left - GAP - boxWidth;
  left = Math.max(MARGIN, Math.min(left, vw - boxWidth - MARGIN));
  const top = Math.max(MARGIN, Math.min(anchor.top + anchor.height / 2 - boxHeight / 2, vh - boxHeight - MARGIN));

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left,
        top,
        width: boxWidth,
        padding: PADDING,
        background: 'var(--chrome-surface)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        zIndex: 1000,
        pointerEvents: 'none',  // never gets in the way of the card buttons
      }}
    >
      <div style={{ width, height, background: '#fff', position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
        {detail && (
          <LabelPreview elements={detail.elements} labelWidth={detail.labelWidth} labelHeight={detail.labelHeight} scale={scale} />
        )}
        {!detail && (
          <span style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: failed ? 'var(--status-error)' : '#6b7280',
          }}>
            {failed ? t('templates.previewFailed') : t('templates.previewLoading')}
          </span>
        )}
      </div>
      <div style={{ height: CAPTION, display: 'flex', alignItems: 'flex-end', fontSize: 11, color: 'var(--chrome-text-faint)' }}>
        {mm(template.labelWidth)} × {mm(template.labelHeight)} mm
      </div>
    </div>,
    document.body,
  );
}
