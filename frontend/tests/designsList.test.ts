// Etapa 4 da evolução (27/11/2026): My designs searches on the server, shows who created each design, duplicates a
// design and offers Delete only to who may delete.

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => null, saveToken: jest.fn(), triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => null) }));
jest.mock('../src/utils/zplClient', () => ({ generateZpl: jest.fn(async () => 'ZPL'), parseZpl: jest.fn(), previewBlob: jest.fn(), expandZpl: jest.fn() }));

const server = {
  lists: [] as any[],                       // the arguments of each list request
  pending: [] as (() => void)[],      // list answers held back (to answer out of order)
  hold: false,
  created: [] as { name: string; payload: any }[],
  taken: new Set<string>(),
};
const page = (items: any[]) => ({ items, total: items.length, limit: 24, offset: 0 });
jest.mock('../src/utils/designsClient', () => ({
  apiListDesigns: jest.fn((limit: number, offset: number, search = '') => {
    server.lists.push({ limit, offset, search });
    const answer = page([{ id: 1, name: `para "${search}"`, createdAt: 'x', updatedAt: 'x', versionCount: 1 }]);
    if (!server.hold) return Promise.resolve(answer);
    return new Promise(res => server.pending.push(() => res(answer)));
  }),
  apiListVersions: jest.fn(async () => ({ items: [{ id: 30, versionNumber: 3, createdAt: 'x' }], total: 3, limit: 1, offset: 0 })),
  apiGetVersion: jest.fn(async (id: number, vn: number) => ({
    id: 30, versionNumber: vn, createdAt: 'x', zpl: `^XA${id}^XZ`, elements: [{ id: 'e', type: 'rect', x: 1, y: 2, width: 3, height: 4 }],
    labelWidth: 800, labelHeight: 560, sampleValues: { UC: '9' }, pagesConfig: { pages: [{ mode: 'first' }, { mode: 'repeat' }], records: [{ M: '1' }] },
  })),
  apiCreateDesign: jest.fn(async (name: string, payload: any) => {
    if (name === 'boom') throw new Error('offline');
    if (server.taken.has(name)) throw Object.assign(new Error('Design name already taken'), { status: 409 });
    server.created.push({ name, payload });
    return { designId: 77, versionId: 1 };
  }),
  apiCreateVersion: jest.fn(), apiUpdateVersion: jest.fn(), apiDeleteDesign: jest.fn(), apiRenameDesign: jest.fn(),
}));
jest.mock('../src/store/useToastStore', () => ({ toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { canDeleteDesign, copyName } from '../src/utils/designsList';
import { useDesignsStore } from '../src/store/useDesignsStore';

const designs = () => useDesignsStore.getState();

beforeEach(() => {
  designs().reset();
  server.lists.length = 0;
  server.pending.length = 0;
  server.hold = false;
  server.created.length = 0;
  server.taken.clear();
});

describe('who sees Delete (the same rule as the server)', () => {
  const design = (createdById: number | null) => ({ createdBy: createdById === null ? null : { id: createdById, username: 'x' } });
  test('whoever created it, and an administrator of the company', () => {
    expect(canDeleteDesign({ userId: 5, role: 'member' }, design(5))).toBe(true);
    expect(canDeleteDesign({ userId: 5, role: 'member' }, design(6))).toBe(false);
    expect(canDeleteDesign({ userId: 5, role: 'company_admin' }, design(6))).toBe(true);
  });
  test('creator unknown: only an administrator; nobody signed in: nobody', () => {
    expect(canDeleteDesign({ userId: 5, role: 'member' }, design(null))).toBe(false);
    expect(canDeleteDesign({ userId: 5, role: 'company_admin' }, design(null))).toBe(true);
    expect(canDeleteDesign(null, design(5))).toBe(false);
  });
});

describe('the name of a copy', () => {
  test('"(cópia)", then "(cópia 2)"…', () => {
    expect(copyName('UC Picking', 1, 'cópia')).toBe('UC Picking (cópia)');
    expect(copyName(' UC Picking ', 2, 'cópia')).toBe('UC Picking (cópia 2)');
  });
  test('a long name is shortened so the copy fits in 100 characters', () => {
    const name = copyName('x'.repeat(100), 12, 'cópia');
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith(' (cópia 12)')).toBe(true);
  });
});

describe('the list searches on the server', () => {
  test('the search goes to the server; Load more and a refresh keep it; the session reset forgets it', async () => {
    await designs().fetchDesigns('uc');
    expect(server.lists.at(-1)).toMatchObject({ offset: 0, search: 'uc' });
    expect(designs().designs[0].name).toBe('para "uc"');
    await designs().loadMoreDesigns();
    expect(server.lists.at(-1)).toMatchObject({ offset: 1, search: 'uc' });
    await designs().fetchDesigns();                       // e.g. after saving: the same search
    expect(server.lists.at(-1).search).toBe('uc');
    designs().reset();
    expect(designs().designsSearch).toBe('');
  });

  test('an older answer arriving after a newer one is not shown', async () => {
    server.hold = true;
    const first = designs().fetchDesigns('u');
    const second = designs().fetchDesigns('uc');
    server.pending[1]();                                  // the newer answer first
    await second;
    server.pending[0]();                                  // then the older one
    await first;
    expect(designs().designs[0].name).toBe('para "uc"');
  });
});

describe('duplicate', () => {
  test('copies the latest version (test data and pages too) as a new design and refreshes the list', async () => {
    const name = await designs().duplicateDesign(4, 'UC Picking');
    expect(name).toBe('UC Picking (cópia)');
    expect(server.created).toHaveLength(1);
    expect(server.created[0].payload).toMatchObject({
      zpl: '^XA4^XZ', labelWidth: 800, labelHeight: 560, sampleValues: { UC: '9' },
      pagesConfig: { pages: [{ mode: 'first' }, { mode: 'repeat' }], records: [{ M: '1' }] },
    });
    expect(server.lists.length).toBeGreaterThan(0);
  });

  test('a name already taken: the next one', async () => {
    server.taken.add('UC Picking (cópia)');
    server.taken.add('UC Picking (cópia 2)');
    expect(await designs().duplicateDesign(4, 'UC Picking')).toBe('UC Picking (cópia 3)');
  });

  test('another error is not retried', async () => {
    const { apiCreateDesign } = jest.requireMock('../src/utils/designsClient');
    apiCreateDesign.mockImplementationOnce(async () => { throw new Error('offline'); });
    await expect(designs().duplicateDesign(4, 'UC')).rejects.toThrow('offline');
    expect(server.created).toHaveLength(0);
  });
});
