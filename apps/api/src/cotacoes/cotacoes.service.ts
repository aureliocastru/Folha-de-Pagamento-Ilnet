import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type UnidadeProduto } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  compararCatalogo,
  compararProduto,
  type CotacaoCrua,
  type ProdutoComparado,
  type ProdutoParaComparar,
} from './menor-preco';

/** Uma cotação como ela vai para a tela do histórico. */
export interface CotacaoDoHistorico {
  id: string;
  fornecedor: { id: string; nome: string; ativo: boolean };
  valor: number;
  data: string;
  quantidadeMinima: number | null;
  observacao: string | null;
  registradoPor: string | null;
  /** É este o preço que vale hoje deste fornecedor? */
  vale: boolean;
}

export interface ProdutoDetalhado extends ProdutoComparado {
  /** Tudo o que já se pagou por ele, do mais recente para o mais antigo. */
  historico: CotacaoDoHistorico[];
}

/**
 * O catálogo de preços: o que a casa compra, e por quanto, em cada fornecedor.
 *
 * Nada aqui fala com o IXC. O fornecedor é cadastro desta casa (ver o
 * `FornecedoresCotacaoService`), o produto também, e o preço é uma anotação de
 * quem ligou para o vendedor. É de propósito: o IXC sabe para quem a empresa
 * já pagou, e isso não é a mesma pergunta que "quanto custa a ONU na
 * Opticall?".
 *
 * O preço é gravado uma linha por cotação, e não num campo que se sobrescreve.
 * A conta de qual deles vale hoje mora em `menor-preco.ts`, fora daqui e sem
 * banco nenhum — é a única parte disto que erra em silêncio.
 */
@Injectable()
export class CotacoesService {
  private readonly logger = new Logger(CotacoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Produtos
  // -------------------------------------------------------------------------

  /**
   * O catálogo comparado: cada produto com o preço que vale de cada fornecedor
   * e quem está mais barato.
   *
   * As cotações vêm todas numa consulta só e são espalhadas em memória. Um
   * catálogo de duzentos itens custaria duzentas idas ao banco se cada produto
   * buscasse as suas — e esta é a tela que abre o módulo.
   */
  async listarProdutos(opcoes: {
    busca?: string;
    incluirInativos?: boolean;
  }): Promise<ProdutoComparado[]> {
    const busca = opcoes.busca?.trim();

    const produtos = await this.prisma.produtoCotado.findMany({
      where: {
        ...(opcoes.incluirInativos ? {} : { ativo: true }),
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { codigo: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
    });

    if (produtos.length === 0) return [];

    const cotacoes = await this.cotacoesDe(produtos.map((p) => p.id));
    return compararCatalogo(produtos.map(paraComparar), cotacoes);
  }

  /** Um produto com a comparação e o histórico inteiro. */
  async detalharProduto(id: string): Promise<ProdutoDetalhado> {
    const produto = await this.prisma.produtoCotado.findUnique({
      where: { id },
    });
    if (!produto) throw new NotFoundException('Produto não encontrado');

    const cotacoes = await this.cotacoesDe([id]);
    const comparado = compararProduto(paraComparar(produto), cotacoes);

    // Quais linhas do histórico são as que valem — a tela marca essas, e sem
    // isto ela teria de refazer aqui a conta que já foi feita lá.
    const valem = new Set(comparado.precos.map((p) => p.id));

    const historico = [...cotacoes]
      .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm))
      .map(({ produtoId: _produtoId, criadoEm: _criadoEm, ...c }) => ({
        ...c,
        vale: valem.has(c.id),
      }));

    return { ...comparado, historico };
  }

  async criarProduto(dados: {
    nome: string;
    codigo?: string | null;
    unidade?: UnidadeProduto;
    observacao?: string | null;
  }): Promise<ProdutoComparado> {
    await this.recusarProdutoRepetido(dados.nome);

    const criado = await this.prisma.produtoCotado.create({
      data: {
        nome: dados.nome,
        codigo: dados.codigo ?? null,
        unidade: dados.unidade ?? 'UN',
        observacao: dados.observacao ?? null,
      },
    });
    this.logger.log(`Produto cotado criado: ${criado.nome}`);

    return compararProduto(paraComparar(criado), []);
  }

  async atualizarProduto(
    id: string,
    dados: {
      nome?: string;
      codigo?: string | null;
      unidade?: UnidadeProduto;
      observacao?: string | null;
      ativo?: boolean;
    },
  ): Promise<ProdutoComparado> {
    const atual = await this.prisma.produtoCotado.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Produto não encontrado');

    if (dados.nome && dados.nome.toLowerCase() !== atual.nome.toLowerCase()) {
      await this.recusarProdutoRepetido(dados.nome);
    }

    const salvo = await this.prisma.produtoCotado.update({
      where: { id },
      data: dados,
    });

    const cotacoes = await this.cotacoesDe([id]);
    return compararProduto(paraComparar(salvo), cotacoes);
  }

  /**
   * Apaga o produto. Com preços cadastrados, só sob pedido explícito.
   *
   * O banco recusa por conta própria (`onDelete: Restrict`), e isso viraria um
   * erro cru de chave estrangeira na tela. Aqui a recusa vem com o número de
   * cotações que se perderiam, que é o que a pessoa precisa saber para decidir
   * — e quase sempre a resposta certa é desativar, não apagar.
   */
  async excluirProduto(id: string, comAsCotacoes = false): Promise<void> {
    const produto = await this.prisma.produtoCotado.findUnique({
      where: { id },
      include: { _count: { select: { precos: true } } },
    });
    if (!produto) throw new NotFoundException('Produto não encontrado');

    const quantas = produto._count.precos;
    if (quantas > 0 && !comAsCotacoes) {
      throw new ConflictException(
        `"${produto.nome}" tem ${quantas} ${quantas === 1 ? 'preço cadastrado' : 'preços cadastrados'}. ` +
          'Desative-o para tirá-lo da lista sem perder o histórico, ou confirme para apagar tudo.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.precoDeProduto.deleteMany({ where: { produtoId: id } }),
      this.prisma.produtoCotado.delete({ where: { id } }),
    ]);
    this.logger.log(
      `Produto cotado apagado: ${produto.nome} (${quantas} cotações junto)`,
    );
  }

  // -------------------------------------------------------------------------
  // Preços
  // -------------------------------------------------------------------------

  async criarPreco(
    dados: {
      produtoId: string;
      fornecedorId: string;
      valor: number;
      data?: string;
      quantidadeMinima?: number | null;
      observacao?: string | null;
    },
    registradoPor?: string,
  ): Promise<ProdutoDetalhado> {
    const [produto, fornecedor] = await Promise.all([
      this.prisma.produtoCotado.findUnique({ where: { id: dados.produtoId } }),
      this.prisma.fornecedorCotacao.findUnique({
        where: { id: dados.fornecedorId },
      }),
    ]);
    if (!produto) throw new NotFoundException('Produto não encontrado');
    if (!fornecedor) throw new NotFoundException('Fornecedor não encontrado');

    const data = this.conferirData(dados.data);

    await this.prisma.precoDeProduto.create({
      data: {
        produtoId: dados.produtoId,
        fornecedorId: dados.fornecedorId,
        valor: new Prisma.Decimal(dados.valor),
        data,
        quantidadeMinima:
          dados.quantidadeMinima == null
            ? null
            : new Prisma.Decimal(dados.quantidadeMinima),
        observacao: dados.observacao ?? null,
        registradoPor: registradoPor ?? null,
      },
    });
    this.logger.log(
      `Preço lançado: ${produto.nome} em ${fornecedor.nome} por ${dados.valor}`,
    );

    // Devolve o produto inteiro, e não a linha criada: a tela mostra a
    // comparação, e ela pode ter mudado de dono com este lançamento.
    return this.detalharProduto(dados.produtoId);
  }

  async atualizarPreco(
    id: string,
    dados: {
      valor?: number;
      data?: string;
      quantidadeMinima?: number | null;
      observacao?: string | null;
    },
  ): Promise<ProdutoDetalhado> {
    const atual = await this.prisma.precoDeProduto.findUnique({
      where: { id },
    });
    if (!atual) throw new NotFoundException('Preço não encontrado');

    await this.prisma.precoDeProduto.update({
      where: { id },
      data: {
        ...(dados.valor === undefined
          ? {}
          : { valor: new Prisma.Decimal(dados.valor) }),
        ...(dados.data === undefined
          ? {}
          : { data: this.conferirData(dados.data) }),
        ...(dados.quantidadeMinima === undefined
          ? {}
          : {
              quantidadeMinima:
                dados.quantidadeMinima === null
                  ? null
                  : new Prisma.Decimal(dados.quantidadeMinima),
            }),
        ...(dados.observacao === undefined
          ? {}
          : { observacao: dados.observacao }),
      },
    });

    return this.detalharProduto(atual.produtoId);
  }

  async excluirPreco(id: string): Promise<ProdutoDetalhado> {
    const preco = await this.prisma.precoDeProduto.findUnique({
      where: { id },
    });
    if (!preco) throw new NotFoundException('Preço não encontrado');

    await this.prisma.precoDeProduto.delete({ where: { id } });
    return this.detalharProduto(preco.produtoId);
  }

  // -------------------------------------------------------------------------

  /** As cotações destes produtos, já no formato da comparação. */
  private async cotacoesDe(produtoIds: string[]): Promise<CotacaoCrua[]> {
    const precos = await this.prisma.precoDeProduto.findMany({
      where: { produtoId: { in: produtoIds } },
      include: {
        fornecedor: { select: { id: true, nome: true, ativo: true } },
      },
    });

    return precos.map((p) => ({
      id: p.id,
      produtoId: p.produtoId,
      fornecedor: p.fornecedor,
      valor: Number(p.valor),
      data: comoDia(p.data),
      criadoEm: p.createdAt.toISOString(),
      quantidadeMinima:
        p.quantidadeMinima == null ? null : Number(p.quantidadeMinima),
      observacao: p.observacao,
      registradoPor: p.registradoPor,
    }));
  }

  /**
   * "AAAA-MM-DD" → meia-noite em UTC, que é como as datas desta base são
   * gravadas. Vazio = hoje.
   *
   * Data no futuro é recusada: cotação é o que o vendedor **passou**, e um dia
   * que ainda não chegou é dedo errado no calendário. Se passasse, ela venceria
   * todas as outras daquele fornecedor até a data chegar — e o preço que a tela
   * mostra viria de uma linha que ninguém confirmou.
   */
  private conferirData(iso?: string): Date {
    if (!iso) return hojeUtc();

    const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (Number.isNaN(data.getTime())) {
      throw new BadRequestException('Data da cotação inválida.');
    }
    if (data.getTime() > hojeUtc().getTime()) {
      throw new BadRequestException(
        'A data da cotação está no futuro. É o dia em que o preço foi passado.',
      );
    }
    return data;
  }

  private async recusarProdutoRepetido(nome: string): Promise<void> {
    const existe = await this.prisma.produtoCotado.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' } },
      select: { nome: true },
    });
    if (existe) {
      throw new ConflictException(
        `Já existe um produto chamado "${existe.nome}". ` +
          'Dois cadastros do mesmo item espalham os preços dele em duas listas.',
      );
    }
  }
}

function paraComparar(p: {
  id: string;
  nome: string;
  codigo: string | null;
  unidade: UnidadeProduto;
  observacao: string | null;
  ativo: boolean;
}): ProdutoParaComparar {
  return {
    id: p.id,
    nome: p.nome,
    codigo: p.codigo,
    unidade: p.unidade,
    observacao: p.observacao,
    ativo: p.ativo,
  };
}

/** Uma coluna `DATE` do Postgres vira "AAAA-MM-DD" sem passar pelo fuso local. */
function comoDia(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  );
}
