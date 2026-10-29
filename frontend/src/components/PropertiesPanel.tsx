import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { ZPL_FONTS } from '../utils/zplFonts';
import { mmToDots, dotsToMm } from '../utils/units';
import { extractVariables } from '../utils/variables';
import { elementBox, resizeTextPatch } from '../utils/zplText';
import { code128Value, resizeCode128Patch } from '../utils/code128';
import { NumberInput } from './NumberInput';

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

  // Text field (numeric fields use NumberInput)
  const field = (label: string, value: string, key: string) => (
    <div key={key} style={{ marginBottom: 8 }}>
      <label style={labelStyle}>{label}</label>
      <input
        className="chrome-input"
        type="text"
        value={value}
        onChange={e => updateElement(el.id, { [key]: e.target.value })}
      />
    </div>
  );

  // Text outside a ^FB block is as big as the printed text: W/H change the font.
  // A Code 128 is as wide as its bars: W changes the bar width (^BY).
  const samples = showSamples ? sampleValues : null;
  const box = elementBox(el, samples);
  const sizedByFont = el.type === 'text' && !el.block;
  const sizedByBars = el.type === 'barcode128' && !!el.moduleWidth;
  const setSize = (patch: { width?: number; height?: number }) =>
    updateElement(el.id, sizedByFont
      ? resizeTextPatch(el, patch.width ?? box.width, patch.height ?? box.height, samples)
      : sizedByBars
        ? resizeCode128Patch(el, patch.width ?? box.width, patch.height ?? box.height, samples)
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

  const printLineControl = (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={el.printLine ?? true}
        onChange={e => updateElement(el.id, { printLine: e.target.checked })}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>Print digits below bars</span>
    </label>
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
          <NumberInput min={0} value={dotsToMm(el.x)}
            onCommit={mm => updateElement(el.id, { x: mmToDots(mm) })}
          />
        </div>
        <div>
          <label style={labelStyle}>Y mm</label>
          <NumberInput min={0} value={dotsToMm(el.y)}
            onCommit={mm => updateElement(el.id, { y: mmToDots(mm) })}
          />
        </div>
        <div>
          <label style={labelStyle}>W mm</label>
          <NumberInput min={0.1} value={dotsToMm(box.width)}
            onCommit={mm => setSize({ width: Math.max(1, mmToDots(mm)) })}
          />
        </div>
        <div>
          <label style={labelStyle}>H mm</label>
          <NumberInput min={0.1} value={dotsToMm(box.height)}
            onCommit={mm => setSize({ height: Math.max(1, mmToDots(mm)) })}
          />
        </div>
      </div>

      {el.type === 'rect' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!el.filled && (
            <div>
              <label style={labelStyle}>Border mm</label>
              <NumberInput min={0.1} value={dotsToMm(el.thickness ?? 8)}
                onCommit={mm => updateElement(el.id, { thickness: Math.max(1, mmToDots(mm)) })}
              />
            </div>
          )}
          <div>
            {/* ^GB corner rounding: 0 (square) to 8 (heaviest) */}
            <label style={labelStyle}>Corners</label>
            <select
              className="chrome-input"
              value={el.rounding ?? 0}
              onChange={e => updateElement(el.id, { rounding: Number(e.target.value) || undefined })}
            >
              <option value={0}>Square</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(r => (
                <option key={r} value={r}>Rounded {r}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {el.type === 'text' && (
        <div style={sectionStyle}>
          {valueControls}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>Font size</label>
              <NumberInput min={1} max={999} decimals={0}
                value={el.fontSize ?? 30}
                onCommit={fontSize => {
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
          {/* ^FB: text aligned inside a fixed width (the element width) */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!el.block}
              onChange={e => updateElement(el.id, e.target.checked
                // Start with the block as wide as the text, so nothing moves
                ? { block: { maxLines: 1, lineSpacing: 0, justify: 'C', hangingIndent: 0 }, width: box.width }
                : { block: undefined })}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>Align in a fixed width</span>
          </label>
          {el.block && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>Alignment</label>
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
                </div>
                <div>
                  <label style={labelStyle}>Max lines</label>
                  <NumberInput min={1} max={9} decimals={0}
                    value={el.block.maxLines}
                    onCommit={maxLines => updateElement(el.id, { block: { ...el.block!, maxLines } })}
                  />
                </div>
              </div>
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 3, lineHeight: 1.5 }}>
                The text is aligned inside the box width (^FB). Drag the side handles to set the width;
                a red outline means the text does not fit.
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
              {printLineControl}
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0 }}>
                Digits only; an odd count gets a leading zero.
              </p>
            </>
          )}
          {el.type === 'barcode128' && (
            <>
              {printLineControl}
              {sizedByBars && code128Value(el, samples).includes('{{') && (
                <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0, lineHeight: 1.5 }}>
                  The width depends on the value printed; use Show sample values to see the real size.
                </p>
              )}
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
