import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useTemplateEditStore } from '../store/useTemplateEditStore';
import { confirmDiscardChanges } from '../hooks/useUnsavedChanges';
import { navigate } from './navigation';
import {
  apiCreateTemplate, apiGetTemplate, apiListTemplates, apiReplaceTemplate, TemplateDetail, TemplateSummary,
} from './templatesClient';
import type { TemplateCategory } from './templateCategories';

// The template editor of the Sinosbyte administrators (Fase 06, etapa 3): the same editor, opened on a template (saved
// back into it) or on an empty label (published as a new template). They have no designs, so nothing here saves one.

/** The label open in the editor, as a template payload */
function current() {
  const { zplCode, elements, labelWidth, labelHeight } = useDesignerStore.getState();
  return { zpl: zplCode, elements, labelWidth, labelHeight };
}

/** A template is one page in this version */
export const onePage = (): boolean => useDesignerStore.getState().pages.length <= 1;

/** Opens a template in the editor to change it. False when the user kept the unsaved changes instead. */
export async function editTemplate(summary: TemplateSummary): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false;
  const detail = await apiGetTemplate(summary.id);
  useDesignsStore.getState().openTemplate(detail);
  useTemplateEditStore.getState().start(summary);
  navigate('designer');
  return true;
}

/** Opens an empty label (the default size) to make a new template. */
export async function newTemplate(): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false;
  const blank: TemplateDetail = {
    id: 0, name: '', description: '', category: 'outros', labelWidth: 800, labelHeight: 1200, updatedAt: '', zpl: '', elements: [],
  };
  useDesignsStore.getState().openTemplate(blank);
  useDesignerStore.getState().syncToCode();
  useTemplateEditStore.getState().start(null);
  navigate('designer');
  return true;
}

/** Saves the editor into the template being edited. */
export async function saveIntoTemplate(): Promise<void> {
  const { template } = useTemplateEditStore.getState();
  if (!template) throw new Error('NO_TEMPLATE');
  await apiReplaceTemplate(template.id, current());
  useDesignsStore.getState().markSaved();
}

/** Publishes the editor as a new template; from then on the editor edits that one. */
export async function publishAsNew(name: string, description: string, category: TemplateCategory): Promise<void> {
  const { id } = await apiCreateTemplate(name, description, current(), category);
  useDesignsStore.getState().markSaved();
  const created = (await apiListTemplates()).items.find(x => x.id === id);
  useTemplateEditStore.getState().became(created ?? {
    id, name, description, category, labelWidth: current().labelWidth, labelHeight: current().labelHeight, updatedAt: '',
  });
}

/** Back to the console (asking first when there are unsaved changes). */
export async function leaveTemplateEditor(): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false;
  useTemplateEditStore.getState().stop();
  navigate('platform');
  return true;
}
