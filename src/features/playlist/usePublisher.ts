import { useRef, useState } from 'react';
import type { KVStore } from '../../lib/auth';
import { ensureVisibility, publish, type PublishOutcome, type PublishPlan } from '../../lib/publish';
import type { SpotifyClient } from '../../lib/spotify';

interface PublisherOptions {
  client: SpotifyClient;
  store: KVStore;
  /** Chamado quando a publicação termina com sucesso. */
  onDone: () => void;
}

/** Publicação do plano aprovado e conferência de visibilidade. */
export function usePublisher({ client, store, onDone }: PublisherOptions) {
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<{ added: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  /** A tela de resultado mostra uma conferência de visibilidade refeita a pedido do usuário. */
  const [rechecked, setRechecked] = useState(false);
  // Depois de uma tentativa de publicação, o plano fica travado: mudar nome, ordem ou faixas
  // geraria outro job e poderia criar uma segunda playlist.
  const [attempted, setAttempted] = useState(false);
  // O plano enviado na primeira tentativa é reutilizado em todas as seguintes, mesmo que algo na
  // tela mude depois (ex.: resposta atrasada de uma busca manual). Mesmo plano → mesmo job.
  const frozenPlan = useRef<PublishPlan | null>(null);
  /** Conferência de visibilidade em voo; muda ao começar outra ou ao trocar de playlist. */
  const recheckRun = useRef(0);

  function reset() {
    frozenPlan.current = null;
    recheckRun.current++; // uma conferência em voo da playlist anterior não mexe mais na tela
    setAttempted(false);
    setRechecked(false);
    setPublishing(false);
    setOutcome(null);
    setError(null);
    setProgress(null);
  }

  async function submit(buildPlan: () => PublishPlan, confirmRecreate = false) {
    const plan = (frozenPlan.current ??= buildPlan());
    setPublishing(true);
    setAttempted(true);
    setError(null);
    try {
      const result = await publish(client, plan, store, { confirmRecreate, onProgress: (added, total) => setProgress({ added, total }) });
      setOutcome(result);
      if (result.kind === 'done') onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  /**
   * "Conferir visibilidade de novo": só lê (e, se preciso, corrige) o campo `public` da playlist já
   * publicada. Não passa por publish(): não há caminho que crie playlist ou adicione faixas, mesmo
   * se o job salvo tiver sumido. A tela mantém o resultado original e só atualiza a visibilidade.
   */
  async function recheckVisibility(fallbackPublic: boolean) {
    if (outcome?.kind !== 'done') return;
    const { playlistId } = outcome;
    const wantPublic = frozenPlan.current?.public ?? fallbackPublic;
    const id = ++recheckRun.current;
    const current = () => recheckRun.current === id;
    setPublishing(true);
    setRechecked(false);
    setError(null);
    try {
      const visibility = await ensureVisibility(client, playlistId, wantPublic);
      if (!current()) return;
      setOutcome((prev) => (prev?.kind === 'done' && prev.playlistId === playlistId ? { ...prev, visibility } : prev));
      setRechecked(true);
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setPublishing(false);
    }
  }

  return {
    publishing,
    progress,
    error,
    outcome,
    rechecked,
    attempted,
    isLocked: () => frozenPlan.current !== null,
    reset,
    submit,
    recheckVisibility,
  };
}
