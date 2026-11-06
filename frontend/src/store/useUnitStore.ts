import { create } from 'zustand';
import { useT } from '../i18n';
import { dotsToMm, mmToDots } from '../utils/units';

/** Unit of the measurement fields: millimetres or printer dots (1 mm = 8 dots). Only changes how numbers are shown and typed. */
export type Unit = 'mm' | 'dots';

const KEY = 'zpl-designer-unit';

const load = (): Unit => {
  try {
    return localStorage.getItem(KEY) === 'dots' ? 'dots' : 'mm';
  } catch {
    return 'mm';
  }
};

interface UnitStore {
  unit: Unit;
  setUnit(unit: Unit): void;
}

export const useUnitStore = create<UnitStore>(set => ({
  unit: load(),
  setUnit(unit) {
    try { localStorage.setItem(KEY, unit); } catch { /* the choice just is not remembered */ }
    set({ unit });
  },
}));

/** How a measurement field shows and reads values in the chosen unit. Elements are always stored in dots. */
export interface Measure {
  unit: Unit;
  /** Full name for field labels: "mm" or "pontos"/"dots". */
  label: string;
  /** Short name for the canvas: "mm" or "pt". */
  short: string;
  decimals: number;
  /** Arrow step (Shift = ten times). */
  step: number;
  /** Smallest size a field accepts. */
  min: number;
  /** Dots to the number shown in the field. */
  show(dots: number): number;
  /** The number typed in the field to dots. */
  read(value: number): number;
}

export function useMeasure(): Measure {
  const unit = useUnitStore(s => s.unit);
  const t = useT();
  return unit === 'dots'
    ? { unit, label: t('unit.dots'), short: 'pt', decimals: 0, step: 1, min: 1, show: d => Math.round(d), read: v => Math.round(v) }
    : { unit, label: 'mm', short: 'mm', decimals: 3, step: 0.5, min: 0.1, show: dotsToMm, read: mmToDots };
}
