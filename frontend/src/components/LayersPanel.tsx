import React, { useMemo } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { layerList } from '../utils/layers';
import { useT } from '../i18n';

const arrowButton: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer',
  padding: '0 3px', fontSize: 12, lineHeight: 1, fontFamily: 'inherit',
};

/** The label's elements as a list, top layer first: pick one, even when it is hidden behind another, and reorder. */
export function LayersPanel() {
  const t = useT();
  const elements = useDesignerStore(s => s.elements);
  const selectedIds = useDesignerStore(s => s.selectedIds);
  const selectElement = useDesignerStore(s => s.selectElement);
  const toggleSelectElement = useDesignerStore(s => s.toggleSelectElement);
  const bringForward = useDesignerStore(s => s.bringForward);
  const sendBackward = useDesignerStore(s => s.sendBackward);

  const layers = useMemo(() => layerList(elements), [elements]);
  if (layers.length === 0) return <div style={{ flex: 1 }} />;

  // The arrows move the selected element, so a row's arrow selects that row first
  const move = (id: string, fn: () => void) => { selectElement(id); fn(); };

  return (
    <div style={{ flex: 1, minHeight: 120, display: 'flex', flexDirection: 'column', marginTop: 6 }}>
      <div style={{ height: 1, background: 'var(--chrome-border)', margin: '0 6px 8px' }} />
      <span className="panel-label" style={{ padding: '0 6px', marginBottom: 4 }}>{t('layers.title')} ({layers.length})</span>
      <ul className="chrome-scroll" style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {layers.map((layer, i) => {
          const selected = selectedIds.includes(layer.id);
          return (
            <li key={layer.id}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                title={t('layers.select')}
                onClick={e => (e.ctrlKey || e.metaKey || e.shiftKey) ? toggleSelectElement(layer.id) : selectElement(layer.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectElement(layer.id); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 5, cursor: 'pointer',
                  fontSize: 11, fontFamily: 'inherit',
                  background: selected ? 'var(--accent-subtle, rgba(80,140,255,0.18))' : 'transparent',
                  color: selected ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
                  border: `1px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t(layer.typeKey)}
                  {layer.detail && <span style={{ color: 'var(--chrome-text-faint)' }}>{` · ${layer.detail}`}</span>}
                </span>
                {selected && selectedIds.length === 1 && (
                  <>
                    <button type="button" style={{ ...arrowButton, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0}
                      title={t('panel.forward')} aria-label={t('panel.forward')}
                      onClick={e => { e.stopPropagation(); move(layer.id, bringForward); }}>↑</button>
                    <button type="button" style={{ ...arrowButton, opacity: i === layers.length - 1 ? 0.3 : 1 }} disabled={i === layers.length - 1}
                      title={t('panel.backward')} aria-label={t('panel.backward')}
                      onClick={e => { e.stopPropagation(); move(layer.id, sendBackward); }}>↓</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
