import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { DesignElement } from '../../types';
import { ROTATION_DEGREES } from '../../utils/rotation';

interface Props { element: DesignElement; scale: number; }

// Interleaved 2 of 5 (^B2). The element box is the rotated footprint; the bars are
// drawn unrotated (length x bar height) and turned with CSS to match the orientation.
export function I2of5Element({ element, scale }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const orientation = element.orientation ?? 'N';
  const rotated = orientation === 'R' || orientation === 'B';
  const boxW = element.width * scale;
  const boxH = element.height * scale;
  const length = rotated ? boxH : boxW;
  const barHeight = rotated ? boxW : boxH;
  const value = element.value ?? '';
  const showBars = !element.dynamic && /^\d+$/.test(value);
  const printLine = element.printLine ?? true;

  useEffect(() => {
    if (!showBars || !ref.current) return;
    try {
      // ITF needs an even digit count; the printer pads with a leading zero
      const data = value.length % 2 === 1 ? `0${value}` : value;
      JsBarcode(ref.current, data, {
        format: 'ITF',
        width: 2,
        height: 100,
        displayValue: printLine || (element.lineAbove ?? false),
        textPosition: element.lineAbove ? 'top' : 'bottom',
        fontSize: 18,
        margin: 0,
      });
      // Stretch the symbol to the element box
      const naturalW = parseFloat(ref.current.getAttribute('width') ?? '0');
      const naturalH = parseFloat(ref.current.getAttribute('height') ?? '0');
      if (naturalW > 0 && naturalH > 0) {
        ref.current.setAttribute('viewBox', `0 0 ${naturalW} ${naturalH}`);
        ref.current.setAttribute('preserveAspectRatio', 'none');
        ref.current.removeAttribute('width');
        ref.current.removeAttribute('height');
      }
    } catch {
      // invalid barcode value
    }
  }, [value, showBars, printLine, element.lineAbove, length, barHeight]);

  const inner: React.CSSProperties = {
    position: 'absolute',
    left: (boxW - length) / 2,
    top: (boxH - barHeight) / 2,
    width: length,
    height: barHeight,
    transform: `rotate(${ROTATION_DEGREES[orientation]}deg)`,
    transformOrigin: 'center',
  };

  return (
    <div style={{ position: 'relative', width: boxW, height: boxH, userSelect: 'none' }}>
      {showBars ? (
        <svg ref={ref} style={{ ...inner, display: 'block' }} />
      ) : (
        <div
          style={{
            ...inner,
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
          <span style={{ fontSize: Math.max(10, barHeight * 0.18), fontFamily: 'monospace', color: '#374151' }}>
            {element.dynamic && element.variableName ? `{{${element.variableName}}}` : value || 'Interleaved 2 of 5'}
          </span>
          <span style={{ fontSize: Math.max(9, barHeight * 0.12), color: '#9ca3af' }}>Interleaved 2 of 5</span>
        </div>
      )}
    </div>
  );
}
