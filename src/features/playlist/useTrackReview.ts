import { useRef, useState } from 'react';
import type { TrackRequest } from '../../lib/contract';
import { resolveTrack } from '../../lib/resolver';
import type { SpotifyClient } from '../../lib/spotify';
import type { Choice, Row } from './types';

/**
 * Faixas pedidas, suas candidatas no catálogo e a escolha do usuário.
 * `isLocked` indica que a publicação já começou e nada mais pode mudar.
 */
export function useTrackReview(client: SpotifyClient, isLocked: () => boolean) {
  const [rows, setRows] = useState<Row[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [resolving, setResolving] = useState(false);
  // Busca manual em voo por faixa: uma resposta só vale se for a última pedida e se nada foi
  // escolhido ou publicado desde então.
  // Os números vêm de um contador que nunca volta a zero: uma busca de uma playlist anterior não
  // pode coincidir com a de mesma posição depois de colar outra.
  const searchSeq = useRef(new Map<number, number>());
  const searchCounter = useRef(0);
  const run = useRef(0);

  const update = (index: number, change: (row: Row) => Row) =>
    setRows((prev) => prev.map((r) => (r.req.index === index ? change(r) : r)));

  async function resolveRows(list: Row[]) {
    const id = ++run.current;
    setResolving(true);
    try {
      for (const row of list) {
        if (run.current !== id) return; // outro JSON foi colado no meio
        try {
          const match = await resolveTrack(client, row.req);
          if (run.current !== id) return;
          update(row.req.index, (r) => ({
            ...r,
            match,
            error: undefined,
            choice: match.status === 'exact' && match.selected ? { kind: 'track', track: match.selected } : undefined,
          }));
        } catch (e) {
          update(row.req.index, (r) => ({ ...r, error: (e as Error).message }));
        }
      }
    } finally {
      if (run.current === id) setResolving(false);
    }
  }

  /** Começa a conferência de uma nova playlist. */
  function start(tracks: TrackRequest[]) {
    searchSeq.current.clear();
    setOrder(tracks.map((t) => t.index));
    const initial: Row[] = tracks.map((req) => ({ req }));
    setRows(initial);
    return resolveRows(initial);
  }

  /** Descarta a playlist atual, inclusive buscas em andamento. */
  function clear() {
    run.current++;
    searchSeq.current.clear();
    setRows([]);
    setOrder([]);
    setResolving(false);
  }

  /** Invalida a busca manual em voo da faixa e devolve o número da próxima. */
  function nextSearch(index: number) {
    const seq = ++searchCounter.current;
    searchSeq.current.set(index, seq);
    return seq;
  }

  function choose(index: number, choice: Choice | undefined) {
    if (isLocked()) return;
    nextSearch(index); // a escolha explícita vale mais que uma busca que ainda vai chegar
    update(index, (r) => ({ ...r, choice }));
  }

  async function manualSearch(index: number, query: string) {
    if (isLocked()) return;
    const seq = nextSearch(index);
    update(index, (r) => ({ ...r, choice: undefined }));
    const current = () => !isLocked() && searchSeq.current.get(index) === seq;
    try {
      const found = await client.searchTracks(query);
      if (!current()) return;
      update(index, (r) => ({
        ...r,
        error: undefined,
        choice: undefined,
        match: {
          status: 'needs_confirmation',
          candidates: found,
          reason: found.length ? 'Resultados da sua busca manual.' : 'A busca manual não encontrou nada.',
        },
      }));
    } catch (e) {
      if (!current()) return;
      update(index, (r) => ({ ...r, error: (e as Error).message }));
    }
  }

  function move(index: number, delta: number) {
    setOrder((prev) => {
      const pos = prev.indexOf(index);
      const target = pos + delta;
      if (pos < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[pos], next[target]] = [next[target], next[pos]];
      return next;
    });
  }

  const rowByIndex = new Map(rows.map((r) => [r.req.index, r]));
  const orderedRows = order.map((i) => rowByIndex.get(i)!).filter(Boolean);

  return {
    orderedRows,
    finalTracks: orderedRows.flatMap((r) => (r.choice?.kind === 'track' ? [r.choice.track] : [])),
    skipped: orderedRows.filter((r) => r.choice?.kind === 'skip'),
    pending: orderedRows.filter((r) => !r.choice),
    total: rows.length,
    checked: rows.filter((r) => r.match || r.error).length,
    resolving,
    start,
    clear,
    choose,
    manualSearch,
    move,
  };
}
