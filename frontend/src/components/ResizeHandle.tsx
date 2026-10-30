import React, { useCallback } from 'react';

type Direction = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface Props {
  direction: Direction;
  onResizeStart: () => void;
  onResize: (dx: number, dy: number, dir: Direction) => void;
  onResizeEnd?: () => void;
}

const CURSOR_MAP: Record<Direction, string> = {
  n: 'n-resize', s: 's-resize', e: 'e-resize', w: 'w-resize',
  ne: 'ne-resize', nw: 'nw-resize', se: 'se-resize', sw: 'sw-resize',
};

const POSITIONS: Record<Direction, React.CSSProperties> = {
  n:  { top: -4, left: '50%', transform: 'translateX(-50%)' },
  s:  { bottom: -4, left: '50%', transform: 'translateX(-50%)' },
  e:  { right: -4, top: '50%', transform: 'translateY(-50%)' },
  w:  { left: -4, top: '50%', transform: 'translateY(-50%)' },
  ne: { top: -4, right: -4 },
  nw: { top: -4, left: -4 },
  se: { bottom: -4, right: -4 },
  sw: { bottom: -4, left: -4 },
};

export function ResizeHandle({ direction, onResizeStart, onResize, onResizeEnd }: Props) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    // Capture element's initial state before any movement
    onResizeStart();

    const onMove = (me: MouseEvent) => {
      // Always report cumulative delta from the drag start
      // Consumer uses the captured initial state, not current state
      onResize(me.clientX - startX, me.clientY - startY, direction);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onResizeEnd?.();
      // The click that ends the drag would reach the canvas and clear the selection
      const swallow = (ce: MouseEvent) => ce.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [direction, onResizeStart, onResize, onResizeEnd]);

  return (
    <div
      onMouseDown={onMouseDown}
      // Stop pointer events so dnd-kit does not start a drag while resizing
      onPointerDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        width: 8, height: 8,
        background: 'var(--accent)',
        border: '1.5px solid var(--canvas-bg)',
        borderRadius: 2,
        cursor: CURSOR_MAP[direction],
        zIndex: 10,
        ...POSITIONS[direction],
      }}
    />
  );
}
