import React from 'react';
import { useT, useLangStore } from '../i18n';
import { HELP } from '../i18n/help';
import { LanguageSelect } from '../components/LanguageSelect';
import { useTutorialStore } from '../store/useTutorialStore';

interface Props {
  onBack: () => void;
}

/** "How it works": a page for the person who draws labels, in plain words (the text is in i18n/help.ts). */
export function HelpPage({ onBack }: Props) {
  const t = useT();
  const lang = useLangStore(s => s.lang);
  const openAgain = useTutorialStore(s => s.openAgain);
  const help = HELP[lang];

  const card: React.CSSProperties = {
    background: 'var(--chrome-surface)',
    border: '1px solid var(--chrome-border)',
    borderRadius: 8,
    padding: 16,
  };

  const goTo = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{t('sidebar.help')}</span>
        <div style={{ flex: 1 }} />
        <LanguageSelect />
      </div>

      <div className="chrome-scroll" style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <p style={{ flex: 1, minWidth: 260, fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.7 }}>{help.intro}</p>
            <button type="button" onClick={openAgain} className="chrome-btn chrome-btn-primary" style={{ fontSize: 12 }} data-testid="help-replay">
              {t('help.replay')}
            </button>
          </div>

          <nav aria-label={t('help.index')} style={card}>
            <span className="panel-label" style={{ display: 'block', marginBottom: 8 }}>{t('help.index')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {help.sections.map(s => (
                <button key={s.id} type="button" onClick={() => goTo(s.id)} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }}>
                  {s.title}
                </button>
              ))}
              <button type="button" onClick={() => goTo('faq')} className="chrome-btn chrome-btn-ghost" style={{ fontSize: 12 }}>
                {t('help.faq')}
              </button>
            </div>
          </nav>

          {help.sections.map(s => (
            <section key={s.id} id={`help-${s.id}`} style={{ ...card, scrollMarginTop: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 10 }}>{s.title}</h2>
              {s.body.map((p, i) => (
                <p key={i} style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.7, marginBottom: 8 }}>{p}</p>
              ))}
              {s.list && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {s.list.map(item => (
                    <li key={item.term} style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.6 }}>
                      <strong style={{ color: 'var(--chrome-text)', fontWeight: 600 }}>{item.term}.</strong> {item.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section id="help-faq" style={{ ...card, scrollMarginTop: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--chrome-text)', marginBottom: 10 }}>{t('help.faq')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {help.faq.map(item => (
                <details key={item.q} style={{ border: '1px solid var(--chrome-border)', borderRadius: 6, padding: '8px 12px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--chrome-text)' }}>{item.q}</summary>
                  <p style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.7, marginTop: 8 }}>{item.a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
