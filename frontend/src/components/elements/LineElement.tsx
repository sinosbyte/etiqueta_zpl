import React from 'react';
import { DesignElement } from '../../types';

interface Props { element: DesignElement; scale: number; }

// A line is a solid bar filling its bounding box — the shorter dimension is its
// thickness. This mirrors the ZPL (^GB{w},{h},{min(w,h)}) and Labelary render,
// so resizing the box thickens the line instead of drawing a hollow outline.
// With ^FR the bar is white blended with "difference": black on white, white on black.
export function LineElement({ element, scale }: Props) {
  return (
    <div style={{
      width: element.width * scale,
      height: element.height * scale,
      background: element.reversed ? 'white' : 'black',
      mixBlendMode: element.reversed ? 'difference' : undefined,
    }} />
  );
}
