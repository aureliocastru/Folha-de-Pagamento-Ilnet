import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DespesaRecorrente, Prisma } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriasService } from './categorias.service';
import { proximoDiaUtil } from './dias-uteis';

/** Uma recorrente com o que a tela mostra sem abrir o cadastro. */
export interface RecorrenteComResumo {
  recorrente: DespesaRecorrente;
  /** Quantas contas ela já gerou. */
  geradas: number;
  /** Quantos dias faltam para a próxima nascer no IXC (negativo = atrasada). */
  diasParaGerar: number;
}

/** O que uma rodada de geração fez. */
export interface ResultadoDaGeracao {
  geradas: number;
  /** Nome de quem ganhou conta agora — para o log e para a tela. */
  fornecedores: string[];
  erros: Array<{ recorrenteId: string; fornecedor: string; erro: string }>;
}

/**
 * Despesas que se repetem todo mês: internet, aluguel, contabilidade, o serviço
 * contratado.
 *
 * A conta não é criada com meses de antecedência de propósito. Ela nasce no IXC
 * poucos dias antes de vencer, porque conta a pagar lá é dívida assumida: doze
 * contas de internet abertas de uma vez fariam o total em aberto da empresa
 * saltar por algo que ainda nem foi prestado.
 *
 * O que se guarda aqui é a regra — quanto, para quem, que dia — e o próximo
 * vencimento. Cada geração anda um mês, e é isso que impede a mesma conta de
 * nascer duas vezes se a rotina rodar de novo no mesmo dia.
 *
 * O consórcio é a recorrente que acaba: tem total de parcelas, pode vencer
 * mais de uma no mesmo mês, numera cada conta e se desliga na última.
 */
@Injectable()
export class RecorrentesService {
  private readonly logger = new Logger(RecorrentesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
  ) {}

  async listar(incluirDesligadas = true): Promise<RecorrenteComResumo[]> {
    const lista = await this.prisma.despesaRecorrente.findMany({
      where: incluirDesligadas ? undefined : { ativa: true },
      orderBy: [{ ativa: 'desc' }, { proximoVencimento: 'asc' }],
      include: { _count: { select: { contas: true } } },
    });

    const hoje = hojeUtc();
    return lista.map(({ _count, ...recorrente }) => ({
      recorrente,
      geradas: _count.contas,
      diasParaGerar: diasEntre(
        hoje,
        diasAntes(recorrente.proximoVencimento, recorrente.diasDeAntecedencia),
      ),
    }));
  }

  async criar(
    dados: {
      idFornecedorIxc: number;
      fornecedorNome: string;
      valor: number;
      observacao: string;
      /** Vencimento da PRÓXIMA conta (AAAA-MM-DD). */
      proximoVencimento: string;
      diasDeAntecedencia?: number;
      contaContabil?: number;
      contaPagamento?: number;
      tipoPagamentoIxc?: string;
      categoriaId?: string | null;
      apenasDiasUteis?: boolean;
      diaDoVencimento?: number;
      /** Preenchido, é consórcio: numera as contas e para na última. */
      totalParcelas?: number;
      parcelasLancadas?: number;
      parcelasPorMes?: number;
    },
    usuarioId?: string,
  ): Promise<DespesaRecorrente> {
    conferirParcelas(dados.totalParcelas, dados.parcelasLancadas);

    const criada = await this.prisma.despesaRecorrente.create({
      data: {
        idFornecedorIxc: dados.idFornecedorIxc,
        fornecedorNome: dados.fornecedorNome.trim(),
        valor: new Prisma.Decimal(dados.valor),
        observacao: dados.observacao.trim(),
        proximoVencimento: dataUtc(dados.proximoVencimento),
        diasDeAntecedencia: dados.diasDeAntecedencia ?? 5,
        contaContabil: dados.contaContabil ?? null,
        contaPagamento: dados.contaPagamento ?? null,
        tipoPagamentoIxc: dados.tipoPagamentoIxc ?? null,
        categoriaId: dados.categoriaId ?? null,
        apenasDiasUteis: dados.apenasDiasUteis ?? true,
        diaDoVencimento: dados.diaDoVencimento ?? null,
        totalParcelas: dados.totalParcelas ?? null,
        parcelasLancadas: dados.parcelasLancadas ?? 0,
        parcelasPorMes: dados.parcelasPorMes ?? 1,
        criadoPor: usuarioId ?? null,
      },
    });

    this.logger.log(
      `Despesa recorrente criada: ${criada.fornecedorNome}, ` +
        `${dados.valor} todo mês, próxima em ${dados.proximoVencimento}` +
        (criada.totalParcelas
          ? ` — consórcio, ${criada.parcelasLancadas} de ${criada.totalParcelas} já saíram, ${criada.parcelasPorMes} por mês.`
          : '.'),
    );
    return criada;
  }

  async atualizar(
    id: string,
    dados: Partial<{
      valor: number;
      observacao: string;
      proximoVencimento: string;
      diasDeAntecedencia: number;
      contaContabil: number;
      contaPagamento: number;
      tipoPagamentoIxc: string;
      categoriaId: string | null;
      ativa: boolean;
      apenasDiasUteis: boolean;
      diaDoVencimento: number;
      totalParcelas: number;
      parcelasLancadas: number;
      parcelasPorMes: number;
    }>,
  ): Promise<DespesaRecorrente> {
    const atual = await this.buscar(id);
    const total = dados.totalParcelas ?? atual.totalParcelas ?? undefined;
    const lancadas = dados.parcelasLancadas ?? atual.parcelasLancadas;
    conferirParcelas(total, lancadas);

    /*
     * Mexer na contagem recomeça o mês: quem corrige "já saíram 11" está
     * dizendo qual é a próxima, e uma sobra de "uma das duas deste mês já
     * nasceu" pularia uma parcela.
     */
    const mexeuNaContagem =
      (dados.parcelasLancadas !== undefined &&
        dados.parcelasLancadas !== atual.parcelasLancadas) ||
      (dados.proximoVencimento !== undefined &&
        dataUtc(dados.proximoVencimento).getTime() !==
          atual.proximoVencimento.getTime());

    return this.prisma.despesaRecorrente.update({
      where: { id },
      data: {
        ...(dados.diaDoVencimento === undefined
          ? {}
          : { diaDoVencimento: dados.diaDoVencimento }),
        ...(dados.totalParcelas === undefined
          ? {}
          : { totalParcelas: dados.totalParcelas }),
        ...(dados.parcelasLancadas === undefined
          ? {}
          : { parcelasLancadas: dados.parcelasLancadas }),
        ...(dados.parcelasPorMes === undefined
          ? {}
          : { parcelasPorMes: dados.parcelasPorMes }),
        ...(mexeuNaContagem ? { lancadasNoMes: 0 } : {}),
        ...(dados.valor === undefined
          ? {}
          : { valor: new Prisma.Decimal(dados.valor) }),
        ...(dados.observacao === undefined
          ? {}
          : { observacao: dados.observacao.trim() }),
        ...(dados.proximoVencimento === undefined
          ? {}
          : { proximoVencimento: dataUtc(dados.proximoVencimento) }),
        ...(dados.diasDeAntecedencia === undefined
          ? {}
          : { diasDeAntecedencia: dados.diasDeAntecedencia }),
        ...(dados.contaContabil === undefined
          ? {}
          : { contaContabil: dados.contaContabil }),
        ...(dados.contaPagamento === undefined
          ? {}
          : { contaPagamento: dados.contaPagamento }),
        ...(dados.tipoPagamentoIxc === undefined
          ? {}
          : { tipoPagamentoIxc: dados.tipoPagamentoIxc }),
        ...(dados.categoriaId === undefined
          ? {}
          : { categoriaId: dados.categoriaId }),
        ...(dados.ativa === undefined ? {} : { ativa: dados.ativa }),
        ...(dados.apenasDiasUteis === undefined
          ? {}
          : { apenasDiasUteis: dados.apenasDiasUteis }),
      },
    });
  }

  /**
   * Apaga a regra. As contas que ela já gerou ficam: são dívidas de verdade no
   * IXC, e sumir com elas porque alguém cancelou o contrato seria apagar o que
   * a empresa deve.
   */
  async remover(id: string): Promise<void> {
    await this.buscar(id);
    await this.prisma.despesaRecorrente.delete({ where: { id } });
  }

  async buscar(id: string): Promise<DespesaRecorrente> {
    const r = await this.prisma.despesaRecorrente.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Despesa recorrente não encontrada');
    return r;
  }

  /**
   * Gera as contas que já entraram na janela de antecedência.
   *
   * Roda sozinha, algumas vezes por dia, e também pelo botão da tela. Uma
   * recorrente que falha não derruba as outras: o erro fica gravado nela, à
   * vista de quem abrir a lista, e a próxima rodada tenta de novo — o
   * vencimento só anda quando a conta de fato nasceu no IXC.
   */
  async gerarPendentes(usuarioId?: string): Promise<ResultadoDaGeracao> {
    const hoje = hojeUtc();
    const pendentes = await this.prisma.despesaRecorrente.findMany({
      where: { ativa: true },
    });

    const resultado: ResultadoDaGeracao = {
      geradas: 0,
      fornecedores: [],
      erros: [],
    };

    for (const r of pendentes) {
      /*
       * O vencimento que vale é o dia útil: sábado, domingo e feriado nacional
       * andam para o próximo dia em que o banco abre. Sem isso a conta nasce
       * vencendo num dia em que ninguém pode pagá-la, e ela amanhece atrasada.
       */
      const vencimento = r.apenasDiasUteis
        ? proximoDiaUtil(r.proximoVencimento)
        : r.proximoVencimento;

      const nasceEm = diasAntes(vencimento, r.diasDeAntecedencia);
      if (nasceEm > hoje) continue;

      /*
       * Consórcio quitado não gera mais nada, mesmo que alguém o tenha
       * religado: a parcela 61 de 60 seria uma dívida inventada.
       */
      const total = r.totalParcelas;
      if (total != null && r.parcelasLancadas >= total) continue;

      // Recorrente comum gera uma por mês; consórcio, quantas vencem juntas.
      const porMes = total != null ? Math.max(1, r.parcelasPorMes) : 1;
      let lancadas = r.parcelasLancadas;
      let noMes = r.lancadasNoMes;

      try {
        for (;;) {
          const numero = lancadas + 1;
          const conta = await this.contasPagar.criarDespesa(
            {
              idFornecedorIxc: r.idFornecedorIxc,
              fornecedorNome: r.fornecedorNome,
              valor: Number(r.valor),
              // Emitida hoje, vencendo no dia combinado: é o que a conta seria
              // se alguém a lançasse à mão nesta manhã.
              dataEmissao: hoje,
              dataVencimento: vencimento,
              // O "(12/60)" é o mesmo que a nota parcelada escreve, e é por ele
              // que a lista de contas mostra "parcela 12/60".
              observacao:
                total != null
                  ? `${r.observacao} (${numero}/${total})`.slice(0, 500)
                  : r.observacao,
              contaContabil: r.contaContabil ?? undefined,
              contaPagamento: r.contaPagamento ?? undefined,
              tipoPagamentoIxc: r.tipoPagamentoIxc ?? undefined,
            },
            usuarioId,
          );

          // A etiqueta desta casa se prende ao número do título, que só existe
          // depois que o IXC responde.
          if (r.categoriaId && conta.idFnApagarIxc) {
            await this.categorias
              .classificar(conta.idFnApagarIxc, r.categoriaId, usuarioId)
              .catch((err: unknown) => {
                this.logger.warn(
                  `Conta ${conta.idFnApagarIxc} nasceu sem categoria: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
          }

          lancadas += 1;
          noMes += 1;
          const quitou = total != null && lancadas >= total;
          const fechouOMes = noMes >= porMes || quitou;

          /*
           * Cada conta que nasce fica gravada na hora, antes da seguinte: se o
           * IXC recusar a segunda das duas do mês, a próxima rodada sabe que a
           * primeira já existe e gera só a que faltou.
           */
          await this.prisma.despesaRecorrente.update({
            where: { id: r.id },
            data: {
              ...(fechouOMes
                ? {
                    /*
                     * Só agora o vencimento anda: se a criação tivesse
                     * falhado, o mês seguinte teria pulado uma conta sem
                     * ninguém notar.
                     *
                     * E anda a partir do dia combinado, não do dia útil que
                     * foi usado na conta: um vencimento dia 20 que caiu num
                     * sábado sai dia 22, mas o mês seguinte continua sendo dia
                     * 20. Contando do 22, a data escorregaria alguns dias por
                     * ano até não ter mais relação com o combinado com o
                     * fornecedor.
                     */
                    proximoVencimento: mesSeguinte(
                      r.proximoVencimento,
                      r.diaDoVencimento,
                    ),
                    lancadasNoMes: 0,
                  }
                : { lancadasNoMes: noMes }),
              ...(total != null ? { parcelasLancadas: lancadas } : {}),
              // A última parcela desliga o consórcio: some da conta do mês e
              // fica na lista como quitado.
              ...(quitou ? { ativa: false } : {}),
              ultimaGeracaoEm: new Date(),
              ultimoErro: null,
              contas: { connect: { id: conta.id } },
            },
          });

          resultado.geradas += 1;
          resultado.fornecedores.push(
            total != null
              ? `${r.fornecedorNome} (${numero}/${total})`
              : r.fornecedorNome,
          );
          this.logger.log(
            `Recorrente: conta de ${r.fornecedorNome} gerada no IXC ` +
              `(título ${conta.idFnApagarIxc ?? '?'}` +
              (total != null ? `, parcela ${numero}/${total}` : '') +
              `), vence ${formatarDia(r.proximoVencimento)}.`,
          );

          if (fechouOMes) break;
        }
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Recorrente de ${r.fornecedorNome} falhou: ${erro}`,
        );
        await this.prisma.despesaRecorrente.update({
          where: { id: r.id },
          data: { ultimoErro: erro },
        });
        resultado.erros.push({
          recorrenteId: r.id,
          fornecedor: r.fornecedorNome,
          erro,
        });
      }
    }

    return resultado;
  }
}

/** Hoje à meia-noite em UTC, como o resto das datas desta base. */
function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}

function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/**
 * Consórcio não pode começar já tendo saído mais parcelas do que tem: a
 * rotina não geraria nada, e a tela mostraria um consórcio que nunca existiu.
 */
function conferirParcelas(
  total: number | undefined | null,
  lancadas: number | undefined,
): void {
  if (total == null || lancadas == null) return;
  if (lancadas > total) {
    throw new BadRequestException(
      `Já saíram ${lancadas} parcelas, mas o consórcio tem ${total}. Confira os dois números.`,
    );
  }
}

function diasAntes(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * 24 * 60 * 60 * 1000);
}

function diasEntre(de: Date, ate: Date): number {
  return Math.round((ate.getTime() - de.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * O mesmo dia do mês que vem. Dia 31 em mês de 30 cai no último dia dele — e
 * não no dia 1º do mês seguinte, que é o que `setMonth` faria sozinho e
 * jogaria a conta de janeiro para março.
 */
export function mesSeguinte(data: Date, diaCombinado?: number | null): Date {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth();
  // Com o dia combinado guardado, fevereiro não encurta os meses seguintes: o
  // dia 31 volta a ser 31 em março, e não fica preso no 28.
  const dia = diaCombinado ?? data.getUTCDate();
  const ultimoDoProximo = new Date(Date.UTC(ano, mes + 2, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes + 1, Math.min(dia, ultimoDoProximo)));
}

function formatarDia(data: Date): string {
  return `${String(data.getUTCDate()).padStart(2, '0')}/${String(
    data.getUTCMonth() + 1,
  ).padStart(2, '0')}/${data.getUTCFullYear()}`;
}
