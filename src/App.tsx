import { useMemo, useState } from 'react';
import { beginLogin, clearTokens, loadTokens, missingScopes, type AuthConfig, type KVStore } from './lib/auth';
import { findRepeatedRequests, parsePlaylistText, type PlaylistRequest, type TrackRequest } from './lib/contract';
import type { MatchResult, SpotifyTrack } from './lib/matching';
import { publish, type PublishOutcome } from './lib/publish';
import { resolveTrack } from './lib/resolver';
import { isValidClientId, makeClient, saveClientId } from './lib/session';
import type { SpotifyClient } from './lib/spotify';

export interface AppDeps {
  config: AuthConfig;
  /** sessionStorage: tokens e rascunho (some ao fechar a aba). */
  session: KVStore;
  /** localStorage: Client ID e jobs de publicação (para retomar sem duplicar). */
  local: KVStore;
  /** Permite injetar um cliente falso nos testes. */
  createClient?: (onLoggedOut: () => void) => SpotifyClient;
  navigate?: (url: string) => void;
}

type Choice = { kind: 'track'; track: SpotifyTrack } | { kind: 'skip' };

interface Row {
  req: TrackRequest;
  match?: MatchResult;
  choice?: Choice;
  error?: string;
}

type Step = 'import' | 'review' | 'preview' | 'result';

const DRAFT_KEY = 'mum.draft';

export function App({ config: initialConfig, session, local, createClient, navigate }: AppDeps) {
  const [config, setConfig] = useState(initialConfig);
  const [connected, setConnected] = useState(() => loadTokens(session) !== null);
  const [step, setStep] = useState<Step>('import');
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
  // Depois de uma tentativa de publicação, o plano fica travado: mudar nome, ordem ou faixas
  // geraria outro job e poderia criar uma segunda playlist.
  const [attempted, setAttempted] = useState(false);

  const client = useMemo(() => {
    const onLoggedOut = () => setConnected(false);
    return createClient ? createClient(onLoggedOut) : makeClient(config, session, onLoggedOut);
  }, [config, session, createClient]);

  const tokens = connected ? loadTokens(session) : null;
  const lacking = tokens ? missingScopes(tokens) : [];

  async function connect() {
    session.setItem(DRAFT_KEY, text);
    const url = await beginLogin(config, session);
    (navigate ?? ((u) => window.location.assign(u)))(url);
  }

  function disconnect() {
    clearTokens(session);
    setConnected(false);
  }

  function onFile(file: File) {
    file.text().then(setText);
  }

  async function importPlaylist() {
    const res = parsePlaylistText(text);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors([]);
    session.setItem(DRAFT_KEY, text);
    const repeated = findRepeatedRequests(res.value.tracks);
    setWarnings([
      ...res.warnings,
      ...repeated.map((g) => `As posições ${g.join(', ')} repetem a mesma faixa. A repetição será mantida, a menos que você pule uma delas.`),
    ]);
    setRequest(res.value);
    setMeta({ name: res.value.name, description: res.value.description, public: res.value.public });
    setOrder(res.value.tracks.map((t) => t.index));
    setOutcome(null);
    setPublishError(null);
    setAttempted(false);
    const initial: Row[] = res.value.tracks.map((req) => ({ req }));
    setRows(initial);
    setStep('review');
    await resolveRows(initial);
  }

  async function resolveRows(list: Row[]) {
    setResolving(true);
    try {
      for (const row of list) {
        try {
          const match = await resolveTrack(client, row.req);
          setRows((prev) =>
            prev.map((r) =>
              r.req.index === row.req.index
                ? { ...r, match, error: undefined, choice: match.status === 'exact' && match.selected ? { kind: 'track', track: match.selected } : undefined }
                : r,
            ),
          );
        } catch (e) {
          setRows((prev) => prev.map((r) => (r.req.index === row.req.index ? { ...r, error: (e as Error).message } : r)));
          if (!loadTokens(session) && !createClient) break;
        }
      }
    } finally {
      setResolving(false);
    }
  }

  function choose(index: number, choice: Choice | undefined) {
    setRows((prev) => prev.map((r) => (r.req.index === index ? { ...r, choice } : r)));
  }

  async function manualSearch(index: number, query: string) {
    try {
      const found = await client.searchTracks(query);
      setRows((prev) =>
        prev.map((r) =>
          r.req.index === index
            ? {
                ...r,
                error: undefined,
                match: {
                  status: r.match?.status === 'exact' ? 'needs_confirmation' : (r.match?.status ?? 'needs_confirmation'),
                  candidates: found,
                  reason: found.length ? 'Resultados da sua busca manual.' : 'A busca manual não encontrou nada.',
                },
              }
            : r,
        ),
      );
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.req.index === index ? { ...r, error: (e as Error).message } : r)));
    }
  }

  const pending = rows.filter((r) => !r.choice);
  const rowByIndex = new Map(rows.map((r) => [r.req.index, r]));
  const orderedRows = order.map((i) => rowByIndex.get(i)!).filter(Boolean);
  const finalTracks = orderedRows.filter((r) => r.choice?.kind === 'track').map((r) => (r.choice as { track: SpotifyTrack }).track);
  const skipped = orderedRows.filter((r) => r.choice?.kind === 'skip');

  function move(pos: number, delta: number) {
    setOrder((prev) => {
      const next = [...prev];
      const target = pos + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[pos], next[target]] = [next[target], next[pos]];
      return next;
    });
  }

  async function doPublish(confirmRecreate = false) {
    setPublishing(true);
    setAttempted(true);
    setPublishError(null);
    try {
      const result = await publish(
        client,
        { name: meta.name.trim(), description: meta.description.trim(), public: meta.public, uris: finalTracks.map((t) => t.uri) },
        local,
        { confirmRecreate, onProgress: (added, total) => setProgress({ added, total }) },
      );
      setOutcome(result);
      if (result.kind === 'done') setStep('result');
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Meu Universo Musical</h1>
        <p className="subtitle">Publicador de playlists aprovadas no ChatGPT</p>
      </header>

      <section className="card" aria-label="Conexão com o Spotify">
        {!config.clientId ? (
          <ClientIdForm
            onSave={(id) => {
              saveClientId(local, id);
              setConfig({ ...config, clientId: id.trim() });
            }}
            redirectUri={config.redirectUri}
          />
        ) : connected ? (
          <div className="row">
            <span>✅ Spotify conectado</span>
            <button className="link" onClick={disconnect}>Desconectar</button>
          </div>
        ) : (
          <div className="row">
            <span>Conecte sua conta do Spotify para buscar e publicar.</span>
            <button onClick={connect}>Conectar ao Spotify</button>
          </div>
        )}
        {lacking.length > 0 && (
          <p className="error">Permissões faltando: {lacking.join(', ')}. Desconecte e conecte novamente.</p>
        )}
      </section>

      {step === 'import' && (
        <section className="card" aria-label="Importar playlist">
          <h2>1. Importar o JSON aprovado</h2>
          <p>Cole o JSON gerado pelo ChatGPT depois da sua aprovação, ou carregue o arquivo <code>.json</code>.</p>
          <textarea
            aria-label="JSON da playlist"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"schema_version": "1.0", "playlist": {...}, "tracks": [...]}'
          />
          <div className="row">
            <input type="file" accept=".json,application/json" aria-label="Arquivo JSON" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <button onClick={importPlaylist} disabled={!connected}>Validar e buscar faixas</button>
          </div>
          {!connected && <p className="hint">Conecte o Spotify antes de buscar as faixas.</p>}
          {errors.length > 0 && (
            <ul className="error" role="alert">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </section>
      )}

      {step === 'review' && request && (
        <section className="card" aria-label="Conferir correspondências">
          <h2>2. Conferir correspondências</h2>
          <p>
            {rows.length} faixa(s). Faixas com correspondência exata já vêm marcadas; as demais precisam da sua escolha. Nada é
            escolhido em silêncio.
          </p>
          {warnings.length > 0 && <ul className="warning">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <ol className="tracks">
            {rows.map((row) => (
              <TrackReview key={row.req.index} row={row} onChoose={(c) => choose(row.req.index, c)} onSearch={(q) => manualSearch(row.req.index, q)} />
            ))}
          </ol>
          <div className="row">
            <button className="secondary" onClick={() => setStep('import')}>Voltar</button>
            <button onClick={() => setStep('preview')} disabled={resolving || pending.length > 0}>
              {resolving ? 'Buscando…' : pending.length ? `Faltam ${pending.length} decisão(ões)` : 'Ir para a prévia'}
            </button>
          </div>
        </section>
      )}

      {step === 'preview' && request && (
        <section className="card" aria-label="Prévia final">
          <h2>3. Prévia final</h2>
          <label>
            Nome
            <input disabled={attempted} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </label>
          <label>
            Descrição
            <input disabled={attempted} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </label>
          <label className="inline">
            <input type="checkbox" disabled={attempted} checked={meta.public} onChange={(e) => setMeta({ ...meta, public: e.target.checked })} />
            Playlist pública (recomendado: deixar desmarcado)
          </label>
          <p>
            <strong>{finalTracks.length}</strong> faixa(s) serão adicionadas · {meta.public ? 'Pública' : 'Privada'}
            {skipped.length > 0 && <> · {skipped.length} pulada(s)</>}
          </p>
          <ol className="preview">
            {orderedRows.map((r, pos) => (
              <li key={r.req.index} className={r.choice?.kind === 'skip' ? 'skipped' : ''}>
                {r.choice?.kind === 'track' ? <TrackLabel track={r.choice.track} /> : <span>Pulada: {describeRequest(r.req)}</span>}
                <span className="moves">
                  <button className="icon" aria-label={`Subir posição ${pos + 1}`} onClick={() => move(pos, -1)} disabled={attempted || pos === 0}>↑</button>
                  <button className="icon" aria-label={`Descer posição ${pos + 1}`} onClick={() => move(pos, 1)} disabled={attempted || pos === orderedRows.length - 1}>↓</button>
                </span>
              </li>
            ))}
          </ol>
          {publishError && <p className="error" role="alert">{publishError} Você pode tentar de novo: a publicação retoma de onde parou, sem duplicar.</p>}
          {outcome?.kind === 'uncertain_create' && (
            <div className="warning" role="alert">
              <p>{outcome.message}</p>
              <button onClick={() => doPublish(true)}>Conferi: criar a playlist</button>
            </div>
          )}
          {outcome?.kind === 'diverged' && (
            <p className="error" role="alert">
              {outcome.message} <a href={outcome.playlistUrl} target="_blank" rel="noreferrer">Abrir playlist</a>
            </p>
          )}
          {attempted && !publishing && (
            <p className="hint">A playlist está travada para edição desde a primeira tentativa, para evitar uma segunda playlist.</p>
          )}
          {progress && publishing && <p>Adicionando faixas: {progress.added}/{progress.total}</p>}
          <div className="row">
            <button className="secondary" onClick={() => setStep('review')} disabled={attempted}>Voltar</button>
            <button onClick={() => doPublish()} disabled={publishing || finalTracks.length === 0 || !meta.name.trim() || !connected}>
              {publishing ? 'Publicando…' : `Publicar no Spotify (${finalTracks.length} faixas)`}
            </button>
          </div>
        </section>
      )}

      {step === 'result' && outcome?.kind === 'done' && (
        <section className="card" aria-label="Resultado">
          <h2>✅ Playlist {outcome.alreadyPublished ? 'já estava publicada' : 'publicada'}</h2>
          <p>
            <a href={outcome.playlistUrl} target="_blank" rel="noreferrer">{outcome.playlistUrl}</a>
          </p>
          <p>{outcome.added} faixa(s) confirmadas na playlist pelo Spotify.</p>
          {skipped.length > 0 && (
            <>
              <p>Faixas não adicionadas (puladas por você):</p>
              <ul>{skipped.map((r) => <li key={r.req.index}>{describeRequest(r.req)}</li>)}</ul>
            </>
          )}
          <button
            onClick={() => {
              setStep('import');
              setText('');
              session.removeItem(DRAFT_KEY);
            }}
          >
            Importar outra playlist
          </button>
        </section>
      )}

      <footer>
        Este aplicativo não faz curadoria: as músicas são escolhidas na conversa do ChatGPT. Dados do Spotify são usados só para
        montar a playlist.
      </footer>
    </main>
  );
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

function TrackReview({ row, onChoose, onSearch }: { row: Row; onChoose: (c: Choice | undefined) => void; onSearch: (q: string) => void }) {
  const [query, setQuery] = useState(() => [row.req.title, ...row.req.artists].filter(Boolean).join(' '));
  const status = row.match?.status;
  const name = `choice-${row.req.index}`;
  return (
    <li className={`track ${status ?? 'loading'}`} data-testid={`track-${row.req.index}`}>
      <div className="row">
        <span>{describeRequest(row.req)}</span>
        <span className={`status ${status ?? ''}`}>{row.error ? 'Erro' : status ? STATUS_LABEL[status] : 'Buscando…'}</span>
      </div>
      {row.error && <p className="error">{row.error}</p>}
      {row.match?.reason && <p className="hint">{row.match.reason}</p>}
      {row.match && (
        <fieldset>
          <legend className="sr-only">Escolha para {describeRequest(row.req)}</legend>
          {row.match.candidates.map((t) => (
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
            <button className="secondary" type="submit">Buscar manualmente</button>
          </form>
        </fieldset>
      )}
    </li>
  );
}

function ClientIdForm({ onSave, redirectUri }: { onSave: (id: string) => void; redirectUri: string }) {
  const [id, setId] = useState('');
  const valid = isValidClientId(id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(id);
      }}
    >
      <h2>Configurar o app do Spotify</h2>
      <p>
        Informe o <strong>Client ID</strong> do seu app no Spotify Developer Dashboard. Ele não é segredo; nunca informe o Client
        Secret. Cadastre no app o Redirect URI <code>{redirectUri}</code>.
      </p>
      <div className="row">
        <input aria-label="Client ID" value={id} onChange={(e) => setId(e.target.value)} placeholder="32 caracteres" />
        <button type="submit" disabled={!valid}>Salvar</button>
      </div>
    </form>
  );
}
