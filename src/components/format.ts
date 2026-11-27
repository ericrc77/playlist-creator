import type { TrackRequest } from '../lib/contract';

export function describeRequest(req: TrackRequest): string {
  return req.title ? `${req.title} — ${req.artists.join(', ')}` : (req.spotifyUri ?? '');
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
