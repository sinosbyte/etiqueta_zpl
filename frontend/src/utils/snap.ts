// Grid and magnetic snapping on the canvas, in printer dots.

export interface Box { x: number; y: number; width: number; height: number }

// A guide line drawn while an edge or centre lines up with another one: a line
// across `axis` at `at`, from..to along the other axis. A gap guide instead marks
// equal spacing: it spans the gap from..to along `axis`, at `at` across it.
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number; gap?: boolean }

export interface SnapOptions {
  grid: number | null;  // grid step in dots, or null when snapping to the grid is off
  magnet: boolean;      // snap to the edges and centres of other elements and of the label
  threshold: number;    // how close (in dots) an edge must come to snap
}

interface Line { at: number; from: number; to: number }

// Edges and centre of each box along one axis, with the extent across the other
// axis so a guide can be drawn from one box to the other
function targetLines(others: Box[], label: { width: number; height: number }, axis: 'x' | 'y'): Line[] {
  const lines: Line[] = [];
  const along = axis === 'x' ? label.width : label.height;
  const across = axis === 'x' ? label.height : label.width;
  for (const at of [0, along / 2, along]) lines.push({ at, from: 0, to: across });
  for (const b of others) {
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.width : b.height;
    const from = axis === 'x' ? b.y : b.x;
    const to = from + (axis === 'x' ? b.height : b.width);
    for (const at of [start, start + size / 2, start + size]) lines.push({ at, from, to });
  }
  return lines;
}

// A shift that would give the moving box the same spacing as other elements
interface Candidate { shift: number; guides: Guide[] }

// A box along one axis (start..end) and across it (crossStart..crossEnd)
interface Extent { start: number; end: number; crossStart: number; crossEnd: number }

function extent(b: Box, axis: 'x' | 'y'): Extent {
  return axis === 'x'
    ? { start: b.x, end: b.x + b.width, crossStart: b.y, crossEnd: b.y + b.height }
    : { start: b.y, end: b.y + b.height, crossStart: b.x, crossEnd: b.x + b.width };
}

// In the same row (or column): the boxes share part of their extent across the axis
const sideBySide = (a: Extent, b: Extent) => a.crossStart < b.crossEnd && b.crossStart < a.crossEnd;

// Marks the gap from a to b: across a row along its top edge, so the size shown
// above the marker clears the text; down a column in the middle of what they share
function gapGuide(a: Extent, b: Extent, axis: 'x' | 'y'): Guide {
  const top = Math.max(a.crossStart, b.crossStart);
  const at = axis === 'x' ? top : (top + Math.min(a.crossEnd, b.crossEnd)) / 2;
  return { axis, at, from: a.end, to: b.start, gap: true };
}

/**
 * Equal spacing: the gaps between neighbouring elements in a row (or column), and
 * the shifts that give the moving box the same gap to the element before or after
 * it, or that centre it between both.
 */
function spacingCandidates(box: Box, others: Box[], axis: 'x' | 'y'): Candidate[] {
  const spans = others.map(b => extent(b, axis));

  // Gap from each element to the nearest one after it in its row
  const gaps: { size: number; guide: Guide }[] = [];
  for (const a of spans) {
    let next: Extent | null = null;
    for (const b of spans) {
      if (b !== a && b.start >= a.end && sideBySide(a, b) && (!next || b.start < next.start)) next = b;
    }
    if (next && next.start - a.end >= 1) gaps.push({ size: next.start - a.end, guide: gapGuide(a, next, axis) });
  }

  // The moving box's neighbours in its row
  const m = extent(box, axis);
  const size = m.end - m.start;
  const middle = m.start + size / 2;
  let before: Extent | null = null;
  let after: Extent | null = null;
  for (const b of spans) {
    if (!sideBySide(m, b)) continue;
    if (b.start < m.start && b.end <= middle && (!before || b.end > before.end)) before = b;
    if (b.end > m.end && b.start >= middle && (!after || b.start < after.start)) after = b;
  }

  const moved = (shift: number): Extent => ({ ...m, start: m.start + shift, end: m.end + shift });
  const out: Candidate[] = [];
  for (const g of gaps) {
    if (before) {
      const shift = before.end + g.size - m.start;
      out.push({ shift, guides: [g.guide, gapGuide(before, moved(shift), axis)] });
    }
    if (after) {
      const shift = after.start - g.size - m.end;
      out.push({ shift, guides: [g.guide, gapGuide(moved(shift), after, axis)] });
    }
  }
  if (before && after && after.start - before.end > size) {
    const shift = (before.end + after.start - size) / 2 - m.start;
    out.push({ shift, guides: [gapGuide(before, moved(shift), axis), gapGuide(moved(shift), after, axis)] });
  }
  return out;
}

/**
 * Snaps the given positions (edges or centre of what is moving) along one axis,
 * or to one of the equal-spacing candidates, whichever is closest.
 * Returns the shift to apply and the guides of every line or spacing it now matches.
 * Without a magnetic match, the first position snaps to the grid.
 */
function snapAxis(
  positions: number[], span: { from: number; to: number }, targets: Line[], axis: 'x' | 'y', opts: SnapOptions,
  spacing: Candidate[] = [],
): { shift: number; guides: Guide[] } {
  let shift: number | null = null;
  if (opts.magnet) {
    let best = opts.threshold + 1;
    for (const p of positions) {
      for (const t of targets) {
        const d = t.at - p;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
    }
    for (const c of spacing) {
      if (Math.abs(c.shift) < Math.abs(best)) best = c.shift;
    }
    if (Math.abs(best) <= opts.threshold) shift = best;
  }
  if (shift === null) {
    shift = opts.grid ? Math.round(positions[0] / opts.grid) * opts.grid - positions[0] : 0;
    return { shift, guides: [] };
  }
  const guides: Guide[] = [];
  for (const p of positions) {
    for (const t of targets) {
      if (Math.abs(t.at - (p + shift)) > 0.5) continue;
      guides.push({ axis, at: t.at, from: Math.min(t.from, span.from), to: Math.max(t.to, span.to) });
    }
  }
  // Every equal spacing the shift lands on, each gap marked once (elements one
  // above the other in a column of rows share the same gap)
  const marked = new Set<string>();
  for (const c of spacing) {
    if (Math.abs(c.shift - shift) > 0.5) continue;
    for (const g of c.guides) {
      const key = `${Math.round(g.from)},${Math.round(g.to)}`;
      if (marked.has(key)) continue;
      marked.add(key);
      guides.push(g);
    }
  }
  return { shift, guides };
}

/** Snaps a move of the box by (dx, dy) dots: returns the snapped move and its guides. */
export function snapMove(
  box: Box, dx: number, dy: number, others: Box[], label: { width: number; height: number }, opts: SnapOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const x = box.x + dx;
  const y = box.y + dy;
  const moved = { ...box, x, y };
  const sx = snapAxis([x, x + box.width / 2, x + box.width], { from: y, to: y + box.height },
    targetLines(others, label, 'x'), 'x', opts, opts.magnet ? spacingCandidates(moved, others, 'x') : []);
  const sy = snapAxis([y, y + box.height / 2, y + box.height], { from: x, to: x + box.width },
    targetLines(others, label, 'y'), 'y', opts, opts.magnet ? spacingCandidates(moved, others, 'y') : []);
  return { dx: Math.round(dx + sx.shift), dy: Math.round(dy + sy.shift), guides: [...sx.guides, ...sy.guides] };
}

/**
 * Snaps the edges moved by a resize handle. `box` is the box being resized
 * (already following the pointer); `dir` holds the handle's sides (n, s, e, w).
 */
export function snapResize(
  box: Box, dir: string, others: Box[], label: { width: number; height: number }, opts: SnapOptions,
): { box: Box; guides: Guide[] } {
  const out = { ...box };
  const guides: Guide[] = [];
  const xs = targetLines(others, label, 'x');
  const ys = targetLines(others, label, 'y');
  if (dir.includes('e') || dir.includes('w')) {
    const edge = dir.includes('e') ? box.x + box.width : box.x;
    const s = snapAxis([edge], { from: box.y, to: box.y + box.height }, xs, 'x', opts);
    if (dir.includes('e')) out.width += s.shift;
    else { out.x += s.shift; out.width -= s.shift; }
    guides.push(...s.guides);
  }
  if (dir.includes('n') || dir.includes('s')) {
    const edge = dir.includes('s') ? box.y + box.height : box.y;
    const s = snapAxis([edge], { from: box.x, to: box.x + box.width }, ys, 'y', opts);
    if (dir.includes('s')) out.height += s.shift;
    else { out.y += s.shift; out.height -= s.shift; }
    guides.push(...s.guides);
  }
  return { box: out, guides };
}

// Smallest box holding all the given boxes
export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.width));
  const bottom = Math.max(...boxes.map(b => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Alt held while dragging turns snapping off
let altHeld = false;
if (typeof window !== 'undefined') {
  const track = (e: KeyboardEvent) => { altHeld = e.altKey; };
  window.addEventListener('keydown', track);
  window.addEventListener('keyup', track);
  window.addEventListener('blur', () => { altHeld = false; });
}
export const snappingSuspended = (): boolean => altHeld;

// How close an edge must come to snap: 6 screen pixels
export const SNAP_DISTANCE_PX = 6;

// Grid steps offered in the toolbar, in dots (8 dots = 1 mm)
export const GRID_STEPS = [
  { dots: 4, label: '0.5 mm' },
  { dots: 8, label: '1 mm' },
  { dots: 16, label: '2 mm' },
  { dots: 40, label: '5 mm' },
];
