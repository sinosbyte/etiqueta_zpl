import React, { useCallback, useEffect, useState } from 'react';
import { DndContext, DragEndEvent, DragMoveEvent, DragStartEvent, Modifier, useDraggable, useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { snapContext, useDesignerStore } from '../store/useDesignerStore';
import { Guide, snapMove, unionBox } from '../utils/snap';
import { dotsToMm } from '../utils/units';
import { elementBox } from '../utils/zplText';
import { DesignElement, isRawField } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { TextElement } from './elements/TextElement';
import { BarcodeElement } from './elements/BarcodeElement';
import { I2of5Element } from './elements/I2of5Element';
import { QRCodeElement } from './elements/QRCodeElement';
import { RectElement } from './elements/RectElement';
import { LineElement } from './elements/LineElement';
import { ImageElement } from './elements/ImageElement';
import { usePanning } from '../hooks/usePanning';
import { useElementResize } from '../hooks/useElementResize';
import { extractVariables, substituteVariables } from '../utils/variables';

const GUIDE_COLOR = '#ec4899';

// Equal-spacing marker: a line across the gap with end ticks and its size in mm
function GapMarker({ guide: g, zoom }: { guide: Guide; zoom: number }) {
  const horizontal = g.axis === 'x';
  const length = (g.to - g.from) * zoom;
  return (
    <div
      style={{
        position: 'absolute',
        left: horizontal ? g.from * zoom : g.at * zoom - 4,
        top: horizontal ? g.at * zoom - 4 : g.from * zoom,
        width: horizontal ? length : 9,
        height: horizontal ? 9 : length,
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {horizontal ? (
          <>
            <line x1="0" y1="4.5" x2={length} y2="4.5" stroke={GUIDE_COLOR} />
            <line x1="0.5" y1="0" x2="0.5" y2="9" stroke={GUIDE_COLOR} />
            <line x1={length - 0.5} y1="0" x2={length - 0.5} y2="9" stroke={GUIDE_COLOR} />
          </>
        ) : (
          <>
            <line x1="4.5" y1="0" x2="4.5" y2={length} stroke={GUIDE_COLOR} />
            <line x1="0" y1="0.5" x2="9" y2="0.5" stroke={GUIDE_COLOR} />
            <line x1="0" y1={length - 0.5} x2="9" y2={length - 0.5} stroke={GUIDE_COLOR} />
          </>
        )}
      </svg>
      <span
        style={{
          position: 'absolute',
          left: horizontal ? '50%' : 12,
          top: horizontal ? -16 : '50%',
          transform: horizontal ? 'translateX(-50%)' : 'translateY(-50%)',
          padding: '0 4px',
          borderRadius: 3,
          background: GUIDE_COLOR,
          color: 'white',
          fontSize: 10,
          lineHeight: '14px',
          whiteSpace: 'nowrap',
        }}
      >
        {dotsToMm(g.to - g.from).toLocaleString()} mm
      </span>
    </div>
  );
}

// A barcode/QR with its sample value in place of {{variables}}, so the canvas
// draws real bars. Variables without a sample value stay as placeholders.
function withSampleValue(element: DesignElement, samples: Record<string, string>): DesignElement {
  if (element.dynamic && element.variableName) {
    const sample = samples[element.variableName];
    return sample ? { ...element, dynamic: false, value: sample } : element;
  }
  if (!element.value || extractVariables(element.value).some(v => !samples[v])) return element;
  return { ...element, value: substituteVariables(element.value, samples) };
}

function ElementRenderer({ element, scale }: { element: DesignElement; scale: number }) {
  const samples = useDesignerStore(s => (s.showSamples ? s.sampleValues : null));
  if (samples && (element.type === 'barcode128' || element.type === 'barcodeI2of5' || element.type === 'qrcode')) {
    element = withSampleValue(element, samples);
  }
  switch (element.type) {
    case 'text': return <TextElement element={element} scale={scale} samples={samples} />;
    case 'barcode128': return <BarcodeElement element={element} scale={scale} />;
    case 'barcodeI2of5': return <I2of5Element element={element} scale={scale} />;
    case 'qrcode': return <QRCodeElement element={element} scale={scale} />;
    case 'rect': return <RectElement element={element} scale={scale} />;
    case 'line': return <LineElement element={element} scale={scale} />;
    case 'image': return <ImageElement element={element} scale={scale} />;
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
  const { handleResizeStart, handleResize, handleResizeEnd } = useElementResize(element, scale, updateElement);

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
              onResizeEnd={handleResizeEnd}
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
  const guides = useDesignerStore(s => s.guides);
  const gridSize = useDesignerStore(s => s.gridSize);

  // The move in dots of the dragged element, or of the whole selection when it is
  // part of one, snapped to the grid and to other elements (magnetic)
  const dragSnap = useCallback((activeId: string, px: { x: number; y: number }) => {
    const { elements, selectedIds, showSamples, sampleValues } = useDesignerStore.getState();
    const ids = selectedIds.includes(activeId) && selectedIds.length > 0 ? selectedIds : [activeId];
    const dx = px.x / zoom;
    const dy = px.y / zoom;
    const ctx = snapContext(ids);
    const moving = elements.filter(e => ids.includes(e.id));
    if (!ctx || moving.length === 0) return { ids, dx: Math.round(dx), dy: Math.round(dy), guides: [] };
    const samples = showSamples ? sampleValues : null;
    const box = unionBox(moving.map(e => ({ x: e.x, y: e.y, ...elementBox(e, samples) })));
    return { ids, ...snapMove(box, dx, dy, ctx.others, ctx.label, ctx.opts) };
  }, [zoom]);

  // The dragged element is drawn at its snapped position
  const snapModifier: Modifier = useCallback(({ transform, active }) => {
    if (!active) return transform;
    const s = dragSnap(String(active.id), transform);
    return { ...transform, x: s.dx * zoom, y: s.dy * zoom };
  }, [dragSnap, zoom]);

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    setGroupOffset({ x: 0, y: 0 });
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const s = dragSnap(String(event.active.id), event.delta);
    setGroupOffset({ x: s.dx * zoom, y: s.dy * zoom });
    useDesignerStore.getState().setGuides(s.guides);
  }, [dragSnap, zoom]);

  const handleDragCancel = useCallback(() => {
    setGroupOffset(null);
    useDesignerStore.getState().setGuides([]);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, delta } = event;
    setGroupOffset(null);
    const { elements, updateElement, setGuides } = useDesignerStore.getState();
    setGuides([]);
    if (!elements.some(e => e.id === active.id)) return;

    // Move every selected element by the same snapped delta; fall back to the dragged one.
    const { ids, dx, dy } = dragSnap(String(active.id), delta);
    for (const id of ids) {
      const el = elements.find(e => e.id === id);
      if (!el) continue;
      updateElement(id, { x: Math.max(0, el.x + dx), y: Math.max(0, el.y + dy) });
    }
  }, [dragSnap]);

  // Grid dots: every grid step, or every 2, 4… steps when they would be too dense to see
  let gridStep = gridSize * zoom;
  while (gridStep < 6) gridStep *= 2;

  return (
    <DndContext
      modifiers={[snapModifier]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
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
            (e.g. ^FH, barcodes placed with ^FT, barcodes other than Code 128 / Interleaved 2 of 5 / QR). Edit them in the
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
            backgroundSize: `${gridStep}px ${gridStep}px`,
            mixBlendMode: 'multiply',
            pointerEvents: 'none',
          }} />
          {/* Alignment guides while dragging or resizing (magnetic snapping) */}
          {guides.map((g, i) => g.gap ? <GapMarker key={i} guide={g} zoom={zoom} /> : (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: g.axis === 'x' ? Math.min(g.at * zoom, canvasWidth - 1) : g.from * zoom,
                top: g.axis === 'y' ? Math.min(g.at * zoom, canvasHeight - 1) : g.from * zoom,
                width: g.axis === 'x' ? 1 : (g.to - g.from) * zoom,
                height: g.axis === 'y' ? 1 : (g.to - g.from) * zoom,
                background: GUIDE_COLOR,
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      </div>
    </DndContext>
  );
}
