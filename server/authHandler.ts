// "Backend for frontend" mínimo para o login do Spotify.
//
// Por quê: para não pedir login a cada acesso, o refresh token precisa durar entre visitas.
// Guardá-lo em localStorage o deixaria legível por qualquer script da página (XSS). Aqui ele
// fica num cookie HttpOnly, cifrado (AES-256-GCM) com SESSION_SECRET, e só estas rotas o leem.
// O navegador recebe apenas o access token (1 h), que fica em memória.
//
// O fluxo continua sendo Authorization Code + PKCE de cliente público: não há client secret.
//
// Rotas (todas POST, mesma origem, cabeçalho X-MUM obrigatório):
//   /api/auth/exchange  { code, codeVerifier } → troca o code, grava o cookie, devolve o access token
//   /api/auth/refresh   → renova com o cookie (e rotaciona o refresh token se o Spotify mandar outro)
//   /api/auth/logout    → apaga o cookie

export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const CSRF_HEADER = 'x-mum';
const COOKIE_BASE = 'mum_rt';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 dias; renovado a cada uso

export interface AuthEnv {
  clientId: string;
  /** Segredo do servidor para cifrar o cookie (≥ 32 caracteres). Nunca vai ao navegador. */
  sessionSecret: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface SessionPayload {
  rt: string;
  scope: string;
}

/** Conteúdo cifrado: além do refresh token, a validade, conferida no servidor (não só pelo navegador). */
interface SealedPayload extends SessionPayload {
  /** epoch ms; renovada a cada uso, como o Max-Age do cookie */
  exp: number;
}

export interface AccessTokenResponse {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const fail = (status: number, error: string, message: string, headers: Record<string, string> = {}) =>
  json(status, { error, message }, headers);

/** HTTP só é aceito em loopback (desenvolvimento local); em produção o cookie é __Host- + Secure. */
function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

export function cookieName(url: URL): string {
  return isLoopbackHttp(url) ? COOKIE_BASE : `__Host-${COOKIE_BASE}`;
}

function setCookie(url: URL, value: string, maxAge: number): string {
  const secure = isLoopbackHttp(url) ? '' : '; Secure';
  return `${cookieName(url)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

// --- cifra do cookie -------------------------------------------------------

const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSession(secret: string, payload: SessionPayload, now = Date.now()): Promise<string> {
  const sealed: SealedPayload = { rt: payload.rt, scope: payload.scope, exp: now + COOKIE_MAX_AGE * 1000 };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), new TextEncoder().encode(JSON.stringify(sealed)));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out);
}

export async function openSession(secret: string, sealed: string, now = Date.now()): Promise<SessionPayload | null> {
  try {
    const data = fromB64url(sealed);
    if (data.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, await aesKey(secret), data.slice(12));
    const p = JSON.parse(new TextDecoder().decode(pt)) as Partial<SealedPayload>;
    // Sem `exp` (formato antigo) ou vencido: uma cópia antiga do cookie não vale para sempre.
    if (typeof p.rt !== 'string' || !p.rt || typeof p.exp !== 'number' || p.exp <= now) return null;
    return { rt: p.rt, scope: typeof p.scope === 'string' ? p.scope : '' };
  } catch {
    return null; // adulterado ou segredo trocado
  }
}

// --- handler ---------------------------------------------------------------

/** Barreiras contra CSRF: método POST, cabeçalho customizado (exige preflight CORS, que não é
 * liberado) e, quando o navegador informa, Origin igual à do próprio app. O cookie é SameSite=Strict. */
function csrfProblem(request: Request, url: URL): Response | null {
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { Allow: 'POST' });
  if (request.headers.get(CSRF_HEADER) !== '1') return fail(403, 'csrf', 'Requisição recusada.');
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return fail(403, 'csrf', 'Origem não permitida.');
  return null;
}

export async function handleAuth(request: Request, action: string, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const problem = csrfProblem(request, url);
  if (problem) return problem;

  // Sair só apaga o cookie: não depende de Client ID nem de SESSION_SECRET e precisa funcionar
  // mesmo com o servidor mal configurado.
  if (action === 'logout') return json(200, { ok: true }, { 'Set-Cookie': setCookie(url, '', 0) });

  if (!env.clientId) return fail(500, 'config', 'VITE_SPOTIFY_CLIENT_ID não está configurado no servidor.');
  if (!env.sessionSecret || env.sessionSecret.length < 32) {
    return fail(500, 'config', 'SESSION_SECRET não está configurado no servidor (mínimo de 32 caracteres).');
  }
  if (!isLoopbackHttp(url) && url.protocol !== 'https:') return fail(400, 'insecure', 'Use HTTPS.');

  const fetchFn = env.fetchFn ?? fetch;
  const now = env.now ?? Date.now;
  const name = cookieName(url);
  const clear = { 'Set-Cookie': setCookie(url, '', 0) };

  switch (action) {
    case 'exchange': {
      let body: { code?: unknown; codeVerifier?: unknown };
      try {
        body = await request.json();
      } catch {
        return fail(400, 'bad_request', 'Corpo inválido.');
      }
      if (typeof body.code !== 'string' || typeof body.codeVerifier !== 'string' || !body.code || !body.codeVerifier) {
        return fail(400, 'bad_request', 'Faltam code ou codeVerifier.');
      }
      // O redirect_uri é derivado do próprio servidor: não aceitamos um valor vindo do cliente.
      const res = await spotifyToken(fetchFn, {
        grant_type: 'authorization_code',
        code: body.code,
        redirect_uri: `${url.origin}/callback`,
        client_id: env.clientId,
        code_verifier: body.codeVerifier,
      });
      if (!res.ok) return fail(res.status === 400 ? 400 : 502, 'spotify', res.message);
      if (!res.body.refresh_token) return fail(502, 'spotify', 'O Spotify não devolveu refresh token.');
      return issue(url, env, now, res.body, res.body.refresh_token, '');
    }

    case 'refresh': {
      const sealed = readCookie(request, name);
      const session = sealed ? await openSession(env.sessionSecret, sealed, now()) : null;
      if (!session) return fail(401, 'no_session', 'Conecte o Spotify.', sealed ? clear : {});
      const res = await spotifyToken(fetchFn, { grant_type: 'refresh_token', refresh_token: session.rt, client_id: env.clientId });
      if (!res.ok) {
        // Só invalid_grant (acesso revogado, refresh token vencido ou já substituído) encerra a
        // sessão. invalid_client e afins são erro de configuração: o cookie continua válido e volta
        // a funcionar quando a configuração for corrigida.
        if (res.error === 'invalid_grant') return fail(401, 'no_session', 'Sessão expirada. Conecte o Spotify novamente.', clear);
        return fail(502, 'spotify', res.message);
      }
      return issue(url, env, now, res.body, res.body.refresh_token ?? session.rt, session.scope);
    }

    default:
      return fail(404, 'not_found', 'Rota desconhecida.');
  }
}

interface SpotifyTokenBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function spotifyToken(
  fetchFn: typeof fetch,
  params: Record<string, string>,
): Promise<{ ok: true; body: SpotifyTokenBody } | { ok: false; status: number; error: string; message: string }> {
  let res: Response;
  try {
    res = await fetchFn(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  } catch {
    return { ok: false, status: 502, error: 'network', message: 'Falha de conexão com o Spotify.' };
  }
  if (!res.ok) {
    let detail = '';
    let error = '';
    try {
      const b = (await res.json()) as { error?: unknown; error_description?: unknown };
      error = typeof b.error === 'string' ? b.error : '';
      detail = (typeof b.error_description === 'string' && b.error_description) || error;
    } catch {
      /* sem corpo JSON */
    }
    return { ok: false, status: res.status, error, message: `O Spotify recusou o acesso (${res.status}${detail ? `: ${detail}` : ''}).` };
  }
  return { ok: true, body: (await res.json()) as SpotifyTokenBody };
}

async function issue(url: URL, env: AuthEnv, now: () => number, body: SpotifyTokenBody, rt: string, previousScope: string) {
  // Sem `scope` na resposta, os escopos não mudaram (RFC 6749 §5.1).
  const scope = body.scope ?? previousScope;
  const sealed = await sealSession(env.sessionSecret, { rt, scope }, now());
  const out: AccessTokenResponse = { accessToken: body.access_token, expiresAt: now() + body.expires_in * 1000, scope };
  return json(200, out, { 'Set-Cookie': setCookie(url, sealed, COOKIE_MAX_AGE) });
}

/** Lê a configuração do servidor a partir do ambiente (Vercel ou .env.local no dev). */
export function envFromProcess(source: Record<string, string | undefined>): AuthEnv {
  return {
    clientId: (source.SPOTIFY_CLIENT_ID || source.VITE_SPOTIFY_CLIENT_ID || '').trim(),
    sessionSecret: (source.SESSION_SECRET || '').trim(),
  };
}
