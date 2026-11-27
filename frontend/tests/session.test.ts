// Etapa 1 da evolução (27/11/2026): the editor's state does not outlive the session (E1) and opening a design,
// a version or a template starts the undo history afresh (E2).

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

// Tokens of these tests are "token-<userId>"; the session store only needs to know whose a token is
const auth = { token: null as string | null, next: 'token-1' };
jest.mock('../src/utils/authClient', () => ({
  API_BASE: '',
  getToken: () => auth.token,
  saveToken: (t: string) => { auth.token = t; },
  clearToken: () => { auth.token = null; },
  isTokenExpired: () => false,
  tokenUserId: (t: string | null) => (t && /^token-\d+$/.test(t) ? Number(t.slice(6)) : null),
  registerOn401Handler: (h: () => void) => { (globalThis as any).__on401 = h; },
  triggerOn401: () => (globalThis as any).__on401?.(),
  apiLogin: jest.fn(async () => auth.next),
  apiSignUp: jest.fn(async () => auth.next),
  apiLogout: jest.fn(async () => undefined),
  refreshAccessToken: jest.fn(async () => null),
}));

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => `ZPL(${payload.elements.length})`),
  parseZpl: jest.fn(async () => ({ labelWidth: 400, labelHeight: 300, elements: [{ id: 'parsed', type: 'rect', x: 1, y: 2, width: 3, height: 4 }], unknownCommands: [] })),
  previewBlob: jest.fn(),
  expandZpl: jest.fn(),
}));

const versions = new Map<string, any>();
jest.mock('../src/utils/designsClient', () => ({
  apiGetVersion: jest.fn(async (id: number, vn: number) => JSON.parse(JSON.stringify(versions.get(`${id}/${vn}`)))),
  apiListDesigns: jest.fn(async () => ({ items: [], total: 0, limit: 24, offset: 0 })),
  apiListVersions: jest.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
  apiCreateDesign: jest.fn(), apiCreateVersion: jest.fn(), apiUpdateVersion: jest.fn(), apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
}));

const answers: boolean[] = [];
const asked: any[] = [];
jest.mock('../src/store/useDialogStore', () => ({
  askConfirm: jest.fn(async (o: any) => { asked.push(o); return answers.length ? answers.shift() : true; }),
}));

(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useVariantsStore } from '../src/store/useVariantsStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { usePanelStore } from '../src/store/usePanelStore';
import { useTemplateEditStore } from '../src/store/useTemplateEditStore';
import { useAuthStore } from '../src/store/useAuthStore';
import { activeRenderer } from '../src/utils/labelRenderer';
import { resetEditorSession } from '../src/utils/editorSession';
import { requestLogout } from '../src/utils/logout';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { EMPTY_SIGNATURE } from '../src/utils/unsaved';
import { DesignElement } from '../src/types';

const designer = () => useDesignerStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const settle = () => jest.advanceTimersByTimeAsync(400);
const ids = () => designer().elements.map(e => e.id);
const rect = (id: string, x = 10): DesignElement => ({ id, type: 'rect', x, y: 20, width: 100, height: 50 });

const version = (elements: DesignElement[], extra: any = {}) => ({
  id: 1, versionNumber: 1, createdAt: 'now', zpl: '^XA^XZ', elements, labelWidth: 800, labelHeight: 600,
  sampleValues: { A: '1' }, pagesConfig: null, ...extra,
});
const template = (elements: DesignElement[]): any => ({ id: 9, name: 'T', zpl: '^XA^XZ', elements, labelWidth: 400, labelHeight: 300 });

// What a blank editor is, read once before any test touches the store
const blank = (({ labelWidth, labelHeight, elements, zplCode, pages, activePage, records, sampleValues, showSamples, selectedId, selectedIds, zoom, activeTab }) =>
  ({ labelWidth, labelHeight, elements, zplCode, pages, activePage, records, sampleValues, showSamples, selectedId, selectedIds, zoom, activeTab }))(useDesignerStore.getState());

beforeEach(async () => {
  jest.useFakeTimers();
  resetEditorSession();
  await settle();
  answers.length = 0;
  asked.length = 0;
  auth.token = null;
});
afterEach(() => { jest.useRealTimers(); });

/** Something being edited, with test data, a selection, history, a variant loaded, a preview and the panel open */
async function workInProgress() {
  versions.set('5/2', version([rect('a1'), rect('a2', 200)], { pagesConfig: { pages: [{ mode: 'first' }], records: [{ X: '1' }] } }));
  await useDesignsStore.getState().loadVersion(5, 2);
  designer().addElement('text');
  await settle();
  designer().selectElement('a1');
  useVariantsStore.setState({ designId: 5, items: [{ id: 'v', name: 'V' } as any], loadedId: 'v', loadedName: 'V', baseline: 'x' });
  useSimulationStore.setState({ status: 'ready', result: { labels: [], totalRecords: 0, unplaced: 0, warnings: [], zpl: '' } as any });
  usePanelStore.setState({ open: true, maximized: true });
  activeRenderer().cache.set('k', new Blob(['x']));
}

describe('E1: what a session leaves behind is cleared', () => {
  test('the reset leaves the editor as the app opens it, keeps the preferences and forgets the open design', async () => {
    useDesignerStore.setState({ snapToGrid: true, snapToElements: false, gridSize: 40 });
    await workInProgress();
    useTemplateEditStore.getState().start(null);
    expect(ids().length).toBe(3);
    expect(history().pastStates.length).toBeGreaterThan(0);

    resetEditorSession();
    await settle();

    const s = designer();
    expect({ labelWidth: s.labelWidth, labelHeight: s.labelHeight, elements: s.elements, zplCode: s.zplCode, pages: s.pages,
      activePage: s.activePage, records: s.records, sampleValues: s.sampleValues, showSamples: s.showSamples,
      selectedId: s.selectedId, selectedIds: s.selectedIds, zoom: s.zoom, activeTab: s.activeTab }).toEqual(blank);
    expect({ snapToGrid: s.snapToGrid, snapToElements: s.snapToElements, gridSize: s.gridSize }).toEqual({ snapToGrid: true, snapToElements: false, gridSize: 40 });
    expect(history().pastStates).toEqual([]);
    expect(history().futureStates).toEqual([]);
    expect(useDesignsStore.getState()).toMatchObject({ activeDesignId: null, activeVersionNumber: null, activeDesignName: '', designs: [], savedSignature: EMPTY_SIGNATURE });
    expect(useVariantsStore.getState()).toMatchObject({ designId: null, items: [], loadedId: null, baseline: null });
    expect(useSimulationStore.getState()).toMatchObject({ status: 'idle', result: null });
    expect(usePanelStore.getState()).toMatchObject({ open: false, maximized: false });
    expect(useTemplateEditStore.getState().active).toBe(false);
    expect(activeRenderer().cache.get('k')).toBeUndefined();
    expect(isDirtyNow()).toBe(false);
  });

  test('undo after the reset does nothing, and a ZPL still on its way does not come back', async () => {
    designer().addElement('rect');
    designer().onCodeChange('^XA^FO1,2^GB3,4,1^FS^XZ');   // parsed 600 ms later
    resetEditorSession();
    await jest.advanceTimersByTimeAsync(1000);
    expect(designer().elements).toEqual([]);
    history().undo();
    expect(designer().elements).toEqual([]);
  });

  test('signing out clears it; the next person starts blank', async () => {
    await useAuthStore.getState().login('a', 'x');
    await workInProgress();
    useAuthStore.getState().logout();
    await settle();
    expect(useAuthStore.getState().token).toBeNull();
    expect(designer().elements).toEqual([]);
    auth.next = 'token-2';
    await useAuthStore.getState().login('b', 'x');
    expect(designer().elements).toEqual([]);
    expect(useDesignsStore.getState().activeDesignId).toBeNull();
  });

  test('a session that expires keeps the work for the same person and clears it for anyone else', async () => {
    auth.next = 'token-1';
    await useAuthStore.getState().login('a', 'x');
    await workInProgress();
    (globalThis as any).__on401();                     // the session ended by itself
    expect(useAuthStore.getState().token).toBeNull();
    expect(ids().length).toBe(3);                      // nothing shown meanwhile: the sign-in page is open
    await useAuthStore.getState().login('a', 'x');     // the same person: goes on where they were
    expect(ids().length).toBe(3);
    expect(useDesignsStore.getState().activeDesignId).toBe(5);

    (globalThis as any).__on401();
    auth.next = 'token-2';
    await useAuthStore.getState().login('b', 'x');     // someone else: blank
    await settle();
    expect(designer().elements).toEqual([]);
    expect(useDesignsStore.getState().activeDesignId).toBeNull();
  });

  test('an expired session whose owner is unknown, then someone signing up, starts blank', async () => {
    await workInProgress();
    auth.token = 'unreadable';
    (globalThis as any).__on401();
    auth.next = 'token-7';
    await useAuthStore.getState().signUp({});
    expect(designer().elements).toEqual([]);
  });

  test('sign out with unsaved changes asks; cancelling keeps the session and the work', async () => {
    auth.next = 'token-1';
    await useAuthStore.getState().login('a', 'x');
    await workInProgress();
    expect(isDirtyNow()).toBe(true);
    answers.push(false);
    await requestLogout();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ danger: true });
    expect(useAuthStore.getState().token).toBe('token-1');
    expect(ids().length).toBe(3);

    answers.push(true);
    await requestLogout();
    expect(useAuthStore.getState().token).toBeNull();
    expect(designer().elements).toEqual([]);
  });

  test('sign out with nothing unsaved does not ask', async () => {
    await useAuthStore.getState().login('a', 'x');
    versions.set('5/1', version([rect('a1')]));
    await useDesignsStore.getState().loadVersion(5, 1);
    expect(isDirtyNow()).toBe(false);
    await requestLogout();
    expect(asked).toHaveLength(0);
    expect(useAuthStore.getState().token).toBeNull();
  });
});

describe('E2: opening something starts the history afresh', () => {
  test('opening a design: undo does not bring back what was in the editor before, even right after an edit', async () => {
    designer().addElement('rect');                     // a step still waiting out the 300 ms
    versions.set('1/1', version([rect('d1')]));
    await useDesignsStore.getState().loadVersion(1, 1);
    await settle();
    expect(ids()).toEqual(['d1']);
    expect(history().pastStates).toEqual([]);
    history().undo();
    expect(ids()).toEqual(['d1']);
    expect(useDesignsStore.getState().activeDesignId).toBe(1);
  });

  test('opening a template and another version: same', async () => {
    versions.set('1/1', version([rect('d1')]));
    await useDesignsStore.getState().loadVersion(1, 1);
    designer().addElement('rect');
    await settle();
    useDesignsStore.getState().openTemplate(template([rect('t1')]));
    await settle();
    history().undo();
    expect(ids()).toEqual(['t1']);

    versions.set('1/2', version([rect('d2')], { versionNumber: 2 }));
    designer().addElement('line');
    await settle();
    await useDesignsStore.getState().loadVersion(1, 2);
    await settle();
    history().undo();
    expect(ids()).toEqual(['d2']);
  });

  test('after opening, undo and redo work as before on the new content', async () => {
    versions.set('1/1', version([rect('d1')]));
    await useDesignsStore.getState().loadVersion(1, 1);
    designer().updateElement('d1', { x: 50 });
    await settle();
    designer().addElement('rect');
    await settle();
    expect(ids().length).toBe(2);
    history().undo();
    expect(ids()).toEqual(['d1']);
    expect(designer().elements[0].x).toBe(50);
    history().undo();
    expect(designer().elements[0].x).toBe(10);
    history().undo();                                  // nothing before the opening
    expect(designer().elements[0].x).toBe(10);
    history().redo();
    history().redo();
    expect(ids().length).toBe(2);
  });

  test('moving and copying between pages after opening are still one step each', async () => {
    versions.set('1/1', version([rect('d1')]));
    await useDesignsStore.getState().loadVersion(1, 1);
    designer().addPage();
    await settle();
    designer().selectElement('d1');
    designer().copySelectedToPage(1);
    designer().selectElement('d1');
    designer().moveSelectedToPage(1);
    await settle();
    expect(designer().elements.filter(e => e.page === 1).length).toBe(2);
    history().undo();
    expect(designer().elements.find(e => e.id === 'd1')?.page ?? 0).toBe(0);
    history().undo();
    expect(designer().elements.length).toBe(1);
    history().undo();                                  // the page added after opening
    expect(designer().pages.length).toBe(1);
    history().undo();                                  // and nothing of what was before the opening
    expect(ids()).toEqual(['d1']);
  });
});
