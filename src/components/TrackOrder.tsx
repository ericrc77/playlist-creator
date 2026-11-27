import type { Row } from '../features/playlist/types';
import { describeRequest } from './format';
import { TrackLabel } from './TrackLabel';

interface TrackOrderProps {
  rows: Row[];
  disabled: boolean;
  onMove: (index: number, delta: number) => void;
  onClearChoice: (index: number) => void;
}

export function TrackOrder({ rows, disabled, onMove, onClearChoice }: TrackOrderProps) {
  return (
    <section className="card" aria-label="Faixas prontas">
      <details>
        <summary>Ver faixas e ordem ({rows.length})</summary>
        <ol className="preview">
          {rows.map((r, pos) => (
            <li key={r.req.index} className={r.choice?.kind === 'skip' ? 'skipped' : !r.choice ? 'pending' : ''}>
              {r.choice?.kind === 'track' ? (
                <TrackLabel track={r.choice.track} />
              ) : (
                <span>
                  {r.choice ? 'Pulada' : 'A conferir'}: {describeRequest(r.req)}
                </span>
              )}
              <span className="moves">
                {r.choice && (
                  <button className="icon" aria-label={`Trocar ${describeRequest(r.req)}`} disabled={disabled} onClick={() => onClearChoice(r.req.index)}>
                    ✎
                  </button>
                )}
                <button className="icon" aria-label={`Subir posição ${pos + 1}`} onClick={() => onMove(r.req.index, -1)} disabled={disabled || pos === 0}>↑</button>
                <button className="icon" aria-label={`Descer posição ${pos + 1}`} onClick={() => onMove(r.req.index, 1)} disabled={disabled || pos === rows.length - 1}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
