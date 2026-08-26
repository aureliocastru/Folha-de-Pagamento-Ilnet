import { BadRequestException } from '@nestjs/common';
import { FechamentoCaixaService } from './fechamento-caixa.service';

/**
 * O que este arquivo protege:
 *
 *  - a prestação de contas fecha ou é recusada: nota + troco têm de somar o
 *    que saiu, senão o registro do dinheiro na rua vira enfeite;
 *  - o fechamento só sai com tudo conferido — assiná-lo pela metade tira dele
 *    o único sentido que tem;
 *  - dinheiro na rua **não** impede fechar: ele é a explicação de por que a
 *    gaveta tem menos, e o fechamento guarda quanto era;
 *  - a conta de quem levou dinheiro se acerta aos poucos, e o saldo dela nunca
 *    fica negativo por engano de digitação;
 *  - a contagem da gaveta vence o cálculo, e é dela que o período seguinte
 *    parte — senão a diferença anda de fechamento em fechamento;
 *  - o saldo da gaveta é um fato do caixa e não do recorte: mudar a data
 *    inicial na tela não muda o dinheiro que tem de estar lá;
 *  - a despesa lançada pela prestação não desconta o dinheiro duas vezes;
 *  - a foto nunca sai numa listagem.
 */

const HOJE = new Date('2026-08-18T12:00:00Z');

/**
 * As duas perguntas que o serviço faz à tabela de fechamentos: o anterior ao
 * período (com recorte de data) e o último do caixa (sem). O `where.ate` é o
 * que as separa.
 */
interface ConsultaDeFechamento {
  where?: { caixaId?: number; ate?: { lt?: Date } };
  orderBy?: unknown;
}

/**
 * As duas perguntas à tabela do dinheiro na rua: as contas abertas agora (sem
 * data) e as entregas de um intervalo. O `entregueEm` é o que as separa.
 */
interface ConsultaDeEntrega {
  where?: {
    caixaId?: number;
    baixadoEm?: null;
    entregueEm?: { gte: Date; lte: Date };
  };
}

/**
 * A entrega do teste que não diz quando aconteceu serve para qualquer
 * intervalo: a maioria dos casos não tem nada a dizer sobre datas, e datar
 * todas só para o filtro do dublê enterraria o que cada uma quer mostrar.
 */
const dentro = (d: Date | undefined, faixa: { gte: Date; lte: Date }) =>
  d === undefined || (d >= faixa.gte && d <= faixa.lte);

/** O filtro com que o serviço distingue as duas perguntas de conferência. */
interface ConsultaDeConferencia {
  where?: {
    dataLancamento?: { not?: null; lt?: Date } | null;
    idLancamentoIxc?: { in: number[] };
  };
}

function montarServico(
  opts: {
    lancamentos?: Array<{
      id: number;
      data: Date;
      valor: number;
      historico: string;
      tipo: 'ENTRADA' | 'SAIDA';
    }>;
    conferencias?: Array<{
      idLancamentoIxc: number;
      conferido: boolean;
      qtdNotas?: number;
      /** Preenchida = a conferência sabe de que dia é o lançamento dela. */
      dataLancamento?: Date | null;
      valor?: number | null;
      historico?: string | null;
      id?: string;
      observacao?: string | null;
    }>;
    /** Contas abertas agora, com os acertos que já tiveram. */
    naRua?: Array<Record<string, unknown>>;
    /** A conta que `lancarMovimento` vai buscar pelo id. */
    entrega?: Record<string, unknown> | null;
    /** O fechamento anterior deste caixa, de onde o saldo parte. */
    anterior?: Record<string, unknown> | null;
    /** Entregas com data dentro do período. */
    entregasDoPeriodo?: Array<Record<string, unknown>>;
    /** Acertos com data (ou baixa no IXC) dentro do período. */
    movimentosDoPeriodo?: Array<Record<string, unknown>>;
    /** O último acerto de uma conta, para `desfazerMovimento`. */
    ultimoMovimento?: Record<string, unknown> | null;
    /** O acerto que `desfazerMovimento` vai buscar pelo id. */
    movimento?: Record<string, unknown> | null;
    /** O fechamento que `corrigirContagem` vai buscar pelo id. */
    fechamento?: Record<string, unknown> | null;
    /** O último fechamento do caixa, para a correção saber se pode. */
    ultimo?: Record<string, unknown> | null;
    /** O que o lançamento da despesa devolve. */
    despesaLancada?: Record<string, unknown>;
    /** Diárias assinadas, pagas em mãos, à espera de virar nota. */
    diariasAssinadas?: Array<Record<string, unknown>>;
  } = {},
) {
  const lancamentos = opts.lancamentos ?? [];
  const criados: Record<string, unknown>[] = [];

  const prisma = {
    conferenciaCaixa: {
      /*
       * Duas perguntas à mesma tabela, distinguidas pelo filtro: as
       * conferências do recorte (por `idLancamentoIxc`) e as que ficaram para
       * trás (por `dataLancamento` anterior ao início). Devolver a mesma lista
       * às duas faria toda conferência do período aparecer também como
       * atrasada.
       */
      findMany: jest.fn(async (args: ConsultaDeConferencia = {}) => {
        const todas = (opts.conferencias ?? []).map((c) => ({
          _count: { fotos: c.qtdNotas ?? 0 },
          ...c,
        }));
        const where = args.where ?? {};
        if (!('dataLancamento' in where)) return todas;

        // `dataLancamento: null` é a busca do retrato que falta; com `lt`, a
        // das que ficaram para trás. As duas passam por aqui.
        const filtro = where.dataLancamento;
        if (filtro === null) {
          return todas.filter((c) => !c.dataLancamento);
        }
        return todas.filter(
          (c) =>
            c.conferido !== true &&
            c.dataLancamento instanceof Date &&
            c.dataLancamento < (filtro?.lt as Date),
        );
      }),
      update: jest.fn(
        async ({
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => data,
      ),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        id: 'cf1',
        notaFoto: 'data:image/png;base64,AAAA',
        ...create,
      })),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    diaria: {
      findMany: jest.fn().mockResolvedValue(opts.diariasAssinadas ?? []),
    },
    dinheiroNaRua: {
      // Qual das duas perguntas é, pelo filtro e não pela ordem: com a gaveta
      // somando dias fora do recorte, a das entregas vem mais de uma vez.
      findMany: jest.fn(async (args: ConsultaDeEntrega) =>
        args.where?.entregueEm
          ? (opts.entregasDoPeriodo ?? []).filter((d) =>
              dentro(
                d.entregueEm as Date | undefined,
                args.where!.entregueEm!,
              ),
            )
          : (opts.naRua ?? []).map((d) => ({ movimentos: [], ...d })),
      ),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.entrega ? { movimentos: [], ...opts.entrega } : null,
        ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'r1',
        pessoa: 'Jeferson',
        ...data,
      })),
      delete: jest.fn(),
    },
    fotoDaNota: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'f1',
        ...data,
      })),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    },
    movimentoDaRua: {
      findMany: jest.fn().mockResolvedValue(opts.movimentosDoPeriodo ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.ultimoMovimento ?? null),
      findUnique: jest.fn().mockResolvedValue(opts.movimento ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'm1',
        notaFoto: null,
        ...data,
      })),
      delete: jest.fn(),
    },
    fechamentoCaixa: {
      findMany: jest.fn().mockResolvedValue([]),
      /*
       * Duas perguntas diferentes à mesma tabela: o fechamento anterior ao
       * período (filtrado por data) e o último do caixa (sem filtro). O filtro
       * é o que as distingue.
       */
      findFirst: jest.fn(
        async (args: Record<string, never> | ConsultaDeFechamento) => {
          const consulta = args as ConsultaDeFechamento;
          if (!consulta.where?.ate) return opts.ultimo ?? null;
          if (!opts.anterior) return null;
          /*
           * Sem `ate` informado, o anterior termina na véspera do período —
           * o encaixe normal, em que a gaveta parte de onde a tela começa.
           * Teste que queira dias soltos entre um fechamento e o outro diz o
           * `ate` dele.
           */
          const vespera = new Date(consulta.where.ate.lt as Date);
          vespera.setDate(vespera.getDate() - 1);
          vespera.setHours(23, 59, 59, 999);
          return { ate: vespera, saldoContado: null, ...opts.anterior };
        },
      ),
      findUnique: jest.fn().mockResolvedValue(opts.fechamento ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return { id: 'f1', ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'f1',
        saldoFinal: opts.fechamento?.saldoFinal ?? 0,
        ...data,
      })),
    },
  };

  const pagamentos = {
    // O IXC recusa apagar título já pago; quem chama trata a recusa.
    excluir: jest.fn().mockResolvedValue({ idFnApagar: 4242 }),
  };

  const despesas = {
    lancar: jest.fn().mockResolvedValue(
      opts.despesaLancada ?? {
        conta: { id: 'cp1', idFnApagarIxc: 4242 },
        contas: [{ id: 'cp1', idFnApagarIxc: 4242 }],
        avisoCategoria: null,
        baixa: { pagas: 1, tentadas: 1, valor: 0, data: '2026-08-10', avisos: [] },
      },
    ),
  };

  const caixa = {
    listarCaixas: jest
      .fn()
      .mockResolvedValue({ tabela: 'contas', caixas: [{ id: 7, nome: 'CX - Werick' }] }),
    /*
     * Por data, como o webservice filtra — e por dia inteiro, como ele: as
     * pontas do intervalo viram 00:00 e 23:59:59.999 antes de comparar.
     * Devolver tudo a qualquer intervalo esconderia justamente a diferença
     * entre o que a gaveta soma e o que a tela mostra.
     */
    listarLancamentos: jest.fn(async (_caixa: number, de: Date, ate: Date) => {
      const inicio = new Date(de);
      inicio.setHours(0, 0, 0, 0);
      const fim = new Date(ate);
      fim.setHours(23, 59, 59, 999);
      return {
        tabela: 'fn_lancamento_caixa',
        lancamentos: lancamentos.filter(
          (l) => l.data >= inicio && l.data <= fim,
        ),
      };
    }),
    resolverCaixa: jest.fn().mockResolvedValue(7),
  };

  const config = {
    obter: jest.fn().mockResolvedValue({
      caixaTabelaContas: '',
      caixaTabelaMovimento: '',
      caixaEmMaosNome: 'CX - Werick',
      contaPagamentoCaixaId: 23,
    }),
  };

  const service = new FechamentoCaixaService(
    prisma as never,
    caixa as never,
    config as never,
    despesas as never,
    pagamentos as never,
  );
  return { service, prisma, caixa, criados, despesas, pagamentos };
}

const saida = (id: number, valor: number) => ({
  id,
  data: HOJE,
  valor,
  historico: `saída ${id}`,
  tipo: 'SAIDA' as const,
});

/** O dia em que as prestações destes testes dizem que o dinheiro saiu. */
const PAGO_EM = new Date(2026, 7, 19, 10);

/** A mesma saída, no dia em que se quer que ela tenha acontecido. */
const saidaEm = (id: number, valor: number, data: Date) => ({
  ...saida(id, valor),
  data,
});

/** Uma entrada de dinheiro no caixa, no dia escolhido. */
const entradaEm = (id: number, valor: number, data: Date) => ({
  ...saidaEm(id, valor, data),
  historico: `entrada ${id}`,
  tipo: 'ENTRADA' as const,
});

describe('extrato do caixa', () => {
  it('junta o lançamento do IXC com o que já foi conferido aqui', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100), saida(2, 250)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.lancamentos).toBe(2);
    expect(e.resumo.conferidos).toBe(1);
    expect(e.resumo.saidas).toBe(350);
    expect(e.lancamentos[0].conferido).toBe(true);
    expect(e.lancamentos[1].conferido).toBe(false);
  });

  it('a foto não vem na listagem, só quantas existem', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true, qtdNotas: 2 }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.lancamentos[0].qtdNotas).toBe(2);
    expect(JSON.stringify(e)).not.toContain('base64');
  });

  it('o que está na rua conta inteiro, mesmo entregue antes do período', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [],
      naRua: [
        { id: 'r1', pessoa: 'Jeferson', valor: 100, entregueEm: new Date('2026-07-02') },
        { id: 'r2', pessoa: 'Letícia', valor: 200, entregueEm: new Date('2026-08-10') },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.naRua).toBe(300);
    expect(e.resumo.pessoasNaRua).toBe(2);
    // A consulta é pelo que está aberto agora, e não pelas datas do período.
    const [{ where }] = prisma.dinheiroNaRua.findMany.mock.calls[0];
    expect(where).toEqual({ caixaId: 7, baixadoEm: null });
  });

  /*
   * "Não achei o anterior" tinha duas causas e uma frase só, e a tela dizia a
   * errada: com 04/07 a 18/08 já assinado, pedir de 01/08 fazia-a anunciar que
   * o caixa nunca fora fechado — e pedir o saldo inicial como se fosse o
   * primeiro de todos.
   */
  it('período que invade um fechamento existente diz até onde está fechado', async () => {
    const { service } = montarServico({
      // Nenhum fechamento terminou antes de 01/08, mas o caixa está conferido
      // até 18/08: o período pedido começa no meio dele.
      anterior: null,
      ultimo: { ate: new Date(2026, 7, 18) },
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-19');

    expect(e.resumo.saldoInicial).toBeNull();
    expect(e.resumo.fechadoAte).toBe('2026-08-18');
  });

  it('caixa virgem não tem até onde: fechadoAte fica nulo', async () => {
    const { service } = montarServico();

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.fechadoAte).toBeNull();
  });

  /*
   * O recorte de um dia só era o intervalo vazio [00:00, 00:00]: uma saída
   * anotada às duas da tarde ficava de fora, e a gaveta nao se mexia com ela.
   * Só o que nasce com hora zerada escapava, que é por que demorou a aparecer.
   */
  it('o período vai até o fim do último dia, e não até a meia-noite dele', async () => {
    const { service, prisma } = montarServico();

    await service.extrato(7, '2026-08-19', '2026-08-19');

    // A segunda chamada é a das entregas do período.
    const [consulta] = prisma.dinheiroNaRua.findMany.mock.calls[1] as Array<{
      where: { entregueEm: { gte: Date; lte: Date } };
    }>;
    expect(consulta.where.entregueEm.gte).toEqual(new Date(2026, 7, 19));
    expect(consulta.where.entregueEm.lte).toEqual(
      new Date(2026, 7, 19, 23, 59, 59, 999),
    );
  });

  it('uma entrega da tarde de hoje entra no período de hoje', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      // É assim que ela nasce: `new Date()` na hora em que foi anotada.
      entregasDoPeriodo: [{ valor: 50 }],
    });

    const e = await service.extrato(7, '2026-08-19', '2026-08-19');

    expect(e.resumo.entregueNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(950);
  });

  /*
   * A nota daquele pagamento já existe neste sistema: é o recibo que a pessoa
   * assinou com o dedo. Sem a ligação, quem fecha o caixa imprimia o recibo,
   * fotografava o papel e anexava a foto do papel que o sistema gerou.
   */
  it('o recibo assinado do diarista vira a nota da saída dele', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. João da Silva - doc.: 12' },
      ],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'João da Silva', nomeFantasia: null } },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    const [{ data }] = prisma.fotoDaNota.create.mock.calls[0];
    expect(data.diariaId).toBe('dia1');
    // A tela recebe o número já certo, sem precisar de outra ida.
    expect(e.lancamentos[0].qtdNotas).toBe(1);
  });

  it('valor igual mas outro nome não casa', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. Auto Peças Silva - doc.: 12' },
      ],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'Jeferson Alves', nomeFantasia: null } },
      ],
    });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(prisma.fotoDaNota.create).not.toHaveBeenCalled();
  });

  it('saída que já tem nota não recebe o recibo por cima', async () => {
    const { service, prisma } = montarServico({
      lancamentos: [
        { ...saida(90, 290), historico: 'Pag. João da Silva - doc.: 12' },
      ],
      conferencias: [{ idLancamentoIxc: 90, conferido: false, qtdNotas: 1 }],
      diariasAssinadas: [
        { id: 'dia1', valor: 290, diarista: { nome: 'João da Silva', nomeFantasia: null } },
      ],
    });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(prisma.fotoDaNota.create).not.toHaveBeenCalled();
  });

  it('recusa período de trás para frente', async () => {
    const { service } = montarServico();
    await expect(service.extrato(7, '2026-08-31', '2026-08-01')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('a conta de quem levou dinheiro', () => {
  /** R$ 204,00 com a Idelblane, nada acertado ainda. */
  const conta = {
    id: 'r1',
    caixaId: 7,
    pessoa: 'Idelblane',
    valor: 204,
    entregueEm: new Date(2026, 7, 14),
    baixadoEm: null,
    movimentos: [],
  };

  const despesa = {
    idFornecedorIxc: 55,
    fornecedorNome: 'Auto Peças Silva',
    descricao: 'Correia do gerador',
  };

  /*
   * O caso que derrubou a regra antiga: leva 204, traz nota de 100 e fica com
   * os outros 104 para a próxima compra. Exigir que nota e troco fechassem a
   * entrega inteira obrigava a mentir num dos dois campos.
   */
  it('nota parcial desce o saldo e deixa a conta aberta', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      data: '2026-08-15',
    });

    expect(r.saldo).toBe(104);
    expect(r.acertada).toBe(false);
    expect(prisma.dinheiroNaRua.update).not.toHaveBeenCalled();
  });

  it('o reforço sobe o saldo: saiu mais dinheiro para completar a compra', async () => {
    const { service } = montarServico({
      entrega: {
        ...conta,
        movimentos: [{ tipo: 'NOTA', valor: 100 }],
      },
    });

    const r = await service.lancarMovimento('r1', {
      tipo: 'REFORCO',
      valor: 50,
    });

    // 204 - 100 de nota + 50 que saiu agora
    expect(r.saldo).toBe(154);
  });

  it('zerando o saldo, a conta se acerta sozinha', async () => {
    const { service, prisma } = montarServico({
      entrega: { ...conta, movimentos: [{ tipo: 'NOTA', valor: 200 }] },
    });

    const r = await service.lancarMovimento('r1', { tipo: 'TROCO', valor: 4 }, 'u1');

    expect(r.saldo).toBe(0);
    expect(r.acertada).toBe(true);
    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.baixadoEm).toBeInstanceOf(Date);
  });

  /*
   * Nota maior que o saldo é sempre engano de digitação, e deixaria a pessoa
   * devendo negativo — um negativo que entraria no total da rua abatendo o
   * saldo de quem realmente está com dinheiro.
   */
  it('recusa acerto maior que o saldo, e diz quanto está com a pessoa', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 300 }),
      // `\s` e não um espaço literal: o pt-BR separa o "R$" do número com
      // espaço não separável, e um espaço comum aqui nunca casaria.
    ).rejects.toThrow(/está com R\$\s204,00/);
  });

  it('o reforço pode passar do saldo: ele é dinheiro saindo, não acerto', async () => {
    const { service } = montarServico({ entrega: conta });

    const r = await service.lancarMovimento('r1', { tipo: 'REFORCO', valor: 500 });

    expect(r.saldo).toBe(704);
  });

  it('conta já acertada não recebe lançamento novo', async () => {
    const { service } = montarServico({
      entrega: { ...conta, baixadoEm: new Date(2026, 7, 15) },
    });

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 10 }),
    ).rejects.toThrow(/já foi acertada/i);
  });

  it('valor zero ou negativo não é lançamento', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'TROCO', valor: 0 }),
    ).rejects.toThrow(/maior que zero/i);
  });

  it('só a nota vira despesa — troco e reforço não são gasto', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', { tipo: 'TROCO', valor: 10, despesa }),
    ).rejects.toThrow(/só a nota vira conta a pagar/i);
  });

  // --- A despesa que a nota lança ---

  it('a despesa é lançada no caixa da entrega, quitada na data em que saiu', async () => {
    const { service, despesas } = montarServico({ entrega: conta });

    await service.lancarMovimento(
      'r1',
      { tipo: 'NOTA', valor: 100, despesa: { ...despesa, pagoEm: '2026-08-10' } },
      'u1',
      'Henrico',
    );

    const [dto] = despesas.lancar.mock.calls[0];
    expect(dto.valor).toBe(100);
    // O dinheiro saiu daquela gaveta: é dela que a saída sai no IXC.
    expect(dto.contaPagamento).toBe(7);
    expect(dto.jaPaga).toBe(true);
    // As três datas são o dia do gasto, e não o dia da prestação.
    expect(dto.dataPagamento).toBe('2026-08-10');
    expect(dto.dataEmissao).toBe('2026-08-10');
    expect(dto.dataVencimento).toBe('2026-08-10');
  });

  it('sem data na despesa, ela cai no dia do lançamento', async () => {
    const { service, despesas } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      data: '2026-08-03',
      despesa,
    });

    expect(despesas.lancar.mock.calls[0][0].dataPagamento).toBe('2026-08-03');
  });

  it('guarda o título e o dia da saída, que é o que evita o desconto em dobro', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      despesa: { ...despesa, pagoEm: '2026-08-10' },
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.idFnApagarIxc).toBe(4242);
    expect(data.gastoPagoEm).toEqual(new Date(2026, 7, 10));
    expect(data.fornecedorNome).toBe('Auto Peças Silva');
  });

  /*
   * Título criado que não chegou a ser baixado não gera saída no IXC. Marcar o
   * dia mesmo assim faria o saldo somar de volta um dinheiro que ninguém
   * descontou — a gaveta apareceria com mais do que tem.
   */
  it('despesa que não ficou paga no IXC não marca o dia da saída', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      despesaLancada: {
        conta: { id: 'cp1', idFnApagarIxc: 4242 },
        contas: [{ id: 'cp1', idFnApagarIxc: 4242 }],
        avisoCategoria: null,
        baixa: {
          pagas: 0,
          tentadas: 1,
          valor: 0,
          data: '2026-08-10',
          avisos: ['A conta foi lançada no IXC, mas não ficou paga.'],
        },
      },
    });

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      despesa: { ...despesa, pagoEm: '2026-08-10' },
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.gastoPagoEm).toBeNull();
    expect(r.despesa?.paga).toBe(false);
    expect(r.despesa?.avisos.length).toBeGreaterThan(0);
  });

  /*
   * O lançamento fechado não se lança de novo. Se ele viesse antes da despesa,
   * uma falha do IXC deixaria o saldo abatido aqui e a despesa em lugar nenhum.
   */
  it('despesa que nem chegou a ser lançada não abate o saldo', async () => {
    const { service, prisma, despesas } = montarServico({ entrega: conta });
    despesas.lancar.mockRejectedValueOnce(new Error('IXC fora do ar'));

    await expect(
      service.lancarMovimento('r1', { tipo: 'NOTA', valor: 100, despesa }),
    ).rejects.toThrow(/IXC fora do ar/);

    expect(prisma.movimentoDaRua.create).not.toHaveBeenCalled();
  });

  /*
   * A saída nasce da prestação já revisada: pedir que alguém a marque de novo,
   * e fotografe de novo a mesma nota, é trabalho repetido por um detalhe de
   * arquitetura — a foto do acerto mora num lugar e a da conferência noutro.
   */
  /*
   * A foto viaja; o "olhei" não. Quem presta contas e quem confere o caixa não
   * são o mesmo gesto, e dar por conferido o que a própria pessoa acabou de
   * lançar tira da conferência o sentido que ela tem.
   */
  it('a saída criada no IXC recebe as fotos, e continua por conferir', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      // No mesmo dia em que a prestação diz que o dinheiro saiu: é entre as
      // saídas daquele dia que a foto vai procurar a sua.
      lancamentos: [saidaEm(77, 100, PAGO_EM)],
    });

    await service.lancarMovimento(
      'r1',
      {
        tipo: 'NOTA',
        valor: 100,
        notasFoto: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'],
        despesa: { ...despesa, pagoEm: '2026-08-19' },
      },
      'u1',
    );

    const [chamada] = prisma.conferenciaCaixa.upsert.mock.calls[0] as Array<{
      create: Record<string, unknown>;
    }>;
    expect(chamada.create.idLancamentoIxc).toBe(77);
    expect(chamada.create.conferido).toBeUndefined();

    const [criadas] = prisma.fotoDaNota.createMany.mock.calls[0] as Array<{
      data: Array<Record<string, unknown>>;
    }>;
    expect(criadas.data).toHaveLength(2);
  });

  /*
   * Duas saídas iguais no mesmo dia: a segunda tem de achar a segunda. Sem
   * isto, o segundo acerto marcaria de novo o lançamento do primeiro e deixaria
   * um por conferir para sempre.
   */
  it('não toma uma saída que já tem foto', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [saidaEm(77, 100, PAGO_EM), saidaEm(78, 100, PAGO_EM)],
      conferencias: [{ idLancamentoIxc: 77, conferido: true, qtdNotas: 1 }],
    });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      notasFoto: ['data:image/png;base64,AAAA'],
      despesa: { ...despesa, pagoEm: '2026-08-19' },
    });

    const [chamada] = prisma.conferenciaCaixa.upsert.mock.calls[0] as Array<{
      create: Record<string, unknown>;
    }>;
    expect(chamada.create.idLancamentoIxc).toBe(78);
  });

  it('acerto sem despesa não mexe na conferência', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [saida(77, 100)],
    });

    await service.lancarMovimento('r1', { tipo: 'TROCO', valor: 100 });

    expect(prisma.conferenciaCaixa.upsert).not.toHaveBeenCalled();
  });

  /*
   * Isto é conveniência — poupar a segunda foto da mesma nota. Derrubar por
   * causa dela um acerto que já escreveu no IXC seria trocar um incômodo por
   * um estrago.
   */
  it('não achando a saída no IXC, o acerto passa assim mesmo', async () => {
    const { service, prisma } = montarServico({
      entrega: conta,
      lancamentos: [],
    });

    const r = await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 100,
      notasFoto: ['data:image/png;base64,AAAA'],
      despesa: { ...despesa, pagoEm: '2026-08-19' },
    });

    expect(r.saldo).toBe(104);
    expect(prisma.conferenciaCaixa.upsert).not.toHaveBeenCalled();
  });

  // --- Desfazer ---

  it('desfaz um lançamento e reabre a conta', async () => {
    const m = { id: 'm1', entregaId: 'r1', idFnApagarIxc: null };
    const { service, prisma } = montarServico({ movimento: m });

    await service.desfazerMovimento('m1');

    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
    const [{ data }] = prisma.dinheiroNaRua.update.mock.calls[0];
    expect(data.baixadoEm).toBeNull();
  });

  /*
   * O saldo é uma soma: some qualquer parcela que se tire. Obrigar a desfazer
   * de trás para frente era burocracia — quem digita 100 no lugar de 10 percebe
   * depois de já ter lançado o troco.
   */
  it('desfaz qualquer lançamento, e não só o último', async () => {
    const { service, prisma } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: null },
      ultimoMovimento: { id: 'm2', entregaId: 'r1', idFnApagarIxc: null },
    });

    await service.desfazerMovimento('m1');

    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
  });

  /*
   * Apagar só deste lado deixaria a saída viva no IXC: o caixa passaria a
   * descontar um dinheiro que ninguém compensa, e a gaveta apareceria menor.
   */
  it('lançamento com título leva o título junto', async () => {
    const { service, pagamentos, prisma } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });

    await service.desfazerMovimento('m1');

    expect(pagamentos.excluir).toHaveBeenCalledWith(4242);
    expect(prisma.movimentoDaRua.delete).toHaveBeenCalled();
  });

  it('título que o IXC não deixa apagar segura o desfazer, e diz o número', async () => {
    const { service, prisma, pagamentos } = montarServico({
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });
    pagamentos.excluir.mockRejectedValueOnce(
      new Error('O título 4242 já foi pago.'),
    );

    await expect(service.desfazerMovimento('m1')).rejects.toThrow(/#4242/);
    expect(prisma.movimentoDaRua.delete).not.toHaveBeenCalled();
  });

  it('desfazer tudo volta a conta ao valor entregue', async () => {
    const { service, prisma } = montarServico({
      entrega: {
        ...conta,
        movimentos: [
          { id: 'm1', entregaId: 'r1', idFnApagarIxc: null, tipo: 'NOTA', valor: 100 },
          { id: 'm2', entregaId: 'r1', idFnApagarIxc: null, tipo: 'TROCO', valor: 4 },
        ],
      },
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: null },
    });

    const r = await service.desfazerAcertos('r1');

    expect(r.desfeitos).toBe(2);
    expect(r.mantidos).toEqual([]);
    expect(prisma.movimentoDaRua.delete).toHaveBeenCalledTimes(2);
  });

  /* Desfazer pela metade em silêncio seria pior que não desfazer. */
  it('desfazer tudo devolve nomeado o que não deu para desfazer', async () => {
    const { service, pagamentos } = montarServico({
      entrega: {
        ...conta,
        movimentos: [
          { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242, tipo: 'NOTA', valor: 100 },
        ],
      },
      movimento: { id: 'm1', entregaId: 'r1', idFnApagarIxc: 4242 },
    });
    pagamentos.excluir.mockRejectedValue(new Error('O título 4242 já foi pago.'));

    const r = await service.desfazerAcertos('r1');

    expect(r.desfeitos).toBe(0);
    expect(r.mantidos).toHaveLength(1);
    expect(r.mantidos[0]).toMatch(/#4242/);
  });

  it('não apaga conta que já tem acerto lançado', async () => {
    const { service } = montarServico({
      entrega: { ...conta, movimentos: [{ id: 'm1' }] },
    });

    await expect(service.apagarEntrega('r1')).rejects.toThrow(BadRequestException);
  });
});

describe('o saldo que deve estar na gaveta', () => {
  const DENTRO = new Date(2026, 7, 10);

  it('sem fechamento anterior, não inventa saldo: fica nulo', async () => {
    const { service } = montarServico({ lancamentos: [saida(1, 100)] });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBeNull();
    expect(e.resumo.saldoEsperado).toBeNull();
  });

  /*
   * O anterior tem de ser anterior de verdade. Sem o recorte por data, um
   * período recém-fechado seria lido como o proprio saldo de partida na vez
   * seguinte que a mesma tela abrisse, e o movimento entraria duas vezes.
   */
  it('procura o anterior só entre os que terminaram antes do início', async () => {
    const { service, prisma } = montarServico({ anterior: { saldoFinal: 1000 } });

    await service.extrato(7, '2026-08-01', '2026-08-31');

    const [consulta] = prisma.fechamentoCaixa.findFirst.mock
      .calls[0] as ConsultaDeFechamento[];
    expect(consulta.where?.caixaId).toBe(7);
    expect(consulta.where?.ate?.lt).toEqual(new Date(2026, 7, 1));
    expect(consulta.orderBy).toEqual({ ate: 'desc' });
  });

  it('parte do saldo final do fechamento anterior', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300), { ...saida(2, 500), tipo: 'ENTRADA' as const }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    // 1000 + 500 de entrada - 300 de saída
    expect(e.resumo.saldoInicial).toBe(1000);
    expect(e.resumo.saldoEsperado).toBe(1200);
  });

  /*
   * O dinheiro entregue na rua sai da gaveta sem virar saída no IXC, e o troco
   * volta do mesmo jeito. Sem os dois nesta conta, o número na tela não seria o
   * que a pessoa tem na mão — que é a única coisa que este indicador serve para
   * dizer.
   */
  it('o que saiu com alguém sai da gaveta, mesmo sem estar no IXC', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      entregasDoPeriodo: [{ valor: 200 }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(200);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  /* O reforço é dinheiro saindo da gaveta pelo mesmo motivo que a entrega. */
  it('o reforço pesa na gaveta como uma entrega', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      movimentosDoPeriodo: [{ tipo: 'REFORCO', valor: 50, data: DENTRO }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(950);
  });

  it('o troco devolvido volta para a gaveta', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      // Entregue no período anterior, devolveu neste: só o troco entra.
      movimentosDoPeriodo: [{ tipo: 'TROCO', valor: 50, data: DENTRO }],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.entregueNoPeriodo).toBe(0);
    expect(e.resumo.trocoNoPeriodo).toBe(50);
    expect(e.resumo.saldoEsperado).toBe(1050);
  });

  /*
   * Contagem vence cálculo. O primeiro caixa batido aqui fechou com R$ 0,00
   * calculados e a gaveta cheia — o saldo inicial informado foi zero, e o zero
   * atravessou o período inteiro. Se o encadeamento seguisse o calculado, todo
   * fechamento seguinte nasceria com o mesmo buraco.
   */
  it('parte da contagem do fechamento anterior, e não do que ele calculou', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 0, saldoContado: 3368 },
      lancamentos: [saida(1, 68)],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBe(3368);
    expect(e.resumo.saldoEsperado).toBe(3300);
  });

  it('fechamento anterior sem contagem continua valendo pelo calculado', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000, saldoContado: null },
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.saldoInicial).toBe(1000);
  });

  /*
   * O dinheiro sai da gaveta uma vez só.
   *
   * Ele já saiu na entrega; a conta a pagar que a prestação lançou o faz sair
   * de novo, agora pelas saídas do IXC. Descontar os dois deixaria a gaveta
   * R$ 200,00 mais pobre na tela do que na mão de quem está contando.
   */
  it('o gasto que virou conta a pagar não desconta duas vezes', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      // A saída de 200 no IXC é a baixa da despesa que a nota lançou.
      lancamentos: [saida(1, 200)],
      entregasDoPeriodo: [{ valor: 204 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 200, data: DENTRO, gastoPagoEm: DENTRO },
        { tipo: 'TROCO', valor: 4, data: DENTRO, gastoPagoEm: null },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.gastoLancadoNoPeriodo).toBe(200);
    // 1000 - 204 que saiu + 4 de troco = 800, e a saída de 200 do IXC é a
    // mesma saída, não outra.
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('gasto sem conta a pagar não compensa nada', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      entregasDoPeriodo: [{ valor: 204 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 200, data: DENTRO, gastoPagoEm: null },
        { tipo: 'TROCO', valor: 4, data: DENTRO, gastoPagoEm: null },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    expect(e.resumo.gastoLancadoNoPeriodo).toBe(0);
    expect(e.resumo.saldoEsperado).toBe(800);
  });

  it('entregue e acertado no mesmo período: sobra o que virou nota', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [],
      entregasDoPeriodo: [{ valor: 200 }],
      movimentosDoPeriodo: [
        { tipo: 'NOTA', valor: 150, data: DENTRO, gastoPagoEm: null },
        { tipo: 'TROCO', valor: 50, data: DENTRO, gastoPagoEm: null },
      ],
    });

    const e = await service.extrato(7, '2026-08-01', '2026-08-31');

    // Saíram 200, voltaram 50: a gaveta ficou 150 menor.
    expect(e.resumo.saldoEsperado).toBe(850);
  });

  /*
   * O defeito que trouxe esta parte: o mesmo caixa, no mesmo dia, mostrava
   * R$ 4.766,00 quando o recorte começava em 20/08 e R$ 3.562,00 quando
   * começava em 19/08. O saldo saía da soma do recorte sobre o fechamento
   * anterior, e o dia 19 — que não estava no recorte nem dentro do fechamento
   * — não entrava em conta nenhuma. O dinheiro na gaveta é um só.
   */
  it('não muda de valor quando a data inicial muda', async () => {
    // Fechado até 18/08 com 3.311 na gaveta. No dia 19 saíram 2.008 e
    // entraram 804; no dia 20, saíram 255 e entraram 1.710.
    const fechadoAte18 = {
      anterior: {
        saldoFinal: 3311,
        ate: new Date(2026, 7, 18, 23, 59, 59, 999),
      },
      lancamentos: [
        saidaEm(1, 2008, new Date(2026, 7, 19, 14)),
        entradaEm(2, 804, new Date(2026, 7, 19, 15)),
        saidaEm(3, 255, new Date(2026, 7, 20, 9)),
        entradaEm(4, 1710, new Date(2026, 7, 20, 10)),
      ],
    };

    const desde19 = await montarServico(fechadoAte18).service.extrato(
      7,
      '2026-08-19',
      '2026-08-20',
    );
    const so20 = await montarServico(fechadoAte18).service.extrato(
      7,
      '2026-08-20',
      '2026-08-20',
    );

    expect(desde19.resumo.saldoEsperado).toBe(3562);
    expect(so20.resumo.saldoEsperado).toBe(3562);
    expect(so20.resumo.gavetaDesde).toBe('2026-08-19');
    // O recorte continua mandando no resto da tela: a lista é a do dia pedido.
    expect(so20.resumo.saidas).toBe(255);
    expect(so20.resumo.entradas).toBe(1710);
    expect(so20.resumo.lancamentos).toBe(2);
  });

  it('o que saiu com alguém fora do recorte também falta na gaveta', async () => {
    const { service } = montarServico({
      anterior: {
        saldoFinal: 1000,
        ate: new Date(2026, 7, 18, 23, 59, 59, 999),
      },
      entregasDoPeriodo: [
        { valor: 150, entregueEm: new Date(2026, 7, 19, 16) },
      ],
    });

    const e = await service.extrato(7, '2026-08-20', '2026-08-20');

    // A entrega não é do período mostrado, e por isso não aparece no
    // indicador dele — mas o dinheiro não está na gaveta.
    expect(e.resumo.entregueNoPeriodo).toBe(0);
    expect(e.resumo.saldoEsperado).toBe(850);
  });

  /*
   * Fechamento assinado antes de 02eaaea guarda `ate` à meia-noite do último
   * dia. Partir do instante seguinte recontaria o dia 18 inteiro — dias que
   * aquele fechamento já tinha contado e já estão no saldo dele.
   */
  it('fechamento antigo, com ate à meia-noite, não reconta o próprio dia', async () => {
    const { service } = montarServico({
      anterior: { saldoFinal: 1000, ate: new Date(2026, 7, 18) },
      lancamentos: [saidaEm(1, 300, new Date(2026, 7, 18, 15))],
    });

    const e = await service.extrato(7, '2026-08-20', '2026-08-20');

    expect(e.resumo.saldoEsperado).toBe(1000);
  });

  /*
   * Os dias que faltam são mais velhos que o recorte, e a leitura do IXC
   * caminha do mais novo para o mais velho: pedir os dois intervalos em
   * separado faria a segunda ida percorrer de novo o caminho da primeira.
   */
  it('lê o IXC uma vez só, desde o dia seguinte ao fechamento', async () => {
    const { service, caixa } = montarServico({
      anterior: {
        saldoFinal: 1000,
        ate: new Date(2026, 7, 18, 23, 59, 59, 999),
      },
    });

    await service.extrato(7, '2026-08-20', '2026-08-20');

    expect(caixa.listarLancamentos).toHaveBeenCalledTimes(1);
    const [, de, ate] = caixa.listarLancamentos.mock.calls[0];
    expect(de).toEqual(new Date(2026, 7, 19));
    expect(ate).toEqual(new Date(2026, 7, 20, 23, 59, 59, 999));
  });
});

describe('fechar o período', () => {
  it('recusa enquanto houver saída por conferir, e diz quantas', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100), saida(2, 250), saida(3, 10)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/faltam 2 saídas/i);
  });

  /*
   * Um caixa de provedor recebe muito mais do que paga: 109 recebimentos de
   * cliente para 52 saídas, no mês em que esta tela estreou. Os recebimentos
   * entram no saldo, mas exigir os 161 para fechar viraria marcação cega.
   */
  it('entrada não conferida não segura o fechamento', async () => {
    const { service, criados } = montarServico({
      lancamentos: [
        saida(1, 100),
        { ...saida(2, 900), tipo: 'ENTRADA' as const },
        { ...saida(3, 40), tipo: 'ENTRADA' as const },
      ],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoInicial: 0,
    });

    // O fechamento guarda a conferência que ele exigiu: a das saídas.
    expect(criados[0].lancamentos).toBe(1);
    expect(criados[0].conferidos).toBe(1);
    expect(Number(criados[0].totalEntradas)).toBe(940);
  });

  it('dinheiro na rua não impede fechar — vai registrado no fechamento', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
      naRua: [{ id: 'r1', pessoa: 'Jeferson', valor: 150, entregueEm: HOJE }],
    });

    await service.fechar(
      {
        caixaId: 7,
        de: '2026-08-01',
        ate: '2026-08-31',
        observacao: 'ok',
        saldoInicial: 0,
      },
      'u1',
    );

    expect(Number(criados[0].totalNaRua)).toBe(150);
    expect(criados[0].caixaNome).toBe('CX - Werick');
    expect(criados[0].conferidos).toBe(1);
  });

  /*
   * Assumir zero em silêncio seria pior que recusar: o erro entraria no
   * `saldoFinal`, e cada fechamento seguinte herdaria o dele — um caixa
   * inteiro errado por um número que ninguém chegou a informar.
   */
  it('caixa nunca fechado recusa sem o saldo inicial', async () => {
    const { service } = montarServico({
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' }),
    ).rejects.toThrow(/informe quanto havia na gaveta/i);
  });

  it('do segundo em diante, o anterior diz de onde parte', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    // Sem informar nada: o saldo vem do fechamento anterior.
    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    expect(Number(criados[0].saldoInicial)).toBe(1000);
    expect(Number(criados[0].saldoFinal)).toBe(700);
  });

  it('o saldo guardado é o da gaveta, com a rua descontada', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
      entregasDoPeriodo: [{ valor: 200 }],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    // 1000 - 100 de saída - 200 que saiu com alguém
    expect(Number(criados[0].saldoFinal)).toBe(700);
  });

  /*
   * O estrago de um período sobreposto é silencioso: as saídas dos dias
   * repetidos entram duas vezes num saldo assinado, e o novo fechamento passa a
   * disputar com o antigo o posto de "anterior" do seguinte. Os números saem
   * plausíveis e errados.
   */
  it('recusa período que recomeça dentro do que já foi fechado', async () => {
    const { service } = montarServico({
      ultimo: { ate: new Date(2026, 7, 18) },
      lancamentos: [saida(1, 100)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await expect(
      service.fechar({
        caixaId: 7,
        de: '2026-08-01',
        ate: '2026-08-31',
        saldoInicial: 3368,
      }),
    ).rejects.toThrow(/já está fechado até 18\/08\/2026.*19\/08\/2026/s);
  });

  /*
   * O outro lado do mesmo erro: o saldo inicial vem do fechamento anterior e
   * não sabe o que aconteceu nos dias saltados. Fechar assim assinaria um
   * saldo final sem o movimento deles, e o período seguinte partiria dali.
   */
  it('recusa período que pula dias desde o último fechamento', async () => {
    const { service } = montarServico({
      ultimo: { ate: new Date(2026, 7, 18, 23, 59, 59, 999) },
      anterior: {
        saldoFinal: 1000,
        ate: new Date(2026, 7, 18, 23, 59, 59, 999),
      },
    });

    await expect(
      service.fechar({ caixaId: 7, de: '2026-08-20', ate: '2026-08-31' }),
    ).rejects.toThrow(/conferido até 18\/08\/2026.*19\/08\/2026/s);
  });

  it('começando no dia seguinte ao último, fecha normalmente', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 0, saldoContado: 3368 },
      ultimo: { ate: new Date(2026, 7, 18) },
      // Dentro do período que vai ser fechado, e não na véspera dele.
      lancamentos: [saidaEm(1, 100, new Date(2026, 7, 20))],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-19', ate: '2026-08-31' });

    expect(Number(criados[0].saldoInicial)).toBe(3368);
    expect(Number(criados[0].saldoFinal)).toBe(3268);
  });

  it('guarda a contagem da gaveta ao lado do que calculou', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoContado: 690,
    });

    // Os dois convivem: o calculado é o que a soma diz, o contado é o que
    // existe. A diferença entre eles é o que se foi procurar.
    expect(Number(criados[0].saldoFinal)).toBe(700);
    expect(Number(criados[0].saldoContado)).toBe(690);
  });

  it('sem contar, o fechamento sai só com o calculado', async () => {
    const { service, criados } = montarServico({
      anterior: { saldoFinal: 1000 },
      lancamentos: [saida(1, 300)],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({ caixaId: 7, de: '2026-08-01', ate: '2026-08-31' });

    expect(criados[0].saldoContado).toBeNull();
  });

  it('guarda os totais do momento, e não uma referência ao período', async () => {
    const { service, criados } = montarServico({
      lancamentos: [saida(1, 40), { ...saida(2, 60), tipo: 'ENTRADA' as const }],
      conferencias: [{ idLancamentoIxc: 1, conferido: true }],
    });

    await service.fechar({
      caixaId: 7,
      de: '2026-08-01',
      ate: '2026-08-31',
      saldoInicial: 0,
    });

    expect(Number(criados[0].totalSaidas)).toBe(40);
    expect(Number(criados[0].totalEntradas)).toBe(60);
  });
});

/*
 * A correção existe por causa do primeiro caixa batido: ele fechou com o
 * calculado, a gaveta tinha outro valor, e sem poder corrigir a contagem o
 * único caminho seria começar de novo — apagando um fechamento assinado.
 */
describe('corrigir a contagem de um fechamento', () => {
  const fechamento = { id: 'f1', caixaId: 7, saldoFinal: 0, saldoContado: null };

  it('grava a contagem do último fechamento do caixa', async () => {
    const { service, prisma } = montarServico({
      fechamento,
      ultimo: fechamento,
    });

    await service.corrigirContagem('f1', 3368, 'u1');

    const [{ data }] = prisma.fechamentoCaixa.update.mock.calls[0];
    expect(Number(data.saldoContado)).toBe(3368);
  });

  /*
   * Os totais de um fechamento são cópia do que se viu no dia. Mexer num do
   * meio deixaria os seguintes apoiados num saldo que não existe mais, e nada
   * na tela diria isso.
   */
  it('recusa corrigir um fechamento que já tem outro depois dele', async () => {
    const { service } = montarServico({
      fechamento,
      ultimo: { id: 'f2', caixaId: 7, saldoFinal: 500, saldoContado: null },
    });

    await expect(service.corrigirContagem('f1', 3368)).rejects.toThrow(
      /já foi fechado de novo/i,
    );
  });

  it('recusa contagem negativa', async () => {
    const { service } = montarServico({ fechamento, ultimo: fechamento });

    await expect(service.corrigirContagem('f1', -1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('fechamento que não existe não se corrige', async () => {
    const { service } = montarServico({ fechamento: null, ultimo: null });

    await expect(service.corrigirContagem('f9', 100)).rejects.toThrow(
      /não existe/i,
    );
  });
});

/**
 * O que ficou para trás esperando conferência.
 *
 * A nota do acerto da rua chega quando chega: a pessoa levou dinheiro em
 * agosto, comprou em agosto e trouxe o papel em setembro. O acerto entra pelo
 * dia em que aconteceu — que é o certo, porque foi aí que a gaveta mudou —, e a
 * saída que ele cria no IXC nasce com aquela data. Só que a tela olha o recorte
 * de agora, e aquele dia já passou: a saída ia para a fila de conferir e
 * ninguém mais a via.
 */
describe('saídas atrasadas na fila de conferir', () => {
  const RECORTE = { de: '2026-08-19', ate: '2026-08-31' };

  it('a saída por conferir de dia anterior ao recorte aparece', async () => {
    const { service } = montarServico({
      conferencias: [
        {
          id: 'cf-atrasada',
          idLancamentoIxc: 5001,
          conferido: false,
          dataLancamento: new Date('2026-08-17T00:00:00Z'),
          valor: 45,
          historico: 'Pag. Monark Pecas',
          qtdNotas: 1,
        },
      ],
    });

    const extrato = await service.extrato(7, RECORTE.de, RECORTE.ate);

    expect(extrato.atrasados).toHaveLength(1);
    expect(extrato.atrasados[0]).toMatchObject({
      idLancamentoIxc: 5001,
      historico: 'Pag. Monark Pecas',
      qtdNotas: 1,
    });
  });

  it('o que já foi conferido não fica na fila', async () => {
    const { service } = montarServico({
      conferencias: [
        {
          id: 'cf-ok',
          idLancamentoIxc: 5002,
          conferido: true,
          dataLancamento: new Date('2026-08-17T00:00:00Z'),
        },
      ],
    });

    const extrato = await service.extrato(7, RECORTE.de, RECORTE.ate);

    expect(extrato.atrasados).toHaveLength(0);
  });

  /* Do próprio recorte não é atrasado: já está na lista de cima. */
  it('a saída do próprio recorte não se repete como atrasada', async () => {
    const { service } = montarServico({
      conferencias: [
        {
          id: 'cf-hoje',
          idLancamentoIxc: 5003,
          conferido: false,
          dataLancamento: new Date('2026-08-25T00:00:00Z'),
        },
      ],
    });

    const extrato = await service.extrato(7, RECORTE.de, RECORTE.ate);

    expect(extrato.atrasados).toHaveLength(0);
  });
});

/**
 * O período fechado que dizia "133 saídas conferidas" e listava seis.
 *
 * As conferências do primeiro caixa batido guardaram só o número do lançamento
 * no IXC — o retrato (data, valor, histórico) passou a ser copiado depois
 * delas. Como o histórico procura por data, o que não tem data não é achado por
 * recorte nenhum.
 */
describe('histórico de um período fechado', () => {
  const FECHAMENTO = {
    id: 'f1',
    caixaId: 7,
    de: new Date('2026-08-17T00:00:00Z'),
    ate: new Date('2026-08-18T23:59:59.999Z'),
  };

  it('completa do IXC o retrato que a conferência não guardou', async () => {
    const { service, prisma } = montarServico({
      fechamento: FECHAMENTO,
      lancamentos: [saidaEm(5001, 45, new Date('2026-08-17T10:00:00Z'))],
      conferencias: [
        {
          id: 'cf-sem-data',
          idLancamentoIxc: 5001,
          conferido: true,
          dataLancamento: null,
        },
      ],
    });

    const r = await service.historicoDoFechamento('f1');

    expect(r.completados).toBe(1);
    const [chamada] = prisma.conferenciaCaixa.update.mock.calls[0] as Array<{
      where: { id: string };
      data: Record<string, unknown>;
    }>;
    expect(chamada.where.id).toBe('cf-sem-data');
    expect(chamada.data).toMatchObject({
      dataLancamento: new Date('2026-08-17T10:00:00Z'),
      historico: 'saída 5001',
    });
  });

  /* O que já tem retrato não se relê: a segunda abertura não toca no IXC. */
  it('período já completo não lê o IXC', async () => {
    const { service, caixa } = montarServico({
      fechamento: FECHAMENTO,
      conferencias: [
        {
          id: 'cf-ok',
          idLancamentoIxc: 5002,
          conferido: true,
          dataLancamento: new Date('2026-08-17T00:00:00Z'),
        },
      ],
    });

    await service.historicoDoFechamento('f1');

    expect(caixa.listarLancamentos).not.toHaveBeenCalled();
  });

  it('fechamento que não existe é recusado', async () => {
    const { service } = montarServico({ fechamento: null });

    await expect(service.historicoDoFechamento('f9')).rejects.toThrow(
      /não existe/i,
    );
  });
});

/**
 * A despesa lançada por fora, direto no IXC.
 *
 * É o caso que a caixinha "Lançar a conta a pagar deste gasto" desmarcada
 * sempre disse servir — "use assim quando a despesa já tiver sido lançada no
 * IXC por outro caminho" — e que a conta da gaveta não sabia compensar: a
 * entrega descontava o dinheiro uma vez, a saída lançada lá descontava de
 * novo, e R$ 300,00 entregues viravam R$ 600,00 fora da gaveta.
 *
 * A data da saída no IXC é o que fecha isso: é ela que o `gastoPagoEm` guarda,
 * e é por ele que o período soma o gasto de volta.
 */
describe('acerto com a despesa já lançada no IXC', () => {
  const conta = {
    id: 'r1',
    caixaId: 7,
    pessoa: 'Jeferson',
    valor: 300,
    entregueEm: new Date(2026, 7, 20),
    baixadoEm: null,
    movimentos: [],
  };

  it('grava a data da saída de lá, que é o que compensa a gaveta', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 300,
      data: '2026-08-26',
      gastoJaNoIxcEm: '2026-08-26',
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.gastoPagoEm).toEqual(new Date(2026, 7, 26));
  });

  it('não guarda o número do título: desfazer não pode apagar o que não criou', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 300,
      gastoJaNoIxcEm: '2026-08-26',
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.idFnApagarIxc).toBeUndefined();
  });

  it('recusa as duas juntas: seria o mesmo gasto compensado duas vezes', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', {
        tipo: 'NOTA',
        valor: 300,
        gastoJaNoIxcEm: '2026-08-26',
        despesa: {
          idFornecedorIxc: 55,
          fornecedorNome: 'Auto Peças Silva',
          descricao: 'Correia',
        },
      }),
    ).rejects.toThrow(/duas vezes/i);
  });

  it('recusa em troco e reforço, que não saem no caixa do IXC', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', {
        tipo: 'TROCO',
        valor: 10,
        gastoJaNoIxcEm: '2026-08-26',
      }),
    ).rejects.toThrow(/troco e reforço/i);
  });

  it('recusa a saída anterior à entrega, que cairia num fechamento já assinado', async () => {
    const { service } = montarServico({ entrega: conta });

    await expect(
      service.lancarMovimento('r1', {
        tipo: 'NOTA',
        valor: 300,
        gastoJaNoIxcEm: '2026-08-19',
      }),
    ).rejects.toThrow(/antes de o dinheiro ter sido entregue/i);
  });

  it('aceita a saída no mesmo dia da entrega', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', {
      tipo: 'NOTA',
      valor: 300,
      gastoJaNoIxcEm: '2026-08-20',
    });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.gastoPagoEm).toEqual(new Date(2026, 7, 20));
  });

  it('sem a data, segue como antes: nada a compensar', async () => {
    const { service, prisma } = montarServico({ entrega: conta });

    await service.lancarMovimento('r1', { tipo: 'NOTA', valor: 300 });

    const [{ data }] = prisma.movimentoDaRua.create.mock.calls[0];
    expect(data.gastoPagoEm).toBeUndefined();
  });
});
