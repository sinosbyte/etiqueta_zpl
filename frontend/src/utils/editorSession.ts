import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useVariantsStore } from '../store/useVariantsStore';
import { useSimulationStore } from '../store/useSimulationStore';
import { useLabelRenderStore } from '../store/useLabelRenderStore';
import { usePdfExportStore } from '../store/usePdfExportStore';
import { usePanelStore } from '../store/usePanelStore';
import { useTemplateEditStore } from '../store/useTemplateEditStore';
import { confirmDiscardChanges } from '../hooks/useUnsavedChanges';
import { activeRenderer } from './labelRenderer';

/** The work in the editor and everything that belongs to it, gone; the label keeps `size` when one is given. */
function clearWork(size?: { width: number; height: number }): void {
  usePdfExportStore.getState().cancel();
  useSimulationStore.getState().reset();       // also stops the pictures and the export that belonged to it
  useLabelRenderStore.getState().reset();
  useVariantsStore.setState({
    designId: null, items: [], status: 'idle', error: '', busy: false, loadedId: null, loadedName: '', baseline: null,
  });
  useDesignerStore.getState().resetEditor(size);
}

/**
 * The editing state of a session lives in memory only (nothing of it is in the browser storage), so it outlived
 * a sign-out in the same tab: the next person, even of another company, saw the design, its test data and its
 * history. This is the one place that forgets all of it (Etapa 1).
 *
 * Forgotten: what is in the editor (elements, pages, size, selection, the ZPL), its undo history, the test data
 * (values and records), the design that was open and the list of designs, the test variants, the preview, the
 * label pictures and the PDF export, the Test data panel and the template being edited.
 * Kept: everything saved on the server (designs, versions, variants, templates) and the browser's preferences
 * (language, unit, snapping, the tutorial already seen).
 */
export function resetEditorSession(): void {
  clearWork();
  activeRenderer().cache.clear();
  useDesignsStore.getState().reset();
  usePanelStore.setState({ open: false, maximized: false });
  useTemplateEditStore.getState().stop();
}

/**
 * A new label (Etapa 2): a blank label of the same size, not linked to any design, so the next Save creates a new
 * design and never writes into the one that was open (that one stays on the server as it was saved). The elements,
 * pages, test data, variant, preview and undo history go; the session, the list of designs and the preferences stay.
 */
export function startNewLabel(): void {
  const { labelWidth, labelHeight } = useDesignerStore.getState();
  clearWork({ width: labelWidth, height: labelHeight });
  useDesignsStore.setState({ activeDesignId: null, activeDesignName: '', activeVersionNumber: null, versions: [], showSaveModal: false, error: '' });
  useDesignsStore.getState().markSaved();      // a blank label is not "unsaved"
}

/** The New label button: with unsaved changes it asks first (the same dialog as opening a design). */
export async function requestNewLabel(): Promise<boolean> {
  if (!(await confirmDiscardChanges())) return false;
  startNewLabel();
  return true;
}
