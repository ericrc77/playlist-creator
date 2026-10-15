import { fingerprint, loadJob, publish, type PublishPlan } from '../src/lib/publish';
import { SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { jsonResponse, MemoryStore } from './helpers';

const uris = (n: number) => Array.from({ length: n }, (_, i) => `spotify:track:${String(i).padStart(22, '0')}`);
const plan = (n = 3): PublishPlan => ({ name: 'Teste', description: 'd', public: false, uris: uris(n) });

function setup() {
  const fake = new FakeSpotify();
  const client = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
  return { fake, client, store: new MemoryStore() };
}

describe('publish', () => {
  it('cria playlist privada, adiciona na ordem e confirma pela API', async () => {
    const { fake, client, store } = setup();
    const p = plan(3);
    const out = await publish(client, p, store);
    expect(out).toMatchObject({ kind: 'done', added: 3, alreadyPublished: false, playlistUrl: 'https://open.spotify.com/playlist/pl1' });
    const pl = fake.playlists.get('pl1')!;
    expect(pl.public).toBe(false);
    expect(pl.items).toEqual(p.uris);
  });

  it('preserva repetições intencionais', async () => {
    const { fake, client, store } = setup();
    const p = { ...plan(0), uris: ['spotify:track:a', 'spotify:track:b', 'spotify:track:a'] };
    await publish(client, p, store);
    expect(fake.playlists.get('pl1')!.items).toEqual(p.uris);
  });

  it('divide em lotes de 100 mantendo a ordem', async () => {
    const { fake, client, store } = setup();
    const p = plan(250);
    await publish(client, p, store);
    expect(fake.count('POST', '/playlists/pl1/items')).toBe(3);
    expect(fake.playlists.get('pl1')!.items).toEqual(p.uris);
  });

  it('não cria segunda playlist ao clicar de novo depois do sucesso', async () => {
    const { fake, client, store } = setup();
    await publish(client, plan(), store);
    const again = await publish(client, plan(), store);
    expect(again).toMatchObject({ kind: 'done', alreadyPublished: true });
    expect(fake.count('POST', '/me/playlists')).toBe(1);
  });

  it('retoma falha parcial sem duplicar playlist nem faixas', async () => {
    const { fake, store } = setup();
    const p = plan(150);
    // Falha de rede antes de o 2º lote chegar ao Spotify.
    let calls = 0;
    const orig = fake.fetch;
    fake.fetch = async (input, init) => {
      if (String(input).includes('/items') && init?.method === 'POST' && ++calls === 2) throw new TypeError('Failed to fetch');
      return orig(input, init);
    };
    const c2 = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
    await expect(publish(c2, p, store)).rejects.toMatchObject({ kind: 'network' });
    expect(fake.playlists.get('pl1')!.items).toHaveLength(100);
    expect(loadJob(store, fingerprint(p), 'eric')).toMatchObject({ playlistId: 'pl1', addedCount: 100, done: false });

    const out = await publish(c2, p, store);
    expect(out).toMatchObject({ kind: 'done', added: 150 });
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.playlists.get('pl1')!.items).toEqual(p.uris);
  });

  it('não readiciona um lote que chegou ao Spotify mas cuja resposta se perdeu', async () => {
    const { fake, store } = setup();
    const p = plan(3);
    const orig = fake.fetch;
    let lost = false;
    fake.fetch = async (input, init) => {
      const res = await orig(input, init);
      if (!lost && String(input).includes('/items') && init?.method === 'POST') {
        lost = true;
        throw new TypeError('Failed to fetch'); // gravou, mas a resposta não voltou
      }
      return res;
    };
    const c2 = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
    await expect(publish(c2, p, store)).rejects.toBeTruthy();
    const out = await publish(c2, p, store);
    expect(out.kind).toBe('done');
    expect(fake.playlists.get('pl1')!.items).toEqual(p.uris);
  });

  it('avisa em vez de recriar quando a criação ficou sem resposta', async () => {
    const { fake, client, store } = setup();
    fake.fail('POST /me/playlists', 'network');
    await expect(publish(client, plan(), store)).rejects.toMatchObject({ kind: 'network' });
    const out = await publish(client, plan(), store);
    expect(out.kind).toBe('uncertain_create');
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    const forced = await publish(client, plan(), store, { confirmRecreate: true });
    expect(forced.kind).toBe('done');
  });

  it('libera nova tentativa após 403 (nada foi criado)', async () => {
    const { fake, client, store } = setup();
    fake.fail('POST /me/playlists', jsonResponse(403, {}));
    await expect(publish(client, plan(), store)).rejects.toMatchObject({ kind: 'forbidden' });
    expect((await publish(client, plan(), store)).kind).toBe('done');
  });

  it('para se a playlist foi alterada fora do app durante a retomada', async () => {
    const { fake, client, store } = setup();
    const p = plan(150);
    fake.fail('POST /playlists/pl1/items', jsonResponse(201, {}), jsonResponse(500, {}));
    // 1º lote "respondeu" sem gravar (forçado) → estado real diverge do contador; 2º falha.
    await expect(publish(client, p, store)).rejects.toBeTruthy();
    fake.playlists.get('pl1')!.items = ['spotify:track:intrusa'];
    const out = await publish(client, p, store);
    expect(out.kind).toBe('diverged');
  });

  it('duas publicações simultâneas do mesmo plano criam uma única playlist (revisão Codex F1)', async () => {
    const { fake, client, store } = setup();
    const p = plan(150);
    const [a, b] = await Promise.all([publish(client, p, store), publish(client, p, store)]);
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.playlists.get('pl1')!.items).toEqual(p.uris);
    expect([a.kind, b.kind]).toEqual(['done', 'done']);
  });

  it('clique duplo em "criar mesmo assim" após criação incerta não duplica (revisão Codex F1)', async () => {
    const { fake, client, store } = setup();
    fake.fail('POST /me/playlists', 'network');
    await expect(publish(client, plan(), store)).rejects.toMatchObject({ kind: 'network' });
    const [a, b] = await Promise.all([
      publish(client, plan(), store, { confirmRecreate: true }),
      publish(client, plan(), store, { confirmRecreate: true }),
    ]);
    expect(fake.count('POST', '/me/playlists')).toBe(2); // a tentativa sem resposta + uma única recriação
    expect(fake.playlists.size).toBe(1);
    expect(fake.count('POST', '/playlists/pl1/items')).toBe(1);
    expect([a.kind, b.kind]).toEqual(['done', 'done']);
  });

  it('não reaproveita o job de outra conta do Spotify (revisão Codex F4)', async () => {
    const { fake, store } = setup();
    let user = 'conta-a';
    const fetchFn: typeof fetch = async (input, init) =>
      new URL(String(input)).pathname === '/v1/me' ? jsonResponse(200, { id: user }) : fake.fetch(input, init);
    const client = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn, sleep: async () => {} });
    const first = await publish(client, plan(), store);
    user = 'conta-b';
    const second = await publish(client, plan(), store);
    expect(second).toMatchObject({ kind: 'done', alreadyPublished: false });
    expect(second.kind === 'done' && first.kind === 'done' && second.playlistId !== first.playlistId).toBe(true);
    expect(fake.count('POST', '/me/playlists')).toBe(2);
  });

  it('não repete automaticamente a adição de faixas após 5xx', async () => {
    const { fake, client, store } = setup();
    fake.fail('POST /playlists/pl1/items', jsonResponse(503, {}));
    await expect(publish(client, plan(), store)).rejects.toMatchObject({ kind: 'server' });
    expect(fake.count('POST', '/playlists/pl1/items')).toBe(1);
  });

  it('recusa publicar sem faixas', async () => {
    const { client, store } = setup();
    await expect(publish(client, plan(0), store)).rejects.toThrow(/Nenhuma faixa/);
  });
});
