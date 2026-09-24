import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type MaterialDeOs } from '@prisma/client';
import { EstoqueService } from '../almoxarifado/estoque.service';
import { PrismaService } from '../prisma/prisma.service';
import { OsDoIxcService } from './os-do-ixc.service';

/** Um material do catálogo, como a tela o mostra. */
export interface MaterialNaTela {
  id: string;
  produtoId: number;
  descricao: string;
  unidade: string | null;
  /** Aparelho de cliente (vai em comodato), e não material que se gasta. */
  aparelho: boolean;
  maximoPorOs: number | null;
  ativo: boolean;
  ordem: number;
}

interface Quem {
  nome: string;
}

/**
 * Os materiais de OS: a lista curta de descartáveis que o técnico escolhe no
 * celular — conector, drop, esticador, fita.
 *
 * Existe porque o cadastro de produtos do IXC tem milhares de linhas, e
 * procurar "conector" nele no meio da rua é escolher o errado. A base monta a
 * lista uma vez, com o teto de cada um por OS (acima dele o técnico escreve o
 * porquê), e é por ela também que o relatório do mês é lido.
 *
 * O produto continua sendo o do IXC: a lista guarda o número dele e uma cópia
 * do nome, e o saldo, a unidade e o preço são sempre os de lá.
 */
@Injectable()
export class MateriaisDeOsService {
  private readonly logger = new Logger(MateriaisDeOsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estoque: EstoqueService,
    private readonly doIxc: OsDoIxcService,
  ) {}

  async lista(): Promise<MaterialNaTela[]> {
    const materiais = await this.prisma.materialDeOs.findMany({
      orderBy: [{ ativo: 'desc' }, { ordem: 'asc' }, { descricao: 'asc' }],
    });
    return materiais.map(naTela);
  }

  /**
   * Os produtos do IXC que podem entrar na lista: ativos e de estoque. Como
   * aparelho, só patrimônio (é o que anda peça por peça, em comodato); como
   * material, o contrário — nem patrimônio nem serviço.
   */
  async produtosParaIncluir(busca: string, aparelho = false) {
    const termo = busca.trim();
    if (termo.length < 2) return [];
    const [{ itens }, jaNaLista] = await Promise.all([
      this.estoque.listar({ busca: termo }),
      this.prisma.materialDeOs.findMany({ select: { produtoId: true } }),
    ]);
    const incluidos = new Set(jaNaLista.map((m) => m.produtoId));
    const patrimonio = (tipo?: string) => (tipo ?? '').toUpperCase() === 'P';
    return itens
      .filter((i) => i.ativo && !i.servico && patrimonio(i.tipo) === aparelho)
      .slice(0, 40)
      .map((i) => ({
        produtoId: i.produtoId,
        descricao: i.descricao,
        unidade: i.unidade,
        total: i.total,
        naLista: incluidos.has(i.produtoId),
      }));
  }

  async incluir(
    dados: { produtoId: number; maximoPorOs?: number | null; aparelho?: boolean },
    quem: Quem,
  ): Promise<MaterialNaTela> {
    // O cadastro é conferido agora, e não na primeira OS: sem unidade ou
    // classificação fiscal o IXC recusaria o material lá na rua.
    const produto = await this.doIxc.produtoParaOs(dados.produtoId);
    const aparelho = !!dados.aparelho;
    if (aparelho && produto.tipo !== 'P') {
      throw new BadRequestException(
        `"${produto.descricao}" não é patrimônio no IXC — aparelho de cliente anda peça por peça ` +
          '(MAC, série). Inclua como material, ou acerte o tipo do produto no IXC.',
      );
    }
    if (!aparelho && (produto.tipo === 'P' || produto.tipo === 'S')) {
      throw new BadRequestException(
        produto.tipo === 'P'
          ? `"${produto.descricao}" é patrimônio — ele se instala pela peça (MAC, série). Inclua como aparelho.`
          : `"${produto.descricao}" é serviço, e não tem estoque.`,
      );
    }
    const maior = await this.prisma.materialDeOs.aggregate({ _max: { ordem: true } });
    try {
      const criado = await this.prisma.materialDeOs.create({
        data: {
          produtoId: produto.id,
          descricao: produto.descricao,
          unidade: produto.unidadeSigla,
          aparelho,
          // Aparelho vai um por peça: teto por OS não é assunto dele.
          maximoPorOs: aparelho ? null : teto(dados.maximoPorOs),
          ordem: (maior._max.ordem ?? 0) + 1,
          criadoPor: quem.nome,
        },
      });
      this.logger.log(
        `${quem.nome} incluiu "${produto.descricao}" (#${produto.id}) na lista da OS como ` +
          `${aparelho ? 'aparelho' : 'material'}.`,
      );
      return naTela(criado);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`"${produto.descricao}" já está na lista.`);
      }
      throw err;
    }
  }

  async editar(
    id: string,
    dados: { maximoPorOs?: number | null; ativo?: boolean; ordem?: number },
  ): Promise<MaterialNaTela> {
    await this.existe(id);
    const atualizado = await this.prisma.materialDeOs.update({
      where: { id },
      data: {
        ...(dados.maximoPorOs !== undefined ? { maximoPorOs: teto(dados.maximoPorOs) } : {}),
        ...(dados.ativo !== undefined ? { ativo: dados.ativo } : {}),
        ...(dados.ordem !== undefined ? { ordem: Math.max(0, Math.trunc(dados.ordem)) } : {}),
      },
    });
    return naTela(atualizado);
  }

  /**
   * Tira da lista. O que já foi gasto em OS continua no relatório: cada item
   * guarda o produto e o nome dele, e não depende desta linha.
   */
  async apagar(id: string, quem: Quem): Promise<void> {
    const material = await this.existe(id);
    await this.prisma.materialDeOs.delete({ where: { id } });
    this.logger.log(`${quem.nome} tirou "${material.descricao}" dos materiais de OS.`);
  }

  private async existe(id: string): Promise<MaterialDeOs> {
    const material = await this.prisma.materialDeOs.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material não encontrado.');
    return material;
  }
}

function teto(valor: number | null | undefined): Prisma.Decimal | null {
  if (valor === null || valor === undefined) return null;
  if (!(valor > 0)) throw new BadRequestException('O máximo por OS tem de ser maior que zero (ou vazio).');
  return new Prisma.Decimal(valor);
}

function naTela(m: MaterialDeOs): MaterialNaTela {
  return {
    id: m.id,
    produtoId: m.produtoId,
    descricao: m.descricao,
    unidade: m.unidade,
    aparelho: m.aparelho,
    maximoPorOs: m.maximoPorOs === null ? null : Number(m.maximoPorOs),
    ativo: m.ativo,
    ordem: m.ordem,
  };
}
