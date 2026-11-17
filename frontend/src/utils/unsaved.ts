import { DataRecord, DesignElement, PageConfig, PagesConfig } from '../types';
import { extractVariables } from './variables';
import { pagesConfigOf } from './pages';
import { tableVariables } from './tableEdit';

// What the editor holds for a design and what is saved with it: the elements, the
// label size and the sample values. The ZPL text is left out on purpose: it is
// derived from the elements, and a saved design keeps its stored ZPL until edited.

const MAX_NAME = 60;    // as in the backend's sample values check
const MAX_VALUE = 255;

/** {{variables}} a design uses: those in its elements, plus the name of dynamic fields. */
export function designVariables(elements: DesignElement[]): string[] {
  const names = new Set(extractVariables(JSON.stringify(elements)));
  for (const el of elements) if (el.dynamic && el.variableName) names.add(el.variableName);
  // A table prints the variable of each column for each record it holds (the generator writes them into the ZPL)
  for (const el of elements) if (el.type === 'table') for (const n of tableVariables(el)) names.add(n);
  return [...names];
}

/**
 * The sample values worth saving with a design: only variables it uses, only those
 * that have a value, and within the limits the backend accepts.
 */
export function usedSamples(elements: DesignElement[], samples: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of designVariables(elements).sort()) {
    if (name.length <= MAX_NAME && samples[name]) out[name] = samples[name].slice(0, MAX_VALUE);
  }
  return out;
}

// JSON with sorted keys and no undefined, so equal content always gives the same text
// whatever order the fields were added in
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A text that is the same exactly when the saved content of two editor states is the same. The pages
 * (and the test records) count too; a design of one page with no records is `null`, as when it was saved
 * before pages existed, so its signature does not change.
 */
export function signatureOf(
  elements: DesignElement[], labelWidth: number, labelHeight: number, samples: Record<string, string>,
  pagesConfig: PagesConfig | null = null,
): string {
  const content: unknown[] = [elements, labelWidth, labelHeight, usedSamples(elements, samples)];
  if (pagesConfig) content.push(pagesConfig);
  return stable(content);
}

/** The signature of what the editor holds. */
export function editorSignature(s: {
  elements: DesignElement[]; labelWidth: number; labelHeight: number; sampleValues: Record<string, string>;
  pages: PageConfig[]; records: DataRecord[];
}): string {
  return signatureOf(s.elements, s.labelWidth, s.labelHeight, s.sampleValues, pagesConfigOf(s.pages, s.records));
}

/** The signature of an empty editor, as it opens. */
export const EMPTY_SIGNATURE = signatureOf([], 800, 1200, {});
