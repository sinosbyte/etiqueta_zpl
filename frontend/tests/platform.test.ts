// Console of the Sinosbyte administrators (Fase 06, etapa 3): its address and the template editor (open a template,
// start a new one, save into it, publish as new, leave).

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => 'jwt', saveToken: jest.fn(), triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => null) }));

const calls: any[] = [];
const discard = { answer: true };
jest.mock('../src/hooks/useUnsavedChanges', () => ({ confirmDiscardChanges: jest.fn(async () => discard.answer) }));
jest.mock('../src/utils/navigation', () => {
  const real = jest.requireActual('../src/utils/navigation');
  return { ...real, navigate: jest.fn((v: string) => calls.push(['navigate', v])) };
});
jest.mock('../src/utils/templatesClient', () => ({
  apiGetTemplate: jest.fn(async (id: number) => ({
    id, name: 'Picking', description: '', category: 'picking', labelWidth: 800, labelHeight: 600, updatedAt: '',
    zpl: '^XA^XZ', elements: [{ id: 'a', type: 'box', x: 10, y: 10, width: 100, height: 50, thickness: 2 }],
  })),
  apiReplaceTemplate: jest.fn(async (id: number, payload: any) => { calls.push(['replace', id, payload]); return { id }; }),
  apiCreateTemplate: jest.fn(async (name: string, _d: string, payload: any, cat: string) => { calls.push(['create', name, cat, payload]); return { id: 77 }; }),
  apiListTemplates: jest.fn(async () => ({ items: [{ id: 77, name: 'Novo', description: 'd', category: 'outros', labelWidth: 800, labelHeight: 1200, updatedAt: 'x' }], canManage: true })),
}));
jest.mock('../src/utils/zplClient', () => ({ generateZpl: jest.fn(async () => '^XA^XZ') }));

import { viewFromPath, pathOf } from '../src/utils/navigation';
import { useTemplateEditStore } from '../src/store/useTemplateEditStore';
import { useDesignerStore } from '../src/store/useDesignerStore';
import { editTemplate, newTemplate, saveIntoTemplate, publishAsNew, leaveTemplateEditor } from '../src/utils/templateEditing';

const summary = { id: 5, name: 'Picking', description: '', category: 'picking' as const, labelWidth: 800, labelHeight: 600, updatedAt: '' };

beforeEach(() => {
  calls.length = 0;
  discard.answer = true;
  useTemplateEditStore.getState().stop();
});

describe('the address', () => {
  test('/plataforma is the console', () => {
    expect(pathOf('platform')).toBe('/plataforma');
    expect(viewFromPath('/plataforma')).toBe('platform');
    expect(viewFromPath('/plataforma/')).toBe('platform');
  });
});

describe('the template editor', () => {
  test('editing a template opens it in the editor and remembers which one', async () => {
    expect(await editTemplate(summary)).toBe(true);
    expect(useTemplateEditStore.getState()).toMatchObject({ active: true, template: { id: 5, name: 'Picking' } });
    expect(useDesignerStore.getState().elements).toHaveLength(1);
    expect(calls).toContainEqual(['navigate', 'designer']);
  });

  test('keeping unsaved changes opens nothing', async () => {
    discard.answer = false;
    expect(await editTemplate(summary)).toBe(false);
    expect(await newTemplate()).toBe(false);
    expect(useTemplateEditStore.getState().active).toBe(false);
    expect(calls).toEqual([]);
  });

  test('a new template starts on an empty label, with no template behind it', async () => {
    await editTemplate(summary);
    expect(await newTemplate()).toBe(true);
    expect(useTemplateEditStore.getState()).toMatchObject({ active: true, template: null });
    expect(useDesignerStore.getState().elements).toEqual([]);
  });

  test('saving goes into the template being edited', async () => {
    await editTemplate(summary);
    await saveIntoTemplate();
    const replace = calls.find(c => c[0] === 'replace');
    expect(replace[1]).toBe(5);
    expect(replace[2]).toMatchObject({ labelWidth: 800, labelHeight: 600 });
    expect(replace[2].elements).toHaveLength(1);
  });

  test('saving with no template behind is refused (it must be published)', async () => {
    await newTemplate();
    await expect(saveIntoTemplate()).rejects.toThrow('NO_TEMPLATE');
  });

  test('publishing as new creates it and the editor goes on editing it', async () => {
    await newTemplate();
    await publishAsNew('Novo', 'd', 'outros');
    expect(calls.find(c => c[0] === 'create').slice(0, 3)).toEqual(['create', 'Novo', 'outros']);
    expect(useTemplateEditStore.getState().template).toMatchObject({ id: 77, name: 'Novo' });
  });

  test('leaving goes back to the console and ends the template editing', async () => {
    await editTemplate(summary);
    expect(await leaveTemplateEditor()).toBe(true);
    expect(useTemplateEditStore.getState().active).toBe(false);
    expect(calls[calls.length - 1]).toEqual(['navigate', 'platform']);
  });
});
