// Servidor falso da Web API do Spotify, usado como `fetch` nos testes.
import type { SpotifyTrack } from '../src/lib/matching';
import { jsonResponse } from './helpers';

export class FakeSpotify {
  catalog: SpotifyTrack[] = [];
  playlists = new Map<string, { name: string; public: boolean; description: string; items: string[] }>();
  calls: { method: string; path: string; body?: unknown }[] = [];
  /** Respostas forçadas, consumidas em ordem, por "MÉTODO caminho-sem-query". */
  failures = new Map<string, (Response | 'network')[]>();
  /** Simula o Spotify criando a playlist com visibilidade diferente da pedida. */
  createAs?: boolean;
  /** Simula o Spotify ignorando PUT /playlists/{id} {public}. */
  ignoreVisibilityChange = false;
  /** Força o valor devolvido por GET /playlists/{id}. */
  reportPublic?: boolean;
  private nextId = 1;

  fail(key: string, ...responses: (Response | 'network')[]) {
    this.failures.set(key, [...(this.failures.get(key) ?? []), ...responses]);
  }

  count(method: string, prefix: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(prefix)).length;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/v1', '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: path + url.search, body });

    const key = `${method} ${path}`;
    const queue = this.failures.get(key);
    if (queue?.length) {
      const f = queue.shift()!;
      if (f === 'network') throw new TypeError('Failed to fetch');
      return f;
    }

    if (method === 'GET' && path === '/me') return jsonResponse(200, { id: 'eric', display_name: 'Eric' });
    if (method === 'GET' && path === '/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const limit = Number(url.searchParams.get('limit'));
      if (limit > 10) return jsonResponse(400, { error: { message: 'Invalid limit' } });
      const m = /track:"([^"]+)"/.exec(q);
      const needle = m ? m[1] : q.split(' ')[0];
      const items = this.catalog.filter((t) => t.name.toLowerCase().includes(needle)).slice(0, limit);
      return jsonResponse(200, { tracks: { items } });
    }
    let m = /^\/tracks\/(\w+)$/.exec(path);
    if (method === 'GET' && m) {
      const t = this.catalog.find((c) => c.id === m![1]);
      return t ? jsonResponse(200, t) : jsonResponse(404, { error: { message: 'Not found' } });
    }
    if (method === 'POST' && path === '/me/playlists') {
      const id = `pl${this.nextId++}`;
      const b = body as { name: string; public: boolean; description: string };
      this.playlists.set(id, { ...b, public: this.createAs ?? b.public, items: [] });
      return jsonResponse(201, { id, uri: `spotify:playlist:${id}`, name: b.name, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` } });
    }
    m = /^\/playlists\/(\w+)$/.exec(path);
    if (m) {
      const pl = this.playlists.get(m[1]);
      if (!pl) return jsonResponse(404, { error: { message: 'Not found' } });
      if (method === 'GET') return jsonResponse(200, { public: this.reportPublic ?? pl.public });
      if (method === 'PUT') {
        if (!this.ignoreVisibilityChange) pl.public = (body as { public: boolean }).public;
        return new Response(null, { status: 200 });
      }
    }
    m = /^\/playlists\/(\w+)\/items$/.exec(path);
    if (m) {
      const pl = this.playlists.get(m[1]);
      if (!pl) return jsonResponse(404, { error: { message: 'Not found' } });
      if (method === 'POST') {
        const b = body as { uris: string[]; position?: number };
        if (b.uris.length > 100) return jsonResponse(400, { error: { message: 'Too many' } });
        pl.items.splice(b.position ?? pl.items.length, 0, ...b.uris);
        return jsonResponse(201, { snapshot_id: 'snap' });
      }
      if (method === 'GET') {
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const slice = pl.items.slice(offset, offset + limit);
        const next = offset + limit < pl.items.length ? `https://api.spotify.com/v1/playlists/${m[1]}/items?limit=${limit}&offset=${offset + limit}` : null;
        return jsonResponse(200, { items: slice.map((uri) => ({ item: { uri } })), next, total: pl.items.length });
      }
    }
    return jsonResponse(404, { error: { message: `rota desconhecida ${key}` } });
  };
}
