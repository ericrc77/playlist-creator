import { findRepeatedRequests, parsePlaylistText, toTrackUri, validatePlaylist } from '../src/lib/contract';

const ID = '4uLU6hMCjMI75M1A2tKUQC';
const valid = {
  schema_version: '1.0',
  playlist: { name: 'Passando roupa', description: 'Aprovada', public: false },
  tracks: [
    { title: 'Mitsubishi', artists: ['Orochi', 'Kizzy'] },
    { title: 'Paypal', artists: ['Teto'] },
  ],
};

describe('contrato 1.0', () => {
  it('aceita o exemplo do contrato e preserva a ordem', () => {
    const r = validatePlaylist(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Passando roupa');
    expect(r.value.public).toBe(false);
    expect(r.value.tracks.map((t) => t.title)).toEqual(['Mitsubishi', 'Paypal']);
    expect(r.value.tracks.map((t) => t.index)).toEqual([0, 1]);
  });

  it('usa privada por padrão quando "public" não vem', () => {
    const r = validatePlaylist({ ...valid, playlist: { name: 'X' } });
    expect(r.ok && r.value.public).toBe(false);
  });

  it('aceita JSON dentro de cerca ```json do ChatGPT', () => {
    const r = parsePlaylistText('```json\n' + JSON.stringify(valid) + '\n```');
    expect(r.ok).toBe(true);
  });

  it('explica JSON inválido', () => {
    const r = parsePlaylistText('{ nome: ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/não é um JSON válido/);
  });

  it('lista todos os erros de schema de uma vez', () => {
    const r = validatePlaylist({ schema_version: '2.0', playlist: { name: ' ', public: 'sim' }, tracks: [{ title: 'Sem artista' }, 5] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/schema_version "2.0" não é suportada/),
        expect.stringMatching(/playlist.name/),
        expect.stringMatching(/playlist.public/),
        expect.stringMatching(/Faixa 1.*artists/),
        expect.stringMatching(/Faixa 2: precisa ser um objeto/),
      ]),
    );
  });

  it('recusa lista de faixas vazia', () => {
    const r = validatePlaylist({ ...valid, tracks: [] });
    expect(r.ok).toBe(false);
  });

  it('recusa credenciais no JSON', () => {
    const r = validatePlaylist({ ...valid, access_token: 'abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/credencial/);
  });

  it('aceita spotify_uri ou spotify_url sem título', () => {
    const r = validatePlaylist({
      ...valid,
      tracks: [{ spotify_uri: `spotify:track:${ID}` }, { spotify_url: `https://open.spotify.com/intl-pt/track/${ID}?si=abc` }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tracks.map((t) => t.spotifyUri)).toEqual([`spotify:track:${ID}`, `spotify:track:${ID}`]);
  });

  it('recusa links que não são faixas', () => {
    const r = validatePlaylist({ ...valid, tracks: [{ title: 'A', artists: ['B'], spotify_url: 'https://open.spotify.com/album/' + ID }] });
    expect(r.ok).toBe(false);
  });

  it('detecta repetições intencionais sem removê-las', () => {
    const r = validatePlaylist({ ...valid, tracks: [...valid.tracks, { title: 'mitsubishi', artists: ['Kizzy', 'Orochi'] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tracks).toHaveLength(3);
    expect(findRepeatedRequests(r.value.tracks)).toEqual([[1, 3]]);
  });
});

describe('toTrackUri', () => {
  it.each([
    [`spotify:track:${ID}`, `spotify:track:${ID}`],
    [`https://open.spotify.com/track/${ID}`, `spotify:track:${ID}`],
    [`https://open.spotify.com/intl-pt/track/${ID}?si=1`, `spotify:track:${ID}`],
    ['http://open.spotify.com/track/' + ID, null],
    ['https://evil.com/track/' + ID, null],
    ['spotify:track:curto', null],
  ])('%s → %s', (input, expected) => {
    expect(toTrackUri(input)).toBe(expected);
  });
});
