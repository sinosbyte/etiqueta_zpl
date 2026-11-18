import { create } from 'zustand';

// Whether the test data bar under the canvas is open, and on which tab. It lives here (not in the panel) so other
// parts of the editor, such as the Preview and Export buttons of the top bar, can take the user to the simulation.

export type PanelTab = 'data' | 'sim';

interface PanelStore {
  open: boolean;
  tab: PanelTab;
  setOpen(open: boolean): void;
  setTab(tab: PanelTab): void;
  /** Opens the bar on a tab. */
  show(tab: PanelTab): void;
}

export const usePanelStore = create<PanelStore>(set => ({
  open: false,
  tab: 'data',
  setOpen: open => set({ open }),
  setTab: tab => set({ tab }),
  show: tab => set({ open: true, tab }),
}));
