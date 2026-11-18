import React from 'react';
import { previewBlocked, useLabelaryStore } from '../store/useLabelaryStore';
import { useLangStore, useT } from '../i18n';
import { whenText } from '../utils/quotaText';

/**
 * Says how the preview service is doing, where the user is about to use it: nothing when it is fine, a calm note when
 * the quota is low, and when it is out (or cannot be checked) that the preview is temporarily unavailable, since when
 * it comes back if that is known, and that everything else keeps working. `forExport` is the note of a single export.
 */
export function LabelaryNotice({ forExport = false }: { forExport?: boolean }) {
  const t = useT();
  const lang = useLangStore(s => s.lang);
  const q = useLabelaryStore();
  const style: React.CSSProperties = { fontSize: 11, lineHeight: 1.5, margin: '6px 0', color: 'var(--chrome-text-muted)' };

  if (previewBlocked(q)) {
    const base = forExport ? t('quota.exportBlocked') : t(q.availability === 'unavailable' ? 'quota.unavailable' : 'quota.blocked');
    const when = q.availability === 'blocked' && q.retryAt ? ` ${t('quota.availableAt', { when: whenText(q.retryAt, lang) })}` : '';
    return <p role="alert" data-testid="quota-blocked" style={{ ...style, color: 'var(--status-warning)' }}>{base}{when}</p>;
  }
  if (q.availability === 'low') {
    return (
      <p role="status" data-testid="quota-low" style={style}>
        {t('quota.low', { remaining: q.remaining ?? 0 })}{forExport ? ` ${t('quota.exportOne')}` : ''}
      </p>
    );
  }
  return null;
}
