import React, { useCallback, useEffect, useState } from 'react';
import { DndContext, DragEndEvent, DragMoveEvent, DragStartEvent, Modifier, useDraggable, useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { snapContext, useDesignerStore } from '../store/useDesignerStore';
import { Guide, snapMove, unionBox, visibleGridStep } from '../utils/snap';
import { ZOOM_100 } from '../utils/units';
import { useMeasure } from '../store/useUnitStore';
import { elementBox } from '../utils/zplText';
import { DesignElement, isRawField } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { TextElement } from './elements/TextElement';
import { BarcodeElement } from './elements/BarcodeElement';
import { I2of5Element } from './elements/I2of5Element';
import { QRCodeElement } from './elements/QRCodeElement';
import { DataMatrixElement } from './elements/DataMatrixElement';
import { TableElement } from './elements/TableElement';
import { pageOf } from '../utils/pages';
import { requestRemovePage } from '../utils/pageActions';
import { useSimulationStore } from '../store/useSimulationStore';
import { RectElement } from './elements/RectElement';
import { LineElement } from './elements/LineElement';
import { ImageElement } from './elements/ImageElement';
import { usePanning } from '../hooks/usePanning';
import { useElementResize } from '../hooks/useElementResize';
import { extractVariables, substituteVariables } from '../utils/variables';
import { useT, t as translate } from '../i18n';
import { barcodeFit } from '../utils/barcodeFit';
import { boundsIssue, boundsIssues } from '../utils/labelBounds';
import { turnedSize } from '../utils/rotation';

const GUIDE_COLOR = '#ec4899';

// Equal-spacing marker: a line across the gap with end ticks and its size in mm
function GapMarker({ guide: g, zoom }: { guide: Guide; zoom: number }) {
  const m = useMeasure();
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
        {m.show(g.to - g.from).toLocaleString()} {m.short}
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
  if (samples && (element.type === 'barcode128' || element.type === 'barcodeI2of5' || element.type === 'qrcode' || element.type === 'datamatrix')) {
    element = withSampleValue(element, samples);
  }
  switch (element.type) {
    case 'text': return <TextElement element={element} scale={scale} samples={samples} />;
    case 'barcode128': return <BarcodeElement element={element} scale={scale} />;
    case 'barcodeI2of5': return <I2of5Element element={element} scale={scale} />;
    case 'qrcode': return <QRCodeElement element={element} scale={scale} />;
    case 'datamatrix': return <DataMatrixElement element={element} scale={scale} />;
    case 'rect': return <RectElement element={element} scale={scale} />;
    case 'line': return <LineElement element={element} scale={scale} />;
    case 'image': return <ImageElement element={element} scale={scale} />;
    case 'table': return <TableElement element={element} scale={scale} />;
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

  // A Code 128 with a {{variable}} that could print over something or past the label:
  // its printed length (0 = no problem), drawn as a dashed red box
  const misfitLength = useDesignerStore(s => {
    const fit = barcodeFit(element, s.elements, s.sampleValues, s.showSamples, s.labelWidth, s.labelHeight);
    return fit && (fit.overlaps.length > 0 || fit.outside) ? fit.length : 0;
  });

  // An element that runs past the edge of the label (what is outside is not printed): its size as "WxH"
  // ('' = it is inside), drawn as a dashed amber box. The editor only shows it, it never moves the element.
  const outsideBox = useDesignerStore(s => {
    const samples = s.showSamples ? s.sampleValues : null;
    if (!boundsIssue(element, s.labelWidth, s.labelHeight, samples)) return '';
    const box = elementBox(element, samples);
    return `${box.width}x${box.height}`;
  });

  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: element.id });
  const { handleResizeStart, handleResize, handleResizeEnd } = useElementResize(element, scale, updateElement);

  const mergedPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 0) {
      e.stopPropagation();
      // Working on an element is working on its page
      useDesignerStore.getState().setActivePage(pageOf(element));
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
      {misfitLength > 0 && (
        <div
          title={translate('canvas.barcodeMisfit')}
          style={{
            position: 'absolute', left: 0, top: 0, pointerEvents: 'none', boxSizing: 'border-box',
            border: '2px dashed #dc2626', background: 'rgba(220, 38, 38, 0.08)',
            ...(() => { const s = turnedSize(element.orientation, misfitLength, element.height); return { width: s.width * scale, height: s.height * scale }; })(),
          }}
        />
      )}
      {outsideBox !== '' && misfitLength === 0 && (() => {
        const [w, h] = outsideBox.split('x').map(Number);
        return (
          <div
            data-testid="out-of-bounds"
            title={translate('canvas.outOfBounds')}
            style={{
              position: 'absolute', left: 0, top: 0, pointerEvents: 'none', boxSizing: 'border-box',
              border: '2px dashed #d97706', background: 'rgba(217, 119, 6, 0.10)',
              width: w * scale, height: h * scale,
            }}
          />
        );
      })()}
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

/** Where the element being dragged is going: its top-left corner in dots, and its page. */
interface DragPos { x: number; y: number; page: number }

/**
 * While dragging: the position the element will take, in the unit of the fields (mm or dots), and, when snapping
 * is on, that Alt moves freely. Drawn just above the element (inside the label when it is at the top).
 */
function DragBadge({ pos, zoom }: { pos: DragPos; zoom: number }) {
  const t = useT();
  const m = useMeasure();
  const snapping = useDesignerStore(s => s.snapToGrid || s.snapToElements);
  const decimal = (n: number) => (t('common.decimalSeparator') === ',' ? String(n).replace('.', ',') : String(n));
  const top = pos.y * zoom - 22;
  return (
    <div
      data-testid="drag-position"
      style={{
        position: 'absolute', left: pos.x * zoom, top: top < 0 ? pos.y * zoom + 4 : top, zIndex: 20, pointerEvents: 'none',
        padding: '2px 6px', borderRadius: 4, fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
        background: 'rgba(17, 24, 39, 0.88)', color: '#fff', fontVariantNumeric: 'tabular-nums',
      }}
    >
      X {decimal(m.show(pos.x))} · Y {decimal(m.show(pos.y))} {m.short}
      {snapping && <span style={{ opacity: 0.7 }}> · {t('canvas.dragAltHint')}</span>}
    </div>
  );
}

// One label of the design on the canvas: its own drawing area, with the elements of its page. With more than
// one page each has a header that says which it is and how it prints, and clicking it makes it the page being
// edited. A design of one page is drawn exactly as before, without a header.
interface PageSurfaceProps {
  index: number;
  elements: DesignElement[];     // the elements of this page
  zoom: number;
  gridStep: number;
  groupOffset: { x: number; y: number } | null;
  showHeader: boolean;
  dragPos: DragPos | null;       // where the dragged element is going, when it is on this page
}

function PageSurface({ index, elements, zoom, gridStep, groupOffset, showHeader, dragPos }: PageSurfaceProps) {
  const t = useT();
  const { labelWidth, labelHeight } = useDesignerStore(useShallow(s => ({ labelWidth: s.labelWidth, labelHeight: s.labelHeight })));
  const active = useDesignerStore(s => s.activePage === index);
  const mode = useDesignerStore(s => s.pages[index]?.mode);
  const guides = useDesignerStore(s => s.guides);
  const { setNodeRef } = useDroppable({ id: index === 0 ? 'canvas' : `canvas-${index}` });

  const canvasWidth = labelWidth * zoom;
  const canvasHeight = labelHeight * zoom;
  const activate = () => useDesignerStore.getState().setActivePage(index);

  // Elements of this page that run past the label: said below it, with a way to find the first one
  const samples = useDesignerStore(s => (s.showSamples ? s.sampleValues : null));
  const outside = boundsIssues(elements, labelWidth, labelHeight, samples);
  const notice = outside.length > 0 && (
    <div
      role="status"
      data-testid="bounds-notice"
      style={{
        width: Math.max(canvasWidth, 260), maxWidth: '100%', margin: '8px auto 0', padding: '6px 10px', fontSize: 12, lineHeight: 1.4,
        borderRadius: 6, border: '1px solid #d97706', background: 'var(--chrome-surface)', color: 'var(--chrome-text)',
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1 }}>{outside.length === 1 ? t('bounds.summary1') : t('bounds.summaryN', { n: outside.length })}</span>
      <button
        type="button"
        className="chrome-btn chrome-btn-ghost"
        onClick={() => { activate(); useDesignerStore.getState().selectElement(outside[0].id); }}
      >
        {t('bounds.select')}
      </button>
    </div>
  );

  const label = (
    <div
      ref={setNodeRef}
      data-page={index}
      onClick={() => { activate(); useDesignerStore.getState().clearSelection(); }}
      style={{
        position: 'relative',
        width: canvasWidth,
        height: canvasHeight,
        background: 'white',
        margin: '0 auto',
        boxShadow: showHeader && active
          ? '0 0 0 2px var(--accent), 0 4px 20px rgba(0,0,0,0.35)'
          : '0 4px 20px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      {/* Elements layer — no isolation so ^FR difference blend can see the white canvas bg */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {elements.filter(el => el.type !== 'comment' && el.type !== 'raw').map(el => (
          <DraggableElement key={el.id} element={el} scale={zoom} groupOffset={groupOffset} />
        ))}
      </div>
      {/* Dot grid rendered after elements via multiply — visible on white, invisible on black. Only drawn when shown */}
      {gridStep > 0 && <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, #aaa 1px, transparent 1px)',
        backgroundSize: `${gridStep}px ${gridStep}px`,
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
      }} />}
      {dragPos && <DragBadge pos={dragPos} zoom={zoom} />}
      {/* Alignment guides while dragging or resizing (magnetic snapping): on the page being edited */}
      {(active || !showHeader) && guides.map((g, i) => g.gap ? <GapMarker key={i} guide={g} zoom={zoom} /> : (
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
  );

  if (!showHeader) return notice ? <>{label}{notice}</> : label;

  return (
    <section style={{ width: canvasWidth, margin: index === 0 ? '0 auto' : '28px auto 0' }}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={active}
        title={t('page.select')}
        onClick={activate}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, minHeight: 26, marginBottom: 6, cursor: 'pointer',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', userSelect: 'none',
          color: active ? 'var(--accent)' : 'var(--chrome-text-muted)',
        }}
      >
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: active ? 'var(--accent)' : 'var(--chrome-text-faint)' }} />
        <span>{t('page.title', { n: index + 1 })} — {t(mode === 'repeat' ? 'page.repeat' : 'page.first')}</span>
        {active && (
          <span style={{ fontSize: 10, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--chrome-text-faint)' }}>
            · {t('page.editing')}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {index > 0 && (
          <button
            type="button"
            className="chrome-btn chrome-btn-ghost"
            style={{ height: 22, fontSize: 11, padding: '0 8px', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}
            onClick={e => { e.stopPropagation(); void requestRemovePage(); }}
          >
            {t('page.remove')}
          </button>
        )}
      </div>
      {label}
      {notice}
    </section>
  );
}

// Tells that the canvas shows one label of the simulation (the records the backend put on it), not the editing
// preview, and takes the user back to editing
function SimulationBanner({ width }: { width: number }) {
  const t = useT();
  const view = useSimulationStore(s => s.view);
  const setViewing = useSimulationStore(s => s.setViewing);
  if (!view) return null;
  const records = view.records.length === 0
    ? t('sim.noRecords')
    : view.records.length === 1 ? t('sim.record1', { n: view.firstRecord }) : t('sim.recordsRange', { from: view.firstRecord, to: view.firstRecord + view.records.length - 1 });
  return (
    <div
      role="status"
      data-testid="sim-banner"
      style={{
        width: Math.max(width, 280), margin: '0 auto 8px', padding: '6px 10px', fontSize: 12, lineHeight: 1.4, borderRadius: 6,
        border: '1px solid var(--accent)', background: 'var(--chrome-surface)', color: 'var(--chrome-text)', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1 }}>{t('sim.viewing', { n: view.index, total: view.total, page: view.page + 1, records })}</span>
      <button type="button" className="chrome-btn chrome-btn-ghost" onClick={() => setViewing(false)}>{t('sim.back')}</button>
    </div>
  );
}

export function Canvas() {
  const t = useT();
  const { labelWidth, elements, zoom, pages } =
    useDesignerStore(useShallow(s => ({
      labelWidth: s.labelWidth,
      elements: s.elements,
      zoom: s.zoom,
      pages: s.pages,
    })));

  const { wrapperRef, isPanning, handleMouseDown } = usePanning();

  // Register as non-passive so preventDefault() actually suppresses browser zoom.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { zoom: current, setZoom: sz } = useDesignerStore.getState();
      const delta = (e.deltaY < 0 ? 0.1 : -0.1) * ZOOM_100;
      sz(Math.round((current + delta) * 1000) / 1000);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wrapperRef]);

  // A page just added is below the visible part: bring it into view
  const pageCount = pages.length;
  const previousPageCount = React.useRef(pageCount);
  useEffect(() => {
    if (pageCount > previousPageCount.current) {
      wrapperRef.current?.querySelector(`[data-page="${pageCount - 1}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
    previousPageCount.current = pageCount;
  }, [pageCount, wrapperRef]);

  const canvasWidth = labelWidth * zoom;

  // Printed fields kept verbatim because the canvas cannot draw them
  // (label-level settings such as ^CI28 are not counted)
  const rawCount = elements.filter(isRawField).length;

  // Live pixel offset while a multi-selection drag is in progress, so the
  // non-active members follow the pointer too.
  const [groupOffset, setGroupOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<DragPos | null>(null);
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
    // Where the dragged element will be (the same as the move applies at the end: never left of or above 0)
    const el = useDesignerStore.getState().elements.find(e => e.id === event.active.id);
    setDragPos(el ? { x: Math.max(0, el.x + s.dx), y: Math.max(0, el.y + s.dy), page: pageOf(el) } : null);
  }, [dragSnap, zoom]);

  const handleDragCancel = useCallback(() => {
    setDragPos(null);
    setGroupOffset(null);
    useDesignerStore.getState().setGuides([]);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, delta } = event;
    setDragPos(null);
    setGroupOffset(null);
    const { elements, updateElement, setGuides } = useDesignerStore.getState();
    setGuides([]);
    if (!elements.some(e => e.id === active.id)) return;

    // Move every selected element by the same snapped delta; fall back to the dragged one.
    // Only x and y change: an element stays on its own page.
    const { ids, dx, dy } = dragSnap(String(active.id), delta);
    for (const id of ids) {
      const el = elements.find(e => e.id === id);
      if (!el) continue;
      updateElement(id, { x: Math.max(0, el.x + dx), y: Math.max(0, el.y + dy) });
    }
  }, [dragSnap]);

  // Grid dots: every grid step, or every 2, 4… steps when they would be too dense to see; none when the grid is hidden
  const showGrid = useDesignerStore(s => s.showGrid);
  const gridStep = showGrid ? visibleGridStep(gridSize, zoom).px : 0;

  const showHeader = pages.length > 1;

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
        <SimulationBanner width={canvasWidth} />
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
            {t(rawCount === 1 ? 'canvas.rawOne' : 'canvas.rawMany', { n: rawCount })} {t('canvas.rawHelp')}
          </div>
        )}
        {pages.map((_page, index) => (
          <PageSurface
            key={index}
            index={index}
            elements={showHeader ? elements.filter(el => pageOf(el) === index) : elements}
            zoom={zoom}
            gridStep={gridStep}
            groupOffset={groupOffset}
            showHeader={showHeader}
            dragPos={dragPos && (showHeader ? dragPos.page === index : true) ? dragPos : null}
          />
        ))}
        {/* Room below the last page, so its bottom edge can be reached when the editor scrolls */}
        {showHeader && <div style={{ height: 24 }} />}
      </div>
    </DndContext>
  );
}
