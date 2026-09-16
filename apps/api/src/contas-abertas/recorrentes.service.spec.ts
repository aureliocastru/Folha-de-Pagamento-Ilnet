import { mesSeguinte, RecorrentesService } from './recorrentes.service';

/**
 * A conta que se repete todo mês nasce sozinha. O que este arquivo protege:
 *
 *  - ela nasce só dentro da janela de antecedência — criar doze meses de uma
 *    vez faria o total em aberto da empresa saltar por serviço não prestado;
 *  - o vencimento só anda quando a conta de fato nasceu no IXC, senão uma
 *    falha pularia o mês inteiro sem ninguém notar;
 *  - dia 31 em mês de 30 não escorrega para o mês seguinte.
 */

const HOJE = new Date('2026-08-15T09:00:00Z');

function recorrente(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    idFornecedorIxc: 196,
    fornecedorNome: 'Provedor de Link',
    valor: 1200,
    observacao: 'Link de internet',
    proximoVencimento: new Date(Date.UTC(2026, 7, 20)), // 20/08
    diasDeAntecedencia: 5,
    contaContabil: null,
    contaPagamento: null,
    tipoPagamentoIxc: null,
    categoriaId: null,
    ativa: true,
    diaDoVencimento: null,
    totalParcelas: null,
    parcelasLancadas: 0,
    parcelasPorMes: 1,
    lancadasNoMes: 0,
    parcelasAntecipadas: 0,
    antecipadas: [],
    ehFinanciamento: false,
    ...over,
  };
}

/** Um consórcio de 60 parcelas que paga duas por mês, com 9 já pagas. */
function consorcio(over: Record<string, unknown> = {}) {
  return recorrente({
    fornecedorNome: 'Administradora de Consórcio',
    observacao: 'Consórcio caçamba',
    valor: 3242.37,
    diaDoVencimento: 20,
    totalParcelas: 60,
    parcelasLancadas: 9,
    parcelasPorMes: 2,
    ...over,
  });
}

function montarServico(
  opts: {
    lista?: unknown[];
    erroAoCriar?: string;
    /** O que o `findUnique` de uma recorrente devolve. */
    registro?: unknown;
    /** O que o `findUnique` de uma antecipação devolve. */
    antecipada?: unknown;
  } = {},
) {
  const atualizacoes: Array<Record<string, unknown>> = [];

  const antecipadas: Array<Record<string, unknown>> = [];

  const prisma = {
    despesaRecorrente: {
      findMany: jest.fn().mockResolvedValue(opts.lista ?? [recorrente()]),
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.registro ?? recorrente()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        atualizacoes.push(data);
        return data;
      }),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
    parcelaAntecipada: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        antecipadas.push(data);
        return { id: 'a1', ...data };
      }),
      findUnique: jest.fn(async () => opts.antecipada ?? null),
      update: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
  };

  const contasPagar = {
    criarDespesa: jest.fn(async () => {
      if (opts.erroAoCriar) throw new Error(opts.erroAoCriar);
      return { id: 'c1', idFnApagarIxc: 7777 };
    }),
  };

  const categorias = { classificar: jest.fn() };

  const service = new RecorrentesService(
    prisma as never,
    contasPagar as never,
    categorias as never,
  );
  return { service, prisma, contasPagar, categorias, atualizacoes, antecipadas };
}

describe('mesSeguinte', () => {
  it('mantém o dia do mês', () => {
    expect(mesSeguinte(new Date(Date.UTC(2026, 7, 20)))).toEqual(
      new Date(Date.UTC(2026, 8, 20)),
    );
  });

  it('dia 31 em mês de 30 cai no último dia — não vira dia 1º do outro mês', () => {
    // 31/01 + 1 mês = 28/02 (e não 03/03, que é o que o setMonth faria).
    expect(mesSeguinte(new Date(Date.UTC(2026, 0, 31)))).toEqual(
      new Date(Date.UTC(2026, 1, 28)),
    );
    // 31/03 → 30/04
    expect(mesSeguinte(new Date(Date.UTC(2026, 2, 31)))).toEqual(
      new Date(Date.UTC(2026, 3, 30)),
    );
  });

  it('atravessa a virada do ano', () => {
    expect(mesSeguinte(new Date(Date.UTC(2026, 11, 10)))).toEqual(
      new Date(Date.UTC(2027, 0, 10)),
    );
  });

  it('fevereiro de ano bissexto', () => {
    expect(mesSeguinte(new Date(Date.UTC(2028, 0, 31)))).toEqual(
      new Date(Date.UTC(2028, 1, 29)),
    );
  });

  it('com o dia combinado, o 31 volta a ser 31 depois de fevereiro', () => {
    // 28/02 de um "todo dia 31" → 31/03, e não 28/03.
    expect(mesSeguinte(new Date(Date.UTC(2026, 1, 28)), 31)).toEqual(
      new Date(Date.UTC(2026, 2, 31)),
    );
  });
});

describe('RecorrentesService.gerarPendentes', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('gera a conta quando entra na janela de antecedência', async () => {
    // Vence 20/08 com 5 dias de antecedência: nasce em 15/08, que é hoje.
    const { service, contasPagar } = montarServico();

    const r = await service.gerarPendentes('u1');

    expect(r.geradas).toBe(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({
        idFornecedorIxc: 196,
        valor: 1200,
        observacao: 'Link de internet',
        dataVencimento: new Date(Date.UTC(2026, 7, 20)),
      }),
      'u1',
    );
  });

  it('não gera antes da hora', async () => {
    const { service, contasPagar } = montarServico({
      // Vence 30/08: com 5 dias, só nasce em 25/08.
      lista: [recorrente({ proximoVencimento: new Date(Date.UTC(2026, 7, 30)) })],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(0);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('desligada não gera', async () => {
    const { service, contasPagar } = montarServico({ lista: [] });

    await service.gerarPendentes();

    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('atrasada gera na primeira rodada seguinte', async () => {
    const { service } = montarServico({
      // Devia ter nascido em 05/08 e não nasceu (IXC fora do ar, por exemplo).
      lista: [recorrente({ proximoVencimento: new Date(Date.UTC(2026, 7, 10)) })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(1);
  });

  it('depois de gerar, o vencimento anda um mês', async () => {
    const { service, atualizacoes } = montarServico();

    await service.gerarPendentes();

    expect(atualizacoes[0]).toMatchObject({
      proximoVencimento: new Date(Date.UTC(2026, 8, 20)),
      ultimoErro: null,
    });
  });

  it('se a criação falha, o vencimento NÃO anda e o erro fica gravado', async () => {
    const { service, atualizacoes } = montarServico({
      erroAoCriar: 'IXC recusou: fornecedor inválido',
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(0);
    expect(r.erros[0]).toMatchObject({ fornecedor: 'Provedor de Link' });
    // Só o erro é gravado — o mês continua pendente para a próxima rodada.
    expect(atualizacoes[0]).toEqual({
      ultimoErro: 'IXC recusou: fornecedor inválido',
    });
  });

  it('uma que falha não impede as outras', async () => {
    const { service } = montarServico({
      lista: [recorrente({ id: 'r1' }), recorrente({ id: 'r2' })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(2);
  });

  it('aplica a categoria ao título que o IXC devolveu', async () => {
    const { service, categorias } = montarServico({
      lista: [recorrente({ categoriaId: 'cat-1' })],
    });

    await service.gerarPendentes('u1');

    expect(categorias.classificar).toHaveBeenCalledWith(7777, 'cat-1', 'u1');
  });
});

describe('RecorrentesService.gerarPendentes — consórcio', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('duas por mês: gera as parcelas 10 e 11 no mesmo vencimento, numeradas', async () => {
    const { service, contasPagar } = montarServico({ lista: [consorcio()] });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(2);
    expect(contasPagar.criarDespesa).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        observacao: 'Consórcio caçamba (10/60)',
        valor: 3242.37,
        dataVencimento: new Date(Date.UTC(2026, 7, 20)),
      }),
      undefined,
    );
    expect(contasPagar.criarDespesa).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        observacao: 'Consórcio caçamba (11/60)',
        dataVencimento: new Date(Date.UTC(2026, 7, 20)),
      }),
      undefined,
    );
  });

  it('o vencimento só anda depois da segunda do mês', async () => {
    const { service, atualizacoes } = montarServico({ lista: [consorcio()] });

    await service.gerarPendentes();

    expect(atualizacoes[0]).toMatchObject({
      parcelasLancadas: 10,
      lancadasNoMes: 1,
    });
    expect(atualizacoes[0]).not.toHaveProperty('proximoVencimento');
    expect(atualizacoes[1]).toMatchObject({
      parcelasLancadas: 11,
      lancadasNoMes: 0,
      proximoVencimento: new Date(Date.UTC(2026, 8, 20)),
    });
  });

  it('se a segunda do mês falhou, a rodada seguinte gera só ela', async () => {
    const { service, contasPagar } = montarServico({
      lista: [consorcio({ parcelasLancadas: 10, lancadasNoMes: 1 })],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledTimes(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ observacao: 'Consórcio caçamba (11/60)' }),
      undefined,
    );
  });

  it('a última parcela desliga o consórcio, mesmo no meio do mês', async () => {
    // Faltava uma só, e o mês pagaria duas: sai a 60 e para.
    const { service, contasPagar, atualizacoes } = montarServico({
      lista: [consorcio({ parcelasLancadas: 59 })],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ observacao: 'Consórcio caçamba (60/60)' }),
      undefined,
    );
    expect(atualizacoes[0]).toMatchObject({ parcelasLancadas: 60, ativa: false });
  });

  it('quitado não gera nada, mesmo religado', async () => {
    const { service, contasPagar } = montarServico({
      lista: [consorcio({ parcelasLancadas: 60, ativa: true })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(0);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('recusa começar com mais parcelas saídas do que o total', async () => {
    const { service } = montarServico();

    await expect(
      service.criar({
        idFornecedorIxc: 196,
        fornecedorNome: 'Administradora',
        valor: 100,
        observacao: 'Consórcio',
        proximoVencimento: '2026-09-20',
        totalParcelas: 60,
        parcelasLancadas: 61,
      }),
    ).rejects.toThrow(/61 parcelas/);
  });
});

/**
 * A antecipação — a parcela paga fora da ordem.
 *
 * Ela não nasce sozinha: quem antecipa escolhe a parcela na tela, lança a
 * conta com o valor do boleto (que já vem com o desconto do juro que ainda ia
 * correr) e só então ela é registrada aqui. O que este arquivo protege é o
 * essencial disso: a rotina mensal não pode gerar de novo uma parcela que já
 * foi paga adiantada, e a mesma parcela não pode ser antecipada duas vezes.
 */
describe('RecorrentesService — parcela antecipada', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  /** 50 parcelas, duas por mês, 12 pagas e 5 antecipadas do fim no cadastro. */
  function financiamento(over: Record<string, unknown> = {}) {
    return consorcio({
      fornecedorNome: 'Banco do Carro',
      observacao: 'Financiamento Hilux',
      valor: 2000,
      totalParcelas: 50,
      parcelasLancadas: 12,
      parcelasPorMes: 2,
      parcelasAntecipadas: 5,
      ehFinanciamento: true,
      ...over,
    });
  }

  it('a rotina gera as da frente e pula a que já foi antecipada', async () => {
    // A 13 foi paga adiantada: o mês que vem é 14 e 15.
    const { service, contasPagar } = montarServico({
      lista: [financiamento({ antecipadas: [{ numero: 13 }] })],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(2);
    expect(contasPagar.criarDespesa).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ observacao: 'Financiamento Hilux (14/50)' }),
      undefined,
    );
    expect(contasPagar.criarDespesa).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ observacao: 'Financiamento Hilux (15/50)' }),
      undefined,
    );
  });

  it('a parcela sai sempre pelo valor de sempre — o desconto é do boleto, não da regra', async () => {
    const { service, contasPagar } = montarServico({ lista: [financiamento()] });

    await service.gerarPendentes();

    expect(contasPagar.criarDespesa).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ valor: 2000 }),
      undefined,
    );
  });

  it('as antecipadas do fim não são geradas, e o contrato acaba quando as pontas se encontram', async () => {
    // 44 pela frente e as 6 do fim: falta só a 45.
    const { service, contasPagar, atualizacoes } = montarServico({
      lista: [
        financiamento({ parcelasLancadas: 44, parcelasAntecipadas: 5 }),
      ],
    });

    const r = await service.gerarPendentes();

    expect(r.geradas).toBe(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ observacao: 'Financiamento Hilux (45/50)' }),
      undefined,
    );
    expect(atualizacoes[0]).toMatchObject({ parcelasLancadas: 45, ativa: false });
  });

  it('quitado pelos dois lados não gera mais nada', async () => {
    const { service, contasPagar } = montarServico({
      lista: [financiamento({ parcelasLancadas: 45, parcelasAntecipadas: 5 })],
    });

    expect((await service.gerarPendentes()).geradas).toBe(0);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('registra a antecipada com o valor do boleto e o de tabela', async () => {
    const { service, antecipadas } = montarServico({
      registro: financiamento({ antecipadas: [] }),
    });

    await service.antecipar(
      'r1',
      { numero: 45, valor: 1712.4, idFnApagarIxc: 9001 },
      'u1',
    );

    expect(antecipadas[0]).toMatchObject({
      numero: 45,
      idFnApagarIxc: 9001,
      criadoPor: 'u1',
    });
    // O que se pagou e o que ela valia: a diferença é o que se economizou.
    expect(Number(antecipadas[0].valor)).toBe(1712.4);
    expect(Number(antecipadas[0].valorDeTabela)).toBe(2000);
  });

  it('informar o valor de uma que o cadastro contou cega transfere a contagem', async () => {
    // O cadastro diz "5 antecipadas do fim": a 50 até a 46 saíram, sem valor.
    // Informar o da 50 registra a parcela e desce o contador para 4 — a mesma
    // parcela não pode valer nos dois lugares.
    const { service, antecipadas, atualizacoes } = montarServico({
      registro: financiamento({ antecipadas: [] }),
    });

    await service.antecipar('r1', { numero: 50, valor: 1600, valorDeTabela: 2000 });

    expect(antecipadas[0]).toMatchObject({ numero: 50 });
    expect(atualizacoes[0]).toMatchObject({ parcelasAntecipadas: 4 });
  });

  it('registrar de novo a mesma parcela corrige o valor, não duplica', async () => {
    const { service, prisma, antecipadas } = montarServico({
      registro: financiamento({ antecipadas: [{ id: 'a9', numero: 50 }] }),
    });

    await service.antecipar('r1', { numero: 50, valor: 1700 });

    expect(prisma.parcelaAntecipada.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a9' } }),
    );
    expect(antecipadas).toHaveLength(0);
  });

  it('guarda o valor de uma parcela que a rotina já gerou, sem mexer na fila', async () => {
    // A 10 saiu há meses; o que falta é saber por quanto. Nada é antecipado
    // aqui: o contador da frente e o do fim ficam onde estão.
    const { service, antecipadas, atualizacoes } = montarServico({
      registro: financiamento({ antecipadas: [] }),
    });

    await service.antecipar('r1', { numero: 10, valor: 2000 });

    expect(antecipadas[0]).toMatchObject({ numero: 10 });
    expect(atualizacoes).toHaveLength(0);
  });

  it('recusa um número que não existe no contrato', async () => {
    const { service } = montarServico({
      registro: financiamento({ antecipadas: [{ numero: 44 }] }),
    });

    // Fora do contrato é o único número que não existe: o resto é valor de
    // parcela, e valor sempre se pode corrigir.
    await expect(service.antecipar('r1', { numero: 0, valor: 1 })).rejects.toThrow(
      /não existe/,
    );
  });

  it('recusa antecipar num gasto mensal sem fim marcado', async () => {
    const { service } = montarServico({ registro: recorrente() });

    await expect(service.antecipar('r1', { numero: 2, valor: 1 })).rejects.toThrow(
      /sem fim marcado/,
    );
  });

  it('antecipar a última que faltava encerra o contrato', async () => {
    // 44 pela frente, 5 do fim e a 45 agora: não sobra nenhuma.
    const { service, atualizacoes } = montarServico({
      registro: financiamento({ parcelasLancadas: 44, parcelasAntecipadas: 5 }),
    });

    await service.antecipar('r1', { numero: 45, valor: 1712.4 });

    expect(atualizacoes[0]).toMatchObject({ ativa: false });
  });

  it('desfazer devolve a parcela para a fila', async () => {
    const { service, prisma } = montarServico({
      antecipada: { id: 'a1', recorrenteId: 'r1', numero: 45 },
    });

    await service.desfazerAntecipacao('r1', 'a1');

    expect(prisma.parcelaAntecipada.delete).toHaveBeenCalledWith({
      where: { id: 'a1' },
    });
  });

  it('não desfaz a antecipação de outro contrato', async () => {
    const { service } = montarServico({
      antecipada: { id: 'a1', recorrenteId: 'outro', numero: 45 },
    });

    await expect(service.desfazerAntecipacao('r1', 'a1')).rejects.toThrow(
      /não encontrada/,
    );
  });
});
