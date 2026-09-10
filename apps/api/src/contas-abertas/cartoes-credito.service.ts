import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CartaoCredito,
  CompraNoCartao,
  ContaPagar,
  Prisma,
  StatusContaPagar,
} from '@prisma/client';
import { ContasPagarService } from '../financeiro/contas-pagar.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriasService } from './categorias.service';
import {
  dataUtc,
  diaDaCompetencia,
  hojeUtc,
  lerCodigoDaFatura,
  mesAtual,
  mesPorExtenso,
  moeda,
  validarCompetencia,
} from './contas-contrato.service';
import { proximoDiaUtil } from './dias-uteis';

/** Quantas faturas a tela mostra em volta da escolhida. */
const FATURAS_ANTES = 2;
const FATURAS_DEPOIS = 3;

/** O teto da observação do título no IXC. */
const TETO_DA_OBSERVACAO = 500;

/** Uma parcela de uma compra: em que fatura ela cai, e quanto. */
export interface ParcelaDaCompra {
  numero: number;
  competencia: string;
  valor: number;
}

/** Uma linha da fatura, como a tela a mostra. */
export interface ItemDaFatura {
  compraId: string;
  descricao: string;
  /** Que parcela é esta ("3" de "10"). */
  parcela: number;
  parcelas: number;
  valor: number;
  /** O cadastro da compra, para a tela poder editá-la sem outra leitura. */
  valorTotal: number;
  parcelaInicial: number;
  primeiraFatura: string;
}

/** A conta a pagar em que uma fatura virou. */
export interface FaturaLancada {
  id: string;
  idFnApagarIxc: number | null;
  valor: number;
  dataVencimento: Date;
  status: string;
  pagoEm: Date | null;
}

/** Uma fatura de relance: quanto soma, e se já virou conta. */
export interface ResumoDaFatura {
  competencia: string;
  total: number;
  lancada: FaturaLancada | null;
}

/** Um cartão e a fatura pedida. */
export interface CartaoDoMes {
  cartao: CartaoCredito;
  itens: ItemDaFatura[];
  total: number;
  lancada: FaturaLancada | null;
  /** O dia de vencimento do cadastro, naquele mês, já no dia útil. */
  vencimentoSugerido: Date;
  /** A fatura pedida e as vizinhas — as de trás e as que vêm por aí. */
  faturas: ResumoDaFatura[];
  /** O que já está comprometido nas faturas depois da pedida. */
  comprometidoDepois: number;
}

/** O que se digita de uma compra, na criação e na edição. */
export interface DadosDaCompra {
  descricao: string;
  valor: number;
  /** O valor digitado é o de cada parcela, e não o da compra inteira. */
  valorDe?: 'TOTAL' | 'PARCELA';
  parcelas: number;
  parcelaInicial?: number;
  primeiraFatura: string;
}

/**
 * As parcelas de uma compra, cada uma na sua fatura.
 *
 * A conta é feita em centavos: dividir R$ 100,00 em três com número quebrado
 * dá três de 33,33 e some um centavo — que aparece depois como diferença entre
 * a fatura do banco e a daqui. A sobra vai para a primeira parcela, que é como
 * os bancos fazem.
 *
 * Parcelas antes de `parcelaInicial` não aparecem: a compra que já vinha sendo
 * paga quando foi cadastrada teve as primeiras pagas fora daqui.
 */
export function parcelasDaCompra(compra: {
  valorTotal: Prisma.Decimal | number | string;
  parcelas: number;
  parcelaInicial: number;
  primeiraFatura: string;
}): ParcelaDaCompra[] {
  const centavos = Math.round(Number(compra.valorTotal) * 100);
  const n = Math.max(1, compra.parcelas);
  const base = Math.trunc(centavos / n);
  const sobra = centavos - base * n;

  const lista: ParcelaDaCompra[] = [];
  for (let numero = Math.max(1, compra.parcelaInicial); numero <= n; numero++) {
    lista.push({
      numero,
      competencia: somarMeses(
        compra.primeiraFatura,
        numero - compra.parcelaInicial,
      ),
      valor: (numero === 1 ? base + sobra : base) / 100,
    });
  }
  return lista;
}

/** "2026-11" + 3 → "2027-02". */
export function somarMeses(competencia: string, meses: number): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * A conta ainda conta como "a fatura foi lançada"?
 *
 * Cancelada não: a fatura não vai ser paga por ela, e travar o mês por causa
 * de um título morto obrigaria a lançar a fatura por fora. Nem a que falhou ao
 * ir para o IXC sem ganhar número — ela nunca existiu lá.
 */
function valeComoLancada(conta: {
  status: string;
  idFnApagarIxc: number | null;
}): boolean {
  if (conta.status === StatusContaPagar.CANCELADO) return false;
  if (conta.status === StatusContaPagar.ERRO && !conta.idFnApagarIxc) {
    return false;
  }
  return true;
}

/** Soma em centavos, para a soma de uma fatura bater com a do banco. */
function somar(valores: number[]): number {
  return valores.reduce((s, v) => s + Math.round(v * 100), 0) / 100;
}

/**
 * Os cartões de crédito da empresa.
 *
 * A fatura é uma conta só no IXC — um título para o banco, no dia em que ela
 * vence. Por dentro ela é um punhado de compras, e boa parte delas parcelada:
 * a compra de dez vezes feita em março ainda está na fatura de novembro. O
 * que se guarda aqui é o que o IXC não tem onde guardar — cada compra, em
 * quantas vezes, e em que fatura cada parcela cai. A soma de uma fatura é o
 * valor da conta a pagar que ela vira.
 *
 * Duas regras seguram o desenho:
 *
 * - **a fatura vira uma conta só**, e uma vez. O par (cartão, mês) é
 *   conferido antes, como nas contas contrato;
 * - **fatura lançada não muda de valor por baixo**. Depois que ela virou
 *   título no IXC, uma compra que mexa naquela soma é recusada: o título
 *   ficaria com um valor e a lista daqui com outro, e ninguém saberia qual
 *   dos dois o banco cobrou.
 */
@Injectable()
export class CartoesCreditoService {
  private readonly logger = new Logger(CartoesCreditoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contasPagar: ContasPagarService,
    private readonly categorias: CategoriasService,
  ) {}

  /**
   * Os cartões e a fatura de cada um no mês pedido.
   *
   * O mês é o do **vencimento** da fatura: é o número que o banco imprime no
   * alto dela ("fatura de outubro"), e é o que se procura ao pegá-la na mão.
   */
  async listar(
    competencia?: string,
  ): Promise<{ competencia: string; cartoes: CartaoDoMes[] }> {
    const alvo = validarCompetencia(competencia ?? mesAtual());

    const cartoes = await this.prisma.cartaoCredito.findMany({
      orderBy: [{ ativo: 'desc' }, { apelido: 'asc' }],
      include: { compras: { orderBy: { createdAt: 'asc' } } },
    });

    const contas = await this.prisma.contaPagar.findMany({
      where: { cartaoCreditoId: { in: cartoes.map((c) => c.id) } },
      select: {
        id: true,
        cartaoCreditoId: true,
        competencia: true,
        valor: true,
        dataVencimento: true,
        status: true,
        pagoEm: true,
        idFnApagarIxc: true,
      },
    });

    const janela: string[] = [];
    for (let d = -FATURAS_ANTES; d <= FATURAS_DEPOIS; d++) {
      janela.push(somarMeses(alvo, d));
    }

    return {
      competencia: alvo,
      cartoes: cartoes.map(({ compras, ...cartao }) => {
        const parcelas = compras.flatMap((compra) =>
          parcelasDaCompra(compra).map((p) => ({ compra, ...p })),
        );

        const lancadaEm = (mes: string): FaturaLancada | null => {
          const conta = contas.find(
            (c) =>
              c.cartaoCreditoId === cartao.id &&
              c.competencia === mes &&
              valeComoLancada(c),
          );
          return conta
            ? {
                id: conta.id,
                idFnApagarIxc: conta.idFnApagarIxc,
                valor: Number(conta.valor),
                dataVencimento: conta.dataVencimento,
                status: conta.status,
                pagoEm: conta.pagoEm,
              }
            : null;
        };

        const doMes = parcelas.filter((p) => p.competencia === alvo);

        return {
          cartao,
          itens: doMes.map((p) => ({
            compraId: p.compra.id,
            descricao: p.compra.descricao,
            parcela: p.numero,
            parcelas: p.compra.parcelas,
            valor: p.valor,
            valorTotal: Number(p.compra.valorTotal),
            parcelaInicial: p.compra.parcelaInicial,
            primeiraFatura: p.compra.primeiraFatura,
          })),
          total: somar(doMes.map((p) => p.valor)),
          lancada: lancadaEm(alvo),
          vencimentoSugerido: proximoDiaUtil(
            diaDaCompetencia(alvo, cartao.diaDeVencimento),
          ),
          faturas: janela.map((mes) => ({
            competencia: mes,
            total: somar(
              parcelas.filter((p) => p.competencia === mes).map((p) => p.valor),
            ),
            lancada: lancadaEm(mes),
          })),
          comprometidoDepois: somar(
            parcelas.filter((p) => p.competencia > alvo).map((p) => p.valor),
          ),
        };
      }),
    };
  }

  async criar(
    dados: {
      apelido: string;
      final?: string | null;
      idFornecedorIxc: number;
      fornecedorNome: string;
      diaDeVencimento: number;
      contaContabil?: number;
      contaPagamento?: number;
      tipoPagamentoIxc?: string;
      categoriaId?: string | null;
    },
    usuarioId?: string,
  ): Promise<CartaoCredito> {
    const criado = await this.prisma.cartaoCredito.create({
      data: {
        apelido: dados.apelido.trim(),
        final: dados.final?.trim() || null,
        idFornecedorIxc: dados.idFornecedorIxc,
        fornecedorNome: dados.fornecedorNome.trim(),
        diaDeVencimento: diaDoMes(dados.diaDeVencimento),
        contaContabil: dados.contaContabil ?? null,
        contaPagamento: dados.contaPagamento ?? null,
        tipoPagamentoIxc: dados.tipoPagamentoIxc ?? null,
        categoriaId: dados.categoriaId ?? null,
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(`Cartão cadastrado: ${criado.apelido}.`);
    return criado;
  }

  async atualizar(
    id: string,
    dados: Partial<{
      apelido: string;
      final: string | null;
      idFornecedorIxc: number;
      fornecedorNome: string;
      diaDeVencimento: number;
      contaContabil: number;
      contaPagamento: number;
      tipoPagamentoIxc: string;
      categoriaId: string | null;
      ativo: boolean;
    }>,
  ): Promise<CartaoCredito> {
    await this.buscar(id);
    return this.prisma.cartaoCredito.update({
      where: { id },
      data: {
        ...(dados.apelido === undefined ? {} : { apelido: dados.apelido.trim() }),
        ...(dados.final === undefined
          ? {}
          : { final: dados.final?.trim() || null }),
        ...(dados.idFornecedorIxc === undefined
          ? {}
          : { idFornecedorIxc: dados.idFornecedorIxc }),
        ...(dados.fornecedorNome === undefined
          ? {}
          : { fornecedorNome: dados.fornecedorNome.trim() }),
        ...(dados.diaDeVencimento === undefined
          ? {}
          : { diaDeVencimento: diaDoMes(dados.diaDeVencimento) }),
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
        ...(dados.ativo === undefined ? {} : { ativo: dados.ativo }),
      },
    });
  }

  /**
   * Tira o cartão do cadastro, e as compras dele junto.
   *
   * As faturas que ele já gerou ficam: são contas de verdade no IXC. É por
   * isso que desligar costuma ser melhor — apagado, some também o que havia
   * dentro de cada fatura paga.
   */
  async remover(id: string): Promise<void> {
    await this.buscar(id);
    await this.prisma.cartaoCredito.delete({ where: { id } });
  }

  async buscar(id: string): Promise<CartaoCredito> {
    const c = await this.prisma.cartaoCredito.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Cartão não encontrado');
    return c;
  }

  /** Uma linha nova na fatura — à vista, parcelada, ou um estorno. */
  async criarCompra(
    cartaoId: string,
    dados: DadosDaCompra,
    usuarioId?: string,
  ): Promise<CompraNoCartao> {
    await this.buscar(cartaoId);
    const compra = normalizarCompra(dados);

    await this.conferirFaturasLancadas(cartaoId, [], parcelasDaCompra(compra));

    return this.prisma.compraNoCartao.create({
      data: {
        cartaoId,
        descricao: compra.descricao,
        valorTotal: new Prisma.Decimal(compra.valorTotal),
        parcelas: compra.parcelas,
        parcelaInicial: compra.parcelaInicial,
        primeiraFatura: compra.primeiraFatura,
        criadoPor: usuarioId ?? null,
      },
    });
  }

  /**
   * Corrige uma compra.
   *
   * O valor que não veio no pedido fica o que era: trocar só a descrição não
   * pode recalcular as parcelas.
   */
  async atualizarCompra(
    compraId: string,
    dados: Partial<DadosDaCompra>,
  ): Promise<CompraNoCartao> {
    const atual = await this.buscarCompra(compraId);

    const parcelas = dados.parcelas ?? atual.parcelas;
    const nova = normalizarCompra({
      descricao: dados.descricao ?? atual.descricao,
      valor: dados.valor ?? Number(atual.valorTotal),
      // Sem valor novo, o que vale é o total gravado.
      valorDe: dados.valor === undefined ? 'TOTAL' : dados.valorDe,
      parcelas,
      parcelaInicial: dados.parcelaInicial ?? Math.min(atual.parcelaInicial, parcelas),
      primeiraFatura: dados.primeiraFatura ?? atual.primeiraFatura,
    });

    await this.conferirFaturasLancadas(
      atual.cartaoId,
      parcelasDaCompra(atual),
      parcelasDaCompra(nova),
    );

    return this.prisma.compraNoCartao.update({
      where: { id: compraId },
      data: {
        descricao: nova.descricao,
        valorTotal: new Prisma.Decimal(nova.valorTotal),
        parcelas: nova.parcelas,
        parcelaInicial: nova.parcelaInicial,
        primeiraFatura: nova.primeiraFatura,
      },
    });
  }

  async removerCompra(compraId: string): Promise<void> {
    const atual = await this.buscarCompra(compraId);
    await this.conferirFaturasLancadas(
      atual.cartaoId,
      parcelasDaCompra(atual),
      [],
    );
    await this.prisma.compraNoCartao.delete({ where: { id: compraId } });
  }

  private async buscarCompra(id: string): Promise<CompraNoCartao> {
    const c = await this.prisma.compraNoCartao.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Compra não encontrada');
    return c;
  }

  /**
   * Recusa a mudança que mexeria no valor de uma fatura já lançada.
   *
   * Compara o que a compra punha em cada fatura antes e depois. Trocar a
   * descrição, ou mexer só em parcelas de faturas ainda abertas, passa; o que
   * mudaria a soma de um título que já está no IXC, não.
   */
  private async conferirFaturasLancadas(
    cartaoId: string,
    antes: ParcelaDaCompra[],
    depois: ParcelaDaCompra[],
  ): Promise<void> {
    const tocadas = [
      ...new Set([...antes, ...depois].map((p) => p.competencia)),
    ];
    if (tocadas.length === 0) return;

    const contas = await this.prisma.contaPagar.findMany({
      where: { cartaoCreditoId: cartaoId, competencia: { in: tocadas } },
      select: {
        competencia: true,
        idFnApagarIxc: true,
        valor: true,
        status: true,
      },
    });

    for (const conta of contas.filter(valeComoLancada)) {
      const mes = conta.competencia!;
      const eraAssim = somar(
        antes.filter((p) => p.competencia === mes).map((p) => p.valor),
      );
      const ficaria = somar(
        depois.filter((p) => p.competencia === mes).map((p) => p.valor),
      );
      if (eraAssim === ficaria) continue;

      const titulo = conta.idFnApagarIxc
        ? `título ${conta.idFnApagarIxc}, `
        : '';
      throw new BadRequestException(
        `A fatura de ${mesPorExtenso(mes)} já virou conta a pagar no IXC ` +
          `(${titulo}${moeda(Number(conta.valor))}), e esta mudança mexeria ` +
          'no valor dela. Lance a compra a partir da ' +
          'fatura seguinte — ou exclua o título na tela Em aberto e gere a ' +
          'fatura de novo.',
      );
    }
  }

  /**
   * A fatura do mês vira uma conta a pagar só, no valor da soma.
   *
   * O vencimento é o dia do cadastro naquele mês, andando para o próximo dia
   * útil — ou a data que vier no pedido, quando o banco imprimiu outra.
   */
  async gerarFatura(
    cartaoId: string,
    competencia: string,
    opcoes: { dataVencimento?: string; codigo?: string },
    usuarioId?: string,
  ): Promise<{ conta: ContaPagar; total: number; itens: number }> {
    const alvo = validarCompetencia(competencia);
    const cartao = await this.buscar(cartaoId);

    const existentes = await this.prisma.contaPagar.findMany({
      where: { cartaoCreditoId: cartaoId, competencia: alvo },
      select: { id: true, idFnApagarIxc: true, valor: true, status: true },
    });
    const jaLancada = existentes.find(valeComoLancada);
    if (jaLancada) {
      throw new BadRequestException(
        `A fatura de ${mesPorExtenso(alvo)} de ${cartao.apelido} já foi ` +
          `lançada${
            jaLancada.idFnApagarIxc
              ? ` (título ${jaLancada.idFnApagarIxc} no IXC)`
              : ''
          }, no valor de ${moeda(Number(jaLancada.valor))}.`,
      );
    }

    const compras = await this.prisma.compraNoCartao.findMany({
      where: { cartaoId },
      orderBy: { createdAt: 'asc' },
    });
    const itens = compras.flatMap((compra) =>
      parcelasDaCompra(compra)
        .filter((p) => p.competencia === alvo)
        .map((p) => ({ compra, ...p })),
    );
    const total = somar(itens.map((i) => i.valor));

    if (!(total > 0)) {
      throw new BadRequestException(
        itens.length === 0
          ? `A fatura de ${mesPorExtenso(alvo)} está vazia — lance as compras ` +
              'que vieram nela antes de gerar a conta.'
          : `A fatura de ${mesPorExtenso(alvo)} soma ${moeda(total)}: os ` +
              'créditos cobrem as compras, e não há o que pagar.',
      );
    }

    // O código é lido antes de qualquer escrita: não reconhecido, a conta
    // nem chega a ser criada.
    const codigo = lerCodigoDaFatura(opcoes.codigo);

    const vencimento = opcoes.dataVencimento
      ? dataUtc(opcoes.dataVencimento)
      : proximoDiaUtil(diaDaCompetencia(alvo, cartao.diaDeVencimento));

    // O que falhou ao ir para o IXC não existe lá, e não pode segurar a vaga.
    const mortas = existentes.filter((c) => !valeComoLancada(c));
    if (mortas.length > 0) {
      await this.prisma.contaPagar.deleteMany({
        where: {
          id: { in: mortas.map((c) => c.id) },
          status: StatusContaPagar.ERRO,
        },
      });
    }

    const conta = await this.contasPagar.criarDespesa(
      {
        idFornecedorIxc: cartao.idFornecedorIxc,
        fornecedorNome: cartao.fornecedorNome,
        valor: total,
        dataEmissao: hojeUtc(),
        dataVencimento: vencimento,
        observacao: observacaoDaFatura(
          cartao,
          alvo,
          itens.map((i) => ({
            descricao: i.compra.descricao,
            parcela: i.numero,
            parcelas: i.compra.parcelas,
            valor: i.valor,
          })),
        ),
        contaContabil: cartao.contaContabil ?? undefined,
        contaPagamento: cartao.contaPagamento ?? undefined,
        tipoPagamentoIxc:
          codigo.tipoPagamento ?? cartao.tipoPagamentoIxc ?? undefined,
        codigoBarras: codigo.codigoBarras ?? null,
        chavePix: codigo.chavePix ?? null,
        tipoChavePix: codigo.tipoChavePix ?? null,
      },
      usuarioId,
    );

    /*
     * Recusada pelo IXC, a conta não existe lá: apaga-se o rascunho daqui e a
     * recusa sobe para a tela. Deixá-la gravada seguraria a vaga do mês com
     * uma fatura que o banco nunca vai ver.
     */
    if (conta.status === StatusContaPagar.ERRO && !conta.idFnApagarIxc) {
      await this.prisma.contaPagar.delete({ where: { id: conta.id } });
      throw new BadRequestException(
        `O IXC não aceitou a fatura: ${conta.erro ?? 'sem motivo informado'}. ` +
          'Nada ficou lançado lá.',
      );
    }

    const vinculada = await this.prisma.contaPagar.update({
      where: { id: conta.id },
      data: { cartaoCreditoId: cartao.id, competencia: alvo },
    });

    if (cartao.categoriaId && conta.idFnApagarIxc) {
      await this.categorias
        .classificar(conta.idFnApagarIxc, cartao.categoriaId, usuarioId)
        .catch((err: unknown) => {
          this.logger.warn(
            `Fatura ${conta.idFnApagarIxc} nasceu sem categoria: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    this.logger.log(
      `Fatura de ${cartao.apelido} (${alvo}): ${total} em ${itens.length} ` +
        `lançamento(s), título ${conta.idFnApagarIxc ?? '?'} no IXC, vence ` +
        `${vencimento.toISOString().slice(0, 10)}.`,
    );
    return { conta: vinculada, total, itens: itens.length };
  }
}

/**
 * A compra como vai ser gravada: o total calculado, as parcelas conferidas.
 *
 * O valor digitado pode ser o da parcela — é o que a fatura imprime ("03/10
 * R$ 89,90") —, e aí o total é ele vezes o número de parcelas.
 */
export function normalizarCompra(dados: DadosDaCompra): {
  descricao: string;
  valorTotal: number;
  parcelas: number;
  parcelaInicial: number;
  primeiraFatura: string;
} {
  const descricao = dados.descricao.trim();
  if (!descricao) {
    throw new BadRequestException('A compra precisa de uma descrição.');
  }

  const parcelas = dados.parcelas;
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 99) {
    throw new BadRequestException(
      'O número de parcelas precisa ser um inteiro de 1 a 99.',
    );
  }

  const parcelaInicial = dados.parcelaInicial ?? 1;
  if (
    !Number.isInteger(parcelaInicial) ||
    parcelaInicial < 1 ||
    parcelaInicial > parcelas
  ) {
    throw new BadRequestException(
      `A parcela desta fatura precisa estar entre 1 e ${parcelas}.`,
    );
  }

  const valor = Number(dados.valor);
  if (!Number.isFinite(valor) || Math.round(valor * 100) === 0) {
    throw new BadRequestException('Falta o valor da compra.');
  }

  const valorTotal =
    dados.valorDe === 'PARCELA'
      ? Math.round(valor * 100 * parcelas) / 100
      : Math.round(valor * 100) / 100;

  return {
    descricao: descricao.slice(0, 200),
    valorTotal,
    parcelas,
    parcelaInicial,
    primeiraFatura: validarCompetencia(dados.primeiraFatura),
  };
}

/**
 * "Fatura Sicoob Visa final 1234 outubro/2026 - 3 lançamentos: Posto 120,00;
 * Amazon 2/10 89,90; …".
 *
 * A lista vai na observação porque o título é o que se vê no IXC, e sem ela a
 * fatura paga seria só um número. O que não couber no teto do campo vira "e
 * mais N", em vez de uma compra cortada no meio.
 */
export function observacaoDaFatura(
  cartao: { apelido: string; final: string | null },
  competencia: string,
  itens: Array<{
    descricao: string;
    parcela: number;
    parcelas: number;
    valor: number;
  }>,
): string {
  const cabeca =
    `Fatura ${cartao.apelido}${cartao.final ? ` final ${cartao.final}` : ''} ` +
    `${mesPorExtenso(competencia)} - ${itens.length} lançamento(s): `;

  const partes = itens.map(
    (i) =>
      `${i.descricao}${i.parcelas > 1 ? ` ${i.parcela}/${i.parcelas}` : ''} ` +
      i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
  );

  /*
   * Cada item só entra se, depois dele, ainda couber o "e mais N" dos que
   * sobrarem — assim a parada nunca deixa o aviso sem lugar.
   */
  let texto = cabeca;
  for (let k = 0; k < partes.length; k++) {
    const separador = k === 0 ? '' : '; ';
    const sobram = partes.length - k - 1;
    const rabo = sobram > 0 ? `; e mais ${sobram}` : '';
    if ((texto + separador + partes[k] + rabo).length > TETO_DA_OBSERVACAO) {
      return `${texto}${separador}e mais ${partes.length - k}`.slice(
        0,
        TETO_DA_OBSERVACAO,
      );
    }
    texto += separador + partes[k];
  }
  return texto;
}

function diaDoMes(dia: number): number {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new BadRequestException(
      'O dia de vencimento precisa ser um dia do mês, de 1 a 31.',
    );
  }
  return dia;
}
