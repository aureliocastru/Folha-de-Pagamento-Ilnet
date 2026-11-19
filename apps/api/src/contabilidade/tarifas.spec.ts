import { BadRequestException, ConflictException } from '@nestjs/common';
import type { IxcClient } from '../ixc/ixc.client';
import {
  bancosDasTarifas,
  corpoDaFilha,
  corpoDaMae,
  nomeCurto,
  podeApagar,
  problemaDaLinha,
  type BancoDasTarifas,
} from './tarifas';
import { TarifasDoBancoService } from './tarifas.service';

/**
 * Tarifas e rentabilidade em lote no IXC.
 *
 * O que este arquivo protege:
 *  - o par sai igual ao que a tela do IXC grava (o 1797070: mãe M na conta do
 *    banco, filha D na 240, histórico "Tarifas", valor com vírgula);
 *  - a mãe vai antes da filha, e a filha aponta para ela;
 *  - o mesmo dia, banco, tipo e valor não entra duas vezes;
 *  - o que o IXC gravou é relido e, não batendo (valor dobrado, filha
 *    faltando), a resposta é "conferir" — nunca "lançado";
 *  - filha recusada desfaz a mãe;
 *  - apagar tira a filha antes da mãe, e só apaga par com o desenho de
 *    tarifa — nunca uma baixa de título (o 38114).
 */

const MODOBANK: BancoDasTarifas = { id: 18, nome: 'ModoBank PIX', razaoId: 12833, filialId: 1 };

const CONTAS = [
  { id: '14', conta: 'Conta Sicoob', id_planejamento: '6531', tipo_conta: 'B', ativo: 'S', filial_padrao: '1' },
  { id: '15', conta: 'Conta Banco Bradesco', id_planejamento: '10064', tipo_conta: 'B', ativo: 'S', filial_padrao: '1' },
  { id: '18', conta: 'Conta ModoBank PIX', id_planejamento: '12833', tipo_conta: 'B', ativo: 'S', filial_padrao: '1' },
  { id: '19', conta: 'Conta aplicação Bradesco', id_planejamento: '12877', tipo_conta: 'B', ativo: 'N', filial_padrao: '1' },
  { id: '21', conta: 'Nu Bank', id_planejamento: '14569', tipo_conta: 'B', ativo: 'S', filial_padrao: '1' },
  { id: '23', conta: 'CX - Werick', id_planejamento: '16942', tipo_conta: 'C', ativo: 'S', filial_padrao: '1' },
];

type Linha = Record<string, string>;
type Condicao = { TB: string; OP: string; P: string };

/**
 * "7,70" → "7.70"; "01/11/2026" → "2026-11-01" — como o IXC devolve na leitura.
 *
 * No `POST` o `id_movim_finan` vira o id da própria linha, seja o que for que
 * se mande (o teste 1797107/1797108 de 19/11/2026); no `PUT` ele fica o que
 * foi mandado.
 */
function comoOIxcGuarda(corpo: Record<string, unknown>, id: number, comoPut = false): Linha {
  const valor = (v: unknown) => (String(v ?? '') ? Number(String(v).replace(',', '.')).toFixed(2) : '0.00');
  const [d, m, a] = String(corpo.data).split('/');
  return {
    ...(corpo as Linha),
    id: String(id),
    data: `${a}-${m}-${d}`,
    debito: valor(corpo.debito),
    credito: valor(corpo.credito),
    id_movim_finan: comoPut ? String(corpo.id_movim_finan) : String(id),
  };
}

function casa(l: Linha, campo: string, op: string, p: string): boolean {
  const v = l[campo.replace(/^fn_movim_finan\./, '')] ?? '';
  if (op === '=') return v === p;
  if (op === '>') return Number(v) > Number(p);
  if (op === '>=') return v >= p;
  if (op === '<=') return v <= p;
  if (op === 'L') return v.toLowerCase().includes(p.toLowerCase());
  if (op === 'IN') return p.split(',').includes(v);
  throw new Error(`operador ${op}`);
}

function montar(opts: { linhas?: Linha[]; dobraAMae?: boolean; recusaFilha?: boolean; putNaoLiga?: boolean } = {}) {
  const linhas: Linha[] = [...(opts.linhas ?? [])];
  let proximo = 1797100;
  const ordem: string[] = [];

  const listar = (recurso: string, params: { qtype: string; query: string; oper?: string; gridParam?: unknown }) => {
    if (recurso === 'contas') return CONTAS as unknown as Linha[];
    return linhas.filter(
      (l) =>
        casa(l, params.qtype, params.oper ?? '=', params.query) &&
        ((params.gridParam as Condicao[] | undefined) ?? []).every((c) => casa(l, c.TB, c.OP, c.P)),
    );
  };

  const ixc = {
    list: jest.fn(async (recurso: string, params: { qtype: string; query: string; oper?: string; gridParam?: unknown }) => {
      const registros = listar(recurso, params);
      return { total: registros.length, page: 1, registros };
    }),
    listAll: jest.fn(async (recurso: string, params: { qtype: string; query: string; oper?: string; gridParam?: unknown }) =>
      listar(recurso, params),
    ),
    getById: jest.fn(async (_recurso: string, _campo: string, id: number) => linhas.find((l) => l.id === String(id)) ?? null),
    create: jest.fn(async (_recurso: string, corpo: Record<string, unknown>): Promise<{ id: number | null; raw: Record<string, unknown> }> => {
      const ehFilha = corpo.tipo_lanc !== 'M';
      ordem.push(ehFilha ? `filha→${String(corpo.id_movim_finan)}` : 'mae');
      if (ehFilha && opts.recusaFilha) throw new Error('IXC (/fn_movim_finan): Conta inválida');
      const id = proximo++;
      linhas.push(comoOIxcGuarda(corpo, id));
      if (ehFilha && opts.dobraAMae) {
        const mae = linhas.find((l) => l.id === String(corpo.id_movim_finan))!;
        mae.credito = (Number(mae.credito) * 2).toFixed(2);
      }
      return { id, raw: { type: 'success', id } };
    }),
    update: jest.fn(async (_recurso: string, id: number, corpo: Record<string, unknown>) => {
      ordem.push(`liga ${id}→${String(corpo.id_movim_finan)}`);
      const i = linhas.findIndex((l) => l.id === String(id));
      if (i >= 0 && !opts.putNaoLiga) linhas[i] = comoOIxcGuarda(corpo, id, true);
      return { type: 'success' };
    }),
    remove: jest.fn(async (_recurso: string, id: number) => {
      ordem.push(`apaga ${id}`);
      const i = linhas.findIndex((l) => l.id === String(id));
      if (i >= 0) linhas.splice(i, 1);
      return { type: 'success' };
    }),
  };

  const service = new TarifasDoBancoService(ixc as unknown as IxcClient);
  return { service, ixc, linhas, ordem };
}

/** O par que a tela do IXC gravou em 19/11/2026 (o 1797070), com números trocados. */
function parFeitoNoIxc(idMae: number, opts: { dia?: string; valor?: string; historico?: string; tipoFilha?: string } = {}): Linha[] {
  const dia = opts.dia ?? '2026-11-01';
  const valor = opts.valor ?? '7.70';
  const historico = opts.historico ?? 'Tarifas';
  return [
    { id: String(idMae), id_movim_finan: String(idMae), tipo_lanc: 'M', id_conta: '12833', data: dia, debito: '0.00', credito: valor, historico, documento: '' },
    { id: String(idMae + 1), id_movim_finan: String(idMae), tipo_lanc: opts.tipoFilha ?? 'D', id_conta: '240', data: dia, debito: valor, credito: '0.00', historico, documento: '' },
  ];
}

describe('os bancos das tarifas', () => {
  it('são só Sicoob, ModoBank e Bradesco ativos, com o nome curto e o razão', () => {
    expect(bancosDasTarifas(CONTAS)).toEqual([
      { id: 15, nome: 'Bradesco', razaoId: 10064, filialId: 1 },
      { id: 18, nome: 'ModoBank PIX', razaoId: 12833, filialId: 1 },
      { id: 14, nome: 'Sicoob', razaoId: 6531, filialId: 1 },
    ]);
    expect(nomeCurto('Conta Banco do Brasil')).toBe('do Brasil');
  });
});

describe('o corpo do par', () => {
  it('tarifa: mãe M no banco com crédito, filha D na 240 com débito — como o 1797070', () => {
    const linha = { banco: 18, dia: '2026-11-01', tipo: 'tarifa' as const, valor: 7.7 };
    const mae = corpoDaMae(linha, MODOBANK);
    expect(mae).toMatchObject({
      id_conta: '12833',
      data: '01/11/2026',
      documento: '',
      debito: '',
      credito: '7,70',
      historico: 'Tarifas',
      tipo_lanc: 'M',
      id_movim_finan: '',
      filial_id: '1',
    });
    expect(corpoDaFilha(linha, MODOBANK, 1797070)).toMatchObject({
      id_conta: '240',
      data: '01/11/2026',
      documento: '',
      debito: '7,70',
      credito: '',
      historico: 'Tarifas',
      tipo_lanc: 'D',
      id_movim_finan: '1797070',
    });
  });

  it('rentabilidade: mãe com débito, filha C na 240 com crédito', () => {
    const linha = { banco: 18, dia: '2026-10-26', tipo: 'rentabilidade' as const, valor: 1234.5 };
    expect(corpoDaMae(linha, MODOBANK)).toMatchObject({ debito: '1234,50', credito: '', historico: 'Rentabilidade', tipo_lanc: 'M' });
    expect(corpoDaFilha(linha, MODOBANK, 9)).toMatchObject({ id_conta: '240', debito: '', credito: '1234,50', tipo_lanc: 'C' });
  });
});

describe('a linha antes de ir ao IXC', () => {
  const hoje = '2026-11-19';
  it('recusa dia futuro, dia que não existe, valor zero e meio centavo', () => {
    expect(problemaDaLinha({ banco: 18, dia: '2026-11-20', tipo: 'tarifa', valor: 1 }, hoje)).toMatch(/não chegou/);
    expect(problemaDaLinha({ banco: 18, dia: '2026-02-30', tipo: 'tarifa', valor: 1 }, hoje)).toMatch(/inválido/);
    expect(problemaDaLinha({ banco: 18, dia: '2026-11-01', tipo: 'tarifa', valor: 0 }, hoje)).toMatch(/maior que zero/);
    expect(problemaDaLinha({ banco: 18, dia: '2026-11-01', tipo: 'tarifa', valor: 1.005 }, hoje)).toMatch(/centavos/);
    expect(problemaDaLinha({ banco: 18, dia: '2026-11-19', tipo: 'tarifa', valor: 0.01 }, hoje)).toBeNull();
  });
});

describe('lançar', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-11-19T15:00:00-03:00'), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterAll(() => jest.useRealTimers());

  it('grava a mãe, depois a filha apontando para ela, relê e diz lançado', async () => {
    const { service, ordem, linhas } = montar();
    const r = await service.lancar({ banco: 18, dia: '2026-11-02', tipo: 'tarifa', valor: 5.2 });
    expect(r.situacao).toBe('lancado');
    expect(ordem).toEqual(['mae', 'filha→1797100', 'liga 1797101→1797100']);
    expect(linhas.map((l) => [l.tipo_lanc, l.id_conta, l.debito, l.credito])).toEqual([
      ['M', '12833', '0.00', '5.20'],
      ['D', '240', '5.20', '0.00'],
    ]);
    if (r.situacao === 'lancado') {
      expect(r.lancamento).toMatchObject({ idMae: 1797100, idFilhas: [1797101], banco: 18, valor: 5.2, fechado: true, podeApagar: true });
    }
  });

  it('o mesmo dia, banco, tipo e valor não entra de novo', async () => {
    const { service, ixc } = montar({ linhas: parFeitoNoIxc(1797070) });
    const r = await service.lancar({ banco: 18, dia: '2026-11-01', tipo: 'tarifa', valor: 7.7 });
    expect(r.situacao).toBe('ja-existia');
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('outro valor no mesmo dia, ou rentabilidade do mesmo valor, entra', async () => {
    const { service } = montar({ linhas: parFeitoNoIxc(1797070) });
    expect((await service.lancar({ banco: 18, dia: '2026-11-01', tipo: 'tarifa', valor: 7.71 })).situacao).toBe('lancado');
    expect((await service.lancar({ banco: 18, dia: '2026-11-01', tipo: 'rentabilidade', valor: 7.7 })).situacao).toBe('lancado');
  });

  it('a linha do banco que ficou sem a 240 não conta como lançada', async () => {
    const [mae] = parFeitoNoIxc(1797070);
    const { service, ixc } = montar({ linhas: [mae] });
    const r = await service.lancar({ banco: 18, dia: '2026-11-01', tipo: 'tarifa', valor: 7.7 });
    expect(r).toMatchObject({ situacao: 'conferir', idMae: 1797070 });
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('o IXC dobrando o valor da mãe é pego na releitura', async () => {
    const { service } = montar({ dobraAMae: true });
    const r = await service.lancar({ banco: 18, dia: '2026-11-02', tipo: 'tarifa', valor: 5.2 });
    expect(r.situacao).toBe('conferir');
    if (r.situacao === 'conferir') expect(r.problemas.join(' ')).toMatch(/crédito 10\.40/);
  });

  it('filha recusada desfaz a mãe', async () => {
    const { service, ordem, linhas } = montar({ recusaFilha: true });
    await expect(service.lancar({ banco: 18, dia: '2026-11-02', tipo: 'tarifa', valor: 5.2 })).rejects.toThrow(
      ConflictException,
    );
    expect(ordem).toEqual(['mae', 'filha→1797100', 'apaga 1797100']);
    expect(linhas).toEqual([]);
  });

  it('banco fora dos três e dia futuro nem chegam ao IXC', async () => {
    const { service, ixc } = montar();
    await expect(service.lancar({ banco: 21, dia: '2026-11-02', tipo: 'tarifa', valor: 1 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.lancar({ banco: 18, dia: '2026-11-25', tipo: 'tarifa', valor: 1 })).rejects.toThrow(
      BadRequestException,
    );
    expect(ixc.create).not.toHaveBeenCalled();
  });
});

describe('apagar', () => {
  it('tira a filha, confere, e só então a mãe', async () => {
    const { service, ordem, linhas } = montar({ linhas: parFeitoNoIxc(1797070) });
    expect(await service.apagar(1797070)).toEqual({ apagados: [1797071, 1797070] });
    expect(ordem).toEqual(['apaga 1797071', 'apaga 1797070']);
    expect(linhas).toEqual([]);
  });

  it('recusa baixa de título (filha P) e histórico que não é de tarifa', async () => {
    const baixa = parFeitoNoIxc(1788308, { tipoFilha: 'P' });
    expect(podeApagar(baixa[0], [baixa[1]], [12833])).toBe(false);
    const pagamento = parFeitoNoIxc(1788308, { historico: 'Pag. Fornecedor' });
    expect(podeApagar(pagamento[0], [pagamento[1]], [12833])).toBe(false);

    const { service, ixc } = montar({ linhas: baixa });
    await expect(service.apagar(1788308)).rejects.toThrow(BadRequestException);
    expect(ixc.remove).not.toHaveBeenCalled();
  });

  it('a linha do banco sem filha (gravação que caiu no meio) pode sair', async () => {
    const [mae] = parFeitoNoIxc(1797070);
    const { service, linhas } = montar({ linhas: [mae] });
    expect(await service.apagar(1797070)).toEqual({ apagados: [1797070] });
    expect(linhas).toEqual([]);
  });

  it('a 240 que ficou solta sai antes da linha do banco', async () => {
    const { service, ordem, linhas } = montar({ linhas: testeSolto() });
    expect(await service.apagar(1797107, 1797108)).toEqual({ apagados: [1797108, 1797107] });
    expect(ordem).toEqual(['apaga 1797108', 'apaga 1797107']);
    expect(linhas).toEqual([]);
  });

  it('não apaga como "solta" a 240 de outro lançamento', async () => {
    const [mae, filha] = testeSolto();
    const { service, ixc } = montar({ linhas: [mae, { ...filha, id_movim_finan: '1700000' }] });
    await expect(service.apagar(1797107, 1797108)).rejects.toThrow(BadRequestException);
    expect(ixc.remove).not.toHaveBeenCalled();
  });
});

/** Como o teste de 19/11/2026 ficou no IXC: a 240 gravada apontando para ela mesma. */
function testeSolto(): Linha[] {
  const base = { data: '2026-11-19', historico: 'Tarifas', documento: '' };
  return [
    { ...base, id: '1797107', id_movim_finan: '1797107', tipo_lanc: 'M', id_conta: '12833', debito: '0.00', credito: '0.01' },
    { ...base, id: '1797108', id_movim_finan: '1797108', tipo_lanc: 'D', id_conta: '240', debito: '0.01', credito: '0.00' },
  ];
}

describe('a 240 solta', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-11-19T15:00:00-03:00'), doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterAll(() => jest.useRealTimers());

  it('religar amarra a 1797108 à 1797107 por PUT e confere o par', async () => {
    const { service, ordem, linhas } = montar({ linhas: testeSolto() });
    const r = await service.religar(1797107, 1797108);
    expect(r.situacao).toBe('lancado');
    expect(ordem).toEqual(['liga 1797108→1797107']);
    expect(linhas[1]).toMatchObject({ id: '1797108', id_movim_finan: '1797107', tipo_lanc: 'D', id_conta: '240', debito: '0.01' });
  });

  it('religar recusa a 240 de outro valor ou de outro lançamento', async () => {
    const [mae, filha] = testeSolto();
    for (const outra of [{ ...filha, debito: '0.02' }, { ...filha, id_movim_finan: '1700000' }, { ...filha, data: '2026-11-18' }]) {
      const { service, ixc } = montar({ linhas: [mae, outra] });
      await expect(service.religar(1797107, 1797108)).rejects.toThrow(BadRequestException);
      expect(ixc.update).not.toHaveBeenCalled();
    }
  });

  it('o PUT que não liga é pego na releitura, com o número da 240 solta', async () => {
    const { service } = montar({ putNaoLiga: true });
    const r = await service.lancar({ banco: 18, dia: '2026-11-02', tipo: 'tarifa', valor: 5.2 });
    expect(r.situacao).toBe('conferir');
    if (r.situacao === 'conferir') expect(r.problemas.join('; ')).toMatch(/a linha 1797101 da conta 240 ficou solta/);
  });

  it('a 240 gravada sem o IXC devolver o número é achada e amarrada', async () => {
    const { service, ixc, ordem } = montar();
    const criar = ixc.create.getMockImplementation()!;
    ixc.create.mockImplementation(async (recurso: string, corpo: Record<string, unknown>) => {
      const r = await criar(recurso, corpo);
      return corpo.tipo_lanc === 'M' ? r : { id: null, raw: { type: 'success' } };
    });
    const r = await service.lancar({ banco: 18, dia: '2026-11-02', tipo: 'tarifa', valor: 5.2 });
    expect(r.situacao).toBe('lancado');
    expect(ordem).toEqual(['mae', 'filha→1797100', 'liga 1797101→1797100']);
  });
});

describe('a lista do período', () => {
  it('traz as tarifas e rentabilidades dos três bancos, com a filha de cada uma', async () => {
    const { service } = montar({
      linhas: [
        ...parFeitoNoIxc(1797070),
        ...parFeitoNoIxc(1797200, { dia: '2026-11-03', valor: '1.30' }),
        ...parFeitoNoIxc(1797300, { dia: '2026-11-04', historico: 'Pag. Fornecedor' }),
      ],
    });
    const lista = await service.lancadas('2026-11-01', '2026-11-30');
    expect(lista.map((t) => [t.idMae, t.dia, t.valor, t.idFilhas, t.fechado])).toEqual([
      [1797070, '2026-11-01', 7.7, [1797071], true],
      [1797200, '2026-11-03', 1.3, [1797201], true],
    ]);
    await expect(service.lancadas('2026-01-01', '2026-11-30')).rejects.toThrow(/62 dias/);
  });
});
