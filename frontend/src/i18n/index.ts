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

// Messages the API sends in English (the SAP integration reads them as they are, so
// the backend is not translated): shown in the language on screen
const API_MESSAGES: Record<string, MessageKey> = {
  'Missing or invalid Authorization header': 'api.missingAuth',
  'Invalid or expired token': 'api.invalidToken',
  'Too many failed attempts, please try again later': 'api.tooManyFailed',
  'Too many attempts, please try again later': 'api.tooManyAttempts',
  'Too many refresh attempts, please try again later': 'api.tooManyRefresh',
  'Too many requests, please slow down': 'api.tooManyRequests',
  'Username already taken': 'api.usernameTaken',
  'Invalid username or password': 'api.badCredentials',
  'No refresh token': 'api.noRefreshToken',
  'Invalid or expired refresh token': 'api.invalidRefreshToken',
  'Design name already taken': 'api.designNameTaken',
  'Invalid pagination parameters': 'api.badPagination',
  'Invalid design ID': 'api.badDesignId',
  'Invalid version number': 'api.badVersion',
  'Design not found': 'api.designNotFound',
  'Version not found': 'api.versionNotFound',
  'Labelary API error': 'api.labelaryError',
  'Could not reach Labelary API': 'api.labelaryUnreachable',
};

/** The error text of an API response: known messages translated, validation objects as a generic text. */
export function apiMessage(error: unknown, fallback: MessageKey): string {
  if (typeof error !== 'string' || !error) return t(error ? 'api.invalidData' : fallback);
  const key = API_MESSAGES[error];
  return key ? t(key) : error;
}

/** Outside React (toasts, store actions): the message in the language on screen now. */
export const t = (key: MessageKey, params?: Params): string => translate(useLangStore.getState().lang, key, params);

/** In a component: re-renders when the language changes. */
export function useT(): (key: MessageKey, params?: Params) => string {
  const lang = useLangStore(s => s.lang);
  return (key, params) => translate(lang, key, params);
}
