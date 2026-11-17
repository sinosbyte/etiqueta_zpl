import { DataRecord, DesignElement, PageConfig, PagesConfig } from '../types';

// Pages of a design, as the editor holds them. A design has one page, or two: the first printed once
// ('first'), the second ('repeat') as many times as the records left over need. What is saved with a
// design about its pages is a PagesConfig, and a design of one page without test records saves nothing
// (null), exactly as every design saved before pages existed.

export const MAX_PAGES = 2;

// The limits the backend checks on the test records
const MAX_RECORDS = 500;
const MAX_FIELDS = 200;
const MAX_VALUE = 255;
const FIELD_NAME = /^[A-Za-z0-9_]{1,60}$/;

/** The pages of a design that has not got a second one. */
export const singlePage = (): PageConfig[] => [{ mode: 'first' }];

/** The page an element is on; elements saved before pages existed are on the first. */
export const pageOf = (el: Pick<DesignElement, 'page'>): number => el.page ?? 0;

/** The first page is 'first' and the second one 'repeat': nothing else is allowed, and at most two pages. */
export function isValidPages(pages: PageConfig[]): boolean {
  return pages.length >= 1 && pages.length <= MAX_PAGES
    && pages[0].mode === 'first'
    && (pages.length < 2 || pages[1].mode === 'repeat');
}

/** The pages a saved design had: one when it has no configuration. */
export function pagesFromConfig(config: PagesConfig | null | undefined): PageConfig[] {
  if (!config || !isValidPages(config.pages)) return singlePage();
  return config.pages.map(p => ({ mode: p.mode }));
}

/** The test records a saved design had: none when it has no configuration. */
export function recordsFromConfig(config: PagesConfig | null | undefined): DataRecord[] {
  return (config?.records ?? []).map(r => ({ ...r }));
}

/**
 * The records worth saving: within the limits the backend accepts (500 records, 200 fields of a valid name,
 * values up to 255 characters).
 */
export function savableRecords(records: DataRecord[]): DataRecord[] {
  return records.slice(0, MAX_RECORDS).map(record => {
    const out: DataRecord = {};
    for (const [name, value] of Object.entries(record)) {
      if (Object.keys(out).length >= MAX_FIELDS) break;
      if (FIELD_NAME.test(name)) out[name] = String(value).slice(0, MAX_VALUE);
    }
    return out;
  });
}

/**
 * What is saved about the pages: null for a design of one page with no test records (the same as a design
 * saved before pages existed), otherwise the pages and, when there are any, the records.
 */
export function pagesConfigOf(pages: PageConfig[], records: DataRecord[]): PagesConfig | null {
  const saved = savableRecords(records);
  if (pages.length <= 1 && saved.length === 0) return null;
  return {
    pages: pages.map(p => ({ mode: p.mode })),
    ...(saved.length > 0 && { records: saved }),
  };
}

/** Whether the design needs the editor to keep its code as it is: more than one page, or a table. */
export const isStructured = (pages: PageConfig[], elements: DesignElement[]): boolean =>
  pages.length > 1 || elements.some(el => el.type === 'table');
