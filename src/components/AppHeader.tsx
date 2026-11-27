import type { ReactNode } from 'react';

export function AppHeader({ children }: { children?: ReactNode }) {
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
