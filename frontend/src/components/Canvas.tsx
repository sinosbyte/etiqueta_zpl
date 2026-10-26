import React, { useCallback, useEffect, useState } from 'react';
import { DndContext, DragEndEvent, DragMoveEvent, DragStartEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useDesignerStore } from '../store/useDesignerStore';
import { DesignElement, isRawField } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { TextElement } from './elements/TextElement';
import { BarcodeElement } from './elements/BarcodeElement';
import { I2of5Element } from './elements/I2of5Element';
import { QRCodeElement } from './elements/QRCodeElement';
import { RectElement } from './elements/RectElement';
import { LineElement } from './elements/LineElement';
import { usePanning } from '../hooks/usePanning';
import { useElementResize } from '../hooks/useElementResize';

function ElementRenderer({ element, scale }: { element: DesignElement; scale: number }) {
  switch (element.type) {
    case 'text': return <TextElement element={element} scale={scale} />;
    case 'barcode128': return <BarcodeElement element={element} scale={scale} />;
    case 'barcodeI2of5': return <I2of5Element element={element} scale={scale} />;
    case 'qrcode': return <QRCodeElement element={element} scale={scale} />;
    case 'rect': return <RectElement element={element} scale={scale} />;
    case 'line': return <LineElement element={element} scale={scale} />;
    case 'comment': return null;
    case 'raw': return null;
  }
}

function DraggableElement({ element, scale, groupOffset }: { element: DesignElement; scale: number; groupOffset: { x: number; y: number } | null }) {
  const { selectedId, selectedIds, selectElement, toggleSelectElement, updateElement, deleteElement } =
    useDesignerStore(useShallow(s => ({
      selectedId: s.selectedId,
      selectedIds: s.selectedIds,
      selectElement: s.selectElement,
      toggleSelectElement: s.toggleSelectElement,
      updateElement: s.updateElement,
      deleteElement: s.deleteElement,
    })));

  const isSelected = selectedId === element.id;
  const isInSelection = selectedIds.includes(element.id);

  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: element.id });
  const { handleResizeStart, handleResize } = useElementResize(element, scale, updateElement);

  const mergedPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      e.stopPropagation();
      if (e.shiftKey) {
        toggleSelectElement(element.id);
      } else if (!selectedIds.includes(element.id)) {
        // Preserve an existing multi-selection when starting a drag on one of its members.
        selectElement(element.id);
      }
    }
    listeners?.onPointerDown?.(e);
  }, [element.id, selectElement, toggleSelectElement, listeners, selectedIds]);

  // dnd-kit only applies `transform` to the actively dragged node. For the other
  // members of a multi-selection we mirror the drag via `groupOffset` (px).
  const activeTransform = transform
    ? { x: transform.x, y: transform.y }
    : groupOffset && isInSelection
      ? groupOffset
      : null;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: element.x * scale,
    top: element.y * scale,
    cursor: 'move',
    outline: isSelected
      ? '2px solid var(--accent)'
      : isInSelection
        ? '2px solid rgba(76,142,245,0.5)'
        : undefined,
    transform: activeTransform ? `translate(${activeTransform.x}px, ${activeTransform.y}px)` : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onPointerDown={mergedPointerDown}
      onKeyDown={e => { if (e.key === 'Delete' && isSelected) deleteElement(element.id); }}
    >
      <ElementRenderer element={element} scale={scale} />
      {isSelected && (
        <>
          {(['n','s','e','w','ne','nw','se','sw'] as const).map(d => (
            <ResizeHandle
              key={d}
              direction={d}
              onResizeStart={handleResizeStart}
              onResize={handleResize}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function Canvas() {
  const { labelWidth, labelHeight, elements, clearSelection, zoom } =
    useDesignerStore(useShallow(s => ({
      labelWidth: s.labelWidth,
      labelHeight: s.labelHeight,
      elements: s.elements,
      clearSelection: s.clearSelection,
      zoom: s.zoom,
    })));

  const { setNodeRef } = useDroppable({ id: 'canvas' });
  const { wrapperRef, isPanning, handleMouseDown } = usePanning();

  // Register as non-passive so preventDefault() actually suppresses browser zoom.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { zoom: current, setZoom: sz } = useDesignerStore.getState();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      sz(Math.round((current + delta) * 100) / 100);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wrapperRef]);

  const canvasWidth = labelWidth * zoom;
  const canvasHeight = labelHeight * zoom;

  // Printed fields kept verbatim because the canvas cannot draw them
  // (label-level settings such as ^CI28 have nothing to draw and are not counted)
  const rawCount = elements.filter(isRawField).length;

  // Live pixel offset while a multi-selection drag is in progress, so the
  // non-active members follow the pointer too.
  const [groupOffset, setGroupOffset] = useState<{ x: number; y: number } | null>(null);

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    setGroupOffset({ x: 0, y: 0 });
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    setGroupOffset({ x: event.delta.x, y: event.delta.y });
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, delta } = event;
    setGroupOffset(null);
    const { elements, updateElement, selectedIds, snapToGrid, gridSize } = useDesignerStore.getState();
    const dragged = elements.find(e => e.id === active.id);
    if (!dragged) return;

    // Move every selected element by the same delta; fall back to the dragged one.
    const movingIds = selectedIds.includes(String(active.id)) && selectedIds.length > 0
      ? selectedIds
      : [String(active.id)];

    const dotDx = Math.round(delta.x / zoom);
    const dotDy = Math.round(delta.y / zoom);

    for (const id of movingIds) {
      const el = elements.find(e => e.id === id);
      if (!el) continue;
      let x = Math.max(0, el.x + dotDx);
      let y = Math.max(0, el.y + dotDy);
      if (snapToGrid) {
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
      }
      updateElement(id, { x, y });
    }
  }, [zoom]);

  return (
    <DndContext onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <div
        ref={wrapperRef}
        className="h-full overflow-auto p-4"
        style={{ cursor: isPanning ? 'grabbing' : undefined, background: 'var(--canvas-bg)' }}
        onMouseDown={handleMouseDown}
        onContextMenu={e => e.preventDefault()}
      >
        {rawCount > 0 && (
          <div
            style={{
              width: canvasWidth,
              margin: '0 auto 8px',
              padding: '6px 10px',
              fontSize: 12,
              lineHeight: 1.4,
              borderRadius: 6,
              border: '1px solid var(--chrome-border)',
              background: 'var(--chrome-surface)',
              color: 'var(--chrome-text-muted)',
              boxSizing: 'border-box',
            }}
          >
            {rawCount} ZPL {rawCount === 1 ? 'field is' : 'fields are'} kept as written but not drawn on the canvas
            (e.g. rotated text, ^FH, barcodes other than Code 128 / Interleaved 2 of 5 / QR). Edit them in the
            Code tab and use Preview to see the real label.
          </div>
        )}
        <div
          ref={setNodeRef}
          onClick={() => clearSelection()}
          style={{
            position: 'relative',
            width: canvasWidth,
            height: canvasHeight,
            background: 'white',
            margin: '0 auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)',
            overflow: 'hidden',
          }}
        >
          {/* Elements layer — no isolation so ^FR difference blend can see the white canvas bg */}
          <div style={{ position: 'absolute', inset: 0 }}>
            {elements.filter(el => el.type !== 'comment' && el.type !== 'raw').map(el => (
              <DraggableElement key={el.id} element={el} scale={zoom} groupOffset={groupOffset} />
            ))}
          </div>
          {/* Dot grid rendered after elements via multiply — visible on white, invisible on black */}
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle, #aaa 1px, transparent 1px)',
            backgroundSize: `${8 * zoom}px ${8 * zoom}px`,
            mixBlendMode: 'multiply',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    </DndContext>
  );
}
