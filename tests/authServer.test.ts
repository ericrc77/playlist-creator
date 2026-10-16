// @vitest-environment node
import { handleAuth, openSession, sealSession, SPOTIFY_TOKEN_URL, type AuthEnv } from '../server/authHandler';

const SECRET = 's'.repeat(40);
const PROD = 'https://mum.vercel.app';
const LOCAL = 'http://127.0.0.1:5173';

function req(base: string, action: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string>; method?: string } = {}) {
  return new Request(`${base}/api/auth/${action}`, {
    method: init.method ?? 'POST',
    headers: {
      'x-mum': '1',
      origin: base,
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

function spotify(responses: Response[]) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body)) });
    return responses.shift()!;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const env = (fetchFn: typeof fetch): AuthEnv => ({ clientId: 'c'.repeat(32), sessionSecret: SECRET, fetchFn, now: () => 1000 });

function cookieFrom(res: Response) {
  return res.headers.get('set-cookie')!;
}

describe('cookie cifrado', () => {
  it('abre só com o mesmo segredo e recusa adulteração', async () => {
    const sealed = await sealSession(SECRET, { rt: 'RT', scope: 'x' });
    expect(sealed).not.toContain('RT');
    expect(await openSession(SECRET, sealed)).toEqual({ rt: 'RT', scope: 'x' });
    expect(await openSession('outro'.repeat(10), sealed)).toBeNull();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
    expect(await openSession(SECRET, tampered)).toBeNull();
  });
});

describe('/api/auth/exchange', () => {
  it('troca o code com PKCE (sem client secret), grava cookie HttpOnly e devolve só o access token', async () => {
    const s = spotify([ok({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'playlist-modify-private' })]);
    const res = await handleAuth(req(PROD, 'exchange', { body: { code: 'C', codeVerifier: 'V' } }), 'exchange', env(s.fetchFn));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ accessToken: 'AT', expiresAt: 1000 + 3600_000, scope: 'playlist-modify-private' });
    expect(JSON.stringify(body)).not.toContain('RT');
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^__Host-mum_rt=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(s.calls[0].url).toBe(SPOTIFY_TOKEN_URL);
    expect(Object.fromEntries(s.calls[0].body)).toEqual({
      grant_type: 'authorization_code',
      code: 'C',
      redirect_uri: `${PROD}/callback`,
      client_id: 'c'.repeat(32),
      code_verifier: 'V',
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('em http://127.0.0.1 (dev) usa cookie sem __Host-/Secure', async () => {
    const s = spotify([ok({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })]);
    const res = await handleAuth(req(LOCAL, 'exchange', { body: { code: 'C', codeVerifier: 'V' } }), 'exchange', env(s.fetchFn));
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^mum_rt=/);
    expect(cookie).not.toContain('Secure');
  });

  it('recusa http fora do loopback', async () => {
    const s = spotify([]);
    const res = await handleAuth(req('http://mum.example.com', 'exchange', { body: { code: 'C', codeVerifier: 'V' } }), 'exchange', env(s.fetchFn));
    expect(res.status).toBe(400);
  });

  it('repassa erro do Spotify sem gravar cookie', async () => {
    const s = spotify([new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })]);
    const res = await handleAuth(req(PROD, 'exchange', { body: { code: 'C', codeVerifier: 'V' } }), 'exchange', env(s.fetchFn));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('/api/auth/refresh', () => {
  async function loggedCookie() {
    const s = spotify([ok({ access_token: 'AT', refresh_token: 'RT1', expires_in: 3600, scope: 'a b' })]);
    const res = await handleAuth(req(PROD, 'exchange', { body: { code: 'C', codeVerifier: 'V' } }), 'exchange', env(s.fetchFn));
    return cookieFrom(res).split(';')[0];
  }

  it('renova com o refresh token do cookie e rotaciona quando o Spotify manda outro', async () => {
    const cookie = await loggedCookie();
    const s = spotify([ok({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })]);
    const res = await handleAuth(req(PROD, 'refresh', { cookie }), 'refresh', env(s.fetchFn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accessToken: 'AT2', scope: 'a b' });
    expect(Object.fromEntries(s.calls[0].body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'RT1', client_id: 'c'.repeat(32) });
    const rotated = cookieFrom(res).split(';')[0].split('=')[1];
    expect((await openSession(SECRET, rotated))?.rt).toBe('RT2');
  });

  it('mantém o refresh token anterior quando o Spotify não manda outro', async () => {
    const cookie = await loggedCookie();
    const s = spotify([ok({ access_token: 'AT2', expires_in: 3600 })]);
    const res = await handleAuth(req(PROD, 'refresh', { cookie }), 'refresh', env(s.fetchFn));
    const sealed = cookieFrom(res).split(';')[0].split('=')[1];
    expect((await openSession(SECRET, sealed))?.rt).toBe('RT1');
  });

  it('sem cookie: 401 sem chamar o Spotify', async () => {
    const s = spotify([]);
    const res = await handleAuth(req(PROD, 'refresh'), 'refresh', env(s.fetchFn));
    expect(res.status).toBe(401);
    expect(s.calls).toHaveLength(0);
  });

  it('acesso revogado (invalid_grant): 401 e apaga o cookie', async () => {
    const cookie = await loggedCookie();
    const s = spotify([new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })]);
    const res = await handleAuth(req(PROD, 'refresh', { cookie }), 'refresh', env(s.fetchFn));
    expect(res.status).toBe(401);
    expect(cookieFrom(res)).toContain('Max-Age=0');
  });

  it('falha temporária do Spotify: 502 e mantém o cookie', async () => {
    const cookie = await loggedCookie();
    const s = spotify([new Response('', { status: 503 })]);
    const res = await handleAuth(req(PROD, 'refresh', { cookie }), 'refresh', env(s.fetchFn));
    expect(res.status).toBe(502);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('proteções', () => {
  it.each([
    ['sem cabeçalho X-MUM', req(PROD, 'refresh', { headers: { 'x-mum': '' } })],
    ['de outra origem', req(PROD, 'refresh', { headers: { origin: 'https://malicioso.example' } })],
  ])('recusa requisição %s', async (_n, r) => {
    const s = spotify([]);
    const res = await handleAuth(r, 'refresh', env(s.fetchFn));
    expect(res.status).toBe(403);
    expect(s.calls).toHaveLength(0);
  });

  it('recusa GET', async () => {
    const res = await handleAuth(req(PROD, 'refresh', { method: 'GET' }), 'refresh', env(spotify([]).fetchFn));
    expect(res.status).toBe(405);
  });

  it('exige SESSION_SECRET com 32+ caracteres', async () => {
    const res = await handleAuth(req(PROD, 'refresh'), 'refresh', { clientId: 'c', sessionSecret: 'curto' });
    expect(res.status).toBe(500);
    expect((await res.json()).message).toMatch(/SESSION_SECRET/);
  });

  it('logout apaga o cookie', async () => {
    const res = await handleAuth(req(PROD, 'logout'), 'logout', env(spotify([]).fetchFn));
    expect(cookieFrom(res)).toMatch(/^__Host-mum_rt=; .*Max-Age=0/);
  });
});
