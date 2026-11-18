import { generatePageZpl, pageCountOf } from './generator';
import { tableGeometry, tableSlotName } from './table';
import { Element, GenerateRequest } from './types';

/**
 * Pages and records. A design has one or two pages: the first is printed once ('first'), the
 * second ('repeat') as many times as the records left over need. A table on a page holds
 * `rowsPerPage` records on each label, so:
 *
 *  - the first label takes the first records that fit in the table of page 1 (none if page 1 has
 *    no table);
 *  - every repetition of page 2 takes the next records that fit in the table of page 2;
 *  - this goes on while records are left, in their original order.
 *
 * A label also takes the values of its first record for the variables that are not cells of its table (see expandLabels).
 */

/** A record: the value of each field (the `field` of a table column). */
export type DataRecord = Record<string, string>;

export interface ExpandRequest extends GenerateRequest {
  values?: Record<string, string>;  // the values of the {{variables}} that are not in a table
  records?: DataRecord[];           // the rows the tables print
}

export interface LabelPlan {
  page: number;   // 0 = page 1, 1 = page 2
  start: number;  // index of the first record of the label
  count: number;  // records on the label
}

export interface ExpandedLabel {
  index: number;         // 1-based, in print order
  page: number;          // 0 = page 1, 1 = page 2
  recordStart: number;   // index of the first record of the label
  recordCount: number;   // records on the label
  zpl: string;           // one label, with the values in place
}

export interface ExpandResult {
  labels: ExpandedLabel[];
  totalRecords: number;
  unplaced: number;      // records no label has room for; 0 unless the design cannot hold them all
  warnings: string[];
  zpl: string;           // every label, one after the other
}

/** Something about the design that keeps its labels from being worked out. */
export class ExpandError extends Error {}

/**
 * Which labels, and which records on each. `capacityFirst` is the records page 1 holds (0 without
 * a table), `capacityRepeat` the ones page 2 holds (0 without a table or without page 2).
 * The first label is always printed, whatever the number of records.
 */
export function planLabels(total: number, capacityFirst: number, hasRepeat: boolean, capacityRepeat: number): { plans: LabelPlan[]; unplaced: number } {
  const first = Math.min(Math.max(0, capacityFirst), total);
  const plans: LabelPlan[] = [{ page: 0, start: 0, count: first }];
  let next = first;
  if (hasRepeat && capacityRepeat > 0) {
    while (next < total) {
      const count = Math.min(capacityRepeat, total - next);
      plans.push({ page: 1, start: next, count });
      next += count;
    }
  }
  return { plans, unplaced: total - next };
}

const tablesOf = (elements: Element[], page: number): Element[] =>
  elements.filter(el => el.type === 'table' && (el.page ?? 0) === page);

const VARIABLE = /\{\{([A-Za-z0-9_]+)\}\}/g;

// ^ and ~ start ZPL commands, so a value cannot hold them (the printing side does the same)
const clean = (value: string): string => value.replace(/[\^~]/g, ' ');

/**
 * The labels the design prints for these records and values: page 1 once, then page 2 repeated.
 * A {{variable}} with no value stays as its name (as in the editor's preview); a cell of a table
 * with no record left prints empty.
 */
export function expandLabels(req: ExpandRequest): ExpandResult {
  const pageCount = pageCountOf(req);
  const hasRepeat = pageCount > 1;
  const records = req.records ?? [];
  const warnings: string[] = [];

  const tables = [0, 1].map(page => tablesOf(req.elements, page));
  tables.forEach((found, page) => {
    if (found.length > 1) throw new ExpandError(`Page ${page + 1} has more than one table (only one per page is supported)`);
  });
  const geometry = tables.map(found => (found[0] ? tableGeometry(found[0]) : null));

  const capacityFirst = geometry[0]?.capacity ?? 0;
  const capacityRepeat = hasRepeat ? geometry[1]?.capacity ?? 0 : 0;
  if (hasRepeat && capacityRepeat === 0) warnings.push('repeat-page-without-table');

  const { plans, unplaced } = planLabels(records.length, capacityFirst, hasRepeat, capacityRepeat);
  if (unplaced > 0) warnings.push('unplaced-records');

  const common = new Map(Object.entries(req.values ?? {}).map(([k, v]) => [k.toUpperCase(), v] as const));
  const upperKeys = (record: DataRecord): Map<string, string> =>
    new Map(Object.entries(record).map(([k, v]) => [k.toUpperCase(), v] as const));
  const templates = new Map<number, string>();

  const labels: ExpandedLabel[] = plans.map((plan, i) => {
    if (!templates.has(plan.page)) templates.set(plan.page, generatePageZpl(req, plan.page));

    // The cell variables of this label: slot 1 is its first record, and a slot past the last record is empty
    const slots = new Map<string, string>();
    const table = tables[plan.page][0];
    const g = geometry[plan.page];
    if (table && g) {
      for (let slot = 1; slot <= g.capacity; slot++) {
        const record = slot <= plan.count ? upperKeys(records[plan.start + slot - 1]) : null;
        for (const col of table.columns ?? []) {
          const value = record?.get(col.field.toUpperCase()) ?? '';
          slots.set(tableSlotName(col.field, slot, g.capacity).toUpperCase(), clean(value));
        }
      }
    }

    // Values that belong to the label as a whole (a volume number, a UC): those of its first record. A variable that
    // is not a cell of the table is looked up there before the values every label shares.
    const first = plan.count > 0 ? upperKeys(records[plan.start]) : null;

    const zpl = templates.get(plan.page)!.replace(VARIABLE, (_match, name: string) => {
      const key = name.toUpperCase();
      const cell = slots.get(key);
      if (cell !== undefined) return cell;
      const own = first?.get(key);
      if (own !== undefined && own !== '') return clean(own);   // an empty value is "not given": the shared one applies
      const value = common.get(key);
      return value !== undefined && value !== '' ? clean(value) : name;
    });
    return { index: i + 1, page: plan.page, recordStart: plan.start, recordCount: plan.count, zpl };
  });

  return {
    labels,
    totalRecords: records.length,
    unplaced,
    warnings,
    zpl: labels.map(l => l.zpl).join('\n'),
  };
}
