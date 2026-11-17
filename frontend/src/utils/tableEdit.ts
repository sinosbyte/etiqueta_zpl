import { DataRecord, DesignElement, TableColumn } from '../types';
import { layoutText } from './zplText';
import { pageOf } from './pages';
import { extractVariables } from './variables';
import { recordValue } from './recordValue';

// Everything the editor does to a table, as pure functions: each returns the patch to apply to the element
// (or null when the change is not allowed). The limits are the ones the backend validates (backend/src/zpl/table.ts
// and schema.ts), so what the editor produces is always accepted when saving.

export const TABLE_MAX_COLUMNS = 12;
export const TABLE_MAX_CAPACITY = 50;
export const TABLE_MIN_ROW_HEIGHT = 8;
export const TABLE_MAX_ROW_HEIGHT = 2000;
export const TABLE_MAX_PADDING = 100;
export const TABLE_MAX_COLUMN_WIDTH = 10_000;
export const TABLE_MAX_HEADER = 60;
export const TABLE_FIELD_PATTERN = /^[A-Za-z0-9_]{1,60}$/;
// The backend accepts a column of 1 dot; the editor does not go below this, so a column stays usable and clickable
export const TABLE_MIN_COLUMN_WIDTH = 16;

export const TABLE_DEFAULT_ROW_HEIGHT = 40;
export const TABLE_DEFAULT_FONT_SIZE = 24;
export const TABLE_DEFAULT_BORDER = 2;
export const TABLE_DEFAULT_PADDING = 6;

export type TableIssue =
  | { kind: 'noColumns' }
  | { kind: 'emptyField'; column: number }
  | { kind: 'duplicateField'; column: number; field: string }
  | { kind: 'caseClash'; column: number; field: string; other: string };

const whole = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

export const tableColumns = (el: DesignElement): TableColumn[] => el.columns ?? [];
export const columnsWidth = (columns: TableColumn[]): number => columns.reduce((sum, c) => sum + c.width, 0);

/** Total width of the table: its columns together. */
export const tableWidth = (el: DesignElement): number => columnsWidth(tableColumns(el));

/** The table already on a page (a page holds one). */
export function tableOnPage(elements: DesignElement[], page: number): DesignElement | undefined {
  return elements.find(e => e.type === 'table' && pageOf(e) === page);
}

/** The columns a new table starts with, scaled down to fit a label that is narrower than they are. */
export function defaultColumns(availableWidth: number): TableColumn[] {
  const base: TableColumn[] = [
    { header: 'Material', field: 'MATERIAL', width: 200, align: 'L' },
    { header: 'Descrição', field: 'DESCRICAO', width: 280, align: 'L' },
    { header: 'Qtd', field: 'QUANTIDADE', width: 120, align: 'R' },
  ];
  const total = columnsWidth(base);
  if (availableWidth >= total) return base;
  const width = Math.max(availableWidth, TABLE_MIN_COLUMN_WIDTH * base.length);
  return scaleColumns(base, width);
}

/** The fields a new table is created with: valid, inside the label, one record per label. */
export function newTableFields(labelWidth: number, x: number): Partial<DesignElement> {
  return {
    columns: defaultColumns(Math.max(0, labelWidth - x)),
    rowHeight: TABLE_DEFAULT_ROW_HEIGHT,
    headerRow: true,
    rowsPerPage: 1,
    cellPadding: TABLE_DEFAULT_PADDING,
    fontSize: TABLE_DEFAULT_FONT_SIZE,
  };
}

/**
 * The columns scaled so that they add up to exactly `total` dots, keeping their proportions (largest
 * remainder, so no dot is lost) and none under the minimum.
 */
export function scaleColumns(columns: TableColumn[], total: number): TableColumn[] {
  const n = columns.length;
  if (n === 0) return columns;
  const target = whole(total, TABLE_MIN_COLUMN_WIDTH * n, TABLE_MAX_COLUMN_WIDTH * n);
  const current = columnsWidth(columns) || n;
  const raw = columns.map(c => (Math.max(1, c.width) * target) / current);
  const widths = raw.map(w => Math.min(TABLE_MAX_COLUMN_WIDTH, Math.max(TABLE_MIN_COLUMN_WIDTH, Math.floor(w))));
  // Hand out what is left (or take back what the minimum added), one dot at a time, to the biggest remainders
  let diff = target - widths.reduce((a, b) => a + b, 0);
  const order = raw.map((w, i) => ({ i, rest: w - Math.floor(w) })).sort((a, b) => b.rest - a.rest).map(o => o.i);
  for (let k = 0; diff !== 0 && k < 10_000; k++) {
    const i = order[k % n];
    if (diff > 0 && widths[i] < TABLE_MAX_COLUMN_WIDTH) { widths[i]++; diff--; }
    else if (diff < 0 && widths[i] > TABLE_MIN_COLUMN_WIDTH) { widths[i]--; diff++; }
  }
  return columns.map((c, i) => ({ ...c, width: widths[i] }));
}

/** Change the total width (the table's own resize): the columns follow, in proportion. */
export function setTableWidth(el: DesignElement, total: number): Partial<DesignElement> | null {
  const columns = tableColumns(el);
  if (columns.length === 0 || !Number.isFinite(total)) return null;
  const next = scaleColumns(columns, total);
  return columnsWidth(next) === columnsWidth(columns) ? null : { columns: next };
}

/** Smallest total width the table can have (every column at its minimum). */
export const minTableWidth = (el: DesignElement): number => TABLE_MIN_COLUMN_WIDTH * Math.max(1, tableColumns(el).length);

/** A field name for a new column that no other column has: CAMPO, CAMPO_2, CAMPO_3... */
export function newFieldName(columns: TableColumn[]): string {
  const used = new Set(columns.map(c => c.field.toLowerCase()));
  if (!used.has('campo')) return 'CAMPO';
  for (let n = 2; ; n++) if (!used.has(`campo_${n}`)) return `CAMPO_${n}`;
}

export function addColumn(el: DesignElement): Partial<DesignElement> | null {
  const columns = tableColumns(el);
  if (columns.length >= TABLE_MAX_COLUMNS) return null;
  const column: TableColumn = { header: 'Coluna', field: newFieldName(columns), width: 120, align: 'L' };
  return { columns: [...columns, column] };
}

/** Removes a column; the last one cannot be removed (a table without columns draws nothing). */
export function removeColumn(el: DesignElement, index: number): Partial<DesignElement> | null {
  const columns = tableColumns(el);
  if (columns.length <= 1 || index < 0 || index >= columns.length) return null;
  return { columns: columns.filter((_, i) => i !== index) };
}

export function moveColumn(el: DesignElement, index: number, by: -1 | 1): Partial<DesignElement> | null {
  const columns = tableColumns(el);
  const to = index + by;
  if (index < 0 || index >= columns.length || to < 0 || to >= columns.length) return null;
  const next = [...columns];
  [next[index], next[to]] = [next[to], next[index]];
  return { columns: next };
}

export const sanitizeField = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60);

/** Change one column. A value the backend would refuse (empty or invalid variable, width out of range) returns null. */
export function updateColumn(el: DesignElement, index: number, patch: Partial<TableColumn>): Partial<DesignElement> | null {
  const columns = tableColumns(el);
  const current = columns[index];
  if (!current) return null;
  const next: TableColumn = { ...current, ...patch };
  if (!TABLE_FIELD_PATTERN.test(next.field)) return null;
  if (!Number.isInteger(next.width) || next.width < TABLE_MIN_COLUMN_WIDTH || next.width > TABLE_MAX_COLUMN_WIDTH) return null;
  if (next.header.length > TABLE_MAX_HEADER) return null;
  if (!['L', 'C', 'R'].includes(next.align)) return null;
  return { columns: columns.map((c, i) => (i === index ? next : c)) };
}

/**
 * What dragging a handle of the table does: the width goes to the columns (in proportion) and the height to the
 * rows (all the same height). The columns stay valid, so the table never ends up with a zero or negative column.
 */
export function resizeTablePatch(el: DesignElement, width: number, height: number): Partial<DesignElement> {
  const patch: Partial<DesignElement> = { ...(setTableWidth(el, width) ?? {}) };
  const rows = Math.max(1, Math.round(el.rowsPerPage ?? 1)) + ((el.headerRow ?? true) ? 1 : 0);
  const rowHeight = whole(height / rows, TABLE_MIN_ROW_HEIGHT, TABLE_MAX_ROW_HEIGHT);
  if (rowHeight !== Math.round(el.rowHeight ?? TABLE_DEFAULT_ROW_HEIGHT)) patch.rowHeight = rowHeight;
  return patch;
}

/** Whole-number properties, clamped to the backend's range. */
export const rowHeightPatch = (v: number): Partial<DesignElement> => ({ rowHeight: whole(v, TABLE_MIN_ROW_HEIGHT, TABLE_MAX_ROW_HEIGHT) });
export const rowsPerPagePatch = (v: number): Partial<DesignElement> => ({ rowsPerPage: whole(v, 1, TABLE_MAX_CAPACITY) });
export const cellPaddingPatch = (v: number): Partial<DesignElement> => ({ cellPadding: whole(v, 0, TABLE_MAX_PADDING) });
/** The font changes in height only: the ^A width follows it (as for any text). */
export const fontSizePatch = (v: number): Partial<DesignElement> => ({ fontSize: whole(v, 1, 999), fontWidth: undefined });
export const headerRowPatch = (on: boolean): Partial<DesignElement> => ({ headerRow: on });

/** Borders on or off: the line thickness is 0 when off. */
export const hasBorders = (el: DesignElement): boolean => (el.thickness ?? TABLE_DEFAULT_BORDER) > 0;
export const bordersPatch = (on: boolean): Partial<DesignElement> => ({ thickness: on ? TABLE_DEFAULT_BORDER : 0 });

/** Problems of the configuration, for the panel. None of them stops the table from being saved. */
export function tableIssues(el: DesignElement): TableIssue[] {
  const columns = tableColumns(el);
  if (columns.length === 0) return [{ kind: 'noColumns' }];
  const issues: TableIssue[] = [];
  columns.forEach((c, i) => {
    if (!TABLE_FIELD_PATTERN.test(c.field)) { issues.push({ kind: 'emptyField', column: i }); return; }
    const earlier = columns.slice(0, i);
    if (earlier.some(o => o.field === c.field)) issues.push({ kind: 'duplicateField', column: i, field: c.field });
    else {
      const other = earlier.find(o => o.field.toLowerCase() === c.field.toLowerCase());
      if (other) issues.push({ kind: 'caseClash', column: i, field: c.field, other: other.field });
    }
  });
  return issues;
}

/**
 * The {{variable}} a cell prints for the record in slot `slot` (1 = the first record of the label): the plain
 * field when the table holds one record, numbered (FIELD_1, FIELD_2...) when it holds several. Same rule as
 * the backend (tableSlotName in backend/src/zpl/table.ts), which writes it into the ZPL.
 */
export const tableSlotName = (field: string, slot: number, capacity: number): string =>
  capacity <= 1 ? field : `${field}_${slot}`;

/** Every {{variable}} a table prints: each column, for each record the table holds. */
export function tableVariables(el: DesignElement): string[] {
  const capacity = Math.max(1, Math.round(el.rowsPerPage ?? 1));
  const names: string[] = [];
  for (const c of tableColumns(el)) {
    if (!TABLE_FIELD_PATTERN.test(c.field)) continue;
    for (let slot = 1; slot <= capacity; slot++) names.push(tableSlotName(c.field, slot, capacity));
  }
  return names;
}

/**
 * The fields a column can take its data from, from the mechanism the design already has: the variables of the
 * other elements (the catalog), the fields of the test records, and the columns of the other table.
 */
export function availableFields(elements: DesignElement[], records: DataRecord[], except?: DesignElement): string[] {
  const names = new Set<string>();
  const others = elements.filter(e => e.type !== 'table');
  for (const n of extractVariables(JSON.stringify(others))) names.add(n);
  for (const e of others) if (e.dynamic && e.variableName) names.add(e.variableName);
  for (const r of records) for (const k of Object.keys(r)) names.add(k);
  for (const e of elements) if (e.type === 'table' && e !== except && e.id !== except?.id) for (const c of tableColumns(e)) names.add(c.field);
  return [...names].filter(n => TABLE_FIELD_PATTERN.test(n)).sort((a, b) => a.localeCompare(b));
}

// ---- What the canvas shows

export interface TableCell { column: number; text: string; header: boolean; }

/**
 * Test data a table shows in the editor, outside any simulation: the table of the first page takes the first
 * records that fit (that is what the first label prints). What reaches the second page depends on the records
 * left over, which only the backend works out (the simulation), so that table shows none here.
 */
export function visibleRecords(el: DesignElement, records: DataRecord[]): DataRecord[] {
  if (pageOf(el) !== 0) return [];
  const capacity = Math.max(1, Math.round(el.rowsPerPage ?? 1));
  return records.slice(0, capacity);
}

/** The records a table may have to print (for the width check): the first ones on page 1, any of them on page 2. */
const recordsToCheck = (el: DesignElement, records: DataRecord[]): DataRecord[] =>
  pageOf(el) === 0 ? visibleRecords(el, records) : records;

const cellFont = (el: DesignElement): DesignElement => ({
  ...el, type: 'text', block: undefined, orientation: undefined, origin: undefined,
  fontSize: el.fontSize ?? TABLE_DEFAULT_FONT_SIZE, fontWidth: el.fontWidth, fontName: el.fontName ?? '0',
});

/** Width in dots the text takes in the table's font. */
export function textWidth(el: DesignElement, text: string): number {
  return text === '' ? 0 : layoutText(cellFont(el), text).width;
}

export interface TableOverflow {
  column: number;       // index of the column
  where: 'header' | 'cell';
  text: string;
  needed: number;       // dots the text takes
  available: number;    // dots the column leaves for text (its width minus the padding on both sides)
}

/**
 * Header titles and test values that do not fit in their column. The printer gives each cell a one-line
 * block, so text wider than the column is cut or runs into the next one. One entry per column and kind
 * (the widest value). Nothing is changed: it is only reported.
 */
export function tableOverflows(el: DesignElement, records: DataRecord[]): TableOverflow[] {
  const columns = tableColumns(el);
  const padding = Math.max(0, Math.round(el.cellPadding ?? TABLE_DEFAULT_PADDING));
  const out: TableOverflow[] = [];
  columns.forEach((c, column) => {
    const available = Math.max(1, c.width - 2 * padding);
    if (el.headerRow ?? true) {
      const needed = textWidth(el, c.header);
      if (needed > available) out.push({ column, where: 'header', text: c.header, needed: Math.ceil(needed), available });
    }
    let widest: TableOverflow | null = null;
    for (const record of recordsToCheck(el, records)) {
      const text = recordValue(record, c.field);
      const needed = textWidth(el, text);
      if (needed > available && (!widest || needed > widest.needed)) widest = { column, where: 'cell', text, needed: Math.ceil(needed), available };
    }
    if (widest) out.push(widest);
  });
  return out;
}
