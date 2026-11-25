import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDesignsStore } from '../store/useDesignsStore';
import { toast } from '../store/useToastStore';
import {
  apiListTemplates, apiGetTemplate, apiDeleteTemplate,
  TemplateSummary,
} from '../utils/templatesClient';
import { DOTS_PER_MM } from '../utils/units';
import { useT, MessageKey } from '../i18n';
import { LanguageSelect } from '../components/LanguageSelect';
import { TemplatePreview } from '../components/TemplatePreview';
import { confirmDiscardChanges } from '../hooks/useUnsavedChanges';
import { askConfirm } from '../store/useDialogStore';
import { TemplateThumb } from '../components/TemplateThumb';
import { TemplatePreviewModal } from '../components/TemplatePreviewModal';
import { CategoryFilter, TEMPLATE_CATEGORIES } from '../utils/templateCategories';
import { editTemplate, newTemplate } from '../utils/templateEditing';

interface Props {
  onBack: () => void;
  /** Inside the console of the Sinosbyte administrators (Fase 06): no page header of its own */
  embedded?: boolean;
}

const mm = (dots: number) => parseFloat((dots / DOTS_PER_MM).toFixed(1)).toLocaleString();

export function TemplatesPage({ onBack, embedded = false }: Props) {
  const t = useT();
  const openTemplate = useDesignsStore(s => s.openTemplate);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [category, setCategory] = useState<CategoryFilter>('all');
  // The template whose label is open in the large preview window
  const [viewing, setViewing] = useState<TemplateSummary | null>(null);
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

  // The Sinosbyte administrators (who manage templates) edit a template in the editor; everyone else uses a copy
  const edit = async (template: TemplateSummary) => {
    setViewing(null);
    setBusyId(template.id);
    try {
      await editTemplate(template);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.loadFailed'));
    } finally {
      setBusyId(null);
    }
  };
  const create = async () => {
    try { await newTemplate(); } catch (e) { toast.error(e instanceof Error ? e.message : t('templates.loadFailed')); }
  };

  const use = async (template: TemplateSummary) => {
    if (canManage) { await edit(template); return; }
    if (!(await confirmDiscardChanges())) return;
    setViewing(null);
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

  // Publishing and saving into a template happen in the template editor (TemplateEditBar, Fase 06)

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

  const newButton = (
    <button onClick={create} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} data-testid="templates-new" title={t('templates.newTitle')}>
      {t('templates.new')}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: embedded ? '100%' : '100vh', minHeight: 0, background: 'var(--chrome-bg)' }}>
      {embedded ? (
        canManage && <div style={{ padding: '12px 24px 0', display: 'flex', justifyContent: 'flex-end' }}>{newButton}</div>
      ) : (
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
        {canManage && newButton}
        <LanguageSelect />
      </div>
      )}

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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
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
              <TemplateThumb template={template} onOpen={() => { hidePreview(); setViewing(template); }} label={t('templates.viewTitle')} />
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
                  style={{ flex: 1, minWidth: 0, justifyContent: 'center', fontSize: 12 }}
                >
                  {canManage ? t('templates.edit') : t('templates.use')}
                </button>
                <button
                  onClick={() => { hidePreview(); setViewing(template); }}
                  className="chrome-btn chrome-btn-ghost"
                  style={{ padding: '4px 8px' }}
                  title={t('templates.viewTitle')}
                  aria-label={t('templates.viewTitle')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <>
                    <div style={{ flex: 1 }} />
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
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {hover && !viewing && <TemplatePreview template={hover.template} anchor={hover.anchor} />}
      {viewing && <TemplatePreviewModal template={viewing} onClose={() => setViewing(null)} onUse={() => use(viewing)} />}
    </div>
  );
}
