import { useState } from 'react';
import { App } from '../App';
import { SCOPES, type KVStore } from '../lib/auth';
import { SpotifyClient } from '../lib/spotify';
import { createDemoFetch, DEMO_PLAYLIST } from './demoSpotify';

/** Armazenamento descartável: a demonstração não toca nos dados do app real. */
function memoryStore(): KVStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

export function DemoApp({ delayMs }: { delayMs?: number }) {
  const [env] = useState(() => {
    const accessToken = async () => 'demo';
    return {
      session: memoryStore(),
      local: memoryStore(),
      client: new SpotifyClient({ fetchFn: createDemoFetch(delayMs), getAccessToken: accessToken, onUnauthorized: accessToken }),
      token: { accessToken: 'demo', expiresAt: Number.MAX_SAFE_INTEGER, scope: SCOPES.join(' ') },
    };
  });

  return (
    <>
      <aside className="demo-banner">
        <strong>Demo mode</strong> · Spotify is simulated and the catalog is fictional. Nothing is sent anywhere.{' '}
        <a href="/">Exit demo</a>
      </aside>
      <App
        config={{ clientId: 'demo', redirectUri: '' }}
        {...env}
        onLogout={() => {}}
        demo={{ samplePlaylist: DEMO_PLAYLIST }}
      />
    </>
  );
}
