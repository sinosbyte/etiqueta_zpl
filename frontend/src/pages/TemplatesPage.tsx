import React, { useCallback, useEffect, useState } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { toast } from '../store/useToastStore';
import {
  apiListTemplates, apiGetTemplate, apiCreateTemplate, apiReplaceTemplate, apiDeleteTemplate,
  TemplateSummary,
} from '../utils/templatesClient';
import { DOTS_PER_MM } from '../utils/units';
import { useT } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';

interface Props {
  onBack: () => void;
}

const mm = (dots: number) => parseFloat((dots / DOTS_PER_MM).toFixed(1)).toLocaleString();

export function TemplatesPage({ onBack }: Props) {
  const t = useT();
  const openTemplate = useDesignsStore(s => s.openTemplate);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { items, canManage } = await apiListTemplates();
      setTemplates(items);
      setCanManage(canManage);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('templates.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async (template: TemplateSummary) => {
    setBusyId(template.id);
    try {
      openTemplate(await apiGetTemplate(template.id));
      onBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.loadFailed'));
    } finally {
      setBusyId(null);
    }
  };

  // The label that is open in the editor, as a template payload
  const current = () => {
    const { zplCode, elements, labelWidth, labelHeight } = useDesignerStore.getState();
    return { zpl: zplCode, elements, labelWidth, labelHeight };
  };

  const publish = async () => {
    const name = window.prompt(t('templates.askName'))?.trim();
    if (!name) return;
    const description = window.prompt(t('templates.askDescription'))?.trim() ?? '';
    try {
      await apiCreateTemplate(name, description, current());
      toast.success(t('templates.published', { name }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  const replace = async (template: TemplateSummary) => {
    if (!window.confirm(t('templates.replaceConfirm', { name: template.name }))) return;
    try {
      await apiReplaceTemplate(template.id, current());
      toast.success(t('templates.replaced', { name: template.name }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  const remove = async (template: TemplateSummary) => {
    if (!window.confirm(t('templates.deleteConfirm', { name: template.name }))) return;
    try {
      await apiDeleteTemplate(template.id);
      toast.success(t('templates.deleted', { name: template.name }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--chrome-bg)' }}>
      <div style={{
        height: 44,
        background: 'var(--chrome-surface)',
        borderBottom: '1px solid var(--chrome-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        flexShrink: 0,
      }}>
        <button onClick={onBack} className="chrome-btn chrome-btn-ghost" style={{ gap: 6, fontSize: 12 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {t('designs.editor')}
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--chrome-border)' }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{t('sidebar.templates')}</span>
        <div style={{ flex: 1 }} />
        {canManage && (
          <button onClick={publish} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} title={t('templates.publishTitle')}>
            {t('templates.publish')}
          </button>
        )}
        <LanguageSelect />
      </div>

      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <p style={{ fontSize: 12, color: 'var(--chrome-text-faint)', marginBottom: 16, maxWidth: 640, lineHeight: 1.6 }}>
          {t('templates.intro')}
        </p>

        {loading && <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)', textAlign: 'center', marginTop: 60 }}>{t('designs.loading')}</p>}
        {!loading && error && <p style={{ fontSize: 13, color: 'var(--status-error)', textAlign: 'center', marginTop: 60 }}>{error}</p>}
        {!loading && !error && templates.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)', textAlign: 'center', marginTop: 60 }}>{t('templates.empty')}</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {templates.map(template => (
            <div
              key={template.id}
              style={{
                background: 'var(--chrome-surface)',
                border: '1px solid var(--chrome-border)',
                borderRadius: 8,
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)' }}>{template.name}</span>
              <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>
                {mm(template.labelWidth)} × {mm(template.labelHeight)} mm
              </span>
              {template.description && (
                <span style={{ fontSize: 12, color: 'var(--chrome-text-muted)', lineHeight: 1.5 }}>{template.description}</span>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 6 }}>
                <button
                  onClick={() => use(template)}
                  disabled={busyId === template.id}
                  className="chrome-btn chrome-btn-primary"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 12 }}
                >
                  {t('templates.use')}
                </button>
                {canManage && (
                  <>
                    <button onClick={() => replace(template)} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} title={t('templates.replaceTitle')}>
                      {t('templates.replace')}
                    </button>
                    <button onClick={() => remove(template)} className="chrome-btn chrome-btn-danger" style={{ fontSize: 12, padding: '4px 10px' }}>
                      {t('panel.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
