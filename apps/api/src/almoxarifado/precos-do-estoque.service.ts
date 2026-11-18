import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import { numeroDoIxc } from './estoque.mapper';
import { EstoqueService } from './estoque.service';
import {
  arredondar,
  avaliarPreco,
  MENOR_PRECO_DE_VERDADE,
  type SituacaoDoPreco,
} from './precos-do-estoque';
import { ProdutosService } from './produtos.service';

interface Quem {
  nome: string;
}

/** Um produto na lista de preços. */
export interface PrecoNaTela {
  produtoId: number;
  descricao: string;
  unidade: string | null;
  /** Quanto a casa tem, somados os almoxarifados (sem Perdas e Saídas). */
  quantidade: number;
  /** O preço base do IXC — o que vale em toda parte. */
  preco: number;
  /** quantidade × preço. */
  valor: number;
  ultimaCompra: { valor: number; dia: string | null } | null;
  custoMedio: number | null;
  situacao: SituacaoDoPreco;
  motivo: string | null;
  sugestao: number | null;
  conferidoPor: string | null;
  conferidoEm: string | null;
}

export interface PrecosNaTela {
  itens: PrecoNaTela[];
  /** O valor do que tem preço confiável (conferido ou batendo com a compra). */
  valorConfiavel: number;
  /** O valor dos suspeitos, como o preço deles está hoje — fora do total confiável. */
  valorSuspeito: number;
  suspeitos: number;
  conferidos: number;
  lidoEm: string;
}

const COMPRAS_VALEM_MS = 10 * 60_000;

/**
 * Os preços do estoque: um só por produto, o preço base do cadastro no IXC.
 *
 * Gravar um preço aqui grava no IXC (e o Estoque, a ficha do produto e a
 * Contabilidade passam a ler o novo), e deixa a marca de conferido nesta base.
 * A nota de compra lançada pelo sistema faz o mesmo com o preço que se pagou.
 */
@Injectable()
export class PrecosDoEstoqueService {
  private readonly logger = new Logger(PrecosDoEstoqueService.name);
  private compras: { em: number; porProduto: Map<number, { valor: number; dia: string | null }> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly estoque: EstoqueService,
    private readonly produtos: ProdutosService,
  ) {}

  async listar(recarregar = false): Promise<PrecosNaTela> {
    const [estoque, compras, conferidos] = await Promise.all([
      this.estoque.listar({ recarregar }),
      this.ultimasCompras(recarregar),
      this.prisma.precoConferido.findMany(),
    ]);
    // O inativo não existe; serviço e o que não controla estoque não são prateleira.
    const daCasa = estoque.itens.filter(
      (i) => i.ativo && !i.servico && i.controlaEstoque !== false && i.total > 0,
    );
    const cadastros = await this.produtos.cadastrosPorId(daCasa.map((i) => i.produtoId));
    const conferidoPorProduto = new Map(conferidos.map((c) => [c.idProdutoIxc, c]));

    const itens = daCasa.map((i): PrecoNaTela => {
      const preco = i.precoBase ?? 0;
      const compra = compras.get(i.produtoId) ?? null;
      const custoMedio = numeroDoIxc(cadastros.get(i.produtoId)?.custo_medio) || null;
      const conferido = conferidoPorProduto.get(i.produtoId) ?? null;
      const avaliado = avaliarPreco({
        preco,
        ultimaCompra: compra?.valor ?? 0,
        custoMedio: custoMedio ?? 0,
        conferido: conferido ? Number(conferido.preco) : null,
      });
      const valeAMarca = avaliado.situacao === 'conferido';
      return {
        produtoId: i.produtoId,
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade: i.total,
        preco,
        valor: arredondar(i.total * preco),
        ultimaCompra: compra,
        custoMedio,
        ...avaliado,
        conferidoPor: valeAMarca ? conferido!.conferidoPor : null,
        conferidoEm: valeAMarca ? conferido!.conferidoEm.toISOString() : null,
      };
    });

    // Os suspeitos primeiro, o de maior valor no alto: é o que mais erra o total.
    const ordem: Record<SituacaoDoPreco, number> = { suspeito: 0, ok: 1, conferido: 2 };
    itens.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || b.valor - a.valor || a.descricao.localeCompare(b.descricao, 'pt-BR'));

    const soma = (l: PrecoNaTela[]) => arredondar(l.reduce((s, i) => s + i.valor, 0));
    const suspeitos = itens.filter((i) => i.situacao === 'suspeito');
    return {
      itens,
      valorConfiavel: soma(itens.filter((i) => i.situacao !== 'suspeito')),
      valorSuspeito: soma(suspeitos),
      suspeitos: suspeitos.length,
      conferidos: itens.filter((i) => i.situacao === 'conferido').length,
      lidoEm: estoque.lidoEm,
    };
  }

  /**
   * Grava o preço no IXC (o preço base do produto) e marca como conferido.
   * Sem `preco`, confirma o que já está lá.
   */
  async definir(produtoId: number, preco: number | undefined, quem: Quem): Promise<{ preco: number }> {
    const detalhe = await this.produtos.detalhar(produtoId);
    const atual = detalhe.precoBase;
    const novo = preco === undefined ? atual : arredondar(preco);
    if (!Number.isFinite(novo) || novo < MENOR_PRECO_DE_VERDADE) {
      throw new BadRequestException('O preço precisa ser de R$ 0,10 para cima.');
    }
    if (Math.abs(novo - atual) >= 0.005) {
      await this.produtos.editar(produtoId, { precoBase: novo }, quem);
      const relido = (await this.produtos.detalhar(produtoId)).precoBase;
      if (Math.abs(relido - novo) >= 0.005) {
        throw new BadRequestException(`O IXC respondeu, mas o preço continua ${relido}. Nada mudou.`);
      }
    }
    await this.marcar(produtoId, novo, quem.nome);
    this.logger.log(`${quem.nome} conferiu o preço do produto #${produtoId}: ${atual} → ${novo}.`);
    return { preco: novo };
  }

  /**
   * O preço que a nota pagou vira o preço do produto (no IXC e aqui), quando é
   * diferente do que estava. Falha aqui não desfaz a nota.
   */
  async daNota(
    itens: Array<{ produtoId: number; valorUnitario: number; entrou: boolean }>,
    numeroNota: string,
    quem: Quem,
  ): Promise<void> {
    for (const i of itens) {
      if (!i.entrou || !(i.valorUnitario >= MENOR_PRECO_DE_VERDADE)) continue;
      try {
        await this.definir(i.produtoId, i.valorUnitario, { nome: `nota ${numeroNota} (${quem.nome})` });
      } catch (err) {
        this.logger.warn(
          `Nota ${numeroNota}: o preço do produto #${i.produtoId} não foi atualizado ` +
            `(${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    }
    this.compras = null;
  }

  /** Os preços conferidos, por produto — o que a contabilidade usa como custo certo. */
  async conferidos(): Promise<Map<number, number>> {
    const l = await this.prisma.precoConferido.findMany();
    return new Map(l.map((c) => [c.idProdutoIxc, Number(c.preco)]));
  }

  private async marcar(produtoId: number, preco: number, quem: string): Promise<void> {
    await this.prisma.precoConferido.upsert({
      where: { idProdutoIxc: produtoId },
      create: { idProdutoIxc: produtoId, preco: new Prisma.Decimal(preco), conferidoPor: quem },
      update: { preco: new Prisma.Decimal(preco), conferidoPor: quem },
    });
  }

  /**
   * A última compra de verdade de cada produto (entrada de nota, de R$ 0,10
   * para cima), todas numa leitura só — como a contabilidade lê.
   */
  private async ultimasCompras(recarregar: boolean): Promise<Map<number, { valor: number; dia: string | null }>> {
    if (!recarregar && this.compras && Date.now() - this.compras.em < COMPRAS_VALEM_MS) return this.compras.porProduto;
    const linhas = await this.ixc.listAll<Record<string, unknown>>(
      'movimento_produtos',
      {
        qtype: 'movimento_produtos.tipo',
        query: 'E',
        oper: '=',
        sortname: 'movimento_produtos.id',
        sortorder: 'asc',
        gridParam: [
          { TB: 'movimento_produtos.id_entrada', OP: '>', P: '0' },
          { TB: 'movimento_produtos.valor_unitario', OP: '>=', P: String(MENOR_PRECO_DE_VERDADE) },
        ],
      },
      { pageSize: 1000, maxPages: 50 },
    );
    const porProduto = new Map<number, { valor: number; dia: string | null; id: number }>();
    for (const l of linhas) {
      const produtoId = numeroDoIxc(l.id_produto);
      const valor = Number(String(l.valor_unitario ?? '').replace(',', '.'));
      if (!produtoId || !(valor >= MENOR_PRECO_DE_VERDADE) || numeroDoIxc(l.id_entrada) <= 0) continue;
      const id = numeroDoIxc(l.id);
      const dia = /^\d{4}-\d{2}-\d{2}/.test(String(l.data ?? '')) ? String(l.data).slice(0, 10) : null;
      const atual = porProduto.get(produtoId);
      if (!atual || (dia ?? '') > (atual.dia ?? '') || (dia === atual.dia && id > atual.id)) {
        porProduto.set(produtoId, { valor: arredondar(valor), dia, id });
      }
    }
    const limpo = new Map([...porProduto].map(([k, v]) => [k, { valor: v.valor, dia: v.dia }]));
    this.compras = { em: Date.now(), porProduto: limpo };
    return limpo;
  }
}
