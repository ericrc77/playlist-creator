// Cliente mínimo da Web API do Spotify, já com as mudanças do Development Mode de 2026:
// - criação de playlist em POST /me/playlists (POST /users/{id}/playlists foi removido);
// - itens de playlist em /playlists/{id}/items (antes /tracks);
// - busca com limit máximo 10;
// - sem endpoint de lote GET /tracks (usar GET /tracks/{id}).
// https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

import type { SpotifyTrack } from './matching';

export const API_BASE = 'https://api.spotify.com/v1';
export const SEARCH_LIMIT_MAX = 10;
export const ADD_ITEMS_BATCH = 100;

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'server' | 'network' | 'bad_request';

export class SpotifyApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    public status: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  /** Devolve um access token válido (renovando se necessário). */
  getAccessToken: () => Promise<string>;
  /** Força renovação após um 401. Retorna o novo token. */
  onUnauthorized: () => Promise<string>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Número máximo de novas tentativas após 429/5xx. */
  maxRetries?: number;
}

export interface CreatedPlaylist {
  id: string;
  uri: string;
  name: string;
  external_urls: { spotify: string };
}

export interface SpotifyUser {
  id: string;
  /** Identificador estável da conta (o `id` pode mudar; o Spotify recomenda `account_id` para vincular contas). */
  account_id?: string;
  display_name?: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SpotifyClient {
  private fetchFn: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;

  constructor(private opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? ((...args) => fetch(...args));
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * Faz a requisição com: renovação única em 401, espera de Retry-After em 429 e
   * novas tentativas em 5xx. `retryUnsafe=false` impede repetir POSTs não idempotentes
   * após resposta ambígua (5xx ou falha de rede), para evitar duplicações.
   */
  async request<T>(method: string, path: string, body?: unknown, retryUnsafe = true): Promise<T> {
    let token = await this.opts.getAccessToken();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (retryUnsafe && attempt < this.maxRetries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new SpotifyApiError('network', 0, 'Falha de conexão com o Spotify. Verifique sua internet.');
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.opts.onUnauthorized();
        continue;
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '1') || 1;
        // 429 significa que a requisição NÃO foi processada, então é seguro repetir.
        if (attempt < this.maxRetries && retryAfter <= 60) {
          await this.sleep(retryAfter * 1000);
          continue;
        }
        throw new SpotifyApiError('rate_limited', 429, `O Spotify limitou as requisições. Tente de novo em ${retryAfter}s.`, retryAfter);
      }
      if (res.status >= 500 && retryUnsafe && attempt < this.maxRetries) {
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      throw await toApiError(res);
    }
  }

  me(): Promise<SpotifyUser> {
    return this.request('GET', '/me');
  }

  async searchTracks(query: string, limit = SEARCH_LIMIT_MAX, offset = 0): Promise<SpotifyTrack[]> {
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(Math.min(limit, SEARCH_LIMIT_MAX)),
      offset: String(offset),
    });
    const res = await this.request<{ tracks?: { items: (SpotifyTrack | null)[] } }>('GET', `/search?${params}`);
    return (res.tracks?.items ?? []).filter((t): t is SpotifyTrack => !!t);
  }

  getTrack(id: string): Promise<SpotifyTrack> {
    return this.request('GET', `/tracks/${encodeURIComponent(id)}`);
  }

  createPlaylist(name: string, description: string, isPublic: boolean): Promise<CreatedPlaylist> {
    // Não repete automaticamente: se a resposta se perder, a retomada verifica antes de recriar.
    return this.request('POST', '/me/playlists', { name, description, public: isPublic }, false);
  }

  addItems(playlistId: string, uris: string[], position?: number): Promise<{ snapshot_id: string }> {
    if (uris.length > ADD_ITEMS_BATCH) throw new Error(`No máximo ${ADD_ITEMS_BATCH} itens por chamada.`);
    return this.request(
      'POST',
      `/playlists/${encodeURIComponent(playlistId)}/items`,
      { uris, ...(position !== undefined ? { position } : {}) },
      false,
    );
  }

  /** Valor atual de `public` (true = aparece no perfil). */
  async getPlaylistPublic(playlistId: string): Promise<boolean | null> {
    const res = await this.request<{ public?: boolean | null }>('GET', `/playlists/${encodeURIComponent(playlistId)}?fields=public`);
    return typeof res?.public === 'boolean' ? res.public : null;
  }

  /** PUT /playlists/{id} (Change Playlist Details). Idempotente: pode repetir com segurança. */
  setPlaylistPublic(playlistId: string, isPublic: boolean): Promise<void> {
    return this.request('PUT', `/playlists/${encodeURIComponent(playlistId)}`, { public: isPublic });
  }

  /** Lista os URIs atuais da playlist (só funciona para playlists do próprio usuário). */
  async getPlaylistItemUris(playlistId: string): Promise<string[]> {
    const uris: string[] = [];
    let path: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&offset=0`;
    while (path) {
      const page: {
        items: { item?: { uri: string } | null; track?: { uri: string } | null }[];
        next: string | null;
      } = await this.request('GET', path);
      for (const it of page.items) {
        const uri = it.item?.uri ?? it.track?.uri;
        if (uri) uris.push(uri);
      }
      path = page.next ? page.next.replace(API_BASE, '') : null;
    }
    return uris;
  }
}

async function toApiError(res: Response): Promise<SpotifyApiError> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
  } catch {
    /* sem corpo JSON */
  }
  const suffix = detail ? ` (${detail})` : '';
  switch (res.status) {
    case 400:
      return new SpotifyApiError('bad_request', 400, `Requisição recusada pelo Spotify${suffix}.`);
    case 401:
      return new SpotifyApiError('unauthorized', 401, 'Sua sessão do Spotify expirou. Conecte novamente.');
    case 403:
      return new SpotifyApiError(
        'forbidden',
        403,
        `O Spotify negou a operação${suffix}. Verifique se sua conta está na lista de usuários do app no Developer Dashboard, se o dono do app tem Premium e se você concedeu as permissões de playlist.`,
      );
    case 404:
      return new SpotifyApiError('not_found', 404, `Recurso não encontrado no Spotify${suffix}.`);
    default:
      return new SpotifyApiError(res.status >= 500 ? 'server' : 'bad_request', res.status, `Erro ${res.status} do Spotify${suffix}.`);
  }
}
