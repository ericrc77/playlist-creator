import type { TrackRequest } from '../../lib/contract';
import type { MatchResult, SpotifyTrack } from '../../lib/matching';

export type Choice = { kind: 'track'; track: SpotifyTrack } | { kind: 'skip' };

export interface Row {
  req: TrackRequest;
  match?: MatchResult;
  choice?: Choice;
  error?: string;
}
