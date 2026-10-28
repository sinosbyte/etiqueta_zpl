import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { SampleValuesModal } from './SampleValuesModal';
import { extractVariables } from '../utils/variables';

export function TabSwitcher() {
  const {
    activeTab, setActiveTab, zoom, setZoom, zplCode,
    sampleValues, setSampleValues, showSamples, setShowSamples,
  } = useDesignerStore();
  const displayPct = Math.round(zoom * 50);
  const [askSamples, setAskSamples] = React.useState(false);
  const variables = extractVariables(zplCode);

  // Show sample values on the canvas; ask for them first if some are missing
  const toggleSamples = () => {
    if (showSamples) setShowSamples(false);
    else if (variables.some(v => !sampleValues[v])) setAskSamples(true);
    else setShowSamples(true);
  };

  return (
    <div style={{
      height: 38,
      background: 'var(--chrome-bg)',
      borderBottom: '1px solid var(--chrome-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {/* Design / Code tabs */}
      <div style={{
        display: 'flex',
        background: 'var(--chrome-elevated)',
        borderRadius: 6,
        padding: 2,
        gap: 1,
      }}>
        {(['design', 'code'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '3px 14px',
              borderRadius: 4,
              border: 'none',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'background 0.12s, color 0.12s',
              background: activeTab === tab ? 'var(--chrome-surface)' : 'transparent',
              color: activeTab === tab ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
              boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}
          >
            {tab === 'design' ? 'Design' : '</> Code'}
          </button>
        ))}
      </div>

      {/* Sample values + zoom controls */}
      {activeTab === 'design' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {variables.length > 0 && (
            <button
              onClick={toggleSamples}
              className={`chrome-btn ${showSamples ? 'chrome-btn-primary' : 'chrome-btn-ghost'}`}
              style={{ height: 24, fontSize: 11, padding: '0 8px', marginRight: 8 }}
              title={showSamples ? 'Show the {{variables}} on the canvas' : 'Show sample values in place of the {{variables}} on the canvas'}
            >
              {showSamples ? 'Showing sample values' : 'Show sample values'}
            </button>
          )}
          <button
            className="chrome-icon-btn"
            onClick={() => setZoom(zoom - 0.25)}
            style={{ width: 24, height: 24, fontSize: 16 }}
            title="Zoom out"
          >−</button>
          <button
            onClick={() => setZoom(2)}
            style={{
              minWidth: 44,
              height: 24,
              borderRadius: 4,
              border: '1px solid var(--chrome-border)',
              background: 'transparent',
              color: 'var(--chrome-text-muted)',
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
              padding: '0 6px',
              transition: 'color 0.1s',
            }}
            title="Reset to 100%"
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--chrome-text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--chrome-text-muted)')}
          >
            {displayPct}%
          </button>
          <button
            className="chrome-icon-btn"
            onClick={() => setZoom(zoom + 0.25)}
            style={{ width: 24, height: 24, fontSize: 16 }}
            title="Zoom in"
          >+</button>
        </div>
      )}
      {askSamples && (
        <SampleValuesModal
          variables={variables}
          initialValues={sampleValues}
          confirmLabel="Show on canvas"
          onConfirm={values => { setSampleValues(values); setShowSamples(true); setAskSamples(false); }}
          onClose={() => setAskSamples(false)}
        />
      )}
    </div>
  );
}
