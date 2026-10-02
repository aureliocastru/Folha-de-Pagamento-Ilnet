import { TipoLancamento } from '@prisma/client';
import { ContasPagarService } from './contas-pagar.service';
import type { FaltasDoMes } from './faltas.calc';

/**
 * A prévia abre cada total em itens: o bônus e o desconto com a descrição de
 * quem lançou, e as faltas dia a dia. A soma dos itens tem de fechar com o
 * total da composição — é o que deixa a tela mostrar a conta sem número solto.
 */
const FALTAS: FaltasDoMes = {
  dias: 2,
  semanasComFalta: 1,
  valorDoDia: 50,
  valorDosDias: 100,
  valorDoDsr: 50,
  total: 150,
  datas: ['2026-08-04', '2026-08-05'],
};

const PESSOA = {
  salarioBase: 1500,
  carteiraAssinada: false,
  valorAReceberFolha: null,
  recebeAdiantamento: false,
  valorAdiantamento: null,
  valorPorVenda: null,
  variaveisMes: [],
};

function montarServico(
  funcionarios: unknown[],
  faltas = new Map<string, FaltasDoMes>(),
) {
  const prisma = {
    funcionario: { findMany: jest.fn().mockResolvedValue(funcionarios) },
    contaPagar: { findMany: jest.fn().mockResolvedValue([]) },
    feriasMarcada: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
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
  } as any;
  const vales = {
    acertosDaCompetencia: jest.fn().mockResolvedValue(new Map()),
  } as any;
  const faltasService = {
    descontoDaCompetencia: jest.fn().mockResolvedValue(faltas),
  } as any;

  return new ContasPagarService(
    prisma,
    {} as any,
    config,
    {} as any,
    vales,
    faltasService,
  );
}

describe('prepararFolha: o detalhe de cada pagamento', () => {
  it('traz cada bônus e cada desconto com a descrição anotada', async () => {
    const service = montarServico([
      {
        ...PESSOA,
        id: 'f1',
        nome: 'Ana Teste',
        lancamentos: [
          {
            tipo: TipoLancamento.BONUS,
            descricao: 'bônus técnico',
            valor: 300,
            competencia: null,
          },
          {
            tipo: TipoLancamento.BONUS,
            descricao: 'meta de agosto',
            valor: 120.5,
            competencia: '2026-07',
          },
          {
            tipo: TipoLancamento.DESCONTO,
            descricao: 'uniforme perdido',
            valor: 80,
            competencia: '2026-07',
          },
        ],
      },
    ]);

    const [ana] = await service.prepararFolha({ competencia: '2026-08' });

    expect(ana.detalhe.bonus).toEqual([
      { descricao: 'bônus técnico', valor: 300, fixo: true },
      { descricao: 'meta de agosto', valor: 120.5, fixo: false },
    ]);
    expect(ana.detalhe.descontos).toEqual([
      { descricao: 'uniforme perdido', valor: 80, fixo: false },
    ]);

    // Os itens fecham com o que o pagamento realmente paga.
    const bonusPago = ana.lancamentos.find(
      (l) => l.tipo === TipoLancamento.BONUS,
    )!;
    expect(
      ana.detalhe.bonus.reduce((soma, b) => soma + b.valor, 0),
    ).toBeCloseTo(bonusPago.valor, 2);
    expect(ana.composicao.descontos).toBe(80);
  });

  it('as faltas chegam com os dias marcados', async () => {
    const service = montarServico(
      [{ ...PESSOA, id: 'f1', nome: 'Ana Teste', lancamentos: [] }],
      new Map([['f1', FALTAS]]),
    );

    const [ana] = await service.prepararFolha({ competencia: '2026-08' });

    expect(ana.detalhe.faltas).toEqual(FALTAS);
    expect(ana.composicao.faltas).toBe(FALTAS.total);
  });

  it('com carteira assinada a falta não aparece: quem desconta é a contabilidade', async () => {
    const service = montarServico(
      [
        {
          ...PESSOA,
          carteiraAssinada: true,
          id: 'f1',
          nome: 'Ana Teste',
          lancamentos: [],
        },
      ],
      new Map([['f1', FALTAS]]),
    );

    const [ana] = await service.prepararFolha({ competencia: '2026-08' });

    expect(ana.detalhe.faltas).toBeNull();
  });

  it('a anotação do mês vem sem os espaços das pontas, e vazia vira nada', async () => {
    const service = montarServico([
      {
        ...PESSOA,
        id: 'f1',
        nome: 'Ana Teste',
        lancamentos: [],
        variaveisMes: [
          { vendas: 3, valorPorVenda: null, horasExtras: 0, observacao: '  campanha  ' },
        ],
      },
      {
        ...PESSOA,
        id: 'f2',
        nome: 'Bia Teste',
        lancamentos: [],
        variaveisMes: [
          { vendas: 0, valorPorVenda: null, horasExtras: 0, observacao: '   ' },
        ],
      },
    ]);

    const [ana, bia] = await service.prepararFolha({ competencia: '2026-08' });

    expect(ana.detalhe.observacaoDoMes).toBe('campanha');
    expect(bia.detalhe.observacaoDoMes).toBeNull();
  });

  it('diz de onde saiu o valor do dia 25', async () => {
    const service = montarServico([
      {
        ...PESSOA,
        id: 'f1',
        nome: 'Ana Teste',
        recebeAdiantamento: true,
        lancamentos: [],
      },
      {
        ...PESSOA,
        id: 'f2',
        nome: 'Bia Teste',
        recebeAdiantamento: true,
        valorAdiantamento: 500,
        lancamentos: [],
      },
      {
        ...PESSOA,
        id: 'f3',
        nome: 'Caio Teste',
        recebeAdiantamento: false,
        lancamentos: [],
      },
    ]);

    const [ana, bia, caio] = await service.prepararFolha({
      competencia: '2026-08',
    });

    expect(ana.detalhe.origemAdiantamento).toEqual({
      de: 'PERCENTUAL',
      percentual: 40,
      base: 1500,
    });
    expect(bia.detalhe.origemAdiantamento).toMatchObject({ de: 'CADASTRO' });
    expect(caio.detalhe.origemAdiantamento).toBeNull();
  });
});
