import { DesignElement } from '../types';
import { extractVariables } from './variables';

// What the editor holds for a design and what is saved with it: the elements, the
// label size and the sample values. The ZPL text is left out on purpose: it is
// derived from the elements, and a saved design keeps its stored ZPL until edited.

const MAX_NAME = 60;    // as in the backend's sample values check
const MAX_VALUE = 255;

/** {{variables}} a design uses: those in its elements, plus the name of dynamic fields. */
export function designVariables(elements: DesignElement[]): string[] {
  const names = new Set(extractVariables(JSON.stringify(elements)));
  for (const el of elements) if (el.dynamic && el.variableName) names.add(el.variableName);
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

/** A text that is the same exactly when the saved content of two editor states is the same. */
export function signatureOf(
  elements: DesignElement[], labelWidth: number, labelHeight: number, samples: Record<string, string>,
): string {
  return stable([elements, labelWidth, labelHeight, usedSamples(elements, samples)]);
}

/** The signature of an empty editor, as it opens. */
export const EMPTY_SIGNATURE = signatureOf([], 800, 1200, {});
