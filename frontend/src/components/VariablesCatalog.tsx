import React, { useMemo } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { variableCatalog } from '../utils/variableCatalog';
import { useT } from '../i18n';
import { tableVariables } from '../utils/tableEdit';
import { labelFields } from '../utils/testData';

// The longest variable name whose example value is saved with the design (backend limit)
const MAX_SAMPLE_NAME = 60;

/** Lists the {{variables}} of the open design: where they are used and an example value for each. */
export function VariablesCatalog() {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const sampleValues = useDesignerStore(s => s.sampleValues);
  const setSampleValues = useDesignerStore(s => s.setSampleValues);
  const selectElement = useDesignerStore(s => s.selectElement);

  const records = useDesignerStore(s => s.records);
  const variables = useMemo(() => variableCatalog(elements), [elements]);
  // Variables the test data gives a value per label (see the Test data bar)
  const perLabel = useMemo(() => new Set(labelFields(elements, records).map(n => n.toUpperCase())), [elements, records]);
  // Variables only a table prints are filled in by the test data (one record per row): an example value would be ignored
  const tableOnly = useMemo(() => {
    const tables = elements.filter(e => e.type === 'table');
    const names = new Set(tables.flatMap(tableVariables));
    const ids = new Set(tables.map(e => e.id));
    return new Set(variables.filter(v => names.has(v.name) && v.elementIds.every(id => ids.has(id))).map(v => v.name));
  }, [elements, variables]);

  if (variables.length === 0) {
    return (
      <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', lineHeight: 1.5, margin: 0 }}>
        {t('vars.none')}
      </p>
    );
  }

  return (
    <div>
      <h3 style={{ fontSize: 10, fontWeight: 500, color: 'var(--chrome-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 4px' }}>
        {t('vars.title')} ({variables.length})
      </h3>
      <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', lineHeight: 1.5, margin: '0 0 10px' }}>{t('vars.help')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {variables.map(v => (
          <div key={v.name}>
            <button
              type="button"
              onClick={() => selectElement(v.elementIds[0])}
              title={t('vars.select')}
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: 'var(--accent)',
                wordBreak: 'break-all',
              }}
            >
              {`{{${v.name}}}`}
            </button>
            <span style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginLeft: 6 }}>
              {v.elementIds.length === 1 ? t('vars.used1') : t('vars.usedN', { n: v.elementIds.length })}
            </span>
            {tableOnly.has(v.name) ? (
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', lineHeight: 1.4, margin: '3px 0 0' }}>{t('vars.fromTable')}</p>
            ) : (
            <input
              className="chrome-input"
              type="text"
              value={sampleValues[v.name] ?? ''}
              onChange={e => setSampleValues({ [v.name]: e.target.value })}
              placeholder={t('vars.example')}
              aria-label={`${t('vars.example')} ${v.name}`}
              style={{ marginTop: 4 }}
              maxLength={255}
            />
            )}
            {perLabel.has(v.name.toUpperCase()) && (
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', lineHeight: 1.4, margin: '3px 0 0' }} data-testid={`vars-perlabel-${v.name}`}>{t('vars.perLabel')}</p>
            )}
            {v.clashesWith.length > 0 && (
              <p style={{ fontSize: 10, color: 'var(--status-warning)', lineHeight: 1.4, margin: '3px 0 0' }}>
                {t('vars.clash', { other: v.clashesWith.map(n => `{{${n}}}`).join(', ') })}
              </p>
            )}
            {v.name.length > MAX_SAMPLE_NAME && (
              <p style={{ fontSize: 10, color: 'var(--status-warning)', lineHeight: 1.4, margin: '3px 0 0' }}>
                {t('vars.tooLong', { max: MAX_SAMPLE_NAME })}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
