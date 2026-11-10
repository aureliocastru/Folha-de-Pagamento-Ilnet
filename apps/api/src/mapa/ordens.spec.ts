import {
  entraNoMapa,
  isoDeBrasilia,
  osNoMapa,
  posicaoDaOs,
  textoLimpo,
  type ContextoDasOrdens,
} from './ordens';

const contexto = (extra: Partial<ContextoDasOrdens> = {}): ContextoDasOrdens => ({
  clientes: new Map(),
  contratos: new Map(),
  logins: new Map(),
  assuntos: new Map(),
  tecnicos: new Map(),
  cidades: new Map(),
  ...extra,
});

describe('datas do IXC', () => {
  /*
   * O IXC grava a hora daqui sem fuso, e o servidor roda em UTC: sem o
   * "-03:00", a OS agendada para as 8h estaria "atrasada" às 5h.
   */
  it('saem em ISO com o fuso de Brasília', () => {
    expect(isoDeBrasilia('2026-11-10 08:30:00')).toBe('2026-11-10T08:30:00-03:00');
    expect(isoDeBrasilia('10/11/2026 08:30')).toBe('2026-11-10T08:30:00-03:00');
    expect(isoDeBrasilia('2026-11-10')).toBe('2026-11-10T00:00:00-03:00');
    expect(Date.parse(isoDeBrasilia('2026-11-10 08:30:00')!)).toBe(Date.parse('2026-11-10T11:30:00Z'));
  });

  it('a data zerada é nenhuma data', () => {
    expect(isoDeBrasilia('0000-00-00 00:00:00')).toBeNull();
    expect(isoDeBrasilia('')).toBeNull();
    expect(isoDeBrasilia(undefined)).toBeNull();
  });
});

describe('a mensagem da OS', () => {
  it('perde o HTML e guarda as quebras de linha', () => {
    expect(textoLimpo('Linha 1<br>Linha <b>2</b>&nbsp;fim', 600)).toBe('Linha 1\nLinha 2 fim');
  });

  it('é cortada no limite', () => {
    expect(textoLimpo('abcdef', 3)).toBe('abc…');
    expect(textoLimpo('<p> </p>', 10)).toBeNull();
  });
});

describe('onde a OS fica no mapa', () => {
  const ctx = contexto({
    logins: new Map([[5, { latitude: '', longitude: '' }]]),
    contratos: new Map([[6, { latitude: '-2,5', longitude: '-44,3' }]]),
    clientes: new Map([[7, { latitude: '-3', longitude: '-45' }]]),
  });
  const os = { id_login: '5', id_contrato_kit: '6', id_cliente: '7', latitude: '', longitude: '' };

  it('na ordem: a própria OS, o login, o contrato e o cliente', () => {
    expect(posicaoDaOs(os, ctx)).toEqual({
      posicao: { latitude: -2.5, longitude: -44.3 },
      origem: 'contrato',
    });
    expect(posicaoDaOs({ ...os, latitude: '-2.1', longitude: '-44.1' }, ctx).origem).toBe('os');
  });

  it('o 0,0 do vazio não é posição', () => {
    expect(posicaoDaOs({ id_cliente: '99', latitude: '0', longitude: '0' }, ctx)).toEqual({
      posicao: null,
      origem: null,
    });
  });
});

describe('o que entra no mapa', () => {
  const agora = Date.parse('2026-11-10T12:00:00Z');
  const regra = { tipos: ['C', 'E'], limite: agora - 90 * 86_400_000 };

  it('a finalizada e a de outro tipo ficam de fora', () => {
    expect(entraNoMapa({ status: 'F', tipo: 'C', data_abertura: '2026-11-09 10:00:00' }, regra)).toBe(false);
    expect(entraNoMapa({ status: 'A', tipo: 'C', data_abertura: '2026-11-09 10:00:00' }, { ...regra, tipos: ['E'] })).toBe(false);
    expect(entraNoMapa({ status: 'EN', tipo: 'C', data_abertura: '2026-11-09 10:00:00' }, regra)).toBe(true);
  });

  /* A OS esquecida em 2024 só suja o mapa; a reagendada para agora volta. */
  it('a velha fica de fora, a não ser que esteja agendada para agora', () => {
    const velha = { status: 'A', tipo: 'C', data_abertura: '2024-05-02 09:00:00', data_agenda: '0000-00-00 00:00:00' };
    expect(entraNoMapa(velha, regra)).toBe(false);
    expect(entraNoMapa({ ...velha, data_agenda: '2026-11-11 08:00:00' }, regra)).toBe(true);
    expect(entraNoMapa(velha, { ...regra, limite: null })).toBe(true);
  });

  it('sem data nenhuma, entra: não dá para dizer que é velha', () => {
    expect(entraNoMapa({ status: 'A', tipo: 'C' }, regra)).toBe(true);
  });
});

describe('a OS como o mapa a mostra', () => {
  const linha = {
    id: '123',
    tipo: 'C',
    status: 'AN',
    prioridade: 'A',
    protocolo: '202611100001',
    id_assunto: '2',
    id_tecnico: '7',
    id_cliente: '50',
    endereco: '',
    numero: '',
    bairro: '',
    id_cidade: '0',
    latitude: '-2.53',
    longitude: '-44.30',
    mensagem: 'Sem conexão<br>desde ontem',
    data_abertura: '2026-11-10 08:00:00',
    data_agenda: '0000-00-00 00:00:00',
    data_agenda_final: '0000-00-00 00:00:00',
    data_prazo_limite: '2026-11-12 18:00:00',
  };
  const ctx = contexto({
    clientes: new Map([[50, { razao: 'Fulano de Tal', endereco: 'Rua A', numero: '10', bairro: 'Centro', cidade: '9' }]]),
    assuntos: new Map([[2, 'Sem conexão']]),
    tecnicos: new Map([[7, 'Pedro']]),
    cidades: new Map([[9, { nome: 'São Luís', uf: 'MA' }]]),
  });

  it('resolve os nomes e cai no endereço e na cidade do cliente', () => {
    const os = osNoMapa(linha, ctx)!;
    expect(os).toMatchObject({
      id: 123,
      tipo: 'C',
      statusNome: 'Em análise',
      prioridade: 'Alta',
      assunto: 'Sem conexão',
      tecnicoId: 7,
      tecnico: 'Pedro',
      cliente: 'Fulano de Tal',
      endereco: 'Rua A, 10 — Centro',
      bairro: 'Centro',
      cidade: 'São Luís/MA',
      mensagem: 'Sem conexão\ndesde ontem',
      agenda: null,
      prazo: '2026-11-12T18:00:00-03:00',
      lat: -2.53,
      lng: -44.3,
      origemPosicao: 'os',
    });
  });

  it('sem os cadastros, mostra o que tem', () => {
    const os = osNoMapa({ ...linha, id_tecnico: '0', latitude: '', longitude: '' }, contexto())!;
    expect(os.assunto).toBe('Assunto 2');
    expect(os.cliente).toBeNull();
    expect(os.tecnicoId).toBeNull();
    expect([os.lat, os.lng, os.origemPosicao]).toEqual([null, null, null]);
  });

  it('a de estrutura é E, e sem id não é OS', () => {
    expect(osNoMapa({ ...linha, tipo: 'E' }, ctx)!.tipo).toBe('E');
    expect(osNoMapa({ ...linha, id: '' }, ctx)).toBeNull();
  });
});
