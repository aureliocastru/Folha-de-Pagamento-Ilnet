import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentosRhService } from './documentos.service';
import { NotaFiscalDto } from './dto/documento.dto';

/**
 * A prateleira das notas fiscais na estante.
 *
 * Nasce sozinha na primeira nota, como a das licitações: uma pasta vazia criada
 * por precaução seria mais uma linha para ninguém abrir.
 */
export const PASTA_DAS_NOTAS = 'Notas Fiscais';

/** A prateleira dentro da pasta do mês. É o que a tela de pastas mostra. */
const TIPO_DA_NOTA = 'Nota fiscal';

/** Um mês fechado, como a lista de meses o mostra. */
export interface MesDeNotas {
  /** "AAAA-MM" */
  competencia: string;
  /** A pasta daquele mês — é dela que sai o zip que vai à contabilidade. */
  pastaId: string;
  qtd: number;
  /** A soma do mês, que é o que se confere com a contabilidade. */
  total: string;
  /** Quando a última nota do mês entrou. */
  ultimaEm: Date;
}

/** Uma nota como a tela do mês a lista. */
export interface NotaDaLista {
  id: string;
  documentoId: string;
  competencia: string;
  fornecedor: string;
  numero: string | null;
  valor: string;
  emitidaEm: Date | null;
  arquivoNome: string;
  arquivoTipo: string;
  arquivoTamanho: number;
  criadaEm: Date;
}

/**
 * As notas fiscais de entrada — o que a casa comprou no mês.
 *
 * O que isto substitui é uma pasta no computador de alguém. As notas chegam o
 * mês inteiro, por e-mail e no balcão, e no fim do mês vão para a contabilidade
 * para virar crédito de imposto. Enquanto o monte mora numa pasta do Windows,
 * duas perguntas não têm resposta: **quanto** foi mandado, e se a nota que
 * chegou dia 3 ainda está lá em dezembro, quando o contador pergunta.
 *
 * Por isso a nota não é só o arquivo. O arquivo é um documento da estante, com
 * tudo o que já vem de graça daí — o visualizador, o zip da pasta, o limite de
 * tamanho, quem subiu. O que este serviço acrescenta é o que o PDF não responde
 * sem ser aberto um a um: de quem é, que número tem, quanto deu. É a soma disso
 * que fecha com o contador.
 */
@Injectable()
export class NotasFiscaisService {
  private readonly logger = new Logger(NotasFiscaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentos: DocumentosRhService,
  ) {}

  /** Os meses que já têm nota, do mais novo para o mais velho. */
  async meses(): Promise<MesDeNotas[]> {
    const notas = await this.prisma.notaFiscal.findMany({
      select: {
        competencia: true,
        valor: true,
        createdAt: true,
        documento: { select: { pastaId: true } },
      },
    });

    const porMes = new Map<string, MesDeNotas>();
    for (const n of notas) {
      const atual = porMes.get(n.competencia);
      if (!atual) {
        porMes.set(n.competencia, {
          competencia: n.competencia,
          pastaId: n.documento.pastaId,
          qtd: 1,
          total: n.valor.toFixed(2),
          ultimaEm: n.createdAt,
        });
        continue;
      }
      atual.qtd += 1;
      atual.total = new Prisma.Decimal(atual.total).plus(n.valor).toFixed(2);
      if (n.createdAt > atual.ultimaEm) atual.ultimaEm = n.createdAt;
    }

    return [...porMes.values()].sort((a, b) =>
      b.competencia.localeCompare(a.competencia),
    );
  }

  /** O que entrou num mês, da nota mais recente para a mais antiga. */
  async doMes(competencia: string): Promise<NotaDaLista[]> {
    exigirCompetencia(competencia);

    const notas = await this.prisma.notaFiscal.findMany({
      where: { competencia },
      orderBy: { createdAt: 'desc' },
      select: SEM_O_ARQUIVO,
    });

    return notas.map(paraTela);
  }

  /**
   * Guarda uma nota: o arquivo na pasta do mês, os dados aqui.
   *
   * A pasta do mês nasce na primeira nota daquele mês, e não numa varredura de
   * doze meses feita por precaução — mês sem nota nenhuma não precisa de pasta,
   * e uma estante com doze pastas vazias é pior que uma sem nenhuma.
   */
  async guardar(dto: NotaFiscalDto, usuarioId?: string) {
    exigirCompetencia(dto.competencia);
    // Opcional no DTO porque corrigir não manda arquivo; guardar sem ele seria
    // uma linha de valor sem nota nenhuma atrás.
    if (!dto.arquivo || !dto.arquivoNome) {
      throw new BadRequestException('Escolha o arquivo da nota.');
    }
    const pastaId = await this.pastaDoMes(dto.competencia, usuarioId);

    /*
     * O documento sai daqui **sem** competência de propósito.
     *
     * A competência do documento entra na chave (pasta, tipo, competência), que
     * existe para o recibo de pagamento — do qual há um por pessoa e por mês.
     * Um mês tem muitas notas, e preenchê-la aqui faria a segunda nota de
     * setembro ser recusada por uma trava que não é sobre ela. O mês da nota
     * mora no registro fiscal, e a pasta já o diz por escrito.
     */
    const doc = await this.documentos.guardar(
      {
        pastaId,
        titulo: tituloDaNota(dto),
        tipo: TIPO_DA_NOTA,
        descricao: dto.descricao,
        emitidoEm: dto.emitidaEm,
        arquivoNome: dto.arquivoNome,
        arquivo: dto.arquivo,
      },
      usuarioId,
    );

    const nota = await this.prisma.notaFiscal.create({
      data: {
        documentoId: doc.id,
        competencia: dto.competencia,
        fornecedor: dto.fornecedor.trim(),
        numero: dto.numero?.trim() || null,
        valor: new Prisma.Decimal(dto.valor),
        criadoPor: usuarioId ?? null,
      },
    });

    this.logger.log(
      `Nota de ${nota.fornecedor} (R$ ${nota.valor.toFixed(2)}) guardada em ` +
        `${dto.competencia}.`,
    );
    return this.uma(nota.id);
  }

  /**
   * Corrige os dados de uma nota. O arquivo, não: esse se apaga e se sobe.
   *
   * Mudar o mês move o papel junto — a nota lançada em agosto que era de julho
   * tem de sair da pasta de agosto, senão o zip de agosto continua levando à
   * contabilidade uma nota que não é daquele mês.
   */
  async editar(id: string, dto: NotaFiscalDto, usuarioId?: string) {
    exigirCompetencia(dto.competencia);
    const atual = await this.exigirNota(id);

    const mudouDeMes = atual.competencia !== dto.competencia;
    const pastaId = mudouDeMes
      ? await this.pastaDoMes(dto.competencia, usuarioId)
      : undefined;

    await this.prisma.documentoRh.update({
      where: { id: atual.documentoId },
      data: {
        titulo: tituloDaNota(dto),
        descricao: dto.descricao?.trim() || null,
        emitidoEm: dto.emitidaEm ? new Date(`${dto.emitidaEm}T00:00:00Z`) : null,
        ...(pastaId ? { pastaId } : {}),
      },
    });

    await this.prisma.notaFiscal.update({
      where: { id },
      data: {
        competencia: dto.competencia,
        fornecedor: dto.fornecedor.trim(),
        numero: dto.numero?.trim() || null,
        valor: new Prisma.Decimal(dto.valor),
      },
    });

    return this.uma(id);
  }

  /**
   * Tira a nota da estante — o papel junto.
   *
   * Apagar só o registro deixaria o arquivo numa pasta que a tela de notas não
   * lista mais: ele continuaria indo no zip do mês, para a contabilidade, sem
   * aparecer em soma nenhuma. O `Cascade` do banco faz o caminho inverso valer
   * também, quando alguém apaga o documento pela estante.
   */
  async apagar(id: string) {
    const nota = await this.exigirNota(id);
    await this.documentos.apagar(nota.documentoId);
    this.logger.log(`Nota de ${nota.fornecedor} apagada de ${nota.competencia}.`);
    return { ok: true };
  }

  /** Uma nota como a tela a mostra. */
  private async uma(id: string): Promise<NotaDaLista> {
    const nota = await this.prisma.notaFiscal.findUnique({
      where: { id },
      select: SEM_O_ARQUIVO,
    });
    if (!nota) throw new BadRequestException('Esta nota não existe mais.');
    return paraTela(nota);
  }

  private async exigirNota(id: string) {
    const nota = await this.prisma.notaFiscal.findUnique({ where: { id } });
    if (!nota) throw new BadRequestException('Esta nota não existe mais.');
    return nota;
  }

  /**
   * A pasta daquele mês, criada na primeira nota dele.
   *
   * O nome carrega "Notas fiscais" por causa do zip: é ele que sai da casa, e
   * um arquivo chamado "09-2026.zip" chegando na contabilidade não diz do que
   * é. Dentro da estante a repetição custa pouco; no anexo do e-mail ela é a
   * diferença entre saber e perguntar.
   */
  private async pastaDoMes(competencia: string, usuarioId?: string) {
    const raizId = await this.raiz(usuarioId);
    const nome = `Notas fiscais ${competencia.slice(5)}-${competencia.slice(0, 4)}`;

    const existente = await this.prisma.pastaRh.findFirst({
      where: { paiId: raizId, nome: { equals: nome, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existente) return existente.id;

    const criada = await this.prisma.pastaRh.create({
      data: { nome, paiId: raizId, criadoPor: usuarioId ?? null },
      select: { id: true },
    });
    return criada.id;
  }

  /** A prateleira das notas na estante, criada na primeira nota. */
  private async raiz(usuarioId?: string): Promise<string> {
    const existente = await this.prisma.pastaRh.findFirst({
      where: {
        paiId: null,
        nome: { equals: PASTA_DAS_NOTAS, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) return existente.id;

    const criada = await this.prisma.pastaRh.create({
      data: { nome: PASTA_DAS_NOTAS, criadoPor: usuarioId ?? null },
      select: { id: true },
    });
    this.logger.log('Prateleira das notas fiscais criada na estante.');
    return criada.id;
  }
}

/**
 * O nome com que a nota aparece na estante.
 *
 * Quem abre a pasta pela tela de documentos vê "NF 1234 — Fulano Materiais", e
 * não "documento.pdf": a estante é a mesma para todo papel da casa, e o nome é
 * a única coisa que ela mostra antes de alguém abrir o arquivo.
 */
function tituloDaNota(dto: NotaFiscalDto): string {
  const numero = dto.numero?.trim();
  const fornecedor = dto.fornecedor.trim();
  return numero ? `NF ${numero} — ${fornecedor}` : `NF — ${fornecedor}`;
}

function exigirCompetencia(competencia: string): void {
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new BadRequestException('O mês precisa estar no formato AAAA-MM.');
  }
  const mes = Number(competencia.slice(5));
  if (mes < 1 || mes > 12) {
    throw new BadRequestException(`Não existe o mês ${competencia.slice(5)}.`);
  }
}

/**
 * Tudo menos a coluna do conteúdo.
 *
 * O arquivo nunca entra numa listagem: são megabytes cada, e um mês de compras
 * tem dezenas de notas.
 */
const SEM_O_ARQUIVO = {
  id: true,
  documentoId: true,
  competencia: true,
  fornecedor: true,
  numero: true,
  valor: true,
  createdAt: true,
  documento: {
    select: {
      emitidoEm: true,
      arquivoNome: true,
      arquivoTipo: true,
      arquivoTamanho: true,
    },
  },
} as const;

/** A linha do banco como a tela a lê: o decimal vira string de duas casas. */
function paraTela(n: {
  id: string;
  documentoId: string;
  competencia: string;
  fornecedor: string;
  numero: string | null;
  valor: Prisma.Decimal;
  createdAt: Date;
  documento: {
    emitidoEm: Date | null;
    arquivoNome: string;
    arquivoTipo: string;
    arquivoTamanho: number;
  };
}): NotaDaLista {
  return {
    id: n.id,
    documentoId: n.documentoId,
    competencia: n.competencia,
    fornecedor: n.fornecedor,
    numero: n.numero,
    valor: n.valor.toFixed(2),
    emitidaEm: n.documento.emitidoEm,
    arquivoNome: n.documento.arquivoNome,
    arquivoTipo: n.documento.arquivoTipo,
    arquivoTamanho: n.documento.arquivoTamanho,
    criadaEm: n.createdAt,
  };
}
