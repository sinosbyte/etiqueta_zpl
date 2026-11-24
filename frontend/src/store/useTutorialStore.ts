import { create } from 'zustand';
import type { View } from '../utils/navigation';

// The first-access tutorial. "Seen" is remembered per browser (localStorage), which is simple and needs no server:
// on a new computer the tutorial shows once more. The tab "How it works" can open it again at any time.

const KEY = 'zpl-designer-tutorial-seen';

/** True when this browser already showed the tutorial. If the storage is blocked it counts as seen, so it never shows on every visit. */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  try { localStorage.setItem(KEY, '1'); } catch { /* not remembered */ }
}

/** The tutorial opens by itself only for someone signed in, in the editor, who has not seen it in this browser. */
export function shouldAutoOpen(s: { loggedIn: boolean; view: View; seen: boolean }): boolean {
  return s.loggedIn && s.view === 'designer' && !s.seen;
}

interface TutorialState {
  open: boolean;
  step: number;
  /** Opens it by itself (first access): it counts as seen right away, so a reload does not bring it back. */
  openFirstTime(): void;
  /** Opens it from "How it works": starts at the first step. */
  openAgain(): void;
  close(): void;
  next(total: number): void;
  back(): void;
}

export const useTutorialStore = create<TutorialState>(set => ({
  open: false,
  step: 0,
  openFirstTime() {
    markSeen();
    set({ open: true, step: 0 });
  },
  openAgain() {
    markSeen();
    set({ open: true, step: 0 });
  },
  close() {
    set({ open: false, step: 0 });
  },
  next(total) {
    set(s => ({ step: Math.min(s.step + 1, Math.max(0, total - 1)) }));
  },
  back() {
    set(s => ({ step: Math.max(0, s.step - 1) }));
  },
}));
