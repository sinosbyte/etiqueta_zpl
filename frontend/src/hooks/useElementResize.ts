import { useCallback, useRef } from 'react';
import { DesignElement } from '../types';
import { elementBox, resizeTextPatch } from '../utils/zplText';
import { resizeCode128Patch } from '../utils/code128';
import { resizeImagePatch } from '../utils/graphic';
import { snapContext, useDesignerStore } from '../store/useDesignerStore';
import { snapResize } from '../utils/snap';

export function useElementResize(
  element: DesignElement,
  scale: number,
  updateElement: (id: string, patch: Partial<DesignElement>) => void,
) {
  // The element and its box on the canvas when the drag started
  const snapshot = useRef<{ el: DesignElement; box: { x: number; y: number; width: number; height: number } } | null>(null);
  const samples = useDesignerStore(s => (s.showSamples ? s.sampleValues : null));

  const handleResizeStart = useCallback(() => {
    // Start from the box shown on the canvas (text is sized like the printed text)
    snapshot.current = { el: element, box: { x: element.x, y: element.y, ...elementBox(element, samples) } };
  }, [element, samples]);

  const handleResize = useCallback((dx: number, dy: number, dir: string) => {
    const snap = snapshot.current;
    if (!snap) return;
    const { el, box } = snap;
    const dotDx = Math.round(dx / scale);
    const dotDy = Math.round(dy / scale);
    const min = el.type === 'text' && !el.block ? 8 : 20;
    const patch: Partial<DesignElement> = {};
    if (dir.includes('e')) patch.width = Math.max(min, box.width + dotDx);
    if (dir.includes('s')) patch.height = Math.max(min, box.height + dotDy);
    if (dir.includes('w')) {
      const newWidth = Math.max(min, box.width - dotDx);
      patch.x = box.x + (box.width - newWidth);
      patch.width = newWidth;
    }
    if (dir.includes('n')) {
      const newHeight = Math.max(min, box.height - dotDy);
      patch.y = box.y + (box.height - newHeight);
      patch.height = newHeight;
    }

    // The edges being dragged snap to the grid and to other elements (magnetic)
    const ctx = snapContext([el.id]);
    if (ctx) {
      const dragged = {
        x: patch.x ?? box.x, y: patch.y ?? box.y, width: patch.width ?? box.width, height: patch.height ?? box.height,
      };
      const snapped = snapResize(dragged, dir, ctx.others, ctx.label, ctx.opts);
      if (snapped.box.width >= min && snapped.box.height >= min) {
        if (patch.x !== undefined) patch.x = snapped.box.x;
        if (patch.y !== undefined) patch.y = snapped.box.y;
        if (patch.width !== undefined) patch.width = snapped.box.width;
        if (patch.height !== undefined) patch.height = snapped.box.height;
        useDesignerStore.getState().setGuides(snapped.guides);
      }
    }

    // Text outside a ^FB block scales its font, a Code 128 sets its bar width (^BY)
    // and an image keeps its proportions: the size follows the drag in steps, and
    // a left or top handle keeps the opposite edge in place
    let sized: Partial<DesignElement> | null = null;
    const width = patch.width ?? box.width;
    const height = patch.height ?? box.height;
    if (el.type === 'text' && !el.block) sized = resizeTextPatch(el, width, height, samples);
    else if (el.type === 'barcode128' && el.moduleWidth) sized = resizeCode128Patch(el, width, height, samples);
    else if (el.type === 'image') {
      // Side handles follow the side dragged; corners follow the width
      const byHeight = !dir.includes('e') && !dir.includes('w');
      sized = resizeImagePatch(el, byHeight ? height * el.width / el.height : width);
    }
    if (!sized) {
      updateElement(el.id, patch);
      return;
    }
    const next = elementBox({ ...el, ...sized }, samples);
    updateElement(el.id, {
      ...sized,
      x: dir.includes('w') ? box.x + box.width - next.width : box.x,
      y: dir.includes('n') ? box.y + box.height - next.height : box.y,
    });
  }, [scale, updateElement, samples]);

  const handleResizeEnd = useCallback(() => {
    snapshot.current = null;
    useDesignerStore.getState().setGuides([]);
  }, []);

  return { handleResizeStart, handleResize, handleResizeEnd };
}
