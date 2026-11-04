import { create } from 'zustand';
import { en } from './en';
import { ptBR } from './pt-BR';

// Interface language only. The ZPL, the {{variable}} names and the text typed on a
// label never go through here, so what SAP receives does not depend on the language.
export type Lang = 'pt-BR' | 'en';
export type MessageKey = keyof typeof en;

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, 'pt-BR': ptBR };
const STORAGE_KEY = 'zpl-designer-lang';

export const LANGUAGES: { lang: Lang; label: string }[] = [
  { lang: 'pt-BR', label: 'Português' },
  { lang: 'en', label: 'English' },
];

// What the user chose before; otherwise English for an English browser, Portuguese for the rest
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'pt-BR' || saved === 'en') return saved;
  } catch { /* storage blocked: fall through */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'pt-BR';
}

// The page language tells the browser not to offer its own translation
function applyToPage(lang: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.setAttribute('translate', 'no');
}

interface LangState {
  lang: Lang;
  setLang(lang: Lang): void;
}

export const useLangStore = create<LangState>(set => ({
  lang: initialLang(),
  setLang(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not saved */ }
    applyToPage(lang);
    set({ lang });
  },
}));
applyToPage(useLangStore.getState().lang);

export type Params = Record<string, string | number>;

/** The message for the current language, with {name} replaced from params. */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const text = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text;
}

/** Outside React (toasts, store actions): the message in the language on screen now. */
export const t = (key: MessageKey, params?: Params): string => translate(useLangStore.getState().lang, key, params);

/** In a component: re-renders when the language changes. */
export function useT(): (key: MessageKey, params?: Params) => string {
  const lang = useLangStore(s => s.lang);
  return (key, params) => translate(lang, key, params);
}
