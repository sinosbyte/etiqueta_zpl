import React from 'react';
import { useSimulationStore } from '../store/useSimulationStore';
import { usePdfExportStore } from '../store/usePdfExportStore';
import { previewBlocked, useLabelaryStore } from '../store/useLabelaryStore';
import { activeRenderer } from '../utils/labelRenderer';
import { useT } from '../i18n';

const note: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', margin: '4px 0', lineHeight: 1.5 };
// The service answers about 45 pictures a minute within the app's limit (see utils/renderQueue.ts)
const PER_MINUTE = 45;

/** Export of every label of the simulation as one PDF (one label a page), with progress and honest failures. */
export function PdfExportBar() {
  const t = useT();
  const result = useSimulationStore(s => s.result);
  const stale = useSimulationStore(s => s.stale);
  const size = useSimulationStore(s => s.size);
  const e = usePdfExportStore();
  const quota = useLabelaryStore();
  if (!result) return null;

  const count = result.labels.length;
  const running = e.status === 'running';
  const minutes = Math.ceil(count / PER_MINUTE);
  // What this export would ask of the quota: the labels whose picture is not already known cost a request each
  const needed = size ? result.labels.filter(l => !activeRenderer().peek(l.zpl, size.width, size.height)).length : count;
  const blocked = previewBlocked(quota);
  const noRoom = quota.remaining !== null && quota.availability !== 'unknown' && needed > quota.remaining && !blocked;

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--chrome-border)' }} data-testid="pdf-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button" className="chrome-btn chrome-btn-primary" data-testid="pdf-export"
          disabled={stale || running || blocked || noRoom}
          title={stale ? t('pdf.needFresh') : blocked ? t('pdf.quotaBlocked') : noRoom ? t('pdf.noRoom', { n: needed, remaining: quota.remaining ?? 0 }) : undefined}
          onClick={() => void e.start()}
        >
          {t('pdf.export', { n: count })}
        </button>
        {stale && <span role="alert" style={{ ...note, color: 'var(--status-warning)' }} data-testid="pdf-stale">{t('pdf.needFresh')}</span>}
        {!stale && count > 20 && !running && <span style={note}>{t('pdf.slow', { n: count, minutes })}</span>}
        {!stale && !running && !blocked && needed > 0 && quota.availability === 'low' && !noRoom && (
          <span style={note} data-testid="pdf-estimate">{t('pdf.estimate', { n: needed, remaining: quota.remaining ?? 0 })}</span>
        )}
        {!stale && !running && !blocked && noRoom && <span role="alert" style={{ ...note, color: 'var(--status-warning)' }} data-testid="pdf-noroom">{t('pdf.noRoom', { n: needed, remaining: quota.remaining ?? 0 })}</span>}
        {!stale && !running && blocked && <span role="alert" style={{ ...note, color: 'var(--status-warning)' }} data-testid="pdf-quota-blocked">{t('pdf.quotaBlocked')}</span>}
      </div>

      {running && (
        <div style={{ marginTop: 6 }} data-testid="pdf-progress">
          <progress value={e.done} max={Math.max(1, e.total)} style={{ width: 220 }} />
          <span style={{ fontSize: 12, marginLeft: 8 }}>{t('pdf.progress', { done: e.done, total: e.total })}</span>
          <button type="button" className="chrome-btn chrome-btn-ghost" style={{ marginLeft: 8 }} onClick={e.cancel} data-testid="pdf-cancel">{t('pdf.cancel')}</button>
        </div>
      )}

      {e.status === 'failed' && (
        <div role="alert" style={{ marginTop: 6 }} data-testid="pdf-failed">
          <p style={{ ...note, color: '#dc2626', fontWeight: 600 }}>
            {t('pdf.failed', { n: e.failed.length, labels: e.failed.map(f => f.index).join(', ') })}
          </p>
          <p style={note}>{t('pdf.failedHelp')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="chrome-btn chrome-btn-primary" onClick={() => void e.retry()} data-testid="pdf-retry">{t('pdf.retry')}</button>
            <button type="button" className="chrome-btn chrome-btn-ghost" onClick={e.exportWithout} data-testid="pdf-without">{t('pdf.without', { labels: e.failed.map(f => f.index).join(', ') })}</button>
            <button type="button" className="chrome-btn chrome-btn-ghost" onClick={e.dismiss}>{t('pdf.dismiss')}</button>
          </div>
        </div>
      )}

      {e.status === 'invalid' && (
        <p role="alert" style={{ ...note, color: 'var(--status-warning)' }} data-testid="pdf-invalid">{t('pdf.invalid')}</p>
      )}
      {e.status === 'quota' && <p role="alert" style={{ ...note, color: 'var(--status-warning)' }} data-testid="pdf-quota">{e.error}</p>}
      {e.status === 'error' && <p role="alert" style={{ ...note, color: '#dc2626' }}>{t('pdf.error', { message: e.error })}</p>}
      {e.status === 'done' && <p style={note} data-testid="pdf-done">{t('pdf.done')}</p>}
    </div>
  );
}
