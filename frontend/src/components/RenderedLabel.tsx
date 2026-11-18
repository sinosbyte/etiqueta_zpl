import React, { useEffect, useState } from 'react';
import { ExpandedLabel } from '../types';
import { useSimulationStore } from '../store/useSimulationStore';
import { useLabelRenderStore } from '../store/useLabelRenderStore';
import { useT } from '../i18n';
import { labelSummary } from '../utils/simulation';

const note: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', margin: '4px 0', lineHeight: 1.5 };

/**
 * One label of the simulation as the printer's renderer (Labelary) draws it from the ZPL of that label alone, with
 * that ZPL one click away. It is the third thing the panel shows, next to the editing canvas (the design) and the
 * simulation's table of records (which record is on which label): this is how the label will look.
 */
export function RenderedLabel({ label, total, width, height, imageHeight = 220 }: { label: ExpandedLabel; total: number; width: number; height: number; imageHeight?: number }) {
  const t = useT();
  const stale = useSimulationStore(s => s.stale);
  const select = useSimulationStore(s => s.select);
  const picture = useLabelRenderStore(s => s.pictures[label.index]);
  const show = useLabelRenderStore(s => s.show);
  const retry = useLabelRenderStore(s => s.retry);
  const [view, setView] = useState<'image' | 'zpl'>('image');

  // Looking at a label asks for its picture (and its neighbours'); an out-of-date simulation asks for nothing
  useEffect(() => { if (!stale) show(label.index); }, [label.index, stale, show]);

  const s = labelSummary(label);
  const records = s.count === 0 ? t('sim.noRecords') : s.count === 1 ? t('sim.record1', { n: s.from }) : t('sim.recordsRange', { from: s.from, to: s.to });
  const nav = (by: number) => select(label.index + by);

  return (
    <div data-testid="sim-rendered" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <button type="button" className="chrome-icon-btn" aria-label={t('sim.prev')} title={t('sim.prev')} disabled={label.index <= 1} onClick={() => nav(-1)} data-testid="sim-prev">◀</button>
        <strong style={{ fontSize: 12 }} data-testid="sim-rendered-title">
          {t('sim.labelOf', { n: label.index, total })} · {t('sim.page', { n: s.page })} · {records}
        </strong>
        <button type="button" className="chrome-icon-btn" aria-label={t('sim.next')} title={t('sim.next')} disabled={label.index >= total} onClick={() => nav(1)} data-testid="sim-next">▶</button>
        <span style={{ flex: 1 }} />
        {(['image', 'zpl'] as const).map(k => (
          <button
            key={k} type="button" role="tab" aria-selected={view === k} data-testid={`sim-view-${k}`}
            className={`chrome-btn ${view === k ? 'chrome-btn-primary' : 'chrome-btn-ghost'}`} onClick={() => setView(k)}
          >
            {t(k === 'image' ? 'sim.viewImage' : 'sim.viewZpl')}
          </button>
        ))}
      </div>

      {view === 'zpl' ? (
        <pre data-testid="sim-zpl" style={{ fontSize: 11, maxHeight: 220, overflow: 'auto', margin: 0, padding: 8, whiteSpace: 'pre-wrap', border: '1px solid var(--chrome-border)', borderRadius: 4 }}>{label.zpl}</pre>
      ) : (
        <div>
          <div
            data-testid="sim-image-box"
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              aspectRatio: `${width} / ${height}`, height: imageHeight, maxWidth: '100%', background: '#fff', border: '1px solid var(--chrome-border)',
              borderRadius: 4, overflow: 'hidden', opacity: stale ? 0.5 : 1,
            }}
          >
            {picture?.status === 'ready' && picture.url && (
              <img src={picture.url} alt={t('sim.imageAlt', { n: label.index })} data-testid="sim-image" style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
            )}
            {picture?.status === 'loading' && <span role="status" style={{ fontSize: 12, color: '#4b5563' }} data-testid="sim-loading">{t('sim.rendering')}</span>}
            {!picture && stale && <span style={{ fontSize: 11, color: '#4b5563', padding: 8, textAlign: 'center' }}>{t('sim.noImageStale')}</span>}
            {!picture && !stale && <span style={{ fontSize: 12, color: '#4b5563' }}>{t('sim.queued')}</span>}
            {picture?.status === 'error' && (
              <div role="alert" data-testid="sim-image-error" style={{ padding: 8, textAlign: 'center', fontSize: 11, color: '#b91c1c' }}>
                {t('sim.renderFailed', { message: picture.error ?? '' })}
                <div>
                  <button type="button" className="chrome-btn chrome-btn-ghost" style={{ marginTop: 4 }} onClick={() => retry(label.index)} data-testid="sim-retry">{t('sim.retry')}</button>
                </div>
              </div>
            )}
          </div>
          {picture?.status === 'error' && <p style={note}>{t('sim.zplStillThere')}</p>}
          <p style={note}>{t('sim.labelaryNote')}</p>
        </div>
      )}
    </div>
  );
}
