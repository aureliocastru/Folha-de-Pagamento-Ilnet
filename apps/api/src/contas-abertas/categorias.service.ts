import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CategoriaDespesa } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Uma categoria com quantas contas já foram etiquetadas com ela. */
export interface CategoriaComUso extends CategoriaDespesa {
  emUso: number;
  /** A categoria de cima, quando esta é uma subcategoria. */
  pai: { id: string; nome: string } | null;
  /** Tem subcategorias penduradas — então ela é um grupo, e não uma folha. */
  temFilhas: boolean;
}

/**
 * A etiqueta de um título, já com o grupo a que ela pertence.
 *
 * O grupo vem junto porque quem lê a lista precisa dele para somar: o
 * dashboard agrupa por "Veículos" e destrincha em "Compra" e "Manutenção", e
 * uma segunda ida ao banco por linha para descobrir a mãe seria uma consulta
 * por título.
 */
export interface EtiquetaDoTitulo {
  id: string;
  nome: string;
  grupo: { id: string; nome: string } | null;
}

/**
 * O cadastro de "com o que a empresa gasta".
 *
 * Duas alturas, e só duas: a categoria ("Veículos") e a subcategoria dentro
 * dela ("Compra de veículos", "Manutenção de veículos"). Etiquetar é escolher
 * a de baixo; o dashboard soma pela de cima. Sem esse degrau, trinta nomes
 * soltos viravam trinta barras que não respondem "quanto custa a frota?" —
 * a resposta ficava espalhada em três delas.
 *
 * Categoria não se apaga quando já etiquetou alguma conta: relatório de mês
 * fechado não pode mudar porque alguém arrumou o cadastro depois. O caminho é
 * desativar — some das opções novas e o que já foi classificado continua de pé.
 */
@Injectable()
export class CategoriasService {
  private readonly logger = new Logger(CategoriasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(incluirInativas = false): Promise<CategoriaComUso[]> {
    const categorias = await this.prisma.categoriaDespesa.findMany({
      where: incluirInativas ? undefined : { ativa: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      include: {
        pai: { select: { id: true, nome: true } },
        _count: { select: { classificacoes: true, filhas: true } },
      },
    });

    return categorias.map(({ _count, pai, ...c }) => ({
      ...c,
      pai: pai ?? null,
      temFilhas: _count.filhas > 0,
      emUso: _count.classificacoes,
    }));
  }

  async criar(nome: string, paiId?: string | null): Promise<CategoriaComUso> {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      throw new BadRequestException('O nome da categoria é curto demais.');
    }
    await this.recusarNomeRepetido(limpo);
    await this.conferirMae(null, paiId ?? null);

    // Entra no fim da lista; reordenar é assunto de outra tela, se um dia
    // fizer falta.
    const ultima = await this.prisma.categoriaDespesa.findFirst({
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });

    this.logger.log(`Categoria de despesa criada: ${limpo}`);
    const criada = await this.prisma.categoriaDespesa.create({
      data: {
        nome: limpo,
        ordem: (ultima?.ordem ?? 0) + 1,
        paiId: paiId ?? null,
      },
      include: { pai: { select: { id: true, nome: true } } },
    });
    // A recém-criada entra na lista da tela na hora, e a tela lê pela árvore:
    // devolver a linha crua do banco a faria aparecer como categoria solta até
    // a releitura chegar, mesmo tendo nascido dentro de um grupo.
    const { pai, ...c } = criada;
    return { ...c, pai: pai ?? null, temFilhas: false, emUso: 0 };
  }

  async atualizar(
    id: string,
    dados: { nome?: string; ativa?: boolean; paiId?: string | null },
  ): Promise<CategoriaComUso> {
    const atual = await this.prisma.categoriaDespesa.findUnique({
      where: { id },
    });
    if (!atual) throw new NotFoundException('Categoria não encontrada');

    const nome = dados.nome?.trim();
    if (nome !== undefined) {
      if (nome.length < 2) {
        throw new BadRequestException('O nome da categoria é curto demais.');
      }
      if (nome.toLowerCase() !== atual.nome.toLowerCase()) {
        await this.recusarNomeRepetido(nome);
      }
    }

    // `undefined` é "não mexeu na mãe"; `null` é "tirou do grupo". Sem essa
    // distinção, renomear uma subcategoria a soltaria do grupo de brinde.
    if (dados.paiId !== undefined) {
      await this.conferirMae(id, dados.paiId);
    }

    const salva = await this.prisma.categoriaDespesa.update({
      where: { id },
      data: {
        ...(nome === undefined ? {} : { nome }),
        ...(dados.ativa === undefined ? {} : { ativa: dados.ativa }),
        ...(dados.paiId === undefined ? {} : { paiId: dados.paiId }),
      },
      include: {
        pai: { select: { id: true, nome: true } },
        _count: { select: { classificacoes: true, filhas: true } },
      },
    });

    const { pai, _count, ...c } = salva;
    return {
      ...c,
      pai: pai ?? null,
      temFilhas: _count.filhas > 0,
      emUso: _count.classificacoes,
    };
  }

  /**
   * Apaga — só a que nunca etiquetou nada e não é mãe de ninguém. Com uso, o
   * pedido vira a orientação de desativar, porque apagar reescreveria o
   * passado.
   */
  async remover(id: string): Promise<void> {
    const usos = await this.prisma.classificacaoConta.count({
      where: { categoriaId: id },
    });
    if (usos > 0) {
      throw new BadRequestException(
        `Esta categoria já classifica ${usos} conta(s). Desative-a em vez de ` +
          'apagar — assim ela some das opções novas sem mexer no que já foi ' +
          'classificado.',
      );
    }
    const filhas = await this.prisma.categoriaDespesa.count({
      where: { paiId: id },
    });
    if (filhas > 0) {
      throw new BadRequestException(
        `Esta categoria agrupa ${filhas} subcategoria(s). Tire-as de dentro ` +
          'dela antes de apagar — senão elas ficariam soltas sem ninguém ver.',
      );
    }
    const existe = await this.prisma.categoriaDespesa.findUnique({
      where: { id },
    });
    if (!existe) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.categoriaDespesa.delete({ where: { id } });
  }

  /**
   * Etiqueta um título do IXC. `categoriaId` vazio tira a etiqueta — quem
   * classificou errado precisa poder desfazer sem escolher outra à toa.
   */
  async classificar(
    idFnApagar: number,
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<void> {
    if (!categoriaId) {
      await this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar },
      });
      return;
    }

    const categoria = await this.prisma.categoriaDespesa.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.classificacaoConta.upsert({
      where: { idFnApagar },
      create: { idFnApagar, categoriaId, classificadoPor: usuarioId ?? null },
      update: { categoriaId, classificadoPor: usuarioId ?? null },
    });
  }

  /**
   * A mesma etiqueta em vários títulos de uma vez.
   *
   * Apagar as antigas e regravar num lote só, dentro de uma transação, em vez
   * de um upsert por título: são duas idas ao banco em vez de duas por conta, e
   * ninguém lê o meio do caminho — a lista que esta tela classifica é a mesma
   * que alimenta o painel, e metade classificada seria número errado nos dois
   * lugares. Devolve quantos títulos ficaram etiquetados.
   */
  async classificarEmLote(
    idsFnApagar: number[],
    categoriaId: string | null,
    usuarioId?: string,
  ): Promise<number> {
    const ids = [...new Set(idsFnApagar)];
    if (ids.length === 0) return 0;

    if (!categoriaId) {
      const { count } = await this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar: { in: ids } },
      });
      this.logger.log(`Etiqueta retirada de ${count} conta(s).`);
      return count;
    }

    const categoria = await this.prisma.categoriaDespesa.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');

    await this.prisma.$transaction([
      this.prisma.classificacaoConta.deleteMany({
        where: { idFnApagar: { in: ids } },
      }),
      this.prisma.classificacaoConta.createMany({
        data: ids.map((idFnApagar) => ({
          idFnApagar,
          categoriaId,
          classificadoPor: usuarioId ?? null,
        })),
      }),
    ]);

    this.logger.log(
      `${ids.length} conta(s) classificadas como "${categoria.nome}".`,
    );
    return ids.length;
  }

  /** As etiquetas de um punhado de títulos, para a listagem. */
  async dosTitulos(ids: number[]): Promise<Map<number, EtiquetaDoTitulo>> {
    if (ids.length === 0) return new Map();

    const classificadas = await this.prisma.classificacaoConta.findMany({
      where: { idFnApagar: { in: ids } },
      include: {
        categoria: { include: { pai: { select: { id: true, nome: true } } } },
      },
    });
    return new Map(
      classificadas.map((c) => [
        c.idFnApagar,
        {
          id: c.categoria.id,
          nome: c.categoria.nome,
          grupo: c.categoria.pai ?? null,
        },
      ]),
    );
  }

  /**
   * A mãe que se está pedindo serve?
   *
   * São três recusas, e cada uma evita uma árvore que a tela não sabe
   * desenhar: ninguém é mãe de si mesma; a mãe não pode estar dentro de outra
   * (o cadastro tem dois níveis, e o terceiro esconderia gasto num galho que o
   * dashboard não soma); e quem já é mãe não vira filha, pelo mesmo motivo.
   *
   * `idDaFilha` é null na criação — ali não há o que checar contra si mesma
   * nem filhas para carregar junto.
   */
  private async conferirMae(
    idDaFilha: string | null,
    paiId: string | null,
  ): Promise<void> {
    if (!paiId) return;

    if (paiId === idDaFilha) {
      throw new BadRequestException(
        'Uma categoria não pode estar dentro dela mesma.',
      );
    }

    const mae = await this.prisma.categoriaDespesa.findUnique({
      where: { id: paiId },
      select: { id: true, nome: true, paiId: true },
    });
    if (!mae) throw new NotFoundException('Categoria-mãe não encontrada');

    if (mae.paiId) {
      throw new BadRequestException(
        `"${mae.nome}" já é uma subcategoria. O cadastro tem dois níveis: ` +
          'categoria e subcategoria dentro dela.',
      );
    }

    if (idDaFilha) {
      const filhas = await this.prisma.categoriaDespesa.count({
        where: { paiId: idDaFilha },
      });
      if (filhas > 0) {
        throw new BadRequestException(
          `Esta categoria já agrupa ${filhas} subcategoria(s) — ela não pode ` +
            'entrar dentro de outra sem levar as filhas para um terceiro ' +
            'nível, que os relatórios não somam.',
        );
      }
    }
  }

  private async recusarNomeRepetido(nome: string): Promise<void> {
    const repetida = await this.prisma.categoriaDespesa.findFirst({
      where: { nome: { equals: nome, mode: 'insensitive' } },
    });
    if (repetida) {
      throw new BadRequestException(`Já existe a categoria "${repetida.nome}".`);
    }
  }
}
