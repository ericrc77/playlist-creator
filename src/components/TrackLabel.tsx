import type { SpotifyTrack } from '../lib/matching';
import { formatDuration } from './format';

export function TrackLabel({ track }: { track: SpotifyTrack }) {
  return (
    <span className="track-label">
      <strong>{track.name}</strong> — {track.artists.map((a) => a.name).join(', ')}
      <small>
        {' '}· {track.album.name} · {formatDuration(track.duration_ms)}
        {track.explicit && <span className="badge" title="Explícita">E</span>}
        {track.external_urls?.spotify && (
          <>
            {' '}· <a href={track.external_urls.spotify} target="_blank" rel="noreferrer">ouvir</a>
          </>
        )}
      </small>
    </span>
  );
}
