import { Injectable } from '@nestjs/common';
import {
  FormaPagamento,
  OrigemLancamento,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import {
  competenciaAnterior,
  competenciaSeguinte,
} from '../financeiro/folha.calc';
import { FuncionariosService } from '../funcionarios/funcionarios.service';
import { ImpostosService } from '../impostos/impostos.service';
import { PrismaService } from '../prisma/prisma.service';
import { ValesService } from '../vales/vales.service';

/** Status que ainda vão virar dinheiro saindo do caixa. */
const EM_ABERTO: StatusContaPagar[] = [
  StatusContaPagar.RASCUNHO,
  StatusContaPagar.AGUARDANDO_APROVACAO,
  StatusContaPagar.APROVADO,
  StatusContaPagar.AGUARDANDO_PAGAMENTO,
];

/** O contrário: nunca virou dinheiro, então nunca foi gasto. */
const SEM_SAIDA: StatusContaPagar[] = [
  StatusContaPagar.REPROVADO,
  StatusContaPagar.CANCELADO,
  StatusContaPagar.ERRO,
];

/** Quantos meses a série histórica mostra, contando a competência atual. */
const MESES_NA_SERIE = 12;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funcionarios: FuncionariosService,
    private readonly vales: ValesService,
    private readonly impostos: ImpostosService,
  ) {}

  async resumo(competencia?: string, mesesPedidos?: number) {
    const comp = competencia ?? competenciaAtual();
    const quantidade = Math.min(Math.max(mesesPedidos ?? MESES_NA_SERIE, 1), 24);
    const meses = ultimosMeses(comp, quantidade);
    const inicio = primeiroDia(meses[0]);
    const fim = depoisDoUltimoDia(comp);

    // O salário do mês trabalhado sai no mês seguinte, então a folha do último
    // mês da série está gravada na competência seguinte a ele — sem lê-la, o
    // mês em foco apareceria sempre vazio.
    const competenciasLidas = [...meses, competenciaSeguinte(comp)];

    const [
      funcionarios,
      valesResumo,
      semPix,
      contas,
      diarias,
      avulsos,
      impostos,
      ultimasContas,
      ultimoSync,
    ] = await Promise.all([
      this.funcionarios.resumo(),
      this.vales.resumo(competenciaSeguinte(comp)),
      this.prisma.funcionario.count({
        where: {
          isentoIcms: true,
          ativo: true,
          OR: [{ chavePix: null }, { chavePix: '' }],
        },
      }),
      // Uma leitura só para tudo que vem de conta a pagar: as séries, a
      // repartição do mês e a situação. Diária e avulso não têm competência (a
      // conta nasce sem, e a paga em mãos nem vira conta), então entram pela
      // data de emissão.
      this.prisma.contaPagar.findMany({
        where: {
          // Nada que tenha nascido no Contas a Pagar entra na conta da folha:
          // nem a despesa lançada à mão (energia, aluguel, material), nem o
          // pagamento avulso a um fornecedor do IXC. Todos nascem sem
          // competência, então entrariam pela data de emissão e inflariam
          // justamente o número que este painel existe para responder: quanto
          // custou a folha do mês.
          origem: OrigemLancamento.FOLHA,
          tipo: { not: TipoLancamento.DESPESA },
          OR: [
            { competencia: { in: competenciasLidas } },
            { competencia: null, dataEmissao: { gte: inicio, lt: fim } },
          ],
        },
        select: {
          competencia: true,
          dataEmissao: true,
          tipo: true,
          status: true,
          valor: true,
          comissaoVendas: true,
          vendas: true,
        },
      }),
      this.prisma.diaria.findMany({
        where: { data: { gte: inicio, lt: fim } },
        select: {
          data: true,
          valor: true,
          quantidade: true,
          comissaoVendas: true,
          vendas: true,
          forma: true,
          diaristaId: true,
          contaPagar: { select: { status: true } },
        },
      }),
      this.prisma.pagamentoAvulso.findMany({
        where: {
          origem: OrigemLancamento.FOLHA,
          data: { gte: inicio, lt: fim },
        },
        select: {
          data: true,
          valor: true,
          comissaoVendas: true,
          vendas: true,
          forma: true,
          beneficiarioId: true,
          contaPagar: { select: { status: true } },
          // A prova de que o em mãos sem conta a pagar saiu mesmo da gaveta.
          idLancamentoIxc: true,
          lancadoManual: true,
        },
      }),
      this.impostos.resumo(meses),
      // "Últimos lançamentos": só o que a folha gerou. Um pagamento feito no
      // Contas a Pagar aparecia aqui no topo, empurrando para fora justamente
      // o que esta lista existe para mostrar.
      this.prisma.contaPagar.findMany({
        where: {
          origem: OrigemLancamento.FOLHA,
          tipo: { not: TipoLancamento.DESPESA },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.syncLog.findFirst({ orderBy: { iniciadoEm: 'desc' } }),
    ]);

    // Cada conta ganha o mês de trabalho a que ela se refere — que não é o mês
    // em que o dinheiro sai. É essa tradução que faz a folha paga em setembro
    // aparecer como custo de agosto, que é o mês que ela pagou.
    const contasDoMes = contas.filter(
      (c) => mesTrabalhadoDaConta(c) === comp,
    );
    const porStatus = agruparPorStatus(contasDoMes);
    const somaStatus = (...alvos: StatusContaPagar[]) =>
      porStatus
        .filter((s) => alvos.includes(s.status))
        .reduce((soma, s) => soma + s.valor, 0);

    const serie = montarSerieContas(meses, contas);
    const diaristas = montarPagamentosPorData(meses, diarias, (d) => d.diaristaId);
    /*
     * O avulso em mãos precisa provar que saiu; a diária não.
     *
     * O em mãos do avulso nasce como conta a pagar na conta do caixa. Um avulso
     * sem conta nenhuma é um pagamento que não chegou a existir do outro lado —
     * ou cuja conta foi apagada depois —, e dinheiro nenhum saiu por ele.
     */
    const avulsosComProva = avulsos.map((a) => ({
      ...a,
      precisaProvaDeSaida: true,
    }));
    const avulsosSerie = montarPagamentosPorData(
      meses,
      avulsosComProva,
      (p) => p.beneficiarioId,
    );
    const diariasDoMes = diaristas.serie.find((d) => d.competencia === comp);
    const avulsosDoMes = avulsosSerie.serie.find((a) => a.competencia === comp);
    const serieTipos = comDiariaEAvulso(serie.porTipo, diaristas, avulsosSerie);
    const vendas = montarVendas(meses, [...diarias, ...avulsosComProva], contas);

    return {
      competencia: comp,
      meses: quantidade,
      funcionarios: {
        total: funcionarios.total,
        ativos: funcionarios.ativos,
        inativos: funcionarios.inativos,
        salarioBaseMensal: Number(funcionarios.salarioBaseMensal),
        bonusFixoMensal: Number(funcionarios.bonusFixoMensal),
        folhaBaseMensal: Number(funcionarios.folhaBaseMensal),
        semPix,
      },
      folha: {
        total: porStatus.reduce((s, i) => s + i.valor, 0),
        pago: somaStatus(StatusContaPagar.PAGO),
        emAberto: somaStatus(...EM_ABERTO),
        comErro: somaStatus(StatusContaPagar.ERRO),
        quantidade: porStatus.reduce((s, i) => s + i.quantidade, 0),
        porStatus,
        porTipo: ordenarTipos(
          agruparPorTipo(contasDoMes)
            // Diária e avulso não têm competência na conta a pagar, e o pago em
            // mãos nem vira conta; os dois entram pela data do pagamento, que é
            // o que a série ao lado já sabe contar.
            .filter(
              (t) =>
                t.tipo !== TipoLancamento.DIARIA &&
                t.tipo !== TipoLancamento.AVULSO,
            )
            .concat(
              linhaDoTipo(TipoLancamento.DIARIA, diariasDoMes),
              linhaDoTipo(TipoLancamento.AVULSO, avulsosDoMes),
            ),
        ),
      },
      vales: valesResumo,
      serie: serie.total,
      serieTipos,
      diaristas,
      avulsos: avulsosSerie,
      vendas,
      impostos,
      custoPessoal: montarCustoPessoal(meses, serieTipos, diaristas, impostos),
      ultimasContas,
      ultimoSync,
    };
  }
}

/** A linha daquele tipo na repartição do mês — omitida quando não houve nada. */
function linhaDoTipo(
  tipo: TipoLancamento,
  mes: { quantidade: number; valor: number } | undefined,
): Array<{ tipo: TipoLancamento; quantidade: number; valor: number }> {
  return mes && mes.valor > 0
    ? [{ tipo, quantidade: mes.quantidade, valor: mes.valor }]
    : [];
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

interface ContaDaSerie {
  competencia: string | null;
  dataEmissao: Date;
  tipo: TipoLancamento;
  status: StatusContaPagar;
  valor: unknown;
  /** Quanto do valor era comissão de venda, gravado ao gerar a folha. */
  comissaoVendas: unknown;
  vendas: number;
}

/**
 * A que mês de **trabalho** aquela conta se refere.
 *
 * A empresa paga o mês seguinte ao trabalhado: o salário e o bônus de agosto
 * saem na folha de setembro. Só o adiantamento fala do próprio mês — ele é pago
 * no dia 25, no meio do mês que está sendo trabalhado.
 *
 * A dashboard agregava pela competência, que é o mês em que o dinheiro sai, e
 * por isso o custo de agosto aparecia na coluna de setembro. Quem confere a
 * folha pensa no mês trabalhado ("a folha de agosto"), e é assim que a tela
 * pergunta desde a mudança na tela de gerar folha.
 */
function mesTrabalhadoDaConta(c: {
  competencia: string | null;
  dataEmissao: Date;
  tipo: TipoLancamento;
}): string {
  // Diária e avulso não têm competência: valem pelo dia em que saíram.
  if (!c.competencia) return mesDaData(c.dataEmissao);
  return c.tipo === TipoLancamento.ADIANTAMENTO
    ? c.competencia
    : competenciaAnterior(c.competencia);
}

/** Soma por situação as contas de um mês, da maior para a menor. */
function agruparPorStatus(contas: ContaDaSerie[]) {
  const porStatus = new Map<
    StatusContaPagar,
    { status: StatusContaPagar; quantidade: number; valor: number }
  >();
  for (const c of contas) {
    const atual = porStatus.get(c.status) ?? {
      status: c.status,
      quantidade: 0,
      valor: 0,
    };
    atual.quantidade++;
    atual.valor = arredondar(atual.valor + Number(c.valor ?? 0));
    porStatus.set(c.status, atual);
  }
  return [...porStatus.values()].sort((a, b) => b.valor - a.valor);
}

/** Soma por tipo de lançamento as contas de um mês. */
function agruparPorTipo(contas: ContaDaSerie[]) {
  const porTipo = new Map<
    TipoLancamento,
    { tipo: TipoLancamento; quantidade: number; valor: number }
  >();
  for (const c of contas) {
    const atual = porTipo.get(c.tipo) ?? {
      tipo: c.tipo,
      quantidade: 0,
      valor: 0,
    };
    atual.quantidade++;
    atual.valor = arredondar(atual.valor + Number(c.valor ?? 0));
    porTipo.set(c.tipo, atual);
  }
  return [...porTipo.values()];
}

/**
 * Duas leituras da mesma lista de contas: o total × pago de cada mês (a barra
 * do topo) e a repartição por tipo (de onde saem os gráficos de bônus,
 * salário e adiantamento). Tudo pelo mês trabalhado.
 */
function montarSerieContas(meses: string[], contas: ContaDaSerie[]) {
  const total = new Map(meses.map((m) => [m, { total: 0, pago: 0 }]));
  const porTipo = new Map(meses.map((m) => [m, zeroPorTipo()]));

  for (const conta of contas) {
    const trabalhado = mesTrabalhadoDaConta(conta);
    const mes = total.get(trabalhado);
    const tipos = porTipo.get(trabalhado);
    if (!mes || !tipos) continue;

    const valor = Number(conta.valor ?? 0);
    mes.total += valor;
    if (conta.status === StatusContaPagar.PAGO) mes.pago += valor;

    // Reprovada e cancelada não são gasto: nunca viraram dinheiro.
    const chave = CHAVE_DO_TIPO[conta.tipo];
    if (chave && !SEM_SAIDA.includes(conta.status)) {
      tipos[chave] += valor;
    }
  }

  return {
    total: meses.map((competencia) => {
      const m = total.get(competencia) ?? { total: 0, pago: 0 };
      return {
        competencia,
        total: arredondar(m.total),
        pago: arredondar(m.pago),
      };
    }),
    porTipo: meses.map((competencia) => ({
      competencia,
      ...arredondarTipos(porTipo.get(competencia) ?? zeroPorTipo()),
    })),
  };
}

/**
 * Um pagamento a quem não é da folha — diária ou avulso. Os dois entram na
 * dashboard pela data em que o dinheiro saiu, e não pela competência, porque a
 * conta a pagar dos dois nasce sem competência (e a paga em mãos nem vira
 * conta). Era isso que fazia o avulso pago sumir de todos os números.
 */
interface PagamentoDaSerie {
  data: Date;
  valor: unknown;
  /** Diárias trabalhadas; ausente no avulso, que conta um por pagamento. */
  quantidade?: unknown;
  comissaoVendas: unknown;
  vendas: number;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
  /**
   * Em mãos, sem conta a pagar, este pagamento precisa provar que saiu.
   *
   * A diária em mãos não precisa: o dinheiro foi entregue na hora, e nunca
   * houve nada para o IXC confirmar. O avulso precisa — o em mãos dele nasce
   * como conta a pagar na conta do caixa, e um avulso sem conta nenhuma é um
   * pagamento que não chegou a existir do outro lado.
   */
  precisaProvaDeSaida?: boolean;
  /** A prova: o lançamento no caixa do IXC, ou a marca de lançado à mão. */
  idLancamentoIxc?: number | null;
  lancadoManual?: boolean;
}

/** Onde o pagamento está no caminho do dinheiro. */
type SituacaoDoPagamento = 'SAIU' | 'A_CAMINHO' | 'TRAVADO';

/**
 * A mesma régua das telas de diarista e avulso, para todas contarem a mesma
 * história: o dinheiro saiu quando o IXC deu a conta a pagar por paga. Vale
 * para as duas formas — em mãos também é conta a pagar, só que na conta do
 * caixa em vez da do banco.
 */
function situacaoDoPagamento(p: PagamentoDaSerie): SituacaoDoPagamento {
  const status = p.contaPagar?.status;
  /*
   * Sem conta a pagar, "em mãos" não basta para dizer que o dinheiro saiu.
   *
   * O em mãos **antigo** saiu mesmo: a saída ia direto para a movimentação
   * financeira, e ele carrega a prova disso — o número do lançamento no caixa,
   * ou a marca de que alguém o lançou à mão. Esse continua contando.
   *
   * Sem nenhuma das duas provas, o que existe é um pagamento cuja conta a
   * pagar nunca foi criada, ou foi apagada depois. Dinheiro nenhum saiu, e
   * contá-lo como saído foi o que fez uma venda de teste — lançada, apagada
   * pela metade, nunca finalizada — continuar somando no gráfico sem aparecer
   * em lugar nenhum como pendente.
   *
   * Pelo IXC sem conta a pagar é o mesmo caso: perdeu o `fn_apagar`, e não sai
   * sozinho.
   */
  if (!status) {
    if (p.forma !== FormaPagamento.EM_MAOS) return 'TRAVADO';
    // A diária em mãos foi entregue na hora: não há prova a pedir.
    if (!p.precisaProvaDeSaida) return 'SAIU';
    return p.idLancamentoIxc || p.lancadoManual === true ? 'SAIU' : 'TRAVADO';
  }
  if (status === StatusContaPagar.PAGO) return 'SAIU';
  if (EM_ABERTO.includes(status)) return 'A_CAMINHO';
  // Reprovada, cancelada, recusada pelo IXC: nenhuma vai sair sozinha.
  return 'TRAVADO';
}

/**
 * Gasto com diaristas (ou com avulsos), mês a mês.
 *
 * Só entra o que virou dinheiro ou ainda vai virar. Pagamento travado fica de
 * fora do gasto — é a mesma regra da série da folha, onde conta reprovada e
 * cancelada nunca contaram — mas continua somado à parte, senão sumiria da tela
 * sem ninguém saber que existe algo para destravar.
 */
function montarPagamentosPorData<T extends PagamentoDaSerie>(
  meses: string[],
  pagamentos: T[],
  quemRecebeu: (p: T) => string,
) {
  const porMes = new Map(
    meses.map((m) => [
      m,
      {
        pago: 0,
        aCaminho: 0,
        travado: 0,
        travadas: 0,
        quantidade: 0,
        pessoas: new Set<string>(),
      },
    ]),
  );

  for (const p of pagamentos) {
    const mes = porMes.get(mesDaData(p.data));
    if (!mes) continue;

    const valor = Number(p.valor ?? 0);
    const situacao = situacaoDoPagamento(p);
    if (situacao === 'TRAVADO') {
      mes.travado += valor;
      mes.travadas++;
      continue;
    }

    if (situacao === 'SAIU') mes.pago += valor;
    else mes.aCaminho += valor;
    // Quantos pagamentos e quantas pessoas o número do topo está resumindo — só
    // os que ele conta, para o detalhe não contradizer o valor.
    mes.quantidade += p.quantidade === undefined ? 1 : Number(p.quantidade ?? 0);
    mes.pessoas.add(quemRecebeu(p));
  }

  const serie = meses.map((competencia) => {
    const m = porMes.get(competencia);
    const pago = arredondar(m?.pago ?? 0);
    const aCaminho = arredondar(m?.aCaminho ?? 0);
    return {
      competencia,
      valor: arredondar(pago + aCaminho),
      pago,
      aCaminho,
      travado: arredondar(m?.travado ?? 0),
      travadas: m?.travadas ?? 0,
      quantidade: arredondar(m?.quantidade ?? 0),
      pessoas: m?.pessoas.size ?? 0,
    };
  });

  return {
    serie,
    total: arredondar(serie.reduce((s, m) => s + m.valor, 0)),
    totalPago: arredondar(serie.reduce((s, m) => s + m.pago, 0)),
    totalACaminho: arredondar(serie.reduce((s, m) => s + m.aCaminho, 0)),
    totalTravado: arredondar(serie.reduce((s, m) => s + m.travado, 0)),
    quantidade: arredondar(serie.reduce((s, m) => s + m.quantidade, 0)),
  };
}

/** Uma série de gasto mês a mês, como as de diarista e avulso devolvem. */
type SerieDeGasto = { serie: Array<{ competencia: string; valor: number }> };

/**
 * Preenche na repartição por tipo o que a conta a pagar não alcança. Diária e
 * avulso nascem sem competência, então a série montada por competência as
 * mostrava sempre em zero — e o custo com pessoal saía menor do que foi.
 */
function comDiariaEAvulso(
  porTipo: Array<{ competencia: string } & PorTipo>,
  diaristas: SerieDeGasto,
  avulsos: SerieDeGasto,
): Array<{ competencia: string } & PorTipo> {
  const valorEm = (s: SerieDeGasto, competencia: string) =>
    s.serie.find((m) => m.competencia === competencia)?.valor ?? 0;

  return porTipo.map((mes) => ({
    ...mes,
    diaria: valorEm(diaristas, mes.competencia),
    avulso: valorEm(avulsos, mes.competencia),
  }));
}

/**
 * Quanto o mês custou em comissão de venda.
 *
 * Só entra o que está **escrito** no pagamento. Diarista e avulso recebem a
 * comissão junto do próprio pagamento; funcionário recebe dentro do salário, e
 * a folha grava na conta a pagar quanto dela era comissão.
 *
 * Refazer essa conta pelas vendas lançadas seria mais fácil e daria um número
 * que ninguém pagou: venda lançada depois da folha (ou corrigida depois)
 * reescreveria um mês fechado, e o que foi lançado antes de a empresa passar a
 * pagar comissão por aqui viraria gasto que nunca saiu. Por isso as contas
 * antigas contam zero — a comissão delas não foi registrada.
 */
function montarVendas(
  meses: string[],
  pagamentos: PagamentoDaSerie[],
  contas: ContaDaSerie[],
) {
  const porMes = new Map(
    meses.map((m) => [m, { fora: 0, folha: 0, vendas: 0 }]),
  );

  /**
   * A venda cujo pagamento ainda não saiu.
   *
   * Fica à parte, e não some: um acerto esperando aprovação é venda que a
   * empresa já deve, e sumir da tela deixaria quem lançou achando que se
   * perdeu. Não entra na série porque a série é do que já foi pago.
   */
  const aCaminho = { comissao: 0, vendas: 0 };

  for (const p of pagamentos) {
    const mes = porMes.get(mesDaData(p.data));
    if (!mes) continue;

    /*
     * Venda só conta depois que o pagamento saiu.
     *
     * Antes bastava não estar travado, e "a caminho" — a conta a pagar criada,
     * esperando aprovação ou baixa no IXC — já entrava no gráfico. Um acerto
     * lançado para conferir aparecia como venda fechada no mesmo instante, e
     * continuava lá enquanto o pagamento não fosse aprovado nem cancelado.
     *
     * A comissão é o pagamento de uma venda: enquanto o dinheiro não saiu, o
     * que existe é uma intenção de pagar. O que está a caminho vai para
     * `aCaminho`, e não some — só não é contado como venda do mês.
     */
    if (situacaoDoPagamento(p) !== 'SAIU') {
      if (situacaoDoPagamento(p) === 'A_CAMINHO') {
        aCaminho.comissao += Number(p.comissaoVendas ?? 0);
        aCaminho.vendas += p.vendas;
      }
      continue;
    }

    mes.fora += Number(p.comissaoVendas ?? 0);
    mes.vendas += p.vendas;
  }

  for (const c of contas) {
    // Pelo mês trabalhado: a comissão de agosto sai na folha de setembro, e
    // quem pergunta "quanto agosto custou em venda" quer vê-la em agosto.
    const mes = porMes.get(mesTrabalhadoDaConta(c));
    if (!mes || SEM_SAIDA.includes(c.status)) continue;
    mes.folha += Number(c.comissaoVendas ?? 0);
    mes.vendas += c.vendas;
  }

  const serie = meses.map((competencia) => {
    const m = porMes.get(competencia) ?? { fora: 0, folha: 0, vendas: 0 };
    return {
      competencia,
      funcionarios: arredondar(m.folha),
      foraDaFolha: arredondar(m.fora),
      total: arredondar(m.folha + m.fora),
      vendas: m.vendas,
    };
  });

  return {
    serie,
    total: arredondar(serie.reduce((s, m) => s + m.total, 0)),
    vendas: serie.reduce((s, m) => s + m.vendas, 0),
    /** Venda lançada cujo pagamento ainda não saiu. Fora da série. */
    aCaminho: {
      comissao: arredondar(aCaminho.comissao),
      vendas: aCaminho.vendas,
    },
  };
}

/**
 * O que a empresa gasta com gente, mês a mês: o que a folha pagou, o que os
 * diaristas custaram e a parte patronal do imposto (FGTS e CPP).
 *
 * O INSS retido do trabalhador fica **fora** de propósito — é dinheiro dele
 * passando pela conta da empresa, e somar aqui contaria o mesmo salário duas
 * vezes.
 */
function montarCustoPessoal(
  meses: string[],
  porTipo: Array<{ competencia: string } & PorTipo>,
  diaristas: { serie: Array<{ competencia: string; valor: number }> },
  impostos: { serie: Array<{ competencia: string; folhaPatronal: number }> },
) {
  return meses.map((competencia) => {
    const t = porTipo.find((p) => p.competencia === competencia);
    const folha = t
      ? t.salario + t.adiantamento + t.bonus + t.avulso
      : 0;
    const diaria =
      diaristas.serie.find((d) => d.competencia === competencia)?.valor ?? 0;
    const encargo =
      impostos.serie.find((i) => i.competencia === competencia)?.folhaPatronal ??
      0;
    return {
      competencia,
      folha: arredondar(folha),
      diaristas: arredondar(diaria),
      encargos: arredondar(encargo),
      total: arredondar(folha + diaria + encargo),
    };
  });
}

// ---------------------------------------------------------------------------
// Utilidades de competência
// ---------------------------------------------------------------------------

/** "AAAA-MM" do mês corrente. */
function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

/** Os N meses até `competencia`, do mais antigo para o mais novo. */
function ultimosMeses(competencia: string, quantidade: number): string[] {
  const meses = [competencia];
  for (let i = 1; i < quantidade; i++) {
    meses.unshift(competenciaAnterior(meses[0]));
  }
  return meses;
}

/** "AAAA-MM" do dia, em UTC — é como as datas são gravadas. */
function mesDaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function primeiroDia(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1));
}

/** Primeiro instante do mês seguinte — o limite superior aberto da busca. */
function depoisDoUltimoDia(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 1));
}

// ---------------------------------------------------------------------------
// Tipos de lançamento
// ---------------------------------------------------------------------------

export interface PorTipo {
  salario: number;
  ferias: number;
  adiantamento: number;
  bonus: number;
  avulso: number;
  diaria: number;
  desconto: number;
}

/**
 * Parcial de propósito: o que não está aqui não é custo de folha e fica de
 * fora da repartição — é o caso de DESPESA, a conta lançada à mão. Um tipo
 * novo que ninguém mapear some da conta em vez de entrar por engano em alguma
 * fatia, e a consulta acima já o exclui antes de chegar aqui.
 */
const CHAVE_DO_TIPO: Partial<Record<TipoLancamento, keyof PorTipo>> = {
  SALARIO: 'salario',
  FERIAS: 'ferias',
  ADIANTAMENTO: 'adiantamento',
  BONUS: 'bonus',
  AVULSO: 'avulso',
  DIARIA: 'diaria',
  DESCONTO: 'desconto',
};

function zeroPorTipo(): PorTipo {
  return {
    salario: 0,
    ferias: 0,
    adiantamento: 0,
    bonus: 0,
    avulso: 0,
    diaria: 0,
    desconto: 0,
  };
}

function arredondarTipos(p: PorTipo): PorTipo {
  return {
    salario: arredondar(p.salario),
    ferias: arredondar(p.ferias),
    adiantamento: arredondar(p.adiantamento),
    bonus: arredondar(p.bonus),
    avulso: arredondar(p.avulso),
    diaria: arredondar(p.diaria),
    desconto: arredondar(p.desconto),
  };
}

/** Ordem de leitura da folha: salário, férias, adiantamento, bônus, o resto. */
const ORDEM_TIPO: TipoLancamento[] = [
  TipoLancamento.SALARIO,
  TipoLancamento.FERIAS,
  TipoLancamento.ADIANTAMENTO,
  TipoLancamento.BONUS,
  TipoLancamento.DIARIA,
  TipoLancamento.AVULSO,
  TipoLancamento.DESCONTO,
];

function ordenarTipos<T extends { tipo: TipoLancamento }>(itens: T[]): T[] {
  return [...itens].sort(
    (a, b) => ORDEM_TIPO.indexOf(a.tipo) - ORDEM_TIPO.indexOf(b.tipo),
  );
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
