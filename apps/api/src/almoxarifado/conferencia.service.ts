import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SituacaoConferencia, type ConferenciaDeEstoque } from '@prisma/client';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { NAO_CONTROLA, naoControlaEstoque, SAIDA_DO_NAO_CONTROLA } from './acerto-negativos';
import {
  arredondarQtde,
  DOCUMENTO_DA_CONFERENCIA,
  dizerLancamento,
  pecaDaLinha,
  planejarPecas,
  planejarPorQuantidade,
  type AlmoxDoLancamento,
  type CompraLancada,
  type Lancamento,
  type MotivoDaTransferencia,
  type PecaDoLancamento,
  type TransferenciaLancada,
} from './conferencia';
import { ehAlmoxDePerdas, numeroDoIxc, type ItemDeEstoque } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  emParalelo,
  identidadeDaPeca,
  identificacao,
  situacaoDaPeca,
  SITUACOES_LIDAS,
} from './mover-tudo';
import { ProdutosService, type OpcoesDoEstoque } from './produtos.service';
import {
  hojeParaIxc,
  montarEntrada,
  montarItemDaEntrada,
  montarItemDaTransferencia,
  montarPatrimonioDaTransferencia,
  montarTransferencia,
} from './produtos-ixc';
import { TransferenciasService } from './transferencias.service';

type Almox = OpcoesDoEstoque['almoxarifados'][number];

interface Quem {
  nome: string;
}

/** O que a tela manda ao confirmar a contagem de um produto num almoxarifado. */
export interface PedidoDeConferencia {
  almoxId: number;
  produtoId: number;
  /** O saldo que a tela mostrou. Se o IXC tem outro agora, nada se lança. */
  sistemaVisto: number;
  /** Produto comum, ou patrimônio contado pela quantidade. */
  contado?: number;
  /** O valor de cada unidade que entrar por compra. */
  valorUnitario?: number;
  observacao?: string;
  /** Patrimônio por peça: as peças deste almoxarifado que estão na prateleira. */
  pecasAchadas?: number[];
  /** Patrimônio por peça: peças que o IXC diz estarem em outro almoxarifado, e estão aqui. */
  pecasTrazidas?: number[];
  /** Patrimônio por peça: códigos bipados que o IXC não conhece. */
  codigosSemCadastro?: string[];
  /** Patrimônio por peça: peças sem etiqueta nenhuma, que o IXC também não tem. */
  pecasSemEtiqueta?: number;
}

/** Uma peça do produto no almoxarifado, como a janela de conferência mostra. */
export interface PecaParaConferir {
  patrimonioId: number;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  identificacao: string;
  situacao: string;
  naPrateleira: boolean;
  /** Tem série ou número da casa — não é a peça vazia que um acerto criou. */
  identificada: boolean;
}

/** A conferência como a tela a lê. */
export interface ConferenciaNaTela {
  id: string;
  rodadaId: string;
  almoxId: number;
  almoxarifado: string;
  produtoId: number;
  descricao: string;
  unidade: string | null;
  patrimonio: boolean;
  sistema: number;
  contado: number;
  valorUnitario: number | null;
  situacao: SituacaoConferencia;
  /** Ainda lançando no IXC (ou desfazendo) neste servidor. */
  rodando: boolean;
  saldoDepois: number | null;
  lancamentos: Lancamento[];
  /** Cada lançamento dito para gente, na ordem. */
  lancamentosDitos: string[];
  pecas: unknown;
  pendencias: string[];
  observacao: string | null;
  erro: string | null;
  conferidoPor: string;
  criadoEm: string;
  terminadoEm: string | null;
  desfeitoEm: string | null;
  desfeitoPor: string | null;
  podeDesfazer: boolean;
}

export interface RodadaNaTela {
  id: string;
  nome: string;
  iniciadoEm: string;
  iniciadoPor: string;
  conferidos: number;
}

/** Um produto na lista de conferir de um almoxarifado. */
export interface ItemParaConferir {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  precoBase: number | null;
  patrimonio: boolean;
  controlaEstoque: boolean;
  /** O saldo do IXC neste almoxarifado, agora. */
  saldo: number;
  /** A última conferência dele aqui, nesta rodada. */
  conferencia: ConferenciaNaTela | null;
}

/** A janela de conferir um produto: o que o IXC tem dele aqui e em Perdas. */
export interface ProdutoParaConferir {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  unidadeId: number;
  precoBase: number;
  custoMedio: number;
  tipo: string;
  patrimonio: boolean;
  ativo: boolean;
  controlaEstoque: boolean;
  almox: { id: number; nome: string; ativo: boolean };
  perdas: { id: number; nome: string; ativo: boolean } | null;
  saldo: number;
  saldoEmPerdas: number;
  /** Patrimônio: as peças que o IXC tem dele aqui (na prateleira e presas). */
  pecas: PecaParaConferir[] | null;
  /** Por que não dá para conferir este produto aqui — null quando dá. */
  impedimento: string | null;
  conferencias: ConferenciaNaTela[];
}

/** Quanto a chamada de conferir espera o IXC antes de devolver o andamento à tela. */
const ESPERA_MAXIMA_MS = 20_000;

/** Quanto esperar antes de tentar de novo o que o IXC recusou (ver `transferencias.service`). */
const PAUSA_ANTES_DE_REPETIR_MS = 2_000;

/** Conferência "em andamento" mais velha que isto, e que não roda aqui, foi interrompida. */
const INTERROMPIDA_APOS_MS = 15 * 60_000;

/** Por quanto tempo o modelo da compra de acerto (fornecedor, tipo, condição) vale. */
const MODELO_VALE_MS = 10 * 60_000;

const QUASE_ZERO = 1e-6;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * A conferência de estoque — o inventário feito na prateleira, item por item,
 * e lançado no IXC sem abrir o IXC.
 *
 * Quem conta diz quanto tem; o sistema lê o saldo de agora no IXC, e lança a
 * diferença pelos caminhos que já andam em produção (a regra está em
 * `conferencia.ts`): o que faltou vai por transferência para Perdas e Falhas;
 * o que sobrou volta de lá, ou entra por compra de acerto. No fim relê o IXC,
 * e a conferência diz o que ficou lá — e não o que foi mandado.
 *
 * O que protege contra erro, e por quê:
 *
 *  - **o saldo que a tela viu** vai junto. Se alguém mexeu no IXC entre abrir
 *    a janela e confirmar, nada se lança: a diferença calculada seria de outro
 *    saldo, e o ajuste sairia errado;
 *  - **um produto por vez**: duas conferências do mesmo produto ao mesmo tempo
 *    (dois cliques, duas pessoas) tirariam as duas de Perdas;
 *  - **tudo é anotado antes de ir** ao IXC, e cada lançamento é gravado assim
 *    que volta — se o servidor cair no meio, a linha diz até onde foi;
 *  - **desfazer** volta o que foi lançado: transfere de volta, e apaga a
 *    compra de acerto enquanto ela está aberta.
 */
@Injectable()
export class ConferenciaService {
  private readonly logger = new Logger(ConferenciaService.name);
  /** Produtos com conferência ou desfazer rodando agora. */
  private readonly ocupados = new Set<number>();
  /** Conferências rodando neste servidor. */
  private readonly rodando = new Set<string>();
  private modelo: { em: number; valor: ModeloDaCompra } | null = null;
  /** Ficam aqui, e não só nas constantes, para o teste não ter de esperar. */
  esperaMaximaMs = ESPERA_MAXIMA_MS;
  pausaAntesDeRepetirMs = PAUSA_ANTES_DE_REPETIR_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly produtos: ProdutosService,
    private readonly transferencias: TransferenciasService,
    private readonly fornecedores: FornecedorService,
  ) {}

  // -------------------------------------------------------------------------
  // Leituras
  // -------------------------------------------------------------------------

  /** A rodada aberta, Perdas e Falhas, e cada almoxarifado com quanto já foi conferido. */
  async painel() {
    const [rodada, [, almoxarifados], lido] = await Promise.all([
      this.rodadaAberta(),
      this.produtos.paraMovimentar(),
      this.estoque.listar({}),
    ]);
    const perdas = almoxarifados.find((a) => ehAlmoxDePerdas(a.nome)) ?? null;
    // Inativo não se conta: nem o saldo que o IXC ainda guarda dele, nem a conferência que já houve.
    const inativos = new Set(lido.itens.filter((i) => !i.ativo).map((i) => i.produtoId));
    const conferidas = (
      rodada
        ? await this.prisma.conferenciaDeEstoque.findMany({
            where: { rodadaId: rodada.id, situacao: { not: SituacaoConferencia.DESFEITO } },
            select: { almoxId: true, produtoId: true },
          })
        : []
    ).filter((c) => !inativos.has(c.produtoId));

    const produtosPorAlmox = new Map<number, Set<number>>();
    const conferidosPorAlmox = new Map<number, Set<number>>();
    const juntar = (m: Map<number, Set<number>>, almoxId: number, produtoId: number) =>
      m.set(almoxId, (m.get(almoxId) ?? new Set()).add(produtoId));
    for (const i of lido.itens) {
      if (i.servico || !i.ativo) continue;
      for (const s of i.saldos) {
        if (Math.abs(s.saldo) > QUASE_ZERO) juntar(produtosPorAlmox, s.almoxId, i.produtoId);
      }
    }
    for (const c of conferidas) {
      juntar(produtosPorAlmox, c.almoxId, c.produtoId);
      juntar(conferidosPorAlmox, c.almoxId, c.produtoId);
    }

    const visiveis = new Map(almoxarifados.map((a) => [a.id, a]));
    const ids = new Set([...visiveis.keys(), ...produtosPorAlmox.keys()]);
    const nomeNoSaldo = new Map(lido.almoxarifados.map((a) => [a.id, a.nome]));
    const lista = [...ids]
      .map((id) => {
        const a = visiveis.get(id);
        return {
          id,
          nome: a?.nome ?? nomeNoSaldo.get(id) ?? `Almoxarifado ${id}`,
          ativo: a?.ativo ?? false,
          liberado: !!a,
          itens: produtosPorAlmox.get(id)?.size ?? 0,
          conferidos: conferidosPorAlmox.get(id)?.size ?? 0,
        };
      })
      .filter((a) => a.id !== perdas?.id && !ehAlmoxDePerdas(a.nome))
      // Inativo e vazio não tem o que contar.
      .filter((a) => a.ativo || a.itens > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    return {
      rodada: rodada ? this.rodadaNaTela(rodada, new Set(conferidas.map((c) => `${c.almoxId}:${c.produtoId}`)).size) : null,
      perdas: perdas ? { id: perdas.id, nome: perdas.nome, ativo: perdas.ativo } : null,
      almoxarifados: lista,
    };
  }

  /** O que conferir num almoxarifado: o que tem saldo lá, e o que já foi conferido nesta rodada. */
  async doAlmoxarifado(almoxId: number) {
    const [rodada, [, almoxarifados], lido] = await Promise.all([
      this.rodadaAberta(),
      this.produtos.paraMovimentar(),
      this.estoque.listar({ almoxId, recarregar: true }),
    ]);
    const almox = almoxarifados.find((a) => a.id === almoxId);
    const conferencias = rodada
      ? await this.prisma.conferenciaDeEstoque.findMany({
          where: { rodadaId: rodada.id, almoxId },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const ultima = new Map<number, ConferenciaDeEstoque>();
    for (const c of conferencias) if (!ultima.has(c.produtoId)) ultima.set(c.produtoId, c);
    // Inativo não se confere: sai da lista e da conta, com saldo no IXC ou conferência antiga.
    for (const i of lido.itens) if (!i.ativo) ultima.delete(i.produtoId);

    const porProduto = new Map(lido.itens.map((i) => [i.produtoId, i]));
    const itens: ItemParaConferir[] = [];
    for (const i of lido.itens) {
      if (i.servico || !i.ativo) continue;
      const saldo = i.total;
      if (Math.abs(saldo) <= QUASE_ZERO && !ultima.has(i.produtoId)) continue;
      itens.push(this.itemParaConferir(i, saldo, ultima.get(i.produtoId) ?? null));
    }
    for (const [produtoId, c] of ultima) {
      if (porProduto.has(produtoId)) continue;
      // Conferido aqui e sem linha de saldo: o produto novo que só a conferência pôs aqui.
      itens.push({
        produtoId,
        descricao: c.descricao,
        unidade: c.unidade,
        precoBase: null,
        patrimonio: c.patrimonio,
        controlaEstoque: true,
        saldo: 0,
        conferencia: this.naTela(c),
      });
    }
    itens.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

    return {
      almox: {
        id: almoxId,
        nome: almox?.nome ?? lido.almoxarifados.find((a) => a.id === almoxId)?.nome ?? `Almoxarifado ${almoxId}`,
        ativo: almox?.ativo ?? false,
        liberado: !!almox,
      },
      rodada: rodada ? this.rodadaNaTela(rodada, ultima.size) : null,
      lidoEm: lido.lidoEm,
      itens,
    };
  }

  /** A janela de conferir: o saldo de agora aqui e em Perdas, as peças, e o que impede. */
  async produto(almoxId: number, produtoId: number): Promise<ProdutoParaConferir> {
    const ctx = await this.contexto(almoxId, produtoId);
    const rodada = await this.rodadaAberta();
    const conferencias = rodada
      ? await this.prisma.conferenciaDeEstoque.findMany({
          where: { rodadaId: rodada.id, almoxId, produtoId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })
      : [];
    const pecas = ctx.patrimonio && ctx.almox ? await this.pecasAqui(almoxId, produtoId) : null;
    return {
      produtoId,
      descricao: ctx.descricao,
      unidade: ctx.unidade?.sigla ?? null,
      unidadeId: ctx.unidade?.id ?? 0,
      precoBase: numeroDoIxc(ctx.bruto.preco_base),
      custoMedio: numeroDoIxc(ctx.bruto.custo_medio),
      tipo: ctx.tipo,
      patrimonio: ctx.patrimonio,
      ativo: !produtoInativo(ctx.bruto),
      controlaEstoque: !naoControlaEstoque(ctx.bruto),
      almox: ctx.almox
        ? { id: ctx.almox.id, nome: ctx.almox.nome, ativo: ctx.almox.ativo }
        : { id: almoxId, nome: `Almoxarifado ${almoxId}`, ativo: false },
      perdas: ctx.perdas ? { id: ctx.perdas.id, nome: ctx.perdas.nome, ativo: ctx.perdas.ativo } : null,
      saldo: ctx.saldoAqui,
      saldoEmPerdas: ctx.saldoEmPerdas,
      pecas: pecas?.map(pecaParaConferir) ?? null,
      impedimento: ctx.impedimento,
      conferencias: conferencias.map((c) => this.naTela(c)),
    };
  }

  /**
   * Produtos do IXC pelo nome ou código — para conferir o que está na
   * prateleira e não aparece na lista (o IXC não tem saldo dele aqui).
   * Serviço e inativo não vêm: não se confere nenhum dos dois.
   */
  async buscarProdutos(termo: string) {
    const busca = termo.trim();
    if (busca.length < 2) return [];
    const [porNome, porCodigo] = await Promise.all([
      this.ixc.list<Record<string, unknown>>('produtos', {
        qtype: 'produtos.descricao',
        query: busca,
        oper: 'L',
        rp: 30,
        sortname: 'produtos.descricao',
        sortorder: 'asc',
      }),
      /^\d+$/.test(busca)
        ? this.ixc.getById<Record<string, unknown>>('produtos', 'produtos.id', busca).catch(() => null)
        : Promise.resolve(null),
    ]);
    const linhas = [...(porCodigo ? [porCodigo] : []), ...porNome.registros];
    const vistos = new Set<number>();
    return linhas
      .filter((p) => {
        const id = numeroDoIxc(p.id);
        if (id <= 0 || vistos.has(id)) return false;
        vistos.add(id);
        return String(p.tipo ?? '').trim().toUpperCase() !== 'S' && !produtoInativo(p);
      })
      .map((p) => ({
        produtoId: numeroDoIxc(p.id),
        descricao: String(p.descricao ?? '').trim() || `Produto ${numeroDoIxc(p.id)}`,
        patrimonio: String(p.tipo ?? '').trim().toUpperCase() === 'P',
      }));
  }

  async uma(id: string): Promise<ConferenciaNaTela> {
    const c = await this.prisma.conferenciaDeEstoque.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Essa conferência não existe.');
    return this.naTela(c);
  }

  // -------------------------------------------------------------------------
  // Conferir
  // -------------------------------------------------------------------------

  /**
   * Confere um produto num almoxarifado e lança a diferença no IXC.
   *
   * Tudo o que pode recusar é conferido **antes** de ir ao IXC: o saldo que a
   * tela viu, o valor da compra, as peças bipadas, Perdas e Falhas. Só então a
   * conferência é anotada e os lançamentos começam. Volta em até 20 segundos
   * com o que já houver; o que passar disso continua no servidor, e a tela
   * acompanha por `uma`.
   */
  async conferir(pedido: PedidoDeConferencia, quem: Quem): Promise<ConferenciaNaTela> {
    const { almoxId, produtoId } = pedido;
    if (this.ocupados.has(produtoId)) {
      throw new ConflictException(
        'Este produto já está sendo lançado no IXC agora (outra conferência ou um desfazer). ' +
          'Espere terminar e confira de novo.',
      );
    }
    this.ocupados.add(produtoId);
    let entregue = false;
    try {
      const ctx = await this.contexto(almoxId, produtoId);
      if (ctx.impedimento) throw new BadRequestException(ctx.impedimento);
      const almox = ctx.almox!;
      const perdas = ctx.perdas!;

      if (Math.abs(ctx.saldoAqui - pedido.sistemaVisto) > QUASE_ZERO) {
        throw new ConflictException(
          `O saldo de "${ctx.descricao}" em ${almox.nome} mudou no IXC: a tela mostrava ` +
            `${fmt(pedido.sistemaVisto)} e agora é ${fmt(ctx.saldoAqui)}. Nada foi lançado — ` +
            'abra de novo e confira com o saldo de agora.',
        );
      }

      const trabalho = ctx.patrimonio
        ? await this.prepararPatrimonio(ctx, pedido)
        : this.prepararQuantidade(ctx, pedido);

      if (trabalho.compra > 0) {
        if (!almox.ativo) {
          throw new BadRequestException(
            `"${almox.nome}" está desativado no IXC, e compra não entra em almoxarifado desativado. ` +
              'Ative-o na aba Almoxarifados, ou confira o que sobrou no almoxarifado onde a peça vai ficar.',
          );
        }
        const valor = Number(pedido.valorUnitario);
        if (!(valor >= 0.01)) {
          throw new BadRequestException(
            `Sobraram ${fmt(trabalho.compra)} ${ctx.unidade?.sigla ?? ''} que entram por compra — ` +
              'informe o valor de cada unidade.',
          );
        }
        await this.modeloDaCompra(); // recusa antes de lançar qualquer coisa
      }
      if (trabalho.precisaDePerdasAtivo && !perdas.ativo) {
        throw new BadRequestException(
          `O almoxarifado "${perdas.nome}" está desativado no IXC, e é para lá que vai o que faltou. ` +
            'Ative-o na aba Almoxarifados.',
        );
      }

      const rodada = await this.garantirRodada(quem);
      const registro = await this.prisma.conferenciaDeEstoque.create({
        data: {
          rodadaId: rodada.id,
          almoxId,
          almoxarifado: almox.nome,
          produtoId,
          descricao: ctx.descricao,
          unidade: ctx.unidade?.sigla ?? null,
          patrimonio: ctx.patrimonio,
          sistema: ctx.saldoAqui,
          contado: trabalho.contado,
          valorUnitario: trabalho.compra > 0 ? Number(pedido.valorUnitario) : null,
          situacao: trabalho.passos.length === 0 ? SituacaoConferencia.BATEU : SituacaoConferencia.EM_ANDAMENTO,
          pecas: (trabalho.pecas ?? undefined) as Prisma.InputJsonValue | undefined,
          pendencias: trabalho.pendencias,
          observacao: pedido.observacao?.trim() || null,
          conferidoPor: quem.nome,
          terminadoEm: trabalho.passos.length === 0 ? new Date() : null,
          saldoDepois: trabalho.passos.length === 0 ? ctx.saldoAqui : null,
        },
      });

      if (trabalho.passos.length === 0) {
        this.logger.log(
          `${quem.nome} conferiu "${ctx.descricao}" em ${almox.nome}: bateu (${fmt(ctx.saldoAqui)}).`,
        );
        return this.naTela(registro);
      }

      this.logger.log(
        `${quem.nome} conferiu "${ctx.descricao}" (#${produtoId}) em ${almox.nome}: IXC ` +
          `${fmt(ctx.saldoAqui)}, contado ${fmt(trabalho.contado)} — lançando ${trabalho.passos.length} passo(s).`,
      );
      this.rodando.add(registro.id);
      entregue = true;
      const execucao = this.executar(registro.id, ctx, trabalho, pedido, quem)
        .catch((err: unknown) => this.anotarQueParou(registro.id, err))
        .finally(() => {
          this.rodando.delete(registro.id);
          this.ocupados.delete(produtoId);
        });
      await Promise.race([execucao, pausa(this.esperaMaximaMs)]);
      return this.uma(registro.id);
    } finally {
      if (!entregue) this.ocupados.delete(produtoId);
    }
  }

  /** Produto comum: a diferença pela quantidade. */
  private prepararQuantidade(ctx: Contexto, pedido: PedidoDeConferencia): Trabalho {
    const contado = Number(pedido.contado);
    if (!Number.isFinite(contado) || contado < 0) {
      throw new BadRequestException('Diga quanto contou — zero se não tem nenhum.');
    }
    const plano = planejarPorQuantidade({
      sistema: ctx.saldoAqui,
      contado: arredondarQtde(contado),
      saldoEmPerdas: ctx.saldoEmPerdas,
    });
    const passos: Passo[] = [];
    if (plano.paraPerdas > 0) passos.push({ tipo: 'quantidade', motivo: 'falta', de: 'aqui', para: 'perdas', quantidade: plano.paraPerdas });
    if (plano.voltaDePerdas > 0) passos.push({ tipo: 'quantidade', motivo: 'volta-de-perdas', de: 'perdas', para: 'aqui', quantidade: plano.voltaDePerdas });
    if (plano.compra > 0) passos.push({ tipo: 'compra', quantidade: plano.compra });
    return {
      contado: arredondarQtde(contado),
      compra: plano.compra,
      precisaDePerdasAtivo: plano.paraPerdas > 0,
      passos,
      pendencias: [],
      pecas: null,
    };
  }

  /**
   * Patrimônio: pela quantidade ou por peça (ver `planejarPecas`). As peças
   * trazidas e os códigos sem cadastro são conferidos um a um no IXC antes de
   * qualquer lançamento.
   */
  private async prepararPatrimonio(ctx: Contexto, pedido: PedidoDeConferencia): Promise<Trabalho> {
    const almox = ctx.almox!;
    const linhas = await this.pecasAqui(almox.id, ctx.produtoId);
    const pecas = linhas.map(pecaDaLinha);
    const porId = new Map(linhas.map((l) => [numeroDoIxc(l.id), l]));
    const porPeca = pedido.pecasAchadas !== undefined;
    if (!porPeca && !(Number(pedido.contado) >= 0)) {
      throw new BadRequestException('Diga quantas contou — ou bipe as peças.');
    }
    // Trazida que o IXC já tem aqui é achada: ignorá-la a mandaria para Perdas.
    const achadas = porPeca
      ? [...new Set([...pedido.pecasAchadas!, ...(pedido.pecasTrazidas ?? []).filter((id) => porId.has(id))])]
      : null;

    // As trazidas: do mesmo produto, na prateleira de outro almoxarifado liberado.
    const trazidas: PecaParaMover[] = [];
    const deOnde = new Map<number, number>();
    if (porPeca) {
      for (const id of new Set(pedido.pecasTrazidas ?? [])) {
        if (porId.has(id)) continue; // já contou como achada
        const l = await this.ixc.getById<Record<string, unknown>>('patrimonio', 'patrimonio.id', id);
        const nome = l ? identificacao(identidadeDaPeca(l)) : `patrimônio #${id}`;
        if (!l) throw new BadRequestException(`A peça #${id} não existe no IXC.`);
        if (numeroDoIxc(l.id_produto) !== ctx.produtoId) {
          throw new BadRequestException(
            `A peça ${nome} é de outro produto no IXC — confira-a na linha do produto dela.`,
          );
        }
        const origemId = numeroDoIxc(l.id_almoxarifado);
        const origem = ctx.almoxarifados.find((a) => a.id === origemId);
        const situacao = situacaoDaPeca(l.situacao);
        if (!origem) {
          throw new BadRequestException(
            `A peça ${nome} está num almoxarifado que o sistema não enxerga no IXC — libere-o na aba Almoxarifados.`,
          );
        }
        if (!situacao.naPrateleira) {
          throw new BadRequestException(
            `A peça ${nome} está ${situacao.nome} no IXC (em ${origem.nome}) — ela não sai por ` +
              'transferência. Resolva no IXC, ou tire-a da lista.',
          );
        }
        trazidas.push({ ...this.pecaParaMover(l, ctx), origem });
        deOnde.set(origemId, (deOnde.get(origemId) ?? 0) + 1);
      }
      // Tirar peça de onde o saldo não a cobre deixaria aquele almoxarifado negativo.
      for (const [origemId, quantas] of deOnde) {
        const saldo = ctx.saldos?.saldos.find((s) => s.almoxId === origemId)?.saldo ?? 0;
        if (quantas > saldo + QUASE_ZERO) {
          const nome = ctx.almoxarifados.find((a) => a.id === origemId)?.nome ?? `#${origemId}`;
          throw new BadRequestException(
            `${quantas} ${quantas === 1 ? 'peça vem' : 'peças vêm'} de ${nome}, mas o saldo de ` +
              `"${ctx.descricao}" lá é ${fmt(saldo)} — tirar deixaria negativo. Confira ${nome} primeiro.`,
          );
        }
      }
      for (const codigo of new Set((pedido.codigosSemCadastro ?? []).map((c) => c.trim()).filter(Boolean))) {
        await this.confirmarSemCadastro(codigo);
      }
    }

    const semCadastro = porPeca
      ? new Set((pedido.codigosSemCadastro ?? []).map((c) => c.trim()).filter(Boolean)).size +
        Math.max(0, Math.trunc(Number(pedido.pecasSemEtiqueta ?? 0)))
      : 0;
    const plano = planejarPecas({
      saldo: ctx.saldoAqui,
      pecas,
      achadas,
      contado: pedido.contado,
      trazidas: trazidas.length,
      semCadastro,
    });

    if (plano.precisaBipar) {
      throw new BadRequestException(
        `O IXC tem ${pecas.length} ${pecas.length === 1 ? 'peça cadastrada' : 'peças cadastradas'} de ` +
          `"${ctx.descricao}" aqui, e você contou ${fmt(plano.contado)}. Faltou peça de verdade — bipe as ` +
          'que estão na prateleira, para o sistema saber quais foram para Perdas e Falhas.',
      );
    }
    if (plano.desconhecidas.length > 0) {
      throw new ConflictException(
        `${plano.desconhecidas.length} ${plano.desconhecidas.length === 1 ? 'peça marcada não está' : 'peças marcadas não estão'} ` +
          `mais em ${almox.nome} no IXC. Nada foi lançado — abra de novo e bipe outra vez.`,
      );
    }

    const passos: Passo[] = [];
    const porOrigem = new Map<number, PecaParaMover[]>();
    for (const t of trazidas) porOrigem.set(t.origem.id, [...(porOrigem.get(t.origem.id) ?? []), t]);
    for (const [, lote] of porOrigem) {
      passos.push({ tipo: 'pecas', motivo: 'trazida', de: lote[0].origem, para: 'aqui', pecas: lote });
    }
    if (plano.semPecaParaPerdas > 0) {
      passos.push({ tipo: 'semPeca', quantidade: plano.semPecaParaPerdas, pecasCadastradas: pecas.length });
    }
    if (plano.paraPerdas.length > 0) {
      passos.push({
        tipo: 'pecas',
        motivo: 'falta',
        de: 'aqui',
        para: 'perdas',
        pecas: plano.paraPerdas.map((id) => ({ ...this.pecaParaMover(porId.get(id)!, ctx), origem: almox })),
      });
    }
    if (plano.compra > 0) passos.push({ tipo: 'compra', quantidade: plano.compra });

    const pendencias: string[] = [];
    const dizerPecas = (ids: number[]) =>
      ids.slice(0, 3).map((id) => identificacao(identidadeDaPeca(porId.get(id)!))).join(', ') +
      (ids.length > 3 ? ` e mais ${ids.length - 3}` : '');
    if (plano.presasNaoAchadas.length > 0) {
      pendencias.push(
        `${plano.presasNaoAchadas.length} ${plano.presasNaoAchadas.length === 1 ? 'peça não achada está presa' : 'peças não achadas estão presas'} ` +
          `no IXC (alocada ou indisponível) e não sai por transferência: ${dizerPecas(plano.presasNaoAchadas)}. ` +
          'Resolva no IXC — na compra aberta que a segura, ou devolvendo-a ao almoxarifado.',
      );
    }
    if (plano.ficamPorFaltaDeSaldo.length > 0) {
      pendencias.push(
        `${plano.ficamPorFaltaDeSaldo.length} ${plano.ficamPorFaltaDeSaldo.length === 1 ? 'peça não achada ficou' : 'peças não achadas ficaram'} ` +
          `aqui: o IXC tem mais peças cadastradas que saldo, e movê-las deixaria negativo (${dizerPecas(plano.ficamPorFaltaDeSaldo)}).`,
      );
    }
    if (plano.compra > 0) {
      pendencias.push(
        `${plano.compra} ${plano.compra === 1 ? 'peça nova entra' : 'peças novas entram'} por compra: o IXC cria cada uma ` +
          'com um número dele e sem MAC nem série. Anote o número na caixa, ou complete no IXC.',
      );
    }

    return {
      contado: plano.contado,
      compra: plano.compra,
      precisaDePerdasAtivo: plano.paraPerdas.length > 0 || plano.semPecaParaPerdas > 0,
      passos,
      pendencias,
      pecas: {
        modo: porPeca ? 'peca' : 'quantidade',
        cadastradasAqui: pecas.length,
        achadas: achadas?.length ?? null,
        paraPerdas: plano.paraPerdas,
        trazidas: trazidas.map((t) => ({ patrimonioId: t.patrimonioId, identificacao: t.identificacao, de: t.origem.nome })),
        semCadastro: [...new Set((pedido.codigosSemCadastro ?? []).map((c) => c.trim()).filter(Boolean))],
        semEtiqueta: porPeca ? Math.max(0, Math.trunc(Number(pedido.pecasSemEtiqueta ?? 0))) : 0,
        presasNaoAchadas: plano.presasNaoAchadas,
        ficamPorFaltaDeSaldo: plano.ficamPorFaltaDeSaldo,
        saldoSemPeca: plano.saldoSemPeca,
      },
    };
  }

  /** O código bipado não pode ser de peça que o IXC já tem — seria comprar o que existe. */
  private async confirmarSemCadastro(codigo: string): Promise<void> {
    try {
      const achada = await this.transferencias.acharPeca(codigo);
      throw new BadRequestException(
        `O código "${codigo}" é de uma peça que o IXC tem: ${achada.descricao}, em ` +
          `${achada.almoxarifado || 'lugar nenhum'} (${achada.situacao}). Ela não entra por compra — ` +
          'bipe-a de novo para trazer para cá.',
      );
    } catch (err) {
      if (err instanceof NotFoundException) return;
      throw err;
    }
  }

  private async executar(
    id: string,
    ctx: Contexto,
    trabalho: Trabalho,
    pedido: PedidoDeConferencia,
    quem: Quem,
  ): Promise<void> {
    const almox = ctx.almox!;
    const perdas = ctx.perdas!;
    const lancamentos: Lancamento[] = [];
    const obs =
      `Conferência de estoque: ${ctx.descricao} em ${almox.nome}, IXC ${fmt(ctx.saldoAqui)}, ` +
      `contado ${fmt(trabalho.contado)}` +
      (pedido.observacao?.trim() ? ` (${pedido.observacao.trim()})` : '') +
      ` — pelo ILNET FINANCE, ${quem.nome}`;
    let erro: string | null = null;

    try {
      for (const passo of trabalho.passos) {
        const onde = (x: 'aqui' | 'perdas' | Almox) => (x === 'aqui' ? almox : x === 'perdas' ? perdas : x);
        let lancado: Lancamento;
        if (passo.tipo === 'quantidade') {
          lancado = await this.transferirQuantidade(onde(passo.de), onde(passo.para), ctx, passo.quantidade, passo.motivo, obs);
        } else if (passo.tipo === 'semPeca') {
          lancado = await this.transferirSemPeca(ctx, passo, obs);
        } else if (passo.tipo === 'pecas') {
          lancado = await this.transferirPecas(onde(passo.de), onde(passo.para), passo.pecas, passo.motivo, obs);
        } else {
          lancado = await this.comprar(ctx, passo.quantidade, Number(pedido.valorUnitario));
        }
        lancamentos.push(lancado);
        /* Cada passo mexe numa parte só do saldo (a falta, a volta de Perdas, a
           compra do resto), e nenhum deixa negativo sem os outros: o que não
           entrar não impede o seguinte, e a releitura no fim diz o que ficou. */
        await this.prisma.conferenciaDeEstoque.update({
          where: { id },
          data: { lancamentos: lancamentos as unknown as Prisma.InputJsonValue },
        });
      }
    } catch (err) {
      erro = err instanceof Error ? err.message : String(err);
      this.logger.error(`Conferência ${id}: parou no meio (${erro}).`);
    }

    this.estoque.esquecer();
    let saldoDepois: number | null = null;
    try {
      const depois = await this.estoque.saldosDoProduto(ctx.produtoId);
      saldoDepois = depois?.saldos.find((s) => s.almoxId === almox.id)?.saldo ?? 0;
    } catch (err) {
      this.logger.warn(`Conferência ${id}: não deu para reler o saldo (${err instanceof Error ? err.message : err}).`);
    }

    const falhou = lancamentos.some((l) => !l.ok || (l.tipo === 'transferencia' && (l.falharam?.length ?? 0) > 0));
    const bateu = saldoDepois !== null && Math.abs(saldoDepois - trabalho.contado) < QUASE_ZERO;
    const pendencias = [...trabalho.pendencias];
    if (saldoDepois === null) {
      pendencias.push('Não deu para reler o saldo no IXC depois de lançar — confira o produto no Estoque.');
    } else if (!bateu) {
      pendencias.push(
        `Relido o IXC, o saldo aqui ficou ${fmt(saldoDepois)} e não ${fmt(trabalho.contado)}` +
          (falhou ? ' — algum lançamento não entrou (abaixo).' : '.'),
      );
    }

    await this.prisma.conferenciaDeEstoque.update({
      where: { id },
      data: {
        lancamentos: lancamentos as unknown as Prisma.InputJsonValue,
        situacao: !falhou && !erro && bateu ? SituacaoConferencia.AJUSTADO : SituacaoConferencia.INCOMPLETO,
        saldoDepois,
        pendencias,
        erro,
        terminadoEm: new Date(),
      },
    });
    this.logger.log(
      `Conferência de "${ctx.descricao}" em ${almox.nome}: ${lancamentos.map((l) => dizerLancamento(l, ctx.unidade?.sigla)).join('; ')}. ` +
        `Saldo relido: ${saldoDepois === null ? '?' : fmt(saldoDepois)}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Desfazer
  // -------------------------------------------------------------------------

  /**
   * Volta o que uma conferência lançou: o que foi transferido volta pelo mesmo
   * caminho, e a compra de acerto — enquanto aberta — é apagada.
   *
   * Só a conferência mais nova do produto, e só se o saldo ainda é o que ela
   * deixou: se alguém mexeu depois, voltar os lançamentos dela desfaria também
   * o que não é dela.
   */
  async desfazer(id: string, quem: Quem): Promise<ConferenciaNaTela> {
    const c = await this.prisma.conferenciaDeEstoque.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Essa conferência não existe.');
    const tela = this.naTela(c);
    if (!tela.podeDesfazer) {
      throw new BadRequestException(
        tela.situacao === SituacaoConferencia.DESFEITO
          ? 'Essa conferência já foi desfeita.'
          : tela.rodando
            ? 'Essa conferência ainda está lançando no IXC. Espere terminar.'
            : 'Essa conferência não lançou nada no IXC — não há o que desfazer.',
      );
    }
    const maisNova = await this.prisma.conferenciaDeEstoque.findFirst({
      where: { produtoId: c.produtoId, situacao: { not: SituacaoConferencia.DESFEITO } },
      orderBy: { createdAt: 'desc' },
    });
    if (maisNova && maisNova.id !== c.id) {
      throw new BadRequestException(
        `Há uma conferência mais nova de "${c.descricao}" (em ${maisNova.almoxarifado}, por ` +
          `${maisNova.conferidoPor}). Desfaça aquela antes — ou confira de novo, que o ajuste sai do saldo de agora.`,
      );
    }
    if (this.ocupados.has(c.produtoId)) {
      throw new ConflictException('Este produto está sendo lançado no IXC agora. Espere terminar.');
    }
    this.ocupados.add(c.produtoId);
    let entregue = false;
    try {
      const ctx = await this.contexto(c.almoxId, c.produtoId);
      if (!ctx.almox) throw new BadRequestException(ctx.impedimento ?? 'O almoxarifado não está liberado.');
      const deixou = c.saldoDepois === null ? null : Number(c.saldoDepois);
      if (deixou === null || Math.abs(ctx.saldoAqui - deixou) > QUASE_ZERO) {
        throw new ConflictException(
          `O saldo de "${c.descricao}" em ${c.almoxarifado} mudou depois da conferência ` +
            `(ela deixou ${deixou === null ? '?' : fmt(deixou)}, o IXC tem ${fmt(ctx.saldoAqui)}). ` +
            'Desfazer agora voltaria também o que não é dela — confira de novo em vez de desfazer.',
        );
      }
      this.rodando.add(c.id);
      entregue = true;
      const execucao = this.executarDesfazer(c, ctx, quem)
        .catch((err: unknown) => this.anotarQueParou(c.id, err))
        .finally(() => {
          this.rodando.delete(c.id);
          this.ocupados.delete(c.produtoId);
        });
      await Promise.race([execucao, pausa(this.esperaMaximaMs)]);
      return this.uma(c.id);
    } finally {
      if (!entregue) this.ocupados.delete(c.produtoId);
    }
  }

  private async executarDesfazer(c: ConferenciaDeEstoque, ctx: Contexto, quem: Quem): Promise<void> {
    const lancamentos = [...(c.lancamentos as unknown as Lancamento[])];
    const voltas: Lancamento[] = [];
    const problemas: string[] = [];
    const obs = `Desfazendo a conferência de estoque de ${c.descricao} em ${c.almoxarifado} — pelo ILNET FINANCE, ${quem.nome}`;
    const gravar = () =>
      this.prisma.conferenciaDeEstoque.update({
        where: { id: c.id },
        data: { lancamentos: [...lancamentos, ...voltas] as unknown as Prisma.InputJsonValue },
      });

    // Do último para o primeiro; o que já voltou (num desfazer que parou no meio) não volta de novo.
    for (let i = lancamentos.length - 1; i >= 0; i -= 1) {
      const l = lancamentos[i];
      if (l.motivo === 'desfazer') continue;
      try {
        if (l.tipo === 'compra') {
          if (!l.ok || !l.entradaId || l.apagada) continue;
          const volta = await this.apagarCompra(l.entradaId);
          if (volta.ok) lancamentos[i] = { ...l, apagada: true };
          voltas.push({ ...l, motivo: 'desfazer', ok: volta.ok, erro: volta.erro, apagada: volta.ok });
          if (!volta.ok) problemas.push(`compra #${l.entradaId}: ${volta.erro}`);
          await gravar();
          continue;
        }
        if (l.desfeito) continue;
        const de = ctx.almoxarifados.find((a) => a.id === l.para.id);
        const para = ctx.almoxarifados.find((a) => a.id === l.de.id);
        if (!de || !para) {
          if (l.ok || l.pecas?.length) {
            problemas.push(`transferência #${l.transferenciaId}: o sistema não enxerga mais um dos almoxarifados`);
          }
          continue;
        }
        if (l.quantidade !== undefined) {
          if (!l.ok) continue;
          const volta = await this.transferirQuantidade(de, para, ctx, l.quantidade, 'desfazer', obs);
          voltas.push(volta);
          if (volta.ok) lancamentos[i] = { ...l, desfeito: true };
          else problemas.push(dizerLancamento(volta));
        } else if (l.pecas?.length) {
          const linhas = await Promise.all(
            l.pecas.map((p) =>
              this.ixc.getById<Record<string, unknown>>('patrimonio', 'patrimonio.id', p.patrimonioId),
            ),
          );
          const aindaLa = linhas.filter(
            (x): x is Record<string, unknown> =>
              !!x && numeroDoIxc(x.id_almoxarifado) === de.id && situacaoDaPeca(x.situacao).naPrateleira,
          );
          if (aindaLa.length < l.pecas.length) {
            problemas.push(
              `${l.pecas.length - aindaLa.length} peça(s) da transferência #${l.transferenciaId} já não estão ` +
                `na prateleira de ${de.nome}`,
            );
          }
          let voltaramTodas = true;
          if (aindaLa.length > 0) {
            const volta = await this.transferirPecas(
              de,
              para,
              aindaLa.map((x) => ({ ...this.pecaParaMover(x, ctx), origem: de })),
              'desfazer',
              obs,
            );
            voltas.push(volta);
            voltaramTodas = volta.ok;
            if (!volta.ok) problemas.push(dizerLancamento(volta));
          }
          /* Recusada alguma, a transferência fica para o próximo desfazer: as
             que já voltaram não estão mais em `de`, e não vão de novo. */
          if (voltaramTodas) lancamentos[i] = { ...l, desfeito: true };
        }
      } catch (err) {
        problemas.push(err instanceof Error ? err.message : String(err));
      }
      await gravar();
    }

    this.estoque.esquecer();
    let saldo: number | null = null;
    try {
      const depois = await this.estoque.saldosDoProduto(c.produtoId);
      saldo = depois?.saldos.find((s) => s.almoxId === c.almoxId)?.saldo ?? 0;
    } catch {
      saldo = null;
    }
    const voltouAoQueEra = saldo !== null && Math.abs(saldo - Number(c.sistema)) < QUASE_ZERO;
    const completo = problemas.length === 0 && voltouAoQueEra;
    await this.prisma.conferenciaDeEstoque.update({
      where: { id: c.id },
      data: {
        lancamentos: [...lancamentos, ...voltas] as unknown as Prisma.InputJsonValue,
        ...(completo
          ? { situacao: SituacaoConferencia.DESFEITO, desfeitoEm: new Date(), desfeitoPor: quem.nome, saldoDepois: saldo }
          : {
              situacao: SituacaoConferencia.INCOMPLETO,
              saldoDepois: saldo,
              erro:
                `Desfeito em parte${problemas.length ? `: ${problemas.join('; ')}` : ''}. ` +
                `O saldo relido é ${saldo === null ? '?' : fmt(saldo)} (antes da conferência era ${fmt(Number(c.sistema))}).`,
            }),
      },
    });
    this.logger.log(
      `${quem.nome} desfez a conferência de "${c.descricao}" em ${c.almoxarifado}: ` +
        `${completo ? 'voltou ao que era' : `em parte (${problemas.join('; ')})`}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Rodada
  // -------------------------------------------------------------------------

  /** Encerra a rodada aberta. A próxima conferência começa outra. */
  async encerrarRodada(quem: Quem) {
    const rodada = await this.rodadaAberta();
    if (!rodada) throw new BadRequestException('Não há inventário aberto.');
    if (this.rodando.size > 0) {
      throw new BadRequestException('Tem conferência lançando no IXC agora. Espere terminar.');
    }
    await this.prisma.inventarioRodada.update({
      where: { id: rodada.id },
      data: { encerradoEm: new Date(), encerradoPor: quem.nome },
    });
    this.logger.log(`${quem.nome} encerrou o inventário "${rodada.nome}".`);
    return { encerrado: rodada.id };
  }

  private rodadaAberta() {
    return this.prisma.inventarioRodada.findFirst({
      where: { encerradoEm: null },
      orderBy: { iniciadoEm: 'desc' },
    });
  }

  private async garantirRodada(quem: Quem) {
    const aberta = await this.rodadaAberta();
    if (aberta) return aberta;
    const agora = new Date();
    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(agora);
    const mes = Number(partes.find((p) => p.type === 'month')?.value ?? agora.getMonth() + 1);
    const ano = partes.find((p) => p.type === 'year')?.value ?? String(agora.getFullYear());
    try {
      return await this.prisma.inventarioRodada.create({
        data: { nome: `Inventário de ${MESES[mes - 1]} de ${ano}`, iniciadoPor: quem.nome },
      });
    } catch (err) {
      // Duas conferências ao mesmo tempo abrindo a rodada: o índice deixa uma só.
      const outra = await this.rodadaAberta();
      if (outra) return outra;
      throw err;
    }
  }

  private rodadaNaTela(
    r: { id: string; nome: string; iniciadoEm: Date; iniciadoPor: string },
    conferidos: number,
  ): RodadaNaTela {
    return {
      id: r.id,
      nome: r.nome,
      iniciadoEm: r.iniciadoEm.toISOString(),
      iniciadoPor: r.iniciadoPor,
      conferidos,
    };
  }

  // -------------------------------------------------------------------------
  // IXC
  // -------------------------------------------------------------------------

  /** Tudo o que se precisa saber do produto e dos dois almoxarifados, lido agora. */
  private async contexto(almoxId: number, produtoId: number): Promise<Contexto> {
    const [[unidades, almoxarifados], cadastros, saldos] = await Promise.all([
      this.produtos.paraMovimentar(),
      this.produtos.cadastrosPorId([produtoId]),
      this.estoque.saldosDoProduto(produtoId),
    ]);
    const bruto = cadastros.get(produtoId);
    if (!bruto) throw new NotFoundException(`O produto #${produtoId} não existe no IXC.`);
    const almox = almoxarifados.find((a) => a.id === almoxId) ?? null;
    const perdas = almoxarifados.find((a) => ehAlmoxDePerdas(a.nome)) ?? null;
    const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade)) ?? null;
    const tipo = String(bruto.tipo ?? '').trim().toUpperCase();
    const descricao = String(bruto.descricao ?? '').trim() || `Produto ${produtoId}`;
    const saldoDe = (id: number | undefined) =>
      id === undefined ? 0 : (saldos?.saldos.find((s) => s.almoxId === id)?.saldo ?? 0);

    const impedimento = !almox
      ? 'O sistema não enxerga este almoxarifado no IXC — libere-o na aba Almoxarifados.'
      : ehAlmoxDePerdas(almox.nome)
        ? `"${almox.nome}" não se confere: é para onde vai o que não foi achado nos outros.`
        : !perdas
          ? `Não achei o almoxarifado "Perdas e Falhas" no IXC (ou ele não está liberado para o sistema). ` +
            'É para lá que vai o que falta — cadastre ou libere na aba Almoxarifados.'
          : produtoInativo(bruto)
            ? `"${descricao}" está inativo no IXC, e inativo não se confere. Se ele voltou a ser usado, ` +
              'ative-o na aba Estoque ("Mostrar inativos").'
            : tipo === 'S'
              ? 'Serviço não é estoque: o IXC não soma entrada de serviço.'
              : naoControlaEstoque(bruto)
                ? `${NAO_CONTROLA} — nada que se lance muda o saldo dele. ${SAIDA_DO_NAO_CONTROLA}.`
                : !unidade
                  ? 'O produto está sem unidade no IXC — corrija o cadastro (botão "Corrigir cadastro") antes de conferir.'
                  : null;

    return {
      produtoId,
      bruto,
      descricao,
      tipo,
      patrimonio: tipo === 'P',
      unidade,
      almox,
      perdas,
      almoxarifados,
      saldos,
      saldoAqui: saldoDe(almox?.id ?? almoxId),
      saldoEmPerdas: saldoDe(perdas?.id),
      impedimento,
    };
  }

  /** As peças do produto no almoxarifado — na prateleira e presas (ver `SITUACOES_LIDAS`). */
  private async pecasAqui(almoxId: number, produtoId: number): Promise<Array<Record<string, unknown>>> {
    const porSituacao = await Promise.all(
      SITUACOES_LIDAS.map((situacao) =>
        this.ixc.listAll<Record<string, unknown>>(
          'patrimonio',
          {
            qtype: 'patrimonio.id_produto',
            query: String(produtoId),
            oper: '=',
            sortname: 'patrimonio.id',
            sortorder: 'asc',
            gridParam: [
              { TB: 'patrimonio.id_almoxarifado', OP: '=', P: String(almoxId) },
              { TB: 'patrimonio.situacao', OP: '=', P: situacao },
            ],
          },
          { pageSize: 500, maxPages: 20 },
        ),
      ),
    );
    const porId = new Map<number, Record<string, unknown>>();
    for (const l of porSituacao.flat()) {
      // O filtro é conferido de novo aqui: peça de outro lugar numa conferência é ONU mandada para Perdas por engano.
      if (
        numeroDoIxc(l.id) > 0 &&
        numeroDoIxc(l.id_produto) === produtoId &&
        numeroDoIxc(l.id_almoxarifado) === almoxId &&
        SITUACOES_LIDAS.includes(String(l.situacao ?? '').trim())
      ) {
        porId.set(numeroDoIxc(l.id), l);
      }
    }
    return [...porId.values()];
  }

  private pecaParaMover(l: Record<string, unknown>, ctx: Contexto): Omit<PecaParaMover, 'origem'> {
    return {
      patrimonioId: numeroDoIxc(l.id),
      produtoId: ctx.produtoId,
      unidadeId: ctx.unidade!.id,
      unidadeSigla: ctx.unidade!.sigla,
      identificacao: identificacao(identidadeDaPeca(l)),
    };
  }

  /** Uma transferência de produto pela quantidade — a transferência, e o item dentro dela. */
  private async transferirQuantidade(
    de: Almox,
    para: Almox,
    ctx: Contexto,
    quantidade: number,
    motivo: MotivoDaTransferencia,
    observacao: string,
  ): Promise<TransferenciaLancada> {
    const base = {
      tipo: 'transferencia' as const,
      motivo,
      de: nomeDe(de),
      para: nomeDe(para),
      quantidade,
    };
    const saldoAntes = await this.saldoEm(ctx.produtoId, de.id);
    if (quantidade > saldoAntes + QUASE_ZERO) {
      return { ...base, transferenciaId: null, ok: false, erro: `${de.nome} tem ${fmt(saldoAntes)} no IXC, não ${fmt(quantidade)}` };
    }
    const transferenciaId = await this.abrirTransferencia(de, para, observacao);
    if (typeof transferenciaId === 'string') return { ...base, transferenciaId: null, ok: false, erro: transferenciaId };

    const item = () =>
      this.ixc.create(
        'transf_almox_item',
        montarItemDaTransferencia(transferenciaId, {
          produtoId: ctx.produtoId,
          unidadeId: ctx.unidade!.id,
          unidadeSigla: ctx.unidade!.sigla,
          quantidade,
          tipoProduto: ctx.tipo,
        }),
      );
    try {
      await item();
      return { ...base, transferenciaId, ok: true };
    } catch (err) {
      const motivoDaRecusa = err instanceof Error ? err.message : String(err);
      await pausa(this.pausaAntesDeRepetirMs);
      // O IXC pode ter gravado mesmo dizendo que não: relido o saldo, se já saiu, não se manda de novo.
      const agora = await this.saldoEm(ctx.produtoId, de.id).catch(() => null);
      if (agora !== null && Math.abs(agora - (saldoAntes - quantidade)) < QUASE_ZERO) {
        return { ...base, transferenciaId, ok: true };
      }
      if (agora === null || Math.abs(agora - saldoAntes) > QUASE_ZERO) {
        return {
          ...base,
          transferenciaId,
          ok: false,
          erro: `${motivoDaRecusa} — e o saldo de ${de.nome} mudou para ${agora === null ? '?' : fmt(agora)}: confira a transferência #${transferenciaId} no IXC`,
        };
      }
      try {
        await item();
        return { ...base, transferenciaId, ok: true };
      } catch (err2) {
        return {
          ...base,
          transferenciaId,
          ok: false,
          erro:
            `${err2 instanceof Error ? err2.message : String(err2)} — a transferência #${transferenciaId} ` +
            'ficou aberta e vazia no IXC; o saldo não mudou',
        };
      }
    }
  }

  /**
   * O saldo de patrimônio sem peça, pela quantidade, para Perdas — só o que os
   * movimentos confirmam (ver `conferirSemPeca` em `transferencias.service`: a
   * tabela de saldos já mostrou notebook que os movimentos não tinham).
   */
  private async transferirSemPeca(
    ctx: Contexto,
    passo: Extract<Passo, { tipo: 'semPeca' }>,
    observacao: string,
  ): Promise<TransferenciaLancada> {
    const almox = ctx.almox!;
    const pelosMovimentos = await this.produtos.saldoPelosMovimentos(ctx.produtoId, almox.id);
    const confirmado = arredondarQtde(Math.min(passo.quantidade, pelosMovimentos - passo.pecasCadastradas));
    if (!(confirmado > QUASE_ZERO)) {
      return {
        tipo: 'transferencia',
        motivo: 'saldo-sem-peca',
        transferenciaId: null,
        de: nomeDe(almox),
        para: nomeDe(ctx.perdas!),
        quantidade: passo.quantidade,
        ok: false,
        erro:
          `o IXC mostra ${fmt(passo.quantidade)} de saldo sem peça aqui, mas os movimentos dele somam ` +
          `${fmt(pelosMovimentos)} para ${passo.pecasCadastradas} peças — não mexi (a leitura de saldo do IXC está desatualizada)`,
      };
    }
    return this.transferirQuantidade(almox, ctx.perdas!, ctx, confirmado, 'saldo-sem-peca', observacao);
  }

  /** Uma transferência de peças de patrimônio: o primeiro item sozinho, o resto três por vez. */
  private async transferirPecas(
    de: Almox,
    para: Almox,
    pecas: PecaParaMover[],
    motivo: MotivoDaTransferencia,
    observacao: string,
  ): Promise<TransferenciaLancada> {
    const base = { tipo: 'transferencia' as const, motivo, de: nomeDe(de), para: nomeDe(para) };
    const dita = (p: PecaParaMover): PecaDoLancamento => ({ patrimonioId: p.patrimonioId, identificacao: p.identificacao });
    const transferenciaId = await this.abrirTransferencia(de, para, observacao);
    if (typeof transferenciaId === 'string') {
      return { ...base, transferenciaId: null, pecas: [], falharam: pecas.map((p) => ({ ...dita(p), motivo: transferenciaId })), ok: false, erro: transferenciaId };
    }

    const foram: PecaDoLancamento[] = [];
    const recusadas: Array<{ peca: PecaParaMover; motivo: string }> = [];
    const incluir = async (p: PecaParaMover) => {
      try {
        await this.ixc.create('transf_almox_item', montarPatrimonioDaTransferencia(transferenciaId, p));
        foram.push(dita(p));
      } catch (err) {
        recusadas.push({ peca: p, motivo: err instanceof Error ? err.message : String(err) });
      }
    };
    const [primeira, ...resto] = pecas;
    await incluir(primeira);
    await emParalelo(resto, 3, incluir);

    const falharam: Array<PecaDoLancamento & { motivo: string }> = [];
    if (recusadas.length > 0) {
      await pausa(this.pausaAntesDeRepetirMs);
      for (const r of recusadas) {
        const agora = await this.ixc
          .getById<Record<string, unknown>>('patrimonio', 'patrimonio.id', r.peca.patrimonioId)
          .catch(() => null);
        if (agora && numeroDoIxc(agora.id_almoxarifado) === para.id) {
          foram.push(dita(r.peca)); // gravou, mesmo dizendo que não
          continue;
        }
        if (!agora || numeroDoIxc(agora.id_almoxarifado) !== de.id || !situacaoDaPeca(agora.situacao).naPrateleira) {
          falharam.push({ ...dita(r.peca), motivo: `${r.motivo} — e a peça já não está na prateleira de ${de.nome}` });
          continue;
        }
        try {
          await this.ixc.create('transf_almox_item', montarPatrimonioDaTransferencia(transferenciaId, r.peca));
          foram.push(dita(r.peca));
        } catch (err) {
          falharam.push({ ...dita(r.peca), motivo: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return { ...base, transferenciaId, pecas: foram, falharam, ok: falharam.length === 0 };
  }

  /** Abre a transferência no IXC. Devolve o número, ou o motivo de não ter aberto. */
  private async abrirTransferencia(de: Almox, para: Almox, observacao: string): Promise<number | string> {
    try {
      const { id } = await this.ixc.create(
        'transf_almox_top',
        montarTransferencia({
          almoxSaida: de.id,
          filialSaida: de.filialId,
          almoxEntrada: para.id,
          filialEntrada: para.filialId,
          data: hojeParaIxc(),
          observacao,
        }),
      );
      return id ?? 'o IXC não devolveu o número da transferência';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** A compra de acerto do que sobrou: a compra, o item, e — patrimônio — as peças que ela criou. */
  private async comprar(ctx: Contexto, quantidade: number, valorUnitario: number): Promise<CompraLancada> {
    const almox = ctx.almox!;
    const base = { tipo: 'compra' as const, motivo: 'sobra' as const, quantidade, valorUnitario };
    const modelo = await this.modeloDaCompra();
    const data = hojeParaIxc();
    let entradaId: number | null;
    try {
      ({ id: entradaId } = await this.ixc.create(
        'entrada',
        montarEntrada({
          tipoDocumentoId: modelo.tipoDocumentoId,
          fornecedorId: modelo.fornecedorId,
          condicaoPagamentoId: modelo.condicaoPagamentoId,
          filialId: almox.filialId,
          data,
          numeroNota: '',
          documento: DOCUMENTO_DA_CONFERENCIA,
          valorTotal: Math.round(quantidade * valorUnitario * 100) / 100,
        }),
      ));
    } catch (err) {
      return { ...base, entradaId: null, ok: false, erro: err instanceof Error ? err.message : String(err) };
    }
    if (!entradaId) return { ...base, entradaId: null, ok: false, erro: 'o IXC não devolveu o número da compra' };

    let itemId: number | null;
    try {
      ({ id: itemId } = await this.ixc.create(
        'movimento_produtos',
        montarItemDaEntrada(entradaId, {
          produtoId: ctx.produtoId,
          unidadeId: ctx.unidade!.id,
          unidadeSigla: ctx.unidade!.sigla,
          almoxId: almox.id,
          filialId: almox.filialId,
          quantidade,
          valorUnitario,
          data,
        }),
      ));
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      // A compra vazia não serve para nada, e confunde quem abre as compras no IXC.
      const apagada = await this.ixc.remove('entrada', entradaId).then(() => true, () => false);
      return {
        ...base,
        entradaId,
        ok: false,
        apagada,
        erro: `${motivo}${apagada ? ' — a compra vazia foi apagada' : ` — a compra #${entradaId} ficou vazia no IXC`}`,
      };
    }

    let pecasCriadas: string[] | undefined;
    if (ctx.patrimonio && itemId) {
      pecasCriadas = await this.ixc
        .listAll<Record<string, unknown>>(
          'patrimonio',
          { qtype: 'patrimonio.id_movimento_produto', query: String(itemId), oper: '=', sortname: 'patrimonio.id', sortorder: 'asc' },
          { pageSize: 200, maxPages: 5 },
        )
        .then((ls) => ls.map((l) => identificacao(identidadeDaPeca(l))))
        .catch(() => undefined);
    }
    return { ...base, entradaId, ok: true, ...(pecasCriadas ? { pecasCriadas } : {}) };
  }

  /** Apaga a compra de acerto da conferência: só aberta, e só se é mesmo dela. */
  private async apagarCompra(entradaId: number): Promise<{ ok: boolean; erro?: string }> {
    const { entrada, itens } = await this.produtos.entradaCrua(entradaId);
    if (!entrada) return { ok: true }; // já não existe
    if (String(entrada.documento ?? '').trim() !== DOCUMENTO_DA_CONFERENCIA) {
      return { ok: false, erro: 'a compra não tem a marca da conferência — não mexi' };
    }
    if (String(entrada.status ?? '').toUpperCase() !== 'A') {
      return { ok: false, erro: 'a compra já foi finalizada no IXC, e compra finalizada não se apaga daqui' };
    }
    for (const i of itens) {
      try {
        await this.ixc.remove('movimento_produtos', numeroDoIxc(i.id));
      } catch (err) {
        return { ok: false, erro: `o IXC não apagou o item (${err instanceof Error ? err.message : String(err)})` };
      }
    }
    try {
      await this.ixc.remove('entrada', entradaId);
    } catch (err) {
      return { ok: false, erro: `os itens saíram, mas o IXC não apagou a compra (${err instanceof Error ? err.message : String(err)})` };
    }
    return { ok: true };
  }

  /**
   * A compra de acerto copia a última compra do Fornecedor Avulso — o tipo de
   * documento que a tela do IXC usa nem aparece na lista que a API devolve
   * (ver `ultimaEntradaDoFornecedor`).
   */
  private async modeloDaCompra(): Promise<ModeloDaCompra> {
    if (this.modelo && Date.now() - this.modelo.em < MODELO_VALE_MS) return this.modelo.valor;
    const achados = await this.fornecedores.buscarNoIxcPorNome('avulso');
    const avulso = achados.find((f) => f.nome.trim().toLowerCase() === 'fornecedor avulso');
    if (!avulso) {
      throw new BadRequestException(
        'Não achei o "Fornecedor Avulso" no IXC — é dele a compra de acerto do que sobrou. Nada foi lançado.',
      );
    }
    const ultima = await this.produtos.ultimaEntradaDoFornecedor(avulso.idFornecedor);
    if (!ultima || !(ultima.tipoDocumentoId > 0) || !(ultima.condicaoPagamentoId > 0)) {
      throw new BadRequestException(
        'O Fornecedor Avulso não tem compra no IXC para copiar o tipo de documento e a condição. ' +
          'Faça uma compra dele pela tela do IXC uma vez, e confira de novo. Nada foi lançado.',
      );
    }
    const valor = {
      fornecedorId: avulso.idFornecedor,
      tipoDocumentoId: ultima.tipoDocumentoId,
      condicaoPagamentoId: ultima.condicaoPagamentoId,
    };
    this.modelo = { em: Date.now(), valor };
    return valor;
  }

  private async saldoEm(produtoId: number, almoxId: number): Promise<number> {
    const s = await this.estoque.saldosDoProduto(produtoId);
    return s?.saldos.find((x) => x.almoxId === almoxId)?.saldo ?? 0;
  }

  // -------------------------------------------------------------------------

  private itemParaConferir(i: ItemDeEstoque, saldo: number, c: ConferenciaDeEstoque | null): ItemParaConferir {
    return {
      produtoId: i.produtoId,
      descricao: i.descricao,
      unidade: i.unidade,
      precoBase: i.precoBase,
      patrimonio: i.tipo === 'P',
      controlaEstoque: i.controlaEstoque !== false,
      saldo,
      conferencia: c ? this.naTela(c) : null,
    };
  }

  private naTela(c: ConferenciaDeEstoque): ConferenciaNaTela {
    const rodando = this.rodando.has(c.id);
    const interrompida =
      !rodando &&
      c.situacao === SituacaoConferencia.EM_ANDAMENTO &&
      Date.now() - c.createdAt.getTime() > INTERROMPIDA_APOS_MS;
    const lancamentos = (c.lancamentos as unknown as Lancamento[]) ?? [];
    const situacao = interrompida ? SituacaoConferencia.INCOMPLETO : c.situacao;
    return {
      id: c.id,
      rodadaId: c.rodadaId,
      almoxId: c.almoxId,
      almoxarifado: c.almoxarifado,
      produtoId: c.produtoId,
      descricao: c.descricao,
      unidade: c.unidade,
      patrimonio: c.patrimonio,
      sistema: Number(c.sistema),
      contado: Number(c.contado),
      valorUnitario: c.valorUnitario === null ? null : Number(c.valorUnitario),
      situacao,
      rodando,
      saldoDepois: c.saldoDepois === null ? null : Number(c.saldoDepois),
      lancamentos,
      lancamentosDitos: lancamentos.map((l) => dizerLancamento(l, c.unidade ?? '')),
      pecas: c.pecas,
      pendencias: (c.pendencias as unknown as string[]) ?? [],
      observacao: c.observacao,
      erro: interrompida
        ? 'A conferência foi interrompida no meio (o servidor reiniciou?). O que chegou ao IXC está nos lançamentos — confira o saldo e, se preciso, confira de novo.'
        : c.erro,
      conferidoPor: c.conferidoPor,
      criadoEm: c.createdAt.toISOString(),
      terminadoEm: c.terminadoEm?.toISOString() ?? null,
      desfeitoEm: c.desfeitoEm?.toISOString() ?? null,
      desfeitoPor: c.desfeitoPor,
      podeDesfazer:
        !rodando &&
        c.situacao !== SituacaoConferencia.DESFEITO &&
        c.situacao !== SituacaoConferencia.EM_ANDAMENTO &&
        lancamentos.some(
          (l) =>
            l.motivo !== 'desfazer' &&
            (l.tipo === 'compra'
              ? l.ok && !l.apagada
              : !l.desfeito && (l.ok || (l.pecas?.length ?? 0) > 0)),
        ),
    };
  }

  /** Um erro fora do previsto no meio do lançamento: fica escrito na conferência. */
  private async anotarQueParou(id: string, err: unknown): Promise<void> {
    const motivo = err instanceof Error ? err.message : String(err);
    this.logger.error(`Conferência ${id}: parou com erro inesperado (${motivo}).`);
    await this.prisma.conferenciaDeEstoque
      .update({
        where: { id },
        data: {
          situacao: SituacaoConferencia.INCOMPLETO,
          erro: `Parou no meio: ${motivo}. O que chegou ao IXC está nos lançamentos — confira o saldo.`,
          terminadoEm: new Date(),
        },
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------

interface Contexto {
  produtoId: number;
  bruto: Record<string, unknown>;
  descricao: string;
  tipo: string;
  patrimonio: boolean;
  unidade: { id: number; sigla: string } | null;
  almox: Almox | null;
  perdas: Almox | null;
  almoxarifados: Almox[];
  saldos: ItemDeEstoque | null;
  saldoAqui: number;
  saldoEmPerdas: number;
  impedimento: string | null;
}

interface PecaParaMover {
  patrimonioId: number;
  produtoId: number;
  unidadeId: number;
  unidadeSigla: string;
  identificacao: string;
  origem: Almox;
}

type Passo =
  | { tipo: 'quantidade'; motivo: MotivoDaTransferencia; de: 'aqui' | 'perdas'; para: 'aqui' | 'perdas'; quantidade: number }
  | { tipo: 'semPeca'; quantidade: number; pecasCadastradas: number }
  | { tipo: 'pecas'; motivo: MotivoDaTransferencia; de: 'aqui' | Almox; para: 'aqui' | 'perdas'; pecas: PecaParaMover[] }
  | { tipo: 'compra'; quantidade: number };

interface Trabalho {
  contado: number;
  compra: number;
  precisaDePerdasAtivo: boolean;
  passos: Passo[];
  pendencias: string[];
  pecas: Record<string, unknown> | null;
}

interface ModeloDaCompra {
  fornecedorId: number;
  tipoDocumentoId: number;
  condicaoPagamentoId: number;
}

function nomeDe(a: Almox): AlmoxDoLancamento {
  return { id: a.id, nome: a.nome };
}

function pecaParaConferir(l: Record<string, unknown>): PecaParaConferir {
  const identidade = identidadeDaPeca(l);
  const situacao = situacaoDaPeca(l.situacao);
  return {
    ...identidade,
    identificacao: identificacao(identidade),
    situacao: situacao.nome,
    naPrateleira: situacao.naPrateleira,
    identificada: pecaDaLinha(l).identificada,
  };
}

/** "N" é o inativo do IXC; ausente conta como ativo, como no Estoque (`estoque.mapper`). */
function produtoInativo(p: Record<string, unknown>): boolean {
  return String(p.ativo ?? 'S').trim().toUpperCase() === 'N';
}

function fmt(n: number): string {
  return String(arredondarQtde(n)).replace('.', ',');
}

function pausa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
