import React, { useMemo } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { askConfirm } from '../store/useDialogStore';
import { MessageKey, useT } from '../i18n';
import { addLabelField, dataFields, labelFields, removeLabelField, valueRows } from '../utils/testData';
import { pagesText } from '../utils/variableOrigin';

const note: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', margin: '4px 0', lineHeight: 1.5 };
const GRID = 'minmax(90px, 1fr) minmax(70px, 0.9fr) minmax(130px, 1.8fr) auto';
const head: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--chrome-text-muted)',
};

/**
 * The values of the label, in one list: every variable that is not a cell of a table (the ones in texts, barcodes,
 * QR codes, Data Matrix, dynamic fields), once, with the elements that use it and its value for the test. A variable
 * that changes from label to label (a volume, a UC) is switched to "per label": its values then live in the
 * records (the column of the same name), and this value is the one used where a record leaves it empty.
 */
export function TestValues() {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const sampleValues = useDesignerStore(s => s.sampleValues);
  const setSampleValues = useDesignerStore(s => s.setSampleValues);
  const records = useDesignerStore(s => s.records);
  const setRecords = useDesignerStore(s => s.setRecords);
  const selectElement = useDesignerStore(s => s.selectElement);

  const rows = useMemo(() => valueRows(elements), [elements]);
  const perLabel = useMemo(() => new Set(labelFields(elements, records).map(n => n.toUpperCase())), [elements, records]);
  const hasTable = useMemo(() => dataFields(elements).length > 0, [elements]);

  const switchPerLabel = async (name: string, on: boolean) => {
    if (on) {
      const next = addLabelField(records, name);
      if (next) setRecords(next);
      return;
    }
    const { records: next, filled } = removeLabelField(records, name);
    // A column with values in it is not dropped without asking
    if (filled > 0) {
      const ok = await askConfirm({
        title: t('tv.removeTitle'),
        message: t('tv.removeMessage', { name, n: filled }),
        confirmLabel: t('tv.removeConfirm'),
        danger: true,
      });
      if (!ok) return;
    }
    setRecords(next);
  };

  return (
    <section data-testid="tv-values" aria-label={t('tv.title')}>
      <h3 style={{ ...head, margin: '0 0 4px', color: 'var(--chrome-text)' }}>{t('tv.title')} ({rows.length})</h3>
      <p style={note}>{t('tv.help')}</p>

      {rows.length === 0 ? (
        <p style={note} data-testid="tv-none">{t('tv.none')}</p>
      ) : (
        <div role="table" aria-label={t('tv.title')}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '0 0 4px', borderBottom: '1px solid var(--chrome-border)' }}>
            <span role="columnheader" style={head}>{t('tv.colName')}</span>
            <span role="columnheader" style={head}>{t('tv.colUsed')}</span>
            <span role="columnheader" style={head}>{t('tv.colValue')}</span>
            <span role="columnheader" style={head}>{hasTable ? t('tv.colPerLabel') : ''}</span>
          </div>

          {rows.map(row => {
            const isPerLabel = perLabel.has(row.name.toUpperCase());
            return (
              <div key={row.name} data-testid={`tv-row-${row.name}`} style={{ borderBottom: '1px solid var(--chrome-border)', padding: '4px 0' }}>
                <div role="row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center' }}>
                  <button
                    type="button" role="cell" title={t('tv.select')} onClick={() => row.elementIds[0] && selectElement(row.elementIds[0])}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--accent)', wordBreak: 'break-all',
                    }}
                  >
                    {`{{${row.name}}}`}
                  </button>
                  <span role="cell" style={{ fontSize: 11, color: 'var(--chrome-text-muted)' }} data-testid={`tv-used-${row.name}`}>
                    {row.types.map(type => t(`element.${type}` as MessageKey)).join(', ')}
                  </span>
                  {row.inputOffered ? (
                    <input
                      role="cell" className="chrome-input" type="text" maxLength={255}
                      value={sampleValues[row.name] ?? ''} placeholder={t('tv.placeholder')} data-testid={`tv-value-${row.name}`}
                      aria-label={`${t('tv.colValue')} ${row.name}`}
                      onChange={e => setSampleValues({ [row.name]: e.target.value })}
                    />
                  ) : <span role="cell" />}
                  {hasTable && row.inputOffered ? (
                    <label
                      role="cell" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--chrome-text-muted)', whiteSpace: 'nowrap', cursor: records.length === 0 && !isPerLabel ? 'not-allowed' : 'pointer' }}
                      title={records.length === 0 && !isPerLabel ? t('tv.perLabelNeedsRecord') : t('td.perLabelTitle')}
                    >
                      <input
                        type="checkbox" checked={isPerLabel} disabled={records.length === 0 && !isPerLabel}
                        data-testid={`tv-perlabel-${row.name}`} style={{ accentColor: 'var(--accent)' }}
                        onChange={e => void switchPerLabel(row.name, e.target.checked)}
                      />
                      {t('tv.perLabel')}
                    </label>
                  ) : <span />}
                </div>
                {isPerLabel && <p style={{ ...note, margin: '2px 0 0' }} data-testid={`tv-perlabel-note-${row.name}`}>{t('tv.perLabelOn')}</p>}
                {row.conflict && (
                  <p style={{ ...note, margin: '2px 0 0', color: 'var(--status-warning)' }} data-testid={`tv-conflict-${row.name}`}>
                    {t(row.conflict.severity === 'ambiguous' ? 'conflict.rowAmbiguous' : row.inputOffered ? 'conflict.rowCollision' : 'conflict.rowIgnored',
                      { pages: pagesText(row.conflict.severity === 'ambiguous' ? row.conflict.cellPages : row.conflict.collidingPages) })}
                  </p>
                )}
                {row.fromField && (
                  <p style={{ ...note, margin: '2px 0 0' }} data-testid={`tv-field-${row.name}`}>{t('conflict.fromField', { field: row.fromField })}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
