// Contrato ChatGPT → aplicativo, versão 1.0.
// Fonte: 02-CONTRATO-DE-PLAYLIST.md (ver docs/CONTRATO.md no repositório).

export const SUPPORTED_SCHEMA_VERSIONS = ['1.0'] as const;

export interface TrackRequest {
  /** Posição na lista original (0-based). A ordem final segue este índice. */
  index: number;
  title?: string;
  artists: string[];
  /** URI normalizado (`spotify:track:<id>`), quando informado no JSON. */
  spotifyUri?: string;
}

export interface PlaylistRequest {
  schemaVersion: string;
  name: string;
  description: string;
  public: boolean;
  tracks: TrackRequest[];
}

export type ParseResult =
  | { ok: true; value: PlaylistRequest; warnings: string[] }
  | { ok: false; errors: string[] };

const TRACK_ID = /^[A-Za-z0-9]{22}$/;

/**
 * Converte `spotify:track:<id>` ou `https://open.spotify.com/[intl-xx/]track/<id>?...`
 * em URI canônico. Retorna `null` se não for uma faixa válida.
 */
export function toTrackUri(value: string): string | null {
  const v = value.trim();
  const uri = /^spotify:track:([A-Za-z0-9]+)$/.exec(v);
  if (uri) return TRACK_ID.test(uri[1]) ? `spotify:track:${uri[1]}` : null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('intl-')) parts.shift();
  if (parts.length !== 2 || parts[0] !== 'track' || !TRACK_ID.test(parts[1])) return null;
  return `spotify:track:${parts[1]}`;
}

export function trackIdFromUri(uri: string): string {
  return uri.split(':')[2];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Campos que nunca deveriam vir do ChatGPT (credenciais). */
const FORBIDDEN_KEYS = /^(access_token|refresh_token|token|client_secret|password|senha|authorization)$/i;

function findForbiddenKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const p = path ? `${path}.${k}` : k;
    return [...(FORBIDDEN_KEYS.test(k) ? [p] : []), ...findForbiddenKeys(v, p)];
  });
}

export function parsePlaylistText(text: string): ParseResult {
  const trimmed = stripCodeFence(text.trim());
  if (!trimmed) return { ok: false, errors: ['Cole o JSON da playlist ou carregue um arquivo .json.'] };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      errors: [`O texto não é um JSON válido: ${(e as Error).message}`],
    };
  }
  return validatePlaylist(data);
}

/** Aceita o JSON colado junto com a cerca ```json ... ``` do ChatGPT. */
function stripCodeFence(text: string): string {
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  return m ? m[1].trim() : text;
}

export function validatePlaylist(data: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(data)) return { ok: false, errors: ['O JSON precisa ser um objeto { ... }.'] };

  const forbidden = findForbiddenKeys(data);
  if (forbidden.length) {
    return {
      ok: false,
      errors: [
        `O JSON contém campos de credencial (${forbidden.join(', ')}). Remova-os: o aplicativo nunca recebe tokens ou segredos pelo arquivo.`,
      ],
    };
  }

  const version = data.schema_version;
  if (typeof version !== 'string') {
    errors.push('Campo obrigatório "schema_version" ausente ou não é texto (use "1.0").');
  } else if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
    errors.push(`schema_version "${version}" não é suportada. Versões aceitas: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`);
  }

  const pl = data.playlist;
  let name = '';
  let description = '';
  let isPublic = false;
  if (!isObject(pl)) {
    errors.push('Campo obrigatório "playlist" ausente ou não é um objeto.');
  } else {
    if (typeof pl.name !== 'string' || !pl.name.trim()) {
      errors.push('"playlist.name" é obrigatório e não pode ser vazio.');
    } else {
      name = pl.name.trim();
      if (name.length > 100) warnings.push('O nome tem mais de 100 caracteres; o Spotify pode recusá-lo ou cortá-lo.');
    }
    if (pl.description !== undefined && pl.description !== null) {
      if (typeof pl.description !== 'string') errors.push('"playlist.description" precisa ser texto.');
      else description = pl.description.trim();
    }
    if (pl.public !== undefined && pl.public !== null) {
      if (typeof pl.public !== 'boolean') errors.push('"playlist.public" precisa ser true ou false.');
      else isPublic = pl.public;
    }
  }

  const tracks: TrackRequest[] = [];
  if (!Array.isArray(data.tracks)) {
    errors.push('Campo obrigatório "tracks" ausente ou não é uma lista.');
  } else if (data.tracks.length === 0) {
    errors.push('"tracks" está vazia: a playlist precisa de pelo menos uma faixa.');
  } else {
    data.tracks.forEach((raw, i) => {
      const label = `Faixa ${i + 1}`;
      if (!isObject(raw)) {
        errors.push(`${label}: precisa ser um objeto com "title" e "artists".`);
        return;
      }
      const t: TrackRequest = { index: i, artists: [] };
      if (raw.title !== undefined && raw.title !== null) {
        if (typeof raw.title !== 'string') errors.push(`${label}: "title" precisa ser texto.`);
        else if (raw.title.trim()) t.title = raw.title.trim();
      }
      if (raw.artists !== undefined && raw.artists !== null) {
        if (!Array.isArray(raw.artists) || raw.artists.some((a) => typeof a !== 'string')) {
          errors.push(`${label}: "artists" precisa ser uma lista de nomes (texto).`);
        } else {
          t.artists = (raw.artists as string[]).map((a) => a.trim()).filter(Boolean);
        }
      }
      for (const key of ['spotify_uri', 'spotify_url'] as const) {
        const v = raw[key];
        if (v === undefined || v === null || v === '') continue;
        const uri = typeof v === 'string' ? toTrackUri(v) : null;
        if (!uri) errors.push(`${label}: "${key}" não é um link/URI de faixa do Spotify válido.`);
        else if (t.spotifyUri && t.spotifyUri !== uri) errors.push(`${label}: "spotify_uri" e "spotify_url" apontam para faixas diferentes.`);
        else t.spotifyUri = uri;
      }
      if (!t.spotifyUri) {
        if (!t.title) errors.push(`${label}: "title" é obrigatório quando não há spotify_uri.`);
        if (t.artists.length === 0) errors.push(`${label}${t.title ? ` ("${t.title}")` : ''}: "artists" é obrigatório para buscar por nome.`);
      }
      tracks.push(t);
    });
    if (data.tracks.length > 10000) errors.push('O Spotify aceita no máximo 10.000 itens por playlist.');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { schemaVersion: version as string, name, description, public: isPublic, tracks }, warnings };
}

/** Grupos de posições (1-based) que repetem a mesma faixa pedida. */
export function findRepeatedRequests(tracks: TrackRequest[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const t of tracks) {
    const key = t.spotifyUri ?? `${(t.title ?? '').toLowerCase()}|${t.artists.map((a) => a.toLowerCase()).sort().join(',')}`;
    groups.set(key, [...(groups.get(key) ?? []), t.index + 1]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
