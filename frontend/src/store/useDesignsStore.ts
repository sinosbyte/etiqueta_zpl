import { create } from 'zustand';
import { copyName } from '../utils/designsList';
import { useDesignerStore, startHistoryAfresh } from './useDesignerStore';
import { toast } from './useToastStore';
import { t } from '../i18n';
import {
  apiCreateDesign, apiListDesigns, apiDeleteDesign, apiRenameDesign,
  apiCreateVersion, apiListVersions, apiGetVersion, apiUpdateVersion,
  DesignSummary, VersionSummary,
} from '../utils/designsClient';
import type { TemplateDetail } from '../utils/templatesClient';
import { EMPTY_SIGNATURE, editorSignature, usedSamples } from '../utils/unsaved';
import { pagesConfigOf, pagesFromConfig, recordsFromConfig, singlePage } from '../utils/pages';
import { checkSapCompat } from '../utils/sapCompat';

interface DesignsStore {
  designs: DesignSummary[];
  designsTotal: number;
  activeDesignId: number | null;
  activeDesignName: string;
  activeVersionNumber: number | null;
  versions: VersionSummary[];
  showSaveModal: boolean;
  error: string;
  savedSignature: string;  // signatureOf the content last saved, loaded or opened: the editor differs from it = unsaved changes

  designsSearch: string;   // the search the list was fetched with (the server searches all the designs of the company)
  /** The first page of the list; `search` replaces the search in use (left out = the same as now) */
  fetchDesigns(search?: string): Promise<void>;
  loadMoreDesigns(): Promise<void>;
  /** A copy of the latest version of a design (test data and pages too) as a new design; returns its name */
  duplicateDesign(id: number, name: string): Promise<string>;
  saveNewDesign(name: string): Promise<void>;
  saveVersion(): Promise<void>;
  overwriteVersion(): Promise<void>;
  loadVersion(designId: number, versionNumber: number): Promise<void>;
  openTemplate(template: TemplateDetail): void;
  /** What the editor holds now counts as saved (a template was saved from it, Fase 06) */
  markSaved(): void;
  deleteDesign(id: number): Promise<void>;
  renameDesign(id: number, newName: string): Promise<void>;
  fetchVersions(designId: number): Promise<void>;
  /** Forgets the design that was open and the list of the previous session (nothing is deleted on the server). */
  reset(): void;

  openSaveModal(): void;
  closeSaveModal(): void;
  setError(msg: string): void;
}

const DESIGNS_PAGE_SIZE = 24;
let listRequest = 0;   // the latest request of the list: answers of older ones are dropped

// What the editor holds now: the payload to save and its signature
function editorContent() {
  const state = useDesignerStore.getState();
  const { elements, zplCode: zpl, labelWidth, labelHeight, sampleValues, pages, records } = state;
  return {
    payload: {
      zpl, elements, labelWidth, labelHeight, sampleValues: usedSamples(elements, sampleValues),
      // Always sent, so what is saved is what the editor shows (null = one page)
      pagesConfig: pagesConfigOf(pages, records),
    },
    signature: editorSignature(state),
  };
}
const currentSignature = () => editorContent().signature;

// The save modal already warned; once saved, remind that the SAP will not take it as it is
function warnIfNotSapCompatible(zpl: string): void {
  const problems = checkSapCompat(zpl).length;
  if (problems > 0) toast.info(t('sap.savedWithIssues', { n: problems }));
}

export const useDesignsStore = create<DesignsStore>((set, get) => ({
  designs: [],
  designsTotal: 0,
  designsSearch: '',
  activeDesignId: null,
  activeDesignName: '',
  activeVersionNumber: null,
  versions: [],
  showSaveModal: false,
  error: '',
  savedSignature: EMPTY_SIGNATURE,

  async fetchDesigns(search) {
    const term = search ?? get().designsSearch;
    const id = ++listRequest;
    set({ designsSearch: term });
    try {
      const { items, total } = await apiListDesigns(DESIGNS_PAGE_SIZE, 0, term);
      if (id !== listRequest) return;   // typing went on: an older answer arriving late is not shown
      set({ designs: items, designsTotal: total, error: '' });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load designs' });
    }
  },

  async loadMoreDesigns() {
    try {
      const { designs, designsSearch } = get();
      const { items, total } = await apiListDesigns(DESIGNS_PAGE_SIZE, designs.length, designsSearch);
      set({ designs: [...designs, ...items], designsTotal: total });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load more designs' });
    }
  },

  async saveNewDesign(name: string) {
    const { payload, signature } = editorContent();  // what was sent is what counts as saved, even if the user keeps editing meanwhile
    const result = await apiCreateDesign(name, payload);
    set({ activeDesignId: result.designId, activeDesignName: name, activeVersionNumber: 1, showSaveModal: false, savedSignature: signature });
    await get().fetchDesigns();
    toast.success(t('toast.designSaved', { name }));
    warnIfNotSapCompatible(payload.zpl);
  },

  async saveVersion() {
    const { activeDesignId } = get();
    if (!activeDesignId) return;
    const { payload, signature } = editorContent();
    const version = await apiCreateVersion(activeDesignId, payload);
    set({ activeVersionNumber: version.versionNumber, savedSignature: signature });
    await get().fetchDesigns();
    await get().fetchVersions(activeDesignId);
    toast.success(t('toast.versionSaved', { n: version.versionNumber }));
    warnIfNotSapCompatible(payload.zpl);
  },

  async overwriteVersion() {
    const { activeDesignId, activeVersionNumber } = get();
    if (!activeDesignId || activeVersionNumber === null) return;
    const { payload, signature } = editorContent();
    await apiUpdateVersion(activeDesignId, activeVersionNumber, payload);
    set({ savedSignature: signature });
    await get().fetchDesigns();
    set({ showSaveModal: false });
    toast.success(t('toast.versionUpdated', { n: activeVersionNumber }));
    warnIfNotSapCompatible(payload.zpl);
  },

  async loadVersion(designId: number, versionNumber: number) {
    const version = await apiGetVersion(designId, versionNumber);
    // Another design opens: undo must not bring back what was in the editor before it (that is another design)
    startHistoryAfresh(() => useDesignerStore.setState({
      elements: version.elements,
      zplCode: version.zpl,
      labelWidth: version.labelWidth,
      labelHeight: version.labelHeight,
      // This design's own example values (none for versions saved before they existed), not the previous design's
      sampleValues: version.sampleValues ?? {},
      // A version with no configuration is a design of one page
      pages: pagesFromConfig(version.pagesConfig),
      records: recordsFromConfig(version.pagesConfig),
      activePage: 0,
      selectedId: null,
      selectedIds: [],
    }));
    const designName = get().designs.find(d => d.id === designId)?.name ?? '';
    set({ activeDesignId: designId, activeDesignName: designName, activeVersionNumber: versionNumber, savedSignature: currentSignature() });
  },

  // A template opens as a new design: nothing is saved until the user saves it under their own name
  openTemplate(template: TemplateDetail) {
    startHistoryAfresh(() => useDesignerStore.setState({
      elements: template.elements,
      zplCode: template.zpl,
      labelWidth: template.labelWidth,
      labelHeight: template.labelHeight,
      sampleValues: {},
      pages: singlePage(),
      records: [],
      activePage: 0,
      selectedId: null,
      selectedIds: [],
    }));
    set({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: currentSignature() });
  },

  async duplicateDesign(id, name) {
    const { items } = await apiListVersions(id, 1, 0);
    if (items.length === 0) throw new Error(t('designs.copyFailed'));
    const v = await apiGetVersion(id, items[0].versionNumber);
    const payload = {
      zpl: v.zpl, elements: v.elements, labelWidth: v.labelWidth, labelHeight: v.labelHeight,
      sampleValues: v.sampleValues ?? {}, pagesConfig: v.pagesConfig ?? null,
    };
    // Names are unique in the company: "(cópia)", "(cópia 2)"… until one is free
    for (let n = 1; n <= 20; n++) {
      const copy = copyName(name, n, t('designs.copyWord'));
      try {
        await apiCreateDesign(copy, payload);
        await get().fetchDesigns();
        return copy;
      } catch (e) {
        if ((e as { status?: number })?.status === 409) continue;   // the name is taken: the next one
        throw e;
      }
    }
    throw new Error(t('designs.copyFailed'));
  },

  reset() {
    listRequest++;
    set({
      designsSearch: '',
      designs: [], designsTotal: 0, activeDesignId: null, activeDesignName: '', activeVersionNumber: null,
      versions: [], showSaveModal: false, error: '', savedSignature: EMPTY_SIGNATURE,
    });
  },

  markSaved() {
    set({ savedSignature: currentSignature() });
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
    // The open design is gone: what is in the editor is no longer saved anywhere (empty, as at the start, if it is empty)
    if (get().activeDesignId === id) set({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], savedSignature: EMPTY_SIGNATURE });
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
