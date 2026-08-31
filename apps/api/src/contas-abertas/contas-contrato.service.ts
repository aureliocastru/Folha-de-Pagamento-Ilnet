import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContaContrato, ContaPagar, Prisma } from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { PrismaService } from '../prisma/prisma.service';
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
  /** Linha digitável, quando a fatura vem com código de barras. */
  codigoBarras?: string;
  /** O que a tela quiser acrescentar à observação do título. */
  observacao?: string;
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

    const observacao = [
      `Energia ${contrato.apelido} ${mesPorExtenso(competencia)}`,
      contrato.observacao,
    ]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 500);

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
        tipoPagamentoIxc: contrato.tipoPagamentoIxc ?? undefined,
        codigoBarras: linha.codigoBarras ?? null,
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
