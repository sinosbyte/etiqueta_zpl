import React, { useMemo } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { usePanelStore } from '../store/usePanelStore';
import { variableCatalog } from '../utils/variableCatalog';
import { useT } from '../i18n';
import { pagesText, valueIsUsed } from '../utils/variableOrigin';

// The longest variable name whose test value is saved with the design (backend limit)
const MAX_SAMPLE_NAME = 60;

/**
 * An index of the {{variables}} of the open design: where each is used, and a way to the Test data, where their
 * values are entered (the values live in one place only). A click on a name selects the element that uses it.
 */
export function VariablesCatalog() {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const selectElement = useDesignerStore(s => s.selectElement);

  // The variables of the table cells are records (Test data → Records): this index is of the others
  const variables = useMemo(() => {
    const tableIds = new Set(elements.filter(e => e.type === 'table').map(e => e.id));
    return variableCatalog(elements).filter(v => !v.elementIds.every(id => tableIds.has(id)));
  }, [elements]);

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
      <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', lineHeight: 1.5, margin: '0 0 8px' }}>{t('vars.help')}</p>
      <button
        type="button" className="chrome-btn chrome-btn-ghost" style={{ marginBottom: 10 }} data-testid="vars-open-testdata"
        onClick={() => usePanelStore.getState().show()}
      >
        {t('vars.openTestData')}
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {variables.map(v => (
          <div key={v.name}>
            <button
              type="button"
              onClick={() => selectElement(v.freeElementIds[0] ?? v.elementIds[0])}
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
              {(v.freeElementIds.length || v.elementIds.length) === 1 ? t('vars.used1') : t('vars.usedN', { n: v.freeElementIds.length || v.elementIds.length })}
            </span>
            {v.conflict && (
              <p style={{ fontSize: 10, color: 'var(--status-warning)', lineHeight: 1.4, margin: '3px 0 0' }} data-testid={`vars-conflict-${v.name}`}>
                {v.conflict.severity === 'ambiguous'
                  ? t('conflict.rowAmbiguous', { pages: pagesText(v.conflict.cellPages) })
                  : t(valueIsUsed(v.conflict) ? 'conflict.rowCollision' : 'conflict.rowIgnored', { pages: pagesText(v.conflict.collidingPages) })}
              </p>
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
