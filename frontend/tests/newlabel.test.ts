// Etapa 2 da evolução (27/11/2026): "Nova etiqueta" (a blank label of the same size, not linked to the open design)
// and the Save dialog opening on a new version when a design is open (E3).

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => null, saveToken: jest.fn(), triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => null) }));

jest.mock('../src/utils/zplClient', () => ({
  generateZpl: jest.fn(async (payload: any) => `ZPL(${payload.elements.length})`),
  parseZpl: jest.fn(),
  previewBlob: jest.fn(),
  expandZpl: jest.fn(),
}));

const calls: { fn: string; args: any[] }[] = [];
const versions = new Map<string, any>();
jest.mock('../src/utils/designsClient', () => ({
  apiGetVersion: jest.fn(async (id: number, vn: number) => JSON.parse(JSON.stringify(versions.get(`${id}/${vn}`)))),
  apiListDesigns: jest.fn(async () => ({ items: [{ id: 5, name: 'UC', latestVersion: 1 }], total: 1, limit: 24, offset: 0 })),
  apiListVersions: jest.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
  apiCreateDesign: jest.fn(async (name: string, payload: any) => { calls.push({ fn: 'create', args: [name, payload] }); return { designId: 9, versionId: 1 }; }),
  apiCreateVersion: jest.fn(async (id: number, payload: any) => { calls.push({ fn: 'version', args: [id, payload] }); return { versionNumber: 2 }; }),
  apiUpdateVersion: jest.fn(async (id: number, vn: number, payload: any) => { calls.push({ fn: 'put', args: [id, vn, payload] }); return {}; }),
  apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
}));

const answers: boolean[] = [];
const asked: any[] = [];
jest.mock('../src/store/useDialogStore', () => ({
  askConfirm: jest.fn(async (o: any) => { asked.push(o); return answers.length ? answers.shift() : true; }),
}));
jest.mock('../src/store/useToastStore', () => ({ toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() } }));

(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { useDesignerStore } from '../src/store/useDesignerStore';
import { useDesignsStore } from '../src/store/useDesignsStore';
import { useVariantsStore } from '../src/store/useVariantsStore';
import { useSimulationStore } from '../src/store/useSimulationStore';
import { usePanelStore } from '../src/store/usePanelStore';
import { resetEditorSession, startNewLabel, requestNewLabel } from '../src/utils/editorSession';
import { isDirtyNow } from '../src/hooks/useUnsavedChanges';
import { defaultSaveMode } from '../src/utils/saveMode';
import { DesignElement } from '../src/types';

const designer = () => useDesignerStore.getState();
const designs = () => useDesignsStore.getState();
const history = () => (useDesignerStore as any).temporal.getState();
const settle = () => jest.advanceTimersByTimeAsync(400);
const rect = (id: string): DesignElement => ({ id, type: 'rect', x: 10, y: 20, width: 100, height: 50 });

beforeEach(async () => {
  jest.useFakeTimers();
  resetEditorSession();
  await settle();
  answers.length = 0;
  asked.length = 0;
  calls.length = 0;
});
afterEach(() => { jest.useRealTimers(); });

/** A saved design of 100 × 70 mm open, with test data, a variant, a preview and a change not saved */
async function designOpen() {
  versions.set('5/1', {
    id: 1, versionNumber: 1, createdAt: 'now', zpl: '^XA^XZ', elements: [rect('a'), rect('b')], labelWidth: 800, labelHeight: 560,
    sampleValues: { UC: '123' }, pagesConfig: { pages: [{ mode: 'first' }, { mode: 'repeat' }], records: [{ X: '1' }] },
  });
  await designs().fetchDesigns();
  await designs().loadVersion(5, 1);
  useVariantsStore.setState({ designId: 5, items: [{ id: 'v', name: 'V' } as any], loadedId: 'v', loadedName: 'V', baseline: 'x' });
  useSimulationStore.setState({ status: 'ready', result: { labels: [], totalRecords: 0, unplaced: 0, warnings: [], zpl: '' } as any });
  usePanelStore.setState({ open: true });
  designer().selectElement('a');
}

describe('Nova etiqueta', () => {
  test('a blank label of the same size, not linked to the open design, not "unsaved", without history', async () => {
    useDesignerStore.setState({ snapToGrid: true, gridSize: 16 });
    await designOpen();
    designer().addElement('rect');
    await settle();

    startNewLabel();
    await settle();

    const s = designer();
    expect({ w: s.labelWidth, h: s.labelHeight }).toEqual({ w: 800, h: 560 });
    expect(s.zplCode).toBe('^XA\n^PW800\n^LL560\n^XZ');
    expect(s.elements).toEqual([]);
    expect(s.pages).toEqual([{ mode: 'first' }]);
    expect(s.activePage).toBe(0);
    expect(s.records).toEqual([]);
    expect(s.sampleValues).toEqual({});
    expect(s.selectedId).toBeNull();
    expect({ grid: s.snapToGrid, step: s.gridSize }).toEqual({ grid: true, step: 16 });
    expect(designs()).toMatchObject({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null });
    expect(designs().designs.map(d => d.id)).toEqual([5]);          // the list of designs is not touched
    expect(useVariantsStore.getState()).toMatchObject({ designId: null, items: [], loadedId: null });
    expect(useSimulationStore.getState().result).toBeNull();
    expect(usePanelStore.getState().open).toBe(true);                 // the panel stays as the person left it
    expect(isDirtyNow()).toBe(false);
    expect(history().pastStates).toEqual([]);
    history().undo();
    expect(designer().elements).toEqual([]);
  });

  test('with unsaved changes it asks; cancelling keeps everything, confirming starts the new label', async () => {
    await designOpen();
    designer().addElement('rect');
    await settle();
    expect(isDirtyNow()).toBe(true);

    answers.push(false);
    expect(await requestNewLabel()).toBe(false);
    expect(asked).toHaveLength(1);
    expect(designer().elements.length).toBe(3);
    expect(designs().activeDesignId).toBe(5);

    answers.push(true);
    expect(await requestNewLabel()).toBe(true);
    expect(designer().elements).toEqual([]);
    expect(designs().activeDesignId).toBeNull();
  });

  test('with nothing unsaved it does not ask', async () => {
    await designOpen();
    expect(isDirtyNow()).toBe(false);
    expect(await requestNewLabel()).toBe(true);
    expect(asked).toHaveLength(0);
    expect(designer().elements).toEqual([]);
  });

  test('saving after it creates a new design and never writes into the one that was open', async () => {
    await designOpen();
    startNewLabel();
    designer().addElement('rect');
    await settle();
    expect(defaultSaveMode(designs().activeDesignId)).toBe('new');
    await designs().saveNewDesign('Outra etiqueta');
    expect(calls.map(c => c.fn)).toEqual(['create']);
    expect(calls[0].args[0]).toBe('Outra etiqueta');
    expect(calls[0].args[1].labelHeight).toBe(560);
    expect(designs().activeDesignId).toBe(9);
  });

  test('"Limpar a etiqueta" is not a new label: it stays linked to the open design (unchanged on purpose)', async () => {
    await designOpen();
    designer().clearAll();
    expect(designs().activeDesignId).toBe(5);
  });
});

describe('Salvar', () => {
  test('with a design open the dialog opens on a new version; without one, on a new design', () => {
    expect(defaultSaveMode(5)).toBe('version');
    expect(defaultSaveMode(null)).toBe('new');
  });
});
