// Sessão do Spotify no navegador: access token em memória, renovado pelo cookie HttpOnly.

import { AuthError, logout, refreshAccess, type AccessToken, type AuthConfig } from './auth';
import { SpotifyClient } from './spotify';

export function readConfig(origin: string): AuthConfig {
  const clientId = ((import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? '').trim();
  // O servidor usa sempre `${origin}/callback`; o navegador precisa usar o mesmo valor.
  return { clientId, redirectUri: `${origin}/callback` };
}

/** Executa `fn` com exclusão mútua entre as abas do mesmo app. */
export type AuthLock = <T>(fn: () => Promise<T>) => Promise<T>;

// Renovação e saída passam por uma trava compartilhada entre abas (Web Locks). Sem ela, duas abas
// renovando ao mesmo tempo mandam o mesmo refresh token; se o Spotify o rotacionar, a segunda
// recebe invalid_grant e o servidor apaga o cookie que a primeira acabou de gravar. Com a trava, a
// segunda aba só faz a requisição depois, já com o cookie novo.
const browserLock: AuthLock = (fn) =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('mum.auth', fn) : fn();

export class AuthSession {
  private token: AccessToken | null = null;
  private refreshing: Promise<AccessToken> | null = null;
  /** Muda a cada logout: uma renovação iniciada antes não reconecta a sessão depois. */
  private generation = 0;

  constructor(
    private onChange: (connected: boolean) => void,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
    private now: () => number = Date.now,
    private lock: AuthLock = browserLock,
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
    const generation = this.generation;
    this.refreshing ??= this.lock(async () => {
      const t = await refreshAccess(this.fetchFn);
      if (generation !== this.generation) throw new AuthError('Você saiu do Spotify neste aparelho.', true);
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

  /**
   * Sai só depois de o servidor confirmar que apagou o cookie. Se não confirmar (sem internet,
   * erro do servidor), lança AuthError e a sessão continua: dizer "saiu" e voltar conectado ao
   * recarregar seria pior.
   */
  async logout() {
    await this.lock(() => logout(this.fetchFn));
    this.generation++;
    this.token = null;
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
