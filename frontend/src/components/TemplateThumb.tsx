import React, { useEffect, useRef, useState } from 'react';
import { TemplateDetail, TemplateSummary } from '../utils/templatesClient';
import { cachedTemplate, loadTemplate } from '../utils/templateCache';
import { LabelPreview } from './LabelPreview';

interface Props {
  template: TemplateSummary;
  onOpen(): void;
  label: string;
}

const MAX_WIDTH = 188;
const MAX_HEIGHT = 112;

/**
 * Small picture of the template's label, drawn with the editor's own components (no image).
 * The template is fetched when the card comes into view, so a long list does not load all at once.
 */
export function TemplateThumb({ template, onOpen, label }: Props) {
  const box = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<TemplateDetail | null>(cachedTemplate(template) ?? null);
  const [visible, setVisible] = useState(detail !== null);

  useEffect(() => {
    if (visible || !box.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const cached = cachedTemplate(template);
    if (cached) { setDetail(cached); return; }
    setDetail(null);
    loadTemplate(template).then(d => { if (alive) setDetail(d); }).catch(() => { /* the card still works without it */ });
    return () => { alive = false; };
  }, [visible, template]);

  const scale = Math.min(MAX_WIDTH / template.labelWidth, MAX_HEIGHT / template.labelHeight);
  const width = Math.round(template.labelWidth * scale);
  const height = Math.round(template.labelHeight * scale);

  return (
    <button
      ref={box}
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      style={{
        height: MAX_HEIGHT + 16, width: '100%', border: '1px solid var(--chrome-border)', borderRadius: 6,
        background: 'var(--chrome-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-in', padding: 0, overflow: 'hidden',
      }}
    >
      <div style={{ width, height, background: '#fff', position: 'relative', boxShadow: '0 1px 4px rgba(0,0,0,0.35)', flexShrink: 0 }}>
        {detail && (
          <LabelPreview elements={detail.elements} labelWidth={detail.labelWidth} labelHeight={detail.labelHeight} scale={scale} />
        )}
      </div>
    </button>
  );
}
