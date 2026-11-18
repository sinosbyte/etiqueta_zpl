import { DesignElement } from '../types';
import { pageOf } from './pages';

// Moving and copying elements between the pages of a design. Everything here is plain functions: the store
// applies the result in one change (so undo takes it back in one step) and the screen tells the user.

export type TransferMode = 'move' | 'copy';

/** Why an element was left out: the page already has the table it would become, or it is already there. */
export type RefusalReason = 'tableOnDestination' | 'samePage';

export interface Refusal {
  element: DesignElement;
  reason: RefusalReason;
}

export interface TransferPlan {
  mode: TransferMode;
  target: number;
  /** The whole list of the design after the operation. The same list when nothing was transferred. */
  elements: DesignElement[];
  /** The elements now on the target page that the operation produced (the moved ones, or the new copies). */
  done: DesignElement[];
  refused: Refusal[];
}

/**
 * A copy that shares nothing with the original: every object and array inside it (the `block` of a text,
 * the `columns` of a table, anything a later version adds) is a new one. The elements are plain data (they
 * are saved as JSON), so structuredClone is exact; no property is listed, so none can be forgotten.
 */
export const cloneElement = (element: DesignElement): DesignElement => structuredClone(element);

/**
 * What moving or copying the elements `ids` to the page `target` does.
 *
 * - The position, the size and every property stay as they are: all the pages of a design have the size
 *   of the label, so the same x and y mean the same place on the other page. Nothing is moved to fit,
 *   and an element that is out of the label there is only reported by the label-limit warnings.
 * - Moved elements keep their id; copies get a new one (`makeId`, never one already in use).
 * - Those transferred end up on top of the target page, in the order they had among themselves.
 * - A page holds one table: a table is refused when the target page has one (or when an earlier element of
 *   the same operation became it). The other elements are transferred anyway.
 * - An element already on the target page is refused (moving it would change nothing, and a copy there is
 *   what Duplicate is for).
 */
export function planTransfer(
  elements: DesignElement[], ids: readonly string[], target: number, mode: TransferMode, makeId: () => string,
): TransferPlan {
  const wanted = new Set(ids);
  // In the order of the list, which is the order of the layers, whatever the order of the selection was
  const picked = elements.filter(el => wanted.has(el.id));

  let tableOnTarget = elements.some(el => el.type === 'table' && pageOf(el) === target);
  const refused: Refusal[] = [];
  const accepted: DesignElement[] = [];
  for (const el of picked) {
    if (pageOf(el) === target) { refused.push({ element: el, reason: 'samePage' }); continue; }
    if (el.type === 'table') {
      if (tableOnTarget) { refused.push({ element: el, reason: 'tableOnDestination' }); continue; }
      tableOnTarget = true;
    }
    accepted.push(el);
  }

  if (accepted.length === 0) return { mode, target, elements, done: [], refused };

  if (mode === 'move') {
    const moving = new Set(accepted.map(el => el.id));
    const moved = accepted.map(el => ({ ...el, page: target }));
    return { mode, target, elements: [...elements.filter(el => !moving.has(el.id)), ...moved], done: moved, refused };
  }

  const used = new Set(elements.map(el => el.id));
  const copies = accepted.map(el => {
    let id = makeId();
    while (used.has(id)) id = makeId();
    used.add(id);
    return { ...cloneElement(el), id, page: target };
  });
  return { mode, target, elements: [...elements, ...copies], done: copies, refused };
}
