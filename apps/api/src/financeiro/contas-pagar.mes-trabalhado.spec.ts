import { TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * De que mês a folha lê o que foi lançado na ficha da pessoa.
 *
 * Um mês de trabalho é pago em dois pedaços: o adiantamento no dia 25 do
 * próprio mês, e o saldo no quinto dia do mês seguinte. Por isso o avulso e a
 * venda são guardados pelo **mês trabalhado** — o mês do pagamento obrigaria
 * quem lança a saber em qual das duas parcelas o valor ia cair, e era o que
 * fazia a ficha pedir um mês nos lançamentos e outro, ao lado, nas vendas.
 *
 * As duas rodadas do mesmo mês trabalhado leem a mesma lista, e isso não paga
 * em dobro: elas geram parcelas diferentes (o dia 25 só o adiantamento; o
 * quinto dia o salário e o bônus). Quem garante isso é a tela, que manda
 * `incluirAdiantamento` numa e `incluirSalario`/`incluirBonus` na outra.
 */

const semFaltas = {
  descontoDaCompetencia: jest.fn().mockResolvedValue(new Map<string, number>()),
} as never;

/** O filtro com que a folha pergunta pela ficha de cada um. */
interface ConsultaDeFuncionarios {
  include?: {
    lancamentos?: { where?: { OR?: Array<{ competencia?: string | null }> } };
    variaveisMes?: { where?: { competencia?: string } };
  };
}

function montarServico() {
  const prisma = {
    funcionario: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          nome: 'Henrico Santos',
          salarioBase: 2000,
          carteiraAssinada: false,
          valorAReceberFolha: null,
          recebeAdiantamento: true,
          valorAdiantamento: null,
          valorPorVenda: null,
          lancamentos: [],
          variaveisMes: [],
        },
      ]),
    },
    contaPagar: { findMany: jest.fn().mockResolvedValue([]) },
    feriasMarcada: { findMany: jest.fn().mockResolvedValue([]) },
  } as never;

  const config = {
    obter: jest.fn().mockResolvedValue({
      contaContabilSalario: 2420,
      contaContabilAdiantamento: 2662,
      contaContabilBonus: 13916,
      contaContabilFerias: 2420,
      percentualAdiantamento: 40,
      obsSalarioTemplate: 'saldo salarial referente ao mês {competencia}',
      obsAdiantamentoTemplate: 'adiantamento',
      obsBonusTemplate: 'bônus referente ao mês {competencia}',
      obsFeriasTemplate: 'férias referentes ao mês {competencia}',
    }),
  } as never;

  const vales = {
    acertosDaCompetencia: jest.fn().mockResolvedValue(new Map()),
  } as never;

  const service = new ContasPagarService(
    prisma,
    {} as never, // ixc
    config,
    {} as never, // fornecedores
    vales,
    semFaltas,
  );
  return { service, prisma: prisma as unknown as { funcionario: { findMany: jest.Mock } } };
}

/** O mês que a consulta pediu para os avulsos daquela chamada. */
function mesDosAvulsos(findMany: jest.Mock, chamada = 0): string | undefined {
  const [args] = findMany.mock.calls[chamada] as ConsultaDeFuncionarios[];
  return args.include?.lancamentos?.where?.OR?.find(
    (o) => typeof o.competencia === 'string',
  )?.competencia as string | undefined;
}

function mesDasVendas(findMany: jest.Mock, chamada = 0): string | undefined {
  const [args] = findMany.mock.calls[chamada] as ConsultaDeFuncionarios[];
  return args.include?.variaveisMes?.where?.competencia;
}

describe('a folha lê o avulso pelo mês trabalhado', () => {
  /*
   * O defeito: a folha do quinto dia de setembro (trabalho de agosto) procurava
   * avulso de "2026-09". Quem lançava um bônus pensando no mês trabalhado
   * escrevia agosto, e ele nunca era pago; quem escrevia setembro acertava por
   * acidente, sem saber por quê.
   */
  it('no quinto dia, procura o mês trabalhado e não o do pagamento', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirAdiantamento: false,
      incluirSalario: true,
      incluirBonus: true,
    } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany)).toBe('2026-08');
  });

  /* O dia 25 é pago dentro do próprio mês trabalhado: os dois coincidem. */
  it('no dia 25, o mês trabalhado é a própria competência', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({
      competencia: '2026-08',
      mesTrabalhado: '2026-08',
      incluirAdiantamento: true,
      incluirSalario: false,
      incluirBonus: false,
    } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany)).toBe('2026-08');
  });

  /*
   * O que a mudança existe para conseguir: as duas parcelas do mesmo mês
   * trabalhado leem a mesma lista. Antes elas liam meses diferentes, e um
   * lançamento só podia acertar uma das duas.
   */
  it('as duas parcelas do mesmo mês trabalhado leem a mesma lista', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({
      competencia: '2026-08',
      mesTrabalhado: '2026-08',
      incluirAdiantamento: true,
      incluirSalario: false,
    } as never);
    await service.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirSalario: true,
    } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany, 0)).toBe('2026-08');
    expect(mesDosAvulsos(prisma.funcionario.findMany, 1)).toBe('2026-08');
  });

  /* O avulso e a venda passam a pedir o mesmo mês — que é o ponto de tudo. */
  it('avulso e venda pedem o mesmo mês', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirSalario: true,
    } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany)).toBe(
      mesDasVendas(prisma.funcionario.findMany),
    );
  });

  /* O fixo não tem mês, e continua entrando em toda folha. */
  it('o fixo continua vindo junto, sem mês', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirSalario: true,
    } as never);

    const [args] = prisma.funcionario.findMany.mock
      .calls[0] as ConsultaDeFuncionarios[];
    expect(args.include?.lancamentos?.where?.OR).toContainEqual({
      competencia: null,
    });
  });
});

/* Sem `mesTrabalhado` escrito, ele é o mês anterior ao do pagamento. */
describe('quando a tela não manda o mês trabalhado', () => {
  it('cai no mês anterior à competência', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({ competencia: '2026-09' } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany)).toBe('2026-08');
  });

  it('a virada do ano volta para dezembro', async () => {
    const { service, prisma } = montarServico();

    await service.prepararFolha({ competencia: '2027-01' } as never);

    expect(mesDosAvulsos(prisma.funcionario.findMany)).toBe('2026-12');
  });
});

/* O tipo existe para o spec falhar se a assinatura mudar. */
export type _Guarda = TipoLancamento;
