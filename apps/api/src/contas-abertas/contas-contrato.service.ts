import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContaContrato, ContaPagar, Prisma } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { IxcClient } from '../ixc/ixc.client';
import {
  pareceCodigoDeBoleto,
  somenteDigitosDoBoleto,
} from '../ixc/ixc.financeiro';
import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';
import {
  primeiraData,
  primeiroTexto,
} from './contas-abertas.mapper';
import { CategoriasService } from './categorias.service';
import { proximoDiaUtil } from './dias-uteis';

/** Quantas contas geradas entram na média que vira o valor de referência. */
const MESES_NA_REFERENCIA = 6;

/**
 * De quanto o valor precisa fugir da referência para a tela estranhar.
 *
 * Conta de luz varia sozinha — verão, bomba d'água ligada, mês de 31 dias. O
 * que não é normal é dobrar. Meio e dobro deixam passar a variação da estação
 * e param no que costuma ser erro de digitação (um zero a mais) ou fatura de
 * outro endereço.
 */
const FORA_DO_PADRAO_ACIMA = 2;
const FORA_DO_PADRAO_ABAIXO = 0.5;

/**
 * Quantos títulos se lê do IXC por conta contrato ao vasculhar o histórico.
 *
 * Dez anos de conta de luz cabem em 120 linhas; duzentas dão folga e ainda
 * são uma consulta só por endereço.
 */
const TETO_DO_HISTORICO_IXC = 200;

/** O que o histórico do IXC contou sobre um endereço. */
export interface DescobertaDoHistorico {
  numero: string;
  /** O nome que veio na lista colada, quando veio. */
  apelido: string | null;
  /** Quantos títulos daquele número foram achados no IXC. */
  titulos: number;
  fornecedor: { id: number; nome: string | null } | null;
  contaContabil: number | null;
  contaPagamento: number | null;
  tipoPagamento: string | null;
  /** O dia do mês em que essas contas costumam vencer. */
  diaDeVencimento: number | null;
  ultimoVencimento: Date | null;
  /** As últimas faturas achadas, da mais recente para a mais antiga. */
  valores: Array<{ competencia: string; valor: number }>;
  media: number | null;
  /** Já existe cadastro com este número — importar de novo seria repetir. */
  jaCadastrada: boolean;
  /** O que não deu para descobrir, em uma linha. */
  aviso: string | null;
}

/** O que o histórico sugere para todos os endereços de uma vez. */
export interface SugestaoDeImportacao {
  fornecedor: { id: number; nome: string | null } | null;
  contaContabil: number | null;
  contaPagamento: number | null;
  tipoPagamento: string | null;
}

/** Uma conta contrato com o que a tela do mês precisa saber sem abrir nada. */
export interface ContaContratoDoMes {
  contrato: ContaContrato;
  /**
   * A conta já lançada nesta competência, quando existe. É ela que responde
   * "esta já foi" — e é a razão de a tela não deixar lançar de novo.
   */
  gerada: {
    id: string;
    idFnApagarIxc: number | null;
    valor: number;
    dataVencimento: Date;
    status: string;
    pagoEm: Date | null;
  } | null;
  /** O que já se pagou neste endereço, do mais recente para o mais antigo. */
  historico: Array<{ competencia: string; valor: number }>;
  /** A média do histórico — o que a tela usa para estranhar o valor de agora. */
  media: number | null;
  /**
   * Dias até a fatura costumar chegar, contados do dia de hoje. Negativo = o
   * dia de chegada já passou e ela não foi lançada. Null quando a competência
   * pedida não é a do mês corrente: cobrar "atrasada" num mês fechado ou
   * futuro não quer dizer nada.
   */
  diasParaChegar: number | null;
}

/** O que uma rodada de geração fez. */
export interface ResultadoDaGeracaoDeContratos {
  geradas: Array<{ id: string; apelido: string; idFnApagarIxc: number | null }>;
  falhas: Array<{ id: string; apelido: string; erro: string }>;
  /** Quanto foi lançado ao todo. */
  total: number;
}

/** Uma linha do lote: a conta contrato e quanto veio na fatura dela. */
export interface LancamentoDeContrato {
  id: string;
  valor: number;
  /** Vencimento desta fatura (AAAA-MM-DD). Vazio = o dia de sempre do cadastro. */
  dataVencimento?: string;
  /**
   * O código com que a fatura se paga: a linha digitável do boleto ou o copia
   * e cola do PIX. Um campo só porque é uma coisa só para quem digita — o que
   * veio impresso na conta —, e é o serviço que sabe distinguir os dois.
   */
  codigo?: string;
  /** O que a tela quiser acrescentar à observação do título. */
  observacao?: string;
}

/** O que o código da fatura significa para o título no IXC. */
interface CodigoDaFatura {
  codigoBarras?: string;
  chavePix?: string;
  tipoChavePix?: string;
  /** Boleto ou Pix — o código manda sobre o tipo padrão do cadastro. */
  tipoPagamento?: string;
}

/**
 * O que fazer com o código que veio na fatura.
 *
 * São dois formatos, e a conta a pagar os guarda em campos diferentes no IXC:
 * a linha digitável vai em `codigo_barras` e o copia e cola do PIX vai na
 * chave. Trocá-los deixa um título que nenhum banco paga — e é por isso que
 * aqui se recusa o que não se reconhece, em vez de chutar um dos dois.
 *
 * O tipo de pagamento vem junto: a fatura de energia às vezes chega com
 * boleto, às vezes com QR Code, e é o código na mão que diz qual foi desta
 * vez — não o padrão do cadastro.
 */
export function lerCodigoDaFatura(codigo?: string): CodigoDaFatura {
  const texto = (codigo ?? '').trim();
  if (!texto) return {};

  // O copia e cola é o payload do QR Code: começa em "000201" e termina no
  // CRC. É o mesmo reconhecimento que a leitura das guias de imposto faz.
  if (/^000201/.test(texto) || /br\.gov\.bcb\.pix/i.test(texto)) {
    return {
      chavePix: texto,
      tipoChavePix: 'Código copia e cola',
      tipoPagamento: 'Pix',
    };
  }

  const digitos = somenteDigitosDoBoleto(texto);
  if (pareceCodigoDeBoleto(digitos)) {
    return { codigoBarras: digitos, tipoPagamento: 'Boleto' };
  }

  throw new BadRequestException(
    `O código informado não é uma linha digitável (44, 47 ou 48 dígitos — ` +
      `este tem ${digitos.length}) nem um copia e cola do PIX. Confira o que ` +
      'foi colado: o título iria para o IXC sem como ser pago.',
  );
}

/**
 * As contas de energia dos endereços da empresa.
 *
 * Cada unidade consumidora tem um número de conta contrato na distribuidora, e
 * as faturas chegam todas juntas uma vez por mês — cada uma com um valor
 * diferente, que só se sabe quando ela chega. Antes disto, cada fatura virava
 * um lançamento à mão: procurar o fornecedor, escolher a conta contábil,
 * escrever de que endereço era. Onze vezes, no mesmo dia, todo mês.
 *
 * O que este serviço guarda é o que não muda — o endereço, o número, para quem
 * se paga, como a conta sai. O que muda é digitado na hora de gerar.
 *
 * Duas coisas ele não faz de propósito:
 *
 * - **não gera sozinho**, como as recorrentes. Aquelas têm valor fixo; esta
 *   não se sabe antes de a fatura chegar, e lançar um valor estimado no
 *   financeiro de verdade criaria dívida no valor errado;
 * - **não lança a mesma competência duas vezes**. O par (conta contrato, mês)
 *   é conferido antes, porque a fatura que chega atrasada é justamente a que
 *   alguém lança de novo sem lembrar que já lançou.
 */
@Injectable()
export class ContasContratoService {
  private readonly logger = new Logger(ContasContratoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
    // Para vasculhar o histórico: as contas de luz de anos anteriores estão no
    // IXC, e é de lá que sai o dia em que cada endereço vence.
    private readonly ixc: IxcClient,
  ) {}

  /**
   * As contas contrato e como cada uma está na competência pedida.
   *
   * A leitura é a da tela do mês: quais já foram lançadas, quais faltam, o que
   * cada uma costuma custar. Vem tudo de uma vez porque é assim que se
   * trabalha — as faturas chegam num maço, e quem as lança precisa ver o maço
   * inteiro para saber o que falta.
   */
  async listar(
    competencia?: string,
    incluirDesligadas = true,
  ): Promise<{ competencia: string; contas: ContaContratoDoMes[] }> {
    const alvo = validarCompetencia(competencia ?? mesAtual());

    const contratos = await this.prisma.contaContrato.findMany({
      where: incluirDesligadas ? undefined : { ativa: true },
      orderBy: [{ ativa: 'desc' }, { apelido: 'asc' }],
    });

    const lancadas = await this.prisma.contaPagar.findMany({
      where: { contaContratoId: { in: contratos.map((c) => c.id) } },
      orderBy: { competencia: 'desc' },
      select: {
        id: true,
        contaContratoId: true,
        competencia: true,
        valor: true,
        dataVencimento: true,
        status: true,
        pagoEm: true,
        idFnApagarIxc: true,
      },
    });

    const hoje = hojeUtc();
    const ehMesCorrente = alvo === mesAtual();

    return {
      competencia: alvo,
      contas: contratos.map((contrato) => {
        const dela = lancadas.filter((l) => l.contaContratoId === contrato.id);
        const gerada = dela.find((l) => l.competencia === alvo) ?? null;
        /*
         * O histórico não inclui a competência aberta: ela é o número que se
         * está conferindo agora, e uma média que já contenha o valor de hoje
         * não serve para estranhá-lo.
         */
        const historico = dela
          .filter((l) => l.competencia && l.competencia !== alvo)
          .slice(0, MESES_NA_REFERENCIA)
          .map((l) => ({
            competencia: l.competencia!,
            valor: Number(l.valor),
          }));

        return {
          contrato,
          gerada: gerada
            ? {
                id: gerada.id,
                idFnApagarIxc: gerada.idFnApagarIxc,
                valor: Number(gerada.valor),
                dataVencimento: gerada.dataVencimento,
                status: gerada.status,
                pagoEm: gerada.pagoEm,
              }
            : null,
          historico,
          media: media(historico.map((h) => h.valor)),
          diasParaChegar: ehMesCorrente
            ? contrato.diaDeChegada - hoje.getUTCDate()
            : null,
        };
      }),
    };
  }

  /**
   * O que o IXC já sabe sobre cada conta contrato — lido dos títulos que
   * alguém lançou à mão nos anos anteriores.
   *
   * A conta de luz não é novidade nenhuma para a empresa: ela é paga há anos, e
   * cada fatura virou um `fn_apagar` com o número da conta contrato escrito na
   * observação. É esse rastro que responde o que o cadastro precisa saber e
   * ninguém tem de cabeça: em que dia cada endereço vence, para quem se paga,
   * em que conta contábil aquilo entra, e quanto costuma custar.
   *
   * O dia é o **mais frequente** entre os vencimentos, e não o do último
   * título: uma fatura paga com atraso e relançada com outra data não pode
   * mudar o dia do endereço inteiro.
   *
   * Só lê. O que sai daqui é uma proposta para alguém conferir antes de virar
   * cadastro.
   */
  async descobrirNoHistorico(
    pedidos: Array<{ numero: string; apelido?: string }>,
  ): Promise<{
    descobertas: DescobertaDoHistorico[];
    sugestao: SugestaoDeImportacao;
  }> {
    const vistos = new Set<string>();
    const descobertas: DescobertaDoHistorico[] = [];

    const fornecedores: number[] = [];
    const contabeis: number[] = [];
    const pagamentos: number[] = [];
    const tipos: string[] = [];

    for (const pedido of pedidos) {
      const numero = somenteDigitos(pedido.numero);
      if (!numero || vistos.has(numero)) continue;
      vistos.add(numero);

      const jaCadastrada = !!(await this.prisma.contaContrato.findUnique({
        where: { numero },
        select: { id: true },
      }));

      const achado = await this.lerHistoricoDoNumero(numero);
      descobertas.push({
        numero,
        apelido: pedido.apelido?.trim() || null,
        jaCadastrada,
        ...achado,
      });

      if (achado.fornecedor) fornecedores.push(achado.fornecedor.id);
      if (achado.contaContabil) contabeis.push(achado.contaContabil);
      if (achado.contaPagamento) pagamentos.push(achado.contaPagamento);
      if (achado.tipoPagamento) tipos.push(achado.tipoPagamento);
    }

    /*
     * A sugestão de cima é a moda de todos os endereços juntos: eles pagam a
     * mesma distribuidora, na mesma conta contábil, pela mesma conta bancária.
     * O endereço cujo histórico não trouxe nada herda daí, em vez de ficar sem
     * — e quem conferir vê o mesmo valor repetido em todas as linhas, que é
     * justamente o sinal de que está certo.
     */
    const idFornecedor = maisFrequente(fornecedores);
    const nomeDoFornecedor =
      descobertas.find((d) => d.fornecedor?.id === idFornecedor)?.fornecedor
        ?.nome ?? null;

    return {
      descobertas,
      sugestao: {
        fornecedor:
          idFornecedor === null
            ? null
            : { id: idFornecedor, nome: nomeDoFornecedor },
        contaContabil: maisFrequente(contabeis),
        contaPagamento: maisFrequente(pagamentos),
        tipoPagamento: maisFrequente(tipos),
      },
    };
  }

  /**
   * Os títulos que trazem aquele número na observação.
   *
   * A busca é pelo `obs` com LIKE, que é como o número foi escrito lá: o IXC
   * não tem campo para conta contrato, e é por isso que ele acabou no texto.
   * Título cancelado fica de fora — ele não foi pago e não diz nada sobre
   * quanto o endereço custa.
   *
   * Falhar aqui não derruba a descoberta inteira: o endereço volta com o
   * aviso, e os outros continuam respondendo.
   */
  private async lerHistoricoDoNumero(
    numero: string,
  ): Promise<Omit<DescobertaDoHistorico, 'numero' | 'apelido' | 'jaCadastrada'>> {
    const vazio = {
      titulos: 0,
      fornecedor: null,
      contaContabil: null,
      contaPagamento: null,
      tipoPagamento: null,
      diaDeVencimento: null,
      ultimoVencimento: null,
      valores: [],
      media: null,
    };

    let registros: Record<string, unknown>[];
    try {
      const res = await this.ixc.list<Record<string, unknown>>('fn_apagar', {
        qtype: 'fn_apagar.obs',
        query: numero,
        // "L" é o LIKE do webservice: o número está no meio de um texto
        // ("ENERGIA LOJA 3010664470"), nunca sozinho.
        oper: 'L',
        rp: TETO_DO_HISTORICO_IXC,
        sortname: 'fn_apagar.data_vencimento',
        sortorder: 'desc',
      });
      registros = res.registros;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Nao deu para ler o historico da conta contrato ${numero}: ${motivo}`,
      );
      return { ...vazio, aviso: `O IXC nao respondeu a busca (${motivo}).` };
    }

    const dias: number[] = [];
    const fornecedores: number[] = [];
    const contabeis: number[] = [];
    const pagamentos: number[] = [];
    const tipos: string[] = [];
    const faturas: Array<{ competencia: string; valor: number }> = [];
    let nomeDoFornecedor: string | null = null;
    let ultimoVencimento: Date | null = null;
    let contados = 0;

    for (const raw of registros) {
      // Base que ignore o filtro devolve tudo: sem conferir o número de novo,
      // o dia de vencimento sairia da conta de outro endereço.
      const obs = String(raw.obs ?? raw.observacao ?? '');
      if (!somenteDigitos(obs).includes(numero)) continue;

      // Cancelado não foi pago e não conta para nada — nem para o dia, nem
      // para a média.
      if (String(raw.status ?? '').trim().toUpperCase() === 'C') continue;

      contados += 1;

      const vencimento = primeiraData(raw, [
        'data_vencimento',
        'data_venc',
        'vencimento',
      ]);
      if (vencimento) {
        dias.push(vencimento.getUTCDate());
        if (!ultimoVencimento || vencimento > ultimoVencimento) {
          ultimoVencimento = vencimento;
        }
        const valor = parseIxcDecimal(raw.valor ?? raw.valor_documento);
        if (valor > 0 && faturas.length < MESES_NA_REFERENCIA) {
          faturas.push({ competencia: mesDaData(vencimento), valor });
        }
      }

      const idFornecedor = parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id);
      if (idFornecedor) {
        fornecedores.push(idFornecedor);
        nomeDoFornecedor =
          nomeDoFornecedor ??
          primeiroTexto(raw, ['fornecedor', 'razao', 'nome_fornecedor']);
      }

      const contabil = parseIxcId(raw.id_conta);
      if (contabil) contabeis.push(contabil);
      const pagamento = parseIxcId(raw.id_contas);
      if (pagamento) pagamentos.push(pagamento);
      const tipo = primeiroTexto(raw, ['tipo_pagamento']);
      if (tipo) tipos.push(tipo);
    }

    if (contados === 0) {
      return {
        ...vazio,
        aviso:
          'Nenhum titulo com este numero na observacao. Ou ele nunca foi ' +
          'lancado aqui, ou foi escrito de outro jeito.',
      };
    }

    const idFornecedor = maisFrequente(fornecedores);

    return {
      titulos: contados,
      fornecedor:
        idFornecedor === null
          ? null
          : { id: idFornecedor, nome: nomeDoFornecedor },
      contaContabil: maisFrequente(contabeis),
      contaPagamento: maisFrequente(pagamentos),
      tipoPagamento: maisFrequente(tipos),
      diaDeVencimento: maisFrequente(dias),
      ultimoVencimento,
      valores: faturas,
      media: media(faturas.map((f) => f.valor)),
      aviso:
        dias.length === 0
          ? 'Os titulos achados nao tem vencimento no IXC: o dia precisa ser informado a mao.'
          : null,
    };
  }

  /**
   * Cadastra vários endereços de uma vez, a partir do que a descoberta achou.
   *
   * Um por um, e o que entrou fica: cadastro repetido (o número já existe) é
   * recusado sozinho, sem levar os outros junto. É o mesmo desenho da geração
   * das faturas, e pelo mesmo motivo — o maço é o trabalho, e ele não pode
   * parar na terceira linha.
   */
  async importar(
    padroes: {
      idFornecedorIxc: number;
      fornecedorNome: string;
      contaContabil?: number;
      contaPagamento?: number;
      tipoPagamentoIxc?: string;
      categoriaId?: string | null;
    },
    itens: Array<{
      apelido: string;
      numero: string;
      diaDeChegada: number;
      diaDeVencimento: number;
      /** A média que o histórico do IXC mostrou, quando houve. */
      valorDeReferencia?: number;
    }>,
    usuarioId?: string,
  ): Promise<{
    criadas: Array<{ id: string; apelido: string }>;
    falhas: Array<{ apelido: string; numero: string; erro: string }>;
  }> {
    const criadas: Array<{ id: string; apelido: string }> = [];
    const falhas: Array<{ apelido: string; numero: string; erro: string }> = [];

    for (const item of itens) {
      try {
        const criada = await this.criar(
          {
            apelido: item.apelido,
            numero: item.numero,
            idFornecedorIxc: padroes.idFornecedorIxc,
            fornecedorNome: padroes.fornecedorNome,
            diaDeChegada: item.diaDeChegada,
            diaDeVencimento: item.diaDeVencimento,
            contaContabil: padroes.contaContabil,
            contaPagamento: padroes.contaPagamento,
            tipoPagamentoIxc: padroes.tipoPagamentoIxc,
            categoriaId: padroes.categoriaId ?? null,
          },
          usuarioId,
        );

        /*
         * A média vem do histórico do IXC, e não de zero.
         *
         * Sem isto, a tela só começaria a estranhar valor fora do padrão
         * depois de alguns meses de uso — justamente o período em que ninguém
         * ainda tem o costume de conferir a lista.
         */
        if (item.valorDeReferencia && item.valorDeReferencia > 0) {
          await this.prisma.contaContrato.update({
            where: { id: criada.id },
            data: {
              valorDeReferencia: new Prisma.Decimal(item.valorDeReferencia),
            },
          });
        }

        criadas.push({ id: criada.id, apelido: criada.apelido });
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        falhas.push({ apelido: item.apelido, numero: item.numero, erro });
      }
    }

    this.logger.log(
      `Importacao de contas contrato: ${criadas.length} cadastradas, ` +
        `${falhas.length} recusadas.`,
    );
    return { criadas, falhas };
  }

  async criar(
    dados: {
      apelido: string;
      numero: string;
      idFornecedorIxc: number;
      fornecedorNome: string;
      diaDeChegada: number;
      diaDeVencimento: number;
      contaContabil?: number;
      contaPagamento?: number;
      tipoPagamentoIxc?: string;
      categoriaId?: string | null;
      observacao?: string;
    },
    usuarioId?: string,
  ): Promise<ContaContrato> {
    const numero = somenteDigitos(dados.numero);
    if (!numero) {
      throw new BadRequestException(
        'O número da conta contrato é o que identifica o endereço na ' +
          'distribuidora — sem ele não há o que cadastrar.',
      );
    }

    // A mesma conta contrato cadastrada duas vezes seria a mesma fatura
    // lançada duas vezes, cada uma achando que a outra não existe.
    const repetida = await this.prisma.contaContrato.findUnique({
      where: { numero },
    });
    if (repetida) {
      throw new BadRequestException(
        `A conta contrato ${numero} já está cadastrada em "${repetida.apelido}".`,
      );
    }

    const criada = await this.prisma.contaContrato.create({
      data: {
        apelido: dados.apelido.trim(),
        numero,
        idFornecedorIxc: dados.idFornecedorIxc,
        fornecedorNome: dados.fornecedorNome.trim(),
        diaDeChegada: diaDoMes(dados.diaDeChegada, 'de chegada'),
        diaDeVencimento: diaDoMes(dados.diaDeVencimento, 'de vencimento'),
        contaContabil: dados.contaContabil ?? null,
        contaPagamento: dados.contaPagamento ?? null,
        tipoPagamentoIxc: dados.tipoPagamentoIxc ?? null,
        categoriaId: dados.categoriaId ?? null,
        observacao: dados.observacao?.trim() || null,
        criadoPor: usuarioId ?? null,
      },
    });

    this.logger.log(
      `Conta contrato cadastrada: ${criada.apelido} (${criada.numero}).`,
    );
    return criada;
  }

  async atualizar(
    id: string,
    dados: Partial<{
      apelido: string;
      numero: string;
      idFornecedorIxc: number;
      fornecedorNome: string;
      diaDeChegada: number;
      diaDeVencimento: number;
      contaContabil: number;
      contaPagamento: number;
      tipoPagamentoIxc: string;
      categoriaId: string | null;
      observacao: string;
      ativa: boolean;
    }>,
  ): Promise<ContaContrato> {
    await this.buscar(id);

    const numero =
      dados.numero === undefined ? undefined : somenteDigitos(dados.numero);
    if (numero) {
      const outra = await this.prisma.contaContrato.findUnique({
        where: { numero },
      });
      if (outra && outra.id !== id) {
        throw new BadRequestException(
          `A conta contrato ${numero} já está cadastrada em "${outra.apelido}".`,
        );
      }
    }

    return this.prisma.contaContrato.update({
      where: { id },
      data: {
        ...(dados.apelido === undefined ? {} : { apelido: dados.apelido.trim() }),
        ...(numero ? { numero } : {}),
        ...(dados.idFornecedorIxc === undefined
          ? {}
          : { idFornecedorIxc: dados.idFornecedorIxc }),
        ...(dados.fornecedorNome === undefined
          ? {}
          : { fornecedorNome: dados.fornecedorNome.trim() }),
        ...(dados.diaDeChegada === undefined
          ? {}
          : { diaDeChegada: diaDoMes(dados.diaDeChegada, 'de chegada') }),
        ...(dados.diaDeVencimento === undefined
          ? {}
          : {
              diaDeVencimento: diaDoMes(dados.diaDeVencimento, 'de vencimento'),
            }),
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
        ...(dados.observacao === undefined
          ? {}
          : { observacao: dados.observacao.trim() || null }),
        ...(dados.ativa === undefined ? {} : { ativa: dados.ativa }),
      },
    });
  }

  /**
   * Tira a conta contrato do cadastro.
   *
   * As contas que ela já gerou ficam: são dívidas de verdade no IXC, e sumir
   * com elas porque o imóvel foi vendido seria apagar o que a empresa deve. É
   * também por isso que desligar costuma ser melhor que apagar — o histórico
   * de consumo daquele endereço continua respondendo por quanto ele custava.
   */
  async remover(id: string): Promise<void> {
    await this.buscar(id);
    await this.prisma.contaContrato.delete({ where: { id } });
  }

  async buscar(id: string): Promise<ContaContrato> {
    const c = await this.prisma.contaContrato.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Conta contrato não encontrada');
    return c;
  }

  /**
   * Lança no IXC as faturas do mês — uma, algumas ou todas.
   *
   * Uma de cada vez, e o que já entrou fica de pé se a seguinte falhar: são
   * contas a pagar de verdade, e desfazer as que deram certo por causa da que
   * não deu daria mais trabalho do que lançar de novo a que faltou. Quem
   * clicou vê quais passaram e quais não.
   */
  async gerar(
    competencia: string,
    lancamentos: LancamentoDeContrato[],
    usuarioId?: string,
  ): Promise<ResultadoDaGeracaoDeContratos> {
    const alvo = validarCompetencia(competencia);
    const resultado: ResultadoDaGeracaoDeContratos = {
      geradas: [],
      falhas: [],
      total: 0,
    };

    for (const linha of lancamentos) {
      const contrato = await this.prisma.contaContrato.findUnique({
        where: { id: linha.id },
      });
      if (!contrato) {
        resultado.falhas.push({
          id: linha.id,
          apelido: linha.id,
          erro: 'Esta conta contrato não existe mais no cadastro.',
        });
        continue;
      }

      try {
        const conta = await this.gerarUma(contrato, alvo, linha, usuarioId);
        resultado.geradas.push({
          id: contrato.id,
          apelido: contrato.apelido,
          idFnApagarIxc: conta.idFnApagarIxc,
        });
        resultado.total += Number(conta.valor);
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Conta de energia de ${contrato.apelido} (${alvo}) não foi lançada: ${erro}`,
        );
        resultado.falhas.push({
          id: contrato.id,
          apelido: contrato.apelido,
          erro,
        });
      }
    }

    resultado.total = Math.round(resultado.total * 100) / 100;
    return resultado;
  }

  /**
   * Uma fatura: a conta a pagar no IXC, a etiqueta desta casa e o vínculo que
   * diz de que endereço e de que mês ela é.
   */
  private async gerarUma(
    contrato: ContaContrato,
    competencia: string,
    linha: LancamentoDeContrato,
    usuarioId?: string,
  ): Promise<ContaPagar> {
    if (!(linha.valor > 0)) {
      throw new BadRequestException(
        'Falta o valor que veio na fatura — é o único número que este ' +
          'cadastro não sabe de antemão.',
      );
    }

    /*
     * A mesma competência não é lançada duas vezes.
     *
     * É a conferência que a lista do IXC não sabe fazer: lá as onze faturas do
     * mês são onze títulos parecidos da mesma distribuidora, e a que chegou
     * atrasada é sempre a candidata a ser lançada de novo. Aqui o par
     * (endereço, mês) é único, e quem quiser mesmo duas contas do mesmo mês —
     * a fatura mais a religação, digamos — lança a segunda pela tela de
     * despesa avulsa, onde ela não se confunde com a do mês.
     */
    const jaLancada = await this.prisma.contaPagar.findFirst({
      where: { contaContratoId: contrato.id, competencia },
      select: { id: true, idFnApagarIxc: true, valor: true },
    });
    if (jaLancada) {
      throw new BadRequestException(
        `A conta de ${mesPorExtenso(competencia)} de ${contrato.apelido} já foi ` +
          `lançada${
            jaLancada.idFnApagarIxc
              ? ` (título ${jaLancada.idFnApagarIxc} no IXC)`
              : ''
          }, no valor de ${moeda(Number(jaLancada.valor))}.`,
      );
    }

    const vencimento = linha.dataVencimento
      ? dataUtc(linha.dataVencimento)
      : /*
         * Sem data informada, o dia de sempre daquele endereço — andando para
         * o próximo dia útil quando ele cai em sábado, domingo ou feriado. É a
         * mesma regra das recorrentes: conta que nasce vencendo num dia em que
         * o banco não paga amanhece atrasada.
         */
        proximoDiaUtil(diaDaCompetencia(competencia, contrato.diaDeVencimento));

    /*
     * O número da conta contrato vai escrito na observação, e não só no campo
     * do documento.
     *
     * É a convenção da casa, de antes deste app existir: no IXC as contas de
     * luz são achadas procurando o número no texto da observação, porque não
     * há campo próprio para ele. Manter o costume é o que faz a busca de lá
     * continuar encontrando as contas lançadas daqui — e é dela que sai o
     * histórico de cada endereço.
     */
    const observacao = [
      `Energia ${contrato.apelido} ${mesPorExtenso(competencia)}`,
      `conta contrato ${contrato.numero}`,
      contrato.observacao,
    ]
      .filter(Boolean)
      .join(' - ')
      .slice(0, 500);

    /*
     * O código da fatura é lido antes de qualquer escrita: se ele não for
     * reconhecido, a conta não chega a ser criada. Conta a pagar no IXC sem
     * como ser paga é pior do que conta nenhuma — ela some no meio das outras
     * e só reaparece vencida.
     */
    const codigo = lerCodigoDaFatura(linha.codigo);

    const conta = await this.contasPagar.criarDespesa(
      {
        idFornecedorIxc: contrato.idFornecedorIxc,
        fornecedorNome: contrato.fornecedorNome,
        valor: linha.valor,
        dataEmissao: hojeUtc(),
        dataVencimento: vencimento,
        observacao: linha.observacao?.trim() || observacao,
        contaContabil: contrato.contaContabil ?? undefined,
        contaPagamento: contrato.contaPagamento ?? undefined,
        // O que veio na fatura manda sobre o tipo do cadastro: a conta que
        // chega com QR Code é paga por PIX, mesmo que o padrão diga boleto.
        tipoPagamentoIxc:
          codigo.tipoPagamento ?? contrato.tipoPagamentoIxc ?? undefined,
        codigoBarras: codigo.codigoBarras ?? null,
        chavePix: codigo.chavePix ?? null,
        tipoChavePix: codigo.tipoChavePix ?? null,
        // O número da conta contrato vai no documento do título: é o que
        // permite, meses depois, saber de que endereço era uma conta paga sem
        // depender de o texto da observação ter sido escrito igual.
        documento: contrato.numero,
      },
      usuarioId,
    );

    /*
     * O vínculo é gravado depois de a conta existir, e não dentro da criação:
     * `criarDespesa` é o caminho comum de toda despesa lançada à mão, e ela
     * não precisa saber que existem contas de energia. O que ela devolve é o
     * registro daqui, e é nele que se escreve de que endereço e de que mês
     * aquela conta é.
     */
    const vinculada = await this.prisma.contaPagar.update({
      where: { id: conta.id },
      data: { contaContratoId: contrato.id, competencia },
    });

    if (contrato.categoriaId && conta.idFnApagarIxc) {
      await this.categorias
        .classificar(conta.idFnApagarIxc, contrato.categoriaId, usuarioId)
        .catch((err: unknown) => {
          this.logger.warn(
            `Conta ${conta.idFnApagarIxc} nasceu sem categoria: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    await this.atualizarReferencia(contrato.id);

    this.logger.log(
      `Energia de ${contrato.apelido} (${competencia}): ${linha.valor} ` +
        `lançado no IXC (título ${conta.idFnApagarIxc ?? '?'}), vence ` +
        `${vencimento.toISOString().slice(0, 10)}.`,
    );
    return vinculada;
  }

  /**
   * A média do que aquele endereço vem custando.
   *
   * Serve para a tela estranhar o valor de agora — um zero a mais na digitação
   * é o erro que passa despercebido numa lista de onze contas parecidas. Não é
   * previsão nem meta: é só o que já foi pago, e por isso a média é recalculada
   * a cada conta gerada em vez de guardada à mão.
   */
  private async atualizarReferencia(contaContratoId: string): Promise<void> {
    const ultimas = await this.prisma.contaPagar.findMany({
      where: { contaContratoId },
      orderBy: { competencia: 'desc' },
      take: MESES_NA_REFERENCIA,
      select: { valor: true },
    });

    const valores = ultimas.map((u) => Number(u.valor));
    const m = media(valores);
    await this.prisma.contaContrato.update({
      where: { id: contaContratoId },
      data: {
        valorDeReferencia: m === null ? null : new Prisma.Decimal(m),
      },
    });
  }
}

/** O valor foge tanto do que o endereço costuma custar que vale conferir. */
export function foraDoPadrao(valor: number, media: number | null): boolean {
  if (media === null || media <= 0) return false;
  return valor > media * FORA_DO_PADRAO_ACIMA || valor < media * FORA_DO_PADRAO_ABAIXO;
}

/**
 * O valor que mais se repete numa lista — a moda.
 *
 * É ela que responde "em que dia isto vence": o último título pode ter sido
 * relançado com outra data depois de um atraso, e a média entre o dia 5 e o
 * dia 25 daria o dia 15, que não é dia de vencimento de nada. Empate fica com
 * o que apareceu primeiro — na busca por vencimento decrescente, o mais
 * recente.
 */
function maisFrequente<T extends string | number>(valores: T[]): T | null {
  if (valores.length === 0) return null;
  const contagem = new Map<T, number>();
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1);

  let campeao: T | null = null;
  let melhor = 0;
  for (const [valor, quantas] of contagem) {
    if (quantas > melhor) {
      campeao = valor;
      melhor = quantas;
    }
  }
  return campeao;
}

/** "AAAA-MM" da data — a competência a que aquela fatura se refere. */
function mesDaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const soma = valores.reduce((s, v) => s + v, 0);
  return Math.round((soma / valores.length) * 100) / 100;
}

/** "AAAA-MM" do mês corrente. */
function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function validarCompetencia(competencia: string): string {
  const c = competencia.trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) {
    throw new BadRequestException(
      `"${competencia}" não é um mês no formato AAAA-MM.`,
    );
  }
  return c;
}

/** "2026-08" → "agosto/2026", que é como a observação do título fica legível. */
function mesPorExtenso(competencia: string): string {
  const nomes = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const [ano, mes] = competencia.split('-').map(Number);
  return `${nomes[mes - 1]}/${ano}`;
}

/**
 * O dia daquele mês, sem estourar para o mês seguinte.
 *
 * Vencimento dia 31 em fevereiro vira o dia 28 (ou 29): mandar `new Date` com
 * 31 de fevereiro daria 2 ou 3 de março, e a conta nasceria vencendo no mês
 * errado.
 */
function diaDaCompetencia(competencia: string, dia: number): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1, Math.min(dia, ultimoDia)));
}

function diaDoMes(dia: number, qual: string): number {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new BadRequestException(
      `O dia ${qual} precisa ser um dia do mês, de 1 a 31.`,
    );
  }
  return dia;
}

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

/** Só os dígitos: a conta contrato é escrita com ponto e traço em toda fatura. */
function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '');
}


function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
