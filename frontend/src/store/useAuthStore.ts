import { create } from 'zustand';
import {
  getToken, saveToken, clearToken, isTokenExpired, registerOn401Handler,
  apiLogin, apiLogout, refreshAccessToken, apiSignUp, tokenUserId,
} from '../utils/authClient';
import { resetEditorSession } from '../utils/editorSession';

interface AuthStore {
  token: string | null;
  login(username: string, password: string): Promise<void>;
  signUp(payload: Record<string, string>): Promise<void>;
  logout(): void;
}

// A session that ended by itself (expired, or the account was disabled) keeps the editor as it was, so that the
// same person signing in again goes on with their work; whose it was is remembered here. Someone else signing in
// gets a blank editor. Signing out on purpose always clears it (after the confirmation, when there are changes).
let suspendedOwner: number | null = null;
const UNKNOWN_OWNER = -1;

/** A new session starts: the editor of another person's ended session is not shown to it. */
function startSession(token: string): void {
  if (suspendedOwner !== null && suspendedOwner !== tokenUserId(token)) resetEditorSession();
  suspendedOwner = null;
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
      startSession(token);
      saveToken(token);
      set({ token });
    },

    async signUp(payload: Record<string, string>) {
      const token = await apiSignUp(payload);
      startSession(token);
      saveToken(token);
      set({ token });
    },

    logout() {
      void apiLogout(); // revoke server-side refresh token (best-effort)
      clearToken();
      suspendedOwner = null;
      resetEditorSession();
      set({ token: null });
    },
  };

  // When any API call gets a 401 that can't be refreshed, log the user out
  registerOn401Handler(() => {
    // Whose work stays in the editor; unknown means any next session starts blank
    const owner = tokenUserId(getToken());
    if (owner !== null) suspendedOwner = owner;
    else if (suspendedOwner === null) suspendedOwner = UNKNOWN_OWNER;
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
