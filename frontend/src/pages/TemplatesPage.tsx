import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { toast } from '../store/useToastStore';
import {
  apiListTemplates, apiGetTemplate, apiCreateTemplate, apiReplaceTemplate, apiDeleteTemplate,
  TemplateSummary,
} from '../utils/templatesClient';
import { DOTS_PER_MM } from '../utils/units';
import { useT, MessageKey } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { TemplatePreview } from '../components/TemplatePreview';
import { confirmDiscardChanges } from '../hooks/useUnsavedChanges';
import { askConfirm } from '../store/useDialogStore';
import { PublishTemplateModal } from '../components/PublishTemplateModal';
import { CategoryFilter, TemplateCategory, TEMPLATE_CATEGORIES } from '../utils/templateCategories';

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
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [publishing, setPublishing] = useState(false);
  // The card whose label is being previewed (shown after a short pause over its name)
  const [hover, setHover] = useState<{ template: TemplateSummary; anchor: DOMRect } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

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
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const showPreview = (template: TemplateSummary, card: HTMLElement) => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover({ template, anchor: card.getBoundingClientRect() }), 200);
  };
  const hidePreview = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };

  // Tabs: all, then the categories that have templates (an administrator sees every one, to publish into it)
  const countOf = (c: CategoryFilter) => c === 'all' ? templates.length : templates.filter(x => x.category === c).length;
  const tabs: CategoryFilter[] = ['all', ...TEMPLATE_CATEGORIES.filter(c => canManage || countOf(c) > 0)];
  const visible = category === 'all' ? templates : templates.filter(x => x.category === category);
  // The open category emptied (e.g. its last template was deleted): back to all
  useEffect(() => { if (!tabs.includes(category)) setCategory('all'); }); // eslint-disable-line react-hooks/exhaustive-deps

  const use = async (template: TemplateSummary) => {
    if (!(await confirmDiscardChanges())) return;
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

  // The dialog preselects the open tab's category ("all" starts on outros, the default)
  const publish = async (name: string, description: string, cat: TemplateCategory) => {
    try {
      await apiCreateTemplate(name, description, current(), cat);
      toast.success(t('templates.published', { name }));
      setPublishing(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  const replace = async (template: TemplateSummary) => {
    const ok = await askConfirm({
      title: t('templates.replaceTitle'),
      message: t('templates.replaceConfirm', { name: template.name }),
      confirmLabel: t('templates.replace'),
    });
    if (!ok) return;
    try {
      await apiReplaceTemplate(template.id, current());
      toast.success(t('templates.replaced', { name: template.name }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.saveFailed'));
    }
  };

  const remove = async (template: TemplateSummary) => {
    const ok = await askConfirm({
      title: t('templates.deleteTitle'),
      message: t('templates.deleteConfirm', { name: template.name }),
      confirmLabel: t('dialog.delete'),
      danger: true,
    });
    if (!ok) return;
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
          <button onClick={() => setPublishing(true)} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} title={t('templates.publishTitle')}>
            {t('templates.publish')}
          </button>
        )}
        <LanguageSelect />
      </div>

      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <p style={{ fontSize: 12, color: 'var(--chrome-text-faint)', marginBottom: 16, maxWidth: 640, lineHeight: 1.6 }}>
          {t('templates.intro')}
        </p>

        {!loading && !error && templates.length > 0 && (
          <div role="tablist" className="chrome-scroll" style={{
            display: 'flex', gap: 2, marginBottom: 16, overflowX: 'auto', borderBottom: '1px solid var(--chrome-border)',
          }}>
            {tabs.map(c => {
              const active = c === category;
              return (
                <button
                  key={c}
                  role="tab"
                  aria-selected={active}
                  onClick={() => { hidePreview(); setCategory(c); }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    marginBottom: -1,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    color: active ? 'var(--chrome-text)' : 'var(--chrome-text-muted)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {t(`templates.cat.${c}` as MessageKey)}
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 999,
                    background: active ? 'var(--accent)' : 'var(--chrome-border)',
                    color: active ? '#fff' : 'var(--chrome-text-faint)',
                  }}>
                    {countOf(c)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {loading && <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)', textAlign: 'center', marginTop: 60 }}>{t('designs.loading')}</p>}
        {!loading && error && <p style={{ fontSize: 13, color: 'var(--status-error)', textAlign: 'center', marginTop: 60 }}>{error}</p>}
        {!loading && !error && templates.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 60, fontSize: 13, color: 'var(--chrome-text-faint)', lineHeight: 1.8 }}>
            <p>{t('templates.empty')}</p>
            <p>{canManage ? t('templates.emptyAdmin') : t('templates.emptyUser')}</p>
          </div>
        )}

        {!loading && !error && templates.length > 0 && visible.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--chrome-text-faint)', textAlign: 'center', marginTop: 40 }}>{t('templates.emptyCategory')}</p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {visible.map(template => (
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
              {/* Hovering the name and size shows the label; the buttons below are not affected */}
              <div
                onMouseEnter={e => showPreview(template, e.currentTarget.parentElement as HTMLElement)}
                onMouseLeave={hidePreview}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chrome-text)' }}>{template.name}</span>
                <span style={{ fontSize: 11, color: 'var(--chrome-text-faint)' }}>
                  {mm(template.labelWidth)} × {mm(template.labelHeight)} mm
                </span>
              </div>
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
                    <button
                      onClick={() => remove(template)}
                      className="chrome-btn chrome-btn-danger"
                      style={{ padding: '4px 8px' }}
                      title={t('templates.deleteTitle')}
                      aria-label={t('templates.deleteTitle')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" x2="10" y1="11" y2="17" />
                        <line x1="14" x2="14" y1="11" y2="17" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {hover && <TemplatePreview template={hover.template} anchor={hover.anchor} />}
      {publishing && (
        <PublishTemplateModal
          defaultCategory={category === 'all' ? 'outros' : category}
          onCancel={() => setPublishing(false)}
          onPublish={publish}
        />
      )}
    </div>
  );
}
