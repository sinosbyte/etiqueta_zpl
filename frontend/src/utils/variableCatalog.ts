import { DesignElement } from '../types';
import { designVariables } from './unsaved';
import { VariableConflict, variableConflicts } from './variableOrigin';

export interface VariableInfo {
  name: string;
  /** Elements that use the variable, in layer order. */
  elementIds: string[];
  /** Other variables whose name differs only by upper/lower case (the SAP treats them as one). */
  clashesWith: string[];
  /** The elements that write the marker themselves (not tables): `elementIds` also has the tables whose cells have the name. */
  freeElementIds: string[];
  /** Set when the name is also a cell of a table (see variableOrigin). */
  conflict?: VariableConflict;
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

  const byId = new Map(elements.map(e => [e.id, e] as const));
  const conflicts = new Map(variableConflicts(elements).map(c => [c.name.toUpperCase(), c] as const));
  const names = [...byName.keys()];
  return names.map(name => ({
    name,
    elementIds: byName.get(name)!,
    clashesWith: names.filter(other => other !== name && other.toLowerCase() === name.toLowerCase()),
    freeElementIds: byName.get(name)!.filter(id => byId.get(id)?.type !== 'table'),
    conflict: conflicts.get(name.toUpperCase()),
  }));
}
