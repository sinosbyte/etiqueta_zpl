import { apiFetch, apiFetchBlob } from './apiClient';
import { DesignElement, ExpandResult, PageConfig } from '../types';

export interface GeneratePayload {
  labelWidth: number;
  labelHeight: number;
  elements: DesignElement[];
  pages?: PageConfig[];  // only for a design of more than one page
}

export interface ParseResult {
  labelWidth: number;
  labelHeight: number;
  elements: DesignElement[];
  unknownCommands: string[];
}

export async function generateZpl(payload: GeneratePayload, signal?: AbortSignal): Promise<string> {
  const data = await apiFetch<{ zpl: string }>('/api/generate-zpl', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
  return data.zpl;
}

export interface ExpandPayload extends GeneratePayload {
  values?: Record<string, string>;      // values of the {{variables}} that are not in a table
  records?: Record<string, string>[];   // the test records the tables print
}

/** The labels the design prints for these records: the backend works out which records go on which label. */
export async function expandZpl(payload: ExpandPayload, signal?: AbortSignal): Promise<ExpandResult> {
  return apiFetch<ExpandResult>('/api/expand-zpl', { method: 'POST', body: JSON.stringify(payload), signal });
}

export async function parseZpl(zpl: string, signal?: AbortSignal): Promise<ParseResult> {
  return apiFetch('/api/parse-zpl', {
    method: 'POST',
    body: JSON.stringify({ zpl }),
    signal,
  });
}

/** The PNG of one label, as a Blob (the caller decides what to do with it; see utils/labelRenderer.ts). */
export async function previewBlob(zpl: string, labelWidth: number, labelHeight: number, signal?: AbortSignal, bulk = false): Promise<Blob> {
  // A mass export says so, and the server serves the single previews of the users before it (labelary/gate.ts)
  return apiFetchBlob('/api/preview', {
    method: 'POST', body: JSON.stringify({ zpl, labelWidth, labelHeight }), signal,
    ...(bulk && { headers: { 'X-Render-Priority': 'bulk' } }),
  });
}

export async function previewZpl(zpl: string, labelWidth: number, labelHeight: number): Promise<string> {
  const blob = await apiFetchBlob('/api/preview', {
    method: 'POST',
    body: JSON.stringify({ zpl, labelWidth, labelHeight }),
  });
  return URL.createObjectURL(blob);
}

export type ExportFormat = 'png' | 'pdf' | 'epl' | 'zpl';

export async function exportZpl(
  zpl: string,
  labelWidth: number,
  labelHeight: number,
  format: ExportFormat,
): Promise<Blob> {
  return apiFetchBlob('/api/export', {
    method: 'POST',
    body: JSON.stringify({ zpl, labelWidth, labelHeight, format }),
  });
}
