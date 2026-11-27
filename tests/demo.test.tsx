import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoApp } from '../src/demo/DemoApp';

describe('modo demonstração', () => {
  it('percorre importar, conferir e publicar sem nenhuma chamada de rede', async () => {
    const network = vi.fn(() => Promise.reject(new Error('rede proibida na demonstração')));
    vi.stubGlobal('fetch', network);
    const user = userEvent.setup();
    render(<DemoApp delayMs={0} />);

    await user.click(screen.getByRole('button', { name: 'Usar playlist de exemplo' }));

    // Três faixas são exatas; três exigem decisão: explícita x clean, só ao vivo e inexistente.
    expect(await screen.findByRole('button', { name: 'Confira 3 faixas' })).toBeInTheDocument();
    expect(within(screen.getByTestId('track-2')).getByText(/versão explícita e versão "clean"/)).toBeInTheDocument();
    expect(within(screen.getByTestId('track-3')).getByText(/Só há versões diferentes \(live\)/)).toBeInTheDocument();
    expect(within(screen.getByTestId('track-5')).getByText('Não encontrada')).toBeInTheDocument();

    await user.click(within(screen.getByTestId('track-2')).getAllByRole('radio')[0]);
    await user.click(within(screen.getByTestId('track-3')).getAllByRole('radio')[0]);
    await user.click(within(screen.getByTestId('track-5')).getByRole('radio', { name: /Pular/ }));
    await user.click(screen.getByRole('button', { name: 'Publicar 5 faixas' }));

    const result = await screen.findByRole('region', { name: 'Resultado' });
    expect(result).toHaveTextContent('5 faixa(s) confirmadas');
    expect(result).toHaveTextContent('nenhuma playlist real foi criada');
    expect(within(result).queryByRole('link', { name: 'Abrir no Spotify' })).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('não oferece "Sair" nem grava nada no armazenamento do navegador', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const user = userEvent.setup();
    render(<DemoApp delayMs={0} />);
    await user.click(screen.getByRole('button', { name: 'Usar playlist de exemplo' }));
    await screen.findByRole('button', { name: 'Confira 3 faixas' });

    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });
});
