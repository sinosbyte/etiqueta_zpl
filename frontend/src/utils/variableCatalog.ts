import { DesignElement } from '../types';
import { designVariables } from './unsaved';

export interface VariableInfo {
  name: string;
  /** Elements that use the variable, in layer order. */
  elementIds: string[];
  /** Other variables whose name differs only by upper/lower case (the SAP treats them as one). */
  clashesWith: string[];
}

/**
 * The {{variables}} a design uses, with where each one is used. Order: first use on the label.
 * Two names that differ only by case are flagged, because the SAP replaces markers without
 * telling upper from lower case (ZCLSB_ETIQ_IMPRESSAO), so they would receive the same value.
 */
export function variableCatalog(elements: DesignElement[]): VariableInfo[] {
  const byName = new Map<string, string[]>();
  for (const el of elements) {
    for (const name of designVariables([el])) {
      const ids = byName.get(name);
      if (ids) ids.push(el.id);
      else byName.set(name, [el.id]);
    }
  }

  const names = [...byName.keys()];
  return names.map(name => ({
    name,
    elementIds: byName.get(name)!,
    clashesWith: names.filter(other => other !== name && other.toLowerCase() === name.toLowerCase()),
  }));
}
