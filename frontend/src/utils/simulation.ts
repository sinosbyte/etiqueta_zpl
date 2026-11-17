import { DataRecord, DesignElement, ExpandResult, ExpandedLabel, PageConfig } from '../types';
import { savableRecords } from './pages';
import { usedSamples } from './unsaved';
import { ExpandPayload } from './zplClient';
import { pageOf } from './pages';
import { visibleRecords } from './tableEdit';

// The simulation: the editor sends the design and its test records to POST /api/expand-zpl and shows what comes
// back. Which record goes on which label is the backend's to say (backend/src/zpl/pagination.ts); nothing here
// works it out again, it only reads the answer.

export interface EditorState {
  elements: DesignElement[];
  labelWidth: number;
  labelHeight: number;
  sampleValues: Record<string, string>;
  pages: PageConfig[];
  records: DataRecord[];
}

/** The request for the current state of the editor. `pages` goes only with a second page, as when generating. */
export function expandPayload(s: EditorState): ExpandPayload {
  return {
    labelWidth: s.labelWidth,
    labelHeight: s.labelHeight,
    elements: s.elements,
    ...(s.pages.length > 1 && { pages: s.pages }),
    values: usedSamples(s.elements, s.sampleValues),
    records: savableRecords(s.records),
  };
}

/** What the canvas needs to draw one label of the simulation instead of the editing preview. */
export interface SimulationView {
  index: number;               // 1-based label
  total: number;               // labels of the simulation
  page: number;                // page of the design this label is
  records: DataRecord[];       // the records on this label, in order
  firstRecord: number;         // 1-based number of the first one (0 when the label has none)
}

/** The records a label holds, from the records that were sent. */
export function labelRecords(label: ExpandedLabel, sent: DataRecord[]): DataRecord[] {
  return sent.slice(label.recordStart, label.recordStart + label.recordCount);
}

export function viewOf(result: ExpandResult, sent: DataRecord[], index: number): SimulationView | null {
  const label = result.labels.find(l => l.index === index);
  if (!label) return null;
  return {
    index,
    total: result.labels.length,
    page: label.page,
    records: labelRecords(label, sent),
    firstRecord: label.recordCount > 0 ? label.recordStart + 1 : 0,
  };
}

/**
 * The records no label has room for. The backend counts them (`unplaced`); they are the last ones, because it
 * fills the labels in order and stops when there is no room left.
 */
export function unplacedRecords(result: ExpandResult, sent: DataRecord[]): DataRecord[] {
  if (result.unplaced <= 0) return [];
  return sent.slice(sent.length - result.unplaced);
}

/** 1-based number of the first record not placed (for listing them). */
export const firstUnplaced = (result: ExpandResult, sent: DataRecord[]): number => sent.length - result.unplaced + 1;

/** Page of the design (1 or 2) and the range of records of a label, for showing. */
export function labelSummary(label: ExpandedLabel): { page: number; from: number; to: number; count: number } {
  return { page: label.page + 1, from: label.recordStart + 1, to: label.recordStart + label.recordCount, count: label.recordCount };
}

/**
 * The records a table draws. While a label of the simulation is being viewed, a table on that label's page shows
 * the records the backend put on it (`simulated`: slots it leaves empty print empty), and the table of the other
 * page only its variables. Any other time it is the editing preview: the first records on page 1, and none on
 * page 2 (which records reach it is the simulation's to say).
 */
export function tableData(el: DesignElement, records: DataRecord[], view: SimulationView | null): { data: DataRecord[]; simulated: boolean } {
  if (view) {
    // A label is one page: the table of the other page is not on it, so it shows only its variables (no records
    // of the editing preview that would look as if they were on this label)
    return view.page === pageOf(el) ? { data: view.records, simulated: true } : { data: [], simulated: false };
  }
  return { data: visibleRecords(el, records), simulated: false };
}
