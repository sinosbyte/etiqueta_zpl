import React, { useEffect, useRef } from 'react';
import { DesignElement } from '../../types';
import { dmBoxSide, dmPrinted, useEncoder } from '../../utils/datamatrix';

interface Props { element: DesignElement; scale: number; }

// A box with a label, for a Data Matrix that cannot be drawn as a symbol (yet)
function Placeholder({ size, label, sub, warn }: { size: number; label: string; sub: string; warn?: boolean }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: `2px dashed ${warn ? '#dc2626' : '#9ca3af'}`,
        background: warn ? 'rgba(220, 38, 38, 0.08)' : '#f9fafb',
        userSelect: 'none',
        overflow: 'hidden',
        textAlign: 'center',
        padding: 4,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: Math.max(10, size * 0.12), fontFamily: 'monospace', color: '#374151', wordBreak: 'break-all' }}>
        {label}
      </span>
      <span style={{ fontSize: Math.max(9, size * 0.09), color: warn ? '#dc2626' : '#9ca3af' }}>{sub}</span>
    </div>
  );
}

export function DataMatrixElement({ element, scale }: Props) {
  const encoder = useEncoder();  // draws again when the encoder arrives
  const ref = useRef<HTMLCanvasElement>(null);
  const isDynamic = element.dynamic && element.variableName;
  // ElementRenderer has already put the sample values in place of {{variables}}
  const printed = dmPrinted(element);
  const size = (printed?.size ?? dmBoxSide(element)) * scale;
  const symbol = printed?.symbol ?? null;

  // One pixel per module, scaled up without smoothing: the modules stay square and sharp
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !symbol) return;
    canvas.width = symbol.modules;
    canvas.height = symbol.modules;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(symbol.modules, symbol.modules);
    symbol.pixs.forEach((dark, i) => {
      const shade = dark ? 0 : 255;
      image.data[i * 4] = shade;
      image.data[i * 4 + 1] = shade;
      image.data[i * 4 + 2] = shade;
      image.data[i * 4 + 3] = 255;
    });
    context.putImageData(image, 0, 0);
  }, [symbol]);

  if (isDynamic) return <Placeholder size={size} label={`{{${element.variableName}}}`} sub="dm" />;
  if (encoder.failed) return <Placeholder size={size} label="Data Matrix" sub="!" warn />;
  if (printed && !printed.fits) {
    return <Placeholder size={size} label={printed.fixed ? `${printed.modules}×${printed.modules}` : 'Data Matrix'} sub="!" warn />;
  }
  if (!symbol) return <Placeholder size={size} label="Data Matrix" sub="…" />;

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block', imageRendering: 'pixelated' }} />;
}
