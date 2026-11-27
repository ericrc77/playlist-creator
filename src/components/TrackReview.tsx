import { useState } from 'react';
import type { Choice, Row } from '../features/playlist/types';
import { describeRequest } from './format';
import { TrackLabel } from './TrackLabel';

const STATUS_LABEL = {
  exact: 'Encontrada',
  needs_confirmation: 'Precisa de confirmação',
  not_found: 'Não encontrada',
} as const;

interface TrackReviewProps {
  row: Row;
  disabled: boolean;
  onChoose: (c: Choice | undefined) => void;
  onSearch: (q: string) => void;
}

export function TrackReview({ row, disabled, onChoose, onSearch }: TrackReviewProps) {
  const [query, setQuery] = useState(() => [row.req.title, ...row.req.artists].filter(Boolean).join(' '));
  const status = row.match?.status;
  const name = `choice-${row.req.index}`;
  return (
    <li className={`track ${status ?? 'loading'}`} data-testid={`track-${row.req.index}`}>
      <div className="row">
        <strong>{describeRequest(row.req)}</strong>
        <span className={`status ${status ?? ''}`}>{row.error ? 'Erro' : status ? STATUS_LABEL[status] : 'Buscando…'}</span>
      </div>
      {row.error && <p className="error">{row.error}</p>}
      {row.match?.reason && <p className="hint">{row.match.reason}</p>}
      {(row.match || row.error) && (
        <fieldset disabled={disabled}>
          <legend className="sr-only">Escolha para {describeRequest(row.req)}</legend>
          {row.match?.candidates.map((t) => (
            <label key={t.id} className="candidate">
              <input
                type="radio"
                name={name}
                checked={row.choice?.kind === 'track' && row.choice.track.id === t.id}
                onChange={() => onChoose({ kind: 'track', track: t })}
              />
              <TrackLabel track={t} />
            </label>
          ))}
          <label className="candidate">
            <input type="radio" name={name} checked={row.choice?.kind === 'skip'} onChange={() => onChoose({ kind: 'skip' })} />
            Pular esta faixa (não adicionar)
          </label>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) onSearch(query.trim());
            }}
          >
            <input aria-label="Busca manual" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="secondary" type="submit">Buscar</button>
          </form>
        </fieldset>
      )}
    </li>
  );
}
