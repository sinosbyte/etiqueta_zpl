import { create } from 'zustand';
import {
  getToken, saveToken, clearToken, isTokenExpired, registerOn401Handler,
  apiLogin, apiLogout, refreshAccessToken, apiSignUp,
} from '../utils/authClient';

interface AuthStore {
  token: string | null;
  login(username: string, password: string): Promise<void>;
  signUp(payload: Record<string, string>): Promise<void>;
  logout(): void;
}

function loadInitialToken(): string | null {
  const token = getToken();
  if (!token || isTokenExpired(token)) {
    clearToken();
    return null;
  }
  return token;
}

export const useAuthStore = create<AuthStore>((set) => {
  const store = {
    token: loadInitialToken(),

    async login(username: string, password: string) {
      const token = await apiLogin(username, password);
      saveToken(token);
      set({ token });
    },

    async signUp(payload: Record<string, string>) {
      const token = await apiSignUp(payload);
      saveToken(token);
      set({ token });
    },

    logout() {
      void apiLogout(); // revoke server-side refresh token (best-effort)
      clearToken();
      set({ token: null });
    },
  };

  // When any API call gets a 401 that can't be refreshed, log the user out
  registerOn401Handler(() => {
    clearToken();
    set({ token: null });
  });

  // No valid access token on load, but a refresh cookie may still be alive —
  // try a silent refresh so a page reload doesn't force re-login.
  if (!store.token) {
    void refreshAccessToken().then((token) => {
      if (token) set({ token });
    });
  }

  return store;
});
