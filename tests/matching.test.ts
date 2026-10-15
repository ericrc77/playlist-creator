import type { TrackRequest } from '../src/lib/contract';
import { baseTitle, buildSearchQuery, classifyMatch, normalize, strictTitle } from '../src/lib/matching';
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

  it('não escolhe em silêncio complementos desconhecidos no título (revisão Codex F3)', () => {
    for (const name of ['Paypal (Unplugged)', 'Paypal - Alternate Take', 'Paypal (Interlúdio)', 'Paypal - Parte 2', 'Paypal (Part 2)']) {
      const r = classifyMatch(req('Paypal', ['Teto']), [track(name, ['Teto'])]);
      expect(r.status, name).toBe('needs_confirmation');
      expect(r.selected).toBeUndefined();
    }
  });

  it('continua aceitando créditos de participação como mesmo título', () => {
    for (const name of ['Paypal (feat. Kizzy)', 'Paypal (part. Kizzy)', 'Paypal - feat. Kizzy', 'Paypal ft. Kizzy', 'Paypal (Participação Kizzy)']) {
      expect(classifyMatch(req('Paypal', ['Teto']), [track(name, ['Teto', 'Kizzy'])]).status, name).toBe('exact');
    }
  });

  it('não corta títulos que contêm "with" ou "part" como palavra', () => {
    expect(strictTitle('Dance With Me')).toBe('dance with me');
    expect(classifyMatch(req('Dance', ['X']), [track('Dance With Me', ['X'])]).status).toBe('needs_confirmation');
  });

  it('"with" e "part." soltos não são tratados como crédito (re-verificação Codex)', () => {
    for (const name of ['Paypal (With Orchestra)', 'Paypal (with Kizzy)', 'Paypal Part. II']) {
      expect(classifyMatch(req('Paypal', ['Teto']), [track(name, ['Teto', 'Kizzy'])]).status, name).toBe('needs_confirmation');
    }
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
