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
  SubstituirDocumentoDto,
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

/**
 * O fundo da árvore — um limite de segurança, e não uma regra de organização.
 *
 * Aqui havia um teto de três níveis, com o argumento de que mais fundo do que
 * isso ninguém acha o papel. O argumento estava errado sobre esta casa: a pasta
 * da empresa sozinha já pede "Empresa / M A CASTRO / Balanços / 2024", e quem
 * guarda o papel é quem sabe como ele se procura depois. O teto não organizava
 * nada — só recusava a quarta pasta com uma frase que soava a explicação.
 *
 * O que sobrou é o que ele deveria ter sido desde o começo: um número grande o
 * bastante para nunca aparecer no caminho de ninguém, e finito o bastante para
 * que um `paiId` em círculo — que só um bug criaria — trave numa consulta a
 * mais em vez de num laço infinito.
 */
const NIVEIS = 20;

/**
 * A gaveta do papel que foi trocado.
 *
 * Nasce sozinha na primeira substituição feita naquela pasta, do mesmo jeito
 * que "Recibos de pagamento" nasce no primeiro recibo. Fica dentro da pasta em
 * que o documento estava — a certidão velha da empresa interessa a quem abre a
 * pasta da empresa, e não a um arquivo morto do sistema inteiro.
 */
export const PASTA_DOS_SUBSTITUIDOS = 'Substituídos';

/**
 * Até onde a árvore pode ir de verdade.
 *
 * `NIVEIS` é o teto de quem cria pasta à mão. A gaveta dos substituídos nasce
 * do sistema e pode cair um degrau abaixo dele — "Empresa / M A CASTRO /
 * Certidões" já ocupa os três, e o papel trocado tem de ir para algum lugar.
 * É por este número que a árvore se percorre; pelo outro, que ela se cria.
 */
const NIVEIS_NA_ARVORE = NIVEIS + 1;

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
      // O mesmo teto de segurança da criação: sem ele, um `paiId` em círculo
      // travaria a estante inteira em vez de desenhar uma pasta errada.
      for (let passo = 0; atual && passo <= NIVEIS; passo += 1) {
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
      nome: p.nomeManual ? p.nome : (p.funcionario?.nome ?? p.nome),
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
      /** Pasta que não veio do cadastro: RH também a renomeia e a apaga. */
      avulsa: !p.funcionarioId && !p.daEmpresa,
      /** O nome foi escrito à mão e o cadastro deixou de mandar nele. */
      nomeManual: p.nomeManual,
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
    await this.exigirNomeLivre(nome, cpf, paiId);

    return this.prisma.pastaRh.create({
      data: { nome, cpf, paiId, criadoPor: usuarioId ?? null },
    });
  }

  /**
   * O nome só briga com os irmãos.
   *
   * Duas pastas "Exames" na estante seriam confusão; uma dentro de cada
   * funcionário é o desenho normal de uma gaveta. Na estante o CPF também
   * conta: duas pastas da mesma pessoa é como metade dos documentos some —
   * eles ficam na outra.
   *
   * Vale para quem cria e para quem renomeia, inclusive o administrador: a
   * regra não é de permissão, é do que acontece com o papel depois.
   */
  private async exigirNomeLivre(
    nome: string,
    cpf: string | null,
    paiId: string | null,
    /** A própria pasta, quando é ela que está sendo renomeada. */
    exceto?: string,
  ) {
    const igual = await this.prisma.pastaRh.findFirst({
      where: {
        paiId,
        ...(exceto ? { id: { not: exceto } } : {}),
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
   * Trava de segurança da árvore.
   *
   * Não é regra de organização: quem guarda o papel decide como ele se procura
   * depois. É só o fundo em que um `paiId` em círculo pararia de andar.
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
          `Esta pasta já está ${NIVEIS} níveis abaixo da estante. Mais fundo ` +
            'que isso o sistema não sabe percorrer.',
        );
      }
      atual = pasta.paiId;
    }
  }

  /**
   * Renomeia uma pasta.
   *
   * A avulsa, qualquer um do RH renomeia — ela não tem cadastro atrás. A de
   * funcionário e a da empresa seguem o nome do cadastro, e um nome escrito
   * aqui sumiria na primeira sincronização sem ninguém entender por quê: só o
   * administrador as renomeia, e a pasta fica marcada como escrita à mão para
   * o nome não sumir depois. O do cadastro continua guardado no funcionário, e
   * `seguirCadastro` devolve a pasta a ele.
   */
  async renomearPasta(id: string, dto: PastaDto, ehAdmin = false) {
    const pasta = await this.exigirPasta(id);
    const doCadastro = !!pasta.funcionarioId || pasta.daEmpresa;

    if (doCadastro && !ehAdmin) {
      throw new BadRequestException(
        'Esta pasta é do cadastro; o nome dela vem de lá. Renomeie o ' +
          'funcionário no IXC e a estante acompanha — ou peça a um ' +
          'administrador, que pode escrever o nome à mão aqui.',
      );
    }

    // Voltar a seguir o cadastro. O que está escrito em `nome` fica onde está:
    // ninguém mais o lê, e ele é o registro do que a pasta já se chamou.
    if (doCadastro && dto.seguirCadastro) {
      const volta = await this.prisma.pastaRh.update({
        where: { id },
        data: { nomeManual: false },
      });
      this.logger.log(`Pasta ${id} voltou a seguir o nome do cadastro.`);
      return volta;
    }

    const nome = dto.nome.trim();
    const cpf = soDigitos(dto.cpf) || null;
    await this.exigirNomeLivre(nome, cpf, pasta.paiId, id);

    return this.prisma.pastaRh.update({
      where: { id },
      data: {
        nome,
        cpf,
        // Só a pasta que seguia o cadastro tem o que desobedecer; a avulsa
        // nunca seguiu ninguém, e marcá-la não diria nada.
        ...(doCadastro ? { nomeManual: true } : {}),
      },
    });
  }

  /**
   * Apaga uma pasta.
   *
   * Para o RH, só a avulsa e vazia: apagar uma pasta cheia por engano é perder
   * o contrato de alguém, e a mensagem que recusa vale mais que o clique que
   * ela custa. O administrador não tem essa trava — ele apaga o que há dentro
   * junto, subpastas inclusive, e é por isso que a tela dele conta antes
   * quantos papéis vão embora.
   *
   * A pasta do cadastro apagada volta vazia na próxima abertura da estante: o
   * funcionário continua lá, e é dele que a pasta nasce. Quem apaga precisa
   * saber disso antes, e por isso a resposta diz.
   */
  async apagarPasta(id: string, ehAdmin = false) {
    const pasta = await this.exigirPasta(id);
    const doCadastro = !!pasta.funcionarioId || pasta.daEmpresa;

    if (doCadastro && !ehAdmin) {
      throw new BadRequestException(
        'Esta pasta é do cadastro e não se apaga por aqui. Um administrador ' +
          'pode, mas ela volta vazia enquanto o funcionário existir.',
      );
    }

    const alvo = await this.deDentroParaFora(id);
    const documentos = await this.prisma.documentoRh.count({
      where: { pastaId: { in: alvo } },
    });
    const subpastas = alvo.length - 1;

    if (!ehAdmin) {
      if (documentos > 0) {
        throw new BadRequestException(
          `A pasta tem ${documentos} documento(s) dentro. Apague-os primeiro ` +
            '— ou deixe a pasta onde está, que ela não atrapalha ninguém.',
        );
      }
      if (subpastas > 0) {
        throw new BadRequestException(
          `A pasta tem ${subpastas} subpasta(s) dentro. Apague-as primeiro.`,
        );
      }
    }

    /*
     * De dentro para fora, e numa transação.
     *
     * O `RESTRICT` do banco recusa apagar a pasta de cima antes do que há
     * nela — é ele que impede um documento de ficar órfão —, então a ordem não
     * é detalhe de implementação: é a única em que o banco aceita. E ou some a
     * árvore inteira, ou não some nada: pela metade sobra uma subpasta sem pai,
     * que não aparece em tela nenhuma.
     */
    await this.prisma.$transaction(async (tx) => {
      await tx.documentoRh.deleteMany({ where: { pastaId: { in: alvo } } });
      for (const pastaId of alvo) {
        await tx.pastaRh.delete({ where: { id: pastaId } });
      }
    });

    this.logger.warn(
      `Pasta "${pasta.nome}" apagada com ${documentos} documento(s) e ` +
        `${subpastas} subpasta(s).`,
    );
    return {
      apagada: true,
      documentos,
      subpastas,
      /** Ela renasce do cadastro, vazia, na próxima abertura da estante. */
      voltaDoCadastro: doCadastro,
    };
  }

  /**
   * Esta pasta e tudo que está dentro dela, da mais funda para a mais rasa.
   *
   * É a ordem em que o banco aceita apagá-las. Desce por nível em vez de
   * recursão porque a árvore tem teto (ver `NIVEIS`) e cada nível é uma
   * consulta só, em vez de uma por pasta.
   */
  private async deDentroParaFora(id: string): Promise<string[]> {
    const ordem: string[] = [];
    let nivel = [id];
    for (let i = 0; i < NIVEIS_NA_ARVORE && nivel.length > 0; i += 1) {
      ordem.unshift(...nivel);
      const filhas = await this.prisma.pastaRh.findMany({
        where: { paiId: { in: nivel } },
        select: { id: true },
      });
      nivel = filhas.map((f) => f.id);
    }
    return ordem;
  }

  /**
   * Esta pasta e as de dentro dela, menos a gaveta do papel trocado.
   *
   * Serve a quem precisa ver tudo que uma pasta tem sem abrir divisória por
   * divisória — montar a pasta de uma licitação, por exemplo. Os substituídos
   * ficam de fora de propósito: eles são a prova do que já valeu, e listá-los
   * junto seria oferecer a certidão velha ao lado da nova, com o mesmo título.
   */
  private async arvoreUtil(id: string): Promise<string[]> {
    const todas = [id];
    let nivel = [id];
    for (let i = 0; i < NIVEIS_NA_ARVORE && nivel.length > 0; i += 1) {
      const filhas = await this.prisma.pastaRh.findMany({
        where: {
          paiId: { in: nivel },
          NOT: {
            nome: { equals: PASTA_DOS_SUBSTITUIDOS, mode: 'insensitive' },
          },
        },
        select: { id: true },
      });
      nivel = filhas.map((f) => f.id);
      todas.push(...nivel);
    }
    return todas;
  }

  /** Os documentos de uma pasta, sem os arquivos. */
  async listar(pastaId: string, termo?: string, comSubpastas = false) {
    const busca = termo?.trim();
    const pastas = comSubpastas ? await this.arvoreUtil(pastaId) : null;

    const documentos = await this.prisma.documentoRh.findMany({
      where: {
        ...(pastas ? { pastaId: { in: pastas } } : { pastaId }),
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

  /**
   * Troca um documento pelo que veio no lugar dele.
   *
   * É o gesto que a estante não tinha nome para: a certidão venceu, chegou a
   * nova, e as duas não podem ficar lado a lado na mesma gaveta com o mesmo
   * título — quem for pegar "a CND estadual" acha duas e não sabe qual das duas
   * é a que vale. Apagar a velha também não serve: ela é a prova de que a
   * empresa estava regular naquele mês, e é ela que se apresenta quando alguém
   * pergunta do ano passado.
   *
   * Então a velha desce uma gaveta, para "Substituídos", e a nova ocupa o lugar
   * dela. O arquivo antigo não se toca: continua o mesmo documento, com as
   * mesmas datas, noutra divisória.
   */
  async substituir(id: string, dto: SubstituirDocumentoDto, usuarioId?: string) {
    const velho = await this.prisma.documentoRh.findUnique({
      where: { id },
      select: {
        id: true,
        pastaId: true,
        titulo: true,
        pasta: { select: { nome: true } },
      },
    });
    if (!velho) throw new BadRequestException('Este documento não existe mais.');

    const { conteudo, tipoDoArquivo } = lerDataUrl(dto.arquivo);
    conferirArquivo(conteudo, tipoDoArquivo);

    /*
     * Substituir o que já está na gaveta dos substituídos não abre outra dentro
     * dela. O papel trocado duas vezes continua no mesmo lugar — é sempre a
     * mesma resposta à mesma pergunta ("o que já não vale?"), e uma boneca
     * russa de "Substituídos / Substituídos" não responde a nenhuma.
     */
    const jaEstaNoArquivo = velho.pasta.nome === PASTA_DOS_SUBSTITUIDOS;
    const destinoDoVelho = jaEstaNoArquivo
      ? velho.pastaId
      : await this.garantirSubpasta(velho.pastaId, PASTA_DOS_SUBSTITUIDOS);

    const novo = await this.prisma.$transaction(async (tx) => {
      await tx.documentoRh.update({
        where: { id },
        data: { pastaId: destinoDoVelho },
      });
      return tx.documentoRh.create({
        data: {
          // O novo fica onde o velho estava: é o lugar em que alguém vai
          // procurá-lo, e é o velho que sai de cena.
          pastaId: velho.pastaId,
          titulo: dto.titulo.trim(),
          tipo: dto.tipo.trim(),
          descricao: dto.descricao?.trim() || null,
          emitidoEm: diaOuNulo(dto.emitidoEm),
          valeAte: diaOuNulo(dto.valeAte),
          arquivoNome: dto.arquivoNome.trim(),
          arquivoTipo: tipoDoArquivo,
          arquivoTamanho: conteudo.length,
          arquivo: new Uint8Array(conteudo),
          criadoPor: usuarioId ?? null,
        },
        select: SEM_O_ARQUIVO,
      });
    });

    this.logger.log(
      `Documento "${velho.titulo}" substituído por "${novo.titulo}"; o ` +
        `anterior foi para "${PASTA_DOS_SUBSTITUIDOS}".`,
    );
    return {
      documento: paraTela(novo),
      /** Para a tela dizer para onde o antigo foi. */
      guardadoEm: jaEstaNoArquivo ? velho.pasta.nome : PASTA_DOS_SUBSTITUIDOS,
    };
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
function paraTela(d: {
  emitidoEm: Date | null;
  valeAte: Date | null;
  [k: string]: unknown;
}) {
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

