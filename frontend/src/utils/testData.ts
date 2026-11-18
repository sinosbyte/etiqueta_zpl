import { DataRecord, DesignElement } from '../types';
import { TABLE_FIELD_PATTERN, tableColumns } from './tableEdit';
import { recordValue } from './recordValue';
import { designVariables } from './unsaved';

export { recordValue };

// The test records of a design (pagesConfig.records) and what is done to them in the editor. All functions are
// pure: they return the new list of records (or null when the change is not allowed), never change their input,
// and keep every value they are not told to change. The limits are the backend's (RecordsSchema/ValuesSchema).

export const MAX_RECORDS = 500;
export const MAX_VALUE_LENGTH = 255;
export const MAX_ADD_AT_ONCE = 50;

/** The data fields the design asks for: the variable of every column of every table, in the order of the tables. */
export function dataFields(elements: DesignElement[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    if (el.type !== 'table') continue;
    for (const c of tableColumns(el)) {
      if (!TABLE_FIELD_PATTERN.test(c.field) || seen.has(c.field.toUpperCase())) continue;
      seen.add(c.field.toUpperCase());
      out.push(c.field);
    }
  }
  return out;
}

/**
 * Fields the records carry that no table asks for any more (a column was removed or renamed after the data was
 * typed). Their values are kept; the panel tells the user so, and only an explicit action removes them.
 */
export function orphanFields(records: DataRecord[], fields: string[]): string[] {
  const known = new Set(fields.map(f => f.toUpperCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      const u = k.toUpperCase();
      if (!known.has(u) && !seen.has(u)) { seen.add(u); out.push(k); }
    }
  }
  return out;
}

/** The records with the orphan fields taken out (an explicit action of the user). */
export function removeOrphans(records: DataRecord[], fields: string[]): DataRecord[] {
  const known = new Set(fields.map(f => f.toUpperCase()));
  return records.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => known.has(k.toUpperCase()))));
}

const blank = (fields: string[]): DataRecord => Object.fromEntries(fields.map(f => [f, '']));

/** `count` empty records at the end; null when that would pass the limit or there is no field to fill. */
export function addRecords(records: DataRecord[], fields: string[], count: number): DataRecord[] | null {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1 || fields.length === 0 || records.length + n > MAX_RECORDS) return null;
  return [...records, ...Array.from({ length: n }, () => blank(fields))];
}

/** One value changed. A value over the limit, or a row that does not exist, is refused (null). */
export function setCell(records: DataRecord[], row: number, field: string, value: string): DataRecord[] | null {
  if (row < 0 || row >= records.length || value.length > MAX_VALUE_LENGTH || !TABLE_FIELD_PATTERN.test(field)) return null;
  // Keep the key the record already has, whatever its case
  const key = Object.keys(records[row]).find(k => k.toUpperCase() === field.toUpperCase()) ?? field;
  if (records[row][key] === value) return records;
  return records.map((r, i) => (i === row ? { ...r, [key]: value } : r));
}

export function deleteRecord(records: DataRecord[], row: number): DataRecord[] | null {
  if (row < 0 || row >= records.length) return null;
  return records.filter((_, i) => i !== row);
}

/**
 * Records pasted from a spreadsheet (tab-separated, one record a line). A first line made only of names of the
 * fields is the header and says which column is which; otherwise the columns follow the order of the fields.
 * Returns the records read and how many lines were left out because they were past the limit.
 */
export function parsePaste(text: string, fields: string[], extra: string[] = []): { records: DataRecord[]; skipped: number; header: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0 || fields.length === 0) return { records: [], skipped: 0, header: false };
  const rows = lines.map(l => l.split('\t'));
  // A header may also name a variable that belongs to the label (see labelFields): it is accepted, but only when it is there
  const byName = new Map([...extra, ...fields].map(f => [f.toUpperCase(), f] as const));
  const first = rows[0].map(c => c.trim().toUpperCase());
  const header = first.length > 0 && first.every(c => byName.has(c)) && new Set(first).size === first.length;
  const order = header ? first.map(c => byName.get(c)!) : fields;
  const data = header ? rows.slice(1) : rows;
  const records = data.slice(0, MAX_RECORDS).map(cells => {
    const r = blank(fields);
    order.forEach((f, i) => { if (i < cells.length) r[f] = cells[i].slice(0, MAX_VALUE_LENGTH); });
    return r;
  });
  return { records, skipped: Math.max(0, data.length - MAX_RECORDS), header };
}

export type RecordIssue =
  | { kind: 'emptyRecord'; row: number }
  | { kind: 'emptyValues'; row: number; fields: string[] }
  | { kind: 'tooLong'; row: number; field: string }
  | { kind: 'control'; row: number; field: string };

/**
 * What is wrong with the test data, row by row. None of it stops the simulation: an empty value prints empty and
 * ^ or ~ become a space (the backend does that), but the user is told before they find it on the label.
 */
export function recordIssues(records: DataRecord[], fields: string[]): RecordIssue[] {
  const issues: RecordIssue[] = [];
  records.forEach((r, row) => {
    const empty = fields.filter(f => recordValue(r, f).trim() === '');
    if (fields.length > 0 && empty.length === fields.length) issues.push({ kind: 'emptyRecord', row });
    else if (empty.length > 0) issues.push({ kind: 'emptyValues', row, fields: empty });
    for (const f of fields) {
      const v = recordValue(r, f);
      if (v.length > MAX_VALUE_LENGTH) issues.push({ kind: 'tooLong', row, field: f });
      if (/[\^~]/.test(v)) issues.push({ kind: 'control', row, field: f });
    }
  });
  return issues;
}

// ---- Values per label: a volume number, a UC... The label takes them from its first record (the backend does that)

/** The {{variables}} of the design that are not cells of a table: the ones that can differ from label to label. */
export function labelVariables(elements: DesignElement[]): string[] {
  const tableNames = new Set(dataFields(elements).map(f => f.toUpperCase()));
  const tableSlots = new Set<string>();
  for (const e of elements) if (e.type === 'table') for (const c of tableColumns(e)) tableSlots.add(c.field.toUpperCase());
  return designVariables(elements.filter(e => e.type !== 'table'))
    .filter(n => TABLE_FIELD_PATTERN.test(n) && !tableNames.has(n.toUpperCase()) && !tableSlots.has(n.toUpperCase()))
    .sort((a, b) => a.localeCompare(b));
}

const hasKey = (records: DataRecord[], name: string): boolean => {
  const upper = name.toUpperCase();
  return records.some(r => Object.keys(r).some(k => k.toUpperCase() === upper));
};

/** The label variables the records already carry a column for. */
export function labelFields(elements: DesignElement[], records: DataRecord[]): string[] {
  return labelVariables(elements).filter(n => hasKey(records, n));
}

/** The label variables that could get a column but have none yet. */
export function candidateLabelFields(elements: DesignElement[], records: DataRecord[]): string[] {
  return labelVariables(elements).filter(n => !hasKey(records, n));
}

/** A new, empty column for every record (null when there is no record to hold it or the name is not valid). */
export function addLabelField(records: DataRecord[], name: string): DataRecord[] | null {
  if (records.length === 0 || !TABLE_FIELD_PATTERN.test(name) || hasKey(records, name)) return null;
  return records.map(r => ({ ...r, [name]: '' }));
}

/** Fields whose records, on one label, do not agree: the label uses the first record's value, and the user is told. */
export function labelValueConflicts(labelRecords: DataRecord[], names: string[]): string[] {
  if (labelRecords.length < 2) return [];
  return names.filter(n => new Set(labelRecords.map(r => recordValue(r, n)).filter(v => v !== '')).size > 1);
}
