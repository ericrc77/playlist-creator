import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { SCOPES } from '../src/lib/auth';
import { SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { jsonResponse, MemoryStore } from './helpers';

const playlist = (name: string, title: string) =>
  JSON.stringify({ schema_version: '1.0', playlist: { name }, tracks: [{ title, artists: ['Ana'] }] });

it('o erro atrasado de uma playlist descartada não aparece na seguinte', async () => {
  const fake = new FakeSpotify();
  fake.catalog = []; // a faixa nova fica na lista de revisão, onde um erro apareceria
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  fake.hold = (key) => {
    if (key !== 'GET /search' || held) return undefined;
    held = true;
    // A primeira busca só responde (com erro) depois que o teste liberar.
    return gate.then(() => fake.fail('GET /search', jsonResponse(400, { error: { message: 'falha antiga' } })));
  };
  const client = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch });
  const user = userEvent.setup();
  render(
    <App
      config={{ clientId: 'a'.repeat(32), redirectUri: 'http://127.0.0.1:5173/callback' }}
      session={new MemoryStore()}
      local={new MemoryStore()}
      client={client}
      token={{ accessToken: 'AT', expiresAt: Date.now() + 3600_000, scope: SCOPES.join(' ') }}
      onLogout={() => {}}
    />,
  );

  await user.click(screen.getByLabelText('JSON da playlist'));
  await user.paste(playlist('Antiga', 'Velha'));
  await user.click(await screen.findByRole('button', { name: 'Cancelar e colar outra playlist' }));
  await user.click(screen.getByLabelText('JSON da playlist'));
  await user.paste(playlist('Atual', 'Nova'));
  await screen.findByText('Não encontrada');

  release();
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(screen.queryByText(/falha antiga/)).not.toBeInTheDocument();
  expect(screen.getByText('Não encontrada')).toBeInTheDocument();
});
