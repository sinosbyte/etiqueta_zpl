// "How it works" tab and first-access tutorial: the text (both languages), the address and the "seen" rule.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { HELP } from '../src/i18n/help';
import { viewFromPath, pathOf } from '../src/utils/navigation';
import { useTutorialStore, shouldAutoOpen, tutorialSeen } from '../src/store/useTutorialStore';

const KEY = 'zpl-designer-tutorial-seen';
const storage = new Map<string, string>();
let blocked = false;
(globalThis as any).localStorage = {
  getItem: (k: string) => { if (blocked) throw new Error('blocked'); return storage.has(k) ? storage.get(k)! : null; },
  setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

beforeEach(() => {
  storage.clear();
  blocked = false;
  useTutorialStore.setState({ open: false, step: 0 });
});

describe('the text', () => {
  const langs = ['pt-BR', 'en'] as const;

  test('both languages have the same sections, list sizes, questions and tutorial steps', () => {
    const shape = (l: typeof langs[number]) => ({
      sections: HELP[l].sections.map(s => [s.id, s.body.length, s.list?.length ?? 0]),
      faq: HELP[l].faq.length,
      steps: HELP[l].tutorial.map(s => s.icon),
    });
    expect(shape('en')).toEqual(shape('pt-BR'));
  });

  test('the tutorial has 5 steps, each with a title and a text', () => {
    for (const l of langs) {
      expect(HELP[l].tutorial).toHaveLength(5);
      for (const step of HELP[l].tutorial) {
        expect(step.title.trim().length).toBeGreaterThan(3);
        expect(step.text.trim().length).toBeGreaterThan(20);
      }
    }
  });

  test('section ids are unique and nothing is empty', () => {
    for (const l of langs) {
      const ids = HELP[l].sections.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(HELP[l].intro.length).toBeGreaterThan(40);
      for (const s of HELP[l].sections) {
        expect(s.title.trim()).not.toBe('');
        expect(s.body.length + (s.list?.length ?? 0)).toBeGreaterThan(0);
      }
      for (const f of HELP[l].faq) { expect(f.q.trim()).not.toBe(''); expect(f.a.trim()).not.toBe(''); }
    }
  });

  test('plain words: no printer-language or programmer terms reach the end user', () => {
    const everything = (l: typeof langs[number]) => JSON.stringify(HELP[l]);
    for (const l of langs) {
      const text = everything(l);
      for (const word of [/\bZPL\b/i, /\bAPI\b/i, /\btoken\b/i, /Labelary/i, /\bJSON\b/i, /\bspool\b/i, /\^[A-Z]{2}/, /\bbackend\b/i, /\bSQL\b/i]) {
        expect(text).not.toMatch(word);
      }
    }
  });

  test('the field example uses the double-brace form the editor reads', () => {
    expect(HELP['pt-BR'].tutorial[2].text).toContain('{{PRODUTO}}');
    expect(HELP.en.tutorial[2].text).toContain('{{PRODUCT}}');
  });
});

describe('the address', () => {
  test('/help is its own screen, with or without a trailing slash; unknown addresses stay on the editor', () => {
    expect(pathOf('help')).toBe('/help');
    expect(viewFromPath('/help')).toBe('help');
    expect(viewFromPath('/help/')).toBe('help');
    expect(viewFromPath('/')).toBe('designer');
    expect(viewFromPath('/ajuda')).toBe('designer');
    expect(viewFromPath('/designs')).toBe('my-designs');
    expect(viewFromPath('/templates')).toBe('templates');
    expect(viewFromPath('/integration')).toBe('tokens');
  });
});

describe('first access', () => {
  test('opens by itself only when signed in, in the editor, and not seen yet', () => {
    expect(shouldAutoOpen({ loggedIn: true, view: 'designer', seen: false })).toBe(true);
    expect(shouldAutoOpen({ loggedIn: false, view: 'designer', seen: false })).toBe(false);
    expect(shouldAutoOpen({ loggedIn: true, view: 'designer', seen: true })).toBe(false);
    for (const view of ['my-designs', 'templates', 'tokens', 'help'] as const) {
      expect(shouldAutoOpen({ loggedIn: true, view, seen: false })).toBe(false);
    }
  });

  test('opening it by itself counts as seen right away (a reload does not bring it back)', () => {
    expect(tutorialSeen()).toBe(false);
    useTutorialStore.getState().openFirstTime();
    expect(useTutorialStore.getState().open).toBe(true);
    expect(storage.get(KEY)).toBe('1');
    expect(tutorialSeen()).toBe(true);
    expect(shouldAutoOpen({ loggedIn: true, view: 'designer', seen: tutorialSeen() })).toBe(false);
  });

  test('a user who already saw it is not interrupted, but can open it again from "How it works"', () => {
    storage.set(KEY, '1');
    expect(shouldAutoOpen({ loggedIn: true, view: 'designer', seen: tutorialSeen() })).toBe(false);
    useTutorialStore.getState().openAgain();
    expect(useTutorialStore.getState()).toMatchObject({ open: true, step: 0 });
  });

  test('with the storage blocked it counts as seen, so it never shows on every visit', () => {
    blocked = true;
    expect(tutorialSeen()).toBe(true);
    expect(shouldAutoOpen({ loggedIn: true, view: 'designer', seen: tutorialSeen() })).toBe(false);
    expect(() => useTutorialStore.getState().openAgain()).not.toThrow();
    expect(useTutorialStore.getState().open).toBe(true);
  });
});

describe('the steps', () => {
  test('Next and Back stay inside the first and the last step', () => {
    const s = useTutorialStore.getState();
    s.openAgain();
    s.back();
    expect(useTutorialStore.getState().step).toBe(0);
    for (let i = 0; i < 9; i++) useTutorialStore.getState().next(5);
    expect(useTutorialStore.getState().step).toBe(4);
    useTutorialStore.getState().back();
    expect(useTutorialStore.getState().step).toBe(3);
  });

  test('closing starts over: opening again begins at step 1', () => {
    const s = useTutorialStore.getState();
    s.openAgain();
    s.next(5); s.next(5);
    s.close();
    expect(useTutorialStore.getState()).toMatchObject({ open: false, step: 0 });
    useTutorialStore.getState().openAgain();
    expect(useTutorialStore.getState().step).toBe(0);
  });
});
