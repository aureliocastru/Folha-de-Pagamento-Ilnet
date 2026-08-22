import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CategoriaItemApr, ItemApr, ModeloApr, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AtualizarItemAprDto,
  AtualizarModeloAprDto,
  CriarModeloAprDto,
  ItemAprDto,
} from './dto/apr.dto';
import { MODELO_ILNET, type ItemSemente } from './modelo-ilnet';

/**
 * O catálogo: o formulário em branco de que as APRs são cópias preenchidas.
 *
 * A régua de ordenação é de dez em dez. Item novo entra no fim da categoria,
 * e a folga entre os valores é o que deixa arrastar um item para o meio da
 * lista sem reescrever a numeração inteira.
 */
const PASSO_DA_ORDEM = 10;

/** As categorias na ordem em que aparecem no papel e na tela. */
export const ORDEM_DAS_CATEGORIAS: CategoriaItemApr[] = [
  CategoriaItemApr.NORMA,
  CategoriaItemApr.ATIVIDADE,
  CategoriaItemApr.RISCO,
  CategoriaItemApr.FERRAMENTA,
  CategoriaItemApr.PROTECAO,
  CategoriaItemApr.RELATO,
];

export interface FormularioApr {
  modelo: ModeloApr;
  /** Só os itens ativos, já na ordem, agrupados como a tela os desenha. */
  blocos: { categoria: CategoriaItemApr; itens: ItemApr[] }[];
}

@Injectable()
export class CatalogoAprService {
  private readonly logger = new Logger(CatalogoAprService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- A semente ------------------------------------------------------------

  /**
   * Põe o formulário da ILNET no banco na primeira vez que alguém abre o
   * módulo.
   *
   * Semente, e não lei: ela só cria o que ainda não existe. Um risco riscado da
   * lista pela tela fica riscado, e o texto das orientações editado ontem não
   * volta ao original no próximo boot — se voltasse, ninguém confiaria na tela
   * de cadastro.
   *
   * Roda a cada abertura do formulário. Não achando nada faltando, não escreve
   * nada; duas abas abrindo ao mesmo tempo esbarram na chave única do nome, e a
   * segunda simplesmente encontra o que a primeira criou.
   */
  async garantirSemente(): Promise<void> {
    const existe = await this.prisma.modeloApr.findUnique({
      where: { nome: MODELO_ILNET.nome },
      select: { id: true },
    });
    if (existe) return;

    const quantos = await this.prisma.modeloApr.count();

    try {
      const modelo = await this.prisma.modeloApr.create({
        data: {
          nome: MODELO_ILNET.nome,
          titulo: MODELO_ILNET.titulo,
          tipoTrabalho: MODELO_ILNET.tipoTrabalho,
          orientacoes: MODELO_ILNET.orientacoes,
          planoResgate: MODELO_ILNET.planoResgate,
          telefonesEmergencia: MODELO_ILNET.telefonesEmergencia,
          // Padrão só se for o primeiro. Uma casa que já escolheu o formulário
          // de abertura não o perde porque a semente rodou de novo.
          padrao: quantos === 0,
        },
        select: { id: true },
      });

      await this.prisma.itemApr.createMany({
        data: itensDaSemente(modelo.id, MODELO_ILNET.itens),
        skipDuplicates: true,
      });

      this.logger.log(
        `Modelo "${MODELO_ILNET.nome}" criado com ` +
          `${MODELO_ILNET.itens.length} itens.`,
      );
    } catch (erro) {
      // Outra requisição chegou primeiro. É o resultado que se queria.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        return;
      }
      throw erro;
    }
  }

  // --- Os modelos -----------------------------------------------------------

  async modelos(incluirInativos = false): Promise<ModeloApr[]> {
    await this.garantirSemente();
    return this.prisma.modeloApr.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    });
  }

  /**
   * O formulário em branco que a tela abre.
   *
   * Sem `modeloId`, o padrão. Sem padrão marcado — o que acontece quando alguém
   * desmarca o único que havia —, o primeiro ativo: uma tela de abrir APR que
   * não abre é pior que uma que abre o formulário errado, e o errado se troca
   * no seletor.
   */
  async formulario(modeloId?: string): Promise<FormularioApr> {
    await this.garantirSemente();

    const modelo = modeloId
      ? await this.prisma.modeloApr.findUnique({ where: { id: modeloId } })
      : ((await this.prisma.modeloApr.findFirst({
          where: { ativo: true, padrao: true },
        })) ??
        (await this.prisma.modeloApr.findFirst({
          where: { ativo: true },
          orderBy: { createdAt: 'asc' },
        })));

    if (!modelo) {
      throw new NotFoundException(
        'Não há nenhum formulário de análise de risco cadastrado.',
      );
    }

    const itens = await this.prisma.itemApr.findMany({
      where: { modeloId: modelo.id, ativo: true },
      orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }, { texto: 'asc' }],
    });

    return {
      modelo,
      blocos: ORDEM_DAS_CATEGORIAS.map((categoria) => ({
        categoria,
        itens: itens.filter((i) => i.categoria === categoria),
      })),
    };
  }

  /** O catálogo inteiro de um modelo, inclusive o que está desativado. */
  async itens(modeloId: string): Promise<ItemApr[]> {
    await this.exigirModelo(modeloId);
    return this.prisma.itemApr.findMany({
      where: { modeloId },
      orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }, { texto: 'asc' }],
    });
  }

  async criarModelo(dto: CriarModeloAprDto): Promise<ModeloApr> {
    const copiado = dto.copiarDe
      ? await this.prisma.itemApr.findMany({
          where: { modeloId: dto.copiarDe, ativo: true },
          orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }],
        })
      : [];

    if (dto.copiarDe && copiado.length === 0) {
      await this.exigirModelo(dto.copiarDe);
    }

    const base = dto.copiarDe
      ? await this.prisma.modeloApr.findUnique({ where: { id: dto.copiarDe } })
      : null;

    const modelo = await this.criarSemColidir(() =>
      this.prisma.modeloApr.create({
        data: {
          nome: dto.nome,
          titulo: dto.titulo,
          tipoTrabalho: dto.tipoTrabalho,
          orientacoes: dto.orientacoes ?? base?.orientacoes ?? '',
          planoResgate: dto.planoResgate ?? base?.planoResgate ?? '',
          telefonesEmergencia:
            dto.telefonesEmergencia ?? base?.telefonesEmergencia ?? '',
          ativo: dto.ativo ?? true,
        },
      }),
    );

    if (copiado.length > 0) {
      await this.prisma.itemApr.createMany({
        data: copiado.map((i) => ({
          modeloId: modelo.id,
          categoria: i.categoria,
          texto: i.texto,
          ordem: i.ordem,
          pedeDetalhe: i.pedeDetalhe,
          exigeProvidencia: i.exigeProvidencia,
        })),
        skipDuplicates: true,
      });
    }

    if (dto.padrao) await this.tornarPadrao(modelo.id);
    return this.prisma.modeloApr.findUniqueOrThrow({ where: { id: modelo.id } });
  }

  async atualizarModelo(
    id: string,
    dto: AtualizarModeloAprDto,
  ): Promise<ModeloApr> {
    await this.exigirModelo(id);

    const { padrao, copiarDe: _ignorado, ...campos } = dto as
      AtualizarModeloAprDto & { copiarDe?: string };
    void _ignorado;

    if (Object.keys(campos).length > 0) {
      await this.criarSemColidir(() =>
        this.prisma.modeloApr.update({ where: { id }, data: campos }),
      );
    }

    // Desmarcar o padrão sem marcar outro deixaria a tela de abrir APR sem
    // formulário de partida. Quem quer trocar o padrão marca o novo.
    if (padrao === true) await this.tornarPadrao(id);

    return this.prisma.modeloApr.findUniqueOrThrow({ where: { id } });
  }

  // --- Os itens -------------------------------------------------------------

  async criarItem(modeloId: string, dto: ItemAprDto): Promise<ItemApr> {
    await this.exigirModelo(modeloId);

    const ordem = dto.ordem ?? (await this.proximaOrdem(modeloId, dto.categoria));

    try {
      return await this.prisma.itemApr.create({
        data: {
          modeloId,
          categoria: dto.categoria,
          texto: dto.textoItem,
          ordem,
          pedeDetalhe: dto.pedeDetalhe ?? false,
          exigeProvidencia:
            dto.exigeProvidencia ??
            dto.categoria === CategoriaItemApr.RELATO,
        },
      });
    } catch (erro) {
      throw this.traduzirColisao(erro, dto.textoItem);
    }
  }

  async atualizarItem(id: string, dto: AtualizarItemAprDto): Promise<ItemApr> {
    const item = await this.prisma.itemApr.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Este item não existe mais.');

    try {
      return await this.prisma.itemApr.update({
        where: { id },
        data: {
          ...(dto.textoItem !== undefined ? { texto: dto.textoItem } : {}),
          ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
          ...(dto.pedeDetalhe !== undefined
            ? { pedeDetalhe: dto.pedeDetalhe }
            : {}),
          ...(dto.exigeProvidencia !== undefined
            ? { exigeProvidencia: dto.exigeProvidencia }
            : {}),
          ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
        },
      });
    } catch (erro) {
      throw this.traduzirColisao(erro, dto.textoItem ?? item.texto);
    }
  }

  /**
   * Apaga um item que nunca foi usado; desativa o que já foi.
   *
   * Não é preciosismo: a APR guarda o texto do que foi marcado, então apagar o
   * item não apaga o papel de ninguém — mas apaga o vínculo, e com ele a
   * resposta a "em quantos serviços marcaram descarga elétrica?". Desativar
   * custa nada e preserva a conta.
   */
  async removerItem(id: string): Promise<{ apagado: boolean }> {
    const item = await this.prisma.itemApr.findUnique({
      where: { id },
      select: { id: true, _count: { select: { respostas: true } } },
    });
    if (!item) throw new NotFoundException('Este item não existe mais.');

    if (item._count.respostas > 0) {
      await this.prisma.itemApr.update({
        where: { id },
        data: { ativo: false },
      });
      return { apagado: false };
    }

    await this.prisma.itemApr.delete({ where: { id } });
    return { apagado: true };
  }

  /** Grava a ordem em que a categoria ficou depois de arrastar. */
  async reordenar(ids: string[]): Promise<{ ok: true }> {
    await this.prisma.$transaction(
      ids.map((id, indice) =>
        this.prisma.itemApr.update({
          where: { id },
          data: { ordem: (indice + 1) * PASSO_DA_ORDEM },
        }),
      ),
    );
    return { ok: true };
  }

  // --- Miudezas -------------------------------------------------------------

  private async proximaOrdem(
    modeloId: string,
    categoria: CategoriaItemApr,
  ): Promise<number> {
    const ultimo = await this.prisma.itemApr.findFirst({
      where: { modeloId, categoria },
      orderBy: { ordem: 'desc' },
      select: { ordem: true },
    });
    return (ultimo?.ordem ?? 0) + PASSO_DA_ORDEM;
  }

  private async tornarPadrao(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.modeloApr.updateMany({
        where: { padrao: true, id: { not: id } },
        data: { padrao: false },
      }),
      this.prisma.modeloApr.update({
        where: { id },
        data: { padrao: true, ativo: true },
      }),
    ]);
  }

  private async exigirModelo(id: string): Promise<ModeloApr> {
    const modelo = await this.prisma.modeloApr.findUnique({ where: { id } });
    if (!modelo) {
      throw new NotFoundException('Este formulário não existe mais.');
    }
    return modelo;
  }

  /** O nome do modelo é único: dois "Trabalho em altura" seriam um sorteio. */
  private async criarSemColidir<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Já existe um formulário com esse nome. Escolha outro.',
        );
      }
      throw erro;
    }
  }

  private traduzirColisao(erro: unknown, texto: string): unknown {
    if (
      erro instanceof Prisma.PrismaClientKnownRequestError &&
      erro.code === 'P2002'
    ) {
      return new BadRequestException(
        `"${texto}" já está nesta lista. Se ele sumiu da tela, é porque está ` +
          'desativado — reative em vez de cadastrar de novo.',
      );
    }
    return erro;
  }
}

/** A semente virando linhas, com a ordem de dez em dez dentro de cada bloco. */
function itensDaSemente(
  modeloId: string,
  semente: ItemSemente[],
): Prisma.ItemAprCreateManyInput[] {
  const contagem = new Map<CategoriaItemApr, number>();

  return semente.map((item) => {
    const anterior = contagem.get(item.categoria) ?? 0;
    const ordem = anterior + PASSO_DA_ORDEM;
    contagem.set(item.categoria, ordem);

    return {
      modeloId,
      categoria: item.categoria,
      texto: item.texto,
      ordem,
      pedeDetalhe: item.pedeDetalhe ?? false,
      exigeProvidencia:
        item.exigeProvidencia ?? item.categoria === CategoriaItemApr.RELATO,
    };
  });
}
