// Spotify OAuth: Authorization Code + PKCE. Não usa client secret.
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Escopos mínimos: criar playlist privada/pública e adicionar faixas. */
export const SCOPES = ['playlist-modify-private', 'playlist-modify-public'];

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
  scope: string;
}

export interface AuthConfig {
  clientId: string;
  redirectUri: string;
}

/** Armazenamento mínimo usado pelo app (sessionStorage no navegador; Map nos testes). */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VERIFIER_KEY = 'mum.pkce.verifier';
const STATE_KEY = 'mum.pkce.state';
const TOKENS_KEY = 'mum.tokens';

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function randomString(length: number): string {
  // Amostragem por rejeição: evita viés do módulo (256 não é múltiplo de 66).
  const limit = 256 - (256 % UNRESERVED.length);
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += UNRESERVED[b % UNRESERVED.length];
    }
  }
  return out;
}

export function base64Url(bytes: ArrayBuffer): string {
  let bin = '';
  new Uint8Array(bytes).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(digest);
}

/** Gera verifier/state, guarda no storage e devolve a URL de autorização. */
export async function beginLogin(cfg: AuthConfig, store: KVStore): Promise<string> {
  const verifier = randomString(64);
  const state = randomString(32);
  store.setItem(VERIFIER_KEY, verifier);
  store.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    scope: SCOPES.join(' '),
    redirect_uri: cfg.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export class AuthError extends Error {}

/** Trata o retorno do Spotify em /callback. Valida `state` (CSRF) e troca o code por tokens. */
export async function completeLogin(
  cfg: AuthConfig,
  callbackUrl: string,
  store: KVStore,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Tokens> {
  const params = new URL(callbackUrl).searchParams;
  const expectedState = store.getItem(STATE_KEY);
  const verifier = store.getItem(VERIFIER_KEY);
  store.removeItem(STATE_KEY);
  store.removeItem(VERIFIER_KEY);

  // O state é conferido antes de tudo, inclusive antes de tratar `error`: um retorno forjado
  // não deve ser apresentado como resposta legítima do Spotify.
  if (!expectedState || params.get('state') !== expectedState || !verifier) {
    throw new AuthError('Falha de verificação de segurança (state). Tente conectar novamente.');
  }
  const error = params.get('error');
  if (error) {
    throw new AuthError(error === 'access_denied' ? 'Você recusou a autorização no Spotify.' : `O Spotify retornou erro: ${error}`);
  }
  const code = params.get('code');
  if (!code) throw new AuthError('Retorno do Spotify sem código de autorização.');

  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      code_verifier: verifier,
    }),
  });
  const tokens = await readTokenResponse(res, now, undefined, SCOPES.join(' '));
  saveTokens(store, tokens);
  return tokens;
}

export async function refreshTokens(
  cfg: AuthConfig,
  current: Tokens,
  store: KVStore,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Tokens> {
  if (!current.refreshToken) throw new AuthError('Sessão expirada. Conecte o Spotify novamente.');
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: cfg.clientId,
    }),
  });
  const tokens = await readTokenResponse(res, now, current.refreshToken, current.scope);
  saveTokens(store, tokens);
  return tokens;
}

async function readTokenResponse(
  res: Response,
  now: () => number,
  previousRefresh: string | undefined,
  previousScope: string,
): Promise<Tokens> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; error_description?: string };
      detail = body.error_description || body.error || '';
    } catch {
      /* sem corpo JSON */
    }
    throw new AuthError(`Não foi possível obter acesso ao Spotify (${res.status}${detail ? `: ${detail}` : ''}). Conecte novamente.`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: body.access_token,
    // O Spotify pode não devolver um refresh token novo; nesse caso, mantém o anterior.
    refreshToken: body.refresh_token ?? previousRefresh,
    expiresAt: now() + body.expires_in * 1000,
    // Sem `scope` na resposta, os escopos não mudaram (RFC 6749 §5.1).
    scope: body.scope ?? previousScope,
  };
}

export function saveTokens(store: KVStore, tokens: Tokens): void {
  store.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function loadTokens(store: KVStore): Tokens | null {
  const raw = store.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export function clearTokens(store: KVStore): void {
  store.removeItem(TOKENS_KEY);
}

export function missingScopes(tokens: Tokens): string[] {
  const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
  return SCOPES.filter((s) => !granted.has(s));
}
