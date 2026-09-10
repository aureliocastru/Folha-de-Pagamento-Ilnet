import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClasseTributo, Prisma, TipoGuia } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { PrismaService } from '../prisma/prisma.service';
import { GravarGuiaDto } from './dto/guia.dto';
import {
  conferir,
  GuiaIlegivelError,
  GuiaLida,
  lerGuia,
  lerPagamento,
  type PagamentoDaGuia,
} from './guias.parse';
import { extrairTextoPdf } from '../pdf/pdf';
import { textoDaImagem, valorDoCodigoDeBarras } from './guia-por-imagem';

/** O que a tela mostra depois de ler o PDF, antes de alguém confirmar. */
export interface LeituraDaGuia {
  guia: GuiaLida;
  arquivoNome: string;
  textoOriginal: string;
  /** Soma dos itens não fechou com o total impresso — some quando está tudo certo. */
  divergencia: string | null;
  /** Guia igual já gravada; gravar de novo dobraria o valor no gráfico. */
  jaExiste: { id: string; competencia: string; valorTotal: number } | null;
  /** Lida da imagem (OCR): a tela pede para conferir cada número com o papel. */
  lidoDaImagem?: boolean;
}

/**
 * Quem recebe o imposto, nas contas a pagar.
 *
 * Todas as guias saem em nome da Receita Federal — foi a decisão de quem paga,
 * e é o que faz a fila do mês ficar legível ("Receita Federal, dia 20"). Não é
 * o credor literal de todas elas: o FGTS quem recebe é a Caixa, e o ICMS, a
 * SEFAZ. Se um dia isso tiver de mudar, é esta linha e o mapa por tipo.
 */
const FORNECEDOR_DAS_GUIAS = 'Receita Federal';

/** Por quanto tempo vale o que se descobriu sobre o fornecedor no IXC. */
const VALIDADE_DO_FORNECEDOR_MS = 30 * 60 * 1000;

/** Como cada guia se chama na fila de pagamento. */
const ROTULO_DA_GUIA: Record<TipoGuia, string> = {
  DARF_INSS: 'DARF INSS',
  FGTS: 'FGTS',
  DAS_SIMPLES: 'DAS Simples Nacional',
  DARE_ICMS: 'DARE ICMS',
  OUTRA: 'Guia de imposto',
};

/** O que aconteceu ao transformar uma guia em conta a pagar. */
export interface ContaDaGuia {
  guiaId: string;
  contaPagarId: string;
  /** O título no IXC. Null = a conta ficou aqui e não chegou lá. */
  idFnApagarIxc: number | null;
  valor: number;
  vencimento: Date;
  fornecedor: { id: number; nome: string };
  /** Como ela vai ser paga: o que veio impresso no PDF. */
  formaDePagamento: 'BOLETO' | 'PIX' | null;
  /** A conta já existia — esta chamada não criou nada. */
  jaExistia: boolean;
  /** O que quem paga precisa saber antes de olhar a fila. */
  aviso: string | null;
}

@Injectable()
export class ImpostosService {
  private readonly logger = new Logger(ImpostosService.name);

  /** O fornecedor das guias no IXC, guardado entre uma leitura e outra. */
  private fornecedor: { em: number; achado: { id: number; nome: string } } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    // Guia de imposto é conta a pagar como qualquer outra: vai pelo mesmo
    // caminho da despesa lançada à mão — mesmo `fn_apagar`, mesma auditoria,
    // mesmo acompanhamento. Um caminho próprio aqui seria uma segunda regra de
    // como se lança conta nesta casa, e elas discordariam em algum mês.
    private readonly contasPagar: ContasPagarService,
    private readonly fornecedores: FornecedorService,
  ) {}

  /**
   * Lê o PDF e devolve o que entendeu — **sem gravar nada**. Parser de PDF
   * erra, e isto é imposto: quem confere é a pessoa, na tela.
   */
  async ler(arquivo: Express.Multer.File): Promise<LeituraDaGuia> {
    const texto = await this.extrairTexto(arquivo);
    return this.lerDoTexto(texto, arquivo.originalname);
  }

  /**
   * A guia do PDF sem texto, lida da imagem pelo navegador.
   *
   * O texto passa por `textoDaImagem`, que joga fora todo código de pagamento
   * que o OCR tenha "lido" e fica só com o que veio do código de barras ou do
   * QR Code com os dígitos conferidos. O que sobra vai para o mesmo leitor do
   * PDF de texto — e a tela avisa que a leitura foi da imagem.
   */
  async lerDaImagem(dto: {
    texto: string;
    codigos?: string[];
    arquivoNome: string;
  }): Promise<LeituraDaGuia> {
    const texto = textoDaImagem(dto.texto, dto.codigos ?? []);
    const leitura = await this.lerDoTexto(texto, dto.arquivoNome);

    // O código de barras traz o valor dentro dele, lido por outro caminho que
    // não o OCR. Os dois discordando, quem errou foi o OCR — e é o número que
    // vai para a conta a pagar.
    const pagamento = leitura.guia.pagamento;
    const doCodigo =
      pagamento?.forma === 'BOLETO' ? valorDoCodigoDeBarras(pagamento.codigoBarras) : null;
    const contraOCodigo =
      doCodigo !== null && Math.abs(doCodigo - leitura.guia.valorTotal) >= 0.01
        ? `O total lido (${leitura.guia.valorTotal.toFixed(2)}) não bate com o valor do ` +
          `código de barras (${doCodigo.toFixed(2)}).`
        : null;

    return {
      ...leitura,
      divergencia: [leitura.divergencia, contraOCodigo].filter(Boolean).join(' ') || null,
      lidoDaImagem: true,
    };
  }

  private async lerDoTexto(texto: string, arquivoNome: string): Promise<LeituraDaGuia> {
    let guia: GuiaLida;
    try {
      guia = lerGuia(texto);
    } catch (err) {
      if (err instanceof GuiaIlegivelError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const existente = await this.prisma.guia.findFirst({
      where: {
        tipo: guia.tipo as TipoGuia,
        competencia: guia.competencia,
        // Sem o número (a leitura da imagem às vezes o perde), a guia do
        // mesmo tipo e mês já é suspeita de repetida: melhor avisar à toa do
        // que contar o mesmo imposto duas vezes.
        ...(guia.numeroDocumento ? { numeroDocumento: guia.numeroDocumento } : {}),
      },
      select: { id: true, competencia: true, valorTotal: true },
    });

    return {
      guia,
      arquivoNome,
      textoOriginal: texto,
      divergencia: conferir(guia),
      jaExiste: existente
        ? {
            id: existente.id,
            competencia: existente.competencia,
            valorTotal: Number(existente.valorTotal),
          }
        : null,
    };
  }

  private async extrairTexto(arquivo: Express.Multer.File): Promise<string> {
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo recebido.');
    }
    try {
      const texto = await extrairTextoPdf(new Uint8Array(arquivo.buffer));
      if (!texto.trim()) {
        // O `codigo` é o sinal para a tela ler a imagem (OCR) no navegador e
        // voltar por `guias/ler-texto`. A mensagem fica para quem ainda está
        // com a tela antiga aberta.
        throw new BadRequestException({
          message:
            'O PDF não tem texto — veio como imagem (impresso em PDF ou digitalizado).',
          codigo: 'PDF_SEM_TEXTO',
        });
      }
      return texto;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao ler o PDF ${arquivo.originalname}: ${motivo}`);
      throw new BadRequestException(`Não consegui abrir este PDF: ${motivo}`);
    }
  }

  /**
   * Grava o que a pessoa confirmou na tela. Vem do corpo da requisição, e não
   * de uma releitura do arquivo, justamente porque ela pode ter corrigido a
   * classificação de um item que o leitor não conhecia.
   */
  async gravar(dto: GravarGuiaDto, usuarioId?: string) {
    const soma = dto.itens.reduce((s, i) => s + i.valor, 0);
    if (Math.abs(soma - dto.valorTotal) >= 0.01) {
      throw new BadRequestException(
        `A soma dos itens (${soma.toFixed(2)}) não bate com o total da guia (${dto.valorTotal.toFixed(2)}).`,
      );
    }

    const guia = await this.criarGuia(dto, usuarioId);

    /*
     * A conta a pagar sai junto, e nunca derruba o lançamento da guia.
     *
     * A guia já está gravada a esta altura, e desfazê-la porque o IXC não
     * respondeu deixaria o pior dos dois mundos: nada registrado aqui e o
     * imposto continuando a vencer. Não dando, quem lançou recebe o aviso e
     * gera a conta pelo botão da própria tela, que faz esta mesma chamada.
     */
    let conta: ContaDaGuia | null = null;
    let avisoConta: string | null = null;
    try {
      conta = await this.gerarContaAPagar(guia.id, usuarioId);
    } catch (err) {
      avisoConta = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Guia ${guia.tipo} ${guia.competencia} foi gravada, mas não virou ` +
          `conta a pagar: ${avisoConta}`,
      );
    }

    return { ...guia, conta, avisoConta };
  }

  private async criarGuia(dto: GravarGuiaDto, usuarioId?: string) {
    try {
      return await this.prisma.guia.create({
        data: {
          tipo: dto.tipo as TipoGuia,
          competencia: dto.competencia,
          vencimento: new Date(dto.vencimento),
          valorTotal: new Prisma.Decimal(dto.valorTotal),
          numeroDocumento: dto.numeroDocumento || null,
          cnpj: dto.cnpj || null,
          razaoSocial: dto.razaoSocial || null,
          trabalhadores: dto.trabalhadores ?? null,
          arquivoNome: dto.arquivoNome,
          textoOriginal: dto.textoOriginal || null,
          criadoPor: usuarioId ?? null,
          itens: {
            create: dto.itens.map((i) => ({
              codigo: i.codigo || null,
              denominacao: i.denominacao,
              valor: new Prisma.Decimal(i.valor),
              classe: i.classe as ClasseTributo,
            })),
          },
        },
        include: { itens: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esta guia já foi lançada. Apague a anterior se quiser substituir.',
        );
      }
      throw err;
    }
  }

  listar(competencia?: string) {
    return this.prisma.guia.findMany({
      where: competencia ? { competencia } : undefined,
      orderBy: [{ competencia: 'desc' }, { vencimento: 'desc' }],
      take: 200,
      include: {
        itens: true,
        // A tela precisa saber se a guia já está na fila de pagamento, e com
        // que número procurá-la no IXC — senão a única saída para conferir é
        // caçar pelo valor na lista de contas em aberto.
        contaPagar: {
          select: { id: true, idFnApagarIxc: true, status: true, pagoEm: true },
        },
      },
    });
  }

  /**
   * Transforma a guia numa conta a pagar no IXC.
   *
   * Guia é imposto que vence — e vencia sem estar na fila de ninguém: o PDF
   * chegava, virava gráfico, e o pagamento continuava dependendo de alguém
   * lembrar. Aqui ela entra na mesma lista de contas em aberto que o resto, com
   * o vencimento impresso no documento e o código de pagamento que veio nele.
   *
   * É idempotente de propósito: chamar duas vezes devolve a conta que já
   * existe. Imposto pago em dobro não se estorna — se compensa, meses depois.
   */
  async gerarContaAPagar(
    guiaId: string,
    usuarioId?: string,
  ): Promise<ContaDaGuia> {
    const guia = await this.prisma.guia.findUnique({
      where: { id: guiaId },
      include: { contaPagar: true },
    });
    if (!guia) throw new NotFoundException('Guia não encontrada');

    if (guia.contaPagar) {
      return {
        guiaId: guia.id,
        contaPagarId: guia.contaPagar.id,
        idFnApagarIxc: guia.contaPagar.idFnApagarIxc,
        valor: Number(guia.contaPagar.valor),
        vencimento: guia.contaPagar.dataVencimento,
        fornecedor: {
          id: guia.contaPagar.idFornecedorIxc ?? 0,
          nome: guia.contaPagar.beneficiarioNome,
        },
        formaDePagamento: formaDe(lerPagamentoGuardado(guia.textoOriginal)),
        jaExistia: true,
        aviso: null,
      };
    }

    const fornecedor = await this.fornecedorDasGuias();
    const pagamento = lerPagamentoGuardado(guia.textoOriginal);
    const rotulo = ROTULO_DA_GUIA[guia.tipo];

    const conta = await this.contasPagar.criarDespesa(
      {
        idFornecedorIxc: fornecedor.id,
        fornecedorNome: fornecedor.nome,
        valor: Number(guia.valorTotal),
        // A emissão é hoje porque é hoje que a conta passa a existir para o
        // financeiro; o que manda no caixa é o vencimento, e esse vem impresso
        // na guia (dia 20, no mês seguinte ao da competência).
        dataEmissao: hojeUtc(),
        dataVencimento: guia.vencimento,
        observacao: `${rotulo} · competência ${competenciaBR(guia.competencia)}`,
        documento: guia.numeroDocumento,
        ...formaDePagar(pagamento),
      },
      usuarioId,
    );

    await this.prisma.guia.update({
      where: { id: guia.id },
      data: { contaPagarId: conta.id },
    });

    this.logger.log(
      `Guia ${rotulo} ${guia.competencia} virou conta a pagar ` +
        `${conta.idFnApagarIxc ?? '(sem número do IXC)'}: ` +
        `${Number(guia.valorTotal)} para ${fornecedor.nome}.`,
    );

    return {
      guiaId: guia.id,
      contaPagarId: conta.id,
      idFnApagarIxc: conta.idFnApagarIxc,
      valor: Number(conta.valor),
      vencimento: conta.dataVencimento,
      fornecedor,
      formaDePagamento: formaDe(pagamento),
      jaExistia: false,
      aviso: avisoDaForma(pagamento, rotulo),
    };
  }

  /**
   * Quem recebe as guias no IXC, procurado pelo nome.
   *
   * Não é configuração de tela: é uma decisão de quem paga, escrita em
   * `FORNECEDOR_DAS_GUIAS`. O que se procura aqui é o **código** dele nesta
   * base — que muda de instalação para instalação e não pode estar chumbado.
   */
  private async fornecedorDasGuias(): Promise<{ id: number; nome: string }> {
    if (
      this.fornecedor &&
      Date.now() - this.fornecedor.em < VALIDADE_DO_FORNECEDOR_MS
    ) {
      return this.fornecedor.achado;
    }

    const achados = await this.fornecedores.buscarNoIxcPorNome(
      FORNECEDOR_DAS_GUIAS,
      10,
    );
    // O nome exato ganha da busca por aproximação: "Receita Federal" e
    // "Receita Federal do Brasil - PGFN" são cadastros diferentes, e a conta
    // tem de sair sempre no mesmo.
    const exato = achados.find(
      (f) => normalizar(f.nome) === normalizar(FORNECEDOR_DAS_GUIAS),
    );
    const escolhido = exato ?? achados[0];

    if (!escolhido) {
      throw new BadRequestException(
        `Não achei o fornecedor "${FORNECEDOR_DAS_GUIAS}" no IXC, e sem ele a ` +
          'guia não vira conta a pagar. Cadastre-o lá e tente de novo — a guia ' +
          'continua gravada aqui.',
      );
    }

    const achado = { id: escolhido.idFornecedor, nome: escolhido.nome };
    this.fornecedor = { em: Date.now(), achado };
    return achado;
  }

  async remover(id: string) {
    const guia = await this.prisma.guia.findUnique({ where: { id } });
    if (!guia) throw new NotFoundException('Guia não encontrada');
    await this.prisma.guia.delete({ where: { id } });
  }

  /**
   * Quanto cada classe pesou em cada mês. É o que separa "o que a empresa
   * gastou com gente" do que só passou pela conta dela.
   */
  async resumo(meses: string[]): Promise<ResumoImpostos> {
    const guias = await this.prisma.guia.findMany({
      where: { competencia: { in: meses } },
      include: { itens: true },
    });

    const porMes = new Map<string, PorClasse>();
    for (const mes of meses) porMes.set(mes, zerado());

    for (const guia of guias) {
      const alvo = porMes.get(guia.competencia);
      if (!alvo) continue;
      for (const item of guia.itens) {
        alvo[CHAVE_DA_CLASSE[item.classe]] += Number(item.valor);
      }
    }

    const serie = meses.map((competencia) => ({
      competencia,
      ...arredondarClasses(porMes.get(competencia) ?? zerado()),
    }));

    return {
      serie,
      total: arredondarClasses(
        serie.reduce(
          (soma, m) => ({
            folhaPatronal: soma.folhaPatronal + m.folhaPatronal,
            folhaRetido: soma.folhaRetido + m.folhaRetido,
            faturamento: soma.faturamento + m.faturamento,
          }),
          zerado(),
        ),
      ),
      guias: guias.map((g) => ({
        id: g.id,
        tipo: g.tipo,
        competencia: g.competencia,
        vencimento: g.vencimento,
        valorTotal: Number(g.valorTotal),
        trabalhadores: g.trabalhadores,
      })),
    };
  }
}

interface PorClasse {
  folhaPatronal: number;
  folhaRetido: number;
  faturamento: number;
}

export interface ResumoImpostos {
  serie: Array<{ competencia: string } & PorClasse>;
  total: PorClasse;
  guias: Array<{
    id: string;
    tipo: TipoGuia;
    competencia: string;
    vencimento: Date;
    valorTotal: number;
    trabalhadores: number | null;
  }>;
}

const CHAVE_DA_CLASSE: Record<ClasseTributo, keyof PorClasse> = {
  FOLHA_PATRONAL: 'folhaPatronal',
  FOLHA_RETIDO: 'folhaRetido',
  FATURAMENTO: 'faturamento',
};

function zerado(): PorClasse {
  return { folhaPatronal: 0, folhaRetido: 0, faturamento: 0 };
}

function arredondarClasses(p: PorClasse): PorClasse {
  return {
    folhaPatronal: arredondar(p.folhaPatronal),
    folhaRetido: arredondar(p.folhaRetido),
    faturamento: arredondar(p.faturamento),
  };
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * O que a guia manda para a conta a pagar sobre **como** ela se paga.
 *
 * Boleto sem código e PIX sem chave chegam ao IXC iguais: uma conta que ninguém
 * consegue pagar sem abrir o PDF e digitar. Por isso a forma vai junto com o
 * dado — o tipo sozinho não serve de nada.
 *
 * O FGTS é o caso do "copia e cola": o payload inteiro do QR Code vira a chave
 * PIX da conta, com o tipo que a tela do IXC usa para essa chave que vale só
 * para uma cobrança.
 */
function formaDePagar(pagamento: PagamentoDaGuia | null): {
  tipoPagamentoIxc?: string;
  codigoBarras?: string;
  chavePix?: string;
  tipoChavePix?: string;
} {
  if (!pagamento) return {};
  if (pagamento.forma === 'BOLETO') {
    return { tipoPagamentoIxc: 'Boleto', codigoBarras: pagamento.codigoBarras };
  }
  return {
    tipoPagamentoIxc: 'Pix',
    chavePix: pagamento.copiaECola,
    tipoChavePix: 'Código copia e cola',
  };
}

function formaDe(pagamento: PagamentoDaGuia | null): 'BOLETO' | 'PIX' | null {
  return pagamento?.forma ?? null;
}

/** O que quem paga precisa saber antes de abrir a fila. */
function avisoDaForma(
  pagamento: PagamentoDaGuia | null,
  rotulo: string,
): string | null {
  if (pagamento) return null;
  return (
    `A conta do ${rotulo} foi lançada, mas o PDF não trouxe linha digitável ` +
    'nem PIX que eu reconhecesse — ela vai chegar ao IXC sem como ser paga. ' +
    'Cole o código na conta, pela lista de contas em aberto.'
  );
}

/**
 * A forma de pagamento relida do texto guardado da guia.
 *
 * O código de barras não é gravado em coluna própria: o que se guarda é o texto
 * do PDF inteiro, e dele sai tudo o que se precisa reler depois. Guia digitada
 * à mão não tem texto — e aí não há código nenhum para achar.
 */
function lerPagamentoGuardado(texto: string | null): PagamentoDaGuia | null {
  return texto ? lerPagamento(texto) : null;
}

/** "2026-07" → "07/2026", que é como a competência se lê numa fila de contas. */
function competenciaBR(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return mes ? `${mes}/${ano}` : competencia;
}

/** Hoje à meia-noite UTC, como o resto das datas desta casa. */
function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}

/** Sem acento, sem caixa, sem espaço sobrando: para comparar nome de cadastro. */
function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}
