import { Element } from './types';

// Limits and defaults of the table element. A table is not a ZPL command: the generator draws it
// with ^GB lines and ^FD cells, and these numbers decide where.
export const TABLE_MAX_COLUMNS = 12;
export const TABLE_MAX_CAPACITY = 50;        // records a table holds on one label
export const TABLE_MIN_ROW_HEIGHT = 8;
export const TABLE_MAX_ROW_HEIGHT = 2000;
export const TABLE_DEFAULT_ROW_HEIGHT = 40;
export const TABLE_DEFAULT_FONT_SIZE = 24;
export const TABLE_DEFAULT_BORDER = 2;
export const TABLE_DEFAULT_PADDING = 6;
export const TABLE_FIELD_PATTERN = /^[A-Za-z0-9_]{1,60}$/;

export interface TableGeometry {
  width: number;       // dots: the sum of the column widths
  height: number;      // dots: header row (if any) + capacity rows
  rowHeight: number;
  headerRow: boolean;
  capacity: number;    // records the table holds on one label
  colX: number[];      // left edge of each column, from the table's own left edge
  colW: number[];
}

const whole = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fallback;

/** Where everything of a table goes. Null when it has no column to draw. */
export function tableGeometry(el: Element): TableGeometry | null {
  const columns = el.columns ?? [];
  if (columns.length === 0) return null;

  const rowHeight = Math.max(1, whole(el.rowHeight, TABLE_DEFAULT_ROW_HEIGHT));
  const headerRow = el.headerRow ?? true;
  const capacity = Math.max(1, whole(el.rowsPerPage, 1));

  const colW = columns.map(c => Math.max(1, whole(c.width, 1)));
  const colX: number[] = [];
  let at = 0;
  for (const w of colW) {
    colX.push(at);
    at += w;
  }
  return {
    width: at,
    height: rowHeight * (capacity + (headerRow ? 1 : 0)),
    rowHeight,
    headerRow,
    capacity,
    colX,
    colW,
  };
}

/**
 * The {{variable}} a cell prints for the record in slot `slot` (1 = the first record of the label).
 * A table that holds one record keeps the plain field name; one that holds several numbers them
 * (MATERIAL_1, MATERIAL_2, ...), because a ZPL label cannot print the same name for two records.
 */
export function tableSlotName(field: string, slot: number, capacity: number): string {
  return capacity <= 1 ? field : `${field}_${slot}`;
}
