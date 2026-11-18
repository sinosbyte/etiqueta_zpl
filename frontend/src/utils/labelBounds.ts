import { DesignElement } from '../types';
import { elementBox } from './zplText';
import { TABLE_DEFAULT_ROW_HEIGHT } from './tableEdit';

// Elements that run past the edge of the label. The printer prints nothing outside the label, so what is
// out is lost without any message. This only reports: it never moves an element.

// The box of a text or a variable code is an estimate (and positions are whole dots), so a dot of
// difference is not reported. Same margin as the Code 128 check (barcodeFit).
const TOLERANCE = 1;

export interface BoundsIssue {
  id: string;
  type: DesignElement['type'];
  // Dots of the element that are past each edge (0 = that edge is fine)
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Side = 'left' | 'top' | 'right' | 'bottom';

const past = (dots: number): number => (dots > TOLERANCE ? Math.ceil(dots) : 0);

/** Whether the element has a drawn box: comments and raw ZPL are kept but have no place on the label. */
const hasBox = (el: DesignElement): boolean => el.type !== 'comment' && el.type !== 'raw';

/** How far this element goes past the label, or null when it is inside. `samples` as the canvas shows them. */
export function boundsIssue(
  el: DesignElement, labelWidth: number, labelHeight: number, samples?: Record<string, string> | null,
): BoundsIssue | null {
  if (!hasBox(el)) return null;
  const box = elementBox(el, samples);
  const issue: BoundsIssue = {
    id: el.id,
    type: el.type,
    left: past(-el.x),
    top: past(-el.y),
    right: past(el.x + box.width - labelWidth),
    bottom: past(el.y + box.height - labelHeight),
  };
  return issue.left || issue.top || issue.right || issue.bottom ? issue : null;
}

/** The elements of the list that go past the label, in the order they are in. */
export function boundsIssues(
  elements: DesignElement[], labelWidth: number, labelHeight: number, samples?: Record<string, string> | null,
): BoundsIssue[] {
  const out: BoundsIssue[] = [];
  for (const el of elements) {
    const issue = boundsIssue(el, labelWidth, labelHeight, samples);
    if (issue) out.push(issue);
  }
  return out;
}

/** The sides an element goes past, with the dots. */
export const issueSides = (issue: BoundsIssue): { side: Side; dots: number }[] =>
  (['left', 'top', 'right', 'bottom'] as Side[])
    .filter(side => issue[side] > 0)
    .map(side => ({ side, dots: issue[side] }));

/**
 * Records a table can hold from its position down to the bottom of the label (never less than 0): the
 * rows that fit below its top, minus the header row. Tells the user how far to lower `rowsPerPage`.
 */
export function tableRowsThatFit(el: DesignElement, labelHeight: number): number {
  const rowHeight = Math.max(1, Math.round(el.rowHeight ?? TABLE_DEFAULT_ROW_HEIGHT));
  const rows = Math.floor((labelHeight - el.y) / rowHeight) - ((el.headerRow ?? true) ? 1 : 0);
  return Math.max(0, rows);
}
