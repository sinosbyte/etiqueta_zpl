import { create } from 'zustand';

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  /** Destructive action: the button is red and the safe answer (Cancel) has the focus. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve(answer: boolean): void;
}

interface DialogStore {
  pending: PendingConfirm | null;
  settle(answer: boolean): void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  pending: null,
  settle(answer) {
    const p = get().pending;
    set({ pending: null });
    p?.resolve(answer);
  },
}));

/**
 * Asks the user to confirm, in the app's own dialog (instead of window.confirm).
 * Resolves true when confirmed, false when cancelled (button, Esc or click outside).
 * A second request while one is open cancels the first.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    useDialogStore.getState().settle(false);
    useDialogStore.setState({ pending: { ...options, resolve } });
  });
}
