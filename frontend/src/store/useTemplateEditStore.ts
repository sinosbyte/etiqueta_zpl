import { create } from 'zustand';
import type { TemplateSummary } from '../utils/templatesClient';

/**
 * The template the Sinosbyte administrator is editing (Fase 06, etapa 3). The editor is theirs only for templates:
 * `template` is the one opened (saved back into it), or null for a new one (published as a new template). `active`
 * is false outside the template editor.
 */
interface TemplateEditState {
  active: boolean;
  template: TemplateSummary | null;
  start(template: TemplateSummary | null): void;
  /** After publishing a new template, the editor goes on editing that one */
  became(template: TemplateSummary): void;
  stop(): void;
}

export const useTemplateEditStore = create<TemplateEditState>(set => ({
  active: false,
  template: null,
  start: template => set({ active: true, template }),
  became: template => set({ template }),
  stop: () => set({ active: false, template: null }),
}));
