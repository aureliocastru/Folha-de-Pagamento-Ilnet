import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conferirArquivo, emMegabytes, lerDataUrl } from '../arquivos/data-url';
import { DiaristasService } from '../diaristas/diaristas.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AtualizarPatrocinadoDto,
  CriarPatrocinadoDto,
  DadosDoPatrocinadoDto,
  GuardarArquivoDto,
} from './dto/patrocinio.dto';
import {
  resumirPagamentos,
  situacaoDoContrato,
  situacaoDoPagamento,
} from './patrocinio.calc';

/**
 * O que entra na ficha do patrocinado: papel, foto, vídeo curto e planilha.
 *
 * O vídeo entra porque é o que o contrato pede de volta todo mês ("fotos e
 * vídeos dos eventos realizados") — mas só o curto, que o teto abaixo é o
 * mesmo do resto da casa.
 */
const TIPOS_DO_ARQUIVO = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]);

/**
 * Teto por arquivo. É o mesmo da estante do RH, e pelo mesmo motivo: em base64
 * o arquivo engorda um terço, e o `LIMITE_CORPO` do `main.ts` (24 MB) e o
 * `client_max_body_size` do nginx medem o corpo inteiro.
 */
export const LIMITE_DO_ARQUIVO = 15 * 1024 * 1024;

/** Tudo do arquivo menos o conteúdo — o que as listas mostram. */
const ARQUIVO_SEM_CONTEUDO = {
  id: true,
  patrocinadoId: true,
  titulo: true,
  arquivoNome: true,
  arquivoTipo: true,
  arquivoTamanho: true,
  criadoPor: true,
  createdAt: true,
} satisfies Prisma.ArquivoDoPatrocinadoSelect;

/**
 * O contrato como a ficha o lista: sem o arquivo escaneado, sem o texto e sem
 * o desenho da assinatura — são megabytes que a lista não desenha.
 */
export const CONTRATO_NA_LISTA = {
  id: true,
  origem: true,
  token: true,
  expiraEm: true,
  assinadoEm: true,
  nomeAssinante: true,
  modo: true,
  arquivoNome: true,
  arquivoTipo: true,
  arquivoTamanho: true,
  criadoPor: true,
  createdAt: true,
} satisfies Prisma.ContratoDePatrocinioSelect;

/** A diária vista como pagamento ao patrocinado. */
const PAGAMENTO = {
  id: true,
  data: true,
  valor: true,
  descricao: true,
  forma: true,
  contaPagar: { select: { status: true } },
  assinatura: { select: { assinadoEm: true } },
} satisfies Prisma.DiariaSelect;

/**
 * Os patrocinados: o cadastro, a ficha com o que já se mandou, e os arquivos.
 * Os contratos têm serviço próprio (`ContratosDePatrocinioService`).
 */
@Injectable()
export class PatrocinioService {
  private readonly logger = new Logger(PatrocinioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly diaristas: DiaristasService,
  ) {}

  // -------------------------------------------------------------------------
  // Cadastro
  // -------------------------------------------------------------------------

  /** A lista, com o que se precisa ver sem abrir a ficha. */
  async listar(busca?: string, todos = false) {
    const where: Prisma.PatrocinadoWhereInput = {};
    if (!todos) where.ativo = true;
    if (busca?.trim()) {
      const termo = busca.trim();
      where.OR = [
        { nome: { contains: termo, mode: 'insensitive' } },
        { projeto: { contains: termo, mode: 'insensitive' } },
        { responsavel: { contains: termo, mode: 'insensitive' } },
        { cpfCnpj: { contains: termo, mode: 'insensitive' } },
      ];
    }

    const patrocinados = await this.prisma.patrocinado.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        contratos: { select: { origem: true, assinadoEm: true, expiraEm: true } },
        _count: { select: { arquivos: true } },
        diarista: {
          select: {
            id: true,
            nome: true,
            ativo: true,
            diarias: {
              select: {
                valor: true,
                data: true,
                forma: true,
                contaPagar: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    const agora = new Date();
    return patrocinados.map(({ contratos, diarista, _count, ...p }) => ({
      patrocinado: p,
      recebedor: diarista ? { id: diarista.id, nome: diarista.nome, ativo: diarista.ativo } : null,
      contrato: situacaoDoContrato(contratos, agora),
      arquivos: _count.arquivos,
      ...resumirPagamentos(diarista?.diarias ?? []),
    }));
  }

  /**
   * A ficha inteira: cadastro, quem recebe, o que já se mandou (lido das
   * diárias), os contratos e os arquivos.
   */
  async ficha(id: string) {
    const p = await this.prisma.patrocinado.findUnique({
      where: { id },
      include: {
        diarista: {
          select: {
            id: true,
            nome: true,
            cpfCnpj: true,
            chavePix: true,
            formaPagamento: true,
            ativo: true,
          },
        },
        contratos: { select: CONTRATO_NA_LISTA, orderBy: { createdAt: 'desc' } },
        arquivos: { select: ARQUIVO_SEM_CONTEUDO, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');

    const diarias = p.diaristaId
      ? await this.prisma.diaria.findMany({
          where: { diaristaId: p.diaristaId },
          orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
          select: PAGAMENTO,
        })
      : [];

    const { diarista, contratos, arquivos, ...patrocinado } = p;
    return {
      patrocinado,
      recebedor: diarista,
      contrato: situacaoDoContrato(contratos),
      contratos,
      arquivos,
      pagamentos: diarias.map(({ contaPagar, assinatura, ...d }) => ({
        ...d,
        situacao: situacaoDoPagamento({ ...d, contaPagar }),
        reciboAssinado: !!assinatura?.assinadoEm,
      })),
      resumo: resumirPagamentos(diarias),
    };
  }

  /**
   * Cadastra o patrocinado e já o deixa pronto para receber.
   *
   * Por onde ele recebe é obrigatório: um diarista que já existe (o atleta que
   * já recebia como diarista antes de virar patrocinado) ou os dados de quem
   * recebe, e aí o cadastro de diarista nasce aqui — com o fornecedor no IXC,
   * pelo mesmo caminho da aba Diaristas. Um patrocinado sem isso é alguém que
   * não dá para pagar.
   *
   * O IXC não segura o cadastro: se ele recusar o fornecedor, o patrocinado e
   * o diarista ficam cadastrados do mesmo jeito, e o motivo sobe para a tela —
   * o primeiro pagamento tenta de novo sozinho.
   */
  async criar(dto: CriarPatrocinadoDto, usuarioId?: string) {
    let diaristaId = dto.diaristaId;
    let avisoIxc: string | null = null;

    if (diaristaId) {
      await this.exigirRecebedorLivre(diaristaId);
    } else {
      if (!dto.recebedor) {
        throw new BadRequestException(
          'Diga por onde o patrocinado recebe: escolha um diarista que já existe ' +
            'ou preencha os dados de quem recebe.',
        );
      }
      const r = dto.recebedor;
      const criado = await this.diaristas.criar({
        nome: r.nome.trim(),
        cpfCnpj: r.cpfCnpj?.trim() || undefined,
        telefone: r.telefone?.trim() || undefined,
        chavePix: r.chavePix?.trim() || undefined,
        formaPagamento: r.formaPagamento,
        observacoes: `Recebe o patrocínio de ${dto.nome.trim()}.`,
      });
      diaristaId = criado.diarista.id;
      avisoIxc = criado.ixc.erro;
    }

    const patrocinado = await this.comRecebedorUnico(() =>
      this.prisma.patrocinado.create({
        data: {
          ...dadosDoCadastro(dto),
          nome: dto.nome.trim(),
          diaristaId,
          criadoPor: usuarioId ?? null,
        },
      }),
    );

    this.logger.log(`Patrocinado ${patrocinado.id} cadastrado (recebe pelo diarista ${diaristaId}).`);
    return { patrocinado, avisoIxc };
  }

  async atualizar(id: string, dto: AtualizarPatrocinadoDto) {
    await this.exigir(id);
    if (dto.diaristaId) await this.exigirRecebedorLivre(dto.diaristaId, id);

    return this.comRecebedorUnico(() =>
      this.prisma.patrocinado.update({
        where: { id },
        data: {
          ...dadosDoCadastro(dto),
          ...(dto.nome === undefined ? {} : { nome: dto.nome.trim() }),
          ...(dto.ativo === undefined ? {} : { ativo: dto.ativo }),
          ...(dto.diaristaId === undefined ? {} : { diaristaId: dto.diaristaId }),
        },
      }),
    );
  }

  /**
   * Apaga o cadastro — só o que nasceu por engano. Quem já tem contrato ou
   * arquivo guardado é desativado, não apagado: o papel assinado é a memória
   * do que se combinou, e ela não some porque o patrocínio acabou.
   *
   * O diarista ligado fica: ele pode ter recebido, e o histórico de pagamento
   * é da aba Diaristas.
   */
  async remover(id: string): Promise<void> {
    const p = await this.prisma.patrocinado.findUnique({
      where: { id },
      include: { _count: { select: { contratos: true, arquivos: true } } },
    });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');
    if (p._count.contratos > 0 || p._count.arquivos > 0) {
      throw new BadRequestException(
        'Este patrocinado já tem contrato ou arquivo guardado — desative o ' +
          'cadastro em vez de apagar.',
      );
    }
    await this.prisma.patrocinado.delete({ where: { id } });
  }

  /**
   * Os cadastros de diarista que podem receber por um patrocinado: os ativos,
   * dizendo de quem cada um já é. Fica aqui, e não na rota da aba Diaristas,
   * porque quem cuida dos patrocínios pode não abrir a folha.
   */
  async recebedores(busca?: string) {
    const termo = busca?.trim();
    const diaristas = await this.prisma.diarista.findMany({
      where: {
        ativo: true,
        ...(termo
          ? {
              OR: [
                { nome: { contains: termo, mode: 'insensitive' } },
                { nomeFantasia: { contains: termo, mode: 'insensitive' } },
                { cpfCnpj: { contains: termo, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      // A tela escolhe numa lista com busca própria: cabe a casa inteira.
      take: 500,
      select: {
        id: true,
        nome: true,
        nomeFantasia: true,
        cpfCnpj: true,
        patrocinado: { select: { id: true, nome: true } },
      },
    });
    return diaristas;
  }

  // -------------------------------------------------------------------------
  // Arquivos
  // -------------------------------------------------------------------------

  async guardarArquivo(patrocinadoId: string, dto: GuardarArquivoDto, usuarioId?: string) {
    await this.exigir(patrocinadoId);
    const arquivo = lerDataUrl(dto.arquivo);
    conferirArquivo(
      arquivo,
      TIPOS_DO_ARQUIVO,
      LIMITE_DO_ARQUIVO,
      'Aqui entram PDF, foto, vídeo curto, documento do Word, planilha e texto.',
    );

    const nome = dto.arquivoNome.trim();
    const guardado = await this.prisma.arquivoDoPatrocinado.create({
      data: {
        patrocinadoId,
        titulo: dto.titulo?.trim() || semExtensao(nome),
        arquivoNome: nome,
        arquivoTipo: arquivo.tipo,
        arquivoTamanho: arquivo.conteudo.length,
        // `Uint8Array` e não `Buffer`: é o tipo que o Prisma 6 espera na
        // coluna `Bytes` (ver `DocumentosRhService.guardar`).
        arquivo: new Uint8Array(arquivo.conteudo),
        criadoPor: usuarioId ?? null,
      },
      select: ARQUIVO_SEM_CONTEUDO,
    });
    this.logger.log(
      `Arquivo "${guardado.titulo}" (${emMegabytes(guardado.arquivoTamanho)}) ` +
        `guardado no patrocinado ${patrocinadoId}.`,
    );
    return guardado;
  }

  async arquivo(id: string) {
    const a = await this.prisma.arquivoDoPatrocinado.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Arquivo não encontrado.');
    return a;
  }

  async removerArquivo(id: string): Promise<void> {
    const r = await this.prisma.arquivoDoPatrocinado.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundException('Arquivo não encontrado.');
  }

  // -------------------------------------------------------------------------

  private async exigir(id: string) {
    const p = await this.prisma.patrocinado.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');
    return p;
  }

  /**
   * O diarista existe, e não paga outro patrocinado. A coluna é única, e o
   * banco recusaria de qualquer jeito — aqui a recusa vem com o nome de quem já
   * está ligado, que é o que a pessoa precisa para decidir.
   */
  private async exigirRecebedorLivre(diaristaId: string, patrocinadoId?: string) {
    const d = await this.prisma.diarista.findUnique({
      where: { id: diaristaId },
      select: { id: true, nome: true, patrocinado: { select: { id: true, nome: true } } },
    });
    if (!d) throw new NotFoundException('Diarista não encontrado.');
    if (d.patrocinado && d.patrocinado.id !== patrocinadoId) {
      throw new BadRequestException(
        `${d.nome} já recebe pelo patrocínio de ${d.patrocinado.nome}. Cada ` +
          'cadastro de diarista paga um patrocinado só.',
      );
    }
  }

  /** Duas telas ligando o mesmo diarista ao mesmo tempo: o banco desempata. */
  private async comRecebedorUnico<T>(gravar: () => Promise<T>): Promise<T> {
    try {
      return await gravar();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'Este diarista acabou de ser ligado a outro patrocinado. Escolha outro.',
        );
      }
      throw err;
    }
  }
}

/** O que é comum a cadastrar e a corrigir: tudo que veio, e só o que veio. */
function dadosDoCadastro(dto: DadosDoPatrocinadoDto) {
  const texto = (v: string | null | undefined) =>
    v === undefined ? undefined : v?.trim() || null;
  return {
    projeto: texto(dto.projeto),
    cpfCnpj: texto(dto.cpfCnpj),
    responsavel: texto(dto.responsavel),
    telefone: texto(dto.telefone),
    email: texto(dto.email),
    instagram: texto(dto.instagram),
    cidade: texto(dto.cidade),
    observacoes: texto(dto.observacoes),
    ...(dto.valorMensal === undefined
      ? {}
      : {
          valorMensal:
            dto.valorMensal == null || dto.valorMensal <= 0
              ? null
              : new Prisma.Decimal(dto.valorMensal),
        }),
    ...(dto.inicio === undefined ? {} : { inicio: diaOuNulo(dto.inicio) }),
    ...(dto.fim === undefined ? {} : { fim: diaOuNulo(dto.fim) }),
  };
}

function diaOuNulo(dia: string | null): Date | null {
  return dia ? new Date(`${dia}T00:00:00.000Z`) : null;
}

/** "Fotos do torneio.jpg" → "Fotos do torneio". */
function semExtensao(nome: string): string {
  return nome.replace(/\.[^.]{1,5}$/, '') || nome;
}
