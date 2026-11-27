import { apiFetch } from './apiClient';
import { DesignElement, PagesConfig } from '../types';

export interface DesignSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  /** Who created it (in the list of designs; Etapa 4) */
  createdBy?: { id: number; username: string } | null;
}

export interface VersionSummary {
  id: number;
  versionNumber: number;
  createdAt: string;
}

export interface VersionDetail {
  id: number;
  versionNumber: number;
  zpl: string;
  elements: DesignElement[];
  labelWidth: number;
  labelHeight: number;
  sampleValues?: Record<string, string>;
  pagesConfig?: PagesConfig | null;  // null (or absent) = a design of one page
  createdAt: string;
}

export interface DesignPayload {
  zpl: string;
  elements: DesignElement[];
  labelWidth: number;
  labelHeight: number;
  /** Example value per {{variable}}; only the ones the design uses */
  sampleValues?: Record<string, string>;
  /** How the pages print and the test records of the tables; null = one page. Left out = the saved one stays. */
  pagesConfig?: PagesConfig | null;
}

/** A page of results plus the total count, mirroring the backend envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export async function apiCreateDesign(name: string, payload: DesignPayload): Promise<{ designId: number; versionId: number }> {
  return apiFetch('/api/designs', {
    method: 'POST',
    body: JSON.stringify({ name, ...payload }),
  });
}

export async function apiListDesigns(limit = 50, offset = 0, search = ''): Promise<Paginated<DesignSummary>> {
  const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
  return apiFetch(`/api/designs?limit=${limit}&offset=${offset}${q}`);
}

export async function apiGetDesign(id: number): Promise<DesignSummary> {
  return apiFetch(`/api/designs/${id}`);
}

export async function apiRenameDesign(id: number, name: string): Promise<DesignSummary> {
  return apiFetch(`/api/designs/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function apiDeleteDesign(id: number): Promise<void> {
  return apiFetch(`/api/designs/${id}`, { method: 'DELETE' });
}

export async function apiCreateVersion(designId: number, payload: DesignPayload): Promise<VersionDetail> {
  return apiFetch(`/api/designs/${designId}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiListVersions(designId: number, limit = 50, offset = 0): Promise<Paginated<VersionSummary>> {
  return apiFetch(`/api/designs/${designId}/versions?limit=${limit}&offset=${offset}`);
}

export async function apiGetVersion(designId: number, versionNumber: number): Promise<VersionDetail> {
  return apiFetch(`/api/designs/${designId}/versions/${versionNumber}`);
}

export async function apiUpdateVersion(
  designId: number,
  versionNumber: number,
  payload: DesignPayload,
): Promise<VersionDetail> {
  return apiFetch(`/api/designs/${designId}/versions/${versionNumber}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
