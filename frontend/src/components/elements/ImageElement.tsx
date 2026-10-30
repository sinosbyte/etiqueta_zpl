import React, { useMemo } from 'react';
import { DesignElement } from '../../types';
import { bitmapToDataUrl, decodeGraphic } from '../../utils/graphic';

interface Props { element: DesignElement; scale: number; }

// ^GFA image: each dot of the bitmap drawn as one printer dot
export function ImageElement({ element, scale }: Props) {
  const reversed = element.reversed ?? false;
  const src = useMemo(() => {
    const bm = decodeGraphic(element.value ?? '', element.bytesPerRow ?? Math.ceil(element.width / 8));
    // ^FR: white dots blended with "difference" print black on white and white on black
    return bm ? bitmapToDataUrl(bm, reversed ? 'white' : 'black') : null;
  }, [element.value, element.bytesPerRow, element.width, reversed]);

  return (
    <div style={{ width: element.width * scale, height: element.height * scale, userSelect: 'none' }}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            pointerEvents: 'none',
            mixBlendMode: reversed ? 'difference' : undefined,
          }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', border: '2px dashed #ef4444', boxSizing: 'border-box' }} />
      )}
    </div>
  );
}
