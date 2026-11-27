// Spotify simulado em memória para o modo demonstração. Implementa só as rotas que o app usa, com a
// mesma forma das respostas reais, para que a demonstração execute o código de produção.
// Artistas, faixas e álbuns são fictícios. Nada sai do navegador.

import { normalize, type SpotifyTrack } from '../lib/matching';

interface DemoPlaylist {
  public: boolean;
  items: string[];
}

function demoTrack(n: number, name: string, artists: string[], album: string, durationMs: number, explicit = false): SpotifyTrack {
  const id = `demo${String(n).padStart(18, '0')}`;
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artists.map((a) => ({ name: a })),
    album: { name: album },
    duration_ms: durationMs,
    explicit,
  };
}

export const DEMO_CATALOG: SpotifyTrack[] = [
  demoTrack(1, 'Paper Lanterns', ['The Harbor Lights'], 'Low Tide', 214_000),
  demoTrack(2, 'Northbound', ['Mara Vale', 'Ilo Reyes'], 'Northbound', 187_000),
  demoTrack(3, 'Static Bloom', ['Cedar Avenue'], 'Greenhouse', 201_000, true),
  demoTrack(4, 'Static Bloom', ['Cedar Avenue'], 'Greenhouse (Radio)', 198_000),
  demoTrack(5, 'Glass Orchard - Live', ['Juniper Field'], 'Live at the Granary', 263_000),
  demoTrack(6, 'Quiet Machines', ['Neon Cartography'], 'Survey', 232_000),
];

export const DEMO_PLAYLIST = JSON.stringify(
  {
    schema_version: '1.0',
    playlist: { name: 'Playlist de demonstração', description: 'Artistas e faixas fictícios.' },
    tracks: [
      { title: 'Paper Lanterns', artists: ['The Harbor Lights'] },
      { title: 'Northbound', artists: ['Mara Vale', 'Ilo Reyes'] },
      { title: 'Static Bloom', artists: ['Cedar Avenue'] },
      { title: 'Glass Orchard', artists: ['Juniper Field'] },
      { title: 'Quiet Machines', artists: ['Neon Cartography'] },
      { title: 'Faixa Que Não Existe', artists: ['Artista Desconhecido'] },
    ],
  },
  null,
  2,
);

function search(query: string): SpotifyTrack[] {
  const title = /track:"([^"]*)"/.exec(query)?.[1];
  const artist = /artist:"([^"]*)"/.exec(query)?.[1];
  const has = (haystack: string, needle: string) => normalize(haystack).includes(normalize(needle));
  if (title !== undefined) {
    return DEMO_CATALOG.filter((t) => has(t.name, title) && (!artist || t.artists.some((a) => has(a.name, artist))));
  }
  const words = normalize(query).split(' ').filter((w) => w.length > 2);
  return DEMO_CATALOG.filter((t) => {
    const text = ` ${normalize(`${t.name} ${t.artists.map((a) => a.name).join(' ')}`)} `;
    return words.some((w) => text.includes(` ${w} `));
  });
}

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const notFound = () => reply(404, { error: { message: 'Not found' } });

/** `fetch` compatível com o SpotifyClient. Cada chamada cria um Spotify simulado independente. */
export function createDemoFetch(delayMs = 150): typeof fetch {
  const playlists = new Map<string, DemoPlaylist>();

  return async (input, init) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    const [, resource, id, sub] = url.pathname.split('/').filter(Boolean);
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (resource === 'me' && method === 'GET' && !id) return reply(200, { id: 'demo-user', display_name: 'Demo' });
    if (resource === 'me' && id === 'playlists' && method === 'POST') {
      const playlistId = `demoplaylist${playlists.size + 1}`;
      playlists.set(playlistId, { public: body.public, items: [] });
      return reply(201, { id: playlistId, uri: `spotify:playlist:${playlistId}`, name: body.name, external_urls: { spotify: '' } });
    }
    if (resource === 'search') return reply(200, { tracks: { items: search(url.searchParams.get('q') ?? '') } });
    if (resource === 'tracks') {
      const found = DEMO_CATALOG.find((t) => t.id === id);
      return found ? reply(200, found) : notFound();
    }
    if (resource === 'playlists') {
      const playlist = playlists.get(id);
      if (!playlist) return notFound();
      if (sub === 'items') {
        if (method === 'POST') {
          playlist.items.splice(body.position ?? playlist.items.length, 0, ...body.uris);
          return reply(201, { snapshot_id: 'demo' });
        }
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const next =
          offset + limit < playlist.items.length ? `${url.origin}${url.pathname}?limit=${limit}&offset=${offset + limit}` : null;
        return reply(200, { items: playlist.items.slice(offset, offset + limit).map((uri) => ({ item: { uri } })), next });
      }
      if (method === 'PUT') {
        playlist.public = body.public;
        return reply(200);
      }
      return reply(200, { public: playlist.public });
    }
    return notFound();
  };
}
