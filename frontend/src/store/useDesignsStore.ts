import { create } from 'zustand';
import { useDesignerStore } from './useDesignerStore';
import { toast } from './useToastStore';
import { t } from '../i18n';
import {
  apiCreateDesign, apiListDesigns, apiDeleteDesign, apiRenameDesign,
  apiCreateVersion, apiListVersions, apiGetVersion, apiUpdateVersion,
  DesignSummary, VersionSummary,
} from '../utils/designsClient';

interface DesignsStore {
  designs: DesignSummary[];
  designsTotal: number;
  activeDesignId: number | null;
  activeDesignName: string;
  activeVersionNumber: number | null;
  versions: VersionSummary[];
  showSaveModal: boolean;
  error: string;

  fetchDesigns(): Promise<void>;
  loadMoreDesigns(): Promise<void>;
  saveNewDesign(name: string): Promise<void>;
  saveVersion(): Promise<void>;
  overwriteVersion(): Promise<void>;
  loadVersion(designId: number, versionNumber: number): Promise<void>;
  deleteDesign(id: number): Promise<void>;
  renameDesign(id: number, newName: string): Promise<void>;
  fetchVersions(designId: number): Promise<void>;

  openSaveModal(): void;
  closeSaveModal(): void;
  setError(msg: string): void;
}

const DESIGNS_PAGE_SIZE = 24;

export const useDesignsStore = create<DesignsStore>((set, get) => ({
  designs: [],
  designsTotal: 0,
  activeDesignId: null,
  activeDesignName: '',
  activeVersionNumber: null,
  versions: [],
  showSaveModal: false,
  error: '',

  async fetchDesigns() {
    try {
      const { items, total } = await apiListDesigns(DESIGNS_PAGE_SIZE, 0);
      set({ designs: items, designsTotal: total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load designs' });
    }
  },

  async loadMoreDesigns() {
    try {
      const { designs } = get();
      const { items, total } = await apiListDesigns(DESIGNS_PAGE_SIZE, designs.length);
      set({ designs: [...designs, ...items], designsTotal: total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load more designs' });
    }
  },

  async saveNewDesign(name: string) {
    const { elements, zplCode: zpl, labelWidth, labelHeight } = useDesignerStore.getState();
    const result = await apiCreateDesign(name, { zpl, elements, labelWidth, labelHeight });
    set({ activeDesignId: result.designId, activeDesignName: name, activeVersionNumber: 1, showSaveModal: false });
    await get().fetchDesigns();
    toast.success(t('toast.designSaved', { name }));
  },

  async saveVersion() {
    const { activeDesignId } = get();
    if (!activeDesignId) return;
    const { elements, zplCode: zpl, labelWidth, labelHeight } = useDesignerStore.getState();
    const version = await apiCreateVersion(activeDesignId, { zpl, elements, labelWidth, labelHeight });
    set({ activeVersionNumber: version.versionNumber });
    await get().fetchDesigns();
    await get().fetchVersions(activeDesignId);
    toast.success(t('toast.versionSaved', { n: version.versionNumber }));
  },

  async overwriteVersion() {
    const { activeDesignId, activeVersionNumber } = get();
    if (!activeDesignId || activeVersionNumber === null) return;
    const { elements, zplCode: zpl, labelWidth, labelHeight } = useDesignerStore.getState();
    await apiUpdateVersion(activeDesignId, activeVersionNumber, {
      zpl, elements, labelWidth, labelHeight,
    });
    await get().fetchDesigns();
    set({ showSaveModal: false });
    toast.success(t('toast.versionUpdated', { n: activeVersionNumber }));
  },

  async loadVersion(designId: number, versionNumber: number) {
    const version = await apiGetVersion(designId, versionNumber);
    useDesignerStore.setState({
      elements: version.elements,
      zplCode: version.zpl,
      labelWidth: version.labelWidth,
      labelHeight: version.labelHeight,
      selectedId: null,
    });
    const designName = get().designs.find(d => d.id === designId)?.name ?? '';
    set({ activeDesignId: designId, activeDesignName: designName, activeVersionNumber: versionNumber });
  },

  async renameDesign(id: number, newName: string) {
    try {
      const updated = await apiRenameDesign(id, newName);
      set(s => ({
        designs: s.designs.map(d => d.id === id ? { ...d, name: updated.name } : d),
        activeDesignName: s.activeDesignId === id ? updated.name : s.activeDesignName,
      }));
      toast.success(t('toast.renamed', { name: updated.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('toast.renameFailed'));
    }
  },

  async deleteDesign(id: number) {
    const name = get().designs.find(d => d.id === id)?.name ?? 'Design';
    try {
      await apiDeleteDesign(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('toast.deleteFailed'));
      return;
    }
    if (get().activeDesignId === id) set({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [] });
    await get().fetchDesigns();
    toast.success(t('toast.deleted', { name }));
  },

  async fetchVersions(designId: number) {
    const { items } = await apiListVersions(designId, 100, 0);
    set({ versions: items });
  },

  openSaveModal() { set({ showSaveModal: true, error: '' }); },
  closeSaveModal() { set({ showSaveModal: false, error: '' }); },
  setError(msg: string) { set({ error: msg }); },
}));
