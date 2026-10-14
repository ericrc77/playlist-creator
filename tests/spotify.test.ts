import { SpotifyApiError, SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { jsonResponse, track } from './helpers';

function client(fake: FakeSpotify, onUnauthorized = vi.fn(async () => 'NEW')) {
  const sleep = vi.fn(async () => {});
  const c = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized, fetchFn: fake.fetch, sleep });
  return { c, sleep, onUnauthorized };
}

describe('SpotifyClient', () => {
  it('usa os endpoints atuais (POST /me/playlists e /items)', async () => {
    const fake = new FakeSpotify();
    const { c } = client(fake);
    const pl = await c.createPlaylist('X', 'd', false);
    await c.addItems(pl.id, ['spotify:track:a'], 0);
    expect(fake.calls.map((x) => `${x.method} ${x.path}`)).toEqual(['POST /me/playlists', `POST /playlists/${pl.id}/items`]);
    expect(fake.calls[0].body).toEqual({ name: 'X', description: 'd', public: false });
  });

  it('limita a busca a 10 resultados', async () => {
    const fake = new FakeSpotify();
    fake.catalog = Array.from({ length: 15 }, () => track('Paypal', ['Teto']));
    const { c } = client(fake);
    const r = await c.searchTracks('track:"Paypal"', 50);
    expect(r).toHaveLength(10);
    expect(fake.calls[0].path).toContain('limit=10');
  });

  it('espera o Retry-After em 429 e tenta de novo', async () => {
    const fake = new FakeSpotify();
    fake.fail('GET /me', jsonResponse(429, {}, { 'Retry-After': '2' }));
    const { c, sleep } = client(fake);
    await expect(c.me()).resolves.toMatchObject({ id: 'eric' });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('desiste após muitas respostas 429 com mensagem clara', async () => {
    const fake = new FakeSpotify();
    for (let i = 0; i < 5; i++) fake.fail('GET /me', jsonResponse(429, {}, { 'Retry-After': '1' }));
    const { c } = client(fake);
    await expect(c.me()).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('renova o token uma vez após 401', async () => {
    const fake = new FakeSpotify();
    fake.fail('GET /me', jsonResponse(401, { error: { message: 'expired' } }));
    const { c, onUnauthorized } = client(fake);
    await c.me();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('explica 403 (usuário fora da lista do app, Premium, escopo)', async () => {
    const fake = new FakeSpotify();
    fake.fail('POST /me/playlists', jsonResponse(403, { error: { message: 'Forbidden' } }));
    const { c } = client(fake);
    const err = await c.createPlaylist('X', '', false).catch((e) => e);
    expect(err).toBeInstanceOf(SpotifyApiError);
    expect(err.kind).toBe('forbidden');
    expect(err.message).toMatch(/lista de usuários/);
  });

  it('não repete POST após erro 5xx (resposta ambígua)', async () => {
    const fake = new FakeSpotify();
    fake.fail('POST /me/playlists', jsonResponse(502));
    const { c } = client(fake);
    await expect(c.createPlaylist('X', '', false)).rejects.toMatchObject({ kind: 'server' });
    expect(fake.count('POST', '/me/playlists')).toBe(1);
  });

  it('repete GET após 5xx', async () => {
    const fake = new FakeSpotify();
    fake.fail('GET /me', jsonResponse(503));
    const { c } = client(fake);
    await expect(c.me()).resolves.toBeTruthy();
  });

  it('pagina os itens da playlist', async () => {
    const fake = new FakeSpotify();
    fake.playlists.set('p', { name: 'p', public: false, description: '', items: Array.from({ length: 120 }, (_, i) => `spotify:track:${i}`) });
    const { c } = client(fake);
    expect(await c.getPlaylistItemUris('p')).toHaveLength(120);
  });
});
