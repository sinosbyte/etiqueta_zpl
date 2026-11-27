// Etapa 3 da evolução (27/11/2026): showing the grid is apart from snapping to it, and the dots drawn at low zoom.

/* eslint-disable @typescript-eslint/no-explicit-any */
const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
};

jest.mock('../src/utils/authClient', () => ({ API_BASE: '', getToken: () => null, saveToken: jest.fn(), triggerOn401: jest.fn(), refreshAccessToken: jest.fn(async () => null) }));
jest.mock('../src/utils/zplClient', () => ({ generateZpl: jest.fn(async () => 'ZPL'), parseZpl: jest.fn(), previewBlob: jest.fn(), expandZpl: jest.fn() }));
(globalThis as any).document = { documentElement: { setAttribute: () => undefined }, createElement: () => ({ getContext: () => ({ font: '', measureText: (s: string) => ({ width: s.length * 10 }) }) }) };

import { visibleGridStep, GRID_STEPS, snapMove } from '../src/utils/snap';
import { useDesignerStore, snapContext } from '../src/store/useDesignerStore';
import { resetEditorSession } from '../src/utils/editorSession';
import { ZOOM_100 } from '../src/utils/units';

const designer = () => useDesignerStore.getState();
const saved = () => JSON.parse(storage.get('zpl-designer-snap') ?? '{}');

describe('the dots drawn', () => {
  test('every step when they are 6 px apart or more; every 2, 4… steps below that', () => {
    expect(visibleGridStep(40, ZOOM_100)).toEqual({ px: 28, every: 1 });            // 5 mm at 100%
    expect(visibleGridStep(8, ZOOM_100)).toEqual({ px: 11.2, every: 2 });           // 1 mm at 100%: 5.6 px, drawn every 2 mm
    expect(visibleGridStep(8, ZOOM_100 * 2)).toEqual({ px: 11.2, every: 1 });       // 1 mm at 200%
    expect(visibleGridStep(4, 0.1)).toEqual({ px: 6.4, every: 16 });                // 0.5 mm at the smallest zoom
    expect(visibleGridStep(8, 0)).toEqual({ px: 0, every: 1 });                     // no zoom: nothing drawn, no loop
  });

  test('the drawn distance is never under 6 px and is always a whole number of steps, for every step and zoom offered', () => {
    for (const { dots } of GRID_STEPS) {
      for (let zoom = 0.1; zoom <= 6; zoom += 0.05) {
        const { px, every } = visibleGridStep(dots, zoom);
        expect(px).toBeGreaterThanOrEqual(6);
        expect(px).toBeCloseTo(dots * zoom * every, 9);
        expect(Number.isInteger(Math.log2(every))).toBe(true);
        if (every > 1) expect(dots * zoom * (every / 2)).toBeLessThan(6);    // not thinned more than needed
      }
    }
  });
});

describe('show the grid and snap to it are separate', () => {
  beforeEach(() => {
    storage.clear();
    useDesignerStore.setState({ showGrid: true, snapToGrid: true, snapToElements: false, gridSize: 8 });
  });

  test('hiding the grid is remembered in this browser and does not turn snapping off', () => {
    designer().toggleShowGrid();
    expect(designer().showGrid).toBe(false);
    expect(saved()).toMatchObject({ showGrid: false, snapToGrid: true, gridSize: 8 });
    const ctx = snapContext([])!;
    expect(ctx.opts.grid).toBe(8);
    // a move of 13 dots snaps to the grid (16) with the grid hidden
    expect(snapMove({ x: 0, y: 0, width: 10, height: 10 }, 13, 0, [], { width: 800, height: 600 }, ctx.opts).dx).toBe(16);
    designer().toggleShowGrid();
    expect(saved().showGrid).toBe(true);
  });

  test('turning snapping to the grid off does not hide the grid', () => {
    designer().toggleSnapToGrid();
    expect(designer().snapToGrid).toBe(false);
    expect(designer().showGrid).toBe(true);
    expect(saved()).toMatchObject({ snapToGrid: false, showGrid: true });
  });

  test('a session that ends keeps the grid preference (it is the browser\'s, not the design\'s)', () => {
    designer().toggleShowGrid();
    resetEditorSession();
    expect(designer().showGrid).toBe(false);
  });

  test('a browser that never saved the preference shows the grid (as before)', () => {
    jest.isolateModules(() => {
      storage.set('zpl-designer-snap', JSON.stringify({ snapToGrid: true, snapToElements: true, gridSize: 16 }));
      const { useDesignerStore: fresh } = require('../src/store/useDesignerStore');
      expect(fresh.getState().showGrid).toBe(true);
      expect(fresh.getState().gridSize).toBe(16);
    });
  });
});
