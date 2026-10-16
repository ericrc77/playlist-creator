// Spotify OAuth: Authorization Code + PKCE, sem client secret.
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
//
// O navegador gera o verifier/state e recebe o `code`. A troca do code e a renovação passam pelas
// rotas /api/auth/* (server/authHandler.ts), que guardam o refresh token num cookie HttpOnly
// cifrado. O access token fica só em memória: nada de token em localStorage/sessionStorage.

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';

/** Escopos mínimos: criar playlist privada/pública e adicionar faixas. */
export const SCOPES = ['playlist-modify-private', 'playlist-modify-public'];

export interface AccessToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
  scope: string;
}

export interface AuthConfig {
  clientId: string;
  redirectUri: string;
}

/** Armazenamento mínimo usado pelo app (sessionStorage/localStorage no navegador; Map nos testes). */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VERIFIER_KEY = 'mum.pkce.verifier';
const STATE_KEY = 'mum.pkce.state';
const CSRF_HEADER = { 'X-MUM': '1' };

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

export class AuthError extends Error {
  constructor(
    message: string,
    /** true quando não há sessão (precisa conectar de novo), false para falhas temporárias. */
    public loggedOut = false,
  ) {
    super(message);
  }
}

async function postAuth(fetchFn: typeof fetch, action: string, body?: unknown): Promise<Response> {
  try {
    return await fetchFn(`/api/auth/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...CSRF_HEADER, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthError('Falha de conexão com o servidor do aplicativo.');
  }
}

async function readAccess(res: Response): Promise<AccessToken> {
  const body = (await res.json().catch(() => ({}))) as Partial<AccessToken> & { message?: string; error?: string };
  if (!res.ok || !body.accessToken) {
    throw new AuthError(body.message || `Erro ${res.status} ao falar com o servidor do aplicativo.`, res.status === 401);
  }
  return { accessToken: body.accessToken, expiresAt: body.expiresAt!, scope: body.scope ?? '' };
}

/** Trata o retorno do Spotify em /callback. Valida `state` (CSRF) e troca o code no servidor. */
export async function completeLogin(callbackUrl: string, store: KVStore, fetchFn: typeof fetch = fetch): Promise<AccessToken> {
  const params = new URL(callbackUrl).searchParams;
  const expectedState = store.getItem(STATE_KEY);
  const verifier = store.getItem(VERIFIER_KEY);
  store.removeItem(STATE_KEY);
  store.removeItem(VERIFIER_KEY);

  // O state é conferido antes de tudo, inclusive antes de tratar `error`: um retorno forjado
  // não deve ser apresentado como resposta legítima do Spotify.
  if (!expectedState || params.get('state') !== expectedState || !verifier) {
    throw new AuthError('Falha de verificação de segurança (state). Tente conectar novamente.', true);
  }
  const error = params.get('error');
  if (error) {
    throw new AuthError(error === 'access_denied' ? 'Você recusou a autorização no Spotify.' : `O Spotify retornou erro: ${error}`, true);
  }
  const code = params.get('code');
  if (!code) throw new AuthError('Retorno do Spotify sem código de autorização.', true);

  return readAccess(await postAuth(fetchFn, 'exchange', { code, codeVerifier: verifier }));
}

/** Pede um access token novo usando o cookie de sessão. */
export async function refreshAccess(fetchFn: typeof fetch = fetch): Promise<AccessToken> {
  return readAccess(await postAuth(fetchFn, 'refresh'));
}

/** Pede ao servidor para apagar o cookie. Lança AuthError se a saída não for confirmada. */
export async function logout(fetchFn: typeof fetch = fetch): Promise<void> {
  const fail = 'Não foi possível confirmar a saída com o servidor: você continua conectado neste aparelho. Tente de novo.';
  const res = await postAuth(fetchFn, 'logout').catch(() => {
    throw new AuthError(fail);
  });
  if (!res.ok) throw new AuthError(fail);
}

export function missingScopes(token: AccessToken): string[] {
  const granted = new Set(token.scope.split(/\s+/).filter(Boolean));
  return SCOPES.filter((s) => !granted.has(s));
}
