import React from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { ZPL_FONTS } from '../utils/zplFonts';
import { mmToDots, dotsToMm } from '../utils/units';
import { extractVariables } from '../utils/variables';
import { elementBox, resizeTextPatch } from '../utils/zplText';
import { CODE128_PLACEHOLDER_CHARS, barWidthPatch, code128Value, expectedCharsPatch, resizeCode128Patch } from '../utils/code128';
import { NumberInput } from './NumberInput';
import { Orientation } from '../types';
import {
  DEFAULT_THRESHOLD, chooseImage, imagePatch, imageSources, initialImageWidth, rasterize, resizeImagePatch,
} from '../utils/graphic';
import { toast } from '../store/useToastStore';
import { t as translate, useT, MessageKey } from '../i18n';

export function PropertiesPanel() {
  const t = useT();
  const { elements, selectedId, showSamples, sampleValues, labelWidth, labelHeight, updateElement, deleteElement, duplicateSelected, bringForward, sendBackward, bringToFront, sendToBack } = useDesignerStore();
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
          {t('panel.select1')}<br />{t('panel.select2')}
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
  // An image keeps its proportions.
  const sizedByFont = el.type === 'text' && !el.block;
  const sizedByBars = el.type === 'barcode128' && !!el.moduleWidth;
  const setSize = (patch: { width?: number; height?: number }) =>
    updateElement(el.id, sizedByFont
      ? resizeTextPatch(el, patch.width ?? box.width, patch.height ?? box.height, samples)
      : sizedByBars
        ? resizeCode128Patch(el, patch.width ?? box.width, patch.height ?? box.height, samples)
        : el.type === 'image'
          ? resizeImagePatch(el, patch.width ?? (patch.height ?? el.height) * el.width / el.height)
          : patch);

  const checkbox = (label: string, checked: boolean, onChange: (checked: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{label}</span>
    </label>
  );

  // ^FR: where the field overlaps black it prints white, e.g. white text on a black bar
  const reverseControl = checkbox(t('panel.reverse'), el.reversed ?? false,
    reversed => updateElement(el.id, { reversed: reversed || undefined }));

  // Text and Code 128 boxes follow the turn on their own; Interleaved 2 of 5 stores its footprint
  const orientationControl = (onChange: (next: Orientation) => void) => (
    <div style={{ marginBottom: 8 }}>
      <label style={labelStyle}>{t('panel.orientation')}</label>
      <select
        className="chrome-input"
        value={el.orientation ?? 'N'}
        onChange={e => onChange(e.target.value as Orientation)}
      >
        {(['N', 'R', 'I', 'B'] as Orientation[]).map(o => (
          <option key={o} value={o}>{t(`orientation.${o}` as MessageKey)}</option>
        ))}
      </select>
    </div>
  );
  const setOrientation = (next: Orientation) => updateElement(el.id, {
    orientation: next === 'N' ? undefined : next,
    // Rotated text is placed with ^FO and is not aligned in a ^FB block
    ...(el.type === 'text' && next !== 'N' ? { block: undefined, origin: undefined } : {}),
  });

  const imageSource = el.type === 'image' ? imageSources.get(el.id) : undefined;
  const replaceImage = async () => {
    try {
      const image = await chooseImage();
      if (!image) return;
      const source = { image, threshold: imageSource?.threshold ?? DEFAULT_THRESHOLD };
      imageSources.set(el.id, source);
      updateElement(el.id, imagePatch(rasterize(source, initialImageWidth(image, labelWidth, labelHeight))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : translate('sidebar.pictureError'));
    }
  };

  // {{name}} placeholders typed inside a fixed value, e.g. "CONTÉM: {{QTD}} PEÇAS"
  const inlineVariables = el.dynamic ? [] : extractVariables(el.value ?? '');

  const valueControls = !el.dynamic && (
    <>
      {field(t('panel.value'), el.value ?? '', 'value')}
      {inlineVariables.length > 0 && (
        <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: -4, marginBottom: 8, lineHeight: 1.5 }}>
          {t('panel.varsIn')}{' '}
          <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
            {inlineVariables.map(v => `{{${v}}}`).join(' ')}
          </span>
          <br />
          {t('panel.varsFilled')}
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
      <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{t('panel.printDigits')}</span>
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
        <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{t('panel.dynamic')}</span>
      </label>
      {el.dynamic && (
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>{t('panel.varName')}</label>
          <input
            className="chrome-input"
            type="text"
            value={el.variableName ?? ''}
            placeholder={t('panel.varPlaceholder')}
            onChange={e =>
              updateElement(el.id, { variableName: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })
            }
          />
          <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 3 }}>
            {t('panel.emits', { marker: `{{${el.variableName || 'name'}}}` })}
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
        {t(`element.${el.type}` as MessageKey)}
      </div>

      {/* Position & size */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
        <div>
          <label style={labelStyle}>X mm</label>
          <NumberInput min={0} decimals={3} step={0.5} value={dotsToMm(el.x)}
            onCommit={mm => updateElement(el.id, { x: mmToDots(mm) })}
          />
        </div>
        <div>
          <label style={labelStyle}>Y mm</label>
          <NumberInput min={0} decimals={3} step={0.5} value={dotsToMm(el.y)}
            onCommit={mm => updateElement(el.id, { y: mmToDots(mm) })}
          />
        </div>
        <div>
          <label style={labelStyle}>W mm</label>
          <NumberInput min={0.1} decimals={3} step={0.5} value={dotsToMm(box.width)}
            onCommit={mm => setSize({ width: Math.max(1, mmToDots(mm)) })}
          />
        </div>
        <div>
          <label style={labelStyle}>H mm</label>
          <NumberInput min={0.1} decimals={3} step={0.5} value={dotsToMm(box.height)}
            onCommit={mm => setSize({ height: Math.max(1, mmToDots(mm)) })}
          />
        </div>
      </div>

      {el.type === 'rect' && (
        <>
        {checkbox(t('panel.solidFill'), el.filled ?? false, filled => updateElement(el.id, { filled: filled || undefined }))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          {!el.filled && (
            <div>
              <label style={labelStyle}>{t('panel.border')}</label>
              <NumberInput min={0.1} decimals={3} step={0.5} value={dotsToMm(el.thickness ?? 8)}
                onCommit={mm => updateElement(el.id, { thickness: Math.max(1, mmToDots(mm)) })}
              />
            </div>
          )}
          <div>
            {/* ^GB corner rounding: 0 (square) to 8 (heaviest) */}
            <label style={labelStyle}>{t('panel.corners')}</label>
            <select
              className="chrome-input"
              value={el.rounding ?? 0}
              onChange={e => updateElement(el.id, { rounding: Number(e.target.value) || undefined })}
            >
              <option value={0}>{t('panel.square')}</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(r => (
                <option key={r} value={r}>{t('panel.rounded', { n: r })}</option>
              ))}
            </select>
          </div>
        </div>
        {reverseControl}
        </>
      )}

      {el.type === 'image' && (
        <div style={sectionStyle}>
          <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0, marginBottom: 8, lineHeight: 1.5 }}>
            {t('panel.imageNote')}
          </p>
          {imageSource && (
            <div style={{ marginBottom: 8 }}>
              {/* Darker than the threshold prints black */}
              <label style={labelStyle}>{t('panel.threshold', { pct: Math.round(imageSource.threshold / 2.55) })}</label>
              <input
                type="range"
                min={10}
                max={245}
                step={5}
                value={imageSource.threshold}
                onChange={e => {
                  const source = { ...imageSource, threshold: Number(e.target.value) };
                  imageSources.set(el.id, source);
                  updateElement(el.id, imagePatch(rasterize(source, el.width)));
                }}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>
          )}
          <button
            onClick={replaceImage}
            className="chrome-btn chrome-btn-ghost"
            style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
          >
            {t('panel.replacePicture')}
          </button>
          {reverseControl}
        </div>
      )}

      {el.type === 'text' && (
        <div style={sectionStyle}>
          {valueControls}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={labelStyle}>{t('panel.fontSize')}</label>
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
              <label style={labelStyle}>{t('panel.font')}</label>
              <select
                className="chrome-input"
                value={el.fontName ?? '0'}
                onChange={e => updateElement(el.id, { fontName: e.target.value })}
                style={{ paddingRight: 4 }}
              >
                {ZPL_FONTS.map(f => (
                  <option key={f.name} value={f.name}>{t(f.name === '0' ? 'font.default' : 'font.zebra', { name: f.name })}</option>
                ))}
              </select>
            </div>
          </div>
          {orientationControl(setOrientation)}
          {/* ^FB: text aligned inside a fixed width (the element width); not for rotated text */}
          {!el.orientation && <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!el.block}
              onChange={e => updateElement(el.id, e.target.checked
                // Start with the block as wide as the text, so nothing moves
                ? { block: { maxLines: 1, lineSpacing: 0, justify: 'C', hangingIndent: 0 }, width: box.width }
                : { block: undefined })}
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)' }}>{t('panel.fixedWidth')}</span>
          </label>}
          {el.block && !el.orientation && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={labelStyle}>{t('panel.alignment')}</label>
                  <select
                    className="chrome-input"
                    value={el.block.justify}
                    onChange={e => updateElement(el.id, {
                      block: { ...el.block!, justify: e.target.value as 'L' | 'C' | 'R' | 'J' },
                    })}
                  >
                    <option value="L">{t('panel.left')}</option>
                    <option value="C">{t('panel.center')}</option>
                    <option value="R">{t('panel.right')}</option>
                    <option value="J">{t('panel.justified')}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t('panel.maxLines')}</label>
                  <NumberInput min={1} max={9} decimals={0}
                    value={el.block.maxLines}
                    onCommit={maxLines => updateElement(el.id, { block: { ...el.block!, maxLines } })}
                  />
                </div>
              </div>
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 3, lineHeight: 1.5 }}>
                {t('panel.blockNote')}
              </p>
            </div>
          )}
          {reverseControl}
          {dynamicControls}
        </div>
      )}

      {(el.type === 'barcode128' || el.type === 'barcodeI2of5' || el.type === 'qrcode') && (
        <div style={sectionStyle}>
          {valueControls}
          {dynamicControls}
          {el.type === 'barcodeI2of5' && (
            <>
              {orientationControl(next => {
                const wasRotated = el.orientation === 'R' || el.orientation === 'B';
                const isRotated = next === 'R' || next === 'B';
                // Turning 90 degrees swaps the footprint on the canvas
                updateElement(el.id, wasRotated === isRotated
                  ? { orientation: next }
                  : { orientation: next, width: el.height, height: el.width });
              })}
              {printLineControl}
              <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0 }}>
                {t('panel.i2of5Note')}
              </p>
            </>
          )}
          {el.type === 'barcode128' && (
            <>
              {orientationControl(setOrientation)}
              {printLineControl}
              {reverseControl}
              {sizedByBars && (
                <>
                  {/* The length is bar width x symbol length: W follows from these two */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <div>
                      <label style={labelStyle} title={t('panel.barWidthTitle')}>{t('panel.barWidth')}</label>
                      <NumberInput min={1} max={10} decimals={0} value={el.moduleWidth!}
                        onCommit={moduleWidth => updateElement(el.id, barWidthPatch(el, moduleWidth, samples))}
                      />
                    </div>
                    {code128Value(el, samples).includes('{{') && (
                      <div>
                        <label style={labelStyle} title={t('panel.charactersTitle')}>{t('panel.characters')}</label>
                        <NumberInput min={1} max={60} decimals={0}
                          value={el.expectedChars ?? CODE128_PLACEHOLDER_CHARS}
                          onCommit={chars => updateElement(el.id, expectedCharsPatch(el, chars, samples))}
                        />
                      </div>
                    )}
                  </div>
                  {code128Value(el, samples).includes('{{') && (
                    <p style={{ fontSize: 10, color: 'var(--chrome-text-faint)', marginTop: 0, lineHeight: 1.5 }}>
                      {t('panel.widthNote')}
                    </p>
                  )}
                </>
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
            {el.width >= el.height ? t('panel.horizontal') : t('panel.vertical')}
          </button>
          <div style={{ marginTop: 8 }}>{reverseControl}</div>
        </div>
      )}

      {/* Layer order */}
      <div style={sectionStyle}>
        <span className="panel-label" style={{ display: 'block', marginBottom: 8 }}>{t('panel.layerOrder')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {[
            { label: t('panel.front'), action: bringToFront },
            { label: t('panel.back'), action: sendToBack },
            { label: t('panel.forward'), action: bringForward },
            { label: t('panel.backward'), action: sendBackward },
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
          {t('panel.duplicate')}
        </button>
        <button
          onClick={() => deleteElement(el.id)}
          className="chrome-btn chrome-btn-danger"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 3h9M4.5 3V2h3v1M4.5 5.5v4M7.5 5.5v4M2.5 3l.5 7h6l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {t('panel.delete')}
        </button>
      </div>
    </div>
  );
}
