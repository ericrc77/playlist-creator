import { beginLogin, codeChallenge, completeLogin, missingScopes, randomString, refreshAccess, SCOPES } from '../src/lib/auth';
import { AuthSession } from '../src/lib/session';
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

  it('manda code e verifier ao servidor do app (não ao Spotify) e não guarda token no storage', async () => {
    const { store, state, verifier } = await setup();
    const fetchFn = vi.fn(async () => jsonResponse(200, { accessToken: 'AT', expiresAt: 5, scope: SCOPES.join(' ') }));
    const t = await completeLogin(`${cfg.redirectUri}?code=C&state=${state}`, store, fetchFn as unknown as typeof fetch);
    expect(t).toEqual({ accessToken: 'AT', expiresAt: 5, scope: SCOPES.join(' ') });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/exchange');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-MUM']).toBe('1');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'C', codeVerifier: verifier });
    expect([...store.data.keys()]).toEqual([]);
  });

  it('recusa state diferente (CSRF) sem chamar o servidor', async () => {
    const { store } = await setup();
    const fetchFn = vi.fn();
    await expect(completeLogin(`${cfg.redirectUri}?code=C&state=outro`, store, fetchFn as unknown as typeof fetch)).rejects.toThrow(/state/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('confere o state antes de mostrar erro vindo na URL', async () => {
    const { store } = await setup();
    await expect(completeLogin(`${cfg.redirectUri}?error=access_denied&state=forjado`, store)).rejects.toThrow(/state/);
  });

  it('explica quando o usuário recusa', async () => {
    const { store, state } = await setup();
    await expect(completeLogin(`${cfg.redirectUri}?error=access_denied&state=${state}`, store)).rejects.toThrow(/recusou/);
  });

  it('mostra a mensagem do servidor quando a troca falha', async () => {
    const { store, state } = await setup();
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: 'config', message: 'SESSION_SECRET não está configurado' }));
    await expect(completeLogin(`${cfg.redirectUri}?code=C&state=${state}`, store, fetchFn as unknown as typeof fetch)).rejects.toThrow(/SESSION_SECRET/);
  });

  it('detecta escopos faltando', () => {
    expect(missingScopes({ accessToken: '', expiresAt: 0, scope: 'playlist-modify-private' })).toEqual(['playlist-modify-public']);
  });
});

describe('AuthSession', () => {
  it('restaura a sessão pelo cookie e mantém o token só em memória', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { accessToken: 'AT', expiresAt: 10_000_000, scope: '' }));
    const onChange = vi.fn();
    const s = new AuthSession(onChange, fetchFn as unknown as typeof fetch, () => 0);
    expect(await s.restore()).toBe(true);
    expect(await s.accessToken()).toBe('AT');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('sem cookie: restore devolve false', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: 'no_session', message: 'Conecte o Spotify.' }));
    const onChange = vi.fn();
    const s = new AuthSession(onChange, fetchFn as unknown as typeof fetch);
    expect(await s.restore()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('renova perto de expirar, com uma única requisição para chamadas simultâneas', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => jsonResponse(200, { accessToken: `AT${++n}`, expiresAt: 30_000, scope: '' }));
    const s = new AuthSession(() => {}, fetchFn as unknown as typeof fetch, () => 0);
    const [a, b] = await Promise.all([s.accessToken(), s.accessToken()]);
    expect(a).toBe('AT1');
    expect(b).toBe('AT1');
    // expira em 30 s (< margem de 60 s): a próxima chamada renova
    expect(await s.accessToken()).toBe('AT2');
  });

  it('falha temporária na renovação não desconecta', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(502, { message: 'Falha de conexão com o Spotify.' }));
    const onChange = vi.fn();
    const s = new AuthSession(onChange, fetchFn as unknown as typeof fetch);
    await expect(refreshAccess(fetchFn as unknown as typeof fetch)).rejects.toThrow(/Falha/);
    await expect(s.refresh()).rejects.toThrow();
    expect(onChange).not.toHaveBeenCalledWith(false);
  });

  it('logout chama o servidor para apagar o cookie', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    const onChange = vi.fn();
    const s = new AuthSession(onChange, fetchFn as unknown as typeof fetch);
    await s.logout();
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('/api/auth/logout');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
