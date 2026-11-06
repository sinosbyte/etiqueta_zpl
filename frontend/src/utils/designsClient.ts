import { apiFetch } from './apiClient';
import { DesignElement } from '../types';

export interface DesignSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
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
  createdAt: string;
}

export interface DesignPayload {
  zpl: string;
  elements: DesignElement[];
  labelWidth: number;
  labelHeight: number;
  /** Example value per {{variable}}; only the ones the design uses */
  sampleValues?: Record<string, string>;
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

export async function apiListDesigns(limit = 50, offset = 0): Promise<Paginated<DesignSummary>> {
  return apiFetch(`/api/designs?limit=${limit}&offset=${offset}`);
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
