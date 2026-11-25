import React, { useState } from 'react';
import { useT } from '../i18n';
import { toast } from '../store/useToastStore';
import { askConfirm } from '../store/useDialogStore';
import { useTemplateEditStore } from '../store/useTemplateEditStore';
import { useIsDirty } from '../hooks/useUnsavedChanges';
import { useDesignerStore } from '../store/useDesignerStore';
import { PublishTemplateModal } from './PublishTemplateModal';
import { leaveTemplateEditor, publishAsNew, saveIntoTemplate } from '../utils/templateEditing';

/**
 * The editor of the Sinosbyte administrators edits templates only (Fase 06, etapa 3): which template is open, save into
 * it, publish as a new one, back to the console. Shown in the toolbar in place of "Save".
 */
export function TemplateEditBar() {
  const t = useT();
  const template = useTemplateEditStore(s => s.template);
  const dirty = useIsDirty();
  const multiPage = useDesignerStore(s => s.pages.length > 1);
  const [publishing, setPublishing] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!template) return;
    if (multiPage) { toast.error(t('templates.onePageOnly')); return; }
    const ok = await askConfirm({ title: t('templates.replaceTitle'), message: t('templates.replaceConfirm', { name: template.name }), confirmLabel: t('templateEdit.save') });
    if (!ok) return;
    setBusy(true);
    try {
      await saveIntoTemplate();
      toast.success(t('templates.replaced', { name: template.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    } finally { setBusy(false); }
  };

  const publish = async (name: string, description: string, category: Parameters<typeof publishAsNew>[2]) => {
    if (multiPage) { toast.error(t('templates.onePageOnly')); return; }
    try {
      await publishAsNew(name, description, category);
      toast.success(t('templates.published', { name }));
      setPublishing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-testid="template-edit-bar">
      <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-testid="template-edit-name">
        {template ? t('templateEdit.editing', { name: template.name }) : t('templateEdit.new')}
      </span>
      {template && (
        <button type="button" className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} onClick={() => void save()} disabled={busy || !dirty} data-testid="template-save">
          {t('templateEdit.save')}
        </button>
      )}
      <button type="button" className={template ? 'chrome-btn chrome-btn-ghost' : 'chrome-btn chrome-btn-primary'} style={{ fontSize: 12 }} onClick={() => setPublishing(true)} data-testid="template-publish-new">
        {t('templateEdit.publishNew')}
      </button>
      <button type="button" className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }} onClick={() => void leaveTemplateEditor()} data-testid="template-back">
        {t('templateEdit.back')}
      </button>
      {publishing && (
        <PublishTemplateModal
          defaultCategory={template?.category ?? 'outros'}
          onCancel={() => setPublishing(false)}
          onPublish={publish}
        />
      )}
    </div>
  );
}
