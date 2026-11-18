import { DataRecord, DesignElement } from '../types';
import { savableRecords } from './pages';
import { dataFields, labelFields, orphanFields, valueRows } from './testData';
import { designVariables } from './unsaved';

// The limits the backend accepts for the values of a variant (the same as for the values saved with a design)
const NAME = /^[A-Za-z0-9_]{1,60}$/;
const MAX_VALUE = 255;
const MAX_VALUES = 200;
export const MAX_NAME_LENGTH = 100;

export interface TestData {
  sampleValues: Record<string, string>;
  records: DataRecord[];
}

/**
 * The test data of the editor as a variant keeps it: every value that was filled in (also those of variables the
 * design no longer uses: they are data of the user, not dropped), and the records as they are (all columns, empty
 * fields and order), within the limits the backend accepts.
 */
export function testDataOf(sampleValues: Record<string, string>, records: DataRecord[]): TestData {
  const values: Record<string, string> = {};
  for (const name of Object.keys(sampleValues).sort()) {
    if (Object.keys(values).length >= MAX_VALUES) break;
    const v = sampleValues[name];
    if (NAME.test(name) && v) values[name] = String(v).slice(0, MAX_VALUE);
  }
  return { sampleValues: values, records: savableRecords(records) };
}

// JSON with sorted keys, so equal data always gives the same text
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Equal exactly when the test data is equal (same values, same records in the same order). */
export function testDataSignature(sampleValues: Record<string, string>, records: DataRecord[]): string {
  return stable(testDataOf(sampleValues, records));
}

/** Whether there is anything filled in: a value or a record. */
export const hasTestData = (d: TestData): boolean => Object.keys(d.sampleValues).length > 0 || d.records.length > 0;

export type NameProblem = 'empty' | 'tooLong' | 'taken';

/** Why a name cannot be used for a variant: empty, too long, or the same as another (any case). */
export function nameProblem(name: string, others: { id: string; name: string }[], exceptId?: string): NameProblem | null {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.length > MAX_NAME_LENGTH) return 'tooLong';
  const lower = n.toLowerCase();
  if (others.some(o => o.id !== exceptId && o.name.trim().toLowerCase() === lower)) return 'taken';
  return null;
}

/** A name for a copy that is not taken yet: "Name - copia", "Name - copia 2"... */
export function copyName(name: string, others: { name: string }[], suffix: string): string {
  const taken = new Set(others.map(o => o.name.trim().toLowerCase()));
  const first = `${name} - ${suffix}`;
  if (!taken.has(first.toLowerCase())) return first.slice(0, MAX_NAME_LENGTH);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} - ${suffix} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, MAX_NAME_LENGTH);
  }
  return first.slice(0, MAX_NAME_LENGTH);
}

export interface Compatibility {
  /** Values of variables the design does not use (now): kept in the variant, not shown on the label */
  unusedValues: string[];
  /** Variables of the design (outside the tables) the variant has no value for: left empty */
  missingValues: string[];
  /** Columns of the records that no table of the design has any more: kept, shown as such */
  unknownColumns: string[];
  /** Columns of the tables the records do not have: they print empty */
  missingColumns: string[];
  /** Values the variant has for variables that a table fills everywhere they are written: they are not used */
  ignoredValues: string[];
}

/**
 * How well a variant fits the design as it is now, with nothing changed on either side: what the variant
 * has that the design no longer uses (kept), and what the design uses that the variant knows nothing of
 * (not filled in with a guess). Loading never changes the design; this only says what to expect.
 */
export function compatibility(elements: DesignElement[], data: TestData): Compatibility {
  const used = new Set(designVariables(elements).map(n => n.toUpperCase()));
  const has = new Set(Object.keys(data.sampleValues).map(n => n.toUpperCase()));
  const tableFields = dataFields(elements);
  const perLabel = labelFields(elements, data.records);
  const present = new Set<string>();
  for (const r of data.records) for (const k of Object.keys(r)) present.add(k.toUpperCase());
  const perLabelUpper = new Set(perLabel.map(n => n.toUpperCase()));
  // A variable that is a per-label column of the records has its values there, not among the values
  const rows = valueRows(elements);
  const valueNames = rows.filter(r => r.inputOffered).map(r => r.name).filter(n => !perLabelUpper.has(n.toUpperCase()));
  const noInput = new Set(rows.filter(r => r.conflict && !r.inputOffered).map(r => r.name.toUpperCase()));

  return {
    unusedValues: Object.keys(data.sampleValues).filter(n => !used.has(n.toUpperCase())),
    missingValues: valueNames.filter(n => !has.has(n.toUpperCase())),
    unknownColumns: orphanFields(data.records, [...tableFields, ...perLabel]),
    missingColumns: data.records.length === 0 ? [] : tableFields.filter(f => !present.has(f.toUpperCase())),
    ignoredValues: Object.keys(data.sampleValues).filter(n => noInput.has(n.toUpperCase())),
  };
}

export const isCompatible = (c: Compatibility): boolean =>
  c.unusedValues.length === 0 && c.missingValues.length === 0 && c.unknownColumns.length === 0 && c.missingColumns.length === 0
  && c.ignoredValues.length === 0;
