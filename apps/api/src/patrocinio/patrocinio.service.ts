import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoDePatrocinio } from '@prisma/client';
import { conferirArquivo, emMegabytes, lerDataUrl } from '../arquivos/data-url';
import { FornecedorService } from '../financeiro/fornecedor.service';
import { IxcClient } from '../ixc/ixc.client';
import { parseIxcId } from '../ixc/ixc.parse';
import { PrismaService } from '../prisma/prisma.service';
import {
  AtualizarPatrocinadoDto,
  CriarPatrocinadoDto,
  DadosDoPatrocinadoDto,
  GuardarArquivoDto,
} from './dto/patrocinio.dto';
import {
  ordenarPagamentos,
  pagamentoDoTitulo,
  pagamentosDoMes,
  resumirPagamentos,
  situacaoDoContrato,
  situacaoDoMes,
  type PagamentoAoPatrocinado,
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

/**
 * Quantos títulos de um fornecedor se leem do IXC. Patrocinado recebe uma vez
 * por mês: seiscentos são cinquenta anos de patrocínio. Lidos do vencimento
 * mais recente para trás, que é o que a tela olha.
 */
const TITULOS_POR_PAGINA = 300;
const PAGINAS_POR_FORNECEDOR = 2;

/** Quantos fornecedores se leem ao mesmo tempo. O IXC é de produção, não é fila. */
const LEITURAS_EM_PARALELO = 4;

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

/**
 * A nota de recebimento como as listas a mostram: sem o desenho da assinatura,
 * que são dezenas de KB que a lista não desenha.
 */
export const NOTA_NA_LISTA = {
  id: true,
  patrocinadoId: true,
  idFnApagar: true,
  token: true,
  expiraEm: true,
  valor: true,
  referente: true,
  vencimento: true,
  pagoEm: true,
  nomePatrocinado: true,
  assinadoEm: true,
  nomeAssinante: true,
  modo: true,
  baixadaEm: true,
  baixadaPor: true,
  createdAt: true,
} satisfies Prisma.NotaDeRecebimentoSelect;

export type NotaNaLista = Prisma.NotaDeRecebimentoGetPayload<{ select: typeof NOTA_NA_LISTA }>;

/** O pagamento como as telas o recebem: o título do IXC e a nota dele, se já há uma. */
export type PagamentoComNota = PagamentoAoPatrocinado & { nota: NotaNaLista | null };

/**
 * Os patrocinados: o cadastro, a ficha com o que já se mandou, os pagamentos
 * do mês e os arquivos. Os contratos têm serviço próprio
 * (`ContratosDePatrocinioService`).
 *
 * O dinheiro não passa por aqui. Cada patrocinado é o fornecedor que ele já é
 * no IXC; pagar é lançar uma conta a pagar para esse fornecedor (pela tela do
 * Contas a Pagar), e o que já se mandou é lido dos títulos dele no IXC — os
 * lançados daqui e os lançados direto lá.
 */
@Injectable()
export class PatrocinioService {
  private readonly logger = new Logger(PatrocinioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    private readonly fornecedores: FornecedorService,
  ) {}

  // -------------------------------------------------------------------------
  // Cadastro
  // -------------------------------------------------------------------------

  /**
   * A lista, com o que se precisa ver sem abrir a ficha. O que já se mandou
   * não vem aqui: é leitura do IXC, e vem pela rota dos pagamentos, para a
   * lista não esperar por ela.
   */
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
        { fornecedorNome: { contains: termo, mode: 'insensitive' } },
      ];
    }

    const patrocinados = await this.prisma.patrocinado.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        contratos: { select: { origem: true, assinadoEm: true, expiraEm: true } },
        _count: { select: { arquivos: true } },
      },
    });

    const agora = new Date();
    return patrocinados.map(({ contratos, _count, ...p }) => ({
      patrocinado: p,
      contrato: situacaoDoContrato(contratos, agora),
      arquivos: _count.arquivos,
    }));
  }

  /**
   * A ficha inteira: cadastro, o que já se mandou (lido do IXC), os contratos
   * e os arquivos.
   *
   * O IXC fora do ar não fecha a ficha: o contato, o contrato e os arquivos
   * são daqui, e os pagamentos voltam com o motivo de não terem vindo.
   */
  async ficha(id: string) {
    const p = await this.prisma.patrocinado.findUnique({
      where: { id },
      include: {
        contratos: { select: CONTRATO_NA_LISTA, orderBy: { createdAt: 'desc' } },
        arquivos: { select: ARQUIVO_SEM_CONTEUDO, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');

    // O desconto também lê, quando há fornecedor: é o que já se mandou em
    // dinheiro antes de o patrocínio virar desconto.
    let pagamentos: PagamentoAoPatrocinado[] = [];
    let avisoPagamentos: string | null = null;
    if (p.idFornecedorIxc) {
      try {
        pagamentos = await this.pagamentosDoFornecedor(p.idFornecedorIxc);
      } catch (err) {
        avisoPagamentos = motivo(err);
      }
    }

    const { contratos, arquivos, ...patrocinado } = p;
    return {
      patrocinado,
      contrato: situacaoDoContrato(contratos),
      contratos,
      arquivos,
      pagamentos: await this.comNotas(pagamentos),
      resumo: resumirPagamentos(pagamentos),
      avisoPagamentos,
    };
  }

  /**
   * Cadastra o patrocinado já ligado ao fornecedor por onde ele recebe. O do
   * desconto na mensalidade pode vir sem: não há dinheiro para mandar.
   */
  async criar(dto: CriarPatrocinadoDto, usuarioId?: string) {
    const idFornecedorIxc = dto.idFornecedorIxc ?? null;
    if (idFornecedorIxc !== null) await this.exigirFornecedorLivre(idFornecedorIxc);

    const patrocinado = await this.comFornecedorUnico(() =>
      this.prisma.patrocinado.create({
        data: {
          ...dadosDoCadastro(dto),
          nome: dto.nome.trim(),
          idFornecedorIxc,
          fornecedorNome: idFornecedorIxc !== null ? (dto.fornecedorNome?.trim() ?? null) : null,
          criadoPor: usuarioId ?? null,
        },
      }),
    );

    this.logger.log(
      `Patrocinado ${patrocinado.id} cadastrado (${patrocinado.tipo}` +
        (idFornecedorIxc !== null ? `, recebe pelo fornecedor ${idFornecedorIxc}` : '') +
        ').',
    );
    return { patrocinado };
  }

  async atualizar(id: string, dto: AtualizarPatrocinadoDto) {
    await this.exigir(id);
    const trocaFornecedor = dto.idFornecedorIxc !== undefined;
    if (trocaFornecedor) {
      if (!dto.fornecedorNome?.trim()) {
        throw new BadRequestException('Diga o nome do fornecedor escolhido.');
      }
      await this.exigirFornecedorLivre(dto.idFornecedorIxc!, id);
    }

    return this.comFornecedorUnico(() =>
      this.prisma.patrocinado.update({
        where: { id },
        data: {
          ...dadosDoCadastro(dto),
          ...(dto.nome === undefined ? {} : { nome: dto.nome.trim() }),
          ...(dto.ativo === undefined ? {} : { ativo: dto.ativo }),
          ...(trocaFornecedor
            ? { idFornecedorIxc: dto.idFornecedorIxc, fornecedorNome: dto.fornecedorNome!.trim() }
            : {}),
        },
      }),
    );
  }

  /**
   * Apaga o cadastro — só o que nasceu por engano. Quem já tem contrato ou
   * arquivo guardado é desativado, não apagado: o papel assinado é a memória
   * do que se combinou, e ela não some porque o patrocínio acabou.
   *
   * Os títulos do fornecedor ficam no IXC: apagar o patrocinado não mexe no
   * dinheiro que já saiu.
   */
  async remover(id: string): Promise<void> {
    const p = await this.prisma.patrocinado.findUnique({
      where: { id },
      include: { _count: { select: { contratos: true, arquivos: true, notas: true } } },
    });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');
    if (p._count.contratos > 0 || p._count.arquivos > 0 || p._count.notas > 0) {
      throw new BadRequestException(
        'Este patrocinado já tem contrato, arquivo ou nota de recebimento guardado — ' +
          'desative o cadastro em vez de apagar.',
      );
    }
    await this.prisma.patrocinado.delete({ where: { id } });
  }

  /**
   * Os fornecedores do IXC que casam com o que foi digitado, dizendo de quem
   * cada um já é. Fica aqui, e não só na rota do Contas a Pagar, porque quem
   * cuida dos patrocínios pode não abrir o Contas a Pagar.
   */
  async fornecedoresParaLigar(busca?: string) {
    const achados = await this.fornecedores.buscarNoIxcPorNome(busca ?? '');
    if (achados.length === 0) return [];

    const ligados = await this.prisma.patrocinado.findMany({
      where: { idFornecedorIxc: { in: achados.map((f) => f.idFornecedor) } },
      select: { id: true, nome: true, idFornecedorIxc: true },
    });
    const dono = new Map(ligados.map((p) => [p.idFornecedorIxc, { id: p.id, nome: p.nome }]));

    return achados.map((f) => ({
      idFornecedor: f.idFornecedor,
      nome: f.nome,
      nomeFantasia: f.nomeFantasia,
      cpfCnpj: f.cpfCnpj,
      patrocinado: dono.get(f.idFornecedor) ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Pagamentos
  // -------------------------------------------------------------------------

  /**
   * O mês de cada patrocinado ativo: quanto se combinou, quanto já saiu e
   * quanto está lançado esperando, e o que falta.
   *
   * O fixo em dinheiro e o avulso são as linhas — o avulso nunca "falta", que
   * não há combinado por mês. O desconto na mensalidade fica à parte: não sai
   * dinheiro, e por isso ele não entra na soma do que se pagou nem do que falta.
   *
   * Um fornecedor que o IXC não deixou ler fica com o motivo na linha dele, e
   * os outros respondem do mesmo jeito.
   */
  async pagamentosDoMes(mes: string) {
    const todos = await this.prisma.patrocinado.findMany({
      where: { ativo: true },
      // O enum ordena como foi declarado: fixo, desconto, avulso.
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
      select: {
        id: true,
        tipo: true,
        nome: true,
        projeto: true,
        // Para mandar a nota de recebimento pelo WhatsApp dali mesmo.
        telefone: true,
        valorMensal: true,
        inicio: true,
        fim: true,
        idFornecedorIxc: true,
        fornecedorNome: true,
      },
    });
    const ativos = todos.filter((p) => p.tipo !== TipoDePatrocinio.DESCONTO);
    const descontos = todos.filter((p) => p.tipo === TipoDePatrocinio.DESCONTO);

    const lidos = new Map<number, PagamentoAoPatrocinado[] | Error>();
    const fornecedores = [
      ...new Set(ativos.map((p) => p.idFornecedorIxc).filter((id): id is number => id !== null)),
    ];
    for (let i = 0; i < fornecedores.length; i += LEITURAS_EM_PARALELO) {
      const lote = fornecedores.slice(i, i + LEITURAS_EM_PARALELO);
      await Promise.all(
        lote.map(async (id) => {
          try {
            lidos.set(id, await this.pagamentosDoFornecedor(id));
          } catch (err) {
            lidos.set(id, err instanceof Error ? err : new Error(String(err)));
          }
        }),
      );
    }

    const semNotas = ativos.map((p) => {
      const lido = p.idFornecedorIxc ? lidos.get(p.idFornecedorIxc) : undefined;
      const pagamentos = Array.isArray(lido) ? lido : [];
      const doMes = pagamentosDoMes(pagamentos, mes);
      // O avulso não tem combinado: se sobrou um valor de quando ele era fixo,
      // ele não pode fazer a linha dizer que falta pagar.
      const valorMensal =
        p.tipo === TipoDePatrocinio.FIXO && p.valorMensal ? Number(p.valorMensal) : null;
      return {
        patrocinado: p,
        mes: doMes,
        situacao: situacaoDoMes(valorMensal, doMes),
        resumo: resumirPagamentos(pagamentos),
        erro: lido instanceof Error ? motivo(lido) : null,
      };
    });

    const notas = await this.notasDosTitulos(
      semNotas.flatMap((l) => l.mes.pagamentos.map((pg) => pg.idFnApagar)),
    );
    const linhas = semNotas.map((l) => ({
      ...l,
      mes: {
        ...l.mes,
        pagamentos: l.mes.pagamentos.map((pg) => ({ ...pg, nota: notas.get(pg.idFnApagar) ?? null })),
      },
    }));

    const soma = (valores: number[]) =>
      Math.round(valores.reduce((t, v) => t + v, 0) * 100) / 100;
    return {
      mes,
      linhas,
      descontos,
      totais: {
        combinado: soma(
          linhas
            .filter((l) => l.patrocinado.tipo === TipoDePatrocinio.FIXO)
            .map((l) => Number(l.patrocinado.valorMensal ?? 0)),
        ),
        pago: soma(linhas.map((l) => l.mes.pago)),
        emAberto: soma(linhas.map((l) => l.mes.emAberto)),
        faltam: linhas.filter((l) => l.situacao === 'FALTA' || l.situacao === 'PARCIAL').length,
        desconto: soma(descontos.map((p) => Number(p.valorMensal ?? 0))),
      },
    };
  }

  /** Os pagamentos, cada um com a nota de recebimento dele quando já há uma. */
  private async comNotas(pagamentos: PagamentoAoPatrocinado[]): Promise<PagamentoComNota[]> {
    const notas = await this.notasDosTitulos(pagamentos.map((pg) => pg.idFnApagar));
    return pagamentos.map((pg) => ({ ...pg, nota: notas.get(pg.idFnApagar) ?? null }));
  }

  private async notasDosTitulos(ids: number[]): Promise<Map<number, NotaNaLista>> {
    if (ids.length === 0) return new Map();
    const notas = await this.prisma.notaDeRecebimento.findMany({
      where: { idFnApagar: { in: [...new Set(ids)] } },
      select: NOTA_NA_LISTA,
    });
    return new Map(notas.map((n) => [n.idFnApagar, n]));
  }

  /**
   * Os títulos de um fornecedor no IXC, como pagamentos — pagos e em aberto,
   * do mais recente para o mais antigo. Público porque a nota de recebimento
   * confere aqui o pagamento que vai assinar.
   */
  async pagamentosDoFornecedor(idFornecedor: number): Promise<PagamentoAoPatrocinado[]> {
    const brutos = await this.ixc.listAll<Record<string, unknown>>(
      'fn_apagar',
      {
        qtype: 'fn_apagar.id_fornecedor',
        query: String(idFornecedor),
        oper: '=',
        sortname: 'fn_apagar.data_vencimento',
        sortorder: 'desc',
      },
      { pageSize: TITULOS_POR_PAGINA, maxPages: PAGINAS_POR_FORNECEDOR },
    );

    const pagamentos = brutos
      .map((raw) => pagamentoDoTitulo(raw, idFornecedor))
      .filter((p): p is PagamentoAoPatrocinado => p !== null);

    // Base que ignore o filtro devolve os títulos de todo mundo, e conferir o
    // fornecedor de novo (em `pagamentoDoTitulo`) os descarta. Se não sobrou
    // nenhum porque todos eram de outros, isso é aviso, e não "nunca recebeu".
    const deOutros = brutos.filter(
      (raw) => parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id) !== idFornecedor,
    ).length;
    if (brutos.length > 0 && deOutros === brutos.length) {
      this.logger.warn(`O filtro por fornecedor ${idFornecedor} não pegou no fn_apagar.`);
      throw new Error(
        'o IXC devolveu títulos de outros fornecedores ao filtrar por este, e por ' +
          'isso os pagamentos não puderam ser lidos',
      );
    }

    return ordenarPagamentos(pagamentos);
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
   * O fornecedor não paga outro patrocinado. A coluna é única, e o banco
   * recusaria de qualquer jeito — aqui a recusa vem com o nome de quem já está
   * ligado, que é o que a pessoa precisa para decidir.
   */
  private async exigirFornecedorLivre(idFornecedorIxc: number, patrocinadoId?: string) {
    const dono = await this.prisma.patrocinado.findUnique({
      where: { idFornecedorIxc },
      select: { id: true, nome: true },
    });
    if (dono && dono.id !== patrocinadoId) {
      throw new BadRequestException(
        `Este fornecedor já recebe pelo patrocínio de ${dono.nome}. Cada ` +
          'fornecedor paga um patrocinado só.',
      );
    }
  }

  /** Duas telas ligando o mesmo fornecedor ao mesmo tempo: o banco desempata. */
  private async comFornecedorUnico<T>(gravar: () => Promise<T>): Promise<T> {
    try {
      return await gravar();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(
          'Este fornecedor acabou de ser ligado a outro patrocinado. Escolha outro.',
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
  // O avulso não tem valor por mês: virar avulso apaga o que havia.
  const semValorMensal = dto.tipo === TipoDePatrocinio.AVULSO;
  return {
    ...(dto.tipo === undefined ? {} : { tipo: dto.tipo }),
    ...(semValorMensal ? { valorMensal: null } : {}),
    projeto: texto(dto.projeto),
    cpfCnpj: texto(dto.cpfCnpj),
    responsavel: texto(dto.responsavel),
    telefone: texto(dto.telefone),
    email: texto(dto.email),
    instagram: texto(dto.instagram),
    cidade: texto(dto.cidade),
    observacoes: texto(dto.observacoes),
    ...(dto.valorMensal === undefined || semValorMensal
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

/** A falha do IXC como frase para a tela. */
function motivo(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err);
  return `Não deu para ler os pagamentos no IXC: ${texto}`;
}
