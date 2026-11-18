import { create } from 'zustand';
import { useDesignerStore } from './useDesignerStore';
import { useDesignsStore } from './useDesignsStore';
import { useSimulationStore } from './useSimulationStore';
import { askConfirm } from './useDialogStore';
import { toast } from './useToastStore';
import { t } from '../i18n';
import {
  VariantSummary, apiCreateVariant, apiDeleteVariant, apiGetVariant, apiListVariants, apiRenameVariant, apiUpdateVariantData,
} from '../utils/variantsClient';
import { TestData, hasTestData, testDataOf, testDataSignature } from '../utils/testVariants';

interface VariantsStore {
  designId: number | null;        // the design the list belongs to (variants are always of one saved design)
  items: VariantSummary[];
  max: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  busy: boolean;                  // a save, load, update, rename or delete is under way
  loadedId: string | null;        // the variant whose data the editor was loaded from or saved as
  loadedName: string;
  baseline: string | null;        // test-data signature of that variant: the editor differs from it = modified

  refresh(): Promise<void>;
  /** Saves the test data now in the editor as a new variant. Returns whether it was saved. */
  saveAs(name: string): Promise<boolean>;
  /** Replaces the data of the loaded variant with the one in the editor (after the user confirmed). */
  updateLoaded(): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** Puts a variant's values and records in the editor, after warning when that would lose changes. */
  load(id: string): Promise<boolean>;
}

/** The test data the editor holds now. */
export function currentTestData(): TestData {
  const { sampleValues, records } = useDesignerStore.getState();
  return testDataOf(sampleValues, records);
}

const currentSignature = (): string => {
  const { sampleValues, records } = useDesignerStore.getState();
  return testDataSignature(sampleValues, records);
};

/** Whether the test data in the editor differs from the variant that was loaded or saved last (false with none). */
export function isModified(baseline: string | null, sampleValues: Record<string, string>, records: Parameters<typeof testDataSignature>[1]): boolean {
  return baseline !== null && testDataSignature(sampleValues, records) !== baseline;
}

const noLoaded = { loadedId: null, loadedName: '', baseline: null };

export const useVariantsStore = create<VariantsStore>((set, get) => ({
  designId: null,
  items: [],
  max: 50,
  status: 'idle',
  error: '',
  busy: false,
  ...noLoaded,

  async refresh() {
    const designId = useDesignsStore.getState().activeDesignId;
    if (designId === null) { set({ designId: null, items: [], status: 'idle', error: '', ...noLoaded }); return; }
    // Another design: the list and the loaded variant of the previous one do not apply
    if (get().designId !== designId) set({ designId, items: [], ...noLoaded });
    set({ status: 'loading', error: '' });
    try {
      const { items, max } = await apiListVariants(designId);
      if (useDesignsStore.getState().activeDesignId !== designId) return;  // opened another meanwhile
      const loaded = get().loadedId;
      set({ items, max, status: 'ready', ...(loaded && !items.some(v => v.id === loaded) ? noLoaded : {}) });
    } catch (e) {
      if (useDesignsStore.getState().activeDesignId !== designId) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  async saveAs(name) {
    const designId = get().designId;
    if (designId === null || get().busy) return false;
    set({ busy: true });
    try {
      const data = currentTestData();
      const created = await apiCreateVariant(designId, name, data);
      // What was saved is what counts as the variant, even if the user went on typing during the request
      set({ loadedId: created.id, loadedName: created.name, baseline: testDataSignature(data.sampleValues, data.records) });
      await get().refresh();
      toast.success(t('variants.saved', { name: created.name }));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('variants.saveFailed'));
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async updateLoaded() {
    const { designId, loadedId, loadedName } = get();
    if (designId === null || !loadedId || get().busy) return false;
    set({ busy: true });
    try {
      const data = currentTestData();
      await apiUpdateVariantData(designId, loadedId, data);
      set({ baseline: testDataSignature(data.sampleValues, data.records) });
      await get().refresh();
      toast.success(t('variants.updated', { name: loadedName }));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('variants.updateFailed'));
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async rename(id, name) {
    const designId = get().designId;
    if (designId === null || get().busy) return false;
    set({ busy: true });
    try {
      const v = await apiRenameVariant(designId, id, name);
      if (get().loadedId === id) set({ loadedName: v.name });
      await get().refresh();
      toast.success(t('variants.renamed', { name: v.name }));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('variants.renameFailed'));
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async remove(id) {
    const designId = get().designId;
    if (designId === null || get().busy) return false;
    set({ busy: true });
    try {
      await apiDeleteVariant(designId, id);
      // Only the variant goes: the data in the editor stays as it is, now not linked to any variant
      if (get().loadedId === id) set(noLoaded);
      await get().refresh();
      toast.success(t('variants.deleted'));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('variants.deleteFailed'));
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async load(id) {
    const { designId, loadedId, baseline } = get();
    if (designId === null || get().busy) return false;
    if (id === loadedId && !isModified(baseline, useDesignerStore.getState().sampleValues, useDesignerStore.getState().records)) return true;

    // The data now in the editor is replaced: warn when it is not saved in any variant
    const d = useDesignerStore.getState();
    const unsaved = loadedId ? isModified(baseline, d.sampleValues, d.records) : hasTestData(currentTestData());
    if (unsaved) {
      const ok = await askConfirm({
        title: t('variants.unsavedTitle'),
        message: t('variants.unsavedMessage'),
        confirmLabel: t('variants.unsavedConfirm'),
        danger: true,
      });
      if (!ok) return false;
    }

    set({ busy: true });
    try {
      const v = await apiGetVariant(designId, id);
      if (useDesignsStore.getState().activeDesignId !== designId) return false;  // another design was opened meanwhile
      const data = testDataOf(v.sampleValues, v.records);
      // One change: the values and the records of the variant replace the ones in the editor. Elements, pages and
      // size are not touched, and nothing is asked of the preview service: the picture stays out of date until
      // the user updates it.
      useDesignerStore.setState({ sampleValues: { ...data.sampleValues }, records: data.records.map(r => ({ ...r })) });
      if (useSimulationStore.getState().result) useSimulationStore.setState({ stale: true, view: null });
      set({ loadedId: v.id, loadedName: v.name, baseline: testDataSignature(data.sampleValues, data.records) });
      toast.success(t('variants.loaded', { name: v.name }));
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('variants.loadFailed'));
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));

// The list belongs to the design that is open: opening another one (or a new one, or a template) starts over
useDesignsStore.subscribe((s, prev) => {
  if (s.activeDesignId === prev.activeDesignId) return;
  useVariantsStore.setState({ designId: s.activeDesignId, items: [], status: 'idle', error: '', ...noLoaded });
  if (s.activeDesignId !== null) void useVariantsStore.getState().refresh();
});
