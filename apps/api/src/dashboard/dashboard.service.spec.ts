import {
  FormaPagamento,
  OrigemLancamento,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { DashboardService } from './dashboard.service';

/**
 * A dashboard responde "quanto custa a operação". Errar a conta aqui é pior do
 * que não mostrar nada, porque o número parece confiável. O que este arquivo
 * protege:
 *
 *  - diária e pagamento avulso entram pelo mês em que o dinheiro saiu (a conta
 *    a pagar dos dois nasce sem competência, e a paga em mãos nem vira conta);
 *  - conta reprovada ou cancelada não é gasto — nunca virou dinheiro;
 *  - o INSS retido do trabalhador não entra no custo da empresa;
 *  - o gasto com vendas soma quem vende: diarista, avulso e funcionário.
 */

/** O mês **trabalhado** que a dashboard mostra. */
const COMP = '2026-07';
/**
 * Onde a folha de COMP fica gravada: a empresa paga o mês seguinte ao
 * trabalhado. É essa tradução que a dashboard faz, e por isso as contas dos
 * testes nascem aqui e são conferidas em COMP.
 */
const PAGA_EM = '2026-08';

interface ContaDoTeste {
  competencia: string | null;
  tipo: TipoLancamento;
  status: StatusContaPagar;
  valor: number;
  /** Quanto do valor era comissão de venda, como a folha gravou. */
  comissaoVendas?: number;
  vendas?: number;
  /** Só usada por quem não tem competência (diária, avulso). */
  dataEmissao?: Date;
}

interface PagamentoDoTeste {
  data: Date;
  valor: number;
  quantidade?: number;
  comissaoVendas?: number;
  vendas?: number;
  forma: FormaPagamento;
  diaristaId?: string;
  beneficiarioId?: string;
  contaPagar: { status: StatusContaPagar } | null;
}

function montarServico(dados: {
  contas?: ContaDoTeste[];
  diarias?: PagamentoDoTeste[];
  avulsos?: PagamentoDoTeste[];
  impostos?: {
    serie: Array<{
      competencia: string;
      folhaPatronal: number;
      folhaRetido: number;
      faturamento: number;
    }>;
  };
}) {
  const normalizar = (p: PagamentoDoTeste) => ({
    comissaoVendas: 0,
    vendas: 0,
    ...p,
  });

  const prisma = {
    funcionario: { count: jest.fn().mockResolvedValue(0) },
    contaPagar: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest
        .fn()
        .mockResolvedValue(
          (dados.contas ?? []).map((c) => ({
            comissaoVendas: 0,
            vendas: 0,
            dataEmissao: new Date(`${COMP}-15T00:00:00.000Z`),
            ...c,
          })),
        ),
    },
    diaria: {
      findMany: jest.fn().mockResolvedValue((dados.diarias ?? []).map(normalizar)),
    },
    pagamentoAvulso: {
      findMany: jest.fn().mockResolvedValue((dados.avulsos ?? []).map(normalizar)),
    },
    syncLog: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;

  const funcionarios = {
    resumo: jest.fn().mockResolvedValue({
      total: 0,
      ativos: 0,
      inativos: 0,
      salarioBaseMensal: 0,
      bonusFixoMensal: 0,
      folhaBaseMensal: 0,
    }),
  } as any;

  const vales = { resumo: jest.fn().mockResolvedValue({}) } as any;

  const impostos = {
    resumo: jest.fn().mockResolvedValue(
      dados.impostos ?? {
        serie: [],
        total: { folhaPatronal: 0, folhaRetido: 0, faturamento: 0 },
        guias: [],
      },
    ),
  } as any;

  return {
    service: new DashboardService(prisma, funcionarios, vales, impostos),
    prisma,
    impostos,
  };
}

/**
 * O eixo da dashboard é o mês **trabalhado**, não o mês em que o dinheiro sai.
 *
 * A empresa paga o mês seguinte ao trabalhado: a folha de julho sai em agosto.
 * Agregar pela competência punha o custo de julho na coluna de agosto — e quem
 * confere a folha pensa "a folha de julho", como a tela de gerar folha já
 * pergunta. Só o adiantamento do dia 25 fala do próprio mês: ele é pago no meio
 * do mês que está sendo trabalhado.
 */
describe('mês trabalhado, não mês do pagamento', () => {
  it('salário e bônus contam no mês anterior ao da competência', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 5000,
        },
      ],
    });

    const r = await service.resumo(COMP, 2);
    const [anterior, trabalhado] = r.serieTipos;
    expect(trabalhado).toMatchObject({ competencia: COMP, salario: 5000 });
    expect(anterior.salario).toBe(0);
  });

  it('o adiantamento do dia 25 conta no próprio mês da competência', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: COMP,
          tipo: TipoLancamento.ADIANTAMENTO,
          status: StatusContaPagar.PAGO,
          valor: 800,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.serieTipos[0]).toMatchObject({ competencia: COMP, adiantamento: 800 });
  });

  /**
   * A situação e a repartição do mês leem a mesma régua das séries — se
   * divergissem, o cartão diria um número e o bloco ao lado, outro.
   */
  it('a situação do mês segue o mesmo mês trabalhado', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 5000,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.folha.pago).toBe(5000);
    expect(r.folha.porStatus).toEqual([
      { status: StatusContaPagar.PAGO, quantidade: 1, valor: 5000 },
    ]);
    expect(r.folha.porTipo).toEqual([
      { tipo: TipoLancamento.SALARIO, quantidade: 1, valor: 5000 },
    ]);
  });
});

describe('período das séries', () => {
  it('cobre os meses pedidos, do mais antigo ao mês escolhido', async () => {
    const { service } = montarServico({});
    const r = await service.resumo(COMP, 3);
    expect(r.serie.map((s) => s.competencia)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    expect(r.meses).toBe(3);
  });

  it('um mês só devolve só a competência escolhida', async () => {
    const { service } = montarServico({});
    const r = await service.resumo(COMP, 1);
    expect(r.serie).toHaveLength(1);
    expect(r.serie[0].competencia).toBe(COMP);
  });
});

describe('o que conta como gasto', () => {
  it('soma por tipo o que ainda pode virar dinheiro', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 5000,
        },
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.BONUS,
          status: StatusContaPagar.AGUARDANDO_PAGAMENTO,
          valor: 400,
        },
      ],
    });

    // Salário e bônus da competência seguinte pagam o trabalho de COMP.
    const r = await service.resumo(COMP, 1);
    expect(r.serieTipos[0]).toMatchObject({ salario: 5000, bonus: 400 });
    expect(r.serie[0]).toMatchObject({ total: 5400, pago: 5000 });
  });

  /** Reprovada, cancelada e com erro não saíram do caixa — não são custo. */
  it('conta reprovada, cancelada ou com erro fica fora do custo', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.REPROVADO,
          valor: 1000,
        },
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.BONUS,
          status: StatusContaPagar.CANCELADO,
          valor: 200,
        },
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.AVULSO,
          status: StatusContaPagar.ERRO,
          valor: 300,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.serieTipos[0]).toMatchObject({ salario: 0, bonus: 0, avulso: 0 });
    expect(r.custoPessoal[0].total).toBe(0);
  });
});

describe('diaristas', () => {
  const diaria = (
    dia: string,
    valor: number,
    forma: FormaPagamento,
    status?: StatusContaPagar,
  ) => ({
    data: new Date(`${dia}T00:00:00.000Z`),
    valor,
    quantidade: 1,
    forma,
    diaristaId: 'd1',
    contaPagar: status ? { status } : null,
  });

  /**
   * A conta a pagar da diária nasce sem competência, então agregar por
   * competência perderia todas elas. O mês vem da data do trabalho.
   */
  it('entram pelo mês em que a diária foi trabalhada', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-06-30', 100, FormaPagamento.EM_MAOS),
        diaria('2026-07-01', 200, FormaPagamento.EM_MAOS),
      ],
    });

    const r = await service.resumo(COMP, 2);
    expect(r.diaristas.serie).toEqual([
      expect.objectContaining({ competencia: '2026-06', valor: 100 }),
      expect.objectContaining({ competencia: '2026-07', valor: 200 }),
    ]);
  });

  /**
   * A diária em mãos virou conta a pagar na conta do caixa: enquanto ela
   * espera aprovação o dinheiro ainda não saiu do caixa, e contá-la como paga
   * faria a dashboard dizer que o mês custou o que ainda não custou.
   *
   * Só as antigas — as que nunca tiveram conta a pagar — continuam saindo na
   * hora: ali o dinheiro saiu da gaveta e nunca houve nada para o IXC
   * confirmar.
   */
  it('em mãos esperando aprovação ainda está a caminho', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-07-05', 150, FormaPagamento.EM_MAOS),
        diaria(
          '2026-07-06',
          200,
          FormaPagamento.EM_MAOS,
          StatusContaPagar.AGUARDANDO_APROVACAO,
        ),
        diaria('2026-07-07', 300, FormaPagamento.EM_MAOS, StatusContaPagar.PAGO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      pago: 450,
      aCaminho: 200,
      travado: 0,
    });
  });

  /** Em mãos o dinheiro já saiu; pelo IXC, só quando o banco confirmou. */
  it('separa o que já saiu do que ainda está a caminho', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-07-05', 150, FormaPagamento.EM_MAOS),
        diaria(
          '2026-07-06',
          770,
          FormaPagamento.IXC,
          StatusContaPagar.AGUARDANDO_PAGAMENTO,
        ),
        diaria('2026-07-07', 300, FormaPagamento.IXC, StatusContaPagar.PAGO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 1220,
      pago: 450,
      aCaminho: 770,
      travado: 0,
      pessoas: 1,
      quantidade: 3,
    });
  });

  /**
   * Conta reprovada ou recusada pelo IXC nunca virou dinheiro — a série da
   * folha já as deixava de fora, e a das diárias contava. Ficavam inflando o
   * custo com pessoal e acendendo "ainda não saiu" por algo que não vai sair.
   */
  it('diária reprovada, cancelada ou com erro sai do gasto', async () => {
    const { service } = montarServico({
      diarias: [
        diaria('2026-07-05', 100, FormaPagamento.IXC, StatusContaPagar.PAGO),
        diaria('2026-07-06', 200, FormaPagamento.IXC, StatusContaPagar.REPROVADO),
        diaria('2026-07-07', 300, FormaPagamento.IXC, StatusContaPagar.CANCELADO),
        diaria('2026-07-08', 400, FormaPagamento.IXC, StatusContaPagar.ERRO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 100,
      pago: 100,
      aCaminho: 0,
      travado: 900,
      travadas: 3,
      quantidade: 1,
    });
    expect(r.custoPessoal[0].diaristas).toBe(100);
  });

  /**
   * Conta a pagar apagada no IXC deixa a diária sem conta nenhuma. Contá-la
   * como gasto pendente prendia a tela num "ainda não saiu" que nunca ia
   * embora: não havia pagamento pendente algum para acertar.
   */
  it('diária cuja conta a pagar sumiu do IXC não fica pendente para sempre', async () => {
    const { service } = montarServico({
      diarias: [diaria('2026-07-05', 1590, FormaPagamento.IXC)],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.diaristas.serie[0]).toMatchObject({
      valor: 0,
      pago: 0,
      aCaminho: 0,
      travado: 1590,
    });
  });

  it('aparecem na repartição do mês, que a conta a pagar não alcança', async () => {
    const { service } = montarServico({
      diarias: [diaria('2026-07-05', 770, FormaPagamento.EM_MAOS)],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.folha.porTipo).toContainEqual({
      tipo: TipoLancamento.DIARIA,
      quantidade: 1,
      valor: 770,
    });
  });
});

/**
 * A conta a pagar do avulso nasce sem competência, e agregar por competência a
 * perdia inteira: um pagamento avulso já pago não aparecia em número nenhum da
 * dashboard — nem no custo, nem na repartição do mês. Ele entra pela data, do
 * mesmo jeito que a diária.
 */
describe('pagamentos avulsos', () => {
  const avulso = (
    dia: string,
    valor: number,
    forma: FormaPagamento,
    status?: StatusContaPagar,
  ) => ({
    data: new Date(`${dia}T00:00:00.000Z`),
    valor,
    forma,
    beneficiarioId: 'b1',
    contaPagar: status ? { status } : null,
  });

  it('o avulso pago entra no custo com pessoal do mês', async () => {
    const { service } = montarServico({
      avulsos: [
        avulso('2026-07-11', 430.50, FormaPagamento.IXC, StatusContaPagar.PAGO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.avulsos.serie[0]).toMatchObject({ valor: 430.50, pago: 430.50 });
    expect(r.serieTipos[0].avulso).toBe(430.50);
    expect(r.custoPessoal[0]).toMatchObject({ folha: 430.50, total: 430.50 });
  });

  it('aparece na repartição do mês com os outros tipos', async () => {
    const { service } = montarServico({
      avulsos: [
        avulso('2026-07-11', 430.50, FormaPagamento.IXC, StatusContaPagar.PAGO),
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.folha.porTipo).toContainEqual({
      tipo: TipoLancamento.AVULSO,
      quantidade: 1,
      valor: 430.50,
    });
  });

  it('avulso recusado pelo IXC fica fora do gasto, mas visível como travado', async () => {
    const { service } = montarServico({
      avulsos: [avulso('2026-07-11', 500, FormaPagamento.IXC, StatusContaPagar.ERRO)],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.avulsos.serie[0]).toMatchObject({ valor: 0, travado: 500, travadas: 1 });
    expect(r.custoPessoal[0].total).toBe(0);
  });
});

/**
 * Quem vende é de três tipos, e mostrar só um daria um número que parece o
 * total e não é. O que este bloco protege é mais duro do que a soma: **só entra
 * o que está escrito no pagamento**. Refazer a conta pelas vendas lançadas dava
 * um número que ninguém pagou — o que foi lançado antes de a empresa passar a
 * pagar comissão por aqui aparecia como gasto que nunca saiu.
 */
describe('gasto com vendas', () => {
  it('soma a comissão de diarista e de avulso pelo mês do pagamento', async () => {
    const { service } = montarServico({
      diarias: [
        {
          data: new Date('2026-07-05T00:00:00.000Z'),
          valor: 430,
          quantidade: 2,
          comissaoVendas: 150,
          vendas: 3,
          forma: FormaPagamento.EM_MAOS,
          diaristaId: 'd1',
          contaPagar: null,
        },
      ],
      avulsos: [
        {
          data: new Date('2026-07-20T00:00:00.000Z'),
          valor: 200,
          comissaoVendas: 200,
          vendas: 4,
          forma: FormaPagamento.EM_MAOS,
          beneficiarioId: 'b1',
          contaPagar: null,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.vendas.serie[0]).toMatchObject({
      foraDaFolha: 350,
      funcionarios: 0,
      total: 350,
      vendas: 7,
    });
  });

  /** A comissão do funcionário sai dentro do salário, e a folha grava quanto. */
  it('conta a comissão gravada no salário', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 3000,
          comissaoVendas: 600,
          vendas: 12,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.vendas.serie[0]).toMatchObject({ funcionarios: 600, vendas: 12 });
  });

  /**
   * O caso que motivou tudo isto: vendas lançadas no cadastro, salário pago sem
   * comissão nenhuma, e a tela mostrando milhares de reais de "gasto com
   * vendas" que jamais saíram do caixa. Salário antigo não tem a comissão
   * registrada, e chutar seria repetir o erro.
   */
  it('salário sem comissão registrada não vira gasto com vendas', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 3000,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.vendas.serie[0]).toMatchObject({ funcionarios: 0, total: 0, vendas: 0 });
  });

  /** Salário reprovado não saiu — nem ele, nem a comissão dentro dele. */
  it('comissão de salário reprovado fica de fora', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.REPROVADO,
          valor: 3000,
          comissaoVendas: 600,
          vendas: 12,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.vendas.serie[0]).toMatchObject({ funcionarios: 0, total: 0 });
  });
});

/**
 * O painel da folha responde "quanto custou a folha deste mês". Pagamento
 * feito no módulo Contas a Pagar não é folha, e apareceu aqui: no custo do
 * mês, na fatia de avulsos e no topo dos últimos lançamentos. O filtro fica
 * na consulta, antes de qualquer soma — é o único lugar onde não dá para
 * esquecer de aplicá-lo depois.
 */
describe('nada do contas a pagar entra na folha', () => {
  it('as três consultas do painel pedem só o que é da folha', async () => {
    const { service, prisma } = montarServico({});

    await service.resumo(COMP, 1);

    const [series, ultimos] = prisma.contaPagar.findMany.mock.calls;
    expect(series[0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.FOLHA }),
    );
    expect(ultimos[0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.FOLHA }),
    );

    const [avulsos] = prisma.pagamentoAvulso.findMany.mock.calls;
    expect(avulsos[0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.FOLHA }),
    );
  });
});

describe('custo com pessoal', () => {
  /**
   * O ponto mais importante da tela: o INSS retido do trabalhador passa pela
   * conta da empresa mas é dinheiro dele. Somar aqui contaria o mesmo salário
   * duas vezes — e o número inflado é o que a pessoa levaria para a reunião.
   */
  it('soma folha, diaristas e patronal — nunca o retido do trabalhador', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 10000,
        },
      ],
      diarias: [
        {
          data: new Date('2026-07-10T00:00:00.000Z'),
          valor: 770,
          quantidade: 5.5,
          forma: FormaPagamento.EM_MAOS,
          diaristaId: 'd1',
          contaPagar: null,
        },
      ],
      impostos: {
        serie: [
          {
            competencia: COMP,
            folhaPatronal: 15062.16,
            folhaRetido: 5294.94,
            faturamento: 11556.5,
          },
        ],
      },
    });

    const r = await service.resumo(COMP, 1);
    expect(r.custoPessoal[0]).toEqual({
      competencia: COMP,
      folha: 10000,
      diaristas: 770,
      encargos: 15062.16,
      total: 25832.16,
    });
  });

  it('sem guia lançada, o custo é só folha e diaristas', async () => {
    const { service } = montarServico({
      contas: [
        {
          competencia: PAGA_EM,
          tipo: TipoLancamento.SALARIO,
          status: StatusContaPagar.PAGO,
          valor: 1000,
        },
      ],
    });

    const r = await service.resumo(COMP, 1);
    expect(r.custoPessoal[0]).toMatchObject({ encargos: 0, total: 1000 });
  });
});

/**
 * A venda só conta depois que o pagamento sai.
 *
 * Antes bastava o pagamento não estar travado, e "a caminho" — a conta a pagar
 * criada, esperando aprovação ou baixa no IXC — já entrava no gráfico. Um
 * acerto lançado para conferir aparecia como venda fechada no mesmo instante, e
 * ficava lá enquanto ninguém aprovasse nem cancelasse.
 *
 * A comissão é o pagamento de uma venda: enquanto o dinheiro não saiu, o que
 * existe é intenção de pagar. O que está a caminho vai para `aCaminho`, e não
 * some da resposta — venda que a empresa já deve não pode sumir da tela.
 */
describe('venda a caminho não conta como venda do mês', () => {
  const avulso = (status: StatusContaPagar | null) => ({
    data: new Date('2026-07-20T00:00:00.000Z'),
    valor: 200,
    comissaoVendas: 200,
    vendas: 4,
    forma: FormaPagamento.IXC,
    beneficiarioId: 'b1',
    contaPagar: status ? { status } : null,
  });

  it('esperando aprovação: fica fora da série e aparece em "a caminho"', async () => {
    const { service } = montarServico({
      avulsos: [avulso(StatusContaPagar.AGUARDANDO_APROVACAO)],
    });

    const r = await service.resumo(COMP, 1);

    expect(r.vendas.serie[0]).toMatchObject({ foraDaFolha: 0, vendas: 0 });
    expect(r.vendas.aCaminho).toEqual({ comissao: 200, vendas: 4 });
  });

  it('aprovado mas ainda não pago também não conta', async () => {
    const { service } = montarServico({
      avulsos: [avulso(StatusContaPagar.APROVADO)],
    });

    const r = await service.resumo(COMP, 1);

    expect(r.vendas.serie[0].vendas).toBe(0);
    expect(r.vendas.aCaminho.vendas).toBe(4);
  });

  it('pago conta, e não aparece como a caminho', async () => {
    const { service } = montarServico({
      avulsos: [avulso(StatusContaPagar.PAGO)],
    });

    const r = await service.resumo(COMP, 1);

    expect(r.vendas.serie[0]).toMatchObject({ foraDaFolha: 200, vendas: 4 });
    expect(r.vendas.aCaminho).toEqual({ comissao: 0, vendas: 0 });
  });

  it('cancelado não conta em lugar nenhum — nem como a caminho', async () => {
    const { service } = montarServico({
      avulsos: [avulso(StatusContaPagar.CANCELADO)],
    });

    const r = await service.resumo(COMP, 1);

    expect(r.vendas.serie[0].vendas).toBe(0);
    expect(r.vendas.aCaminho).toEqual({ comissao: 0, vendas: 0 });
  });

  /*
   * O pagamento em mãos antigo não tinha conta a pagar: o dinheiro saía da
   * gaveta na hora. Ele continua contando — não há o que esperar.
   */
  it('o pagamento em mãos sem conta continua contando', async () => {
    const { service } = montarServico({
      avulsos: [{ ...avulso(null), forma: FormaPagamento.EM_MAOS }],
    });

    const r = await service.resumo(COMP, 1);

    expect(r.vendas.serie[0].vendas).toBe(4);
  });
});
