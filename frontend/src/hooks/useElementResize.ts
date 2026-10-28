import { useCallback, useRef } from 'react';
import { DesignElement } from '../types';
import { elementBox, resizeTextPatch } from '../utils/zplText';
import { useDesignerStore } from '../store/useDesignerStore';

export function useElementResize(
  element: DesignElement,
  scale: number,
  updateElement: (id: string, patch: Partial<DesignElement>) => void,
) {
  const snapshot = useRef<DesignElement | null>(null);
  const samples = useDesignerStore(s => (s.showSamples ? s.sampleValues : null));

  const handleResizeStart = useCallback(() => {
    // Start from the box shown on the canvas (text is sized like the printed text)
    snapshot.current = { ...element, ...elementBox(element, samples) };
  }, [element, samples]);

  const handleResize = useCallback((dx: number, dy: number, dir: string) => {
    const snap = snapshot.current;
    if (!snap) return;
    const dotDx = Math.round(dx / scale);
    const dotDy = Math.round(dy / scale);
    const min = snap.type === 'text' && !snap.block ? 8 : 20;
    const patch: Partial<DesignElement> = {};
    if (dir.includes('e')) patch.width = Math.max(min, snap.width + dotDx);
    if (dir.includes('s')) patch.height = Math.max(min, snap.height + dotDy);
    if (dir.includes('w')) {
      const newWidth = Math.max(min, snap.width - dotDx);
      patch.x = snap.x + (snap.width - newWidth);
      patch.width = newWidth;
    }
    if (dir.includes('n')) {
      const newHeight = Math.max(min, snap.height - dotDy);
      patch.y = snap.y + (snap.height - newHeight);
      patch.height = newHeight;
    }
    if (snap.type === 'text' && !snap.block) {
      // Text outside a ^FB block: the box is the text, so resizing scales the font
      const { width, height, ...position } = patch;
      updateElement(snap.id, { ...position, ...resizeTextPatch(snap, width ?? snap.width, height ?? snap.height, samples) });
      return;
    }
    updateElement(snap.id, patch);
  }, [scale, updateElement, samples]);

  return { handleResizeStart, handleResize };
}
