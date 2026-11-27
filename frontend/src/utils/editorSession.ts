import { useDesignerStore } from '../store/useDesignerStore';
import { useDesignsStore } from '../store/useDesignsStore';
import { useVariantsStore } from '../store/useVariantsStore';
import { useSimulationStore } from '../store/useSimulationStore';
import { useLabelRenderStore } from '../store/useLabelRenderStore';
import { usePdfExportStore } from '../store/usePdfExportStore';
import { usePanelStore } from '../store/usePanelStore';
import { useTemplateEditStore } from '../store/useTemplateEditStore';
import { activeRenderer } from './labelRenderer';

/**
 * The editing state of a session lives in memory only (nothing of it is in the browser storage), so it outlived
 * a sign-out in the same tab: the next person, even of another company, saw the design, its test data and its
 * history. This is the one place that forgets all of it.
 *
 * Forgotten: what is in the editor (elements, pages, size, selection, the ZPL), its undo history, the test data
 * (values and records), the design that was open and the list of designs, the test variants, the preview, the
 * label pictures and the PDF export, the Test data panel and the template being edited.
 * Kept: everything saved on the server (designs, versions, variants, templates) and the browser's preferences
 * (language, unit, snapping, the tutorial already seen).
 */
export function resetEditorSession(): void {
  usePdfExportStore.getState().cancel();
  useSimulationStore.getState().reset();       // also stops the pictures and the export that belonged to it
  useLabelRenderStore.getState().reset();
  activeRenderer().cache.clear();
  useVariantsStore.setState({
    designId: null, items: [], status: 'idle', error: '', busy: false, loadedId: null, loadedName: '', baseline: null,
  });
  useDesignsStore.getState().reset();
  useDesignerStore.getState().resetEditor();
  usePanelStore.setState({ open: false, maximized: false });
  useTemplateEditStore.getState().stop();
}
