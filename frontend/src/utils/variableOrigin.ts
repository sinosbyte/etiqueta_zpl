import { DesignElement } from '../types';
import { designVariables } from './unsaved';
import { pageOf } from './pages';
import { TABLE_FIELD_PATTERN, tableColumns, tableSlotName } from './tableEdit';

// Where the {{variables}} of a design come from, and when two origins use the same name.
//
// A marker in the ZPL is only a name. These come from two places:
//  - FREE variables: written by the user in a text, a code or a dynamic field (anything that is not a table);
//  - CELLS of a table: the table prints CAMPO for each column when it holds one record, CAMPO_1 ... CAMPO_n when
//    it holds several (tableSlotName), and the simulation fills each with the record that falls on that place.
//
// When a free variable has the name of a cell of the table of the same page, the cell is printed and the value
// of the variable is not used (backend/src/zpl/pagination.ts: the cell comes first). The ZPL cannot tell them
// apart, so nothing is renamed or changed: this module only finds the cases, so that the editor says so, in
// the same terms as the backend (names are compared without telling upper from lower case).

export type ConflictSeverity =
  /** The same page has the cell and the free variable: the cell is printed, the value of the variable is not used. */
  | 'collision'
  /** The name is a cell on another page only: it is filled by the table there and by its own value on this one. */
  | 'ambiguous';

export interface VariableConflict {
  name: string;               // as the first free element writes it
  severity: ConflictSeverity;
  freeIds: string[];          // the elements (not tables) that write the marker, in layer order
  freePages: number[];        // the pages they are on
  tableIds: string[];         // the tables that have a cell of that name
  cellPages: number[];        // the pages of those tables
  collidingPages: number[];   // pages that have both: there the value of the variable is not used
  usedPages: number[];        // pages where the variable is filled with its own value (the free ones with no such cell)
}

/** A free variable that has the name of a data field of the tables (a column): it takes the field of the first record of each label. */
export interface FieldVariable {
  name: string;
  field: string;              // the column, as the table writes it
  freeIds: string[];
}

const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);

interface Analysis { conflicts: VariableConflict[]; fields: FieldVariable[] }

let cache: { elements: DesignElement[]; result: Analysis } | null = null;

function analyse(elements: DesignElement[]): Analysis {
  if (cache && cache.elements === elements) return cache.result;

  // Cells of every table: UPPER name -> the tables (and pages) that have it
  const cells = new Map<string, { tableId: string; page: number }[]>();
  const fields = new Map<string, string>();   // UPPER field -> the field as written
  for (const el of elements) {
    if (el.type !== 'table') continue;
    const capacity = Math.max(1, Math.round(el.rowsPerPage ?? 1));
    for (const c of tableColumns(el)) {
      if (!TABLE_FIELD_PATTERN.test(c.field)) continue;
      if (!fields.has(c.field.toUpperCase())) fields.set(c.field.toUpperCase(), c.field);
      for (let slot = 1; slot <= capacity; slot++) {
        const key = tableSlotName(c.field, slot, capacity).toUpperCase();
        const list = cells.get(key);
        const entry = { tableId: el.id, page: pageOf(el) };
        if (list) list.push(entry); else cells.set(key, [entry]);
      }
    }
  }

  // Free variables: UPPER name -> where they are written
  const free = new Map<string, { name: string; ids: string[]; pages: Set<number> }>();
  for (const el of elements) {
    if (el.type === 'table') continue;
    for (const name of designVariables([el])) {
      const key = name.toUpperCase();
      const found = free.get(key);
      if (found) { found.ids.push(el.id); found.pages.add(pageOf(el)); }
      else free.set(key, { name, ids: [el.id], pages: new Set([pageOf(el)]) });
    }
  }

  const conflicts: VariableConflict[] = [];
  const fieldVariables: FieldVariable[] = [];
  for (const [key, use] of free) {
    const owners = cells.get(key);
    if (owners) {
      const cellPages = new Set(owners.map(o => o.page));
      const colliding = new Set([...use.pages].filter(p => cellPages.has(p)));
      conflicts.push({
        name: use.name,
        severity: colliding.size > 0 ? 'collision' : 'ambiguous',
        freeIds: use.ids,
        freePages: sorted(use.pages),
        tableIds: [...new Set(owners.map(o => o.tableId))],
        cellPages: sorted(cellPages),
        collidingPages: sorted(colliding),
        usedPages: sorted(new Set([...use.pages].filter(p => !cellPages.has(p)))),
      });
    } else if (fields.has(key)) {
      fieldVariables.push({ name: use.name, field: fields.get(key)!, freeIds: use.ids });
    }
  }

  const result = { conflicts, fields: fieldVariables };
  cache = { elements, result };
  return result;
}

/** Free variables that share a name with a cell of a table. Empty when there is none. */
export const variableConflicts = (elements: DesignElement[]): VariableConflict[] => analyse(elements).conflicts;

/** Free variables named like a data field of a table (and not a cell): filled from the first record of each label. */
export const fieldVariables = (elements: DesignElement[]): FieldVariable[] => analyse(elements).fields;

/** The conflict of a name (without telling upper from lower case), if it has one. */
export const conflictOf = (elements: DesignElement[], name: string): VariableConflict | undefined =>
  analyse(elements).conflicts.find(c => c.name.toUpperCase() === name.toUpperCase());

/**
 * Whether the value of a free variable is used anywhere: not when every page that writes it also has the cell
 * of that name (the cell is printed there), so asking for a value would be asking for nothing.
 */
export const valueIsUsed = (conflict: VariableConflict | undefined): boolean => !conflict || conflict.usedPages.length > 0;

/** Conflicts the element takes part in as a free variable (a text, a code, a dynamic field...). */
export const conflictsOfElement = (elements: DesignElement[], id: string): VariableConflict[] =>
  analyse(elements).conflicts.filter(c => c.freeIds.includes(id));

/** Conflicts in which the table has the cell that the free variables share the name with. */
export const conflictsOfTable = (elements: DesignElement[], tableId: string): VariableConflict[] =>
  analyse(elements).conflicts.filter(c => c.tableIds.includes(tableId));

/** Pages as people count them (1, 2), for a message. */
export const pagesText = (pages: number[]): string => pages.map(p => p + 1).join(', ');
