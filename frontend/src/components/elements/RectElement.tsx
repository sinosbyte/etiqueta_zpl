import React from 'react';
import { DesignElement } from '../../types';

interface Props { element: DesignElement; scale: number; }

export function RectElement({ element, scale }: Props) {
  const filled = element.filled ?? false;
  const reversed = element.reversed ?? false;
  // ^GB rounding 0..8 → corner radius as a fraction of half the shorter side
  const borderRadius = ((element.rounding ?? 0) / 8) * (Math.min(element.width, element.height) / 2) * scale;
  const lineColor = element.color === 'W' ? 'white' : 'black';

  if (filled && reversed) {
    // ^FR XORs dots: white field on black = white, white field on white = black.
    // CSS difference blend achieves this only when NOT in an isolation group
    // (so it can see the white canvas background and turn white→black there).
    return (
      <div style={{
        width: element.width * scale,
        height: element.height * scale,
        background: 'white',
        border: 'none',
        borderRadius,
        boxSizing: 'border-box',
        mixBlendMode: 'difference',
      }} />
    );
  }

  return (
    <div style={{
      width: element.width * scale,
      height: element.height * scale,
      background: filled ? lineColor : 'transparent',
      border: filled ? 'none' : `${(element.thickness ?? 8) * scale}px solid ${lineColor}`,
      borderRadius,
      boxSizing: 'border-box',
    }} />
  );
}
