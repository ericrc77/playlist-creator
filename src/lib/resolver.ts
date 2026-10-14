// Resolve cada faixa pedida em candidatas do catálogo do Spotify.

import { trackIdFromUri, type TrackRequest } from './contract';
import { buildLooseQuery, buildSearchQuery, classifyMatch, scoreCandidate, type MatchResult } from './matching';
import { SpotifyApiError, type SpotifyClient } from './spotify';

export async function resolveTrack(client: SpotifyClient, req: TrackRequest): Promise<MatchResult> {
  if (req.spotifyUri) return resolveByUri(client, req);

  let results = await client.searchTracks(buildSearchQuery(req));
  if (results.length === 0) results = await client.searchTracks(buildLooseQuery(req));
  return classifyMatch(req, results);
}

async function resolveByUri(client: SpotifyClient, req: TrackRequest): Promise<MatchResult> {
  try {
    const track = await client.getTrack(trackIdFromUri(req.spotifyUri!));
    if (track.is_playable === false) {
      return { status: 'needs_confirmation', candidates: [track], reason: 'A faixa do link pode estar indisponível na sua região.' };
    }
    // O link é autoritativo, mas se o JSON também traz título/artistas e eles não batem, pedimos confirmação.
    if (req.title || req.artists.length) {
      const s = scoreCandidate(req, track);
      const titleOk = !req.title || s.titleExact;
      const artistsOk = req.artists.length === 0 || s.allArtists;
      if (!titleOk || !artistsOk) {
        return {
          status: 'needs_confirmation',
          candidates: [track],
          reason: 'O link do Spotify aponta para uma faixa com título/artistas diferentes do JSON. Confirme.',
        };
      }
    }
    return { status: 'exact', selected: track, candidates: [track] };
  } catch (e) {
    if (e instanceof SpotifyApiError && (e.kind === 'not_found' || e.kind === 'bad_request')) {
      return { status: 'not_found', candidates: [], reason: 'O link/URI do Spotify informado não existe.' };
    }
    throw e;
  }
}

/** Resolve todas as faixas em sequência (evita rajadas que geram 429). */
export async function resolveAll(
  client: SpotifyClient,
  tracks: TrackRequest[],
  onProgress?: (index: number, result: MatchResult) => void,
): Promise<MatchResult[]> {
  const out: MatchResult[] = [];
  for (const t of tracks) {
    const r = await resolveTrack(client, t);
    out.push(r);
    onProgress?.(t.index, r);
  }
  return out;
}
