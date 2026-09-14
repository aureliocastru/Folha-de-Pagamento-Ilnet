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
  opts: { lista?: unknown[]; erroAoCriar?: string } = {},
) {
  const atualizacoes: Array<Record<string, unknown>> = [];

  const prisma = {
    despesaRecorrente: {
      findMany: jest.fn().mockResolvedValue(opts.lista ?? [recorrente()]),
      findUnique: jest.fn().mockResolvedValue(recorrente()),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        atualizacoes.push(data);
        return data;
      }),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
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
  return { service, prisma, contasPagar, categorias, atualizacoes };
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
