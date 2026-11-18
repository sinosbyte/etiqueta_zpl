import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useVariantsStore, isModified } from '../store/useVariantsStore';
import { askConfirm } from '../store/useDialogStore';
import { useT } from '../i18n';
import { compatibility, copyName, isCompatible } from '../utils/testVariants';
import { VariantNameModal } from './VariantNameModal';

const AMBER = 'var(--status-warning)';
const note: React.CSSProperties = { fontSize: 11, color: 'var(--chrome-text-faint)', margin: '4px 0', lineHeight: 1.5 };

type Dialog = null | 'new' | 'copy' | 'rename';

/**
 * Named sets of test data of the open design: [ variant ▼ ] [ Salvar como ] [ Atualizar ] [ ⋮ ]. A variant is only the
 * values and the records; loading one never changes the design, and nothing is sent to the preview service.
 */
export function VariantsBar() {
  const t = useT();
  const designId = useDesignsStore(s => s.activeDesignId);
  const store = useVariantsStore();
  const sampleValues = useDesignerStore(s => s.sampleValues);
  const records = useDesignerStore(s => s.records);
  const elements = useDesignerStore(s => s.elements);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The list of the open design, fresh each time the panel is shown
  useEffect(() => { void useVariantsStore.getState().refresh(); }, [designId]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const modified = isModified(store.baseline, sampleValues, records);
  const loaded = store.items.find(v => v.id === store.loadedId);
  const full = store.items.length >= store.max;

  // How the loaded variant fits the design as it is now (computed from the data of the editor, which is the variant's)
  const compat = useMemo(
    () => (store.loadedId ? compatibility(elements, { sampleValues, records }) : null),
    [store.loadedId, elements, sampleValues, records],
  );

  if (designId === null) {
    return <p style={note} data-testid="variants-needs-design">{t('variants.needsDesign')}</p>;
  }

  const onUpdate = async () => {
    if (!loaded) return;
    const ok = await askConfirm({
      title: t('variants.updateTitle'),
      message: t('variants.updateMessage', { name: loaded.name }),
      confirmLabel: t('variants.updateConfirm'),
    });
    if (ok) await store.updateLoaded();
  };

  const onDelete = async () => {
    if (!loaded) return;
    const ok = await askConfirm({
      title: t('variants.deleteTitle'),
      message: t('variants.deleteMessage', { name: loaded.name }),
      confirmLabel: t('variants.deleteConfirm'),
      danger: true,
    });
    if (ok) await store.remove(loaded.id);
  };

  return (
    <section aria-label={t('variants.title')} data-testid="variants-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--chrome-text)' }}>{t('variants.title')}</strong>
        <select
          className="chrome-input" style={{ minWidth: 190, maxWidth: 280 }} aria-label={t('variants.select')} data-testid="variant-select"
          value={store.loadedId ?? ''} disabled={store.busy || store.status === 'loading' && store.items.length === 0}
          onChange={e => { if (e.target.value) void store.load(e.target.value); }}
        >
          <option value="" disabled>{store.items.length === 0 ? t('variants.none') : t('variants.noneSelected')}</option>
          {store.items.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {loaded && (
          <span
            data-testid="variant-state"
            style={{ fontSize: 11, fontWeight: 600, color: modified ? AMBER : 'var(--chrome-text-muted)' }}
          >
            {loaded.name} • {modified ? t('variants.modified') : t('variants.saved.state')}
          </span>
        )}
        <button
          type="button" className="chrome-btn chrome-btn-primary" data-testid="variant-save-as"
          disabled={store.busy || full} title={full ? t('variants.limit', { n: store.max }) : t('variants.saveAsTitle')}
          onClick={() => setDialog(loaded ? 'copy' : 'new')}
        >
          {t('variants.saveAs')}
        </button>
        <button
          type="button" className="chrome-btn chrome-btn-ghost" data-testid="variant-update"
          disabled={store.busy || !loaded} title={loaded ? t('variants.updateTitleHint', { name: loaded.name }) : t('variants.updateNeedsOne')}
          onClick={() => void onUpdate()}
        >
          {t('variants.update')}
        </button>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button" className="chrome-icon-btn" aria-label={t('variants.more')} title={t('variants.more')} aria-haspopup="menu"
            aria-expanded={menu} data-testid="variant-menu" disabled={store.busy || !loaded} onClick={() => setMenu(m => !m)}
          >
            ⋮
          </button>
          {menu && (
            <div
              role="menu"
              style={{
                position: 'absolute', right: 0, top: '100%', zIndex: 50, minWidth: 140, padding: 4, borderRadius: 6,
                background: 'var(--chrome-elevated)', border: '1px solid var(--chrome-border)', boxShadow: '0 4px 14px rgba(0,0,0,.25)',
              }}
            >
              <button type="button" role="menuitem" className="chrome-btn chrome-btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }}
                data-testid="variant-rename" onClick={() => { setMenu(false); setDialog('rename'); }}>
                {t('variants.rename')}
              </button>
              <button type="button" role="menuitem" className="chrome-btn chrome-btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', color: '#dc2626' }}
                data-testid="variant-delete" onClick={() => { setMenu(false); void onDelete(); }}>
                {t('variants.delete')}
              </button>
            </div>
          )}
        </div>
        {store.status === 'error' && (
          <span role="alert" style={{ fontSize: 11, color: '#dc2626' }}>
            {t('variants.listFailed')}{' '}
            <button type="button" className="chrome-btn chrome-btn-ghost" onClick={() => void store.refresh()}>{t('variants.retry')}</button>
          </span>
        )}
      </div>

      {!loaded && <p style={note} data-testid="variants-help">{t('variants.help')}</p>}
      {loaded && modified && <p style={{ ...note, color: AMBER }} data-testid="variant-modified-note">{t('variants.modifiedNote')}</p>}

      {compat && !isCompatible(compat) && (
        <div role="note" data-testid="variant-compat" style={{ ...note, color: AMBER }}>
          <strong>{t('variants.compatTitle')}</strong>
          {compat.unusedValues.length > 0 && <p style={{ margin: '2px 0' }}>{t('variants.compatUnused', { names: compat.unusedValues.map(n => `{{${n}}}`).join(', ') })}</p>}
          {compat.missingValues.length > 0 && <p style={{ margin: '2px 0' }}>{t('variants.compatMissing', { names: compat.missingValues.map(n => `{{${n}}}`).join(', ') })}</p>}
          {compat.unknownColumns.length > 0 && <p style={{ margin: '2px 0' }}>{t('variants.compatUnknownCols', { names: compat.unknownColumns.join(', ') })}</p>}
          {compat.missingColumns.length > 0 && <p style={{ margin: '2px 0' }}>{t('variants.compatMissingCols', { names: compat.missingColumns.join(', ') })}</p>}
        </div>
      )}

      {dialog && (
        <VariantNameModal
          title={dialog === 'rename' ? t('variants.renameTitle') : t('variants.saveAsDialogTitle')}
          hint={dialog === 'rename' ? t('variants.renameHint') : dialog === 'copy' ? t('variants.copyHint', { name: loaded?.name ?? '' }) : t('variants.newHint')}
          confirmLabel={dialog === 'rename' ? t('variants.renameConfirm') : t('variants.saveConfirm')}
          initial={dialog === 'rename' ? loaded?.name ?? '' : dialog === 'copy' ? copyName(loaded?.name ?? '', store.items, t('variants.copySuffix')) : ''}
          others={store.items}
          exceptId={dialog === 'rename' ? loaded?.id : undefined}
          onCancel={() => setDialog(null)}
          onConfirm={async name => {
            const ok = dialog === 'rename' && loaded ? await store.rename(loaded.id, name) : await store.saveAs(name);
            if (ok) setDialog(null);
            return ok;
          }}
        />
      )}
    </section>
  );
}
