// Classificação das correspondências entre a faixa pedida e os resultados da busca.
// Regra do contrato: nunca escolher silenciosamente uma versão duvidosa.

import type { TrackRequest } from './contract';

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images?: { url: string; width?: number | null }[] };
  duration_ms: number;
  explicit: boolean;
  external_urls?: { spotify?: string };
  is_playable?: boolean;
}

export type MatchStatus = 'exact' | 'needs_confirmation' | 'not_found';

export interface MatchResult {
  status: MatchStatus;
  /** Faixa escolhida automaticamente (apenas quando status = exact). */
  selected?: SpotifyTrack;
  candidates: SpotifyTrack[];
  /** Motivo legível quando a escolha precisa do usuário. */
  reason?: string;
}

/** Remove acentos, caixa, pontuação e espaços repetidos. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Termos que indicam versão diferente da original. Se aparecem no resultado mas não
 * no pedido (ou vice-versa), a correspondência não é exata.
 */
const VERSION_MARKERS = [
  'remix', 'rmx', 'ao vivo', 'live', 'acustico', 'acoustic', 'versao', 'version',
  'sped up', 'slowed', 'reverb', 'instrumental', 'karaoke', 'clean', 'radio edit',
  'edit', 'extended', 'mix', 'remaster', 'remastered', 'demo', 'cover', 'video',
  'mashup', 'bootleg', 'acapella', 'a capella', 'piano', 'orchestral', 'session',
];

export function versionMarkers(title: string): string[] {
  const n = ` ${normalize(title)} `;
  return VERSION_MARKERS.filter((m) => n.includes(` ${m} `));
}

/** Título "base": sem parênteses/colchetes, sem "feat." e sem sufixos " - ...". */
export function baseTitle(title: string): string {
  return normalize(
    title
      .replace(/\s[-–—]\s.*$/, '')
      .replace(/[([{].*?[)\]}]/g, ' ')
      .replace(/\b(feat|ft|featuring|part|participacao)\.?\s.*$/i, ''),
  );
}

function artistMatches(requested: string, candidateArtists: string[]): boolean {
  const r = normalize(requested);
  return candidateArtists.some((c) => normalize(c) === r);
}

export interface CandidateScore {
  track: SpotifyTrack;
  titleExact: boolean;
  allArtists: boolean;
  someArtist: boolean;
  versionMismatch: string[];
}

export function scoreCandidate(req: TrackRequest, track: SpotifyTrack): CandidateScore {
  const reqTitle = req.title ?? '';
  const candArtists = track.artists.map((a) => a.name);
  const reqMarkers = versionMarkers(reqTitle);
  const candMarkers = versionMarkers(track.name);
  const versionMismatch = [
    ...candMarkers.filter((m) => !reqMarkers.includes(m)),
    ...reqMarkers.filter((m) => !candMarkers.includes(m)),
  ];
  const matched = req.artists.filter((a) => artistMatches(a, candArtists));
  return {
    track,
    titleExact: baseTitle(reqTitle) === baseTitle(track.name) && baseTitle(reqTitle) !== '',
    allArtists: req.artists.length > 0 && matched.length === req.artists.length,
    someArtist: matched.length > 0,
    versionMismatch,
  };
}

/** Duas faixas são "a mesma gravação" se têm duração quase idêntica e mesma marcação explicit. */
function sameRecording(a: SpotifyTrack, b: SpotifyTrack): boolean {
  return Math.abs(a.duration_ms - b.duration_ms) <= 3000 && a.explicit === b.explicit;
}

const rank = (s: CandidateScore) =>
  (s.titleExact ? 4 : 0) + (s.allArtists ? 2 : 0) + (s.someArtist ? 1 : 0) - (s.versionMismatch.length ? 3 : 0);

/**
 * Decide o status de uma faixa. Só é "exact" quando:
 * - título base idêntico, todos os artistas pedidos presentes e nenhuma marcação de versão divergente;
 * - e todas as candidatas exatas são a mesma gravação (mesma duração ±3s e mesma flag explicit).
 */
export function classifyMatch(req: TrackRequest, results: SpotifyTrack[]): MatchResult {
  const unique = dedupeById(results).filter((t) => t.is_playable !== false);
  if (unique.length === 0) return { status: 'not_found', candidates: [], reason: 'Nenhum resultado no catálogo.' };

  const scored = unique.map((t) => scoreCandidate(req, t)).sort((a, b) => rank(b) - rank(a));
  const candidates = scored.map((s) => s.track);
  const exact = scored.filter((s) => s.titleExact && s.allArtists && s.versionMismatch.length === 0);

  if (exact.length === 0) {
    const relevant = scored.filter((s) => s.someArtist || s.titleExact);
    if (relevant.length === 0) {
      return { status: 'not_found', candidates, reason: 'Nenhum resultado com o título ou os artistas pedidos.' };
    }
    const best = relevant[0];
    const reason = best.titleExact && best.allArtists
      ? `Só há versões diferentes (${best.versionMismatch.join(', ')}). Confirme qual usar.`
      : best.titleExact
        ? 'O título coincide, mas os artistas não batem exatamente. Confirme.'
        : 'Nenhuma coincidência exata de título. Confirme ou busque manualmente.';
    return { status: 'needs_confirmation', candidates, reason };
  }

  const first = exact[0].track;
  if (exact.every((s) => sameRecording(s.track, first))) {
    return { status: 'exact', selected: first, candidates };
  }
  const hasExplicitSplit = exact.some((s) => s.track.explicit !== first.explicit);
  return {
    status: 'needs_confirmation',
    candidates,
    reason: hasExplicitSplit
      ? 'Há versão explícita e versão "clean". Escolha qual usar.'
      : 'Há mais de uma gravação com esse título e artistas. Escolha a versão certa.',
  };
}

function dedupeById(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** Monta a consulta de busca do Spotify com filtros de campo. */
export function buildSearchQuery(req: TrackRequest): string {
  const clean = (s: string) => s.replace(/"/g, ' ').trim();
  const parts = [`track:"${clean(baseTitleRaw(req.title ?? ''))}"`];
  if (req.artists[0]) parts.push(`artist:"${clean(req.artists[0])}"`);
  return parts.join(' ');
}

/** Consulta mais solta, usada quando a filtrada não retorna nada. */
export function buildLooseQuery(req: TrackRequest): string {
  return [req.title ?? '', ...req.artists].join(' ').replace(/"/g, ' ').trim();
}

function baseTitleRaw(title: string): string {
  const t = title
    .replace(/[([{]\s*(feat|ft|featuring)\.?[^)\]}]*[)\]}]/gi, '')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/i, '')
    .trim();
  return t || title;
}
