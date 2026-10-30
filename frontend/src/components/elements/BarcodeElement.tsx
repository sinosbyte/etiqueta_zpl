import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { DesignElement } from '../../types';
import { CODE128_FORMAT, code128DigitsBand, code128Value, code128Width } from '../../utils/code128';
import { ROTATION_DEGREES } from '../../utils/rotation';

interface Props { element: DesignElement; scale: number; }

// Code 128 (^BC). Sample values are already in element.value when shown on the canvas.
// The element box is the bars, as ^FO places them; the digits print outside the box,
// below the bars of the unturned symbol, like on the printer.
export function BarcodeElement({ element, scale }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const moduleWidth = element.moduleWidth ?? 2;
  const length = code128Width(element) * scale;
  const barsHeight = element.height * scale;
  const printLine = element.printLine ?? true;
  const band = printLine ? code128DigitsBand(moduleWidth) * scale : 0;
  const value = code128Value(element);
  // A {{variable}} has no bars until a sample value is shown
  const isPlaceholder = value.includes('{{');

  useEffect(() => {
    if (isPlaceholder || !ref.current) return;
    try {
      // Without a start code the printer encodes in subset B
      JsBarcode(ref.current, value || '000000', {
        format: CODE128_FORMAT[element.codeSet ?? 'B'],
        width: 2,
        height: barsHeight,
        displayValue: false,
        margin: 0,
      });
      // Scale bars to fill the length, preserving bar height
      const naturalW = parseFloat(ref.current.getAttribute('width') ?? '0');
      const naturalH = parseFloat(ref.current.getAttribute('height') ?? '0');
      if (naturalW > 0 && naturalH > 0) {
        ref.current.setAttribute('viewBox', `0 0 ${naturalW} ${naturalH}`);
        ref.current.setAttribute('preserveAspectRatio', 'none');
        ref.current.removeAttribute('width');
        ref.current.removeAttribute('height');
      }
    } catch (e) {
      // invalid barcode value
    }
  }, [value, element.codeSet, length, barsHeight, isPlaceholder]);

  const bars = isPlaceholder ? (
    <div
      style={{
        width: length,
        height: barsHeight,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '2px dashed #9ca3af',
        background: '#f9fafb',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: Math.max(10, barsHeight * 0.18), fontFamily: 'monospace', color: '#374151' }}>
        {value}
      </span>
      <span style={{ fontSize: Math.max(9, barsHeight * 0.12), color: '#9ca3af' }}>Code 128</span>
    </div>
  ) : (
    <svg ref={ref} style={{ display: 'block', width: length, height: barsHeight }} />
  );

  // Turned about the top-left corner, then moved back so the bars cover the box
  const orientation = element.orientation ?? 'N';
  const move = { N: '', R: `translate(${barsHeight}px, 0)`, I: `translate(${length}px, ${barsHeight}px)`, B: `translate(0, ${length}px)` };
  const quarter = orientation === 'R' || orientation === 'B';

  return (
    <div style={{ position: 'relative', width: quarter ? barsHeight : length, height: quarter ? length : barsHeight, userSelect: 'none' }}>
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: length,
        transformOrigin: '0 0',
        transform: orientation === 'N' ? undefined : `${move[orientation]} rotate(${ROTATION_DEGREES[orientation]}deg)`,
      }}>
        {bars}
        {printLine && (
          // Interpretation line: digits about 7 bar widths high, 6 per character, 6 dots below the bars
          <svg width={length} height={band} viewBox={`0 0 ${length / scale} ${band / scale}`} style={{ display: 'block', overflow: 'visible' }}>
            <text
              x={length / scale / 2}
              y={band / scale}
              textAnchor="middle"
              fontFamily="'OCR B', 'Courier New', monospace"
              fontSize={10 * moduleWidth}
              textLength={Math.min(length / scale, 6 * moduleWidth * (value.length || 1))}
              lengthAdjust="spacingAndGlyphs"
            >
              {value}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}
