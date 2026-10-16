import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { SCOPES } from '../src/lib/auth';
import { SpotifyClient } from '../src/lib/spotify';
import { FakeSpotify } from './fakeSpotify';
import { MemoryStore, track } from './helpers';

const cfg = { clientId: 'a'.repeat(32), redirectUri: 'http://127.0.0.1:5173/callback' };
const token = { accessToken: 'AT', expiresAt: Date.now() + 3600_000, scope: SCOPES.join(' ') };

function setup({ connected = true, session = new MemoryStore() } = {}) {
  const fake = new FakeSpotify();
  const local = new MemoryStore();
  const client = new SpotifyClient({ getAccessToken: async () => 'AT', onUnauthorized: async () => 'AT', fetchFn: fake.fetch, sleep: async () => {} });
  const navigate = vi.fn();
  const onLogout = vi.fn();
  render(<App config={cfg} session={session} local={local} client={client} token={connected ? token : null} onLogout={onLogout} navigate={navigate} />);
  return { fake, session, local, navigate, onLogout, user: userEvent.setup() };
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

/** Só cola: a validação e a busca começam sozinhas. */
async function paste(user: ReturnType<typeof userEvent.setup>, text = payload) {
  await user.click(screen.getByLabelText('JSON da playlist'));
  await user.paste(text);
}

const publishButton = () => screen.getByRole('button', { name: /^(Publicar|Confira|Buscando|Publicando)/ });

describe('App', () => {
  it('explica a configuração quando o Client ID não está no ambiente', () => {
    setup({ connected: false });
    // render extra com config vazia
    render(
      <App config={{ ...cfg, clientId: '' }} session={new MemoryStore()} local={new MemoryStore()} client={{} as SpotifyClient} token={null} onLogout={() => {}} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SPOTIFY_CLIENT_ID');
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  it('conecta com PKCE e guarda o JSON colado para depois do login', async () => {
    const { navigate, session, user } = setup({ connected: false });
    await paste(user);
    await user.click(screen.getByRole('button', { name: 'Conectar ao Spotify' }));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/accounts\.spotify\.com\/authorize\?.*code_challenge_method=S256/));
    expect(session.getItem('mum.draft')).toBe(payload);
  });

  it('retoma o JSON salvo após o login e já busca as faixas', async () => {
    const session = new MemoryStore();
    session.setItem('mum.draft', payload);
    const { fake } = setup({ session });
    await waitFor(() => expect(fake.count('GET', '/search')).toBeGreaterThan(0));
    expect(await screen.findByDisplayValue('Passando roupa')).toBeInTheDocument();
  });

  it('mostra erros de schema compreensíveis ao colar', async () => {
    const { user } = setup();
    await paste(user, '{"schema_version":"1.0","tracks":[]}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/"playlist" ausente/);
  });

  it('colar → conferir só as dúvidas → publicar fora do perfil', async () => {
    const { fake, user } = setup();
    const mitsubishi = track('Mitsubishi', ['Orochi', 'Kizzy']);
    const paypalE = track('Paypal', ['Teto'], { explicit: true });
    const paypalClean = track('Paypal', ['Teto'], { explicit: false });
    fake.catalog = [mitsubishi, paypalE, paypalClean];

    await paste(user);
    await waitFor(() => expect(publishButton()).toHaveTextContent('Confira 2 faixas'));
    // Só as duas dúvidas aparecem para conferir; a encontrada não pede clique.
    expect(screen.queryByTestId('track-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('track-1')).toHaveTextContent('Precisa de confirmação');
    expect(screen.getByTestId('track-2')).toHaveTextContent('Não encontrada');
    expect(fake.count('POST', '/me/playlists')).toBe(0);
    expect(screen.getByRole('radio', { name: 'Playlist não pública' })).toBeChecked(); // padrão

    await user.click(within(screen.getByTestId('track-1')).getAllByRole('radio')[0]);
    await user.click(within(screen.getByTestId('track-2')).getByLabelText(/Pular esta faixa/));
    expect(publishButton()).toHaveTextContent('Publicar 2 faixas');

    await user.click(publishButton());
    await screen.findByText('Playlist publicada');
    expect(screen.getByRole('link', { name: 'Abrir no Spotify' })).toHaveAttribute('href', 'https://open.spotify.com/playlist/pl1');
    expect(screen.getByText(/Tornar privada/)).toBeInTheDocument();
    const pl = fake.playlists.get('pl1')!;
    expect(pl.public).toBe(false);
    expect(pl.items).toEqual([mitsubishi.uri, paypalE.uri]);
    expect(screen.getByText(/1 faixa\(s\) puladas/)).toBeInTheDocument();
  });

  it('JSON pede pública: avisa, mas começa como não pública (revisão Codex VIS-2)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X', public: true }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await screen.findByText(/JSON pede playlist pública/);
    expect(screen.getByRole('radio', { name: 'Playlist não pública' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Playlist pública' })).not.toBeChecked();
    await waitFor(() => expect(publishButton()).toHaveTextContent('Publicar 1 faixa'));
    await user.click(publishButton());
    await screen.findByText('Playlist publicada');
    expect(fake.playlists.get('pl1')!.public).toBe(false);
  });

  it('informa quando corrigiu a visibilidade criada errada pelo Spotify', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/o app corrigiu/);
    expect(fake.playlists.get('pl1')!.public).toBe(false);
  });

  it('busca manual substitui as candidatas', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Mitsubishi', ['Orochi', 'Kizzy'])];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Mitsubichi', artists: ['Orochi'] }] }));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Não encontrada'));
    const box = screen.getByLabelText('Busca manual');
    await user.clear(box);
    await user.type(box, 'mitsubishi');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Mitsubishi — Orochi, Kizzy'));
  });

  it('erro de publicação permite tentar de novo sem duplicar e trava edições', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.fail('POST /playlists/pl1/items', 'network');
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/continua de onde parou/);
    expect(screen.getByDisplayValue('X')).toBeDisabled();
    await user.click(publishButton());
    await screen.findByText('Playlist publicada');
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.playlists.get('pl1')!.items).toHaveLength(1);
  });

  it('busca manual que chega depois de publicar não muda o plano nem cria outra playlist (revisão Codex APP-1)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'], { explicit: true }), track('Paypal', ['Teto'], { explicit: false })];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Precisa de confirmação'));

    // Busca manual lenta: fica presa até o teste liberar.
    let release!: () => void;
    fake.hold = (key, url) =>
      key === 'GET /search' && url.searchParams.get('q') === 'lenta' ? new Promise<void>((r) => (release = r)) : undefined;
    const box = screen.getByLabelText('Busca manual');
    await user.clear(box);
    await user.type(box, 'lenta');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    // Antes de a busca voltar, escolhe uma das candidatas já mostradas e publica; a adição falha.
    await user.click(within(screen.getByTestId('track-0')).getAllByRole('radio')[0]);
    fake.fail('POST /playlists/pl1/items', 'network');
    await user.click(publishButton());
    await screen.findByText(/continua de onde parou/);

    // A busca atrasada chega: não pode desfazer a escolha nem reabrir a conferência.
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('track-0')).not.toBeInTheDocument();
    expect(publishButton()).toHaveTextContent('Publicar 1 faixa');

    await user.click(publishButton());
    await screen.findByText('Playlist publicada');
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.playlists.size).toBe(1);
  });

  it('busca manual de uma playlist cancelada não invade a próxima (revisão Codex NEW-APP-1)', async () => {
    const { fake, user } = setup();
    fake.catalog = [
      track('Paypal', ['Teto'], { explicit: true }),
      track('Paypal', ['Teto'], { explicit: false }),
      track('Lenta', ['Antiga']),
    ];
    const held = new Map<string, () => void>();
    fake.hold = (key, url) => {
      const q = url.searchParams.get('q') ?? '';
      return key === 'GET /search' && (q === 'lenta' || q === 'nova') ? new Promise<void>((r) => held.set(q, r)) : undefined;
    };
    const one = (name: string) => JSON.stringify({ schema_version: '1.0', playlist: { name }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] });
    const search = async (q: string) => {
      const box = screen.getByLabelText('Busca manual');
      await user.clear(box);
      await user.type(box, q);
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      await waitFor(() => expect(held.has(q)).toBe(true));
    };

    await paste(user, one('Primeira'));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Precisa de confirmação'));
    await search('lenta');

    await user.click(screen.getByRole('button', { name: 'Cancelar e colar outra playlist' }));
    await paste(user, one('Segunda'));
    await waitFor(() => expect(screen.getByTestId('track-0')).toHaveTextContent('Precisa de confirmação'));
    await search('nova');

    held.get('lenta')!(); // a busca da playlist cancelada chega agora
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByDisplayValue('Segunda')).toBeInTheDocument();
    expect(screen.getByTestId('track-0')).not.toHaveTextContent('Lenta');
  });

  it('visibilidade não confirmada não é apresentada como fato e pode ser conferida de novo (revisão Codex PUB-1)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true; // Spotify criou no perfil, embora o pedido fosse fora do perfil
    fake.fail('GET /playlists/pl1', new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }));
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText('Playlist publicada');
    expect(screen.getByText(/visibilidade não confirmada/)).toBeInTheDocument();
    expect(screen.queryByText(/playlist não pública/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    await screen.findByText(/o app corrigiu/);
    expect(screen.getByText(/playlist não pública/)).toBeInTheDocument();
    expect(fake.playlists.get('pl1')!.public).toBe(false);
    expect(fake.count('POST', '/me/playlists')).toBe(1);
  });

  it('Spotify mantém pública: mensagem sem afirmar o perfil e título estável ao conferir de novo', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true; // criou pública…
    fake.ignoreVisibilityChange = true; // …e ignorou a correção (caso real de 2026-10-16)
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());

    const result = await screen.findByRole('region', { name: 'Resultado' });
    expect(within(result).getByRole('heading')).toHaveTextContent('Playlist publicada');
    expect(result).toHaveTextContent('O Spotify manteve a playlist pública, apesar da solicitação de privacidade.');
    expect(result).toHaveTextContent('o Spotify manteve pública');
    expect(result).not.toHaveTextContent(/não confirmada|no seu perfil|aparece no/);

    const items = fake.count('POST', '/playlists/pl1/items');
    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Visibilidade conferida novamente');
    expect(within(result).getByRole('heading')).toHaveTextContent('Playlist publicada');
    expect(result).not.toHaveTextContent(/já estava publicada/);
    expect(result).toHaveTextContent('O Spotify manteve a playlist pública, apesar da solicitação de privacidade.');
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.count('POST', '/playlists/pl1/items')).toBe(items);
  });

  it('conferir de novo quando o Spotify passa a aceitar: mostra o valor confirmado, sem falar em nova publicação', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true;
    fake.ignoreVisibilityChange = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/manteve a playlist pública/);

    fake.ignoreVisibilityChange = false;
    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    const result = screen.getByRole('region', { name: 'Resultado' });
    await waitFor(() => expect(result).toHaveTextContent('playlist não pública'));
    expect(within(result).getByRole('heading')).toHaveTextContent('Playlist publicada');
    expect(screen.getByRole('status')).toHaveTextContent('Nenhuma faixa foi adicionada');
    expect(fake.playlists.get('pl1')!.public).toBe(false);
  });

  it('Spotify mantém privada quando o pedido era público: mensagem simétrica', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = false;
    fake.ignoreVisibilityChange = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X', public: true }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await user.click(await screen.findByRole('radio', { name: 'Playlist pública' }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    const result = await screen.findByRole('region', { name: 'Resultado' });
    expect(result).toHaveTextContent('O Spotify manteve a playlist não pública, apesar da solicitação para torná-la pública.');
    expect(result).toHaveTextContent('o Spotify manteve não pública');
  });

  it('resultado confirmado afirma só o campo public, sem falar em perfil (revisão Codex VIS-1)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    const result = await screen.findByRole('region', { name: 'Resultado' });
    expect(result).toHaveTextContent('playlist não pública');
    expect(result).not.toHaveTextContent(/perfil/);
  });

  it('conferir de novo nunca cria playlist nem adiciona faixas, mesmo sem o job salvo (revisão Codex STATE-2)', async () => {
    const { fake, local, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true;
    fake.ignoreVisibilityChange = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/manteve a playlist pública/);
    expect(local.data.size).toBeGreaterThan(0);
    local.data.clear(); // job salvo sumiu (dados do navegador apagados, outra aba etc.)

    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    await screen.findByRole('status');
    expect(fake.count('POST', '/me/playlists')).toBe(1);
    expect(fake.count('POST', '/playlists/pl1/items')).toBe(1);
    expect(fake.playlists.size).toBe(1);
    expect(within(screen.getByRole('region', { name: 'Resultado' })).getByRole('heading')).toHaveTextContent('Playlist publicada');
  });

  it('conferência repetida que falha não deixa o aviso de sucesso anterior (revisão Codex STATE-1)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true;
    fake.ignoreVisibilityChange = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/manteve a playlist pública/);
    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    await screen.findByRole('status');

    fake.fail('GET /playlists/pl1', new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 }));
    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    await screen.findByText(/Não foi possível confirmar com o Spotify/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resultado' })).toHaveTextContent('visibilidade não confirmada');
  });

  it('durante a conferência, "Nova playlist" fica desabilitada e a resposta não vaza para a próxima (revisão Codex STATE-3)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.createAs = true;
    fake.ignoreVisibilityChange = true;
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/manteve a playlist pública/);

    let release!: () => void;
    fake.hold = (key) => (key === 'GET /playlists/pl1' ? new Promise<void>((r) => (release = r)) : undefined);
    await user.click(screen.getByRole('button', { name: 'Conferir visibilidade de novo' }));
    await waitFor(() => expect(release).toBeDefined());
    expect(screen.getByRole('button', { name: 'Nova playlist' })).toBeDisabled();

    fake.hold = undefined;
    release();
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Nova playlist' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Nova playlist' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('JSON da playlist')).toBeEnabled();
  });

  it('opção de visibilidade: pedido ao Spotify, sem promessa de perfil ou privacidade (revisão Codex VIS-2)', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    const group = await screen.findByRole('group', { name: 'Visibilidade solicitada ao Spotify' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')!.textContent!.trim())).toEqual(['Playlist não pública', 'Playlist pública']);
    expect(within(group).getByRole('radio', { name: 'Playlist não pública' })).toBeChecked();
    expect(group).toHaveAccessibleDescription(
      'O Spotify pode ignorar essa configuração. Para restringir o acesso pelo link, use Tornar privada no aplicativo do Spotify.',
    );
    const card = screen.getByRole('region', { name: 'Playlist' });
    expect(card).not.toHaveTextContent(/perfil|garant/i);
  });

  it('escolher Playlist pública pede public: true e a conferência real continua depois de publicar', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await user.click(await screen.findByRole('radio', { name: 'Playlist pública' }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    const result = await screen.findByRole('region', { name: 'Resultado' });
    expect(fake.calls.find((c) => c.method === 'POST' && c.path === '/me/playlists')?.body).toMatchObject({ public: true });
    expect(fake.count('GET', '/playlists/pl1?')).toBeGreaterThan(0); // conferência de visibilidade
    expect(result).toHaveTextContent('playlist pública');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('depois da tentativa, a opção de visibilidade fica travada', async () => {
    const { fake, user } = setup();
    fake.catalog = [track('Paypal', ['Teto'])];
    fake.fail('POST /playlists/pl1/items', 'network');
    await paste(user, JSON.stringify({ schema_version: '1.0', playlist: { name: 'X' }, tracks: [{ title: 'Paypal', artists: ['Teto'] }] }));
    await waitFor(() => expect(publishButton()).toBeEnabled());
    await user.click(publishButton());
    await screen.findByText(/continua de onde parou/);
    expect(screen.getByRole('radio', { name: 'Playlist pública' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Playlist não pública' })).toBeDisabled();
  });

  it('Sair chama o logout', async () => {
    const { onLogout, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Sair' }));
    expect(onLogout).toHaveBeenCalled();
  });
});
