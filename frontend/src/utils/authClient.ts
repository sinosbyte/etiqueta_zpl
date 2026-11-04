import { apiMessage } from '../i18n';

const TOKEN_KEY = 'zpl_token';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// Decode JWT payload without verifying signature (client-side only)
function decodePayload(token: string): { exp?: number } | null {
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodePayload(token);
  if (!payload?.exp) return true;
  return Date.now() / 1000 >= payload.exp;
}

// Global 401 handler — set by useAuthStore so clients can trigger logout
let on401: (() => void) | null = null;
export function registerOn401Handler(handler: () => void) {
  on401 = handler;
}
export function triggerOn401() {
  on401?.();
}

export async function apiRegister(username: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(apiMessage(data.error, 'api.registrationFailed'));
  }
}

export async function apiLogin(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(apiMessage(data.error, 'api.loginFailed'));
  return data.token as string;
}

/**
 * Exchange the httpOnly refresh cookie for a new access token.
 * Returns the new token (also persisted) or null when the session can't be renewed.
 * Concurrent callers share a single in-flight request (single-flight).
 */
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const data = await res.json();
        const token = data.token as string;
        saveToken(token);
        return token;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Revoke the refresh token server-side and clear the cookie. Best-effort. */
export async function apiLogout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore — the local token is cleared regardless.
  }
}
