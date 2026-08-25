import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { situacaoDoPrazo } from './documentos.service';

/**
 * A prateleira onde cada licitação vira uma pasta.
 *
 * Nasce sozinha na primeira licitação, do mesmo jeito que "Substituídos" nasce
 * na primeira troca: uma pasta vazia na estante, criada por precaução, seria
 * mais uma linha para ninguém abrir.
 */
export const PASTA_DAS_LICITACOES = 'Licitações';

/** Uma licitação como a tela a lista. */
export interface Licitacao {
  id: string;
  nome: string;
  criadaEm: Date;
  /** Quantos documentos já foram para dentro dela. */
  qtd: number;
  /** Deles, quantos estão vencidos e quantos vencem nos próximos 30 dias. */
  vencidos: number;
  aVencer: number;
}

/**
 * Quantos documentos uma cópia leva de uma vez.
 *
 * Cada um traz o arquivo inteiro na memória para ser regravado, e uma licitação
 * de verdade pede vinte ou trinta papéis — o teto existe para o pedido não
 * virar meia centena de megabytes num pedido só, e ninguém esbarra nele.
 */
const TETO_DA_COPIA = 60;

/**
 * Montar a pasta de uma licitação.
 *
 * O trabalho que isto substitui é o de sempre: abrir a pasta da empresa, baixar
 * catorze certidões uma a uma, juntá-las numa pasta do computador e mandar. O
 * que se perde nesse caminho não é tempo — é saber, depois, **o que foi
 * mandado**: a certidão é substituída no mês seguinte, e a pergunta "que
 * documento eu enviei naquele pregão?" não tem mais onde ser respondida.
 *
 * Por isso o documento é **copiado**, e não apontado. A pasta da licitação é
 * uma fotografia do dia do envio: renovar a certidão na pasta da empresa não
 * reescreve o que foi entregue.
 */
@Injectable()
export class LicitacoesService {
  private readonly logger = new Logger(LicitacoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** As licitações abertas até hoje, da mais nova para a mais velha. */
  async listar(): Promise<Licitacao[]> {
    const raizId = await this.raiz();
    if (!raizId) return [];

    const pastas = await this.prisma.pastaRh.findMany({
      where: { paiId: raizId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nome: true, createdAt: true },
    });
    if (pastas.length === 0) return [];

    // Só o que a contagem precisa: o arquivo não entra nesta consulta.
    const documentos = await this.prisma.documentoRh.findMany({
      where: { pastaId: { in: pastas.map((p) => p.id) } },
      select: { pastaId: true, valeAte: true },
    });

    return pastas.map((p) => {
      const meus = documentos.filter((d) => d.pastaId === p.id);
      return {
        id: p.id,
        nome: p.nome,
        criadaEm: p.createdAt,
        qtd: meus.length,
        vencidos: meus.filter((d) => situacaoDoPrazo(d.valeAte) === 'vencido')
          .length,
        aVencer: meus.filter((d) => situacaoDoPrazo(d.valeAte) === 'a-vencer')
          .length,
      };
    });
  }

  /** Abre a pasta de uma licitação nova. */
  async criar(nome: string, usuarioId?: string) {
    const limpo = nome.trim();
    if (limpo.length < 2) {
      throw new BadRequestException('O nome da licitação é curto demais.');
    }

    const raizId = await this.raiz(true);
    const igual = await this.prisma.pastaRh.findFirst({
      where: { paiId: raizId, nome: { equals: limpo, mode: 'insensitive' } },
      select: { nome: true },
    });
    if (igual) {
      throw new BadRequestException(
        `Já existe a licitação "${igual.nome}". Duas com o mesmo nome é como ` +
          'metade dos documentos some: eles ficam na outra.',
      );
    }

    const pasta = await this.prisma.pastaRh.create({
      data: { nome: limpo, paiId: raizId, criadoPor: usuarioId ?? null },
      select: { id: true, nome: true, createdAt: true },
    });

    this.logger.log(`Licitação "${pasta.nome}" aberta.`);
    return {
      id: pasta.id,
      nome: pasta.nome,
      criadaEm: pasta.createdAt,
      qtd: 0,
      vencidos: 0,
      aVencer: 0,
    } satisfies Licitacao;
  }

  /**
   * Copia para a licitação os documentos marcados.
   *
   * O que já está lá com o mesmo título não entra de novo: quem volta à mesma
   * licitação para acrescentar o que faltou marca a lista inteira outra vez, e
   * o resultado tem de ser a lista inteira uma vez só — e não catorze certidões
   * em duplicata, cada par com o mesmo nome.
   */
  async copiar(
    licitacaoId: string,
    documentoIds: string[],
    usuarioId?: string,
  ): Promise<{ copiados: number; repetidos: number }> {
    const ids = [...new Set(documentoIds)];
    if (ids.length === 0) {
      throw new BadRequestException('Nenhum documento foi marcado.');
    }
    if (ids.length > TETO_DA_COPIA) {
      throw new BadRequestException(
        `São ${ids.length} documentos de uma vez, e o limite por envio é ` +
          `${TETO_DA_COPIA}. Mande em duas levas.`,
      );
    }

    const licitacao = await this.exigirLicitacao(licitacaoId);

    const jaLa = await this.prisma.documentoRh.findMany({
      where: { pastaId: licitacaoId },
      select: { titulo: true },
    });
    const nomesDeLa = new Set(jaLa.map((d) => d.titulo.trim().toLowerCase()));

    // A única consulta desta casa que lê o arquivo de várias linhas de uma vez;
    // é por isso que ela tem teto.
    const origem = await this.prisma.documentoRh.findMany({
      where: { id: { in: ids } },
    });
    if (origem.length === 0) {
      throw new BadRequestException(
        'Nenhum dos documentos marcados existe mais.',
      );
    }

    const novos = origem.filter(
      (d) => !nomesDeLa.has(d.titulo.trim().toLowerCase()),
    );
    if (novos.length > 0) {
      await this.prisma.documentoRh.createMany({
        data: novos.map((d) => ({
          pastaId: licitacaoId,
          titulo: d.titulo,
          tipo: d.tipo,
          descricao: d.descricao,
          competencia: d.competencia,
          emitidoEm: d.emitidoEm,
          valeAte: d.valeAte,
          arquivoNome: d.arquivoNome,
          arquivoTipo: d.arquivoTipo,
          arquivoTamanho: d.arquivoTamanho,
          arquivo: d.arquivo,
          criadoPor: usuarioId ?? null,
        })),
      });
    }

    this.logger.log(
      `${novos.length} documento(s) copiados para a licitação ` +
        `"${licitacao.nome}"${
          origem.length > novos.length
            ? ` (${origem.length - novos.length} já estavam lá)`
            : ''
        }.`,
    );
    return { copiados: novos.length, repetidos: origem.length - novos.length };
  }

  /** A pasta existe e é mesmo uma licitação? */
  private async exigirLicitacao(id: string) {
    const pasta = await this.prisma.pastaRh.findUnique({
      where: { id },
      select: { id: true, nome: true, paiId: true },
    });
    if (!pasta) throw new BadRequestException('Esta licitação não existe mais.');

    const raizId = await this.raiz();
    if (!raizId || pasta.paiId !== raizId) {
      throw new BadRequestException(
        `"${pasta.nome}" não é uma pasta de licitação.`,
      );
    }
    return pasta;
  }

  /**
   * A prateleira das licitações. `criando` a abre; sem isso, ausência é
   * resposta — quem nunca abriu licitação nenhuma não precisa da pasta.
   */
  private async raiz(criando = false): Promise<string | null> {
    const existente = await this.prisma.pastaRh.findFirst({
      where: {
        paiId: null,
        nome: { equals: PASTA_DAS_LICITACOES, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) return existente.id;
    if (!criando) return null;

    const criada = await this.prisma.pastaRh.create({
      data: { nome: PASTA_DAS_LICITACOES },
      select: { id: true },
    });
    this.logger.log('Prateleira das licitações criada na estante.');
    return criada.id;
  }
}
