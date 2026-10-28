import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { ZPL_FONTS } from '../utils/zplFonts';
import { mmToDots, dotsToMm } from '../utils/units';
import { extractVariables } from '../utils/variables';
import { elementBox, resizeTextPatch } from '../utils/zplText';

export function PropertiesPanel() {
  const { elements, selectedId, showSamples, sampleValues, updateElement, deleteElement, duplicateSelected, bringForward, sendBackward, bringToFront, sendToBack } = useDesignerStore();
  const el = elements.find(e => e.id === selectedId);

  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid var(--chrome-border)',
    paddingTop: 12,
    marginTop: 12,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--chrome-text-faint)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  if (!el) {
    return (
      <div style={{
        width: 200,
        background: 'var(--chrome-surface)',
        borderLeft: '1px solid var(--chrome-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        padding: 16,
      }}>
        <p style={{ fontSize: 11, color: 'var(--chrome-text-faint)', textAlign: 'center', lineHeight: 1.5 }}>
          Select an element<br />to edit properties
        </p>
      </div>
    );
  }

  const field = (label: string, value: string | number, key: string, type = 'text', min?: number) => (
    <div key={key} style={{ marginBottom: 8 }}>
      <label style={labelStyle}>{label}</label>
      <input
        className="chrome-input"
        type={type}
        min={min}
        value={value}
        onChange={e => {
          const v = type === 'number' ? Number(e.target.value) : e.target.value;
          if (key === 'thickness') {
            updateElement(el.id, { thickness: Math.max(1, mmToDots(Number(v))) });
          } else if (['x', 'y'].includes(key)) {
            updateElement(el.id, { [key]: Math.max(0, mmToDots(Number(v))) });
          } else if (['width', 'height'].includes(key)) {
            updateElement(el.id, { [key]: Math.max(1, mmToDots(Number(v))) });
          } else {
            updateElement(el.id, { [key]: v });
          }
        }}
      />
    </div>
  );

  // Text outside a ^FB block is as big as the printed text: W/H change the font
  const samples = showSamples ? sampleValues : null;
  const box = elementBox(el, samples);
  const sizedByFont = el.type === 'text' && !el.block;
  const setSize = (patch: { width?: number; height?: number }) =>
    updateElement(el.id, sizedByFont
      ? resizeTextPatch(el, patch.width ?? box.width, patch.height ?? box.height, samples)
      : patch);

  // {{name}} placeholders typed inside a fixed value, e.g. "CONTÉM: {{QTD}} PEÇAS"
  const inlineVariables = el.dynamic ? [] : extractVariables(el.value ?? '');

  const valueControls = !el.dynamic && (
    <>
      {field('Value', el.value ?? '', 'value')}
      {inlineVariables.length > 0 && (
        <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: -4, marginBottom: 8, lineHeight: 1.5 }}>
          Variables in this value:{' '}
          <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
            {inlineVariables.map(v => `{{${v}}}`).join(' ')}
          </span>
          <br />
          Filled in when the label is printed; Preview asks for sample values.
        </p>
      )}
    </>
  );

  const dynamicControls = (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={el.dynamic ?? false}
          onChange={e => updateElement(el.id, { dynamic: e.target.checked })}
          style={{ accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>Dynamic variable</span>
      </label>
      {el.dynamic && (
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Variable name</label>
          <input
            className="chrome-input"
            type="text"
            value={el.variableName ?? ''}
            placeholder="e.g. company"
            onChange={e =>
              updateElement(el.id, { variableName: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })
            }
          />
          <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 3 }}>
            Emits {`{{${el.variableName || 'name'}}}`} in ZPL
          </p>
        </div>
      )}
    </>
  );

  return (
    <div
      className="chrome-scroll"
      style={{
        width: 200,
        background: 'var(--chrome-surface)',
        borderLeft: '1px solid var(--chrome-border)',
        padding: '12px 12px',
        overflowY: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Element type badge */}
      <div style={{
        display: 'inline-block',
        background: 'var(--chrome-elevated)',
        border: '1px solid var(--chrome-border)',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--accent)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 14,
      }}>
        {el.type}
      </div>

      {/* Position & size */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
        <div>
          <label style={labelStyle}>X mm</label>
          <input className="chrome-input" type="number" min={0}
            value={parseFloat(dotsToMm(el.x).toFixed(1))}
            onChange={e => updateElement(el.id, { x: Math.max(0, mmToDots(Number(e.target.value))) })}
          />
        </div>
        <div>
          <label style={labelStyle}>Y mm</label>
          <input className="chrome-input" type="number" min={0}
            value={parseFloat(dotsToMm(el.y).toFixed(1))}
            onChange={e => updateElement(el.id, { y: Math.max(0, mmToDots(Number(e.target.value))) })}
          />
        </div>
        <div>
          <label style={labelStyle}>W mm</label>
          <input className="chrome-input" type="number" min={0.1}
            value={parseFloat(dotsToMm(box.width).toFixed(1))}
            onChange={e => setSize({ width: Math.max(1, mmToDots(Number(e.target.value))) })}
          />
        </div>
        <div>
          <label style={labelStyle}>H mm</label>
          <input className="chrome-input" type="number" min={0.1}
            value={parseFloat(dotsToMm(box.height).toFixed(1))}
            onChange={e => setSize({ height: Math.max(1, mmToDots(Number(e.target.value))) })}
          />
        </div>
      </div>

      {el.type === 'rect' && !el.filled && (
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Border thickness mm</label>
          <input className="chrome-input" type="number" min={0.1}
            value={parseFloat(dotsToMm(el.thickness ?? 8).toFixed(1))}
            onChange={e => updateElement(el.id, { thickness: Math.max(1, mmToDots(Number(e.target.value))) })}
          />
        </div>
      )}

      {el.type === 'text' && (
        <div style={sectionStyle}>
          {valueControls}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Font size</label>
              <input className="chrome-input" type="number"
                value={el.fontSize ?? 30}
                onChange={e => {
                  const fontSize = Number(e.target.value);
                  // Keep a custom ^A width in proportion to the new height
                  const fontWidth = el.fontWidth && el.fontSize
                    ? Math.max(1, Math.round(el.fontWidth * fontSize / el.fontSize))
                    : undefined;
                  updateElement(el.id, { fontSize, fontWidth });
                }}
              />
            </div>
            <div>
              <label style={labelStyle}>Font</label>
              <select
                className="chrome-input"
                value={el.fontName ?? '0'}
                onChange={e => updateElement(el.id, { fontName: e.target.value })}
                style={{ paddingRight: 4 }}
              >
                {ZPL_FONTS.map(f => (
                  <option key={f.name} value={f.name}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
          {el.block && (
            <div style={{ marginBottom: 8 }}>
              <label style={labelStyle}>Text block alignment</label>
              <select
                className="chrome-input"
                value={el.block.justify}
                onChange={e => updateElement(el.id, {
                  block: { ...el.block!, justify: e.target.value as 'L' | 'C' | 'R' | 'J' },
                })}
              >
                <option value="L">Left</option>
                <option value="C">Center</option>
                <option value="R">Right</option>
                <option value="J">Justified</option>
              </select>
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 3 }}>
                ^FB block — its width is the element width
              </p>
            </div>
          )}
          {dynamicControls}
        </div>
      )}

      {(el.type === 'barcode128' || el.type === 'barcodeI2of5' || el.type === 'qrcode') && (
        <div style={sectionStyle}>
          {valueControls}
          {dynamicControls}
          {el.type === 'barcodeI2of5' && (
            <>
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Orientation</label>
                <select
                  className="chrome-input"
                  value={el.orientation ?? 'N'}
                  onChange={e => {
                    const next = e.target.value as 'N' | 'R' | 'I' | 'B';
                    const wasRotated = el.orientation === 'R' || el.orientation === 'B';
                    const isRotated = next === 'R' || next === 'B';
                    // Turning 90 degrees swaps the footprint on the canvas
                    updateElement(el.id, wasRotated === isRotated
                      ? { orientation: next }
                      : { orientation: next, width: el.height, height: el.width });
                  }}
                >
                  <option value="N">Normal</option>
                  <option value="R">Rotated 90°</option>
                  <option value="I">Inverted 180°</option>
                  <option value="B">Bottom-up 270°</option>
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={el.printLine ?? true}
                  onChange={e => updateElement(el.id, { printLine: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>Print digits below bars</span>
              </label>
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0 }}>
                Digits only; an odd count gets a leading zero.
              </p>
            </>
          )}
        </div>
      )}

      {el.type === 'line' && (
        <div style={sectionStyle}>
          <button
            onClick={() => updateElement(el.id, { width: el.height, height: el.width })}
            className="chrome-btn chrome-btn-ghost"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {el.width >= el.height ? '↔ Horizontal' : '↕ Vertical'}
          </button>
        </div>
      )}

      {/* Layer order */}
      <div style={sectionStyle}>
        <span className="panel-label" style={{ display: 'block', marginBottom: 8 }}>Layer order</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {[
            { label: '↑↑ Front', action: bringToFront },
            { label: '↓↓ Back', action: sendToBack },
            { label: '↑ Forward', action: bringForward },
            { label: '↓ Backward', action: sendBackward },
          ].map(({ label, action }) => (
            <button
              key={label}
              onClick={action}
              className="chrome-btn chrome-btn-ghost"
              style={{ fontSize: 11, padding: '4px 6px', justifyContent: 'center' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Duplicate & Delete */}
      <div style={sectionStyle}>
        <button
          onClick={duplicateSelected}
          className="chrome-btn chrome-btn-ghost"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 6 }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="3" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 3V2a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H9" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Duplicate
        </button>
        <button
          onClick={() => deleteElement(el.id)}
          className="chrome-btn chrome-btn-danger"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 3h9M4.5 3V2h3v1M4.5 5.5v4M7.5 5.5v4M2.5 3l.5 7h6l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}
