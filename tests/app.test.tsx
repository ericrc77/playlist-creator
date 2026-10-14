import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { saveTokens, SCOPES } from '../src/lib/auth';
import { SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { MemoryStore, track } from './helpers';

const cfg = { clientId: 'a'.repeat(32), redirectUri: 'http://127.0.0.1:5173/callback' };

function setup({ connected = true } = {}) {
  const fake = new FakeSpotify();
  const session = new MemoryStore();
  const local = new MemoryStore();
  if (connected) saveTokens(session, { accessToken: 'AT', refreshToken: 'RT', expiresAt: Date.now() + 3600_000, scope: SCOPES.join(' ') });
  const createClient = () =>
    new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
  const navigate = vi.fn();
  render(<App config={cfg} session={session} local={local} createClient={createClient} navigate={navigate} />);
  return { fake, session, local, navigate, user: userEvent.setup() };
}

const payload = JSON.stringify({
  schema_version: '1.0',
  playlist: { name: 'Passando roupa', description: 'Aprovada no ChatGPT' },
  tracks: [
    { title: 'Mitsubishi', artists: ['Orochi', 'Kizzy'] },
    { title: 'Paypal', artists: ['Teto'] },
    { title: 'Inexistente', artists: ['Ninguém'] },
  ],
});

async function importPayload(user: ReturnType<typeof userEvent.setup>, text = payload) {
  const box = screen.getByLabelText('JSON da playlist');
  await user.clear(box);
  await user.click(box);
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Validar e buscar faixas' }));
}

describe('App', () => {
  it('pede o Client ID quando não configurado e nunca o secret', () => {
    const session = new MemoryStore();
    render(<App config={{ ...cfg, clientId: '' }} session={session} local={new MemoryStore()} />);
    expect(screen.getByText(/nunca informe o Client/)).toBeInTheDocument();
    expect(screen.getByText(cfg.redirectUri)).toBeInTheDocument();
  });

  it('redireciona para o login do Spotify com PKCE', async () => {
    const { navigate, user } = setup({ connected: false });
    await user.click(screen.getByRole('button', { name: 'Conectar ao Spotify' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/accounts\.spotify\.com\/authorize\?.*code_challenge_method=S256/));
  });

  it('mostra erros de schema compreensíveis', async () => {
    const { user } = setup();
    await importPayload(user, '{"schema_version":"1.0","tracks":[]}');
    expect(screen.getByRole('alert')).toHaveTextContent(/"playlist" ausente/);
  });

  it('fluxo completo: conferir, resolver pendências, prévia e publicar só após clique', async () => {
    const { fake, user } = setup();
    const mitsubishi = track('Mitsubishi', ['Orochi', 'Kizzy']);
    const paypalE = track('Paypal', ['Teto'], { explicit: true });
    const paypalClean = track('Paypal', ['Teto'], { explicit: false });
    fake.catalog = [mitsubishi, paypalE, paypalClean];

    await importPayload(user);
    await waitFor(() => expect(screen.getByTestId('track-2')).toHaveTextContent('Não encontrada'));
    expect(screen.getByTestId('track-0')).toHaveTextContent('Encontrada');
    expect(screen.getByTestId('track-1')).toHaveTextContent('Precisa de confirmação');

    const next = screen.getByRole('button', { name: /Faltam 2 decisão/ });
    expect(next).toBeDisabled();

    // Escolhe a versão explícita e pula a inexistente.
    const row1 = within(screen.getByTestId('track-1'));
    await user.click(row1.getAllByRole('radio')[0]);
    await user.click(within(screen.getByTestId('track-2')).getByLabelText(/Pular esta faixa/));
    await user.click(screen.getByRole('button', { name: 'Ir para a prévia' }));

    expect(screen.getByText(/serão adicionadas/)).toHaveTextContent('2 faixa(s) serão adicionadas · Privada');
    expect(fake.count('POST', '/me/playlists')).toBe(0);

    // Reordena: Paypal antes de Mitsubishi.
    await user.click(screen.getByRole('button', { name: 'Descer posição 1' }));
    await user.click(screen.getByRole('button', { name: /Publicar no Spotify \(2 faixas\)/ }));

    await screen.findByText(/Playlist publicada/);
    expect(screen.getByRole('link', { name: 'https://open.spotify.com/playlist/pl1' })).toBeInTheDocument();
    const pl = fake.playlists.get('pl1')!;
    expect(pl.public).toBe(false);
    expect(pl.items).toEqual([paypalE.uri, mitsubishi.uri]);
    expect(screen.getByText(/Inexistente — Ninguém/)).toBeInTheDocument();
  });

  it('busca manual substitui as candidatas', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Mitsubishi', ['Orochi', 'Kizzy'])];
    await importPayload(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Mitsubichi', artists: ['Orochi'] }] }));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Não encontrada'));
    const box = screen.getByLabelText('Busca manual');
    await user.clear(box);
    await user.type(box, 'mitsubishi');
    await user.click(screen.getByRole('button', { name: 'Buscar manualmente' }));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Mitsubishi — Orochi, Kizzy'));
  });

  it('erro de publicação permite tentar de novo sem duplicar e trava edições', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.fail('POST /playlists/pl1/items', 'network');
    await importPayload(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ir para a prévia' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Ir para a prévia' }));
    await user.click(screen.getByRole('button', { name: /Publicar no Spotify/ }));
    await screen.findByText(/retoma de onde parou/);
    expect(screen.getByDisplayValue('X')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Publicar no Spotify/ }));
    await screen.findByText(/Playlist publicada/);
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.playlists.get('pl1')!.items).toHaveLength(1);
  });
});
