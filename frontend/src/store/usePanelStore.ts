import { create } from 'zustand';

// The Test data environment under the canvas: whether it is open and whether it takes the whole editor area. It
// lives here (not in the panel) so other parts of the editor, such as the Preview button of the top bar, can open it.

interface PanelStore {
  open: boolean;
  maximized: boolean;
  setOpen(open: boolean): void;
  setMaximized(maximized: boolean): void;
  /** Opens the environment. */
  show(): void;
}

export const usePanelStore = create<PanelStore>(set => ({
  open: false,
  maximized: false,
  setOpen: open => set(open ? { open } : { open, maximized: false }),   // closing also gives the canvas its room back
  setMaximized: maximized => set(maximized ? { open: true, maximized } : { maximized }),
  show: () => set({ open: true }),
}));
