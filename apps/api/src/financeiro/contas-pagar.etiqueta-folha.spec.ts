import {
  OrigemLancamento,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * Todo pagamento da folha nasce etiquetado.
 *
 * A folha gera dezenas de contas por mês e nenhuma passa pela tela de
 * classificar — quem gera a folha não abre conta por conta para escolher
 * categoria. O resultado era o maior gasto da empresa ficando fora de todo
 * gráfico por categoria: a etiqueta "Salários" mostrava quatro contas quando
 * deveria mostrar centenas.
 *
 * O que este arquivo protege:
 *
 *  - salário, férias, adiantamento e bônus saem etiquetados sozinhos;
 *  - diária e avulso **não**: a diária é de diarista, e o avulso já escolhe a
 *    própria categoria na tela em que é lançado — carimbar "Salários" neles
 *    trocaria uma informação melhor por uma pior;
 *  - etiqueta escolhida à mão não é sobrescrita;
 *  - e nada disso pode derrubar o lançamento: a conta já está no IXC quando a
 *    etiqueta é gravada, e uma etiqueta que não colou se resolve em dois
 *    cliques na tela de contas em aberto.
 */

const semFaltas = {
  descontoDaCompetencia: jest.fn().mockResolvedValue(new Map<string, number>()),
} as never;

const CFG = {
  tipoPagamentoPadrao: 'Pix',
  contaPagamentoId: 18,
  filialId: 1,
  categoriaFolhaId: 'cat-salarios',
  pixCampoTipoChave: 'tipo_chave_pix_apagar',
  pixCodigosTipoChave: 'Celular=C',
  pixCampoTipoChaveAprendido: '',
  pixCodigosTipoChaveAprendidos: '',
};

function montarServico(
  opts: {
    tipo?: TipoLancamento;
    origem?: OrigemLancamento;
    categoriaFolhaId?: string | null;
    /** A categoria achada pelo nome, quando a configuração está vazia. */
    achadaPeloNome?: { id: string } | null;
    upsertFalha?: boolean;
  } = {},
) {
  const cfg = {
    ...CFG,
    categoriaFolhaId:
      'categoriaFolhaId' in opts ? opts.categoriaFolhaId : CFG.categoriaFolhaId,
  };

  const upsert = opts.upsertFalha
    ? jest.fn().mockRejectedValue(new Error('banco fora'))
    : jest.fn().mockResolvedValue({});

  const prisma = {
    contaPagar: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        status: StatusContaPagar.RASCUNHO,
        tipo: opts.tipo ?? TipoLancamento.SALARIO,
        origem: opts.origem ?? OrigemLancamento.FOLHA,
        valor: 3200,
        funcionarioId: 'f1',
        beneficiarioAvulsoId: null,
        diaristaId: null,
        contaPagamento: 18,
        contaContabil: 2420,
        tipoPagamentoIxc: null,
        filialId: 1,
        dataEmissao: new Date(Date.UTC(2026, 7, 5)),
        dataVencimento: new Date(Date.UTC(2026, 7, 5)),
        observacao: 'saldo salarial referente ao mês 08/2026',
        chavePix: '+5599992300993',
        tipoChavePix: 'Celular',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: object }) => ({
        id: 'c1',
        tipo: opts.tipo ?? TipoLancamento.SALARIO,
        origem: opts.origem ?? OrigemLancamento.FOLHA,
        ...data,
      })),
    },
    categoriaDespesa: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'achadaPeloNome' in opts ? opts.achadaPeloNome : { id: 'cat-achada' },
        ),
    },
    classificacaoConta: { upsert },
  } as never;

  const ixc = {
    list: jest.fn().mockResolvedValue({ registros: [] }),
    create: jest.fn().mockResolvedValue({ id: 4242 }),
  } as never;

  const definirCategoriaDaFolha = jest.fn().mockResolvedValue(cfg);
  const config = {
    obter: jest.fn().mockResolvedValue(cfg),
    guardarAprendizadoPix: jest.fn().mockResolvedValue(cfg),
    definirCategoriaDaFolha,
  } as never;

  const fornecedores = {
    garantirParaFuncionario: jest.fn().mockResolvedValue(55),
    garantirParaDiarista: jest.fn().mockResolvedValue(55),
    garantirParaAvulso: jest.fn().mockResolvedValue(55),
  } as never;
  const vales = { estornarBaixa: jest.fn() } as never;

  return {
    service: new ContasPagarService(
      prisma,
      ixc,
      config,
      fornecedores,
      vales,
      semFaltas,
    ),
    upsert,
    definirCategoriaDaFolha,
  };
}

describe('a etiqueta da folha', () => {
  it('salário sai do forno já classificado', async () => {
    const { service, upsert } = montarServico();

    await service.enviarIxc('c1');

    expect(upsert).toHaveBeenCalledWith({
      where: { idFnApagar: 4242 },
      create: { idFnApagar: 4242, categoriaId: 'cat-salarios' },
      // Vazio: já tendo etiqueta, ela fica como está.
      update: {},
    });
  });

  it.each([
    TipoLancamento.FERIAS,
    TipoLancamento.ADIANTAMENTO,
    TipoLancamento.BONUS,
  ])('%s também é folha', async (tipo) => {
    const { service, upsert } = montarServico({ tipo });

    await service.enviarIxc('c1');

    expect(upsert).toHaveBeenCalled();
  });

  it.each([TipoLancamento.DIARIA, TipoLancamento.AVULSO])(
    '%s fica de fora — a categoria dela é outra',
    async (tipo) => {
      const { service, upsert } = montarServico({ tipo });

      await service.enviarIxc('c1');

      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('despesa lançada no contas a pagar não é folha', async () => {
    const { service, upsert } = montarServico({
      tipo: TipoLancamento.DESPESA,
      origem: OrigemLancamento.CONTAS_PAGAR,
    });

    await service.enviarIxc('c1');

    expect(upsert).not.toHaveBeenCalled();
  });

  it('sem categoria na configuração, acha pelo nome e guarda o id', async () => {
    const { service, upsert, definirCategoriaDaFolha } = montarServico({
      categoriaFolhaId: null,
    });

    await service.enviarIxc('c1');

    expect(definirCategoriaDaFolha).toHaveBeenCalledWith('cat-achada');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { idFnApagar: 4242, categoriaId: 'cat-achada' },
      }),
    );
  });

  it('não achando categoria nenhuma, o lançamento segue sem etiqueta', async () => {
    const { service, upsert } = montarServico({
      categoriaFolhaId: null,
      achadaPeloNome: null,
    });

    const conta = await service.enviarIxc('c1');

    expect(upsert).not.toHaveBeenCalled();
    expect(conta.idFnApagarIxc).toBe(4242);
  });

  it('etiqueta que falha não derruba o pagamento', async () => {
    const { service } = montarServico({ upsertFalha: true });

    // A conta já está no IXC quando a etiqueta é gravada: recusar o
    // lançamento aqui seria desfazer o que já aconteceu lá.
    const conta = await service.enviarIxc('c1');

    expect(conta.idFnApagarIxc).toBe(4242);
    expect(conta.status).toBe(StatusContaPagar.AGUARDANDO_APROVACAO);
  });
});
