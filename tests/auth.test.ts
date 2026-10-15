import { beginLogin, codeChallenge, completeLogin, loadTokens, missingScopes, randomString, refreshTokens, SCOPES } from '../src/lib/auth';
import { jsonResponse, MemoryStore } from './helpers';

const cfg = { clientId: 'a'.repeat(32), redirectUri: 'http://127.0.0.1:5173/callback' };

describe('PKCE', () => {
  it('gera verifier com caracteres permitidos', () => {
    const v = randomString(64);
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('calcula o code_challenge S256 do exemplo da RFC 7636', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('monta a URL de autorização com escopos mínimos e state', async () => {
    const store = new MemoryStore();
    const url = new URL(await beginLogin(cfg, store));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(p.get('scope')).toBe(SCOPES.join(' '));
    expect(p.get('state')).toBe(store.getItem('mum.pkce.state'));
    expect(p.get('code_challenge')).toBe(await codeChallenge(store.getItem('mum.pkce.verifier')!));
    expect(url.search).not.toMatch(/secret/i);
  });
});

describe('completeLogin', () => {
  async function setup() {
    const store = new MemoryStore();
    const url = new URL(await beginLogin(cfg, store));
    return { store, state: url.searchParams.get('state')!, verifier: store.getItem('mum.pkce.verifier')! };
  }

  it('troca o code por tokens com o verifier, sem client secret', async () => {
    const { store, state, verifier } = await setup();
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: SCOPES.join(' ') }));
    const tokens = await completeLogin(cfg, `${cfg.redirectUri}?code=C&state=${state}`, store, fetchFn as unknown as typeof fetch, () => 1000);
    expect(tokens).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 1000 + 3600_000, scope: SCOPES.join(' ') });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('code_verifier')).toBe(verifier);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.has('client_secret')).toBe(false);
    expect(loadTokens(store)?.accessToken).toBe('AT');
    expect(store.getItem('mum.pkce.verifier')).toBeNull();
  });

  it('recusa state diferente (CSRF)', async () => {
    const { store } = await setup();
    const fetchFn = vi.fn();
    await expect(completeLogin(cfg, `${cfg.redirectUri}?code=C&state=outro`, store, fetchFn as unknown as typeof fetch)).rejects.toThrow(/state/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('explica quando o usuário recusa', async () => {
    const { store, state } = await setup();
    await expect(completeLogin(cfg, `${cfg.redirectUri}?error=access_denied&state=${state}`, store)).rejects.toThrow(/recusou/);
  });

  it('confere o state antes de tratar um retorno de erro (revisão Codex F5)', async () => {
    const { store } = await setup();
    await expect(completeLogin(cfg, `${cfg.redirectUri}?error=access_denied`, store)).rejects.toThrow(/state/);
    await expect(completeLogin(cfg, `${cfg.redirectUri}?error=access_denied&state=outro`, store)).rejects.toThrow(/state/);
  });

  it('mantém os escopos quando a resposta não traz `scope` (revisão Codex F6)', async () => {
    const { store, state } = await setup();
    const login = vi.fn(async () => jsonResponse(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }));
    const t = await completeLogin(cfg, `${cfg.redirectUri}?code=C&state=${state}`, store, login as unknown as typeof fetch, () => 0);
    expect(missingScopes(t)).toEqual([]);
    const refresh = vi.fn(async () => jsonResponse(200, { access_token: 'AT2', expires_in: 3600 }));
    const r = await refreshTokens(cfg, { ...t, scope: 'playlist-modify-private' }, store, refresh as unknown as typeof fetch, () => 0);
    expect(r.scope).toBe('playlist-modify-private');
  });

  it('mantém o refresh token anterior quando o Spotify não envia outro', async () => {
    const store = new MemoryStore();
    const fetchFn = vi.fn(async () => jsonResponse(200, { access_token: 'AT2', expires_in: 3600, scope: '' }));
    const t = await refreshTokens(cfg, { accessToken: 'AT', refreshToken: 'RT', expiresAt: 0, scope: '' }, store, fetchFn as unknown as typeof fetch, () => 0);
    expect(t.refreshToken).toBe('RT');
    expect(t.accessToken).toBe('AT2');
  });

  it('detecta escopos faltando', () => {
    expect(missingScopes({ accessToken: '', expiresAt: 0, scope: 'playlist-modify-private' })).toEqual(['playlist-modify-public']);
  });
});
