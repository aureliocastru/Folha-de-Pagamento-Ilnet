import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  conferirArquivo as conferir,
  emMegabytes,
  lerDataUrl as lerArquivo,
} from '../arquivos/data-url';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EditarDocumentoDto,
  GuardarDocumentoDto,
  PastaDto,
} from './dto/documento.dto';

/**
 * O que pode entrar na pasta, por tipo declarado no arquivo.
 *
 * Lista fechada. Não é paranoia de segurança — é o que impede a pasta de
 * documentos de virar um depósito de qualquer coisa: o que se guarda aqui é
 * papel (PDF, digitalização, foto) e planilha, e o que chega diferente disso
 * quase sempre é engano de quem escolheu o arquivo.
 */
const TIPOS_ACEITOS = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

/**
 * Teto por arquivo.
 *
 * Combina com o `LIMITE_CORPO` do `main.ts` e com o `client_max_body_size` do
 * nginx: em base64 o arquivo engorda um terço no caminho, e é o corpo inteiro
 * que aqueles dois medem. Mexer aqui sem mexer lá dá um 413 cru, sem frase
 * nenhuma para quem está subindo.
 */
export const LIMITE_BYTES = 15 * 1024 * 1024;

/** Documento que vence dentro disto está "a vencer" na tela. */
const DIAS_DE_AVISO = 30;

/** Quantos níveis de pasta dentro de pasta. Ver `exigirEspacoNaArvore`. */
const NIVEIS = 3;

/**
 * A estante de documentos.
 *
 * Cada pasta é de alguém — um funcionário, ou a própria empresa —, e o que
 * entra nela é papel: contrato, exame, advertência, o recibo de pagamento do
 * mês. O arquivo mora no banco (ver o comentário do modelo) e nunca sai numa
 * listagem: são megabytes cada, e a tela mostra dezenas de linhas de uma vez.
 * Quem quer o arquivo pede aquele arquivo.
 */
@Injectable()
export class DocumentosRhService {
  private readonly logger = new Logger(DocumentosRhService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A estante inteira, com o que há em cada pasta.
   *
   * Quem saiu continua aqui. A pasta de quem foi demitido é justamente a que se
   * abre depois — rescisão, homologação, o processo que aparece dois anos
   * adiante —, e escondê-la faria procurar no lugar em que ela não está.
   */
  async pastas() {
    await this.garantirPastas();

    const [pastas, documentos] = await Promise.all([
      this.prisma.pastaRh.findMany({
        include: {
          funcionario: {
            select: {
              nome: true,
              apelido: true,
              funcao: true,
              ativo: true,
            },
          },
          _count: { select: { subpastas: true } },
        },
      }),
      // Só o que a contagem precisa: o arquivo em si não entra nesta consulta.
      this.prisma.documentoRh.findMany({
        select: { pastaId: true, valeAte: true, createdAt: true },
      }),
    ]);

    const resumos = new Map<string, ResumoDaPasta>();
    for (const d of documentos) {
      const atual = resumos.get(d.pastaId) ?? vazio();
      atual.qtd += 1;
      if (!atual.ultimoEm || d.createdAt > atual.ultimoEm) {
        atual.ultimoEm = d.createdAt;
      }
      const prazo = situacaoDoPrazo(d.valeAte);
      if (prazo === 'vencido') atual.vencidos += 1;
      if (prazo === 'a-vencer') atual.aVencer += 1;
      resumos.set(d.pastaId, atual);
    }

    /*
     * O que está nas subpastas conta na pasta de cima.
     *
     * O cartão da estante responde "quanto papel tem o Fulano?", e a resposta
     * não muda porque alguém organizou os exames numa subpasta. Dentro dela, o
     * número de cada linha continua sendo o dela: os dois existem, e cada um
     * responde a uma pergunta diferente.
     */
    const naArvore = new Map<string, ResumoDaPasta>();
    for (const p of pastas) {
      const meu = resumos.get(p.id) ?? vazio();
      let atual: string | null = p.id;
      while (atual) {
        const soma = naArvore.get(atual) ?? vazio();
        soma.qtd += meu.qtd;
        soma.vencidos += meu.vencidos;
        soma.aVencer += meu.aVencer;
        if (meu.ultimoEm && (!soma.ultimoEm || meu.ultimoEm > soma.ultimoEm)) {
          soma.ultimoEm = meu.ultimoEm;
        }
        naArvore.set(atual, soma);
        atual = paiDe(pastas, atual);
      }
    }

    const comResumo = pastas.map((p) => ({
      id: p.id,
      // O cadastro manda no nome: quem trocou de sobrenome no IXC não pode
      // ficar com o nome antigo na estante.
      nome: p.funcionario?.nome ?? p.nome,
      apelido: p.funcionario?.apelido ?? null,
      funcao: p.funcionario?.funcao ?? null,
      daEmpresa: p.daEmpresa,
      funcionarioId: p.funcionarioId,
      cpf: p.cpf,
      /** Vazio = pasta de primeiro nível, a que aparece na estante. */
      paiId: p.paiId,
      /** Quantas pastas ela tem dentro. */
      subpastas: p._count.subpastas,
      /** Pasta de quem já saiu da empresa. */
      inativo: p.funcionario ? !p.funcionario.ativo : false,
      /** Pasta que não veio do cadastro: só ela se renomeia e se apaga. */
      avulsa: !p.funcionarioId && !p.daEmpresa,
      ...(resumos.get(p.id) ?? vazio()),
      /** O mesmo, contando o que está nas subpastas. */
      naArvore: naArvore.get(p.id) ?? vazio(),
    }));

    return {
      pastas: comResumo.sort(porNome),
      /** Os tipos já usados, para a tela sugerir em vez de perguntar. */
      tipos: await this.tipos(),
    };
  }

  /**
   * Garante que toda pasta que deveria existir existe.
   *
   * A da empresa e a de cada funcionário nascem sozinhas: uma estante que só
   * ganha pasta depois do primeiro documento obrigaria a criar a pasta do
   * Fulano antes de guardar o contrato dele. Roda na abertura da tela; não
   * achando nada faltando, não escreve nada.
   */
  private async garantirPastas() {
    const [pastas, funcionarios] = await Promise.all([
      this.prisma.pastaRh.findMany({
        select: { funcionarioId: true, daEmpresa: true },
      }),
      this.prisma.funcionario.findMany({
        where: { isentoIcms: true },
        select: { id: true, nome: true, cpfCnpj: true },
      }),
    ]);

    if (!pastas.some((p) => p.daEmpresa)) {
      await this.prisma.pastaRh.create({
        data: { nome: 'Empresa', daEmpresa: true },
      });
    }

    const jaTem = new Set(pastas.map((p) => p.funcionarioId));
    const faltando = funcionarios
      .filter((f) => !jaTem.has(f.id))
      .map((f) => ({
        nome: f.nome,
        funcionarioId: f.id,
        cpf: soDigitos(f.cpfCnpj) || null,
      }));

    if (faltando.length > 0) {
      await this.prisma.pastaRh.createMany({
        data: faltando,
        skipDuplicates: true,
      });
      this.logger.log(`${faltando.length} pasta(s) de funcionário criadas.`);
    }
  }

  /**
   * Uma pasta criada à mão — na estante ou dentro de outra.
   *
   * Na estante ela é de quem não está no cadastro: o sócio, o estagiário, quem
   * saiu antes de o sistema existir. Dentro de outra, é a divisória da gaveta:
   * "Exames" dentro do Fulano, "2026" dentro de "Recibos de pagamento".
   */
  async criarPasta(dto: PastaDto, usuarioId?: string) {
    const nome = dto.nome.trim();
    const cpf = soDigitos(dto.cpf) || null;
    const paiId = dto.paiId ?? null;

    if (paiId) await this.exigirEspacoNaArvore(paiId);

    /*
     * O nome só briga com os irmãos.
     *
     * Duas pastas "Exames" na estante seriam confusão; uma dentro de cada
     * funcionário é o desenho normal de uma gaveta. Na estante o CPF também
     * conta: duas pastas da mesma pessoa é como metade dos documentos some —
     * eles ficam na outra.
     */
    const igual = await this.prisma.pastaRh.findFirst({
      where: {
        paiId,
        ...(cpf && !paiId
          ? { OR: [{ cpf }, { nome: { equals: nome, mode: 'insensitive' } }] }
          : { nome: { equals: nome, mode: 'insensitive' } }),
      },
      select: { id: true, nome: true },
    });
    if (igual) {
      throw new BadRequestException(
        paiId
          ? `Esta pasta já tem uma "${igual.nome}" dentro dela.`
          : `Já existe a pasta "${igual.nome}". Duas pastas da mesma pessoa é ` +
            'como metade dos documentos some: eles ficam na outra.',
      );
    }

    return this.prisma.pastaRh.create({
      data: { nome, cpf, paiId, criadoPor: usuarioId ?? null },
    });
  }

  /**
   * Garante que existe uma subpasta com este nome dentro daquela.
   *
   * É o que põe o recibo do mês em "Fulano / Recibos de pagamento" sem pedir
   * nada a ninguém: a divisória nasce no primeiro recibo e é reusada em todos
   * os meses seguintes.
   */
  async garantirSubpasta(paiId: string, nome: string): Promise<string> {
    const existente = await this.prisma.pastaRh.findFirst({
      where: { paiId, nome: { equals: nome, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existente) return existente.id;

    const criada = await this.prisma.pastaRh.create({
      data: { nome, paiId },
      select: { id: true },
    });
    return criada.id;
  }

  /**
   * Até onde a árvore pode ir.
   *
   * Três níveis dão "Fulano / Recibos de pagamento / 2026", que é mais fundo do
   * que uma gaveta de RH costuma precisar. Sem teto, a estante vira um labirinto
   * que ninguém percorre até o fim para achar um papel.
   */
  private async exigirEspacoNaArvore(paiId: string) {
    let nivel = 1;
    let atual: string | null = paiId;
    while (atual) {
      const pasta: { paiId: string | null } | null =
        await this.prisma.pastaRh.findUnique({
          where: { id: atual },
          select: { paiId: true },
        });
      if (!pasta) throw new BadRequestException('Esta pasta não existe mais.');
      nivel += 1;
      if (nivel > NIVEIS) {
        throw new BadRequestException(
          `Dá para aninhar até ${NIVEIS} níveis de pasta. Mais fundo que ` +
            'isso, ninguém acha o papel.',
        );
      }
      atual = pasta.paiId;
    }
  }

  /**
   * Renomeia uma pasta avulsa.
   *
   * A de funcionário não: o nome dela é o do cadastro, e um nome escrito aqui
   * sumiria na primeira sincronização, sem ninguém entender por quê.
   */
  async renomearPasta(id: string, dto: PastaDto) {
    const pasta = await this.exigirPasta(id);
    if (pasta.funcionarioId || pasta.daEmpresa) {
      throw new BadRequestException(
        'Esta pasta é do cadastro; o nome dela vem de lá. Renomeie o ' +
          'funcionário no IXC e a estante acompanha.',
      );
    }
    return this.prisma.pastaRh.update({
      where: { id },
      data: { nome: dto.nome.trim(), cpf: soDigitos(dto.cpf) || null },
    });
  }

  /** Apaga uma pasta avulsa e vazia. */
  async apagarPasta(id: string) {
    const pasta = await this.exigirPasta(id);
    if (pasta.funcionarioId || pasta.daEmpresa) {
      throw new BadRequestException(
        'Esta pasta é do cadastro e não se apaga por aqui.',
      );
    }
    const [dentro, subpastas] = await Promise.all([
      this.prisma.documentoRh.count({ where: { pastaId: id } }),
      this.prisma.pastaRh.count({ where: { paiId: id } }),
    ]);
    if (dentro > 0) {
      throw new BadRequestException(
        `A pasta tem ${dentro} documento(s) dentro. Apague-os primeiro — ou ` +
          'deixe a pasta onde está, que ela não atrapalha ninguém.',
      );
    }
    if (subpastas > 0) {
      throw new BadRequestException(
        `A pasta tem ${subpastas} subpasta(s) dentro. Apague-as primeiro.`,
      );
    }
    await this.prisma.pastaRh.delete({ where: { id } });
    return { apagada: true };
  }

  /** Os documentos de uma pasta, sem os arquivos. */
  async listar(pastaId: string, termo?: string) {
    const busca = termo?.trim();

    const documentos = await this.prisma.documentoRh.findMany({
      where: {
        pastaId,
        ...(busca
          ? {
              OR: [
                { titulo: { contains: busca, mode: 'insensitive' as const } },
                { tipo: { contains: busca, mode: 'insensitive' as const } },
                { descricao: { contains: busca, mode: 'insensitive' as const } },
                {
                  arquivoNome: { contains: busca, mode: 'insensitive' as const },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ tipo: 'asc' }, { emitidoEm: 'desc' }, { createdAt: 'desc' }],
      select: SEM_O_ARQUIVO,
    });

    return documentos.map(paraTela);
  }

  /**
   * Um documento com o arquivo, para servir ao navegador.
   *
   * É a única consulta que lê a coluna do conteúdo, e ela lê uma linha só.
   */
  async arquivo(id: string) {
    const doc = await this.prisma.documentoRh.findUnique({
      where: { id },
      select: {
        arquivo: true,
        arquivoNome: true,
        arquivoTipo: true,
        titulo: true,
      },
    });
    if (!doc) throw new BadRequestException('Este documento não existe mais.');
    return doc;
  }

  /** Guarda um documento novo. */
  async guardar(dto: GuardarDocumentoDto, usuarioId?: string) {
    const { conteudo, tipoDoArquivo } = lerDataUrl(dto.arquivo);
    conferirArquivo(conteudo, tipoDoArquivo);
    await this.exigirPasta(dto.pastaId);

    const doc = await this.prisma.documentoRh.create({
      data: {
        pastaId: dto.pastaId,
        titulo: dto.titulo.trim(),
        tipo: dto.tipo.trim(),
        descricao: dto.descricao?.trim() || null,
        emitidoEm: diaOuNulo(dto.emitidoEm),
        valeAte: diaOuNulo(dto.valeAte),
        arquivoNome: dto.arquivoNome.trim(),
        arquivoTipo: tipoDoArquivo,
        arquivoTamanho: conteudo.length,
        // `Uint8Array` e não `Buffer`: o tipo que o Prisma 6 espera na coluna
        // `Bytes` é o da web, e o Buffer do Node não se encaixa nele desde as
        // tipagens do Node 22. Mesma memória, sem cópia.
        arquivo: new Uint8Array(conteudo),
        criadoPor: usuarioId ?? null,
      },
      select: SEM_O_ARQUIVO,
    });

    this.logger.log(
      `Documento "${doc.titulo}" (${doc.tipo}, ` +
        `${emMegabytes(doc.arquivoTamanho)}) guardado na pasta ${doc.pastaId}.`,
    );
    return paraTela(doc);
  }

  /**
   * Corrige o que está escrito sobre o documento. O arquivo, não.
   *
   * Trocar o conteúdo por baixo do mesmo título é como um documento vira outro
   * sem ninguém perceber. Errou o arquivo: apaga e sobe de novo.
   */
  async editar(id: string, dto: EditarDocumentoDto) {
    await this.exigirDocumento(id);
    // Mudar de pasta é o único jeito de pôr numa subpasta nova o que já estava
    // guardado. O arquivo vai junto: é o mesmo documento, noutra divisória.
    if (dto.pastaId) await this.exigirPasta(dto.pastaId);

    const doc = await this.prisma.documentoRh.update({
      where: { id },
      data: {
        ...(dto.pastaId ? { pastaId: dto.pastaId } : {}),
        titulo: dto.titulo.trim(),
        tipo: dto.tipo.trim(),
        descricao: dto.descricao?.trim() || null,
        emitidoEm: diaOuNulo(dto.emitidoEm),
        valeAte: diaOuNulo(dto.valeAte),
      },
      select: SEM_O_ARQUIVO,
    });
    return paraTela(doc);
  }

  async apagar(id: string) {
    const doc = await this.exigirDocumento(id);
    await this.prisma.documentoRh.delete({ where: { id } });
    this.logger.log(`Documento "${doc.titulo}" apagado da pasta.`);
    return { apagado: true };
  }

  /** Os tipos que já existem, do mais usado para o menos. */
  async tipos(): Promise<string[]> {
    const grupos = await this.prisma.documentoRh.groupBy({
      by: ['tipo'],
      _count: { _all: true },
      orderBy: { _count: { tipo: 'desc' } },
      take: 40,
    });
    return grupos.map((g) => g.tipo);
  }

  private async exigirDocumento(id: string) {
    const doc = await this.prisma.documentoRh.findUnique({
      where: { id },
      select: { id: true, titulo: true },
    });
    if (!doc) throw new BadRequestException('Este documento não existe mais.');
    return doc;
  }

  private async exigirPasta(id: string) {
    const pasta = await this.prisma.pastaRh.findUnique({ where: { id } });
    if (!pasta) throw new BadRequestException('Esta pasta não existe mais.');
    return pasta;
  }
}

/** Recusa o que não é papel, e o que é papel demais. */
export function conferirArquivo(conteudo: Buffer, tipo: string): void {
  conferir(
    { conteudo, tipo },
    TIPOS_ACEITOS,
    LIMITE_BYTES,
    'Aqui entram PDF, imagem, documento do Word, planilha e texto.',
  );
}

/** Tudo menos a coluna do conteúdo. */
const SEM_O_ARQUIVO = {
  id: true,
  pastaId: true,
  titulo: true,
  tipo: true,
  descricao: true,
  competencia: true,
  emitidoEm: true,
  valeAte: true,
  arquivoNome: true,
  arquivoTipo: true,
  arquivoTamanho: true,
  criadoPor: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ResumoDaPasta {
  qtd: number;
  vencidos: number;
  aVencer: number;
  ultimoEm: Date | null;
}

function vazio(): ResumoDaPasta {
  return { qtd: 0, vencidos: 0, aVencer: 0, ultimoEm: null };
}

/** O pai de uma pasta, na lista que já veio do banco. */
function paiDe(
  pastas: Array<{ id: string; paiId: string | null }>,
  id: string,
): string | null {
  return pastas.find((p) => p.id === id)?.paiId ?? null;
}

/** A empresa primeiro; depois a gente, em ordem alfabética. */
function porNome(
  a: { daEmpresa: boolean; nome: string },
  b: { daEmpresa: boolean; nome: string },
): number {
  if (a.daEmpresa !== b.daEmpresa) return a.daEmpresa ? -1 : 1;
  return a.nome.localeCompare(b.nome, 'pt-BR');
}

/**
 * O documento como a tela o usa.
 *
 * As datas de calendário saem como texto, e não como instante: um `Date`
 * serializado vira "2026-08-03T00:00:00.000Z", e o navegador em Brasília relê
 * isso como o dia 2. Data impressa em papel não tem hora nem fuso.
 */
// Genérica de propósito: com a assinatura anterior (um índice `[k: string]:
// unknown`) o tipo de volta perdia todos os campos do documento — quem chamasse
// isto de outro arquivo não enxergava nem o `id`. Aqui o que entra é o que sai,
// menos as duas datas, que viram dia ISO.
function paraTela<T extends { emitidoEm: Date | null; valeAte: Date | null }>(
  d: T,
) {
  return {
    ...d,
    emitidoEm: d.emitidoEm ? diaISO(d.emitidoEm) : null,
    valeAte: d.valeAte ? diaISO(d.valeAte) : null,
    prazo: situacaoDoPrazo(d.valeAte),
  };
}

/** Onde este documento está no prazo dele. */
export type SituacaoDoPrazo = 'sem-prazo' | 'vencido' | 'a-vencer' | 'em-dia';

export function situacaoDoPrazo(
  valeAte: Date | null,
  hoje = new Date(),
): SituacaoDoPrazo {
  if (!valeAte) return 'sem-prazo';
  /*
   * A validade é dia de calendário e vem guardada à meia-noite UTC; "hoje" é um
   * instante, e o dia dele é o de quem está olhando a tela. Lidos os dois pelo
   * mesmo relógio, um documento que vence hoje apareceria vencido às nove da
   * noite em Brasília — quando ainda vale.
   */
  const dias = Math.round((diaDoUtc(valeAte) - diaDaqui(hoje)) / 86_400_000);
  if (dias < 0) return 'vencido';
  if (dias <= DIAS_DE_AVISO) return 'a-vencer';
  return 'em-dia';
}

/** O conteúdo e o tipo de uma data URL, no formato que este módulo usa. */
export function lerDataUrl(url: string): {
  conteudo: Buffer;
  tipoDoArquivo: string;
} {
  const arquivo = lerArquivo(url);
  return { conteudo: arquivo.conteudo, tipoDoArquivo: arquivo.tipo };
}

/** Só os dígitos de um CPF/CNPJ — é assim que ele se compara. */
export function soDigitos(valor?: string | null): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** "AAAA-MM-DD" para o dia à meia-noite UTC, que é como a coluna DATE guarda. */
function diaOuNulo(dia?: string): Date | null {
  if (!dia) return null;
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function diaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** O dia de uma data guardada como calendário (meia-noite UTC). */
function diaDoUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** O dia de um instante, no relógio de quem está olhando. */
function diaDaqui(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

