import { apiFetch } from './apiClient';

export interface TokenSummary {
  id: number;
  name: string;
  /** First characters of the token, to tell tokens apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** The creation response is the only time the full token is available. */
export interface CreatedToken extends TokenSummary {
  token: string;
}

export const apiListTokens = (): Promise<{ items: TokenSummary[] }> => apiFetch('/api/tokens');

export const apiCreateToken = (name: string, expiresInDays?: number): Promise<CreatedToken> =>
  apiFetch('/api/tokens', { method: 'POST', body: JSON.stringify({ name, ...(expiresInDays ? { expiresInDays } : {}) }) });

export const apiRevokeToken = (id: number): Promise<void> => apiFetch(`/api/tokens/${id}`, { method: 'DELETE' });

export const apiDeleteToken = (id: number): Promise<void> => apiFetch(`/api/tokens/${id}/permanent`, { method: 'DELETE' });
