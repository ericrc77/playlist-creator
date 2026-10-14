import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { completeLogin } from './lib/auth';
import { readConfig } from './lib/session';
import './styles.css';

const config = readConfig(window.localStorage, window.location.origin);
const isCallback = window.location.pathname === new URL(config.redirectUri).pathname;

// Executa a troca do code uma única vez (o StrictMode roda efeitos duas vezes em desenvolvimento,
// e o verifier PKCE só pode ser usado uma vez).
let loginPromise: Promise<unknown> | null = null;
function handleCallbackOnce(): Promise<unknown> {
  if (!loginPromise) {
    const href = window.location.href;
    // Remove o code da barra de endereços imediatamente.
    window.history.replaceState(null, '', '/');
    loginPromise = completeLogin(config, href, window.sessionStorage);
  }
  return loginPromise;
}

/** Trata o retorno do Spotify em /callback antes de mostrar o app. */
function Root() {
  const [ready, setReady] = useState(!isCallback);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCallback) return;
    handleCallbackOnce()
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <p className="app">Conectando ao Spotify…</p>;
  return (
    <>
      {error && <p className="app error" role="alert">{error}</p>}
      <App config={config} session={window.sessionStorage} local={window.localStorage} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
