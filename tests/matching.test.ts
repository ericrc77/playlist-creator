import type { TrackRequest } from '../src/lib/contract';
import { baseTitle, buildSearchQuery, classifyMatch, normalize } from '../src/lib/matching';
import { track } from './helpers';

const req = (title: string, artists: string[]): TrackRequest => ({ index: 0, title, artists });

describe('normalização', () => {
  it('ignora acentos, caixa e pontuação', () => {
    expect(normalize('  Ébano & Marfim!! ')).toBe('ebano e marfim');
  });
  it('título base remove feat e parênteses', () => {
    expect(baseTitle('Mitsubishi (feat. Kizzy)')).toBe('mitsubishi');
    expect(baseTitle('Paypal - Ao Vivo')).toBe('paypal');
  });
});

describe('classifyMatch', () => {
  it('marca como exata quando título e todos os artistas batem', () => {
    const t = track('Mitsubishi', ['Orochi', 'Kizzy']);
    const r = classifyMatch(req('Mitsubishi', ['Orochi', 'Kizzy']), [track('Outra', ['X']), t]);
    expect(r.status).toBe('exact');
    expect(r.selected?.id).toBe(t.id);
  });

  it('não escolhe remix ou ao vivo em silêncio', () => {
    const r = classifyMatch(req('Paypal', ['Teto']), [track('Paypal - Remix', ['Teto']), track('Paypal (Ao Vivo)', ['Teto'])]);
    expect(r.status).toBe('needs_confirmation');
    expect(r.selected).toBeUndefined();
    expect(r.reason).toMatch(/versões diferentes/);
  });

  it('aceita a versão pedida quando o pedido também é remix', () => {
    const r = classifyMatch(req('Paypal (Remix)', ['Teto']), [track('Paypal - Remix', ['Teto'])]);
    expect(r.status).toBe('exact');
  });

  it('pede confirmação quando há versão explícita e clean', () => {
    const r = classifyMatch(req('Paypal', ['Teto']), [track('Paypal', ['Teto'], { explicit: true }), track('Paypal', ['Teto'], { explicit: false })]);
    expect(r.status).toBe('needs_confirmation');
    expect(r.reason).toMatch(/explícita/);
  });

  it('pede confirmação quando há gravações diferentes com o mesmo nome', () => {
    const r = classifyMatch(req('Paypal', ['Teto']), [track('Paypal', ['Teto'], { duration_ms: 180_000 }), track('Paypal', ['Teto'], { duration_ms: 240_000 })]);
    expect(r.status).toBe('needs_confirmation');
  });

  it('trata o mesmo áudio em álbum e single como exato', () => {
    const r = classifyMatch(req('Paypal', ['Teto']), [track('Paypal', ['Teto'], { duration_ms: 180_000 }), track('Paypal', ['Teto'], { duration_ms: 181_000 })]);
    expect(r.status).toBe('exact');
  });

  it('não confia em título igual com artista homônimo diferente', () => {
    const r = classifyMatch(req('Blindado por Deus', ['MC Cabelinho']), [track('Blindado por Deus', ['Outro Artista'])]);
    expect(r.status).toBe('needs_confirmation');
  });

  it('exige todos os artistas pedidos', () => {
    const r = classifyMatch(req('Mitsubishi', ['Orochi', 'Kizzy']), [track('Mitsubishi', ['Orochi'])]);
    expect(r.status).toBe('needs_confirmation');
  });

  it('retorna não encontrada sem resultados relevantes', () => {
    expect(classifyMatch(req('A', ['B']), []).status).toBe('not_found');
    expect(classifyMatch(req('A', ['B']), [track('Zzz', ['Y'])]).status).toBe('not_found');
  });

  it('ignora faixas indisponíveis', () => {
    expect(classifyMatch(req('A', ['B']), [track('A', ['B'], { is_playable: false })]).status).toBe('not_found');
  });
});

describe('buildSearchQuery', () => {
  it('usa filtros de faixa e artista, sem feat', () => {
    expect(buildSearchQuery(req('Mitsubishi (feat. Kizzy)', ['Orochi']))).toBe('track:"Mitsubishi" artist:"Orochi"');
  });
});
