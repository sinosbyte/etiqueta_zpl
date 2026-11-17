import { DesignElement } from '../types';

// The size of a table on the label, from its columns, as the backend draws it (width = the columns
// together, height = a header row, if any, and a row for each record it holds). A table with no column
// yet gets a small box, so it can still be found and moved.
const ROW_HEIGHT = 40;
const FALLBACK = { width: 300, height: 80 };

export function tableBox(el: DesignElement): { width: number; height: number } {
  const columns = el.columns ?? [];
  if (columns.length === 0) return FALLBACK;
  const rowHeight = Math.max(1, Math.round(el.rowHeight ?? ROW_HEIGHT));
  const rows = Math.max(1, Math.round(el.rowsPerPage ?? 1)) + ((el.headerRow ?? true) ? 1 : 0);
  return {
    width: columns.reduce((sum, c) => sum + Math.max(1, Math.round(c.width)), 0),
    height: rowHeight * rows,
  };
}
