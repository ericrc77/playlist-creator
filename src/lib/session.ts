// Liga configuração, tokens e o cliente da API.

import { clearTokens, loadTokens, refreshTokens, type AuthConfig, type KVStore, type Tokens } from './auth';
import { SpotifyClient } from './spotify';

const CLIENT_ID_KEY = 'mum.clientId';

export function readConfig(local: KVStore, origin: string): AuthConfig {
  const envId = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
  const envRedirect = (import.meta.env.VITE_SPOTIFY_REDIRECT_URI as string | undefined)?.trim();
  return {
    clientId: envId || local.getItem(CLIENT_ID_KEY) || '',
    redirectUri: envRedirect || `${origin}/callback`,
  };
}

export function saveClientId(local: KVStore, clientId: string) {
  local.setItem(CLIENT_ID_KEY, clientId.trim());
}

/** O Client ID do Spotify tem 32 caracteres hexadecimais. */
export function isValidClientId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id.trim());
}

export function makeClient(
  cfg: AuthConfig,
  store: KVStore,
  onLoggedOut: () => void,
  fetchFn?: typeof fetch,
  now: () => number = Date.now,
): SpotifyClient {
  let refreshing: Promise<Tokens> | null = null;
  const refresh = async (): Promise<Tokens> => {
    const current = loadTokens(store);
    if (!current) throw new Error('Não conectado ao Spotify.');
    refreshing ??= refreshTokens(cfg, current, store, fetchFn, now).finally(() => (refreshing = null));
    try {
      return await refreshing;
    } catch (e) {
      clearTokens(store);
      onLoggedOut();
      throw e;
    }
  };
  return new SpotifyClient({
    fetchFn,
    getAccessToken: async () => {
      const t = loadTokens(store);
      if (!t) {
        onLoggedOut();
        throw new Error('Não conectado ao Spotify.');
      }
      if (t.expiresAt - 60_000 > now()) return t.accessToken;
      return (await refresh()).accessToken;
    },
    onUnauthorized: async () => (await refresh()).accessToken,
  });
}
