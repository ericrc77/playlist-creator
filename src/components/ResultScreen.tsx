import type { Row } from '../features/playlist/types';
import type { PublishOutcome, Visibility } from '../lib/publish';
import { describeRequest } from './format';

type DoneOutcome = Extract<PublishOutcome, { kind: 'done' }>;

interface ResultScreenProps {
  outcome: DoneOutcome;
  wantPublic: boolean;
  skipped: Row[];
  busy: boolean;
  rechecked: boolean;
  error: string | null;
  demo: boolean;
  onRecheck: () => void;
  onReset: () => void;
}

export function ResultScreen({ outcome, wantPublic, skipped, busy, rechecked, error, demo, onRecheck, onReset }: ResultScreenProps) {
  return (
    <section className="card result" aria-label="Resultado">
      <h2>{outcome.alreadyPublished ? 'Essa playlist já estava publicada' : 'Playlist publicada'}</h2>
      <p className="big">
        <strong>{outcome.added}</strong> faixa(s) confirmadas pelo Spotify · {visibilitySummary(outcome.visibility, wantPublic)}
      </p>
      {rechecked && !busy && outcome.visibility !== 'unknown' && (
        <p className="hint" role="status">
          Visibilidade conferida novamente com o Spotify. Nenhuma faixa foi adicionada.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <VisibilityNote outcome={outcome} wantPublic={wantPublic} onRetry={onRecheck} busy={busy} />
      {demo ? (
        <p className="hint">Demonstração: o Spotify é simulado e nenhuma playlist real foi criada.</p>
      ) : (
        <a className="button" href={outcome.playlistUrl} target="_blank" rel="noreferrer">
          Abrir no Spotify
        </a>
      )}
      {skipped.length > 0 && (
        <details>
          <summary>{skipped.length} faixa(s) puladas por você</summary>
          <ul>{skipped.map((r) => <li key={r.req.index}>{describeRequest(r.req)}</li>)}</ul>
        </details>
      )}
      <button className="secondary" onClick={onReset} disabled={busy}>
        Nova playlist
      </button>
    </section>
  );
}

function VisibilityNote({
  outcome,
  wantPublic,
  onRetry,
  busy,
}: {
  outcome: DoneOutcome;
  wantPublic: boolean;
  onRetry: () => void;
  busy: boolean;
}) {
  const option = wantPublic ? 'pública' : 'não pública';
  if (outcome.visibility === 'mismatch' || outcome.visibility === 'unknown') {
    return (
      <div className="error" role="alert">
        <p>
          {/* Só o que a API confirmou: o campo `public`. Se a playlist aparece no perfil, a API não diz. */}
          {outcome.visibility === 'mismatch'
            ? wantPublic
              ? 'O Spotify manteve a playlist não pública, apesar da solicitação para torná-la pública.'
              : 'O Spotify manteve a playlist pública, apesar da solicitação de privacidade.'
            : `Não foi possível confirmar com o Spotify se a playlist ficou ${option}.`}{' '}
          Confira de novo ou ajuste no app do Spotify, no menu da playlist.
        </p>
        <button className="secondary" onClick={onRetry} disabled={busy}>
          Conferir visibilidade de novo
        </button>
      </div>
    );
  }
  return (
    <p className="hint">
      {outcome.visibility === 'corrected' && 'O Spotify criou com a visibilidade errada e o app corrigiu. '}
      {!wantPublic &&
        'Para bloquear também quem tem o link, use "Tornar privada" no menu da playlist no app do Spotify: a API não oferece essa opção.'}
    </p>
  );
}

/** Resumo da visibilidade na linha de resultado: afirma só o que a API confirmou. */
function visibilitySummary(visibility: Visibility, wantPublic: boolean): string {
  switch (visibility) {
    case 'ok':
    case 'corrected':
      return wantPublic ? 'playlist pública' : 'playlist não pública';
    case 'mismatch':
      return wantPublic ? 'o Spotify manteve não pública' : 'o Spotify manteve pública';
    default:
      return 'visibilidade não confirmada';
  }
}
