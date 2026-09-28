import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma, StatusContaPagar, TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';

/**
 * O "Férias" do Gerar Folha: quem foi programado para sair aparece — mesmo que
 * as férias só comecem daqui a semanas, para o pagamento poder sair adiantado
 * —, fica marcado como pago quando o pagamento existe, e some quando volta.
 *
 * O que este arquivo protege é que a lista não pague duas vezes: nem pelas
 * mesmas férias pedidas de novo, nem por cima do pagamento que saiu pelo
 * quinto dia, antes de a lista existir.
 */

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** 28/09/2026 à tarde em Brasília. */
const AGORA = new Date('2026-09-28T18:00:00.000Z');

const CONFIG = {
  contaContabilSalario: 2420,
  contaContabilAdiantamento: 2662,
  contaContabilBonus: 13916,
  contaContabilFerias: 3100,
  percentualAdiantamento: 40,
  obsSalarioTemplate: 'saldo salarial referente ao mês {competencia}',
  obsAdiantamentoTemplate: 'adiantamento',
  obsBonusTemplate: 'bônus referente ao mês {competencia}',
  obsFeriasTemplate: 'férias referentes ao mês {competencia}',
};

const FUNCIONARIO = {
  id: 'f1',
  nome: 'Pessoa Um',
  apelido: 'Um',
  salarioBase: 2000,
  carteiraAssinada: true,
  valorAReceberFolha: null,
  recebeAdiantamento: true,
  valorAdiantamento: null,
  valorPorVenda: null,
  lancamentos: [],
  variaveisMes: [],
};

interface Marcada {
  id: string;
  codigo: string;
  nome: string;
  funcionarioId: string | null;
  inicio: Date;
  fim: Date;
  dias: number;
}

interface Conta {
  id: string;
  tipo: TipoLancamento;
  funcionarioId: string | null;
  competencia: string | null;
  feriasMarcadaId: string | null;
  status: StatusContaPagar;
}

function montar(opcoes: { marcadas: Marcada[]; contas?: Conta[] }) {
  const contas = (opcoes.contas ?? []).map((c) => ({
    valor: new Prisma.Decimal(2200),
    pagoEm: c.status === StatusContaPagar.PAGO ? dia('2026-09-20') : null,
    idFnApagarIxc: 4242,
    createdAt: dia('2026-09-15'),
    ...c,
  }));

  const prisma = {
    funcionario: { findMany: jest.fn().mockResolvedValue([FUNCIONARIO]) },
    feriasMarcada: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            fim?: { gte: Date };
            inicio?: { lte: Date };
            funcionarioId?: unknown;
          };
        }) => {
          // A pergunta da folha do mês: quem tem férias encostando no mês.
          if (where.funcionarioId) {
            return opcoes.marcadas.filter(
              (m) =>
                m.funcionarioId &&
                m.inicio <= where.inicio!.lte &&
                m.fim >= where.fim!.gte,
            );
          }
          return opcoes.marcadas
            .filter((m) => m.fim >= where.fim!.gte)
            .map((m) => ({
              ...m,
              funcionario:
                m.funcionarioId === 'f1'
                  ? { id: 'f1', nome: FUNCIONARIO.nome, apelido: 'Um' }
                  : null,
            }));
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          opcoes.marcadas.find((m) => m.id === where.id) ?? null,
      ),
    },
    contaPagar: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            tipo: TipoLancamento;
            competencia?: string;
            feriasMarcadaId?: { in: string[] } | null;
            status?: { notIn: StatusContaPagar[] };
          };
        }) =>
          contas.filter((c) => {
            if (c.tipo !== where.tipo) return false;
            if (where.status && where.status.notIn.includes(c.status)) {
              return false;
            }
            if (where.feriasMarcadaId === null) return c.feriasMarcadaId === null;
            if (where.feriasMarcadaId) {
              return where.feriasMarcadaId.in.includes(c.feriasMarcadaId ?? '');
            }
            return c.competencia === where.competencia;
          }),
      ),
      create: jest.fn(),
    },
  } as never;

  const service = new ContasPagarService(
    prisma,
    {} as never,
    { obter: jest.fn().mockResolvedValue(CONFIG) } as never,
    {} as never,
    { acertosDaCompetencia: jest.fn().mockResolvedValue(new Map()) } as never,
    {
      descontoDaCompetencia: jest.fn().mockResolvedValue(new Map()),
    } as never,
  );
  return { service, prisma: prisma as unknown as { contaPagar: { create: jest.Mock } } };
}

const programada: Marcada = {
  id: 'm1',
  codigo: '12',
  nome: 'PESSOA UM',
  funcionarioId: 'f1',
  inicio: dia('2026-10-19'),
  fim: dia('2026-11-17'),
  dias: 30,
};

describe('a lista de férias do Gerar Folha', () => {
  it('quem foi programado aparece já, para o pagamento sair adiantado', async () => {
    const { service } = montar({ marcadas: [programada] });

    const [f] = await service.feriasAPagar(AGORA);

    expect(f).toMatchObject({
      feriasId: 'm1',
      nome: 'Pessoa Um',
      funcionarioId: 'f1',
      emCurso: false,
      diasParaComecar: 21,
      // O mesmo que o quinto dia de outubro usaria: sai em novembro.
      competencia: '2026-11',
      contaContabil: 3100,
      observacao: 'férias referentes ao mês 10/2026',
      pagamento: null,
    });
    expect(f.valorSugerido).toBe(2000);
  });

  it('quem já voltou some da lista', async () => {
    const { service } = montar({
      marcadas: [
        { ...programada, id: 'voltou', inicio: dia('2026-08-20'), fim: dia('2026-09-18') },
        programada,
      ],
    });

    const lista = await service.feriasAPagar(AGORA);

    expect(lista.map((f) => f.feriasId)).toEqual(['m1']);
  });

  it('o dia da volta ainda é de férias, mesmo à noite', async () => {
    const { service } = montar({
      marcadas: [{ ...programada, inicio: dia('2026-08-30'), fim: dia('2026-09-28') }],
    });

    // 22h de 28/09 em Brasília já é 29/09 no servidor.
    const lista = await service.feriasAPagar(new Date('2026-09-29T01:00:00.000Z'));

    expect(lista).toHaveLength(1);
    expect(lista[0].emCurso).toBe(true);
  });

  it('pagas pela lista, ficam marcadas como pagas', async () => {
    const { service } = montar({
      marcadas: [programada],
      contas: [
        {
          id: 'c1',
          tipo: TipoLancamento.FERIAS,
          funcionarioId: 'f1',
          competencia: '2026-11',
          feriasMarcadaId: 'm1',
          status: StatusContaPagar.PAGO,
        },
      ],
    });

    const [f] = await service.feriasAPagar(AGORA);

    expect(f.pagamento).toMatchObject({
      contaId: 'c1',
      situacao: 'PAGO',
      valor: 2200,
    });
  });

  it('pagas pelo quinto dia, antes da lista existir, também contam', async () => {
    const { service } = montar({
      marcadas: [programada],
      contas: [
        {
          id: 'antiga',
          tipo: TipoLancamento.FERIAS,
          funcionarioId: 'f1',
          competencia: '2026-11',
          feriasMarcadaId: null,
          status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
        },
      ],
    });

    const [f] = await service.feriasAPagar(AGORA);

    expect(f.pagamento).toMatchObject({ contaId: 'antiga', situacao: 'PENDENTE' });
  });

  it('pagamento cancelado não conta: as férias voltam a pedir pagamento', async () => {
    const { service } = montar({
      marcadas: [programada],
      contas: [
        {
          id: 'c1',
          tipo: TipoLancamento.FERIAS,
          funcionarioId: 'f1',
          competencia: '2026-11',
          feriasMarcadaId: 'm1',
          status: StatusContaPagar.CANCELADO,
        },
      ],
    });

    const [f] = await service.feriasAPagar(AGORA);

    expect(f.pagamento).toBeNull();
  });

  it('sem cadastro ligado, aparece sem valor — não dá para pagar daqui', async () => {
    const { service } = montar({
      marcadas: [{ ...programada, funcionarioId: null, nome: 'SEM CADASTRO' }],
    });

    const [f] = await service.feriasAPagar(AGORA);

    expect(f).toMatchObject({
      nome: 'SEM CADASTRO',
      funcionarioId: null,
      valorSugerido: null,
    });
  });
});

describe('gerar o pagamento das férias', () => {
  const item = {
    funcionarioId: 'f1',
    tipo: TipoLancamento.FERIAS,
    valor: 2200,
    competencia: '2026-11',
    feriasMarcadaId: 'm1',
  };

  it('férias já pagas não se pagam de novo', async () => {
    const { service, prisma } = montar({
      marcadas: [programada],
      contas: [
        {
          id: 'c1',
          tipo: TipoLancamento.FERIAS,
          funcionarioId: 'f1',
          competencia: '2026-11',
          feriasMarcadaId: 'm1',
          status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
        },
      ],
    });

    await expect(service.criar({ itens: [item] })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.contaPagar.create).not.toHaveBeenCalled();
  });

  it('nem por cima do pagamento que saiu pelo quinto dia', async () => {
    const { service, prisma } = montar({
      marcadas: [programada],
      contas: [
        {
          id: 'antiga',
          tipo: TipoLancamento.FERIAS,
          funcionarioId: 'f1',
          competencia: '2026-11',
          feriasMarcadaId: null,
          status: StatusContaPagar.PAGO,
        },
      ],
    });

    await expect(service.criar({ itens: [item] })).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.contaPagar.create).not.toHaveBeenCalled();
  });

  it('só o pagamento de férias se liga a férias', async () => {
    const { service } = montar({ marcadas: [programada] });

    await expect(
      service.criar({ itens: [{ ...item, tipo: TipoLancamento.SALARIO }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('as férias de uma pessoa não pagam outra', async () => {
    const { service } = montar({ marcadas: [programada] });

    await expect(
      service.criar({ itens: [{ ...item, funcionarioId: 'outra' }] }),
    ).rejects.toThrow(/são de PESSOA UM/);
  });
});

describe('o quinto dia e as férias pagas adiantado', () => {
  const pagaPelaLista: Conta = {
    id: 'c1',
    tipo: TipoLancamento.FERIAS,
    funcionarioId: 'f1',
    // Gerada em setembro, pela lista — não tem a competência do mês trabalhado.
    competencia: '2026-10',
    feriasMarcadaId: 'm1',
    status: StatusContaPagar.PAGO,
  };

  it('no mês que as férias tomam, o salário não se paga como férias de novo', async () => {
    const { service } = montar({ marcadas: [programada], contas: [pagaPelaLista] });

    // Outubro trabalhado, pago em novembro: as férias pegam o dia 25/10.
    const [pessoa] = await service.prepararFolha({
      competencia: '2026-11',
      mesTrabalhado: '2026-10',
      incluirAdiantamento: false,
    });

    expect(pessoa.ferias.jaGerado).toMatchObject({ situacao: 'PAGO' });
    expect(pessoa.ferias.deFerias).toBe(true);
  });

  it('no mês da volta, que elas não tomam, o salário segue normal', async () => {
    const { service } = montar({ marcadas: [programada], contas: [pagaPelaLista] });

    // Novembro: as férias acabam dia 17, antes do dia 25.
    const [pessoa] = await service.prepararFolha({
      competencia: '2026-12',
      mesTrabalhado: '2026-11',
      incluirAdiantamento: false,
    });

    expect(pessoa.ferias.jaGerado).toBeNull();
    expect(pessoa.ferias.deFerias).toBe(false);
  });
});
