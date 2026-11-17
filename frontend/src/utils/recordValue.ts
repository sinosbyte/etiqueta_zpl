import { DataRecord } from '../types';

/** The value of a field in a record. The names are matched without telling upper from lower case, as the backend does. */
export function recordValue(record: DataRecord | undefined, field: string): string {
  if (!record) return '';
  if (field in record) return record[field];
  const upper = field.toUpperCase();
  const key = Object.keys(record).find(k => k.toUpperCase() === upper);
  return key !== undefined ? record[key] : '';
}
