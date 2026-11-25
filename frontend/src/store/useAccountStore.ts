import { create } from 'zustand';
import { getMe, Me } from '../utils/accountClient';
import { registerPasswordChangeHandler } from '../utils/apiClient';

// Who is signed in (role, company) and whether a temporary password must be changed before anything else.
// Loaded after the login and when the page opens with a session; cleared at logout.

interface AccountState {
  me: Me | null;
  loading: boolean;
  /** The server answered that the password must be changed (login with a temporary one, or a 403 on any call) */
  mustChangePassword: boolean;
  load(): Promise<void>;
  passwordChanged(): void;
  clear(): void;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  me: null,
  loading: false,
  mustChangePassword: false,
  async load() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const me = await getMe();
      set({ me, mustChangePassword: me.mustChangePassword });
    } catch {
      /* a session that ended is handled by the 401 handler (logout) */
    } finally {
      set({ loading: false });
    }
  },
  passwordChanged() {
    const me = get().me;
    set({ mustChangePassword: false, me: me ? { ...me, mustChangePassword: false } : me });
  },
  clear() {
    set({ me: null, mustChangePassword: false, loading: false });
  },
}));

// Any call refused because the password must be changed brings the screen of the change
registerPasswordChangeHandler(() => useAccountStore.setState({ mustChangePassword: true }));
