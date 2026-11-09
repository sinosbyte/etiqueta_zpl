import { useSyncExternalStore } from 'react';

// Each screen has its own address, so the browser's Back/Forward buttons and a page reload
// land where the user was. No router library: four screens, plain History API.
export type View = 'designer' | 'my-designs' | 'templates' | 'tokens';

const PATHS: Record<View, string> = {
  designer: '/',
  'my-designs': '/designs',
  templates: '/templates',
  tokens: '/integration',
};

const CHANGE_EVENT = 'zpl-navigate';

/** The screen an address belongs to; anything unknown is the editor. */
export function viewFromPath(path: string): View {
  const clean = path.replace(/\/+$/, '') || '/';
  const found = (Object.keys(PATHS) as View[]).find(v => PATHS[v] === clean);
  return found ?? 'designer';
}

export const pathOf = (view: View): string => PATHS[view];

const currentView = (): View => viewFromPath(window.location.pathname);

/** Opens a screen as a new history entry (so Back returns to the previous one). */
export function navigate(view: View): void {
  if (currentView() === view && window.location.pathname === PATHS[view]) return;
  window.history.pushState(null, '', PATHS[view]);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// An address that is not a screen (or has a trailing slash) is tidied up without adding a history entry
export function normalizeAddress(): void {
  const wanted = PATHS[currentView()];
  if (window.location.pathname !== wanted) {
    window.history.replaceState(null, '', wanted);
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The screen that is open now; re-renders when it changes (link, Back/Forward). */
export function useView(): View {
  return useSyncExternalStore(subscribe, currentView, () => 'designer');
}
