import { useEffect, useRef, useState } from 'react';
import { beginLogin, missingScopes, type AccessToken, type AuthConfig, type KVStore } from './lib/auth';
import { findRepeatedRequests, parsePlaylistText, type PlaylistRequest, type TrackRequest } from './lib/contract';
import type { MatchResult, SpotifyTrack } from './lib/matching';
import { ensureVisibility, publish, type PublishOutcome, type PublishPlan, type Visibility } from './lib/publish';
import { resolveTrack } from './lib/resolver';
import type { SpotifyClient } from './lib/spotify';

export interface AppProps {
  config: AuthConfig;
  /** sessionStorage: verifier/state do PKCE e rascunho do JSON (sobrevive ao redirecionamento do login). */
  session: KVStore;
  /** localStorage: jobs de publicação (para retomar sem duplicar). Nunca guarda tokens. */
  local: KVStore;
  client: SpotifyClient;
  /** Token atual (null = não conectado). Só os escopos são lidos aqui. */
  token: AccessToken | null;
  onLogout: () => void;
  navigate?: (url: string) => void;
}

type Choice = { kind: 'track'; track: SpotifyTrack } | { kind: 'skip' };

interface Row {
  req: TrackRequest;
  match?: MatchResult;
  choice?: Choice;
  error?: string;
}

const DRAFT_KEY = 'mum.draft';

export function App({ config, session, local, client, token, onLogout, navigate }: AppProps) {
  const connected = token !== null;
  const [text, setText] = useState(() => session.getItem(DRAFT_KEY) ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [request, setRequest] = useState<PlaylistRequest | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [resolving, setResolving] = useState(false);
  const [meta, setMeta] = useState({ name: '', description: '', public: false });
  const [order, setOrder] = useState<number[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<{ added: number; total: number } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  /** A tela de resultado mostra uma conferência de visibilidade refeita a pedido do usuário. */
  const [rechecked, setRechecked] = useState(false);
  // Depois de uma tentativa de publicação, o plano fica travado: mudar nome, ordem ou faixas
  // geraria outro job e poderia criar uma segunda playlist.
  const [attempted, setAttempted] = useState(false);
  // O plano enviado na primeira tentativa é reutilizado em todas as seguintes, mesmo que algo na
  // tela mude depois (ex.: resposta atrasada de uma busca manual). Mesmo plano → mesmo job.
  const frozenPlan = useRef<PublishPlan | null>(null);
  // Busca manual em voo por faixa: uma resposta só vale se for a última pedida e se nada foi
  // escolhido ou publicado desde então.
  // Os números vêm de um contador que nunca volta a zero: uma busca de uma playlist anterior não
  // pode coincidir com a de mesma posição depois de colar outra.
  const searchSeq = useRef(new Map<number, number>());
  const searchCounter = useRef(0);
  /** Conferência de visibilidade em voo; muda ao começar outra ou ao trocar de playlist. */
  const recheckRun = useRef(0);
  const loadedText = useRef<string | null>(null);
  const run = useRef(0);

  const lacking = token ? missingScopes(token) : [];

  // Colou ou carregou o JSON: valida e já busca as faixas, sem botão intermediário.
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setErrors([]);
      return;
    }
    session.setItem(DRAFT_KEY, text);
    if (!connected || loadedText.current === trimmed) return;
    const t = setTimeout(() => load(trimmed), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, connected]);

  async function connect() {
    session.setItem(DRAFT_KEY, text);
    const url = await beginLogin(config, session);
    (navigate ?? ((u) => window.location.assign(u)))(url);
  }

  async function pasteFromClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      setErrors(['O navegador não liberou a área de transferência. Cole no campo abaixo.']);
    }
  }

  async function load(trimmed: string) {
    const res = parsePlaylistText(trimmed);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    loadedText.current = trimmed;
    setErrors([]);
    const repeated = findRepeatedRequests(res.value.tracks);
    setWarnings([
      ...(res.value.public ? ['O JSON pede playlist pública. Confira a opção de privacidade abaixo.'] : []),
      ...res.warnings,
      ...repeated.map((g) => `As posições ${g.join(', ')} repetem a mesma faixa. A repetição será mantida, a menos que você pule uma delas.`),
    ]);
    setRequest(res.value);
    setMeta({ name: res.value.name, description: res.value.description, public: res.value.public });
    setOrder(res.value.tracks.map((t) => t.index));
    setOutcome(null);
    setPublishError(null);
    unlock();
    setProgress(null);
    const initial: Row[] = res.value.tracks.map((req) => ({ req }));
    setRows(initial);
    await resolveRows(initial);
  }

  async function resolveRows(list: Row[]) {
    const id = ++run.current;
    setResolving(true);
    try {
      for (const row of list) {
        if (run.current !== id) return; // outro JSON foi colado no meio
        try {
          const match = await resolveTrack(client, row.req);
          if (run.current !== id) return;
          setRows((prev) =>
            prev.map((r) =>
              r.req.index === row.req.index
                ? { ...r, match, error: undefined, choice: match.status === 'exact' && match.selected ? { kind: 'track', track: match.selected } : undefined }
                : r,
            ),
          );
        } catch (e) {
          setRows((prev) => prev.map((r) => (r.req.index === row.req.index ? { ...r, error: (e as Error).message } : r)));
        }
      }
    } finally {
      if (run.current === id) setResolving(false);
    }
  }

  function unlock() {
    frozenPlan.current = null;
    searchSeq.current.clear();
    setAttempted(false);
    setRechecked(false);
    recheckRun.current++; // uma conferência em voo da playlist anterior não mexe mais na tela
    setPublishing(false);
  }

  /** Invalida a busca manual em voo da faixa e devolve o número da próxima. */
  function nextSearch(index: number) {
    const seq = ++searchCounter.current;
    searchSeq.current.set(index, seq);
    return seq;
  }

  function choose(index: number, choice: Choice | undefined) {
    if (frozenPlan.current) return;
    nextSearch(index); // a escolha explícita vale mais que uma busca que ainda vai chegar
    setRows((prev) => prev.map((r) => (r.req.index === index ? { ...r, choice } : r)));
  }

  async function manualSearch(index: number, query: string) {
    if (frozenPlan.current) return;
    const seq = nextSearch(index);
    setRows((prev) => prev.map((r) => (r.req.index === index ? { ...r, choice: undefined } : r)));
    const current = () => !frozenPlan.current && searchSeq.current.get(index) === seq;
    try {
      const found = await client.searchTracks(query);
      if (!current()) return;
      setRows((prev) =>
        prev.map((r) =>
          r.req.index === index
            ? {
                ...r,
                error: undefined,
                choice: undefined,
                match: {
                  status: 'needs_confirmation',
                  candidates: found,
                  reason: found.length ? 'Resultados da sua busca manual.' : 'A busca manual não encontrou nada.',
                },
              }
            : r,
        ),
      );
    } catch (e) {
      if (!current()) return;
      setRows((prev) => prev.map((r) => (r.req.index === index ? { ...r, error: (e as Error).message } : r)));
    }
  }

  function reset() {
    setText('');
    session.removeItem(DRAFT_KEY);
    loadedText.current = null;
    run.current++;
    setRequest(null);
    setRows([]);
    setOutcome(null);
    setPublishError(null);
    unlock();
    setProgress(null);
    setWarnings([]);
  }

  const rowByIndex = new Map(rows.map((r) => [r.req.index, r]));
  const orderedRows = order.map((i) => rowByIndex.get(i)!).filter(Boolean);
  const finalTracks = orderedRows.filter((r) => r.choice?.kind === 'track').map((r) => (r.choice as { track: SpotifyTrack }).track);
  const skipped = orderedRows.filter((r) => r.choice?.kind === 'skip');
  const pending = orderedRows.filter((r) => !r.choice);
  const decided = orderedRows.filter((r) => r.choice);
  const checked = rows.filter((r) => r.match || r.error).length;

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

  async function doPublish(confirmRecreate = false) {
    frozenPlan.current ??= {
      name: meta.name.trim(),
      description: meta.description.trim(),
      public: meta.public,
      uris: finalTracks.map((t) => t.uri),
    };
    const plan = frozenPlan.current;
    setPublishing(true);
    setAttempted(true);
    setPublishError(null);
    try {
      const result = await publish(client, plan, local, { confirmRecreate, onProgress: (added, total) => setProgress({ added, total }) });
      setOutcome(result);
      if (result.kind === 'done') session.removeItem(DRAFT_KEY);
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  /**
   * "Conferir visibilidade de novo": só lê (e, se preciso, corrige) o campo `public` da playlist já
   * publicada. Não passa por publish(): não há caminho que crie playlist ou adicione faixas, mesmo
   * se o job salvo tiver sumido. A tela mantém o resultado original e só atualiza a visibilidade.
   */
  async function recheckVisibility() {
    if (outcome?.kind !== 'done') return;
    const { playlistId } = outcome;
    const wantPublic = frozenPlan.current?.public ?? meta.public;
    const id = ++recheckRun.current;
    const current = () => recheckRun.current === id;
    setPublishing(true);
    setRechecked(false);
    setPublishError(null);
    try {
      const visibility = await ensureVisibility(client, playlistId, wantPublic);
      if (!current()) return;
      setOutcome((prev) => (prev?.kind === 'done' && prev.playlistId === playlistId ? { ...prev, visibility } : prev));
      setRechecked(true);
    } catch (e) {
      if (current()) setPublishError((e as Error).message);
    } finally {
      if (current()) setPublishing(false);
    }
  }

  if (!config.clientId) {
    return (
      <main className="app">
        <Header />
        <section className="card error" role="alert">
          O Client ID do Spotify não está configurado. Defina <code>VITE_SPOTIFY_CLIENT_ID</code> no ambiente (Vercel ou{' '}
          <code>.env.local</code>) e publique de novo.
        </section>
      </main>
    );
  }

  if (outcome?.kind === 'done') {
    return (
      <main className="app">
        <Header />
        <section className="card result" aria-label="Resultado">
          <h2>{outcome.alreadyPublished ? 'Essa playlist já estava publicada' : 'Playlist publicada'}</h2>
          <p className="big">
            <strong>{outcome.added}</strong> faixa(s) confirmadas pelo Spotify · {visibilitySummary(outcome.visibility, meta.public)}
          </p>
          {rechecked && !publishing && outcome.visibility !== 'unknown' && (
            <p className="hint" role="status">
              Visibilidade conferida novamente com o Spotify. Nenhuma faixa foi adicionada.
            </p>
          )}
          {publishError && (
            <p className="error" role="alert">
              {publishError}
            </p>
          )}
          <VisibilityNote outcome={outcome} wantPublic={meta.public} onRetry={recheckVisibility} busy={publishing} />
          <a className="button" href={outcome.playlistUrl} target="_blank" rel="noreferrer">
            Abrir no Spotify
          </a>
          {skipped.length > 0 && (
            <details>
              <summary>{skipped.length} faixa(s) puladas por você</summary>
              <ul>{skipped.map((r) => <li key={r.req.index}>{describeRequest(r.req)}</li>)}</ul>
            </details>
          )}
          <button className="secondary" onClick={reset} disabled={publishing}>
            Nova playlist
          </button>
        </section>
      </main>
    );
  }

  const canPublish = connected && !resolving && pending.length === 0 && finalTracks.length > 0 && !!meta.name.trim() && !publishing;
  let primaryLabel = `Publicar ${finalTracks.length} faixa${finalTracks.length === 1 ? '' : 's'}`;
  if (publishing) primaryLabel = progress ? `Publicando… ${progress.added}/${progress.total}` : 'Publicando…';
  else if (resolving) primaryLabel = `Buscando faixas… ${checked}/${rows.length}`;
  else if (pending.length) primaryLabel = `Confira ${pending.length} faixa${pending.length === 1 ? '' : 's'}`;

  return (
    <main className={`app${request ? ' has-footer' : ''}`}>
      <Header>
        {connected && (
          <button className="link" onClick={onLogout}>
            Sair
          </button>
        )}
      </Header>

      {!connected && (
        <section className="card connect" aria-label="Conexão com o Spotify">
          <p>Conecte sua conta do Spotify uma vez. O app lembra o acesso neste aparelho.</p>
          <button className="wide" onClick={connect}>Conectar ao Spotify</button>
        </section>
      )}
      {lacking.length > 0 && <p className="card error">Permissões faltando: {lacking.join(', ')}. Toque em Sair e conecte de novo.</p>}

      {!request && (
        <section className="card" aria-label="Importar playlist">
          <h2>Cole a playlist aprovada no ChatGPT</h2>
          <div className="row">
            <button className="wide" onClick={pasteFromClipboard}>Colar da área de transferência</button>
            <label className="button secondary file">
              Arquivo .json
              <input type="file" accept=".json,application/json" aria-label="Arquivo JSON" onChange={(e) => e.target.files?.[0]?.text().then(setText)} />
            </label>
          </div>
          <textarea
            aria-label="JSON da playlist"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Ou cole aqui: {"schema_version": "1.0", "playlist": {...}, "tracks": [...]}'
          />
          {errors.length > 0 && (
            <ul className="error" role="alert">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </section>
      )}

      {request && (
        <>
          <section className="card" aria-label="Playlist">
            <label>
              Nome
              <input disabled={attempted} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            </label>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                disabled={attempted}
                checked={!meta.public}
                onChange={(e) => setMeta({ ...meta, public: !e.target.checked })}
              />
              <span>
                <strong>{meta.public ? 'Aparece no seu perfil' : 'Fora do seu perfil'}</strong>
                <small>
                  {meta.public
                    ? 'Qualquer pessoa pode encontrar a playlist no seu perfil.'
                    : 'Não aparece no perfil nem na busca. Quem tiver o link ainda consegue abrir.'}
                </small>
              </span>
            </label>
            <p className="summary">
              <span className="ok">{decided.filter((r) => r.choice?.kind === 'track').length} prontas</span>
              {pending.length > 0 && <span className="warn">{pending.length} para conferir</span>}
              {skipped.length > 0 && <span className="muted">{skipped.length} puladas</span>}
              {resolving && <span className="muted">buscando {checked}/{rows.length}</span>}
            </p>
            {warnings.length > 0 && <ul className="warning">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          </section>

          {pending.length > 0 && (
            <section className="card" aria-label="Conferir correspondências">
              <h2>Confira antes de publicar</h2>
              <ol className="tracks">
                {pending.map((row) => (
                  <TrackReview
                    key={row.req.index}
                    row={row}
                    disabled={attempted}
                    onChoose={(c) => choose(row.req.index, c)}
                    onSearch={(q) => manualSearch(row.req.index, q)}
                  />
                ))}
              </ol>
            </section>
          )}

          {decided.length > 0 && (
            <section className="card" aria-label="Faixas prontas">
              <details>
                <summary>Ver faixas e ordem ({orderedRows.length})</summary>
                <ol className="preview">
                  {orderedRows.map((r, pos) => (
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
                          <button className="icon" aria-label={`Trocar ${describeRequest(r.req)}`} disabled={attempted} onClick={() => choose(r.req.index, undefined)}>
                            ✎
                          </button>
                        )}
                        <button className="icon" aria-label={`Subir posição ${pos + 1}`} onClick={() => move(r.req.index, -1)} disabled={attempted || pos === 0}>↑</button>
                        <button className="icon" aria-label={`Descer posição ${pos + 1}`} onClick={() => move(r.req.index, 1)} disabled={attempted || pos === orderedRows.length - 1}>↓</button>
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          )}

          {publishError && (
            <p className="card error" role="alert">
              {publishError} Toque em Publicar de novo: o app continua de onde parou, sem duplicar.
            </p>
          )}
          {outcome?.kind === 'uncertain_create' && (
            <div className="card warning" role="alert">
              <p>{outcome.message}</p>
              <button onClick={() => doPublish(true)} disabled={publishing}>Conferi: criar a playlist</button>
            </div>
          )}
          {outcome?.kind === 'diverged' && (
            <p className="card error" role="alert">
              {outcome.message} <a href={outcome.playlistUrl} target="_blank" rel="noreferrer">Abrir playlist</a>
            </p>
          )}
          {!attempted && (
            <button className="link center" onClick={reset}>
              Cancelar e colar outra playlist
            </button>
          )}

          <footer className="action-bar">
            <button
              className="wide"
              disabled={!canPublish && !(pending.length > 0 && !resolving)}
              onClick={() => {
                if (pending.length) document.querySelector('[aria-label="Conferir correspondências"]')?.scrollIntoView({ behavior: 'smooth' });
                else doPublish();
              }}
            >
              {primaryLabel}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="top">
      <div>
        <h1>Meu Universo Musical</h1>
        <p className="subtitle">Publicador de playlists aprovadas no ChatGPT</p>
      </div>
      {children}
    </header>
  );
}

function VisibilityNote({
  outcome,
  wantPublic,
  onRetry,
  busy,
}: {
  outcome: Extract<PublishOutcome, { kind: 'done' }>;
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

function describeRequest(req: TrackRequest): string {
  return req.title ? `${req.title} — ${req.artists.join(', ')}` : (req.spotifyUri ?? '');
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TrackLabel({ track }: { track: SpotifyTrack }) {
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

const STATUS_LABEL = {
  exact: 'Encontrada',
  needs_confirmation: 'Precisa de confirmação',
  not_found: 'Não encontrada',
} as const;

function TrackReview({
  row,
  disabled,
  onChoose,
  onSearch,
}: {
  row: Row;
  disabled: boolean;
  onChoose: (c: Choice | undefined) => void;
  onSearch: (q: string) => void;
}) {
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
