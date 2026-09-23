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

/** Uma parcela paga fora da ordem, como a tela a mostra. */
export interface AntecipadaDaTela {
  id: string;
  numero: number;
  valor: string;
  valorDeTabela: string;
  idFnApagarIxc: number | null;
  data: Date;
}

/** Uma recorrente com o que a tela mostra sem abrir o cadastro. */
export interface RecorrenteComResumo {
  recorrente: DespesaRecorrente & {
    /** As parcelas já antecipadas, cada uma com o seu número. */
    antecipadas: AntecipadaDaTela[];
  };
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
      include: {
        _count: { select: { contas: true } },
        antecipadas: {
          select: {
            id: true,
            numero: true,
            valor: true,
            valorDeTabela: true,
            idFnApagarIxc: true,
            data: true,
          },
          orderBy: { numero: 'desc' },
        },
      },
    });

    const hoje = hojeUtc();
    return lista.map(({ _count, antecipadas, ...recorrente }) => ({
      recorrente: {
        ...recorrente,
        antecipadas: antecipadas.map((a) => ({
          ...a,
          valor: a.valor.toString(),
          valorDeTabela: a.valorDeTabela.toString(),
        })),
      },
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
      /** Quantas já tinham sido antecipadas, contadas do fim, ao cadastrar. */
      parcelasAntecipadas?: number;
      /** É financiamento: vai para a aba dele. */
      ehFinanciamento?: boolean;
    },
    usuarioId?: string,
  ): Promise<DespesaRecorrente> {
    conferirParcelas(
      dados.totalParcelas,
      dados.parcelasLancadas,
      dados.parcelasAntecipadas,
    );

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
        parcelasAntecipadas: dados.parcelasAntecipadas ?? 0,
        ehFinanciamento: dados.ehFinanciamento ?? false,
        criadoPor: usuarioId ?? null,
      },
    });

    this.logger.log(
      `Despesa recorrente criada: ${criada.fornecedorNome}, ` +
        `${dados.valor} todo mês, próxima em ${dados.proximoVencimento}` +
        (criada.totalParcelas
          ? ` — ${criada.ehFinanciamento ? 'financiamento' : 'consórcio'}, ` +
            `${criada.parcelasLancadas} de ${criada.totalParcelas} já saíram` +
            (criada.parcelasAntecipadas
              ? ` e ${criada.parcelasAntecipadas} foram antecipadas do fim`
              : '') +
            `, ${criada.parcelasPorMes} por mês.`
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
      parcelasAntecipadas: number;
      ehFinanciamento: boolean;
    }>,
  ): Promise<DespesaRecorrente> {
    const atual = await this.buscar(id);
    const total = dados.totalParcelas ?? atual.totalParcelas ?? undefined;
    const lancadas = dados.parcelasLancadas ?? atual.parcelasLancadas;
    const antecipadas = dados.parcelasAntecipadas ?? atual.parcelasAntecipadas;
    conferirParcelas(total, lancadas, antecipadas);

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
        ...(dados.parcelasAntecipadas === undefined
          ? {}
          : { parcelasAntecipadas: dados.parcelasAntecipadas }),
        ...(dados.ehFinanciamento === undefined
          ? {}
          : { ehFinanciamento: dados.ehFinanciamento }),
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
   * Guarda por quanto saiu uma parcela — a antecipada de hoje e a paga há dois
   * anos.
   *
   * **Antecipar** é o caso principal: a parcela ainda estava em aberto, a
   * conta nasceu no IXC com o valor do boleto (que já vem com o desconto do
   * juro que ainda ia correr), e o que entra aqui é qual parcela ela era e por
   * quanto saiu. Ela deixa a fila: a rotina mensal não vai gerá-la de novo. Se
   * era a última que faltava, o contrato acaba.
   *
   * **Informar o valor** é o outro: a parcela já tinha saído — pela rotina,
   * pela contagem do cadastro ("23 pagas, 6 antecipadas") ou antes de tudo
   * isso — e só faltava saber quanto custou. Nada muda de lugar; o que se
   * ganha é a soma do que já se pagou e a economia de cada antecipação.
   *
   * Registrar de novo a mesma parcela corrige o valor, e não duplica: é o
   * caminho do "errei um número".
   */
  async antecipar(
    id: string,
    dados: {
      numero: number;
      /** O que se pagou, já com o desconto. */
      valor: number;
      /** Quanto ela valeria no vencimento. Sem isso, o valor da parcela. */
      valorDeTabela?: number;
      contaId?: string | null;
      idFnApagarIxc?: number | null;
      /** O dia em que foi antecipada (AAAA-MM-DD). Sem isso, hoje. */
      data?: string;
    },
    usuarioId?: string,
  ) {
    const r = await this.prisma.despesaRecorrente.findUnique({
      where: { id },
      include: { antecipadas: { select: { id: true, numero: true } } },
    });
    if (!r) throw new NotFoundException('Despesa recorrente não encontrada');

    const total = r.totalParcelas;
    if (total == null) {
      throw new BadRequestException(
        'Só se antecipa parcela de quem tem parcelas: este é um gasto mensal sem fim marcado.',
      );
    }
    if (!Number.isInteger(dados.numero) || dados.numero < 1 || dados.numero > total) {
      throw new BadRequestException(
        `A parcela ${dados.numero} não existe: o contrato tem ${total}.`,
      );
    }

    const registrada = r.antecipadas.find((a) => a.numero === dados.numero);
    if (registrada) {
      // Corrigir o valor de uma que já está registrada. Nada sai nem volta
      // para a fila: ela já estava fora.
      return this.prisma.parcelaAntecipada.update({
        where: { id: registrada.id },
        data: {
          valor: new Prisma.Decimal(dados.valor),
          ...(dados.valorDeTabela === undefined
            ? {}
            : { valorDeTabela: new Prisma.Decimal(dados.valorDeTabela) }),
          ...(dados.data ? { data: dataUtc(dados.data) } : {}),
          ...(dados.contaId === undefined ? {} : { contaId: dados.contaId }),
          ...(dados.idFnApagarIxc === undefined
            ? {}
            : { idFnApagarIxc: dados.idFnApagarIxc }),
        },
      });
    }

    /*
     * Está dentro da contagem cega do cadastro ("já foram 6 do fim")? Então o
     * que chega não é uma antecipação nova, é o valor de uma que já aconteceu.
     */
    const daContagemDoCadastro =
      r.parcelasAntecipadas > 0 && dados.numero > total - r.parcelasAntecipadas;

    /*
     * Já saiu pela frente: é uma das que a rotina gerou, ou uma das que o
     * cadastro contou como paga. Guardar o valor dela não a tira de lugar
     * nenhum — ela já não estava na fila.
     */
    const jaSaiuPelaFrente = dados.numero <= r.parcelasLancadas;

    const jaSairam = numerosJaSaidos(r);
    /** Estava em aberto: guardar o valor aqui é antecipá-la de verdade. */
    const antecipando = !jaSairam.has(dados.numero);

    const antecipada = await this.prisma.parcelaAntecipada.create({
      data: {
        recorrenteId: id,
        numero: dados.numero,
        valor: new Prisma.Decimal(dados.valor),
        valorDeTabela: new Prisma.Decimal(dados.valorDeTabela ?? Number(r.valor)),
        contaId: dados.contaId ?? null,
        idFnApagarIxc: dados.idFnApagarIxc ?? null,
        data: dados.data ? dataUtc(dados.data) : hojeUtc(),
        criadoPor: usuarioId ?? null,
      },
    });

    if (daContagemDoCadastro && !jaSaiuPelaFrente) {
      /*
       * A parcela saiu da contagem e virou registro. O contador desce um para
       * a mesma parcela não valer duas vezes — o que já estava pago continua
       * pago, e agora com valor.
       */
      await this.prisma.despesaRecorrente.update({
        where: { id },
        data: { parcelasAntecipadas: r.parcelasAntecipadas - 1 },
      });
    } else if (antecipando && jaSairam.size + 1 >= total && r.ativa) {
      // Era a que faltava: o contrato acabou e para de gerar sozinho.
      await this.prisma.despesaRecorrente.update({
        where: { id },
        data: { ativa: false },
      });
    }

    /*
     * Prende a conta ao contrato.
     *
     * Ela nasceu pela tela de lançar despesa, que não sabe de recorrente
     * nenhuma. Com o vínculo, ela passa a contar como conta deste contrato —
     * no histórico, na contagem de geradas, e em qualquer lugar que pergunte o
     * que este financiamento já produziu. Falhar aqui não desfaz nada: o
     * registro da parcela já está gravado, e o histórico a acha pelo id.
     */
    if (dados.contaId) {
      await this.prisma.contaPagar
        .update({ where: { id: dados.contaId }, data: { recorrenteId: id } })
        .catch((err: unknown) => {
          this.logger.warn(
            `A conta ${dados.contaId} não ficou ligada ao contrato: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    this.logger.log(
      `Parcela ${dados.numero}/${total} de ${r.fornecedorNome} ` +
        `${antecipando ? 'antecipada' : 'registrada'} por ` +
        `${dados.valor} (valia ${Number(r.valor)})` +
        (dados.idFnApagarIxc ? `, título ${dados.idFnApagarIxc}` : '') +
        '.',
    );
    return antecipada;
  }

  /**
   * O histórico deste contrato: cada parcela que já virou conta, e cada uma
   * que foi antecipada.
   *
   * O que se responde aqui é "o que já paguei disto?" — e a resposta só existe
   * a partir do dia em que o contrato entrou no sistema. As parcelas pagas
   * antes disso são as contagens do cadastro, e delas não há papel nenhum
   * guardado.
   */
  async historico(id: string) {
    const r = await this.buscar(id);
    const antecipadas = await this.prisma.parcelaAntecipada.findMany({
      where: { recorrenteId: id },
      orderBy: { numero: 'desc' },
    });

    /*
     * As contas deste contrato são de duas procedências.
     *
     * As que a rotina gerou trazem o vínculo (`recorrenteId`) desde que
     * nasceram. As da parcela antecipada nasceram pela tela de lançar conta,
     * que é a mesma de qualquer despesa avulsa e não sabe de contrato nenhum —
     * o que as prende aqui é o registro da antecipação, que guardou o id
     * delas. Procurar só pelo vínculo deixava essas de fora, e a parcela
     * aparecia paga e sem valor: o desconto que se ganhou sumia da tela.
     */
    const contasDasAntecipadas = antecipadas
      .map((a) => a.contaId)
      .filter((x): x is string => !!x);

    const contas = await this.prisma.contaPagar.findMany({
      where: {
        OR: [{ recorrenteId: id }, { id: { in: contasDasAntecipadas } }],
      },
      select: {
        id: true,
        idFnApagarIxc: true,
        valor: true,
        dataVencimento: true,
        observacao: true,
        status: true,
        pagoEm: true,
      },
      orderBy: { dataVencimento: 'desc' },
    });

    const porConta = new Map(
      antecipadas.filter((a) => a.contaId).map((a) => [a.contaId as string, a]),
    );

    const linhas = [
      ...contas.map((c) => {
        const antecipada = porConta.get(c.id);
        return {
          contaId: c.id,
          antecipacaoId: antecipada?.id ?? null,
          // O número do registro manda, quando há um: ele é o que foi
          // escolhido na tela. Sem registro, vale o "(12/60)" da observação —
          // é onde a rotina o escreve, e o mesmo que a lista de contas lê.
          numero: antecipada?.numero ?? numeroDaParcela(c.observacao),
          valor: c.valor.toString(),
          valorDeTabela: (antecipada?.valorDeTabela ?? r.valor).toString(),
          data: c.dataVencimento,
          status: c.status,
          pagoEm: c.pagoEm,
          idFnApagarIxc: c.idFnApagarIxc,
          antecipada: !!antecipada,
        };
      }),
      // As antecipadas sem conta: as pagas por fora, antes de o contrato
      // entrar aqui — e as cuja conta sumiu do IXC.
      ...antecipadas
        .filter((a) => !a.contaId || !contas.some((c) => c.id === a.contaId))
        .map((a) => ({
          contaId: null,
          antecipacaoId: a.id,
          numero: a.numero,
          valor: a.valor.toString(),
          valorDeTabela: a.valorDeTabela.toString(),
          data: a.data,
          status: null,
          pagoEm: a.data,
          idFnApagarIxc: a.idFnApagarIxc,
          antecipada: true,
        })),
    ].sort((x, y) => y.data.getTime() - x.data.getTime());

    return { linhas };
  }

  /**
   * Desfaz o registro de uma antecipação — o lançamento errou a parcela, ou a
   * conta foi cancelada no IXC.
   *
   * A conta a pagar não é tocada: se ela nasceu lá, é lá que se cancela. O que
   * volta aqui é a parcela para a fila, e a rotina volta a gerá-la no mês dela.
   */
  async desfazerAntecipacao(id: string, antecipacaoId: string): Promise<void> {
    const antecipada = await this.prisma.parcelaAntecipada.findUnique({
      where: { id: antecipacaoId },
    });
    if (!antecipada || antecipada.recorrenteId !== id) {
      throw new NotFoundException('Antecipação não encontrada');
    }
    await this.prisma.parcelaAntecipada.delete({ where: { id: antecipacaoId } });
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
      include: { antecipadas: { select: { numero: true } } },
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
       * religado: a parcela 61 de 60 seria uma dívida inventada. As
       * antecipadas contam: elas já foram pagas, cada uma no número dela.
       */
      const total = r.totalParcelas;
      const jaSairam = numerosJaSaidos(r);
      if (total != null && jaSairam.size >= total) continue;

      // Recorrente comum gera uma por mês; consórcio, quantas vencem juntas.
      const porMes = total != null ? Math.max(1, r.parcelasPorMes) : 1;
      let lancadas = r.parcelasLancadas;
      let noMes = r.lancadasNoMes;

      try {
        for (;;) {
          /*
           * A próxima da frente que ainda não saiu.
           *
           * A parcela antecipada é pulada: ela já foi paga por fora, com o
           * boleto com desconto, e gerá-la de novo seria cobrar a mesma coisa
           * duas vezes.
           */
          const numero =
            total != null ? proximaEmAberto(lancadas, jaSairam, total) : lancadas + 1;
          if (numero == null) break;
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

          if (total != null) jaSairam.add(numero);
          lancadas = total != null ? numero : lancadas + 1;
          noMes += 1;
          const quitou = total != null && jaSairam.size >= total;
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

    await this.completarCategorias(usuarioId);
    return resultado;
  }

  /**
   * Põe a categoria da recorrente nas contas dela que nasceram sem.
   *
   * A etiqueta é gravada logo depois que o IXC devolve o número do título, e
   * uma falha nesse instante (o banco ou o IXC oscilando de madrugada) deixava
   * a parcela "sem classificação" para sempre: a conta já tinha nascido, e
   * nenhuma rodada seguinte olhava para ela de novo. Aqui cada rodada confere.
   *
   * Só as da última semana: uma etiqueta tirada à mão, dias depois, é decisão
   * de alguém, e a rotina não a desfaz.
   */
  private async completarCategorias(usuarioId?: string): Promise<void> {
    try {
      const semana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const contas = await this.prisma.contaPagar.findMany({
        where: {
          createdAt: { gte: semana },
          idFnApagarIxc: { not: null },
          recorrente: { categoriaId: { not: null } },
        },
        select: {
          idFnApagarIxc: true,
          recorrente: { select: { categoriaId: true } },
        },
      });
      if (contas.length === 0) return;

      const jaTem = new Set(
        (
          await this.prisma.classificacaoConta.findMany({
            where: {
              idFnApagar: { in: contas.map((c) => c.idFnApagarIxc!) },
            },
            select: { idFnApagar: true },
          })
        ).map((c) => c.idFnApagar),
      );

      for (const c of contas) {
        const id = c.idFnApagarIxc!;
        const categoriaId = c.recorrente?.categoriaId;
        if (jaTem.has(id) || !categoriaId) continue;
        await this.categorias.classificar(id, categoriaId, usuarioId);
        this.logger.log(`Conta ${id} ganhou a categoria que faltou ao nascer.`);
      }
    } catch (err) {
      this.logger.warn(
        `Não deu para completar as categorias: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Os números de parcela que já saíram deste contrato.
 *
 * Três origens somadas: as que a rotina gerou pela frente (1 até
 * `parcelasLancadas`), as que já estavam antecipadas quando o contrato entrou
 * aqui (as últimas, contadas do fim) e as que foram antecipadas uma a uma por
 * esta tela. São um conjunto, e não uma soma, porque as pontas podem se
 * encontrar — e contar duas vezes a mesma parcela faria o contrato acabar
 * antes da hora.
 */
export function numerosJaSaidos(r: {
  totalParcelas: number | null;
  parcelasLancadas: number;
  parcelasAntecipadas: number;
  antecipadas?: Array<{ numero: number }>;
}): Set<number> {
  const usados = new Set<number>();
  const total = r.totalParcelas ?? 0;
  for (let n = 1; n <= r.parcelasLancadas; n += 1) usados.add(n);
  for (let i = 0; i < r.parcelasAntecipadas; i += 1) {
    const n = total - i;
    if (n >= 1) usados.add(n);
  }
  for (const a of r.antecipadas ?? []) usados.add(a.numero);
  return usados;
}

/** O "(12/60)" que a rotina escreve no fim da observação vira o 12. */
function numeroDaParcela(observacao: string): number | null {
  const achou = /\((\d+)\/(\d+)\)\s*/.exec(observacao);
  return achou ? Number(achou[1]) : null;
}

/** A próxima depois de `ultima` que ainda não saiu, ou null se não há mais. */
function proximaEmAberto(
  ultima: number,
  jaSairam: Set<number>,
  total: number,
): number | null {
  for (let n = ultima + 1; n <= total; n += 1) {
    if (!jaSairam.has(n)) return n;
  }
  return null;
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
 *
 * As antecipadas entram na mesma conta: as da frente e as do fim caminham uma
 * em direção à outra, e juntas nunca passam do total.
 */
function conferirParcelas(
  total: number | undefined | null,
  lancadas: number | undefined,
  antecipadas?: number,
): void {
  if (total == null || lancadas == null) return;
  const doFim = antecipadas ?? 0;
  if (lancadas + doFim > total) {
    throw new BadRequestException(
      doFim > 0
        ? `Já saíram ${lancadas} parcelas e ${doFim} antecipadas do fim, mas o contrato tem ${total}. Confira os números.`
        : `Já saíram ${lancadas} parcelas, mas o consórcio tem ${total}. Confira os dois números.`,
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
