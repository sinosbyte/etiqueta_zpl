import { apiFetch } from './apiClient';
import { DataRecord } from '../types';

export interface VariantSummary {
  id: string;
  name: string;
  valueCount: number;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VariantDetail extends VariantSummary {
  sampleValues: Record<string, string>;
  records: DataRecord[];
}

export interface VariantData {
  sampleValues: Record<string, string>;
  records: DataRecord[];
}

const base = (designId: number) => `/api/designs/${designId}/variants`;

export const apiListVariants = (designId: number): Promise<{ items: VariantSummary[]; max: number }> =>
  apiFetch(base(designId));

export const apiGetVariant = (designId: number, id: string): Promise<VariantDetail> =>
  apiFetch(`${base(designId)}/${id}`);

export const apiCreateVariant = (designId: number, name: string, data: VariantData): Promise<VariantDetail> =>
  apiFetch(base(designId), { method: 'POST', body: JSON.stringify({ name, ...data }) });

export const apiUpdateVariantData = (designId: number, id: string, data: VariantData): Promise<VariantDetail> =>
  apiFetch(`${base(designId)}/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const apiRenameVariant = (designId: number, id: string, name: string): Promise<VariantDetail> =>
  apiFetch(`${base(designId)}/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });

export const apiDeleteVariant = (designId: number, id: string): Promise<void> =>
  apiFetch(`${base(designId)}/${id}`, { method: 'DELETE' });
