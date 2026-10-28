import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useAuthStore } from '../store/useAuthStore';
import { useHistory } from '../hooks/useHistory';
import { mmToDots, dotsToMm } from '../utils/units';
import { SampleValuesModal } from './SampleValuesModal';
import { extractVariables, substituteVariables } from '../utils/variables';

interface Props {
  onNavigateToMyDesigns: () => void;
}

// Sample values typed for the last preview/export, offered again next time
let lastSampleValues: Record<string, string> = {};

export function Toolbar({ onNavigateToMyDesigns }: Props) {
  const {
    labelWidth, labelHeight, setLabelSize,
    elements, selectedIds, selectedId,
    snapToGrid, toggleSnapToGrid,
    alignElements,
    fetchPreview, closePreview, previewUrl, previewLoading, zplCode,
  } = useDesignerStore();
  const { showSaveModal: _show, openSaveModal, activeDesignName } = useDesignsStore();
  const { logout } = useAuthStore();
  const { undo, redo, canUndo, canRedo } = useHistory();
  const [showExport, setShowExport] = React.useState(false);
  const [exportZplOverride, setExportZplOverride] = React.useState<string | undefined>(undefined);
  const [samplesFor, setSamplesFor] = React.useState<null | 'preview' | 'export'>(null);

  const multiSelected = selectedIds.length >= 2;
  const previewActive = !!(previewUrl || previewLoading);
  // Every {{name}} in the ZPL, including ones mixed with fixed text in a field
  const variables = extractVariables(zplCode);

  const handlePreview = () => {
    if (previewActive) {
      closePreview();
    } else if (variables.length > 0) {
      setSamplesFor('preview');
    } else {
      fetchPreview();
    }
  };

  const handleExport = () => {
    if (variables.length > 0) {
      setSamplesFor('export');
    } else {
      setExportZplOverride(undefined);
      setShowExport(true);
    }
  };

  const handleSamplesConfirm = (values: Record<string, string>) => {
    lastSampleValues = { ...lastSampleValues, ...values };
    const finalZpl = substituteVariables(zplCode, values);
    const action = samplesFor;
    setSamplesFor(null);
    if (action === 'preview') {
      fetchPreview(finalZpl);
    } else if (action === 'export') {
      setExportZplOverride(finalZpl);
      setShowExport(true);
    }
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
        height: 44,
        background: 'var(--chrome-surface)',
        borderBottom: '1px solid var(--chrome-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
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
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)', letterSpacing: '-0.01em' }}>
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
        </div>

        {divider}

        {/* Undo / Redo */}
        <button
          className="chrome-icon-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
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
          title="Redo (Ctrl+Shift+Z)"
          style={{ opacity: canRedo ? 1 : 0.3 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 5H6a4 4 0 000 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 2l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {divider}

        {/* Snap to grid */}
        <button
          className={`chrome-icon-btn${snapToGrid ? ' active' : ''}`}
          onClick={toggleSnapToGrid}
          title={snapToGrid ? 'Snap to grid: on' : 'Snap to grid: off'}
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

        {/* Align tools — only when 2+ selected */}
        {multiSelected && (
          <>
            {divider}
            {[
              { dir: 'left' as const,     title: 'Align left',      path: 'M2 2v10M5 5h7M5 9h5' },
              { dir: 'center-h' as const, title: 'Align center H',  path: 'M7 2v10M4 5h6M5 9h4' },
              { dir: 'right' as const,    title: 'Align right',     path: 'M12 2v10M2 5h7M4 9h5' },
              { dir: 'top' as const,      title: 'Align top',       path: 'M2 2h10M5 5v7M9 5v5' },
              { dir: 'center-v' as const, title: 'Align center V',  path: 'M2 7h10M5 4v6M9 5v4' },
              { dir: 'bottom' as const,   title: 'Align bottom',    path: 'M2 12h10M5 2v7M9 4v5' },
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
          </>
        )}

        {divider}

        {/* Label dimensions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)', whiteSpace: 'nowrap' }}>W</span>
          <input
            className="chrome-input"
            type="number"
            min={10}
            style={{ width: 58, textAlign: 'center' }}
            value={parseFloat(dotsToMm(labelWidth).toFixed(1))}
            onChange={e => setLabelSize(mmToDots(Number(e.target.value)), labelHeight)}
            title="Label width (mm)"
          />
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>mm</span>
          <span style={{ fontSize: 11, color: 'var(--chrome-border)', padding: '0 2px' }}>×</span>
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)', whiteSpace: 'nowrap' }}>H</span>
          <input
            className="chrome-input"
            type="number"
            min={10}
            style={{ width: 58, textAlign: 'center' }}
            value={parseFloat(dotsToMm(labelHeight).toFixed(1))}
            onChange={e => setLabelSize(labelWidth, mmToDots(Number(e.target.value)))}
            title="Label height (mm)"
          />
          <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>mm</span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right actions */}
        <button
          className="chrome-btn chrome-btn-ghost"
          onClick={() => openSaveModal()}
          title="Save design"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 11V3.5L4.5 1h5.5a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4 1v3h5V1M4 7h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Save
        </button>

        <button
          className={`chrome-btn ${previewActive ? 'chrome-btn-primary' : 'chrome-btn-ghost'}`}
          onClick={handlePreview}
          title="Preview label (Labelary render)"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="6.5" cy="6.5" r="2" fill="currentColor"/>
          </svg>
          {previewActive ? 'Close' : 'Preview'}
        </button>

        <button
          className="chrome-btn chrome-btn-success"
          onClick={handleExport}
          title="Export label"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1v8M3.5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M1 10h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          Export
        </button>

        {divider}

        <button
          className="chrome-icon-btn"
          onClick={logout}
          title="Log out"
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
      {samplesFor && (
        <SampleValuesModal
          variables={variables}
          initialValues={lastSampleValues}
          confirmLabel={samplesFor === 'preview' ? 'Preview' : 'Continue'}
          onConfirm={handleSamplesConfirm}
          onClose={() => setSamplesFor(null)}
        />
      )}
    </>
  );
}
