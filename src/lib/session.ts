// Sessão do Spotify no navegador: access token em memória, renovado pelo cookie HttpOnly.

import { AuthError, logout, refreshAccess, type AccessToken, type AuthConfig } from './auth';
import { SpotifyClient } from './spotify';

export function readConfig(origin: string): AuthConfig {
  const clientId = ((import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? '').trim();
  // O servidor usa sempre `${origin}/callback`; o navegador precisa usar o mesmo valor.
  return { clientId, redirectUri: `${origin}/callback` };
}

export class AuthSession {
  private token: AccessToken | null = null;
  private refreshing: Promise<AccessToken> | null = null;

  constructor(
    private onChange: (connected: boolean) => void,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
    private now: () => number = Date.now,
  ) {}

  get current(): AccessToken | null {
    return this.token;
  }

  set(token: AccessToken) {
    this.token = token;
    this.onChange(true);
  }

  /** Renovação com uma única requisição em voo (várias chamadas simultâneas esperam a mesma). */
  refresh(): Promise<AccessToken> {
    this.refreshing ??= refreshAccess(this.fetchFn)
      .then((t) => {
        this.set(t);
        return t;
      })
      .catch((e) => {
        if (e instanceof AuthError && e.loggedOut) {
          this.token = null;
          this.onChange(false);
        }
        throw e;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** Tenta recuperar a sessão ao abrir o app. Retorna false se não houver sessão. */
  async restore(): Promise<boolean> {
    try {
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.accessToken;
    return (await this.refresh()).accessToken;
  }

  async logout() {
    this.token = null;
    await logout(this.fetchFn);
    this.onChange(false);
  }

  client(fetchFn?: typeof fetch): SpotifyClient {
    return new SpotifyClient({
      fetchFn,
      getAccessToken: () => this.accessToken(),
      onUnauthorized: async () => (await this.refresh()).accessToken,
    });
  }
}
