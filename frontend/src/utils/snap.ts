// Grid and magnetic snapping on the canvas, in printer dots.

export interface Box { x: number; y: number; width: number; height: number }

// A guide line drawn while an edge or centre lines up with another one
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

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

/**
 * Snaps the given positions (edges or centre of what is moving) along one axis.
 * Returns the shift to apply and the guides of every line it now touches.
 * Without a magnetic match, the first position snaps to the grid.
 */
function snapAxis(
  positions: number[], span: { from: number; to: number }, targets: Line[], axis: 'x' | 'y', opts: SnapOptions,
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
  return { shift, guides };
}

/** Snaps a move of the box by (dx, dy) dots: returns the snapped move and its guides. */
export function snapMove(
  box: Box, dx: number, dy: number, others: Box[], label: { width: number; height: number }, opts: SnapOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const x = box.x + dx;
  const y = box.y + dy;
  const sx = snapAxis([x, x + box.width / 2, x + box.width], { from: y, to: y + box.height },
    targetLines(others, label, 'x'), 'x', opts);
  const sy = snapAxis([y, y + box.height / 2, y + box.height], { from: x, to: x + box.width },
    targetLines(others, label, 'y'), 'y', opts);
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
