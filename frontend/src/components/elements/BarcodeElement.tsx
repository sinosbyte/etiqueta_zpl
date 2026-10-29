import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { DesignElement } from '../../types';
import { CODE128_FORMAT, code128Value, code128Width } from '../../utils/code128';

interface Props { element: DesignElement; scale: number; }

// Code 128 (^BC). Sample values are already in element.value when shown on the canvas.
export function BarcodeElement({ element, scale }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const containerWidth = code128Width(element) * scale;
  const containerHeight = element.height * scale;
  const printLine = element.printLine ?? true;
  const textHeight = printLine ? Math.max(12, containerHeight * 0.1) : 0;
  const barsHeight = containerHeight - (printLine ? textHeight + 4 : 0);
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
      // Scale bars to fill container width, preserving bar height
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
  }, [value, element.codeSet, containerWidth, barsHeight, isPlaceholder]);

  if (isPlaceholder) {
    return (
      <div
        style={{
          width: containerWidth,
          height: containerHeight,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #9ca3af',
          background: '#f9fafb',
          boxSizing: 'border-box',
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: Math.max(10, containerHeight * 0.18), fontFamily: 'monospace', color: '#374151' }}>
          {value}
        </span>
        <span style={{ fontSize: Math.max(9, containerHeight * 0.12), color: '#9ca3af' }}>Code 128</span>
      </div>
    );
  }

  return (
    <div style={{ width: containerWidth, height: containerHeight, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg ref={ref} style={{ width: containerWidth, height: barsHeight }} />
      {printLine && (
        <span style={{ fontSize: textHeight, fontFamily: 'monospace', marginTop: 2, userSelect: 'none' }}>
          {value || '000000'}
        </span>
      )}
    </div>
  );
}
