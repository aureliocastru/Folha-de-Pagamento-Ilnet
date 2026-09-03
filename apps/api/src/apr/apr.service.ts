import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CategoriaItemApr,
  GravidadeApr,
  ModoAssinatura,
  Prisma,
  RespostaRelato,
  StatusApr,
  UserRole,
} from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentosRhService } from '../rh/documentos.service';
import { quemTemLogin } from '../usuarios/login-de-campo';
import { CatalogoAprService } from './catalogo.service';
import {
  gerarAprPdf,
  type DadosDaApr,
  type RespostaDoPdf,
} from './apr.pdf';
import {
  pendenciasParaLiberar,
  relatosNegativos,
  riscosMarcados,
  type RespostaParaConferir,
} from './apr.regras';
import {
  AssinarExecutanteDto,
  AtualizarAprDto,
  CancelarAprDto,
  CriarAprDto,
  ExecutanteAprDto,
  ProrrogarAprDto,
  QueryAprDto,
  RespostaAprDto,
  SupervisaoAprDto,
} from './dto/apr.dto';
import { EMPRESA_DO_PAPEL } from './modelo-ilnet';

/** Quem está pedindo. Vem do login; o técnico só enxerga o que ele abriu. */
export interface AutorApr {
  id?: string;
  nome: string;
  role: UserRole;
}

/** De onde veio a assinatura, para o caso de alguém contestar. */
export interface Origem {
  ip: string | null;
  userAgent: string | null;
}

/** As duas prorrogações que o formulário impresso prevê. */
const MAXIMO_DE_PRORROGACOES = 2;

/**
 * A divisória da APR dentro da pasta de cada pessoa.
 *
 * O nome é o do assunto, e não o do documento, porque é o assunto que vai
 * crescer: a ficha de EPI, o ASO, o certificado da NR-35 e a ordem de serviço
 * são da mesma gaveta, e o dia em que entrarem vão encontrá-la aberta.
 */
export const SUBPASTA_DA_SEGURANCA = 'Segurança do Trabalho';

/** Como a APR se chama na estante. É por ele que a tela do RH agrupa. */
const TIPO_NO_RH = 'Análise de Risco (APR)';

const COM_TUDO = {
  respostas: { orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }] },
  executantes: { orderBy: { createdAt: 'asc' } },
  modelo: { select: { id: true, nome: true } },
} satisfies Prisma.AprInclude;

type AprComTudo = Prisma.AprGetPayload<{ include: typeof COM_TUDO }>;

@Injectable()
export class AprService {
  private readonly logger = new Logger(AprService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogo: CatalogoAprService,
    private readonly config: ConfigFinanceiraService,
    private readonly documentos: DocumentosRhService,
  ) {}

  // --- Ler ------------------------------------------------------------------

  /**
   * A lista, com o resumo que se lê de relance.
   *
   * O técnico vê as dele, e só. Não é economia de tela: a APR diz onde uma
   * equipe está e o que ela vai fazer, e quem trabalha em campo não tem por que
   * acompanhar o serviço dos outros. Quem precisa da visão do dia inteiro —
   * quem supervisiona — tem outro perfil.
   */
  async listar(q: QueryAprDto, autor: AutorApr) {
    const where: Prisma.AprWhereInput = {};

    if (q.status) where.status = q.status;
    if (soAsSuas(autor) || q.minhas) where.criadoPorId = autor.id ?? '—';

    if (q.de || q.ate) {
      where.inicioEm = {
        ...(q.de ? { gte: new Date(`${q.de}T00:00:00.000Z`) } : {}),
        ...(q.ate ? { lte: new Date(`${q.ate}T23:59:59.999Z`) } : {}),
      };
    }

    if (q.busca) {
      const busca = q.busca.trim();
      const numero = Number(busca.replace(/\D/g, ''));
      where.OR = [
        { local: { contains: busca, mode: 'insensitive' } },
        { coordenador: { contains: busca, mode: 'insensitive' } },
        { criadoPorNome: { contains: busca, mode: 'insensitive' } },
        { executantes: { some: { nome: { contains: busca, mode: 'insensitive' } } } },
        ...(Number.isFinite(numero) && numero > 0 ? [{ numero }] : []),
      ];
    }

    const aprs = await this.prisma.apr.findMany({
      where,
      orderBy: { inicioEm: 'desc' },
      take: 300,
      include: {
        executantes: { select: { nome: true, assinadoEm: true } },
        // Só o que o resumo mostra. Trazer as sessenta respostas de cada APR
        // para desenhar uma lista de duzentas seria doze mil linhas por tela.
        respostas: {
          where: {
            OR: [
              { categoria: CategoriaItemApr.RISCO, marcado: true },
              { categoria: CategoriaItemApr.RELATO, resposta: RespostaRelato.NAO },
            ],
          },
          orderBy: { ordem: 'asc' },
          select: { categoria: true, texto: true, resposta: true },
        },
      },
    });

    return aprs.map((apr) => ({
      id: apr.id,
      numero: apr.numero,
      status: apr.status,
      local: apr.local,
      coordenador: apr.coordenador,
      tipoTrabalho: apr.tipoTrabalho,
      gravidade: apr.gravidade,
      inicioEm: apr.inicioEm,
      fimEm: apr.fimEm,
      prorrogacoes: apr.prorrogacoes,
      criadoPorNome: apr.criadoPorNome,
      supervisionada: !!apr.supervisorEm,
      arquivadaNoRh: !!apr.documentoRhId,
      executantes: apr.executantes.map((e) => e.nome),
      assinaturasFaltando: apr.executantes.filter((e) => !e.assinadoEm).length,
      riscos: apr.respostas
        .filter((r) => r.categoria === CategoriaItemApr.RISCO)
        .map((r) => r.texto),
      /** Quantas perguntas do relato foram respondidas com "Não". */
      alertas: apr.respostas.filter(
        (r) => r.categoria === CategoriaItemApr.RELATO,
      ).length,
    }));
  }

  /** Uma APR inteira, com o que falta para liberar. */
  async buscar(id: string, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    return this.paraTela(apr);
  }

  /**
   * Os funcionários que podem entrar numa equipe.
   *
   * Vive aqui, e não em `/funcionarios`, porque o técnico não abre aquele
   * módulo — e porque o que ele precisa é só o nome para escolher, não a ficha
   * de salário de ninguém.
   *
   * Só entra na lista quem tem login. Escolher alguém aqui não é só escrever um
   * nome no papel: arquiva uma cópia da APR na pasta dessa pessoa, e a pasta de
   * quem não entra no sistema é gaveta que ninguém abre — o documento fica
   * guardado onde ele nunca vai ser lido. Quem apareceu no serviço sem estar no
   * cadastro continua entrando pelo nome digitado, na tela.
   */
  async equipe() {
    const [pessoas, logins] = await Promise.all([
      this.prisma.funcionario.findMany({
        where: { ativo: true, isentoIcms: true },
        orderBy: { nome: 'asc' },
        select: {
          id: true,
          nome: true,
          apelido: true,
          cpfCnpj: true,
          funcao: true,
        },
      }),
      this.prisma.user.findMany({ select: { nome: true, email: true } }),
    ]);

    const temLogin = quemTemLogin(pessoas, logins);

    return pessoas
      .filter((p) => temLogin.has(p.id))
      .map((p) => ({
        id: p.id,
        nome: p.nome,
        apelido: p.apelido,
        cpf: p.cpfCnpj,
        funcao: p.funcao,
      }));
  }

  // --- Escrever -------------------------------------------------------------

  /**
   * Abre a APR do serviço.
   *
   * Chega tudo de uma vez — cabeçalho, marcações e equipe —, e é de propósito:
   * o técnico preenche isto na beira da estrada, e cada ida ao servidor é uma
   * chance de a APR ficar pela metade quando o sinal cai.
   *
   * Nasce em rascunho. O que a torna documento é a liberação, que confere o que
   * falta e exige a assinatura de todo mundo.
   */
  async criar(dto: CriarAprDto, autor: AutorApr) {
    const { modelo } = await this.catalogo.formulario(dto.modeloId);
    const cfg = await this.config.obter();

    const numero = await this.proximoNumero();
    const respostas = await this.montarRespostas(modelo.id, dto.respostas ?? []);

    const apr = await this.prisma.apr.create({
      data: {
        numero,
        modeloId: modelo.id,
        // O retrato do papel, congelado agora. Ver o comentário do modelo.
        empresaNome: cfg.empresaNome.trim() || EMPRESA_DO_PAPEL.nome,
        empresaCnpj: cfg.empresaCnpj.trim() || EMPRESA_DO_PAPEL.cnpj,
        titulo: modelo.titulo,
        tipoTrabalho: modelo.tipoTrabalho,
        orientacoes: modelo.orientacoes,
        planoResgate: modelo.planoResgate,
        telefonesEmergencia: modelo.telefonesEmergencia,

        local: dto.local,
        coordenador: dto.coordenador,
        previsaoInicio: diaOuNulo(dto.previsaoInicio),
        previsaoFim: diaOuNulo(dto.previsaoFim),
        inicioEm: dto.inicioEm ? new Date(dto.inicioEm) : new Date(),
        fimEm: dto.fimEm ? new Date(dto.fimEm) : null,
        descricaoEtapas: dto.descricaoEtapas ?? '',
        gravidade: dto.gravidade ?? GravidadeApr.ALTA,

        criadoPorId: autor.id ?? null,
        criadoPorNome: autor.nome,

        respostas: { createMany: { data: respostas } },
        executantes: {
          createMany: { data: await this.montarEquipe(dto.executantes ?? []) },
        },
      },
      include: COM_TUDO,
    });

    this.logger.log(`APR nº ${apr.numero} aberta por ${autor.nome}.`);
    return this.paraTela(apr);
  }

  /**
   * Corrige o rascunho.
   *
   * Só enquanto é rascunho: depois de liberada, a APR é o papel que a equipe
   * assinou, e mexer no que está escrito nele é assinar por eles. O que muda
   * depois tem porta própria — prorrogar, encerrar, supervisionar, cancelar.
   */
  async atualizar(id: string, dto: AtualizarAprDto, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    this.exigirRascunho(apr, 'alterar');

    const respostas =
      dto.respostas === undefined
        ? null
        : await this.montarRespostas(apr.modeloId, dto.respostas);

    await this.prisma.$transaction(async (tx) => {
      if (respostas) {
        await tx.respostaApr.deleteMany({ where: { aprId: id } });
        if (respostas.length > 0) {
          await tx.respostaApr.createMany({
            data: respostas.map((r) => ({ ...r, aprId: id })),
          });
        }
      }

      if (dto.executantes !== undefined) {
        await this.sincronizarEquipe(tx, apr, dto.executantes);
      }

      await tx.apr.update({
        where: { id },
        data: {
          ...(dto.local !== undefined ? { local: dto.local } : {}),
          ...(dto.coordenador !== undefined
            ? { coordenador: dto.coordenador }
            : {}),
          ...(dto.previsaoInicio !== undefined
            ? { previsaoInicio: diaOuNulo(dto.previsaoInicio) }
            : {}),
          ...(dto.previsaoFim !== undefined
            ? { previsaoFim: diaOuNulo(dto.previsaoFim) }
            : {}),
          ...(dto.inicioEm !== undefined
            ? { inicioEm: new Date(dto.inicioEm) }
            : {}),
          ...(dto.fimEm !== undefined
            ? { fimEm: dto.fimEm ? new Date(dto.fimEm) : null }
            : {}),
          ...(dto.descricaoEtapas !== undefined
            ? { descricaoEtapas: dto.descricaoEtapas }
            : {}),
          ...(dto.gravidade !== undefined ? { gravidade: dto.gravidade } : {}),
        },
      });
    });

    return this.paraTela(await this.exigir(id, autor));
  }

  /**
   * Confere e libera o serviço.
   *
   * É aqui que a APR deixa de ser rascunho. A conferência devolve tudo o que
   * falta de uma vez — quem está na beira da estrada não pode descobrir as
   * pendências uma por vez.
   */
  async liberar(id: string, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    this.exigirRascunho(apr, 'liberar');

    const pendencias = await this.pendencias(apr);
    if (pendencias.length > 0) {
      throw new BadRequestException(pendencias);
    }

    await this.prisma.apr.update({
      where: { id },
      data: { status: StatusApr.LIBERADA },
    });

    this.logger.log(`APR nº ${apr.numero} liberada por ${autor.nome}.`);
    await this.arquivarNoRh(id);
    return this.paraTela(await this.exigir(id, autor));
  }

  /** O serviço acabou. Fecha a janela de tempo do documento. */
  async encerrar(id: string, autor: AutorApr, fimEm?: string) {
    const apr = await this.exigir(id, autor);
    if (apr.status !== StatusApr.LIBERADA) {
      throw new BadRequestException(
        'Só dá para encerrar uma APR que está liberada.',
      );
    }

    const fim = fimEm ? new Date(fimEm) : new Date();
    if (fim < apr.inicioEm) {
      throw new BadRequestException(
        'O fim do serviço não pode ser antes do início.',
      );
    }

    await this.prisma.apr.update({ where: { id }, data: { fimEm: fim } });
    await this.arquivarNoRh(id);
    return this.paraTela(await this.exigir(id, autor));
  }

  /**
   * O serviço passou do previsto e continua.
   *
   * São duas, no máximo — é o que o formulário impresso prevê —, e cada uma
   * pede o motivo. Os motivos se somam em vez de se substituírem: a segunda
   * prorrogação não apaga o que justificou a primeira.
   */
  async prorrogar(id: string, dto: ProrrogarAprDto, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    if (apr.status !== StatusApr.LIBERADA) {
      throw new BadRequestException(
        'Só dá para prorrogar uma APR que está liberada.',
      );
    }
    if (apr.prorrogacoes >= MAXIMO_DE_PRORROGACOES) {
      throw new BadRequestException(
        `Esta APR já foi prorrogada ${MAXIMO_DE_PRORROGACOES} vezes. ` +
          'Passando disso, o serviço é outro: encerre esta e abra uma nova.',
      );
    }

    const numero = apr.prorrogacoes + 1;
    const anterior = apr.motivoProrrogacao ? `${apr.motivoProrrogacao}\n` : '';

    await this.prisma.apr.update({
      where: { id },
      data: {
        prorrogacoes: numero,
        motivoProrrogacao: `${anterior}${numero}ª: ${dto.motivo}`,
        ...(dto.fimEm ? { fimEm: new Date(dto.fimEm) } : {}),
      },
    });

    await this.arquivarNoRh(id);
    return this.paraTela(await this.exigir(id, autor));
  }

  /** Aberta por engano, ou o serviço não aconteceu. */
  async cancelar(id: string, dto: CancelarAprDto, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    if (apr.status === StatusApr.CANCELADA) {
      throw new BadRequestException('Esta APR já está cancelada.');
    }

    await this.prisma.apr.update({
      where: { id },
      data: {
        status: StatusApr.CANCELADA,
        motivoCancelamento: dto.motivo,
        canceladaEm: new Date(),
      },
    });

    this.logger.log(`APR nº ${apr.numero} cancelada por ${autor.nome}.`);
    // Rearquiva de propósito: a cópia no RH tem de dizer que foi cancelada, ou
    // quem a achar pela estante vai lê-la como um serviço que aconteceu.
    if (apr.documentoRhId) await this.arquivarNoRh(id);
    return this.paraTela(await this.exigir(id, autor));
  }

  /**
   * Apaga a APR de vez, com as cópias que ela deixou no RH.
   *
   * É a única porta do módulo que não deixa rastro, e existe para o engano: a
   * APR aberta em duplicidade, a de teste, a que nasceu no dia errado. O
   * caminho normal de um serviço que não aconteceu continua sendo cancelar —
   * ali ela fica na estante dizendo que foi cancelada e por quê, que é o que se
   * espera de um documento exigido por norma. Só o ADMIN chega aqui (ver o
   * controller).
   *
   * As cópias do RH vão junto: uma APR apagada cuja folha continua na pasta de
   * três pessoas é pior do que não ter apagado nada — ela vira um documento sem
   * origem, que ninguém sabe mais de onde veio nem por que está ali.
   */
  async excluir(id: string, autor: AutorApr) {
    const apr = await this.prisma.apr.findUnique({
      where: { id },
      select: {
        numero: true,
        local: true,
        status: true,
        documentoRhId: true,
        executantes: { select: { documentoRhId: true } },
      },
    });
    if (!apr) throw new NotFoundException('Esta APR não existe mais.');

    const copias = [
      apr.documentoRhId,
      ...apr.executantes.map((e) => e.documentoRhId),
    ].filter((doc): doc is string => !!doc);

    await this.prisma.$transaction(async (tx) => {
      // Os documentos primeiro: quem aponta para eles é a APR e os executantes,
      // com `SetNull`, e apagar a APR antes soltaria as cópias na estante sem
      // ninguém sabendo mais quais eram.
      if (copias.length > 0) {
        await tx.documentoRh.deleteMany({ where: { id: { in: copias } } });
      }
      // Respostas e executantes saem em cascata — ver a migração.
      await tx.apr.delete({ where: { id } });
    });

    this.logger.warn(
      `APR nº ${apr.numero} (${apr.local}, ${apr.status}) apagada por ` +
        `${autor.nome}, com ${copias.length} cópia(s) do RH.`,
    );
    return { apagada: true, numero: apr.numero, copiasRemovidas: copias.length };
  }

  /**
   * A assinatura de um executante, colhida no aparelho na hora.
   *
   * Só antes de liberar. Depois de liberada, todo mundo já assinou — é isso que
   * a liberação exige —, e uma assinatura que entra depois é uma assinatura sem
   * o papel na frente.
   */
  async assinar(
    executanteId: string,
    dto: AssinarExecutanteDto,
    autor: AutorApr,
    origem: Origem,
  ) {
    const executante = await this.prisma.executanteApr.findUnique({
      where: { id: executanteId },
      include: { apr: { select: { id: true, status: true, criadoPorId: true } } },
    });
    if (!executante) {
      throw new NotFoundException('Este executante não está mais na equipe.');
    }
    if (soAsSuas(autor) && executante.apr.criadoPorId !== autor.id) {
      throw new ForbiddenException('Esta APR não é sua.');
    }
    if (executante.apr.status !== StatusApr.RASCUNHO) {
      throw new BadRequestException(
        'Esta APR já foi liberada — a equipe assinou antes de o serviço ' +
          'começar, que é quando a assinatura vale.',
      );
    }
    if (!dto.assinaturaPng.startsWith('data:image/')) {
      throw new BadRequestException('A assinatura não chegou como imagem.');
    }

    await this.prisma.executanteApr.update({
      where: { id: executanteId },
      data: {
        assinaturaPng: dto.assinaturaPng,
        assinadoEm: new Date(),
        modo: dto.modo ?? ModoAssinatura.DESENHADA,
        ip: origem.ip,
        userAgent: origem.userAgent,
      },
    });

    return this.paraTela(await this.exigir(executante.apr.id, autor));
  }

  /** O supervisor confere o que a equipe preencheu e assina embaixo. */
  async supervisionar(id: string, dto: SupervisaoAprDto, autor: AutorApr) {
    const apr = await this.exigir(id, autor);
    if (apr.status !== StatusApr.LIBERADA) {
      throw new BadRequestException(
        'A supervisão assina uma APR liberada — é ela que confere o que a ' +
          'equipe preencheu antes de começar.',
      );
    }
    if (!dto.assinaturaPng.startsWith('data:image/')) {
      throw new BadRequestException('A assinatura não chegou como imagem.');
    }

    await this.prisma.apr.update({
      where: { id },
      data: {
        supervisorNome: dto.nome,
        supervisorAssinatura: dto.assinaturaPng,
        supervisorEm: new Date(),
      },
    });

    await this.arquivarNoRh(id);
    return this.paraTela(await this.exigir(id, autor));
  }

  // --- O papel --------------------------------------------------------------

  /**
   * O PDF, montado agora a partir do retrato congelado.
   *
   * Enquanto ainda é rascunho, a primeira vez que alguém abre o PDF fica
   * marcada — é o que prova, na liberação, que o documento foi de fato aberto
   * e não só preenchido. Depois de liberada a marca já não muda mais nada
   * (ver `pendenciasParaLiberar`), então não há por que atualizá-la de novo.
   */
  async pdf(id: string, autor: AutorApr): Promise<{ nome: string; conteudo: Buffer }> {
    const apr = await this.exigir(id, autor);

    if (apr.status === StatusApr.RASCUNHO && !apr.visualizouPdfEm) {
      apr.visualizouPdfEm = new Date();
      await this.prisma.apr.update({
        where: { id },
        data: { visualizouPdfEm: apr.visualizouPdfEm },
      });
    }

    return {
      nome: nomeDoArquivo(apr),
      conteudo: await gerarAprPdf(paraOPdf(apr)),
    };
  }

  /**
   * Guarda o PDF na estante do RH: na pasta da empresa e na de cada executante.
   *
   * Duas cópias da mesma folha, e cada uma responde a uma pergunta diferente. A
   * da empresa, ordenada por mês, responde "quais serviços houve em agosto?". A
   * que fica em "Segurança do Trabalho" dentro da pasta de cada um responde
   * "cadê a prova de que o Fulano foi orientado antes de subir no poste?" — a
   * pergunta do dia em que alguém cobra, e que se vai procurar na pasta dele,
   * não na do serviço.
   *
   * O papel continua sendo gerado sob demanda daqui, a partir do retrato
   * congelado; os arquivos de lá são cópia, para quem procura pelo caminho de
   * lá. O PDF é montado uma vez e guardado quantas forem as pastas: são os
   * mesmos bytes, e gerá-lo por pessoa custaria o mesmo desenho cinco vezes.
   *
   * Nunca derruba quem a chamou. Uma falha ao arquivar é uma cópia que não
   * saiu; recusar a liberação por causa dela deixaria a equipe parada na rua
   * por um problema da estante.
   */
  private async arquivarNoRh(id: string): Promise<void> {
    try {
      const apr = await this.prisma.apr.findUniqueOrThrow({
        where: { id },
        include: COM_TUDO,
      });

      const pdf = await gerarAprPdf(paraOPdf(apr));
      const arquivo = `data:application/pdf;base64,${pdf.toString('base64')}`;

      await this.arquivarNaEmpresa(apr, arquivo);
      await this.arquivarComAEquipe(apr, arquivo);
    } catch (erro) {
      this.logger.warn(
        `Não consegui arquivar a APR ${id} na pasta do RH: ${String(erro)}`,
      );
    }
  }

  /** A cópia do arquivo geral: "Empresa / Análises de Risco (APR) / 2026-08". */
  private async arquivarNaEmpresa(
    apr: AprComTudo,
    arquivo: string,
  ): Promise<void> {
    const pastaId = await this.pastaDoMes(apr.inicioEm);

    // O arquivo guardado não se troca por baixo do mesmo título (regra do
    // RH, e boa): a cópia velha sai e a nova entra.
    if (apr.documentoRhId) {
      await this.documentos.apagar(apr.documentoRhId).catch(() => undefined);
    }

    const doc = await this.documentos.guardar({
      pastaId,
      titulo: tituloNoRh(apr),
      tipo: TIPO_NO_RH,
      descricao:
        `${apr.tipoTrabalho} · ${apr.local} · coordenação de ` +
        `${apr.coordenador} · ${apr.executantes.length} executante(s)`,
      arquivoNome: nomeDoArquivo(apr),
      arquivo,
    });

    await this.prisma.apr.update({
      where: { id: apr.id },
      data: { documentoRhId: doc.id },
    });
  }

  /**
   * A cópia de cada executante, em "Segurança do Trabalho" dentro da pasta
   * dele — a mesma gaveta do contrato e do exame.
   *
   * Uma pessoa por vez, cada uma no seu `try`: a pasta de um que deu problema
   * não pode custar a cópia dos outros três. Quem não tem pasta na estante — o
   * terceirizado que apareceu no serviço — fica só na cópia da empresa; ver
   * `pastaDaPessoa`.
   */
  private async arquivarComAEquipe(
    apr: AprComTudo,
    arquivo: string,
  ): Promise<void> {
    for (const executante of apr.executantes) {
      try {
        const dele = await this.documentos.pastaDaPessoa(executante);
        if (!dele) continue;

        const destino = await this.documentos.garantirSubpasta(
          dele,
          SUBPASTA_DA_SEGURANCA,
        );

        if (executante.documentoRhId) {
          await this.documentos
            .apagar(executante.documentoRhId)
            .catch(() => undefined);
        }

        const doc = await this.documentos.guardar({
          pastaId: destino,
          titulo: tituloNoRh(apr),
          tipo: TIPO_NO_RH,
          descricao: descricaoDoExecutante(apr, executante),
          arquivoNome: nomeDoArquivo(apr),
          arquivo,
        });

        await this.prisma.executanteApr.update({
          where: { id: executante.id },
          data: { documentoRhId: doc.id },
        });
      } catch (erro) {
        this.logger.warn(
          `APR nº ${apr.numero}: não consegui guardar a cópia na pasta de ` +
            `${executante.nome}: ${String(erro)}`,
        );
      }
    }
  }

  /** "Empresa / Análises de Risco (APR) / 2026-08", criada conforme se precisa. */
  private async pastaDoMes(quando: Date): Promise<string> {
    const empresa =
      (await this.prisma.pastaRh.findFirst({
        where: { daEmpresa: true },
        select: { id: true },
      })) ??
      (await this.prisma.pastaRh.create({
        data: { nome: 'Empresa', daEmpresa: true },
        select: { id: true },
      }));

    const modulo = await this.documentos.garantirSubpasta(
      empresa.id,
      'Análises de Risco (APR)',
    );
    return this.documentos.garantirSubpasta(modulo, competencia(quando));
  }

  // --- Miudezas -------------------------------------------------------------

  /**
   * O número do documento.
   *
   * Sequência do banco, e não `MAX(numero) + 1`: duas equipes abrindo a APR do
   * dia no mesmo minuto é o caso comum aqui, não o raro, e o MAX daria o mesmo
   * número às duas.
   */
  private async proximoNumero(): Promise<number> {
    const linhas = await this.prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('apr_numero_seq')
    `;
    return Number(linhas[0].nextval);
  }

  /**
   * As marcações que a tela mandou, relidas do catálogo.
   *
   * O texto e a categoria saem do item, e não do que voltou do navegador:
   * confiar no texto de volta seria deixar quem preenche reescrever a pergunta
   * que está respondendo.
   *
   * Só entra o que diz alguma coisa. Guardar as sessenta linhas em branco de
   * cada APR encheria a tabela com o silêncio de quem não marcou nada — e
   * "não marcado" já é a ausência da linha.
   */
  private async montarRespostas(
    modeloId: string,
    enviadas: RespostaAprDto[],
  ): Promise<Prisma.RespostaAprCreateManyAprInput[]> {
    if (enviadas.length === 0) return [];

    const itens = await this.prisma.itemApr.findMany({
      where: { modeloId, id: { in: enviadas.map((r) => r.itemId) } },
    });
    const porId = new Map(itens.map((i) => [i.id, i]));

    const desconhecidos = enviadas.filter((r) => !porId.has(r.itemId));
    if (desconhecidos.length > 0) {
      throw new BadRequestException(
        'O formulário mudou enquanto você preenchia. Recarregue a tela para ' +
          'pegar a versão nova — o que você marcou até aqui está salvo.',
      );
    }

    const linhas: Prisma.RespostaAprCreateManyAprInput[] = [];
    for (const enviada of enviadas) {
      const item = porId.get(enviada.itemId)!;
      const marcado = enviada.marcado === true;
      const detalhe = enviada.detalhe?.trim() || null;

      if (!marcado && !enviada.resposta && !detalhe) continue;

      linhas.push({
        itemId: item.id,
        categoria: item.categoria,
        texto: item.texto,
        ordem: item.ordem,
        marcado,
        resposta: enviada.resposta ?? null,
        detalhe,
      });
    }
    return linhas;
  }

  /** A equipe, com o nome do cadastro mandando sobre o que foi digitado. */
  private async montarEquipe(
    enviados: ExecutanteAprDto[],
  ): Promise<Prisma.ExecutanteAprCreateManyAprInput[]> {
    const ids = enviados
      .map((e) => e.funcionarioId)
      .filter((id): id is string => !!id);

    const funcionarios = ids.length
      ? await this.prisma.funcionario.findMany({
          where: { id: { in: ids } },
          select: { id: true, nome: true, cpfCnpj: true },
        })
      : [];
    const porId = new Map(funcionarios.map((f) => [f.id, f]));

    return enviados.map((e) => {
      const cadastro = e.funcionarioId ? porId.get(e.funcionarioId) : undefined;
      return {
        funcionarioId: cadastro?.id ?? null,
        nome: cadastro?.nome ?? e.nome,
        cpf: cadastro?.cpfCnpj ?? e.cpf ?? null,
      };
    });
  }

  /**
   * Acerta a equipe sem apagar assinatura de quem continua nela.
   *
   * Trocar a lista inteira seria mais simples e custaria caro: acrescentar o
   * quarto executante apagaria as três assinaturas já colhidas, e ninguém
   * entenderia por quê.
   */
  private async sincronizarEquipe(
    tx: Prisma.TransactionClient,
    apr: AprComTudo,
    enviados: ExecutanteAprDto[],
  ): Promise<void> {
    const novos = await this.montarEquipe(enviados);
    const chave = (e: { funcionarioId?: string | null; nome: string }) =>
      e.funcionarioId ?? e.nome.trim().toLowerCase();

    const querem = new Set(novos.map(chave));
    const jaTem = new Map(apr.executantes.map((e) => [chave(e), e.id]));

    const sair = apr.executantes.filter((e) => !querem.has(chave(e)));
    if (sair.length > 0) {
      await tx.executanteApr.deleteMany({
        where: { id: { in: sair.map((e) => e.id) } },
      });

      // Quem saiu da equipe leva junto a cópia que estava na pasta dele. Uma
      // APR na gaveta de quem não foi ao serviço é pior que nenhuma: ela diz
      // que a pessoa estava lá.
      const copias = sair
        .map((e) => e.documentoRhId)
        .filter((id): id is string => !!id);
      if (copias.length > 0) {
        await tx.documentoRh.deleteMany({ where: { id: { in: copias } } });
      }
    }

    const entrar = novos.filter((e) => !jaTem.has(chave(e)));
    if (entrar.length > 0) {
      await tx.executanteApr.createMany({
        data: entrar.map((e) => ({ ...e, aprId: apr.id })),
      });
    }
  }

  /**
   * O que falta para liberar.
   *
   * As perguntas do relato entram todas, respondidas ou não: a APR só guarda o
   * que foi respondido, e é justamente a pergunta ausente que precisa aparecer
   * como pendência.
   */
  private async pendencias(apr: AprComTudo): Promise<string[]> {
    const itens = await this.prisma.itemApr.findMany({
      where: { modeloId: apr.modeloId, ativo: true },
      orderBy: [{ categoria: 'asc' }, { ordem: 'asc' }],
    });
    const respondidas = new Map(apr.respostas.map((r) => [r.itemId ?? r.texto, r]));

    const respostas: RespostaParaConferir[] = itens.map((item) => {
      const dada = respondidas.get(item.id);
      return {
        categoria: item.categoria,
        texto: item.texto,
        marcado: dada?.marcado ?? false,
        resposta: dada?.resposta ?? null,
        detalhe: dada?.detalhe ?? null,
        pedeDetalhe: item.pedeDetalhe,
        exigeProvidencia: item.exigeProvidencia,
      };
    });

    return pendenciasParaLiberar({
      local: apr.local,
      coordenador: apr.coordenador,
      descricaoEtapas: apr.descricaoEtapas,
      gravidade: apr.gravidade,
      respostas,
      executantes: apr.executantes.map((e) => ({
        nome: e.nome,
        assinadoEm: e.assinadoEm,
      })),
      visualizouPdfEm: apr.visualizouPdfEm,
    });
  }

  private async exigir(id: string, autor: AutorApr): Promise<AprComTudo> {
    const apr = await this.prisma.apr.findUnique({
      where: { id },
      include: COM_TUDO,
    });
    if (!apr) throw new NotFoundException('Esta APR não existe mais.');

    if (soAsSuas(autor) && apr.criadoPorId !== autor.id) {
      throw new ForbiddenException('Esta APR não é sua.');
    }
    return apr;
  }

  private exigirRascunho(apr: AprComTudo, oQue: string): void {
    if (apr.status === StatusApr.RASCUNHO) return;

    throw new BadRequestException(
      apr.status === StatusApr.CANCELADA
        ? `Esta APR foi cancelada — não dá para ${oQue}.`
        : `Esta APR já foi liberada: é o papel que a equipe assinou, e ` +
          `${oQue} o que está escrito nele seria assinar por eles. Para ` +
          'mudar o serviço, cancele esta e abra outra.',
    );
  }

  /** A APR como a tela a consome, com as pendências já contadas. */
  private async paraTela(apr: AprComTudo) {
    const respostas: RespostaParaConferir[] = apr.respostas.map((r) => ({
      categoria: r.categoria,
      texto: r.texto,
      marcado: r.marcado,
      resposta: r.resposta,
      detalhe: r.detalhe,
      pedeDetalhe: false,
      exigeProvidencia: false,
    }));

    return {
      ...apr,
      riscos: riscosMarcados(respostas),
      alertas: relatosNegativos(respostas),
      pendencias:
        apr.status === StatusApr.RASCUNHO ? await this.pendencias(apr) : [],
    };
  }
}

/** Perfil que só enxerga o que ele mesmo abriu. */
function soAsSuas(autor: AutorApr): boolean {
  return autor.role === UserRole.TECNICO;
}

/** "AAAA-MM-DD" vira o dia à meia-noite UTC, sem o fuso de quem digitou. */
function diaOuNulo(valor?: string | null): Date | null {
  return valor ? new Date(`${valor}T00:00:00.000Z`) : null;
}

function competencia(data: Date): string {
  return data.toISOString().slice(0, 7);
}

function tituloNoRh(apr: { numero: number; local: string; status: StatusApr }) {
  const cancelada = apr.status === StatusApr.CANCELADA ? ' (CANCELADA)' : '';
  return `APR nº ${apr.numero} — ${apr.local}${cancelada}`;
}

/**
 * O que a linha da pasta dela diz sobre esta APR.
 *
 * Na pasta da pessoa, o que importa é o serviço e a assinatura: quem abre esta
 * gaveta está conferindo o que ela assinou, e não quantos foram ao poste. A
 * data sai no fuso de casa — o container roda em UTC, e a APR assinada às nove
 * da noite viraria a do dia seguinte.
 */
function descricaoDoExecutante(
  apr: { tipoTrabalho: string; local: string; coordenador: string },
  executante: { assinadoEm: Date | null; modo: ModoAssinatura },
): string {
  const assinatura = executante.assinadoEm
    ? `assinada em ${executante.assinadoEm.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}${executante.modo === ModoAssinatura.DIGITADA ? ' (gerada do nome)' : ''}`
    : 'sem assinatura';

  return (
    `${apr.tipoTrabalho} · ${apr.local} · coordenação de ` +
    `${apr.coordenador} · ${assinatura}`
  );
}

function nomeDoArquivo(apr: { numero: number; inicioEm: Date }): string {
  return `APR-${String(apr.numero).padStart(4, '0')}-${
    apr.inicioEm.toISOString().slice(0, 10)
  }.pdf`;
}

/** A APR do banco no formato que o desenho do papel espera. */
function paraOPdf(apr: AprComTudo): DadosDaApr {
  const respostas: RespostaDoPdf[] = apr.respostas.map((r) => ({
    categoria: r.categoria,
    texto: r.texto,
    marcado: r.marcado,
    resposta: r.resposta,
    detalhe: r.detalhe,
  }));

  return {
    numero: apr.numero,
    empresaNome: apr.empresaNome,
    empresaCnpj: apr.empresaCnpj,
    titulo: apr.titulo,
    tipoTrabalho: apr.tipoTrabalho,
    local: apr.local,
    coordenador: apr.coordenador,
    previsaoInicio: apr.previsaoInicio,
    previsaoFim: apr.previsaoFim,
    inicioEm: apr.inicioEm,
    fimEm: apr.fimEm,
    prorrogacoes: apr.prorrogacoes,
    motivoProrrogacao: apr.motivoProrrogacao,
    descricaoEtapas: apr.descricaoEtapas,
    gravidade: apr.gravidade,
    orientacoes: apr.orientacoes,
    planoResgate: apr.planoResgate,
    telefonesEmergencia: apr.telefonesEmergencia,
    criadoPorNome: apr.criadoPorNome,
    supervisorNome: apr.supervisorNome,
    supervisorAssinatura: apr.supervisorAssinatura,
    supervisorEm: apr.supervisorEm,
    cancelada: apr.status === StatusApr.CANCELADA,
    motivoCancelamento: apr.motivoCancelamento,
    respostas,
    executantes: apr.executantes.map((e) => ({
      nome: e.nome,
      cpf: e.cpf,
      assinaturaPng: e.assinaturaPng,
      assinadoEm: e.assinadoEm,
      modo: e.modo,
    })),
  };
}
