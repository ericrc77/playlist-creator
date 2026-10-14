import { resolveTrack } from '../src/lib/resolver';
import { SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { track } from './helpers';

function setup() {
  const fake = new FakeSpotify();
  const client = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
  return { fake, client };
}

describe('resolveTrack', () => {
  it('busca por título e artista', async () => {
    const { fake, client } = setup();
    const t = track('Paypal', ['Teto']);
    fake.catalog = [t, track('Paypal', ['Outro'], { duration_ms: 1 })];
    const r = await resolveTrack(client, { index: 0, title: 'Paypal', artists: ['Teto'] });
    expect(r.status).toBe('exact');
    expect(r.selected?.id).toBe(t.id);
    expect(decodeURIComponent(fake.calls[0].path.replace(/\+/g, ' '))).toContain('track:"Paypal" artist:"Teto"');
  });

  it('valida o URI informado na API', async () => {
    const { fake, client } = setup();
    const t = track('Paypal', ['Teto'], { id: 'abcdefghijklmnopqrstuv' });
    fake.catalog = [t];
    const r = await resolveTrack(client, { index: 0, artists: [], spotifyUri: t.uri });
    expect(r.status).toBe('exact');
    expect(fake.calls[0].path).toBe('/tracks/abcdefghijklmnopqrstuv');
  });

  it('pede confirmação quando o URI não bate com título/artistas do JSON', async () => {
    const { fake, client } = setup();
    const t = track('Outra Música', ['Outro'], { id: 'abcdefghijklmnopqrstuv' });
    fake.catalog = [t];
    const r = await resolveTrack(client, { index: 0, title: 'Paypal', artists: ['Teto'], spotifyUri: t.uri });
    expect(r.status).toBe('needs_confirmation');
  });

  it('marca URI inexistente como não encontrada', async () => {
    const { client } = setup();
    const r = await resolveTrack(client, { index: 0, artists: [], spotifyUri: 'spotify:track:zzzzzzzzzzzzzzzzzzzzzz' });
    expect(r.status).toBe('not_found');
  });
});
