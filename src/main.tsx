import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { completeLogin, type AccessToken } from './lib/auth';
import { AuthSession, readConfig } from './lib/session';
import './styles.css';

const config = readConfig(window.location.origin);
// Uma única sessão por página (fora do React, para o StrictMode não criar duas).
let notify: (t: AccessToken | null) => void = () => {};
const auth = new AuthSession(() => notify(auth.current));
const client = auth.client();
const isCallback = window.location.pathname === '/callback';

// Executa a troca do code uma única vez (o StrictMode roda efeitos duas vezes em desenvolvimento,
// e o verifier PKCE só pode ser usado uma vez).
let startPromise: Promise<AccessToken | null> | null = null;
function startOnce(): Promise<AccessToken | null> {
  if (!startPromise) {
    if (isCallback) {
      const href = window.location.href;
      // Remove o code da barra de endereços imediatamente.
      window.history.replaceState(null, '', '/');
      startPromise = completeLogin(href, window.sessionStorage).then((t) => {
        auth.set(t);
        return t;
      });
    } else {
      // Sessão salva no cookie HttpOnly: entra direto, sem novo login.
      startPromise = auth.restore().then(() => auth.current);
    }
  }
  return startPromise;
}

function Root() {
  const [token, setToken] = useState<AccessToken | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    notify = setToken;
    startOnce()
      .then((t) => setToken(t))
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <p className="app loading">Carregando…</p>;
  return (
    <>
      {error && <p className="app error" role="alert">{error}</p>}
      <App
        config={config}
        session={window.sessionStorage}
        local={window.localStorage}
        client={client}
        token={token}
        onLogout={() => {
          setError(null);
          auth.logout().catch((e: Error) => setError(e.message));
        }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
