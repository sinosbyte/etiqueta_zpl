import React, { useEffect } from 'react';
import { useT, useLangStore } from '../i18n';
import { HELP, TutorialIcon } from '../i18n/help';
import { useTutorialStore } from '../store/useTutorialStore';

const stroke = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

/** A simple drawing for each step, in the colours of the interface */
function StepIcon({ icon }: { icon: TutorialIcon }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      {icon === 'template' && (
        <g {...stroke}>
          <rect x="6" y="6" width="14" height="14" rx="2" />
          <rect x="24" y="6" width="14" height="14" rx="2" />
          <rect x="6" y="24" width="14" height="14" rx="2" />
          <rect x="24" y="24" width="14" height="14" rx="2" />
        </g>
      )}
      {icon === 'elements' && (
        <g {...stroke}>
          <rect x="6" y="8" width="32" height="28" rx="2" />
          <path d="M12 16h14M12 22h8" />
          <rect x="24" y="22" width="10" height="10" rx="1" />
        </g>
      )}
      {icon === 'variable' && (
        <g {...stroke}>
          <path d="M16 8c-4 0-5 2-5 5v3c0 2-1 3-3 3 2 0 3 1 3 3v3c0 3 1 5 5 5" />
          <path d="M28 8c4 0 5 2 5 5v3c0 2 1 3 3 3-2 0-3 1-3 3v3c0 3-1 5-5 5" />
          <path d="M19 22h6" />
        </g>
      )}
      {icon === 'preview' && (
        <g {...stroke}>
          <path d="M4 22s7-11 18-11 18 11 18 11-7 11-18 11S4 22 4 22z" />
          <circle cx="22" cy="22" r="5" />
        </g>
      )}
      {icon === 'save' && (
        <g {...stroke}>
          <path d="M8 8h22l6 6v22H8z" />
          <path d="M14 8v9h14V8M14 36V26h16v10" />
        </g>
      )}
    </svg>
  );
}

/** The first-access tutorial: one step at a time, with Back, Next and Skip. Mounted once, at the root of the app. */
export function TutorialDialog() {
  const t = useT();
  const lang = useLangStore(s => s.lang);
  const { open, step, close, next, back } = useTutorialStore();
  const steps = HELP[lang].tutorial;
  const last = step >= steps.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(steps.length); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, next, back, steps.length]);

  if (!open) return null;
  const current = steps[Math.min(step, steps.length - 1)];

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }} onClick={close} data-testid="tutorial">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        style={{ width: 440, maxWidth: 'calc(100vw - 32px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span className="panel-label" data-testid="tutorial-step">{t('tutorial.step', { n: step + 1, total: steps.length })}</span>
          <button type="button" onClick={close} aria-label={t('tutorial.close')} title={t('tutorial.close')} className="chrome-btn chrome-btn-ghost" style={{ padding: '2px 8px' }}>
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18, color: 'var(--chrome-text)' }}>
          <div style={{ color: 'var(--chrome-accent, #4f8cff)', flexShrink: 0 }}><StepIcon icon={current.icon} /></div>
          <div>
            <h2 id="tutorial-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{current.title}</h2>
            <p style={{ fontSize: 13, color: 'var(--chrome-text-muted)', lineHeight: 1.6 }}>{current.text}</p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 18 }} aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: i === step ? 'var(--chrome-text)' : 'var(--chrome-border)' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!last && (
            <button type="button" onClick={close} className="chrome-btn chrome-btn-ghost" data-testid="tutorial-skip">{t('tutorial.skip')}</button>
          )}
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button type="button" onClick={back} className="chrome-btn chrome-btn-ghost" data-testid="tutorial-back">{t('tutorial.back')}</button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => (last ? close() : next(steps.length))}
            className="chrome-btn chrome-btn-primary"
            data-testid="tutorial-next"
          >
            {last ? t('tutorial.done') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
