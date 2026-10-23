import { StatusContaPagar, TipoLancamento } from '@prisma/client';
import {
  ContasPagarService,
  limitesDoMes,
  montarFeriasNaFolha,
  pegaODia25,
} from './contas-pagar.service';
import { baseParaFerias, type ComposicaoSalario } from './folha.calc';

/* A folha sem falta nenhuma: cada arquivo destes prova outra coisa. */
const semFaltas = {
  descontoDaCompetencia: jest.fn().mockResolvedValue(new Map<string, number>()),
} as never;



/**
 * Quem entra de férias não recebe o salário do mês: recebe o que a
 * contabilidade apurou das férias. E não recebe o adiantamento do dia 25 —
 * adiantamento é sobre o mês que se está trabalhando, e quem está de férias não
 * está.
 *
 * O que a folha precisa acertar é *quando* ela sabe disso. As férias são pagas
 * na folha do quinto dia, que fala do mês seguinte ao trabalhado (agosto sai em
 * setembro); o adiantamento é pago dentro do próprio mês trabalhado. Os dois
 * pagamentos só se reconhecem pelo mês **trabalhado**, e é por ele que tudo
 * aqui é procurado.
 */

const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const COMPOSICAO: ComposicaoSalario = {
  faltas: 0,
  salarioBase: 2000,
  usouValorAReceber: false,
  vendas: 3,
  valorPorVenda: 50,
  comissao: 150,
  horasExtras: 100,
  descontos: 50,
  vales: 200,
  valesCredito: 0,
  adiantamento: 800,
  adiantamentoDescontado: 800,
  saldo: 1200,
};

describe('baseParaFerias', () => {
  it('devolve o que a pessoa ganha no mês, sem o vale e sem o dia 25', () => {
    // 2000 + 150 (comissão) + 100 (hora extra) − 50 (desconto fixo) = 2200.
    // Vale e dia 25 ficam de fora: nenhum dos dois é abatido de férias.
    expect(baseParaFerias(COMPOSICAO)).toBe(2200);
  });

  it('acerto a favor também fica de fora — ele não é pago nas férias', () => {
    const comCredito: ComposicaoSalario = {
      ...COMPOSICAO,
      valesCredito: 300,
      saldo: 1500,
    };
    expect(baseParaFerias(comCredito)).toBe(2200);
  });
});

describe('pegaODia25', () => {
  it('férias que cobrem o dia 25 tiram o adiantamento', () => {
    const ferias = { inicio: dia('2026-08-20'), fim: dia('2026-09-18') };
    expect(pegaODia25(ferias, '2026-08')).toBe(true);
  });

  it('férias que começam depois do dia 25 não tiram: trabalhou até lá', () => {
    const ferias = { inicio: dia('2026-08-26'), fim: dia('2026-09-24') };
    expect(pegaODia25(ferias, '2026-08')).toBe(false);
  });

  it('o próprio dia 25 conta, nas duas pontas', () => {
    expect(
      pegaODia25(
        { inicio: dia('2026-08-25'), fim: dia('2026-09-23') },
        '2026-08',
      ),
    ).toBe(true);
    expect(
      pegaODia25(
        { inicio: dia('2026-07-27'), fim: dia('2026-08-25') },
        '2026-08',
      ),
    ).toBe(true);
  });

  it('em setembro, as mesmas férias de agosto não valem', () => {
    const ferias = { inicio: dia('2026-08-01'), fim: dia('2026-08-30') };
    expect(pegaODia25(ferias, '2026-09')).toBe(false);
  });
});

describe('limitesDoMes', () => {
  it('vai do primeiro ao último dia, com o último dia inteiro', () => {
    const { primeiroDia, ultimoDia } = limitesDoMes('2026-02');
    expect(primeiroDia.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    // Fevereiro de 2026 tem 28 dias, e quem volta no dia 28 esteve de férias
    // no dia 28.
    expect(ultimoDia.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });
});

describe('montarFeriasNaFolha', () => {
  const base = {
    jaGerado: null,
    mesTrabalhado: '2026-08',
    composicao: COMPOSICAO,
    contaContabil: 2420,
    observacao: 'férias referentes ao mês 08/2026',
  };

  it('sem férias registradas nem pagamento, a pessoa não está de férias', () => {
    const f = montarFeriasNaFolha({ ...base, marcada: null });
    expect(f).toMatchObject({ periodo: null, noDia25: false, deFerias: false });
    // O valor sugerido continua vindo: a marcação à mão precisa dele.
    expect(f.valorSugerido).toBe(2200);
  });

  it('férias registradas em cima do dia 25: de férias', () => {
    const f = montarFeriasNaFolha({
      ...base,
      marcada: { inicio: dia('2026-08-17'), fim: dia('2026-09-15'), dias: 30 },
    });
    expect(f.noDia25).toBe(true);
    expect(f.deFerias).toBe(true);
    expect(f.periodo).toEqual({
      inicio: dia('2026-08-17'),
      fim: dia('2026-09-15'),
      dias: 30,
    });
  });

  it('quem voltou das férias antes do dia 25 vem sem o dia 25, mas não de férias', () => {
    const f = montarFeriasNaFolha({
      ...base,
      marcada: { inicio: dia('2026-07-20'), fim: dia('2026-08-18'), dias: 30 },
    });
    expect(f.noDia25).toBe(false);
    expect(f.voltouAntesDo25).toBe(true);
    expect(f.semDia25).toBe(true);
    // O salário do quinto dia não vira pagamento de férias por isso.
    expect(f.deFerias).toBe(false);
  });

  it('férias que começam depois do dia 25 aparecem, mas não tiram o adiantamento', () => {
    const f = montarFeriasNaFolha({
      ...base,
      marcada: { inicio: dia('2026-08-28'), fim: dia('2026-09-26'), dias: 30 },
    });
    // O período vem preenchido para a tela avisar…
    expect(f.periodo).not.toBeNull();
    // …mas até o dia 25 a pessoa trabalhou, e o adiantamento é devido.
    expect(f.noDia25).toBe(false);
    expect(f.deFerias).toBe(false);
  });

  it('pagamento de férias já gerado basta: nada mais precisa estar registrado', () => {
    const f = montarFeriasNaFolha({
      ...base,
      marcada: null,
      jaGerado: {
        situacao: 'PAGO',
        status: StatusContaPagar.PAGO,
        pagoEm: dia('2026-08-17'),
      },
    });
    expect(f.deFerias).toBe(true);
    expect(f.noDia25).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A prévia inteira: é aqui que o mês trabalhado prova o seu valor.
// ---------------------------------------------------------------------------

const FUNCIONARIO = {
  id: 'f1',
  nome: 'Cainan Lucas Lima Santos',
  apelido: null,
  salarioBase: 2000,
  carteiraAssinada: true,
  valorAReceberFolha: null,
  recebeAdiantamento: true,
  valorAdiantamento: null,
  valorPorVenda: null,
  lancamentos: [],
  variaveisMes: [],
};

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

/** Contas a pagar que já existem, e as férias que a tela de Férias registrou. */
function montarServico(opcoes: {
  contas?: Array<{
    tipo: TipoLancamento;
    competencia: string;
    status: StatusContaPagar;
  }>;
  ferias?: Array<{ inicio: Date; fim: Date; dias: number }>;
}) {
  const contas = opcoes.contas ?? [];
  const prisma = {
    funcionario: { findMany: jest.fn().mockResolvedValue([FUNCIONARIO]) },
    contaPagar: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { tipo: TipoLancamento; competencia: string };
        }) =>
          contas
            .filter(
              (c) =>
                c.tipo === where.tipo && c.competencia === where.competencia,
            )
            .map((c) => ({
              funcionarioId: 'f1',
              status: c.status,
              pagoEm: null,
            })),
      ),
    },
    feriasMarcada: {
      findMany: jest.fn(async () =>
        (opcoes.ferias ?? []).map((f) => ({ ...f, funcionarioId: 'f1' })),
      ),
    },
  } as any;

  const config = { obter: jest.fn().mockResolvedValue(CONFIG) } as any;
  const vales = {
    acertosDaCompetencia: jest.fn().mockResolvedValue(new Map()),
  } as any;

  return new ContasPagarService(
    prisma,
    {} as any,
    config,
    {} as any,
    vales,
    semFaltas,
  );
}

describe('prepararFolha: férias', () => {
  it('a folha do quinto dia traz a conta contábil e a observação de férias', async () => {
    const service = montarServico({});
    const [pessoa] = await service.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirAdiantamento: false,
    });

    expect(pessoa.ferias.contaContabil).toBe(3100);
    expect(pessoa.ferias.observacao).toBe('férias referentes ao mês 08/2026');
  });

  it('férias registradas sobre o dia 25 chegam nas duas folhas do mês', async () => {
    const ferias = [
      { inicio: dia('2026-08-17'), fim: dia('2026-09-15'), dias: 30 },
    ];

    // Folha do quinto dia: competência 09, mês trabalhado 08.
    const quintoDia = montarServico({ ferias });
    const [noQuintoDia] = await quintoDia.prepararFolha({
      competencia: '2026-09',
      mesTrabalhado: '2026-08',
      incluirAdiantamento: false,
    });
    expect(noQuintoDia.ferias.deFerias).toBe(true);

    // Folha do dia 25: competência e mês trabalhado são o mesmo agosto. Sem o
    // mês trabalhado por escrito, esta consulta cairia em julho.
    const dia25 = montarServico({ ferias });
    const [noDia25] = await dia25.prepararFolha({
      competencia: '2026-08',
      mesTrabalhado: '2026-08',
      incluirSalario: false,
      incluirBonus: false,
    });
    expect(noDia25.ferias.deFerias).toBe(true);
    expect(noDia25.ferias.noDia25).toBe(true);
  });

  it('o pagamento de férias de agosto é visto pela folha do dia 25 de agosto', async () => {
    // As férias saem na folha do quinto dia, que é do mês seguinte ao
    // trabalhado: pagar as férias de agosto grava competência 09. O dia 25 de
    // agosto precisa enxergar essa conta para não adiantar salário a quem já
    // recebeu férias.
    const service = montarServico({
      contas: [
        {
          tipo: TipoLancamento.FERIAS,
          competencia: '2026-09',
          status: StatusContaPagar.PAGO,
        },
      ],
    });

    const [pessoa] = await service.prepararFolha({
      competencia: '2026-08',
      mesTrabalhado: '2026-08',
      incluirSalario: false,
      incluirBonus: false,
    });

    expect(pessoa.ferias.jaGerado).toMatchObject({ situacao: 'PAGO' });
    expect(pessoa.ferias.deFerias).toBe(true);
    // O adiantamento continua sendo oferecido — quem decide é a tela, que o
    // traz desmarcado. A folha não some com o lançamento.
    expect(pessoa.lancamentos.map((l) => l.tipo)).toEqual([
      TipoLancamento.ADIANTAMENTO,
    ]);
  });

  it('sem mês trabalhado por escrito, vale o anterior à competência', async () => {
    const service = montarServico({
      ferias: [{ inicio: dia('2026-08-01'), fim: dia('2026-08-30'), dias: 30 }],
    });

    // Competência 09 sem mês trabalhado: a API deduz agosto, que é como a
    // folha do quinto dia sempre funcionou.
    const [pessoa] = await service.prepararFolha({
      competencia: '2026-09',
      incluirAdiantamento: false,
    });
    expect(pessoa.ferias.deFerias).toBe(true);
  });

  it('férias de agosto não pegam o dia 25 de setembro', async () => {
    const service = montarServico({
      ferias: [{ inicio: dia('2026-08-01'), fim: dia('2026-08-30'), dias: 30 }],
    });
    // A consulta ao banco é por período; aqui o que se cobra é o mês que a
    // folha pediu — setembro, onde essas férias não pegam o dia 25.
    const [pessoa] = await service.prepararFolha({
      competencia: '2026-10',
      mesTrabalhado: '2026-09',
      incluirAdiantamento: false,
    });
    expect(pessoa.ferias.noDia25).toBe(false);
  });
});
