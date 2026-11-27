import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useAccountStore } from '../store/useAccountStore';
import { navigate } from '../utils/navigation';
import { useHistory } from '../hooks/useHistory';
import { useMeasure } from '../store/useUnitStore';
import { UnitToggle } from './UnitToggle';
import { NumberInput } from './NumberInput';
import { extractVariables, substituteVariables } from '../utils/variables';
import { useIsDirty } from '../hooks/useUnsavedChanges';
import { requestLogout } from '../utils/logout';
import { GRID_STEPS } from '../utils/snap';
import { useLangStore, useT } from '../i18n';
import { LanguageSelect } from './LanguageSelect';
import { MAX_PAGES, isStructured } from '../utils/pages';
import { usePanelStore } from '../store/usePanelStore';
import { hasDesigns } from '../utils/admin';
import { TemplateEditBar } from './TemplateEditBar';
import { requestNewLabel } from '../utils/editorSession';
import { useSimulationStore } from '../store/useSimulationStore';

interface Props {
  onNavigateToMyDesigns: () => void;
}

export function Toolbar({ onNavigateToMyDesigns }: Props) {
  const {
    labelWidth, labelHeight, setLabelSize,
    elements, selectedIds, selectedId,
    snapToGrid, toggleSnapToGrid, snapToElements, toggleSnapToElements, gridSize, setGridSize,
    alignElements, distributeElements,
    zplCode, sampleValues,
    pages, addPage,
  } = useDesignerStore();
  const { showSaveModal: _show, openSaveModal, activeDesignName } = useDesignsStore();
  const me = useAccountStore(s => s.me);
  const dirty = useIsDirty();
  const t = useT();
  const lang = useLangStore(s => s.lang);
  const m = useMeasure();
  const { undo, redo, canUndo, canRedo } = useHistory();
  const [showExport, setShowExport] = React.useState(false);
  const [exportZplOverride, setExportZplOverride] = React.useState<string | undefined>(undefined);

  const multiSelected = selectedIds.length >= 2;
  // Every {{name}} in the ZPL, including ones mixed with fixed text in a field
  const variables = extractVariables(zplCode);

  // One click: open the Test data environment and make the preview there (unless a valid one is already there)
  const handlePreview = () => {
    usePanelStore.getState().show();
    void useSimulationStore.getState().ensure();
  };

  // The values come from the Test data (nothing is asked here): variables without a value print their name
  const handleExport = () => {
    setExportZplOverride(variables.length > 0 ? substituteVariables(zplCode, sampleValues) : undefined);
    setShowExport(true);
  };

  // Lazy-load ExportModal to avoid circular deps
  const [ExportModal, setExportModal] = React.useState<React.ComponentType<{ onClose: () => void; zplOverride?: string }> | null>(null);
  React.useEffect(() => {
    if (showExport && !ExportModal) {
      import('./ExportModal').then(m => setExportModal(() => m.ExportModal));
    }
  }, [showExport]);

  const divider = (
    <div style={{ width: 1, height: 20, background: 'var(--chrome-border)', flexShrink: 0 }} />
  );

  return (
    <>
      <header style={{
        // One row of 44 px as always; in a narrow window the controls wrap to a second row instead of overflowing
        minHeight: 44,
        flexWrap: 'wrap',
        rowGap: 4,
        background: 'var(--chrome-surface)',
        borderBottom: '1px solid var(--chrome-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '4px 12px',
        gap: 8,
        flexShrink: 0,
        userSelect: 'none',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="var(--accent)" strokeWidth="1.5"/>
            <rect x="5" y="6" width="4" height="5" fill="var(--accent)" opacity="0.8"/>
            <rect x="11" y="6" width="6" height="1.5" fill="var(--chrome-text-muted)"/>
            <rect x="11" y="9" width="4" height="1.5" fill="var(--chrome-text-muted)"/>
            <rect x="4" y="16" width="12" height="1.5" rx="0.75" fill="var(--chrome-text-faint)"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            ZPL Designer
          </span>
          {activeDesignName && (
            <>
              <span style={{ color: 'var(--chrome-border)', fontSize: 16, fontWeight: 300 }}>/</span>
              <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeDesignName}
              </span>
            </>
          )}
          {dirty && (
            <span
              title={t('unsaved.title')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                color: 'var(--status-warning)', border: '1px solid var(--status-warning)', borderRadius: 999, padding: '1px 8px',
              }}
            >
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-warning)' }} />
              {t('unsaved.badge')}
            </span>
          )}
        </div>

        {divider}

        {/* Undo / Redo */}
        <button
          className="chrome-icon-btn"
          onClick={undo}
          disabled={!canUndo}
          title={t('toolbar.undo')}
          style={{ opacity: canUndo ? 1 : 0.3 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 5h6a4 4 0 010 8H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 2L2 5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className="chrome-icon-btn"
          onClick={redo}
          disabled={!canRedo}
          title={t('toolbar.redo')}
          style={{ opacity: canRedo ? 1 : 0.3 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 5H6a4 4 0 000 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 2l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {divider}

        {/* Magnetic snapping: edges and centres line up with other elements and the label */}
        <button
          className={`chrome-icon-btn${snapToElements ? ' active' : ''}`}
          onClick={toggleSnapToElements}
          title={t('toolbar.snapElements', { state: t(snapToElements ? 'common.on' : 'common.off') })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2v5a4 4 0 008 0V2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M1.5 2h3M9.5 2h3" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M3 4.5h2M9 4.5h2" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        </button>

        {/* Snap to grid */}
        <button
          className={`chrome-icon-btn${snapToGrid ? ' active' : ''}`}
          onClick={toggleSnapToGrid}
          title={t('toolbar.snapGrid', { state: t(snapToGrid ? 'common.on' : 'common.off') })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="2.5" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="7" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="11.5" cy="2.5" r="1" fill="currentColor"/>
            <circle cx="2.5" cy="7" r="1" fill="currentColor"/>
            <circle cx="7" cy="7" r="1" fill="currentColor"/>
            <circle cx="11.5" cy="7" r="1" fill="currentColor"/>
            <circle cx="2.5" cy="11.5" r="1" fill="currentColor"/>
            <circle cx="7" cy="11.5" r="1" fill="currentColor"/>
            <circle cx="11.5" cy="11.5" r="1" fill="currentColor"/>
          </svg>
        </button>
        <select
          className="chrome-input"
          value={gridSize}
          onChange={e => setGridSize(Number(e.target.value))}
          title={t('toolbar.gridStep')}
          style={{ width: 72, padding: '2px 4px' }}
        >
          {GRID_STEPS.map(g => <option key={g.dots} value={g.dots}>{lang === 'en' ? g.label : g.label.replace('.', ',')}</option>)}
        </select>

        {/* Align tools — only when 2+ selected */}
        {multiSelected && (
          <>
            {divider}
            {[
              { dir: 'left' as const,     title: t('toolbar.alignLeft'),      path: 'M2 2v10M5 5h7M5 9h5' },
              { dir: 'center-h' as const, title: t('toolbar.alignCenterH'),  path: 'M7 2v10M4 5h6M5 9h4' },
              { dir: 'right' as const,    title: t('toolbar.alignRight'),     path: 'M12 2v10M2 5h7M4 9h5' },
              { dir: 'top' as const,      title: t('toolbar.alignTop'),       path: 'M2 2h10M5 5v7M9 5v5' },
              { dir: 'center-v' as const, title: t('toolbar.alignCenterV'),  path: 'M2 7h10M5 4v6M9 5v4' },
              { dir: 'bottom' as const,   title: t('toolbar.alignBottom'),    path: 'M2 12h10M5 2v7M9 4v5' },
            ].map(({ dir, title, path }) => (
              <button
                key={dir}
                className="chrome-icon-btn"
                onClick={() => alignElements(dir)}
                title={title}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            ))}
            {/* Distribute — equal gaps between 3+ selected, the outer ones stay */}
            {selectedIds.length >= 3 && [
              { axis: 'x' as const, title: t('toolbar.distributeH'), path: 'M1 2v10M13 2v10M5 4h4v6H5z' },
              { axis: 'y' as const, title: t('toolbar.distributeV'),   path: 'M2 1h10M2 13h10M4 5h6v4H4z' },
            ].map(({ axis, title, path }) => (
              <button
                key={axis}
                className="chrome-icon-btn"
                onClick={() => distributeElements(axis)}
                title={title}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            ))}
          </>
        )}

        {divider}

        {/* Label dimensions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', rowGap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)', whiteSpace: 'nowrap' }}>W</span>
          <NumberInput
            key={`w-${m.unit}`}
            min={m.show(80)}
            style={{ width: 68, textAlign: 'center' }}
            decimals={m.decimals} step={m.step} value={m.show(labelWidth)}
            onCommit={v => setLabelSize(m.read(v), labelHeight)}
            title={t('toolbar.labelWidth')}
          />
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>{m.short}</span>
          <span style={{ fontSize: 11, color: 'var(--chrome-border)', padding: '0 2px' }}>×</span>
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)', whiteSpace: 'nowrap' }}>H</span>
          <NumberInput
            key={`h-${m.unit}`}
            min={m.show(80)}
            style={{ width: 68, textAlign: 'center' }}
            decimals={m.decimals} step={m.step} value={m.show(labelHeight)}
            onCommit={v => setLabelSize(labelWidth, m.read(v))}
            title={t('toolbar.labelHeight')}
          />
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>{m.short}</span>
          <UnitToggle />
          {/* A second page, below the first: at most two */}
          <button
            className="chrome-btn chrome-btn-ghost"
            onClick={addPage}
            disabled={pages.length >= MAX_PAGES}
            title={pages.length >= MAX_PAGES ? t('toolbar.addPageMax') : t('toolbar.addPageTitle')}
            style={{ height: 24, fontSize: 11, padding: '0 8px', whiteSpace: 'nowrap', marginLeft: 4, opacity: pages.length >= MAX_PAGES ? 0.4 : 1 }}
          >
            {t('toolbar.addPage')}
          </button>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right actions. The Sinosbyte administrators have no designs to save (Fase 06): they keep templates */}
        {hasDesigns(me?.role) && (
        <button
          className="chrome-btn chrome-btn-ghost"
          onClick={() => void requestNewLabel()}
          title={t('toolbar.newLabelTitle')}
          data-testid="toolbar-new-label"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M3 1h5l3 3v7a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6.5 5.5v4M4.5 7.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {t('toolbar.newLabel')}
        </button>
        )}
        {hasDesigns(me?.role) && (
        <button
          className="chrome-btn chrome-btn-ghost"
          onClick={() => openSaveModal()}
          title={t('toolbar.saveTitle')}
          data-testid="toolbar-save"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 11V3.5L4.5 1h5.5a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 1v3h5V1M4 7h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {t('toolbar.save')}
        </button>
        )}
        {/* The Sinosbyte administrators edit templates only (Fase 06, etapa 3) */}
        {!hasDesigns(me?.role) && <TemplateEditBar />}

        <button
          className="chrome-btn chrome-btn-ghost"
          onClick={handlePreview}
          title={t('toolbar.previewTitle')}
          data-testid="toolbar-preview"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="6.5" cy="6.5" r="2" fill="currentColor"/>
          </svg>
          {t('toolbar.preview')}
        </button>

        <button
          className="chrome-btn chrome-btn-success"
          onClick={handleExport}
          title={t('toolbar.exportTitle')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1v8M3.5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1 10h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          {t('toolbar.export')}
        </button>

        {divider}

        <LanguageSelect />

        <button
          className="chrome-btn chrome-btn-ghost"
          onClick={() => navigate('account')}
          title={t('account.title')}
          data-testid="toolbar-account"
          style={{ gap: 6, fontSize: 12, maxWidth: 160 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="4.8" r="2.4" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M2.5 12.5c0-2.3 2-3.8 4.5-3.8s4.5 1.5 4.5 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.username ?? t('account.title')}</span>
        </button>

        <button
          className="chrome-icon-btn"
          onClick={() => void requestLogout()}
          title={t('toolbar.logout')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M9 4l3 3-3 3M12 7H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </header>

      {showExport && ExportModal && (
        <ExportModal zplOverride={exportZplOverride} onClose={() => setShowExport(false)} />
      )}
    </>
  );
}
