import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A prateleira das notas fiscais na estante.
 *
 * Nasce sozinha no primeiro mês aberto, como a das licitações: uma pasta vazia
 * criada por precaução seria mais uma linha para ninguém abrir.
 */
export const PASTA_DAS_NOTAS = 'Notas Fiscais';

/** Um mês, como a tela o lista. */
export interface MesDeNotas {
  /** A pasta dele — é dela que sai o zip, e é nela que os arquivos entram. */
  id: string;
  /** "AAAA-MM" */
  competencia: string;
  qtd: number;
  /** Quando o último arquivo entrou. Vazio no mês recém-aberto. */
  ultimoEm: Date | null;
}

/**
 * As notas fiscais de entrada — o que a casa comprou no mês.
 *
 * O que isto substitui é uma pasta no computador de alguém. As notas chegam o
 * mês inteiro, por e-mail e no balcão, e no fim do mês vão para a contabilidade
 * virar crédito de imposto. Enquanto o monte mora numa pasta do Windows, ele só
 * existe naquela máquina: quem precisar do que foi mandado em março depende de
 * a pasta ainda estar lá, com o nome que tinha.
 *
 * A área é deliberadamente uma gaveta, e não um cadastro. Um mês é uma pasta,
 * o arquivo arrastado para dentro é um documento, e o zip da pasta é o pacote
 * que sai daqui. Pedir fornecedor, número e valor de cada nota seria noventa
 * campos digitados por mês para responder uma pergunta que a contabilidade já
 * responde — e o que se pode deixar pela metade acaba pela metade, com uma soma
 * que passa a mentir para quem confia nela.
 *
 * Por isso este serviço é pequeno: ele abre o mês e conta o que há dentro. O
 * resto — guardar, ver, apagar, o zip — é a estante que já fazia, e é de
 * propósito que continue sendo a mesma.
 */
@Injectable()
export class NotasFiscaisService {
  private readonly logger = new Logger(NotasFiscaisService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Os meses abertos, do mais novo para o mais velho. */
  async meses(): Promise<MesDeNotas[]> {
    const raizId = await this.raiz();
    if (!raizId) return [];

    const pastas = await this.prisma.pastaRh.findMany({
      where: { paiId: raizId },
      select: { id: true, nome: true },
    });
    if (pastas.length === 0) return [];

    // Só o que a contagem precisa: o arquivo não entra nesta consulta.
    const documentos = await this.prisma.documentoRh.findMany({
      where: { pastaId: { in: pastas.map((p) => p.id) } },
      select: { pastaId: true, createdAt: true },
    });

    return pastas
      .map((p) => {
        const meus = documentos.filter((d) => d.pastaId === p.id);
        const ultimo = meus.reduce<Date | null>(
          (maior, d) => (!maior || d.createdAt > maior ? d.createdAt : maior),
          null,
        );
        return {
          id: p.id,
          competencia: competenciaDoNome(p.nome),
          qtd: meus.length,
          ultimoEm: ultimo,
        };
      })
      .sort((a, b) => b.competencia.localeCompare(a.competencia));
  }

  /**
   * Abre o mês.
   *
   * Aberto e vazio é um estado legítimo: quem abre outubro no dia 1º ainda não
   * tem nota nenhuma de outubro, e é justamente para ter onde soltá-las que ele
   * abriu a pasta.
   */
  async abrirMes(competencia: string, usuarioId?: string): Promise<MesDeNotas> {
    exigirCompetencia(competencia);
    const raizId = await this.raiz(usuarioId ?? null);
    const nome = nomeDoMes(competencia);

    const existente = await this.prisma.pastaRh.findFirst({
      where: { paiId: raizId, nome: { equals: nome, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existente) {
      throw new BadRequestException(
        `O mês de ${competencia} já está aberto — ele está na lista. Os ` +
          'arquivos vão para dentro dele.',
      );
    }

    const pasta = await this.prisma.pastaRh.create({
      data: { nome, paiId: raizId, criadoPor: usuarioId ?? null },
      select: { id: true },
    });

    this.logger.log(`Mês de notas ${competencia} aberto.`);
    return { id: pasta.id, competencia, qtd: 0, ultimoEm: null };
  }

  /**
   * A prateleira das notas.
   *
   * `criador` ausente (`undefined`) = só procura: quem nunca abriu mês nenhum
   * não precisa da pasta na estante, e ausência é resposta. Passando o criador
   * — ainda que `null`, que é o usuário desconhecido —, ela nasce.
   */
  private async raiz(criador?: string | null): Promise<string | null> {
    const existente = await this.prisma.pastaRh.findFirst({
      where: {
        paiId: null,
        nome: { equals: PASTA_DAS_NOTAS, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existente) return existente.id;
    if (criador === undefined) return null;

    const criada = await this.prisma.pastaRh.create({
      data: { nome: PASTA_DAS_NOTAS, criadoPor: criador },
      select: { id: true },
    });
    this.logger.log('Prateleira das notas fiscais criada na estante.');
    return criada.id;
  }
}

/**
 * O nome da pasta de um mês.
 *
 * Ele carrega o assunto por causa do zip: é o zip que sai da casa, e um arquivo
 * chamado "09-2026.zip" chegando na contabilidade não diz do que é. Dentro da
 * estante a repetição custa pouco; no anexo do e-mail ela é a diferença entre
 * saber e ter de perguntar.
 */
export function nomeDoMes(competencia: string): string {
  return `Notas fiscais ${competencia.slice(5)}-${competencia.slice(0, 4)}`;
}

/** O caminho de volta: "Notas fiscais 09-2026" → "2026-09". */
function competenciaDoNome(nome: string): string {
  const m = /(\d{2})-(\d{4})$/.exec(nome.trim());
  // Pasta renomeada à mão pela estante: o nome que sobrou é a resposta, e ela
  // vai para o fim da lista em vez de sumir dela.
  return m ? `${m[2]}-${m[1]}` : nome;
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
