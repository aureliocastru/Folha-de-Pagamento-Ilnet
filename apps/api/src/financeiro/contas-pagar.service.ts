import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ContaPagar,
  FeriasMarcada,
  OrigemLancamento,
  Prisma,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import {
  aprenderTipoChavePix,
  buildAuditoriaPayload,
  buildContaPagarPayload,
  inferirTipoChavePix,
  lerSituacaoContaPagar,
  lerStatusAuditoria,
  normalizarTipoChavePix,
  pareceCodigoDeBoleto,
  parseCodigosTipoChavePix,
  serializarCodigosTipoChavePix,
  somenteDigitosDoBoleto,
  type MapaTipoChavePix,
  type StatusAuditoriaIxc,
  type TipoChavePix,
} from '../ixc/ixc.financeiro';
import { FaltasService } from '../funcionarios/faltas.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigFinanceiraService } from './config-financeira.service';
import { FornecedorService } from './fornecedor.service';
import {
  ValesService,
  type AcertoValeCompetencia,
} from '../vales/vales.service';
import {
  baseParaFerias,
  calcularAdiantamento,
  competenciaAnterior,
  competenciaSeguinte,
  detalharSalario,
  montarLancamentosFolha,
  renderObs,
  type ComposicaoSalario,
  type DadosFolhaFuncionario,
  type LancamentoCalculado,
} from './folha.calc';
import { CriarContasPagarDto, ItemContaPagarDto } from './dto/criar-contas.dto';
import { PrepararFolhaDto } from './dto/preparar-folha.dto';
import { QueryContasPagarDto } from './dto/query-contas.dto';

/** Situação do adiantamento do dia 25 na competência da prévia. */
export interface SituacaoAdiantamento {
  /** Valor apurado para o dia 25 (cadastro, lançamento ou percentual). */
  valor: number;
  /** Foi abatido do saldo salarial desta prévia? */
  descontado: boolean;
  /** PAGO = retorno do banco; PENDENTE = gerado, ainda não pago. */
  situacao: 'PAGO' | 'PENDENTE' | 'NAO_GERADO';
  /** Status cru da conta a pagar do dia 25, quando existe. */
  status: StatusContaPagar | null;
  pagoEm: Date | null;
}

/**
 * Férias da pessoa no mês trabalhado, e o que elas mudam na folha dela.
 *
 * Quem entra de férias não recebe salário naquele mês: recebe o valor que a
 * contabilidade apurou. E não recebe o adiantamento do dia 25 — adiantamento é
 * sobre o mês que se está trabalhando, e quem está de férias não está.
 *
 * Nada aqui decide sozinho: é o que a folha **sabe** sobre as férias, para a
 * tela sugerir e explicar. Quem marca é quem gera a folha.
 */
export interface FeriasNaFolha {
  /**
   * Férias registradas na tela de Férias que alcançam o mês trabalhado.
   * null = ninguém registrou nada (o que não impede marcar à mão).
   */
  periodo: { inicio: Date; fim: Date; dias: number } | null;
  /** As férias pegam o dia 25 — o dia em que o adiantamento é pago. */
  noDia25: boolean;
  /** Pagamento de férias que já saiu por este mês trabalhado. */
  jaGerado: ContaJaGerada | null;
  /**
   * Pelo que a folha sabe, esta pessoa está de férias neste mês: ou as férias
   * pegam o dia 25, ou o pagamento delas já foi gerado. É o que faz o dia 25
   * nascer desmarcado.
   */
  deFerias: boolean;
  /** Ponto de partida do valor; o certo vem da contabilidade (ver `baseParaFerias`). */
  valorSugerido: number;
  /** Conta contábil e observação com que o lançamento de férias sai no IXC. */
  contaContabil: number;
  observacao: string;
}

export interface PreviewFuncionario {
  funcionarioId: string;
  nome: string;
  /** Como a pessoa é chamada; é por ele que a busca da tela também acha. */
  apelido: string | null;
  carteiraAssinada: boolean;
  recebeAdiantamento: boolean;
  /** null para quem não recebe adiantamento no dia 25. */
  adiantamento: SituacaoAdiantamento | null;
  /** Como o saldo salarial foi montado (proventos e descontos do mês). */
  composicao: ComposicaoSalario;
  /** Parcelas de vale/acerto que mexeram nesta competência. */
  vales: AcertoValeCompetencia['parcelas'];
  /** Conta de SALÁRIO que já existe nesta competência (null = ainda não). */
  salarioJaGerado: ContaJaGerada | null;
  /** Conta de BÔNUS que já existe nesta competência (null = ainda não). */
  bonusJaGerado: ContaJaGerada | null;
  /** O que a folha sabe sobre as férias desta pessoa no mês trabalhado. */
  ferias: FeriasNaFolha;
  lancamentos: LancamentoCalculado[];
}

/** O que a conferência com o IXC descobriu sobre uma conta. */
export interface ResultadoSincronizacao {
  /** null = não existe mais no IXC e foi apagada daqui também. */
  conta: ContaPagar | null;
  removida: boolean;
  /** O IXC mudou a situação da conta (pagou, aprovou, reprovou, cancelou). */
  mudouStatus: boolean;
  statusAnterior: StatusContaPagar;
}

export interface ResumoSincronizacao {
  verificadas: number;
  pagas: number;
  /** Sumiram do IXC e foram apagadas daqui. */
  removidas: number;
  /** Mudaram de situação por causa do IXC (inclui as pagas). */
  atualizadas: number;
  erros: number;
}

/** Conta que ficou de fora de uma ação em massa, e por quê. */
export interface FalhaLote {
  id: string;
  beneficiario: string;
  erro: string;
}

/** O que aconteceu numa ação feita em várias contas de uma vez. */
export interface ResultadoLote {
  total: number;
  sucesso: number;
  falhas: FalhaLote[];
}

/** Por quantos dias uma conta paga continua sendo conferida no IXC. */
const DIAS_CONFERE_PAGA = 90;

/** Quanto esperar antes de tentar de novo a tabela de auditoria do IXC. */
const PAUSA_AUDITORIA_MS = 5 * 60_000;

/**
 * Espera entre duas buscas do formato do "Tipo da chave Pix" no IXC. Curto de
 * propósito: quem acabou de marcar o tipo à mão numa conta lá quer reenviar e
 * ver funcionar, não esperar.
 */
const ESPERA_APRENDER_PIX_MS = 60_000;

/**
 * Como a categoria da folha costuma se chamar.
 *
 * Serve para achá-la uma vez, quando a configuração ainda não aponta para
 * nenhuma — daí em diante quem manda é o id guardado, e o nome pode virar o
 * que o usuário quiser.
 */
const NOMES_DA_FOLHA = ['Salários', 'Salarios', 'Salário', 'Salario'];

@Injectable()
export class ContasPagarService {
  private readonly logger = new Logger(ContasPagarService.name);
  /** Até quando parar de consultar a tabela de auditoria (ver `auditoriaNoIxc`). */
  private auditoriaIndisponivelAte = 0;
  /**
   * Quando foi a última ida ao IXC atrás do formato do "Tipo da chave Pix".
   * O que se aprende fica no banco; isto só evita repetir a busca em rajada.
   */
  private ultimaTentativaPix = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly config: ConfigFinanceiraService,
    private readonly fornecedores: FornecedorService,
    private readonly vales: ValesService,
    private readonly faltas: FaltasService,
  ) {}

  // -------------------------------------------------------------------------
  // 1) Preview: calcula os lançamentos sugeridos (não persiste nada)
  // -------------------------------------------------------------------------
  async prepararFolha(dto: PrepararFolhaDto): Promise<PreviewFuncionario[]> {
    const cfg = await this.config.obter();
    // Só entra na folha quem o filtro do IXC marcou como funcionário
    // (fornecedor ativo + ICMS isento). Ver [[project]].
    const where: Prisma.FuncionarioWhereInput = { ativo: true, isentoIcms: true };
    if (dto.funcionarioIds?.length) where.id = { in: dto.funcionarioIds };

    // Salário e bônus se referem ao mês trabalhado (o anterior); só o
    // adiantamento do dia 25 fala do mês corrente. Vendas e horas extras são
    // do mês trabalhado; a parcela do vale é do mês em que se paga.
    //
    // A tela manda o mês trabalhado por escrito porque no dia 25 ele **é** a
    // competência (o adiantamento é pago dentro do próprio mês). Sem isso, os
    // dois pagamentos do mesmo mês trabalhado não se enxergariam — e é
    // justamente o que faz o dia 25 saber quem já recebeu férias.
    const mesTrabalhado =
      dto.mesTrabalhado ?? competenciaAnterior(dto.competencia);

    const funcionarios = await this.prisma.funcionario.findMany({
      where,
      include: {
        // Fixos (sem competência) + avulsos desta competência
        /*
         * O avulso é do mês trabalhado, como a venda ao lado dele na tela.
         *
         * Ele saía pela competência do pagamento, e isso obrigava quem lança a
         * saber em qual das duas parcelas do mês o valor ia cair — o dia 25 é
         * pago dentro do próprio mês trabalhado, o saldo no quinto dia do
         * seguinte. Dois campos de mês na mesma ficha querendo coisas opostas.
         *
         * Não paga em dobro: as duas rodadas do mesmo mês trabalhado geram
         * parcelas diferentes (o dia 25 só o adiantamento; o quinto dia o
         * salário e o bônus). O desconto entra no saldo, que é do quinto dia; o
         * bônus, idem; e o adiantamento lançado passa a valer nas duas — que é
         * o certo, porque antes o dia 25 usava o valor lançado e o saldo do mês
         * seguinte descontava o percentual, dois números para o mesmo dinheiro.
         */
        lancamentos: {
          where: {
            ativo: true,
            OR: [{ competencia: null }, { competencia: mesTrabalhado }],
          },
        },
        variaveisMes: { where: { competencia: mesTrabalhado } },
      },
      orderBy: { nome: 'asc' },
    });

    const params = {
      contaContabilSalario: cfg.contaContabilSalario,
      contaContabilAdiantamento: cfg.contaContabilAdiantamento,
      contaContabilBonus: cfg.contaContabilBonus,
      obsSalario: renderObs(cfg.obsSalarioTemplate, mesTrabalhado),
      obsAdiantamento: renderObs(cfg.obsAdiantamentoTemplate, dto.competencia),
      obsBonus: renderObs(cfg.obsBonusTemplate, mesTrabalhado),
      percentualAdiantamento: cfg.percentualAdiantamento,
    };

    // Situação do adiantamento do dia 25 desta competência, para mostrar na
    // folha do quinto dia se o valor descontado do salário já foi mesmo pago.
    const ids = funcionarios.map((f) => f.id);
    const contasDia25 = await this.contasPorTipo(
      dto.competencia,
      ids,
      TipoLancamento.ADIANTAMENTO,
    );
    // Salário e bônus já gerados nesta competência: gerar de novo paga duas
    // vezes. Vale para os dois — o bônus é um pagamento como qualquer outro.
    const contasSalario = await this.contasPorTipo(
      dto.competencia,
      ids,
      TipoLancamento.SALARIO,
    );
    const contasBonus = await this.contasPorTipo(
      dto.competencia,
      ids,
      TipoLancamento.BONUS,
    );
    // Pagamento de férias deste mês trabalhado. Ele sai na folha do quinto dia
    // (o mês trabalhado paga no seguinte), e é por isso que a busca é sempre no
    // mês de pagamento — inclusive quando quem pergunta é a folha do dia 25.
    const contasFerias = await this.contasPorTipo(
      competenciaSeguinte(mesTrabalhado),
      ids,
      TipoLancamento.FERIAS,
    );
    // Quem a tela de Férias já mandou para férias dentro deste mês.
    const feriasMarcadas = await this.feriasDoMes(mesTrabalhado, ids);

    // Vales e acertos só mexem no salário; no dia 25 não há o que abater.
    const acertosVale: Map<string, AcertoValeCompetencia> =
      (dto.incluirSalario ?? true)
        ? await this.vales.acertosDaCompetencia(dto.competencia, ids)
        : new Map();

    /*
     * As faltas do mês trabalhado, pelo mesmo motivo: elas descontam do saldo
     * salarial, e o adiantamento do dia 25 é percentual do salário base — não
     * do que sobrou dele.
     *
     * A busca é do mês **trabalhado**, e não da competência de pagamento: a
     * falta aconteceu no mês em que a pessoa não veio.
     */
    const descontoFaltas: Map<string, number> = (dto.incluirSalario ?? true)
      ? await this.faltas.descontoDaCompetencia(
          mesTrabalhado,
          funcionarios
            .filter((f) => !f.carteiraAssinada)
            .map((f) => ({ id: f.id, salarioBase: Number(f.salarioBase) })),
        )
      : new Map();

    return funcionarios.map((f) => {
      const somaTipo = (tipo: TipoLancamento) =>
        f.lancamentos
          .filter((l) => l.tipo === tipo)
          .reduce((s, l) => s + Number(l.valor), 0);

      const variaveis = f.variaveisMes[0];
      const vale = acertosVale.get(f.id);

      const dados: DadosFolhaFuncionario = {
        salarioBase: Number(f.salarioBase),
        carteiraAssinada: f.carteiraAssinada,
        // Carteira assinada: a folha daqui trabalha em cima do combinado.
        valorAReceberFolha:
          f.valorAReceberFolha === null ? null : Number(f.valorAReceberFolha),
        recebeAdiantamento: f.recebeAdiantamento,
        valorAdiantamento:
          f.valorAdiantamento === null ? null : Number(f.valorAdiantamento),
        adiantamentoFixo: somaTipo(TipoLancamento.ADIANTAMENTO),
        descontosFixos: somaTipo(TipoLancamento.DESCONTO),
        bonusFixo: somaTipo(TipoLancamento.BONUS),
        vendas: variaveis?.vendas ?? 0,
        // O valor por venda do mês vence o do cadastro (ex.: campanha).
        valorPorVenda: Number(
          variaveis?.valorPorVenda ?? f.valorPorVenda ?? 0,
        ),
        horasExtras: Number(variaveis?.horasExtras ?? 0),
        descontoVales: vale?.desconto ?? 0,
        creditoVales: vale?.credito ?? 0,
        descontoFaltas: descontoFaltas.get(f.id) ?? 0,
      };

      const lancamentos = montarLancamentosFolha(dados, params, {
        incluirAdiantamento: dto.incluirAdiantamento ?? true,
        incluirSalario: dto.incluirSalario ?? true,
        incluirBonus: dto.incluirBonus ?? true,
      });

      const valorAdiantamento = calcularAdiantamento(
        dados,
        cfg.percentualAdiantamento,
      );
      const composicao = detalharSalario(dados, cfg.percentualAdiantamento);

      return {
        funcionarioId: f.id,
        nome: f.nome,
        apelido: f.apelido,
        carteiraAssinada: f.carteiraAssinada,
        recebeAdiantamento: f.recebeAdiantamento,
        adiantamento:
          valorAdiantamento > 0
            ? montarSituacaoAdiantamento(
                valorAdiantamento,
                // O desconto no saldo só acontece para quem não tem carteira.
                !f.carteiraAssinada,
                contasDia25.get(f.id) ?? null,
              )
            : null,
        composicao,
        vales: vale?.parcelas ?? [],
        salarioJaGerado: montarContaJaGerada(contasSalario.get(f.id) ?? null),
        bonusJaGerado: montarContaJaGerada(contasBonus.get(f.id) ?? null),
        ferias: montarFeriasNaFolha({
          marcada: feriasMarcadas.get(f.id) ?? null,
          jaGerado: montarContaJaGerada(contasFerias.get(f.id) ?? null),
          mesTrabalhado,
          composicao,
          contaContabil: cfg.contaContabilFerias,
          observacao: renderObs(cfg.obsFeriasTemplate, mesTrabalhado),
        }),
        lancamentos,
      };
    });
  }

  /**
   * Quem, entre estes funcionários, está de férias em algum dia do mês
   * trabalhado, pelo que a tela de Férias registrou.
   *
   * Só acha quem tem o cadastro daqui ligado ao registro de férias — o
   * relatório da contabilidade não traz CPF, e o vínculo é feito pelo nome.
   * Sem vínculo a folha simplesmente não sabe, e quem gera marca à mão.
   */
  private async feriasDoMes(
    mesTrabalhado: string,
    funcionarioIds: string[],
  ): Promise<Map<string, FeriasMarcada>> {
    if (funcionarioIds.length === 0) return new Map();
    const { primeiroDia, ultimoDia } = limitesDoMes(mesTrabalhado);

    // Pega tudo que encosta no mês: quem sai dia 28 e volta em setembro está
    // de férias em agosto do mesmo jeito que quem passou o mês inteiro fora.
    const marcadas = await this.prisma.feriasMarcada.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        inicio: { lte: ultimoDia },
        fim: { gte: primeiroDia },
      },
      orderBy: { inicio: 'asc' },
    });

    const mapa = new Map<string, FeriasMarcada>();
    for (const m of marcadas) {
      if (!m.funcionarioId) continue;
      const atual = mapa.get(m.funcionarioId);
      // Havendo mais de um período no mesmo mês, o que pega o dia 25 manda: é
      // ele que responde pelo adiantamento.
      if (!atual || (pegaODia25(m, mesTrabalhado) && !pegaODia25(atual, mesTrabalhado))) {
        mapa.set(m.funcionarioId, m);
      }
    }
    return mapa;
  }

  /** Conta a pagar daquele tipo, por funcionário, na competência. */
  private async contasPorTipo(
    competencia: string,
    funcionarioIds: string[],
    tipo: TipoLancamento,
  ): Promise<Map<string, ContaAdiantamento>> {
    if (funcionarioIds.length === 0) return new Map();
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        competencia,
        tipo,
        funcionarioId: { in: funcionarioIds },
      },
      select: { funcionarioId: true, status: true, pagoEm: true },
      orderBy: { createdAt: 'desc' },
    });

    const mapa = new Map<string, ContaAdiantamento>();
    for (const c of contas) {
      if (!c.funcionarioId) continue;
      // Se houver mais de uma, a paga vence; senão fica a mais recente.
      const atual = mapa.get(c.funcionarioId);
      if (!atual || (c.status === StatusContaPagar.PAGO && !atual.pago)) {
        mapa.set(c.funcionarioId, {
          status: c.status,
          pago: c.status === StatusContaPagar.PAGO,
          pagoEm: c.pagoEm,
        });
      }
    }
    return mapa;
  }

  // -------------------------------------------------------------------------
  // 2) Criar: persiste localmente e envia ao IXC (fn_apagar)
  // -------------------------------------------------------------------------
  async criar(
    dto: CriarContasPagarDto,
    usuarioId?: string,
  ): Promise<ContaPagar[]> {
    const criadas: ContaPagar[] = [];
    for (const item of dto.itens) {
      const conta = await this.criarItem(item, usuarioId);
      criadas.push(conta);
    }
    // O salário do mês saiu com a parcela do vale já abatida: dá baixa nela.
    await this.baixarParcelasDeVale(criadas);
    return criadas;
  }

  /**
   * Uma conta a pagar lançada à mão: energia, aluguel, material de construção.
   *
   * É o mesmo caminho da folha até o IXC — vira `fn_apagar` pelo `enviarIxc`,
   * com a mesma auditoria e o mesmo acompanhamento de pagamento —, mas sem
   * pessoa nenhuma do lado de cá: quem recebe é um fornecedor que já existe no
   * IXC, escolhido na tela. Por isso o `idFornecedorIxc` vem preenchido e o
   * tipo é DESPESA, que é o que a impede de ser contada como pagamento de
   * alguém nos resumos da folha.
   *
   * As datas vêm de fora, ao contrário da folha, onde emissão e vencimento são
   * sempre hoje: conta que chega pelo correio venceu (ou vence) num dia que não
   * é o de hoje, e mentir a data aqui é mentir o fluxo de caixa lá na frente.
   */
  async criarDespesa(
    dados: {
      idFornecedorIxc: number;
      fornecedorNome: string;
      valor: number;
      dataEmissao: Date;
      dataVencimento: Date;
      observacao: string;
      contaContabil?: number;
      contaPagamento?: number;
      tipoPagamentoIxc?: string;
      codigoBarras?: string | null;
      documento?: string | null;
      numeroNota?: string | null;
      chavePix?: string | null;
      tipoChavePix?: string | null;
    },
    usuarioId?: string,
  ): Promise<ContaPagar> {
    const cfg = await this.config.obter();

    const codigoBarras = somenteDigitosDoBoleto(dados.codigoBarras) || null;
    // Boleto sem código chega ao IXC sem como ser pago: melhor recusar aqui,
    // com a conta ainda não criada, do que deixar um título parado lá.
    if (
      /boleto/i.test(dados.tipoPagamentoIxc ?? '') &&
      codigoBarras &&
      !pareceCodigoDeBoleto(codigoBarras)
    ) {
      throw new BadRequestException(
        `O código do boleto tem ${codigoBarras.length} dígitos — o esperado é ` +
          '44, 47 ou 48. Confira a linha digitável.',
      );
    }

    const conta = await this.prisma.contaPagar.create({
      data: {
        tipo: TipoLancamento.DESPESA,
        // Despesa só existe no Contas a Pagar — não há caminho da folha até
        // aqui, e marcar na origem também evita depender só do tipo.
        origem: OrigemLancamento.CONTAS_PAGAR,
        competencia: null,
        beneficiarioNome: dados.fornecedorNome,
        idFornecedorIxc: dados.idFornecedorIxc,
        valor: new Prisma.Decimal(dados.valor),
        contaContabil: dados.contaContabil ?? cfg.contaContabilAvulso,
        contaPagamento: dados.contaPagamento ?? cfg.contaPagamentoId,
        tipoPagamentoIxc: dados.tipoPagamentoIxc ?? null,
        filialId: cfg.filialId,
        dataEmissao: dados.dataEmissao,
        dataVencimento: dados.dataVencimento,
        observacao: dados.observacao,
        codigoBarras,
        documento: dados.documento?.trim() || null,
        numeroNota: dados.numeroNota?.trim() || null,
        chavePix: dados.chavePix?.trim() || null,
        tipoChavePix: dados.tipoChavePix?.trim() || null,
        status: StatusContaPagar.RASCUNHO,
        criadoPor: usuarioId ?? null,
      },
    });

    this.logger.log(
      `Despesa lançada à mão para o fornecedor ${dados.idFornecedorIxc} ` +
        `(${dados.fornecedorNome}): ${dados.valor}` +
        (codigoBarras ? ' (com boleto)' : ''),
    );

    const enviada = await this.enviarIxc(conta.id);

    /*
     * Já aprovada na auditoria: conta criada por API nasce sem auditoria, e o
     * IXC só mostra para pagar o que passou por lá — a conta chegava e ficava
     * invisível para quem ia pagá-la. Quem lança daqui já decidiu que a conta é
     * devida; aprovar é o passo que faltava para ela aparecer pronta no
     * financeiro do IXC.
     *
     * Falhar aqui não derruba o lançamento: a conta existe no IXC e pode ser
     * aprovada pela lista, num clique.
     */
    if (enviada.idFnApagarIxc) {
      try {
        await this.ixc.create(
          'fn_apagar_auditoria',
          buildAuditoriaPayload({
            idFnApagar: enviada.idFnApagarIxc,
            status: 'A',
            motivo: 'Lançada e aprovada pelo ILNET FINANCE',
            operador: '',
          }),
        );
        return this.prisma.contaPagar.update({
          where: { id: enviada.id },
          data: {
            status: StatusContaPagar.APROVADO,
            aprovadoEm: new Date(),
            aprovadoPor: usuarioId ?? null,
          },
        });
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Conta ${enviada.idFnApagarIxc} foi criada, mas a aprovação ` +
            `automática falhou: ${motivo}`,
        );
      }
    }

    return enviada;
  }

  /**
   * Fecha as parcelas de vale que entraram nos salários recém-gerados,
   * guardando qual conta consumiu cada uma. A partir daí a parcela sai do
   * cálculo — gerar a folha de novo não desconta o mesmo vale duas vezes.
   *
   * Só o salário baixa vale. Férias não: o valor delas é o que a contabilidade
   * apurou, digitado à mão, e não tem o vale dentro — dar baixa ali quitaria
   * uma parcela que ninguém pagou. Ela fica em aberto para a folha seguinte,
   * que é quando a pessoa volta a receber salário.
   */
  private async baixarParcelasDeVale(contas: ContaPagar[]): Promise<void> {
    for (const c of contas) {
      if (c.tipo !== TipoLancamento.SALARIO) continue;
      if (!c.funcionarioId || !c.competencia) continue;
      await this.vales.baixarNaFolha(c.id, c.competencia, c.funcionarioId);
    }
  }

  private async criarItem(
    item: ItemContaPagarDto,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    if (!item.funcionarioId && !item.beneficiarioAvulsoId && !item.diaristaId) {
      throw new BadRequestException(
        'Informe funcionarioId, beneficiarioAvulsoId ou diaristaId',
      );
    }
    const cfg = await this.config.obter();
    const hoje = hojeUtc();

    const contaContabil =
      item.contaContabil ?? contaContabilPorTipo(item.tipo, cfg);
    const observacao =
      item.observacao ?? obsPorTipo(item.tipo, item.competencia ?? null, cfg);

    const beneficiarioNome = await this.resolverNome(item);

    // Persiste como RASCUNHO
    const conta = await this.prisma.contaPagar.create({
      data: {
        competencia: item.competencia ?? null,
        tipo: item.tipo,
        // Quem não diz de onde veio é a folha: são os caminhos antigos
        // (salário, adiantamento, bônus, diária), e todos são dela.
        origem: item.origem ?? OrigemLancamento.FOLHA,
        funcionarioId: item.funcionarioId ?? null,
        beneficiarioAvulsoId: item.beneficiarioAvulsoId ?? null,
        diaristaId: item.diaristaId ?? null,
        beneficiarioNome,
        valor: new Prisma.Decimal(item.valor),
        vendas: item.vendas ?? 0,
        comissaoVendas: new Prisma.Decimal(item.comissaoVendas ?? 0),
        contaContabil,
        // Dá para pagar por outra conta que não a padrão (ex.: um caixa).
        contaPagamento: item.contaPagamento ?? cfg.contaPagamentoId,
        tipoPagamentoIxc: item.tipoPagamentoIxc ?? null,
        filialId: cfg.filialId,
        dataEmissao: hoje,
        dataVencimento: hoje,
        observacao,
        status: StatusContaPagar.RASCUNHO,
        criadoPor: usuarioId ?? null,
      },
    });

    return this.enviarIxc(conta.id);
  }

  /** Garante fornecedor e cria o fn_apagar no IXC. */
  async enviarIxc(id: string): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (
      conta.status !== StatusContaPagar.RASCUNHO &&
      conta.status !== StatusContaPagar.ERRO
    ) {
      throw new BadRequestException(
        `Conta já enviada ao IXC (status ${conta.status})`,
      );
    }

    try {
      const idFornecedor = await this.fornecedorDaConta(conta);

      const cfg = await this.config.obter();
      const pix = await this.pixDoBeneficiario(conta);
      // Conta com tipo próprio (ex.: diária em dinheiro) manda no payload.
      const tipoPagamento = conta.tipoPagamentoIxc ?? cfg.tipoPagamentoPadrao;
      // Chave PIX só faz sentido em pagamento por PIX.
      const ehPix = /pix/i.test(tipoPagamento);
      // O tipo que vai ser marcado — é o código dele que precisa ser sabido.
      const tipoChave = pix.tipo ?? inferirTipoChavePix(pix.chave);

      const payload = buildContaPagarPayload({
        idFornecedor,
        valor: Number(conta.valor),
        contaPagamentoId: conta.contaPagamento,
        contaContabilId: conta.contaContabil,
        filialId: conta.filialId,
        dataEmissao: conta.dataEmissao,
        dataVencimento: conta.dataVencimento,
        observacao: conta.observacao,
        tipoPagamento,
        chavePix: ehPix ? pix.chave : null,
        tipoChavePix: ehPix ? pix.tipo : null,
        mapaTipoChave: ehPix ? await this.mapaTipoChavePix(cfg, tipoChave) : null,
        codigoBarras: conta.codigoBarras,
        documento: conta.documento,
        numeroNota: conta.numeroNota,
      });

      const { id: idFnApagar } = await this.ixc.create('fn_apagar', payload);
      if (!idFnApagar) throw new Error('IXC não retornou o id do fn_apagar');

      const salva = await this.prisma.contaPagar.update({
        where: { id },
        data: {
          idFornecedorIxc: idFornecedor,
          idFnApagarIxc: idFnApagar,
          status: StatusContaPagar.AGUARDANDO_APROVACAO,
          erro: null,
        },
      });

      // Aqui é o único ponto em que o título ganha número no IXC — e é por
      // esse número que a etiqueta é guardada.
      await this.etiquetarComoFolha(salva, idFnApagar);
      return salva;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao enviar conta ${id} ao IXC: ${message}`);
      return this.prisma.contaPagar.update({
        where: { id },
        data: { status: StatusContaPagar.ERRO, erro: message },
      });
    }
  }


  /**
   * Os tipos que são folha de pagamento de gente da casa.
   *
   * Diária e avulso ficam de fora. A diária é de diarista, e o avulso tem o
   * próprio campo de categoria na tela em que é lançado — carimbar "Salários"
   * neles seria trocar uma informação melhor por uma pior.
   */
  private static readonly TIPOS_DA_FOLHA = new Set<TipoLancamento>([
    TipoLancamento.SALARIO,
    TipoLancamento.FERIAS,
    TipoLancamento.ADIANTAMENTO,
    TipoLancamento.BONUS,
  ]);

  /**
   * Etiqueta a conta recém-criada como despesa de folha.
   *
   * A folha gera dezenas de contas por mês e nenhuma delas passa pela tela de
   * classificar: quem gera a folha não abre conta por conta para escolher
   * categoria. Sem isto, o maior gasto da empresa era justamente o que ficava
   * fora de todo gráfico por categoria.
   *
   * Não sobrescreve etiqueta que já existe — se alguém classificou aquele
   * título à mão, a escolha de gente manda. E o que falhar aqui não derruba o
   * lançamento: a conta já está no IXC, e uma etiqueta que não colou se resolve
   * na tela de contas em aberto, com dois cliques.
   */
  private async etiquetarComoFolha(
    conta: ContaPagar,
    idFnApagar: number,
  ): Promise<void> {
    if (conta.origem !== OrigemLancamento.FOLHA) return;
    if (!ContasPagarService.TIPOS_DA_FOLHA.has(conta.tipo)) return;

    try {
      const categoriaId = await this.categoriaDoTipo(conta.tipo);
      if (!categoriaId) return;

      await this.prisma.classificacaoConta.upsert({
        where: { idFnApagar },
        create: { idFnApagar, categoriaId },
        // Vazio de propósito: já tendo etiqueta, ela fica como está.
        update: {},
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Conta ${conta.id} foi ao IXC, mas não deu para etiquetá-la como ` +
          `folha: ${message}`,
      );
    }
  }


  /**
   * Etiqueta de uma vez a folha que ficou para trás.
   *
   * A conta da folha passou a nascer etiquetada, e uma migração acertou o que
   * já estava pago. Mas as duas coisas só valem para quem estava lá na hora:
   * conta enviada enquanto a categoria não existia, base em que a migração não
   * achou o que etiquetar, folha gerada por uma versão antiga da API — tudo
   * isso deixa buraco, e buraco em relatório não se vê olhando.
   *
   * Então isto existe como botão, e não como um acerto escondido no arranque:
   * roda quando alguém manda, diz quantas contas etiquetou, e pode rodar de
   * novo sem estragar nada — o que já tem etiqueta não é tocado.
   */
  async etiquetarFolhaSemCategoria(): Promise<{
    etiquetadas: number;
    /** Quantas contas da folha existem ao todo, etiquetadas ou não. */
    daFolha: number;
    /** Sem categoria configurada não há o que etiquetar — e a tela diz isso. */
    semCategoria: boolean;
  }> {
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        origem: OrigemLancamento.FOLHA,
        tipo: { in: [...ContasPagarService.TIPOS_DA_FOLHA] },
        idFnApagarIxc: { not: null },
      },
      select: { idFnApagarIxc: true, tipo: true },
    });
    if (contas.length === 0) {
      return { etiquetadas: 0, daFolha: 0, semCategoria: false };
    }

    /*
     * Quem já tem etiqueta fica como está — inclusive quem tem outra.
     *
     * Alguém pode ter classificado um salário à mão, e escolha de gente não se
     * sobrescreve por lote. Por isso a lista das que faltam é montada aqui, em
     * vez de um `updateMany` que passaria por cima de tudo.
     */
    const ids = [...new Set(contas.map((c) => c.idFnApagarIxc!))];
    const jaTem = await this.prisma.classificacaoConta.findMany({
      where: { idFnApagar: { in: ids } },
      select: { idFnApagar: true },
    });
    const etiquetados = new Set(jaTem.map((c) => c.idFnApagar));

    /*
     * Cada tipo com a etiqueta dele, e a busca da categoria feita uma vez por
     * tipo — e não uma por conta: são oitenta contas para quatro respostas.
     */
    const porCategoria = new Map<string, number[]>();
    let semCategoria = false;
    const categorias = new Map<TipoLancamento, string | null>();

    for (const conta of contas) {
      const idFnApagar = conta.idFnApagarIxc!;
      if (etiquetados.has(idFnApagar)) continue;

      if (!categorias.has(conta.tipo)) {
        categorias.set(conta.tipo, await this.categoriaDoTipo(conta.tipo));
      }
      const categoriaId = categorias.get(conta.tipo) ?? null;
      if (!categoriaId) {
        semCategoria = true;
        continue;
      }

      const fila = porCategoria.get(categoriaId);
      if (fila) fila.push(idFnApagar);
      else porCategoria.set(categoriaId, [idFnApagar]);
    }

    let etiquetadas = 0;
    for (const [categoriaId, deles] of porCategoria) {
      await this.prisma.classificacaoConta.createMany({
        data: deles.map((idFnApagar) => ({ idFnApagar, categoriaId })),
        skipDuplicates: true,
      });
      etiquetadas += deles.length;
    }

    if (etiquetadas > 0) {
      this.logger.log(
        `${etiquetadas} conta(s) da folha etiquetadas de uma vez.`,
      );
    }

    return { etiquetadas, daFolha: ids.length, semCategoria };
  }

  /**
   * Qual categoria um pagamento da folha usa.
   *
   * Primeiro a do próprio tipo — "Adiantamento" para o adiantamento, "Férias"
   * para as férias —, e só depois a geral. Uma etiqueta para a folha inteira
   * responde "quanto custa a folha"; a do tipo responde a pergunta seguinte,
   * que é a que se faz depois de olhar esse número.
   *
   * Tudo sai da configuração, e não de um nome fixo no código: o nome é do
   * usuário, e renomear "Salários" não pode quebrar a automação. Vindo tudo
   * vazio — banco novo, ou configuração criada antes destas colunas —, procura
   * a geral pelo nome uma única vez e guarda o que achou.
   */
  private async categoriaDoTipo(
    tipo: TipoLancamento,
  ): Promise<string | null> {
    const cfg = await this.config.obter();

    const doTipo: Partial<Record<TipoLancamento, string | null>> = {
      [TipoLancamento.SALARIO]: cfg.categoriaSalarioId,
      [TipoLancamento.FERIAS]: cfg.categoriaFeriasId,
      [TipoLancamento.ADIANTAMENTO]: cfg.categoriaAdiantamentoId,
      [TipoLancamento.BONUS]: cfg.categoriaBonusId,
    };
    const escolhida = doTipo[tipo];
    if (escolhida) return escolhida;

    if (cfg.categoriaFolhaId) return cfg.categoriaFolhaId;

    const achada = await this.prisma.categoriaDespesa.findFirst({
      where: { nome: { in: NOMES_DA_FOLHA, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!achada) return null;

    await this.config.definirCategoriaDaFolha(achada.id);
    return achada.id;
  }

  // -------------------------------------------------------------------------
  // 3) Auditoria: aprovar / reprovar (fn_apagar_auditoria)
  // -------------------------------------------------------------------------
  async aprovar(id: string, motivo: string, usuarioId?: string) {
    return this.auditar(id, 'A', motivo, usuarioId);
  }

  async reprovar(id: string, motivo: string, usuarioId?: string) {
    return this.auditar(id, 'R', motivo, usuarioId);
  }

  /**
   * Aprova ou reprova no IXC e reflete aqui. Dá para mudar de ideia nos dois
   * sentidos — reprovada volta a ser aprovada e vice-versa — porque a
   * auditoria do IXC também aceita: só o pagamento confirmado pelo banco é
   * ponto final.
   */
  private async auditar(
    id: string,
    status: 'A' | 'R',
    motivo: string,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    const conta = await this.buscar(id);
    if (!conta.idFnApagarIxc) {
      throw new BadRequestException(
        'Conta ainda não existe no IXC — reenvie antes de aprovar ou reprovar',
      );
    }
    if (conta.status === StatusContaPagar.PAGO) {
      throw new BadRequestException(
        'Conta já paga: o banco confirmou. Estorne o pagamento no IXC antes de auditar de novo.',
      );
    }

    await this.ixc.action(
      'fn_apagar_auditoria',
      buildAuditoriaPayload({
        idFnApagar: conta.idFnApagarIxc,
        status,
        motivo,
      }),
    );

    const atualizada = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        status:
          status === 'A'
            ? StatusContaPagar.AGUARDANDO_PAGAMENTO
            : StatusContaPagar.REPROVADO,
        aprovadoPor: usuarioId ?? null,
        aprovadoEm: new Date(),
        motivoAuditoria: motivo,
      },
    });

    // Reprovada não vira dinheiro: o vale volta a dever. Aprovada de novo:
    // a parcela é abatida outra vez.
    await this.acertarValesPorStatus(atualizada);
    return atualizada;
  }

  /**
   * Mantém as parcelas de vale coerentes com o destino da conta: o que não vai
   * virar pagamento devolve a parcela para pendente; o que voltou a valer
   * desconta de novo. Sem isso o vale ficaria quitado sem ninguém ter pago —
   * ou seria descontado duas vezes.
   */
  private async acertarValesPorStatus(conta: ContaPagar): Promise<void> {
    const naoVaiAcontecer =
      conta.status === StatusContaPagar.REPROVADO ||
      conta.status === StatusContaPagar.CANCELADO;

    if (naoVaiAcontecer) {
      await this.vales.estornarBaixa(conta.id);
      return;
    }
    if (conta.tipo !== TipoLancamento.SALARIO) return;
    if (!conta.competencia || !conta.funcionarioId) return;
    await this.vales.baixarNaFolha(
      conta.id,
      conta.competencia,
      conta.funcionarioId,
    );
  }

  // -------------------------------------------------------------------------
  // 3b) Em massa: aprovar, reprovar e excluir vários de uma vez
  // -------------------------------------------------------------------------
  aprovarEmLote(ids: string[], motivo: string, usuarioId?: string) {
    return this.emLote(ids, (id) => this.aprovar(id, motivo, usuarioId));
  }

  reprovarEmLote(ids: string[], motivo: string, usuarioId?: string) {
    return this.emLote(ids, (id) => this.reprovar(id, motivo, usuarioId));
  }

  removerEmLote(ids: string[]) {
    return this.emLote(ids, (id) => this.remover(id));
  }

  /**
   * Roda a mesma ação em várias contas, uma a uma — cada uma é uma ida ao IXC.
   * Falha em uma não derruba as outras: quem ficou de fora volta na lista de
   * falhas, com nome e motivo, para a tela poder dizer o que não saiu. Sem
   * isso, um lote de 20 pararia na primeira conta já paga.
   */
  private async emLote(
    ids: string[],
    acao: (id: string) => Promise<unknown>,
  ): Promise<ResultadoLote> {
    const unicos = [...new Set(ids)];
    // Os nomes são lidos antes: depois de excluir, a conta não existe mais.
    const contas = await this.prisma.contaPagar.findMany({
      where: { id: { in: unicos } },
      select: { id: true, beneficiarioNome: true },
    });
    const nomes = new Map(contas.map((c) => [c.id, c.beneficiarioNome]));

    const falhas: FalhaLote[] = [];
    let sucesso = 0;
    for (const id of unicos) {
      try {
        await acao(id);
        sucesso++;
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        falhas.push({ id, beneficiario: nomes.get(id) ?? 'Conta', erro });
        this.logger.warn(`Conta ${id} ficou de fora do lote: ${erro}`);
      }
    }
    return { total: unicos.length, sucesso, falhas };
  }

  // -------------------------------------------------------------------------
  // 4) Monitorar no IXC: pagamento, auditoria feita por lá e exclusão
  // -------------------------------------------------------------------------
  /**
   * Traz do IXC o que aconteceu com a conta: se o banco pagou, se alguém
   * aprovou/reprovou/cancelou por lá — e, quando o registro não existe mais,
   * apaga aqui também. O IXC é a fonte da verdade; as duas telas precisam
   * contar a mesma história.
   */
  async sincronizarStatus(id: string): Promise<ResultadoSincronizacao> {
    const conta = await this.buscar(id);
    const statusAnterior = conta.status;
    if (!conta.idFnApagarIxc) {
      return { conta, removida: false, mudouStatus: false, statusAnterior };
    }

    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      conta.idFnApagarIxc,
    );

    // Apagada no IXC: some daqui também.
    if (!raw) {
      await this.apagarLocal(conta.id);
      this.logger.log(
        `Conta ${id} removida daqui: o fn_apagar ${conta.idFnApagarIxc} não existe mais no IXC`,
      );
      return { conta: null, removida: true, mudouStatus: false, statusAnterior };
    }

    const sit = lerSituacaoContaPagar(raw);
    // A auditoria pode não vir no próprio fn_apagar; aí quem sabe é a tabela
    // de auditoria — uma consulta a mais, que só vale a pena quando pagamento
    // e cancelamento ainda não decidiram o assunto sozinhos.
    const auditoria =
      sit.pago || sit.cancelada
        ? null
        : (sit.statusAuditoria ??
          (await this.auditoriaNoIxc(conta.idFnApagarIxc)));

    const novo = statusPeloIxc(conta.status, {
      pago: sit.pago,
      cancelada: sit.cancelada,
      auditoria,
    });

    const data: Prisma.ContaPagarUpdateInput = {
      ixcStatusRaw: raw as Prisma.InputJsonValue,
    };
    if (novo) {
      data.status = novo;
      if (novo === StatusContaPagar.PAGO) {
        data.pagoEm = sit.dataPagamento ?? new Date();
      }
    }

    const atualizada = await this.prisma.contaPagar.update({
      where: { id },
      data,
    });
    if (novo) await this.acertarValesPorStatus(atualizada);

    return {
      conta: atualizada,
      removida: false,
      mudouStatus: novo !== null,
      statusAnterior,
    };
  }

  /**
   * Último registro de auditoria daquele fn_apagar. É o que permite enxergar
   * aqui a aprovação/reprovação feita na tela do IXC. Se a consulta falhar
   * (nome de campo diferente nesta base), devolve null em vez de derrubar a
   * verificação inteira.
   */
  private async auditoriaNoIxc(
    idFnApagar: number,
  ): Promise<StatusAuditoriaIxc | null> {
    // Depois de uma falha, dá um tempo: numa verificação em lote não adianta
    // repetir a mesma consulta quebrada conta a conta.
    if (Date.now() < this.auditoriaIndisponivelAte) return null;
    try {
      const res = await this.ixc.list<Record<string, unknown>>(
        'fn_apagar_auditoria',
        {
          qtype: 'fn_apagar_auditoria.id_fn_apagar',
          query: String(idFnApagar),
          oper: '=',
          sortname: 'fn_apagar_auditoria.id',
          sortorder: 'desc',
          rp: 1,
        },
      );
      const ultimo = res.registros[0];
      return ultimo ? lerStatusAuditoria(ultimo) : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditoriaIndisponivelAte = Date.now() + PAUSA_AUDITORIA_MS;
      this.logger.warn(
        `Não foi possível ler a auditoria do fn_apagar ${idFnApagar}: ${message}`,
      );
      return null;
    }
  }

  /**
   * Confere no IXC todas as contas que ainda podem mudar de lá para cá (para
   * um job/polling). Entram as que não estão pagas — inclusive reprovadas, que
   * podem ter sido liberadas ou apagadas por lá — e as pagas recentes, para
   * pegar exclusão e estorno enquanto o mês ainda está fresco.
   */
  async sincronizarPendentes(): Promise<ResumoSincronizacao> {
    const contas = await this.prisma.contaPagar.findMany({
      where: {
        idFnApagarIxc: { not: null },
        OR: [
          { status: { not: StatusContaPagar.PAGO } },
          {
            status: StatusContaPagar.PAGO,
            updatedAt: { gte: diasAtras(DIAS_CONFERE_PAGA) },
          },
        ],
      },
      select: { id: true },
    });

    let pagas = 0;
    let removidas = 0;
    let atualizadas = 0;
    let erros = 0;
    for (const p of contas) {
      try {
        const r = await this.sincronizarStatus(p.id);
        if (r.removida) removidas++;
        else if (r.mudouStatus) {
          atualizadas++;
          if (r.conta?.status === StatusContaPagar.PAGO) pagas++;
        }
      } catch (err) {
        // Uma conta com falha não deve abortar a verificação das demais.
        erros++;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Falha ao sincronizar conta ${p.id}: ${message}`);
      }
    }
    return { verificadas: contas.length, pagas, removidas, atualizadas, erros };
  }

  // -------------------------------------------------------------------------
  // Consultas / manutenção
  // -------------------------------------------------------------------------
  /**
   * As contas da folha — a tela de Pagamentos do módulo Folha de Pagamento.
   *
   * Nada que tenha nascido no Contas a Pagar entra aqui, seja qual for o tipo:
   * despesa lançada à mão, pagamento avulso a um fornecedor do IXC, o que for.
   * Nesta tela se aprova e se reprova o que a folha gerou; conta de fornecedor
   * entrando no meio bagunça a conferência do mês e os relatórios que saem
   * dela. O filtro por tipo continua porque despesa nasceu antes da coluna de
   * origem existir e os dois caminhos se reforçam.
   */
  async listar(q: QueryContasPagarDto) {
    const where: Prisma.ContaPagarWhereInput = {
      origem: OrigemLancamento.FOLHA,
      tipo: { not: TipoLancamento.DESPESA },
    };
    if (q.status) where.status = q.status;
    if (q.competencia) where.competencia = q.competencia;
    if (q.funcionarioId) where.funcionarioId = q.funcionarioId;
    // Pedir tipo DESPESA aqui não reabre a porta: esta tela é da folha, e o
    // filtro por tipo não pode desfazer a regra acima.
    if (q.tipo && q.tipo !== TipoLancamento.DESPESA) where.tipo = q.tipo;
    if (q.busca?.trim()) where.OR = filtroDeBusca(q.busca.trim());

    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.contaPagar.count({ where }),
      this.prisma.contaPagar.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      itens,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * As despesas que ficaram pelo caminho: gravadas aqui e nunca aceitas pelo
   * IXC.
   *
   * Elas não cabiam em tela nenhuma. `listar` é da folha e exclui despesa por
   * definição; a lista de contas em aberto é lida do IXC, e é justamente lá que
   * estas não estão. O resultado era uma despesa que a pessoa deu por lançada,
   * marcada como erro num canto do banco, sem nada que a mostrasse — e o
   * caminho de volta (reenviar) existindo só na API.
   *
   * O corte é `idFnApagarIxc` vazio, e não o status: é ele que diz "não chegou
   * lá". Rascunho entra junto porque o envio acontece dentro do mesmo pedido
   * que cria a conta — ficar em rascunho é o envio ter morrido no meio, que dá
   * no mesmo lugar.
   */
  async despesasNaoEnviadas(): Promise<ContaPagar[]> {
    return this.prisma.contaPagar.findMany({
      where: {
        tipo: TipoLancamento.DESPESA,
        idFnApagarIxc: null,
        status: {
          in: [StatusContaPagar.ERRO, StatusContaPagar.RASCUNHO],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async buscar(id: string): Promise<ContaPagar> {
    const conta = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!conta) throw new NotFoundException('Conta a pagar não encontrada');
    return conta;
  }

  /**
   * Apaga a conta dos dois lados: primeiro o fn_apagar no IXC, depois o
   * registro daqui. Se o IXC recusar, nada é apagado — as duas telas não podem
   * divergir. Conta já paga fica de fora: dinheiro que saiu é histórico, e o
   * caminho é estornar no IXC (a verificação traz a mudança para cá).
   */
  async remover(id: string): Promise<void> {
    const conta = await this.buscar(id);
    if (conta.status === StatusContaPagar.PAGO) {
      throw new BadRequestException(
        'Esta conta já foi paga — estorne ou apague no IXC e clique em ' +
          '"Verificar" para ela sair daqui.',
      );
    }
    if (conta.idFnApagarIxc) await this.apagarNoIxc(conta.idFnApagarIxc);
    await this.apagarLocal(id);
  }

  /** Apaga o fn_apagar no IXC. Já não existir por lá não é erro. */
  private async apagarNoIxc(idFnApagar: number): Promise<void> {
    try {
      await this.ixc.remove('fn_apagar', idFnApagar);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await this.existeNoIxc(idFnApagar)) {
        throw new BadRequestException(
          `O IXC não apagou a conta (fn_apagar ${idFnApagar}): ${message}`,
        );
      }
      this.logger.warn(
        `fn_apagar ${idFnApagar} já não existia no IXC ao apagar: ${message}`,
      );
    }
  }

  /** Na dúvida (consulta falhou), assume que existe e não apaga nada aqui. */
  private async existeNoIxc(idFnApagar: number): Promise<boolean> {
    try {
      const raw = await this.ixc.getById('fn_apagar', 'fn_apagar.id', idFnApagar);
      return raw !== null;
    } catch {
      return true;
    }
  }

  /** Apaga só o registro local, soltando o que dependia dele. */
  /**
   * Apaga a conta daqui, e com ela o que só existia por causa dela.
   *
   * A diária e o pagamento avulso *são* essa conta a pagar: é ela que paga a
   * pessoa. Apagada a conta, o pagamento não aconteceu — quem tirou a conta da
   * tela de contas a pagar decidiu justamente isso, e o registro tem de sumir
   * junto em vez de virar um pagamento que ninguém consegue explicar.
   *
   * Deixá-los para trás era pior do que inútil: a FK virava null, e aí eles
   * ficavam iguaizinhos a um pagamento em mãos antigo — apareciam "fora do
   * caixa", oferecendo um lançamento na movimentação financeira que ninguém
   * deve fazer, de um dinheiro que nunca saiu.
   *
   * `deleteMany` porque quase sempre não há nada para apagar (conta de folha),
   * e porque o caminho contrário — apagar a diária, que apaga a conta — chega
   * aqui e volta para apagar a diária de novo.
   */
  private async apagarLocal(id: string): Promise<void> {
    // Antes de apagar: a FK vira null e a parcela ficaria baixada sem dono.
    await this.vales.estornarBaixa(id);
    await this.prisma.diaria.deleteMany({ where: { contaPagarId: id } });
    await this.prisma.pagamentoAvulso.deleteMany({
      where: { contaPagarId: id },
    });
    await this.prisma.contaPagar.delete({ where: { id } });
  }

  /**
   * O mesmo apagar, achando a conta pelo número do título no IXC.
   *
   * Existe porque há um segundo caminho que apaga título: o "excluir" da tela
   * de contas a pagar, que conhece o `fn_apagar` e não o id daqui. Ele apagava
   * a `ContaPagar` por conta própria, com um `deleteMany` — e a FK do
   * pagamento avulso, que é `SetNull`, virava null em vez de levar o pagamento
   * junto.
   *
   * O resultado era o pagamento órfão: sem conta a pagar, sem lançamento no
   * caixa, contado como "já saiu" e invisível como pendente. Apagado tem de
   * ficar apagado, e a regra do que vai junto mora num lugar só — aqui.
   */
  async apagarLocalPorTituloIxc(idFnApagar: number): Promise<void> {
    const contas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: idFnApagar },
      select: { id: true },
    });
    for (const c of contas) await this.apagarLocal(c.id);
  }

  /** O fornecedor do IXC de quem vai receber (cria na primeira vez). */
  private async fornecedorDaConta(conta: {
    funcionarioId: string | null;
    beneficiarioAvulsoId: string | null;
    diaristaId: string | null;
    idFornecedorIxc?: number | null;
  }): Promise<number> {
    // Despesa lançada à mão já nasce apontando para um fornecedor escolhido no
    // IXC — não há pessoa daqui de quem derivar o cadastro.
    if (
      conta.idFornecedorIxc &&
      !conta.funcionarioId &&
      !conta.diaristaId &&
      !conta.beneficiarioAvulsoId
    ) {
      return conta.idFornecedorIxc;
    }
    if (conta.funcionarioId) {
      return this.fornecedores.garantirParaFuncionario(conta.funcionarioId);
    }
    if (conta.diaristaId) {
      return this.fornecedores.garantirParaDiarista(conta.diaristaId);
    }
    return this.fornecedores.garantirParaAvulso(conta.beneficiarioAvulsoId!);
  }

  /**
   * Como esta base do IXC guarda o rádio "Tipo da chave Pix" no fn_apagar.
   *
   * Sem isso a conta nasce com a chave preenchida e o tipo em branco, e o
   * pagamento não sai. O nome da coluna e o código de cada tipo variam por
   * instalação, então são aprendidos das contas que já existem no IXC — feitas
   * na tela, onde chave e tipo estão coerentes.
   *
   * O que se descobre fica guardado no banco, tipo a tipo: sabido o código do
   * celular (ou do CPF, do e-mail, da chave aleatória), ele continua sabido
   * depois de reiniciar a API e mesmo que a conta que serviu de exemplo saia
   * das mais recentes do IXC. Só se volta lá quando falta justamente o código
   * do tipo que está para ser enviado.
   */
  private async mapaTipoChavePix(
    cfg: {
      pixCampoTipoChave: string;
      pixCodigosTipoChave: string;
      pixCampoTipoChaveAprendido: string;
      pixCodigosTipoChaveAprendidos: string;
    },
    tipo: TipoChavePix | null,
  ): Promise<MapaTipoChavePix | null> {
    const campoManual = cfg.pixCampoTipoChave.trim();
    const codigosManuais = parseCodigosTipoChavePix(cfg.pixCodigosTipoChave);

    // O informado em Configurações manda; o aprendido preenche o resto. Código
    // só vale dentro da coluna em que foi visto: se a coluna informada à mão
    // não for a mesma de onde se aprendeu, o aprendido não serve.
    const compor = (
      campoAprendido: string,
      codigosAprendidos: Partial<Record<TipoChavePix, string>>,
    ): MapaTipoChavePix | null => {
      const campo = campoManual || campoAprendido;
      if (!campo) return null;
      const herdados = campo === campoAprendido ? codigosAprendidos : {};
      return { campo, codigos: { ...herdados, ...codigosManuais } };
    };

    const campoGuardado = cfg.pixCampoTipoChaveAprendido.trim();
    const codigosGuardados = parseCodigosTipoChavePix(
      cfg.pixCodigosTipoChaveAprendidos,
    );

    const sabido = compor(campoGuardado, codigosGuardados);
    if (sabido && (!tipo || sabido.codigos[tipo])) return sabido;

    // Falta o código deste tipo: vale uma ida ao IXC para tentar descobrir.
    const novo = await this.aprenderEGuardar(campoGuardado, codigosGuardados);
    return novo ? compor(novo.campo, novo.codigos) : sabido;
  }

  /**
   * Descobre o formato no IXC e guarda o que achou.
   *
   * Os códigos se acumulam enquanto a coluna for a mesma — cada tipo é
   * aprendido de um exemplo diferente, e o que já se sabia não se perde. Se o
   * IXC apontar outra coluna, o aprendizado recomeça por ela, porque código de
   * uma coluna não significa nada em outra.
   */
  private async aprenderEGuardar(
    campoGuardado: string,
    codigosGuardados: Partial<Record<TipoChavePix, string>>,
  ): Promise<MapaTipoChavePix | null> {
    // Gerar a folha inteira sem o formato conhecido não vira uma consulta por
    // funcionário: a tentativa se repete de tempos em tempos, não a cada conta.
    const agora = Date.now();
    if (agora - this.ultimaTentativaPix < ESPERA_APRENDER_PIX_MS) return null;
    this.ultimaTentativaPix = agora;

    const novo = await this.aprenderTipoChavePixDoIxc();
    if (!novo) {
      this.logger.warn(
        'Não achei conta a pagar feita na tela do IXC com PIX e o tipo da ' +
          'chave marcado — é dela que o formato é aprendido. Vou mandar o ' +
          'jeito conhecido do IXC (coluna `tipo_pix`, tipo em maiúsculas); se ' +
          'o rádio ficar em branco, marque o tipo à mão numa conta lá (isso ' +
          'destrava aquele pagamento) e a próxima gerada aqui já sai certa, ou ' +
          'informe a coluna em Configurações.',
      );
      return null;
    }

    const codigos =
      novo.campo === campoGuardado
        ? { ...codigosGuardados, ...novo.codigos }
        : novo.codigos;

    await this.config.guardarAprendizadoPix(
      novo.campo,
      serializarCodigosTipoChavePix(codigos),
    );
    this.logger.log(
      `Tipo da chave PIX no fn_apagar: coluna "${novo.campo}" — ` +
        JSON.stringify(codigos),
    );
    return { campo: novo.campo, codigos };
  }

  /** Lê contas a pagar recentes do IXC e deduz o formato do tipo da chave. */
  private async aprenderTipoChavePixDoIxc(): Promise<MapaTipoChavePix | null> {
    try {
      const registros = await this.contasDeReferenciaNoIxc();
      return aprenderTipoChavePix(registros);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Falha ao aprender o tipo da chave PIX: ${message}`);
      return null;
    }
  }

  /**
   * Contas a pagar do IXC que servem de modelo: as feitas **na tela do IXC**.
   *
   * As criadas por este app ficam de fora de propósito — se o formato que ele
   * manda estiver errado, aprender delas seria só confirmar o próprio erro.
   */
  private async contasDeReferenciaNoIxc(): Promise<
    Array<Record<string, unknown>>
  > {
    const res = await this.ixc.list<Record<string, unknown>>('fn_apagar', {
      qtype: 'fn_apagar.id',
      query: '0',
      oper: '>',
      rp: 200,
      sortname: 'fn_apagar.id',
      sortorder: 'desc',
    });

    const nossas = await this.prisma.contaPagar.findMany({
      where: { idFnApagarIxc: { not: null } },
      select: { idFnApagarIxc: true },
    });
    const ignorar = new Set(nossas.map((c) => String(c.idFnApagarIxc)));

    return res.registros.filter((r) => !ignorar.has(String(r.id ?? '')));
  }

  /**
   * O que o app entendeu do "Tipo da chave Pix" nesta base, com as colunas
   * cruas encontradas. É por aqui que se descobre o nome certo quando o rádio
   * continua em branco.
   */
  async diagnosticoTipoChavePix(): Promise<{
    mapa: MapaTipoChavePix | null;
    /** O que já está guardado no banco, de tudo que foi aprendido até aqui. */
    aprendido: MapaTipoChavePix | null;
    campoConfigurado: string;
    codigosConfigurados: Partial<Record<TipoChavePix, string>>;
    /** Colunas do fn_apagar que mencionam PIX, com exemplos de valor. */
    colunasPix: Array<{ coluna: string; valores: string[] }>;
  }> {
    const cfg = await this.config.obter();
    const registros = await this.contasDeReferenciaNoIxc();

    const porColuna = new Map<string, Set<string>>();
    for (const raw of registros) {
      for (const [coluna, valor] of Object.entries(raw)) {
        if (!/pix/i.test(coluna)) continue;
        const s = String(valor ?? '').trim();
        if (!s) continue;
        const vistos = porColuna.get(coluna) ?? new Set<string>();
        porColuna.set(coluna, vistos);
        if (vistos.size < 10) vistos.add(s);
      }
    }

    const campoAprendido = cfg.pixCampoTipoChaveAprendido.trim();
    return {
      mapa: aprenderTipoChavePix(registros),
      aprendido: campoAprendido
        ? {
            campo: campoAprendido,
            codigos: parseCodigosTipoChavePix(
              cfg.pixCodigosTipoChaveAprendidos,
            ),
          }
        : null,
      campoConfigurado: cfg.pixCampoTipoChave,
      codigosConfigurados: parseCodigosTipoChavePix(cfg.pixCodigosTipoChave),
      colunasPix: [...porColuna].map(([coluna, valores]) => ({
        coluna,
        valores: [...valores],
      })),
    };
  }

  /**
   * Chave PIX do beneficiário e o tipo dela. O tipo vem do cadastro do
   * fornecedor no IXC (aba "Dados bancários"), para a conta a pagar marcar o
   * mesmo que está lá; sem tipo guardado, quem decide é o formato da chave.
   */
  private async pixDoBeneficiario(conta: {
    funcionarioId: string | null;
    beneficiarioAvulsoId: string | null;
    diaristaId: string | null;
    idFornecedorIxc?: number | null;
    chavePix?: string | null;
    tipoChavePix?: string | null;
  }): Promise<{ chave: string | null; tipo: TipoChavePix | null }> {
    // Chave informada na conta manda em qualquer cadastro: é o caso do QR Code
    // de uma cobrança, cujo "copia e cola" vale só para aquele pagamento e não
    // tem nada a ver com a chave fixa de quem recebe.
    if (conta.chavePix?.trim()) {
      return {
        chave: conta.chavePix.trim(),
        tipo: normalizarTipoChavePix(conta.tipoChavePix),
      };
    }

    // Conta lançada à mão: não há pessoa deste lado, e a chave está onde
    // sempre esteve — na aba "Dados bancários" do fornecedor, no IXC. Sem
    // buscá-la ali, a conta ia para lá com "Pix" no tipo de pagamento e a
    // chave vazia, e o banco não paga uma conta assim.
    if (
      conta.idFornecedorIxc &&
      !conta.funcionarioId &&
      !conta.diaristaId &&
      !conta.beneficiarioAvulsoId
    ) {
      const fornecedor = await this.fornecedores
        .buscarNoIxcPorId(conta.idFornecedorIxc)
        .catch((err: unknown) => {
          const motivo = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Não deu para ler os dados bancários do fornecedor ` +
              `${conta.idFornecedorIxc}: ${motivo}`,
          );
          return null;
        });
      return {
        chave: fornecedor?.chavePix ?? null,
        tipo: normalizarTipoChavePix(fornecedor?.tipoChavePix),
      };
    }

    if (conta.funcionarioId) {
      const f = await this.prisma.funcionario.findUnique({
        where: { id: conta.funcionarioId },
        select: { chavePix: true, tipoChavePix: true },
      });
      return {
        chave: f?.chavePix ?? null,
        tipo: normalizarTipoChavePix(f?.tipoChavePix),
      };
    }
    if (conta.diaristaId) {
      const d = await this.prisma.diarista.findUnique({
        where: { id: conta.diaristaId },
        select: { chavePix: true, tipoChavePix: true },
      });
      return {
        chave: d?.chavePix ?? null,
        tipo: normalizarTipoChavePix(d?.tipoChavePix),
      };
    }
    if (conta.beneficiarioAvulsoId) {
      const b = await this.prisma.beneficiarioAvulso.findUnique({
        where: { id: conta.beneficiarioAvulsoId },
        select: { chavePix: true, tipoChavePix: true },
      });
      return {
        chave: b?.chavePix ?? null,
        tipo: normalizarTipoChavePix(b?.tipoChavePix),
      };
    }
    return { chave: null, tipo: null };
  }

  private async resolverNome(item: ItemContaPagarDto): Promise<string> {
    if (item.funcionarioId) {
      const f = await this.prisma.funcionario.findUnique({
        where: { id: item.funcionarioId },
        select: { nome: true },
      });
      if (!f) throw new NotFoundException('Funcionário não encontrado');
      return f.nome;
    }
    if (item.diaristaId) {
      const d = await this.prisma.diarista.findUnique({
        where: { id: item.diaristaId },
        select: { nome: true },
      });
      if (!d) throw new NotFoundException('Diarista não encontrado');
      return d.nome;
    }
    const b = await this.prisma.beneficiarioAvulso.findUnique({
      where: { id: item.beneficiarioAvulsoId! },
      select: { nome: true },
    });
    if (!b) throw new NotFoundException('Beneficiário não encontrado');
    return b.nome;
  }
}

/**
 * Onde procurar o nome digitado.
 *
 * `beneficiarioNome` é uma foto do nome no dia em que a conta nasceu, e é ela
 * que a lista mostra — mas procurar só nela deixaria de fora quem se busca pelo
 * apelido ou pelo CPF, que nem sequer estão gravados aqui. Por isso a busca
 * também desce para o cadastro de cada tipo de beneficiário.
 *
 * O diarista guarda o apelido em `nomeFantasia`; o funcionário, em `apelido`. O
 * avulso não tem apelido: é cadastro de passagem, criado para um pagamento.
 */
function filtroDeBusca(busca: string): Prisma.ContaPagarWhereInput[] {
  const contem = { contains: busca, mode: Prisma.QueryMode.insensitive };
  return [
    { beneficiarioNome: contem },
    { funcionario: { is: { OR: [{ apelido: contem }, { cpfCnpj: contem }] } } },
    { diarista: { is: { OR: [{ nomeFantasia: contem }, { cpfCnpj: contem }] } } },
    { beneficiarioAvulso: { is: { cpfCnpj: contem } } },
  ];
}

/** Conta a pagar do dia 25 encontrada para um funcionário. */
export interface ContaAdiantamento {
  status: StatusContaPagar;
  pago: boolean;
  pagoEm: Date | null;
}

/** Aviso de que aquele pagamento já existe na competência. */
export interface ContaJaGerada {
  situacao: 'PAGO' | 'PENDENTE';
  status: StatusContaPagar;
  pagoEm: Date | null;
}

/**
 * Conta que ainda vale como "já gerada". Cancelada ou reprovada não conta —
 * não vai virar pagamento, então gerar de novo é o certo.
 */
export function montarContaJaGerada(
  conta: ContaAdiantamento | null,
): ContaJaGerada | null {
  if (!conta) return null;
  if (
    conta.status === StatusContaPagar.CANCELADO ||
    conta.status === StatusContaPagar.REPROVADO
  ) {
    return null;
  }
  return {
    situacao: conta.pago ? 'PAGO' : 'PENDENTE',
    status: conta.status,
    pagoEm: conta.pagoEm,
  };
}

/**
 * Traduz a conta do dia 25 em algo acionável na folha do quinto dia: se o
 * adiantamento que está sendo abatido do salário já caiu na conta da pessoa.
 * Conta cancelada conta como não gerada — não há o que descontar.
 */
export function montarSituacaoAdiantamento(
  valor: number,
  descontado: boolean,
  conta: ContaAdiantamento | null,
): SituacaoAdiantamento {
  const cancelada = conta?.status === StatusContaPagar.CANCELADO;
  const situacao = !conta || cancelada
    ? 'NAO_GERADO'
    : conta.pago
      ? 'PAGO'
      : 'PENDENTE';

  return {
    valor,
    descontado,
    situacao,
    status: conta?.status ?? null,
    pagoEm: conta?.pagoEm ?? null,
  };
}

/** Primeiro e último dia de "AAAA-MM", em UTC — data de férias é dia, não instante. */
export function limitesDoMes(competencia: string): {
  primeiroDia: Date;
  ultimoDia: Date;
} {
  const [ano, mes] = competencia.split('-').map(Number);
  return {
    primeiroDia: new Date(Date.UTC(ano, mes - 1, 1)),
    // Dia 0 do mês seguinte é o último deste; o fim do dia entra porque as
    // férias que terminam no dia 1º ainda são férias no dia 1º.
    ultimoDia: new Date(Date.UTC(ano, mes, 0, 23, 59, 59, 999)),
  };
}

/** O período de férias pega o dia 25 daquele mês — o dia do adiantamento. */
export function pegaODia25(
  ferias: { inicio: Date; fim: Date },
  competencia: string,
): boolean {
  const [ano, mes] = competencia.split('-').map(Number);
  const dia25 = new Date(Date.UTC(ano, mes - 1, 25));
  return ferias.inicio.getTime() <= dia25.getTime() &&
    ferias.fim.getTime() >= dia25.getTime();
}

/**
 * O que a folha sabe das férias de uma pessoa naquele mês trabalhado.
 *
 * "Está de férias" aqui é o que dá para provar: ou a tela de Férias registrou
 * um período que pega o dia 25, ou o pagamento das férias já saiu. Férias que
 * começam depois do dia 25 aparecem como aviso (o período vem preenchido), mas
 * não tiram o adiantamento — nesse mês a pessoa trabalhou até o dia 25.
 */
export function montarFeriasNaFolha(dados: {
  marcada: { inicio: Date; fim: Date; dias: number } | null;
  jaGerado: ContaJaGerada | null;
  mesTrabalhado: string;
  composicao: ComposicaoSalario;
  contaContabil: number;
  observacao: string;
}): FeriasNaFolha {
  const { marcada, jaGerado, mesTrabalhado } = dados;
  const noDia25 = marcada ? pegaODia25(marcada, mesTrabalhado) : false;

  return {
    periodo: marcada
      ? { inicio: marcada.inicio, fim: marcada.fim, dias: marcada.dias }
      : null,
    noDia25,
    jaGerado,
    deFerias: noDia25 || jaGerado !== null,
    valorSugerido: baseParaFerias(dados.composicao),
    contaContabil: dados.contaContabil,
    observacao: dados.observacao,
  };
}

/** Como o IXC vê a conta agora. */
export interface SituacaoNoIxc {
  pago: boolean;
  cancelada: boolean;
  auditoria: StatusAuditoriaIxc | null;
}

/**
 * Para qual situação a conta daqui deve ir depois do que o IXC respondeu.
 * null = nada muda.
 *
 * O pagamento confirmado vence tudo. Depois vale a auditoria feita lá: quem
 * reprova, cancela ou libera na tela do IXC manda no que aparece aqui. Sem
 * notícia nenhuma da auditoria, o status local é preservado — pode ser que a
 * base nem exponha esse dado, e chute nenhum é melhor que chute errado.
 */
export function statusPeloIxc(
  atual: StatusContaPagar,
  ixc: SituacaoNoIxc,
): StatusContaPagar | null {
  const mudarPara = (destino: StatusContaPagar) =>
    destino === atual ? null : destino;

  if (ixc.pago) return mudarPara(StatusContaPagar.PAGO);
  if (ixc.cancelada) return mudarPara(StatusContaPagar.CANCELADO);

  switch (ixc.auditoria) {
    case 'R':
      return mudarPara(StatusContaPagar.REPROVADO);
    case 'C':
      return mudarPara(StatusContaPagar.CANCELADO);
    case 'A':
      // Liberada pela auditoria: falta o "pagar com ModoBank".
      return atual === StatusContaPagar.PAGO
        ? null
        : mudarPara(StatusContaPagar.AGUARDANDO_PAGAMENTO);
    default:
      return null;
  }
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

function contaContabilPorTipo(
  tipo: TipoLancamento,
  cfg: {
    contaContabilSalario: number;
    contaContabilAdiantamento: number;
    contaContabilBonus: number;
    contaContabilFerias: number;
    contaContabilDiaria: number;
    contaContabilAvulso: number;
  },
): number {
  switch (tipo) {
    case TipoLancamento.FERIAS:
      return cfg.contaContabilFerias;
    case TipoLancamento.ADIANTAMENTO:
      return cfg.contaContabilAdiantamento;
    case TipoLancamento.BONUS:
      return cfg.contaContabilBonus;
    case TipoLancamento.DIARIA:
      return cfg.contaContabilDiaria;
    case TipoLancamento.AVULSO:
      return cfg.contaContabilAvulso;
    default:
      return cfg.contaContabilSalario;
  }
}

function obsPorTipo(
  tipo: TipoLancamento,
  competencia: string | null,
  cfg: {
    obsSalarioTemplate: string;
    obsAdiantamentoTemplate: string;
    obsBonusTemplate: string;
    obsFeriasTemplate: string;
  },
): string {
  const comp = competencia ?? '';
  // Adiantamento é do mês corrente; salário, bônus e férias, do mês trabalhado.
  switch (tipo) {
    case TipoLancamento.ADIANTAMENTO:
      return renderObs(cfg.obsAdiantamentoTemplate, comp);
    case TipoLancamento.FERIAS:
      return renderObs(cfg.obsFeriasTemplate, competenciaAnterior(comp));
    case TipoLancamento.BONUS:
      return renderObs(cfg.obsBonusTemplate, competenciaAnterior(comp));
    default:
      return renderObs(cfg.obsSalarioTemplate, competenciaAnterior(comp));
  }
}
