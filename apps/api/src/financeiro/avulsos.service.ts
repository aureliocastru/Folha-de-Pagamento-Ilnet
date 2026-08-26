import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BeneficiarioAvulso,
  FormaPagamento,
  OrigemLancamento,
  PagamentoAvulso,
  Prisma,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { CaixaService } from '../ixc/caixa.service';
import {
  type EdicaoDoFornecedor,
  variacoesDocumento,
} from '../ixc/ixc.fornecedor';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigFinanceiraService } from './config-financeira.service';
import { ContasPagarService } from './contas-pagar.service';
import {
  CriarBeneficiarioDto,
  PagarAvulsoDto,
  UpdateBeneficiarioDto,
} from './dto/avulso.dto';
import { FornecedorService, type FornecedorNoIxc } from './fornecedor.service';
import {
  calcularComissaoVendas,
  calcularTotalPagamento,
  montarHistoricoCaixa,
  montarObservacaoPagamento,
  TIPO_PAGAMENTO_EM_MAOS,
  type PartesDoPagamento,
} from './pagamento.calc';

/** Beneficiário com o que a listagem mostra sem abrir o cadastro. */
export interface BeneficiarioComResumo {
  beneficiario: BeneficiarioAvulso;
  quantidadePagamentos: number;
  /** Só o dinheiro que de fato saiu: em mãos, ou conta a pagar já PAGA. */
  totalPago: number;
  quantidadePagas: number;
  /** Lançado no IXC e ainda a caminho do banco. */
  totalAguardando: number;
  quantidadeAguardando: number;
  /** Contas que o IXC recusou — não saíram e precisam de correção. */
  quantidadeComErro: number;
  ultimoPagamento: Date | null;
  /** Pagos em mãos que ainda não viraram lançamento no caixa do IXC. */
  pendentesNoCaixa: number;
}

/**
 * Um fornecedor do IXC do jeito que a tela de pagamentos avulsos precisa vê-lo:
 * o cadastro de lá, mais o que esta casa já sabe sobre ele.
 */
export interface FornecedorParaPagar extends FornecedorNoIxc {
  /** Cadastro daqui, quando já existe. Null = nunca recebeu por este app. */
  beneficiarioId: string | null;
  quantidadePagamentos: number;
  ultimoPagamento: Date | null;
}

export interface PaginaFornecedoresParaPagar {
  itens: FornecedorParaPagar[];
  total: number;
  page: number;
  porPagina: number;
}

/** Cadastro salvo, mais o que não deu certo do lado do IXC (se algo). */
export interface BeneficiarioSalvo {
  beneficiario: BeneficiarioAvulso;
  /** null = correu tudo bem. */
  avisoIxc: string | null;
}

/** O que a tela precisa saber antes de cadastrar alguém com aquele documento. */
export interface ConsultaCpfCnpj {
  /** Já cadastrado aqui (a busca é local, e vence a do IXC). */
  beneficiario: BeneficiarioAvulso | null;
  /** Já existe como fornecedor no IXC. */
  fornecedor: FornecedorNoIxc | null;
  /** Não deu para perguntar ao IXC agora — o cadastro não precisa parar. */
  ixcIndisponivel: string | null;
}

/**
 * Pagamentos avulsos: quem recebe da empresa sem estar na folha e sem ser
 * diarista — mão de obra contratada, serviço pontual, patrocínio.
 *
 * O caminho do dinheiro é o mesmo da diária, e de propósito: conta a pagar no
 * IXC (fornecedor, auditoria, banco) ou dinheiro em mãos saindo do caixa
 * configurado. O que muda é só a conta contábil.
 */
@Injectable()
export class AvulsosService {
  private readonly logger = new Logger(AvulsosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
    private readonly contasPagar: ContasPagarService,
    private readonly fornecedores: FornecedorService,
    private readonly caixa: CaixaService,
  ) {}

  // -------------------------------------------------------------------------
  // Cadastro
  // -------------------------------------------------------------------------
  /**
   * Os cadastros de um módulo só.
   *
   * A folha e o contas a pagar dividem esta tabela, e quem foi puxado da lista
   * de fornecedores do IXC é do contas a pagar: não é gente que a folha
   * registrou, e vê-lo na tela da folha é o começo de somá-lo no custo do mês.
   */
  async listarBeneficiarios(
    busca?: string,
    todos = false,
    origem: OrigemLancamento = OrigemLancamento.FOLHA,
  ): Promise<BeneficiarioComResumo[]> {
    const where: Prisma.BeneficiarioAvulsoWhereInput = { origem };
    if (!todos) where.ativo = true;
    if (busca) {
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: busca, mode: 'insensitive' } },
      ];
    }

    const lista = await this.prisma.beneficiarioAvulso.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        pagamentos: {
          select: {
            valor: true,
            data: true,
            forma: true,
            idLancamentoIxc: true,
            lancadoManual: true,
            contaPagar: { select: { status: true } },
          },
        },
      },
    });

    return lista.map(({ pagamentos, ...beneficiario }) => {
      const pagos = pagamentos.filter(saiu);
      const aguardando = pagamentos.filter(aCaminho);

      return {
        beneficiario,
        quantidadePagamentos: pagamentos.length,
        totalPago: somar(pagos),
        quantidadePagas: pagos.length,
        totalAguardando: somar(aguardando),
        quantidadeAguardando: aguardando.length,
        quantidadeComErro: pagamentos.filter(
          (p) => p.contaPagar?.status === StatusContaPagar.ERRO,
        ).length,
        ultimoPagamento: pagamentos.reduce<Date | null>(
          (maior, p) => (!maior || p.data > maior ? p.data : maior),
          null,
        ),
        pendentesNoCaixa: pagamentos.filter(pendenteNoCaixa).length,
      };
    });
  }

  async buscar(id: string): Promise<BeneficiarioAvulso> {
    const b = await this.prisma.beneficiarioAvulso.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Beneficiário não encontrado');
    return b;
  }

  /**
   * O cadastro de fornecedores do IXC, página a página, com o que esta casa já
   * sabe de cada um: quem já recebeu por aqui vem com o cadastro daqui junto e
   * o histórico à mão.
   *
   * É a lista que a tela de pagamentos avulsos abre mostrando — quem vai pagar
   * procura a pessoa pelo nome, e ela já existe no IXC.
   */
  async listarFornecedoresDoIxc(opts: {
    busca?: string;
    page?: number;
    porPagina?: number;
  }): Promise<PaginaFornecedoresParaPagar> {
    const pagina = await this.fornecedores.listarDoIxc(opts);
    const ids = pagina.itens.map((f) => f.idFornecedor);

    // Uma consulta só para a página inteira: um findUnique por linha seriam
    // vinte idas ao banco para desenhar uma tabela.
    const conhecidos = ids.length
      ? await this.prisma.beneficiarioAvulso.findMany({
          where: { idFornecedorIxc: { in: ids } },
          select: {
            id: true,
            idFornecedorIxc: true,
            pagamentos: { select: { data: true } },
          },
        })
      : [];

    const porFornecedor = new Map(
      conhecidos.map((b) => [b.idFornecedorIxc, b]),
    );

    return {
      ...pagina,
      itens: pagina.itens.map((f) => {
        const daqui = porFornecedor.get(f.idFornecedor);
        return {
          ...f,
          beneficiarioId: daqui?.id ?? null,
          quantidadePagamentos: daqui?.pagamentos.length ?? 0,
          ultimoPagamento:
            daqui?.pagamentos.reduce<Date | null>(
              (maior, p) => (!maior || p.data > maior ? p.data : maior),
              null,
            ) ?? null,
        };
      }),
    };
  }

  /**
   * Muda o cadastro do fornecedor no IXC a partir desta lista.
   *
   * Não toca no cadastro daqui de propósito: o nome fantasia é do fornecedor, a
   * lista o lê do IXC a cada abertura, e guardar uma cópia local só criaria
   * duas versões do mesmo apelido para divergirem.
   */
  async editarFornecedorDoIxc(
    idFornecedorIxc: number,
    mudancas: EdicaoDoFornecedor,
  ): Promise<FornecedorNoIxc> {
    return this.fornecedores.atualizarNoIxc(idFornecedorIxc, mudancas);
  }

  /**
   * O cadastro daqui para um fornecedor do IXC, criando-o se ainda não houver.
   *
   * É o que deixa pagar alguém direto da lista do IXC sem preencher cadastro
   * antes: o que o IXC já sabe (nome, documento, chave PIX, cidade) é copiado
   * para cá, e o vínculo pelo `idFornecedorIxc` garante que a segunda vez ache
   * o mesmo cadastro em vez de criar outro.
   */
  async garantirBeneficiarioDoIxc(
    idFornecedorIxc: number,
    origem: OrigemLancamento = OrigemLancamento.CONTAS_PAGAR,
  ): Promise<BeneficiarioAvulso> {
    const existente = await this.prisma.beneficiarioAvulso.findFirst({
      where: { idFornecedorIxc },
    });
    // O cadastro que já existe fica com a origem que tem: ela decide em que
    // lista ele aparece, e mudá-la aqui o faria sumir da lista do outro módulo
    // no meio de um pagamento. Quem manda no relatório é a origem do
    // pagamento, e essa vem da tela que está pagando.
    if (existente) return existente;

    const doIxc = await this.fornecedores.buscarNoIxcPorId(idFornecedorIxc);
    if (!doIxc) {
      throw new NotFoundException(
        `Fornecedor ${idFornecedorIxc} não foi encontrado no IXC.`,
      );
    }

    this.logger.log(
      `Cadastro criado a partir do fornecedor ${idFornecedorIxc} do IXC: ${doIxc.nome}`,
    );
    return this.prisma.beneficiarioAvulso.create({
      data: {
        nome: doIxc.nome,
        cpfCnpj: doIxc.cpfCnpj,
        // O IXC guarda "E" (estrangeiro) além de F e J; o cadastro daqui só
        // conhece pessoa física e jurídica, e quem não é jurídica é física.
        tipoPessoa: doIxc.tipoPessoa === 'J' ? 'J' : 'F',
        telefone: doIxc.telefone,
        email: doIxc.email,
        chavePix: doIxc.chavePix,
        tipoChavePix: doIxc.tipoChavePix,
        cidadeIxc: doIxc.cidadeIxc,
        // Já existe lá: o pagamento usa este código em vez de abrir outro
        // fornecedor com o mesmo CPF.
        idFornecedorIxc: doIxc.idFornecedor,
        // A origem é a da tela que puxou o fornecedor: as duas telas listam o
        // cadastro do IXC agora, e o cadastro criado por uma aparece na lista
        // dela. O que ele recebe de cada lado é outra conta — ver `pagar`.
        origem,
      },
    });
  }

  /**
   * O que já existe com aquele CPF/CNPJ, aqui e no IXC. A tela pergunta antes
   * de cadastrar; decidir sozinha por reaproveitar seria decidir no lugar de
   * quem sabe se é a mesma pessoa.
   */
  async consultarCpfCnpj(cpfCnpj: string): Promise<ConsultaCpfCnpj> {
    const doc = cpfCnpj.trim();
    // Aqui do lado de cá vale a mesma regra do IXC: o documento foi digitado
    // com máscara umas vezes e sem outras, e comparar texto com texto acharia
    // só quem digitou igual das duas vezes.
    const variacoes = variacoesDocumento(doc);
    const beneficiario = variacoes.length
      ? await this.prisma.beneficiarioAvulso.findFirst({
          where: { OR: variacoes.map((v) => ({ cpfCnpj: v })) },
        })
      : null;

    let fornecedor: FornecedorNoIxc | null = null;
    let ixcIndisponivel: string | null = null;
    try {
      fornecedor = await this.fornecedores.procurarNoIxcPorCpfCnpj(doc);
    } catch (err) {
      // O IXC fora do ar não pode travar um cadastro: o app avisa e segue.
      ixcIndisponivel = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Consulta de CPF/CNPJ no IXC falhou: ${ixcIndisponivel}`);
    }

    return { beneficiario, fornecedor, ixcIndisponivel };
  }

  async criarBeneficiario(
    dto: CriarBeneficiarioDto,
  ): Promise<BeneficiarioSalvo> {
    const beneficiario = await this.prisma.beneficiarioAvulso.create({
      data: { ...this.dadosDoCadastro(dto), nome: dto.nome.trim() },
    });
    return { beneficiario, avisoIxc: await this.espelharPix(beneficiario) };
  }

  async atualizarBeneficiario(
    id: string,
    dto: UpdateBeneficiarioDto,
  ): Promise<BeneficiarioSalvo> {
    await this.buscar(id);
    const beneficiario = await this.prisma.beneficiarioAvulso.update({
      where: { id },
      data: {
        ...this.dadosDoCadastro(dto),
        ...(dto.ativo === undefined ? {} : { ativo: dto.ativo }),
      },
    });
    return { beneficiario, avisoIxc: await this.espelharPix(beneficiario) };
  }

  /**
   * Sobe a chave PIX para a aba "Dados bancários" do fornecedor no IXC, para o
   * próximo pagamento já sair sem digitar de novo.
   *
   * Só faz sentido quando já se sabe qual é o fornecedor — quem ainda não tem
   * um só ganha o cadastro no primeiro pagamento, e é lá que a chave sobe.
   * Falhar aqui devolve o motivo em vez de estourar: a chave continua valendo
   * daqui, que é de onde a conta a pagar a tira.
   */
  private async espelharPix(b: BeneficiarioAvulso): Promise<string | null> {
    if (!b.idFornecedorIxc || !b.chavePix) return null;
    const motivo = await this.fornecedores.espelharPixNoIxc(
      b.idFornecedorIxc,
      b.chavePix,
      b.tipoChavePix,
    );
    return motivo
      ? `A chave ficou salva aqui, mas não subiu para os dados bancários do fornecedor no IXC: ${motivo}.`
      : null;
  }

  /**
   * Apaga o cadastro. Quem já recebeu não é apagado: o histórico de pagamento
   * tem de continuar existindo, então o caminho é desativar.
   */
  async removerBeneficiario(id: string): Promise<void> {
    const pagamentos = await this.prisma.pagamentoAvulso.count({
      where: { beneficiarioId: id },
    });
    if (pagamentos > 0) {
      throw new BadRequestException(
        `${pagamentos} pagamento(s) já saíram para essa pessoa — desative o cadastro em vez de apagar.`,
      );
    }
    await this.buscar(id);
    await this.prisma.beneficiarioAvulso.delete({ where: { id } });
  }

  private dadosDoCadastro(dto: CriarBeneficiarioDto) {
    return {
      ...(dto.nome === undefined ? {} : { nome: dto.nome.trim() }),
      ...(dto.cpfCnpj === undefined ? {} : { cpfCnpj: dto.cpfCnpj || null }),
      ...(dto.tipoPessoa === undefined ? {} : { tipoPessoa: dto.tipoPessoa }),
      ...(dto.telefone === undefined ? {} : { telefone: dto.telefone || null }),
      ...(dto.email === undefined ? {} : { email: dto.email || null }),
      ...(dto.chavePix === undefined ? {} : { chavePix: dto.chavePix || null }),
      ...(dto.tipoChavePix === undefined
        ? {}
        : { tipoChavePix: dto.tipoChavePix }),
      ...(dto.valorPorVenda === undefined
        ? {}
        : {
            valorPorVenda:
              dto.valorPorVenda == null || dto.valorPorVenda <= 0
                ? null
                : new Prisma.Decimal(dto.valorPorVenda),
          }),
      ...(dto.formaPagamento === undefined
        ? {}
        : { formaPagamento: dto.formaPagamento }),
      ...(dto.observacoes === undefined
        ? {}
        : { observacoes: dto.observacoes || null }),
      ...(dto.cidadeIxc === undefined ? {} : { cidadeIxc: dto.cidadeIxc }),
      ...(dto.idFornecedorIxc === undefined
        ? {}
        : { idFornecedorIxc: dto.idFornecedorIxc }),
      ...(dto.fornecedorNovoNoIxc === undefined
        ? {}
        : { fornecedorNovoNoIxc: dto.fornecedorNovoNoIxc }),
    };
  }

  // -------------------------------------------------------------------------
  // Pagamentos
  // -------------------------------------------------------------------------
  listarPagamentos(
    beneficiarioId?: string,
    origem: OrigemLancamento = OrigemLancamento.FOLHA,
  ) {
    return this.prisma.pagamentoAvulso.findMany({
      where: { origem, ...(beneficiarioId ? { beneficiarioId } : {}) },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: {
        beneficiario: { select: { nome: true } },
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });
  }

  /**
   * Paga alguém de fora da folha: o serviço contratado, a comissão das vendas
   * que a pessoa fechou e o extra do trabalho por fora, somados num pagamento
   * só. Das duas formas vira conta a pagar no IXC — o que muda é de onde o
   * dinheiro sai: do banco por PIX, ou do caixa em dinheiro.
   */
  async pagar(
    beneficiarioId: string,
    dto: PagarAvulsoDto,
    usuarioId?: string,
    /**
     * De que módulo saiu este pagamento. Vazio = o do cadastro de quem recebe.
     *
     * O vazio não é descuido: é o que mantém de pé a garantia antiga de que
     * nenhum caminho que não conheça esta conversa — link velho, script — faça
     * um pagamento do Contas a Pagar entrar na folha.
     */
    origem?: OrigemLancamento,
  ): Promise<PagamentoAvulso> {
    const beneficiario = await this.decorarPix(
      await this.buscar(beneficiarioId),
      dto,
    );
    const forma = dto.forma ?? beneficiario.formaPagamento;
    const cfg = await this.config.obter();

    // A chave só é obrigatória quando é o PIX que vai pagar. Fornecedor que
    // manda boleto não tem chave nenhuma, e exigi-la aqui era o que impedia de
    // gerar a conta a pagar dele — o pagamento simplesmente não saía.
    //
    // O que a tela escolheu é o que fica gravado na conta; o resolvido abaixo
    // serve só para decidir se a chave é exigida. Gravar o padrão por extenso
    // congelaria na conta um tipo que ninguém escolheu, e mudar o padrão nas
    // Configurações deixaria de valer para ela.
    const tipoEscolhido = dto.tipoPagamento?.trim() || undefined;
    // O "Pix" no fim não é enfeite: sem ele, uma configuração sem tipo padrão
    // faria a conta a pagar sair sem chave e sem ninguém avisar — e é
    // justamente a chave que faz o banco pagar.
    const vaiDePix = /pix/i.test(
      tipoEscolhido || cfg.tipoPagamentoPadrao || 'Pix',
    );
    if (
      forma === FormaPagamento.IXC &&
      vaiDePix &&
      !beneficiario.chavePix
    ) {
      throw new BadRequestException(
        'Sem chave PIX o banco não paga por PIX. Informe a chave, escolha ' +
          'outro tipo de pagamento (boleto, transferência) ou pague em mãos.',
      );
    }

    const partes: PartesDoPagamento = {
      valorServico: dto.valorServico ?? 0,
      vendas: dto.vendas ?? 0,
      valorPorVenda:
        dto.valorPorVenda ?? Number(beneficiario.valorPorVenda ?? 0),
      valorExtra: dto.valorExtra ?? 0,
      descricaoExtra: dto.descricaoExtra?.trim() || null,
    };
    const valor = calcularTotalPagamento(partes);
    if (valor < 0.01) {
      throw new BadRequestException(
        'O pagamento ficou em zero. Informe o valor do serviço, as vendas e ' +
          'quanto cada uma paga, ou um valor extra.',
      );
    }

    const base = {
      beneficiarioId,
      /*
       * A tela que paga decide; sem ela, decide o cadastro.
       *
       * Era só o cadastro, e foi o que travou a folha quando ela passou a
       * listar os fornecedores do IXC: o cadastro puxado de lá nascia "do
       * Contas a Pagar", o pagamento herdava isso, e a comissão de venda paga
       * pela folha sumia do gráfico de vendas — que só conta pagamento com
       * origem FOLHA.
       *
       * As duas coisas respondem perguntas diferentes. A origem do **cadastro**
       * diz em que lista a pessoa aparece; a do **pagamento** diz de que módulo
       * saiu aquele dinheiro. A mesma pessoa pode receber uma comissão pela
       * folha e um serviço pelo Contas a Pagar, e cada relatório conta o seu.
       *
       * O `??` guarda o resto: quem chega sem dizer o módulo continua caindo na
       * regra antiga, e nenhum caminho velho passa a despejar na folha o que é
       * do outro lado.
       */
      origem: origem ?? beneficiario.origem,
      data: dto.data ? new Date(dto.data) : hojeUtc(),
      valor: new Prisma.Decimal(valor),
      vendas: partes.vendas ?? 0,
      valorPorVenda: partes.valorPorVenda
        ? new Prisma.Decimal(partes.valorPorVenda)
        : null,
      comissaoVendas: new Prisma.Decimal(calcularComissaoVendas(partes)),
      valorExtra: new Prisma.Decimal(partes.valorExtra ?? 0),
      descricaoExtra: partes.descricaoExtra,
      descricao: dto.descricao.trim(),
      contaContabil: dto.contaContabil ?? cfg.contaContabilAvulso,
      forma,
      criadoPor: usuarioId ?? null,
    };

    return this.pagarPeloIxc(base, partes, cfg, usuarioId, tipoEscolhido);
  }

  /**
   * A chave PIX corrigida na hora de pagar fica no cadastro — quem paga vê o
   * erro do IXC na tela e acerta ali mesmo, e da próxima vez já vem certa.
   */
  private async decorarPix(
    beneficiario: BeneficiarioAvulso,
    dto: PagarAvulsoDto,
  ): Promise<BeneficiarioAvulso> {
    const chavePix = dto.chavePix?.trim();
    const tipoChavePix = dto.tipoChavePix ?? null;
    const mudou =
      (chavePix !== undefined && chavePix !== (beneficiario.chavePix ?? '')) ||
      (dto.tipoChavePix !== undefined &&
        tipoChavePix !== beneficiario.tipoChavePix);
    if (!mudou) return beneficiario;

    return this.prisma.beneficiarioAvulso.update({
      where: { id: beneficiario.id },
      data: {
        ...(chavePix === undefined ? {} : { chavePix: chavePix || null }),
        ...(dto.tipoChavePix === undefined ? {} : { tipoChavePix }),
      },
    });
  }

  /**
   * Conta a pagar no IXC (o caminho já usado pela folha e pelas diárias).
   *
   * Em mãos é a mesma conta a pagar, mudando só de onde o dinheiro sai: a
   * conta de pagamento do caixa em vez da do banco, e em dinheiro em vez de
   * PIX — quem entrega na mão não precisa de chave, e o `enviarIxc` já deixa a
   * chave de fora quando o tipo não é PIX.
   */
  private async pagarPeloIxc(
    base: Prisma.PagamentoAvulsoUncheckedCreateInput,
    partes: PartesDoPagamento,
    cfg: { contaPagamentoCaixaId: number },
    usuarioId?: string,
    /** Como o IXC vai pagar. Ignorado no pagamento em mãos, que é dinheiro. */
    tipoPagamento?: string,
  ): Promise<PagamentoAvulso> {
    const emMaos = base.forma === FormaPagamento.EM_MAOS;
    const [conta] = await this.contasPagar.criar(
      {
        itens: [
          {
            beneficiarioAvulsoId: base.beneficiarioId,
            tipo: TipoLancamento.AVULSO,
            // A conta a pagar herda a origem do pagamento: é ela que aparece
            // em "Últimos lançamentos" e que soma no custo do mês da folha.
            origem: base.origem,
            valor: Number(base.valor),
            contaContabil: base.contaContabil,
            ...(emMaos
              ? {
                  contaPagamento: cfg.contaPagamentoCaixaId,
                  tipoPagamentoIxc: TIPO_PAGAMENTO_EM_MAOS,
                }
              : tipoPagamento
                ? { tipoPagamentoIxc: tipoPagamento }
                : {}),
            observacao: montarObservacaoPagamento({
              ...partes,
              descricao: base.descricao,
            }),
          },
        ],
      },
      usuarioId,
    );

    const pagamento = await this.prisma.pagamentoAvulso.create({
      data: { ...base, contaPagarId: conta.id },
      include: {
        contaPagar: {
          select: { id: true, status: true, erro: true, idFnApagarIxc: true },
        },
      },
    });

    // Só agora o fornecedor existe (foi criado ao mandar a conta a pagar), e é
    // agora que a chave digitada aqui pode subir para os dados bancários dele.
    // Sem estourar: o pagamento já foi feito, e a chave foi junto no payload.
    const salvo = await this.buscar(base.beneficiarioId);
    const aviso = await this.espelharPix(salvo);
    if (aviso) this.logger.warn(aviso);

    return pagamento;
  }

  /**
   * Lança (ou tenta de novo) a saída no caixa do IXC.
   *
   * Só serve aos pagamentos antigos, feitos quando "em mãos" escrevia direto na
   * movimentação financeira em vez de virar conta a pagar no caixa. Eles ficam
   * pendentes até alguém fechá-los, e fechar exige este botão — ou o "já lancei
   * à mão". Pagamento novo nenhum chega aqui.
   */
  async lancarNoCaixa(pagamentoId: string): Promise<PagamentoAvulso> {
    const pagamento = await this.buscarPagamento(pagamentoId);
    if (pagamento.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException(
        'Só pagamento em mãos sai do caixa — este foi pelo IXC.',
      );
    }
    if (pagamento.contaPagarId) {
      throw new BadRequestException(
        'Este pagamento já sai do caixa pela própria conta a pagar no IXC. ' +
          'Lançar de novo na movimentação financeira tiraria o dinheiro duas vezes.',
      );
    }
    if (pagamento.idLancamentoIxc) {
      throw new BadRequestException(
        `Este pagamento já saiu do caixa no IXC (lançamento ${pagamento.idLancamentoIxc}).`,
      );
    }

    const cfg = await this.config.obter();
    const caixaId = pagamento.caixaIxc ?? (await this.caixa.resolverCaixa(cfg));
    if (!caixaId) {
      return this.marcarErro(
        pagamento.id,
        `Não achei o caixa "${cfg.caixaEmMaosNome}" no IXC. Informe o código em Configurações.`,
      );
    }

    const beneficiario = await this.buscar(pagamento.beneficiarioId);
    try {
      const res = await this.caixa.lancarSaida(
        {
          caixaId,
          valor: Number(pagamento.valor),
          data: pagamento.data,
          historico: montarHistoricoCaixa({
            nome: beneficiario.nome,
            descricao: pagamento.descricao,
            // O serviço é o que sobrou depois de tirar comissão e extra: é
            // assim que ele é guardado (só o total vai para a coluna `valor`).
            valorServico:
              Number(pagamento.valor) -
              Number(pagamento.comissaoVendas) -
              Number(pagamento.valorExtra),
            vendas: pagamento.vendas,
            valorPorVenda: Number(pagamento.valorPorVenda ?? 0),
            valorExtra: Number(pagamento.valorExtra),
            descricaoExtra: pagamento.descricaoExtra,
          }),
        },
        cfg,
      );

      return this.prisma.pagamentoAvulso.update({
        where: { id: pagamento.id },
        data: {
          caixaIxc: caixaId,
          idLancamentoIxc: res.id,
          lancadoEm: new Date(),
          lancadoManual: false,
          erroIxc: res.aviso ?? null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Pagamento ${pagamento.id} não saiu do caixa no IXC: ${message}`,
      );
      return this.marcarErro(pagamento.id, message);
    }
  }

  /** Marca que alguém lançou a saída no IXC à mão. */
  async marcarLancadoManual(pagamentoId: string): Promise<PagamentoAvulso> {
    const pagamento = await this.buscarPagamento(pagamentoId);
    if (pagamento.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException('Só pagamento em mãos sai do caixa.');
    }
    if (pagamento.contaPagarId) {
      throw new BadRequestException(
        'Este pagamento sai do caixa pela conta a pagar no IXC — não há nada ' +
          'para lançar à mão.',
      );
    }
    return this.prisma.pagamentoAvulso.update({
      where: { id: pagamento.id },
      data: { lancadoManual: true, lancadoEm: new Date(), erroIxc: null },
    });
  }

  /**
   * Apaga o pagamento. Pelo IXC, apaga também a conta a pagar (dos dois lados).
   * Em mãos com lançamento já feito no caixa, recusa: apagar aqui deixaria a
   * saída solta no IXC.
   */
  async removerPagamento(pagamentoId: string): Promise<void> {
    const pagamento = await this.buscarPagamento(pagamentoId);

    if (pagamento.idLancamentoIxc) {
      throw new BadRequestException(
        `A saída deste pagamento já está lançada no caixa do IXC (lançamento ` +
          `${pagamento.idLancamentoIxc}). Apague por lá primeiro.`,
      );
    }
    if (pagamento.contaPagarId) {
      // Apagar a conta a pagar já leva este pagamento junto; o que sobra
      // abaixo é o pagamento em mãos antigo, que nunca teve conta.
      await this.contasPagar.remover(pagamento.contaPagarId);
    }
    await this.prisma.pagamentoAvulso.deleteMany({
      where: { id: pagamento.id },
    });
  }

  private async buscarPagamento(id: string): Promise<PagamentoAvulso> {
    const p = await this.prisma.pagamentoAvulso.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    return p;
  }

  private marcarErro(id: string, erro: string): Promise<PagamentoAvulso> {
    return this.prisma.pagamentoAvulso.update({
      where: { id },
      data: { erroIxc: erro },
    });
  }
}

/** Como cada pagamento aparece nas contas do resumo. */
interface PagamentoResumido {
  valor: Prisma.Decimal;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
}

/**
 * Dinheiro que de fato saiu: quando o IXC deu a conta por paga. Vale para as
 * duas formas — em mãos também é conta a pagar, só que na conta do caixa.
 *
 * Os pagamentos em mãos antigos não têm conta a pagar nenhuma: o dinheiro saiu
 * da gaveta no ato e nunca houve nada para o IXC confirmar. Esses continuam
 * contando como pagos, que é o que sempre foram.
 */
function saiu(p: PagamentoResumido): boolean {
  if (!p.contaPagar) return p.forma === FormaPagamento.EM_MAOS;
  return p.contaPagar.status === StatusContaPagar.PAGO;
}

/** Lançado no IXC e ainda a caminho: nem pago, nem recusado. */
function aCaminho(p: PagamentoResumido): boolean {
  const status = p.contaPagar?.status;
  return (
    status !== undefined &&
    status !== StatusContaPagar.PAGO &&
    status !== StatusContaPagar.ERRO &&
    status !== StatusContaPagar.REPROVADO &&
    status !== StatusContaPagar.CANCELADO
  );
}

function somar(itens: Array<{ valor: Prisma.Decimal }>): number {
  return itens.reduce((s, i) => s + Number(i.valor), 0);
}

/**
 * Pago em mãos que ainda não virou lançamento no caixa do IXC — e que também
 * não virou conta a pagar, ou seja, um pagamento do tempo em que "em mãos"
 * escrevia direto na movimentação financeira. É o que ainda precisa ser
 * fechado à mão; os novos saem pelo caixa na própria conta a pagar.
 */
function pendenteNoCaixa(p: {
  forma: FormaPagamento;
  contaPagar: unknown | null;
  idLancamentoIxc: number | null;
  lancadoManual: boolean;
}): boolean {
  return (
    p.forma === FormaPagamento.EM_MAOS &&
    !p.contaPagar &&
    p.idLancamentoIxc === null &&
    !p.lancadoManual
  );
}

function hojeUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
