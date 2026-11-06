import { apiFetch } from './apiClient';
import { DesignElement } from '../types';
import { DesignPayload } from './designsClient';
import { TemplateCategory } from './templateCategories';

export interface TemplateSummary {
  id: number;
  name: string;
  description: string;
  category: TemplateCategory;
  labelWidth: number;
  labelHeight: number;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  zpl: string;
  elements: DesignElement[];
}

export interface TemplateList {
  items: TemplateSummary[];
  /** True for Sinosbyte administrators, who may publish, replace and delete templates. */
  canManage: boolean;
}

export const apiListTemplates = (): Promise<TemplateList> => apiFetch('/api/templates');

export const apiGetTemplate = (id: number): Promise<TemplateDetail> => apiFetch(`/api/templates/${id}`);

export const apiCreateTemplate = (
  name: string, description: string, payload: DesignPayload, category?: TemplateCategory,
): Promise<{ id: number }> =>
  apiFetch('/api/templates', { method: 'POST', body: JSON.stringify({ name, description, category, ...payload }) });

export const apiReplaceTemplate = (id: number, payload: DesignPayload): Promise<{ id: number }> =>
  apiFetch(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ payload }) });

export const apiDeleteTemplate = (id: number): Promise<void> =>
  apiFetch(`/api/templates/${id}`, { method: 'DELETE' });
