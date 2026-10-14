import type { KVStore } from '../src/lib/auth';
import type { SpotifyTrack } from '../src/lib/matching';

export class MemoryStore implements KVStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let seq = 0;
export function track(name: string, artists: string[], extra: Partial<SpotifyTrack> = {}): SpotifyTrack {
  seq++;
  const id = (extra.id ?? `t${seq}`).padEnd(22, 'x').slice(0, 22);
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artists.map((n) => ({ name: n })),
    album: { name: `Álbum de ${name}` },
    duration_ms: 200_000,
    explicit: false,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    ...extra,
    ...(extra.id ? {} : {}),
  };
}

export function jsonResponse(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
