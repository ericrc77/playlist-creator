import { useEffect, useRef, useState } from 'react';
import { AppHeader } from './components/AppHeader';
import { ImportCard } from './components/ImportCard';
import { PlaylistSettings, type PlaylistMeta } from './components/PlaylistSettings';
import { ResultScreen } from './components/ResultScreen';
import { TrackOrder } from './components/TrackOrder';
import { TrackReview } from './components/TrackReview';
import { usePublisher } from './features/playlist/usePublisher';
import { useTrackReview } from './features/playlist/useTrackReview';
import { beginLogin, missingScopes, type AccessToken, type AuthConfig, type KVStore } from './lib/auth';
import { findRepeatedRequests, parsePlaylistText, type PlaylistRequest } from './lib/contract';
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
  /** Modo demonstração: catálogo fictício, sem conta nem rede. */
  demo?: { samplePlaylist: string };
}

const DRAFT_KEY = 'mum.draft';
const EMPTY_META: PlaylistMeta = { name: '', description: '', public: false };

export function App({ config, session, local, client, token, onLogout, navigate, demo }: AppProps) {
  const connected = token !== null;
  const [text, setText] = useState(() => session.getItem(DRAFT_KEY) ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [request, setRequest] = useState<PlaylistRequest | null>(null);
  const [meta, setMeta] = useState(EMPTY_META);
  const loadedText = useRef<string | null>(null);

  const publisher = usePublisher({ client, store: local, onDone: () => session.removeItem(DRAFT_KEY) });
  const review = useTrackReview(client, publisher.isLocked);
  const { orderedRows, finalTracks, skipped, pending, resolving, checked, total } = review;
  const { outcome, publishing, progress, attempted } = publisher;

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
    // load() muda a cada renderização; só o texto e a conexão devem disparar uma nova carga.
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
      ...(res.value.public ? ['O JSON pede playlist pública. O app começa com "Playlist não pública"; escolha "Playlist pública" abaixo se quiser.'] : []),
      ...res.warnings,
      ...repeated.map((g) => `As posições ${g.join(', ')} repetem a mesma faixa. A repetição será mantida, a menos que você pule uma delas.`),
    ]);
    setRequest(res.value);
    // Padrão é sempre "Playlist não pública", mesmo que o JSON peça pública: tornar pública é escolha explícita.
    setMeta({ name: res.value.name, description: res.value.description, public: false });
    publisher.reset();
    await review.start(res.value.tracks);
  }

  function reset() {
    setText('');
    session.removeItem(DRAFT_KEY);
    loadedText.current = null;
    setRequest(null);
    setWarnings([]);
    publisher.reset();
    review.clear();
  }

  const publishNow = (confirmRecreate = false) =>
    publisher.submit(
      () => ({
        name: meta.name.trim(),
        description: meta.description.trim(),
        public: meta.public,
        uris: finalTracks.map((t) => t.uri),
      }),
      confirmRecreate,
    );

  if (!config.clientId) {
    return (
      <main className="app">
        <AppHeader />
        <section className="card error" role="alert">
          O Client ID do Spotify não está configurado. Defina <code>VITE_SPOTIFY_CLIENT_ID</code> no ambiente (Vercel ou{' '}
          <code>.env.local</code>) e publique de novo.
        </section>
        <p className="center"><a href="/demo">Ver demonstração</a></p>
      </main>
    );
  }

  if (outcome?.kind === 'done') {
    return (
      <main className="app">
        <AppHeader />
        <ResultScreen
          outcome={outcome}
          wantPublic={meta.public}
          skipped={skipped}
          busy={publishing}
          rechecked={publisher.rechecked}
          error={publisher.error}
          demo={!!demo}
          onRecheck={() => publisher.recheckVisibility(meta.public)}
          onReset={reset}
        />
      </main>
    );
  }

  const canPublish = connected && !resolving && pending.length === 0 && finalTracks.length > 0 && !!meta.name.trim() && !publishing;
  let primaryLabel = `Publicar ${finalTracks.length} faixa${finalTracks.length === 1 ? '' : 's'}`;
  if (publishing) primaryLabel = progress ? `Publicando… ${progress.added}/${progress.total}` : 'Publicando…';
  else if (resolving) primaryLabel = `Buscando faixas… ${checked}/${total}`;
  else if (pending.length) primaryLabel = `Confira ${pending.length} faixa${pending.length === 1 ? '' : 's'}`;

  return (
    <main className={`app${request ? ' has-footer' : ''}`}>
      <AppHeader>
        {connected && !demo && (
          <button className="link" onClick={onLogout}>
            Sair
          </button>
        )}
      </AppHeader>

      {!connected && (
        <section className="card connect" aria-label="Conexão com o Spotify">
          <p>Conecte sua conta do Spotify uma vez. O app lembra o acesso neste aparelho.</p>
          <button className="wide" onClick={connect}>Conectar ao Spotify</button>
          <p className="center"><a href="/demo">Ver demonstração sem conectar</a></p>
        </section>
      )}
      {lacking.length > 0 && <p className="card error">Permissões faltando: {lacking.join(', ')}. Toque em Sair e conecte de novo.</p>}

      {!request && (
        <ImportCard
          text={text}
          errors={errors}
          onTextChange={setText}
          onPaste={pasteFromClipboard}
          onUseSample={demo && (() => setText(demo.samplePlaylist))}
        />
      )}

      {request && (
        <>
          <PlaylistSettings
            meta={meta}
            disabled={attempted}
            summary={{ ready: finalTracks.length, pending: pending.length, skipped: skipped.length, resolving, checked, total }}
            warnings={warnings}
            onChange={setMeta}
          />

          {pending.length > 0 && (
            <section className="card" aria-label="Conferir correspondências">
              <h2>Confira antes de publicar</h2>
              <ol className="tracks">
                {pending.map((row) => (
                  <TrackReview
                    key={row.req.index}
                    row={row}
                    disabled={attempted}
                    onChoose={(c) => review.choose(row.req.index, c)}
                    onSearch={(q) => review.manualSearch(row.req.index, q)}
                  />
                ))}
              </ol>
            </section>
          )}

          {orderedRows.length > pending.length && (
            <TrackOrder rows={orderedRows} disabled={attempted} onMove={review.move} onClearChoice={(i) => review.choose(i, undefined)} />
          )}

          {publisher.error && (
            <p className="card error" role="alert">
              {publisher.error} Toque em Publicar de novo: o app continua de onde parou, sem duplicar.
            </p>
          )}
          {outcome?.kind === 'uncertain_create' && (
            <div className="card warning" role="alert">
              <p>{outcome.message}</p>
              <button onClick={() => publishNow(true)} disabled={publishing}>Conferi: criar a playlist</button>
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
                else publishNow();
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
