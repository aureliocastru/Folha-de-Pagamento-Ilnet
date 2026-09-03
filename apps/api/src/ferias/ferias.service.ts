import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { extrairItensPdf } from '../pdf/pdf';
import { PrismaService } from '../prisma/prisma.service';
import { GravarPrevisaoDto, MarcarFeriasDto } from './dto/ferias.dto';
import {
  diasEntre,
  estaDeFerias,
  fimDasFerias,
  nomeComparavel,
  situacaoDeFerias,
  soData,
  type SituacaoFerias,
} from './ferias.calc';
import {
  conferir,
  lerPrevisaoDeFerias,
  PrevisaoIlegivelError,
  type PrevisaoLida,
} from './ferias.parse';

/** O que a tela mostra depois de ler o PDF, antes de alguém confirmar. */
export interface LeituraDaPrevisao {
  previsao: PrevisaoLida;
  arquivoNome: string;
  /** O que foi lido não bate com o total impresso no rodapé. */
  divergencia: string | null;
  /** Já existe previsão desse dia — gravar substitui a que está valendo. */
  jaExiste: { id: string; arquivoNome: string; itens: number } | null;
}

/** Uma pessoa na fila, com as contas do dia de hoje já feitas. */
export interface PessoaNaFila {
  itemId: string;
  ordem: number;
  codigo: string;
  nome: string;
  cargo: string | null;
  funcionarioId: string | null;
  admissao: Date | null;
  periodoInicio: Date;
  periodoFim: Date;
  dataLimite: Date;
  diasDireito: number;
  diasAcumulados: number | null;
  situacao: SituacaoFerias;
  /** Dias até a data limite; negativo = já passou dela. */
  diasAteLimite: number;
  /** Dias até poder sair; 0 = já pode. */
  diasParaLiberar: number;
  /** As férias já marcadas para este período aquisitivo, se houver. */
  ferias: FeriasResumo | null;
}

export interface FeriasResumo {
  id: string;
  inicio: Date;
  fim: Date;
  dias: number;
  observacao: string | null;
  /** Está de férias hoje (já começou e ainda não acabou). */
  emCurso: boolean;
}

export interface FilaDeFerias {
  /** De onde a fila veio; null = nenhuma previsão foi enviada ainda. */
  previsao: {
    id: string;
    dataRelatorio: Date;
    empresa: string | null;
    arquivoNome: string;
    /** Dias desde o relatório — previsão velha merece uma nova remessa. */
    diasDesdeORelatorio: number;
  } | null;
  /** Quem ainda não saiu, do prazo mais curto para o mais longo. */
  fila: PessoaNaFila[];
  /** Quem já foi mandado para férias neste período aquisitivo. */
  marcadas: PessoaNaFila[];
}

@Injectable()
export class FeriasService {
  private readonly logger = new Logger(FeriasService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lê o PDF e devolve o que entendeu — **sem gravar nada**. Parser de PDF
   * erra, e aqui se decide quem sai de férias: quem confere é a pessoa, na
   * tela, como já é com as guias de imposto.
   */
  async ler(arquivo: Express.Multer.File): Promise<LeituraDaPrevisao> {
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException('Nenhum arquivo recebido.');
    }

    let previsao: PrevisaoLida;
    try {
      const itens = await extrairItensPdf(new Uint8Array(arquivo.buffer));
      previsao = lerPrevisaoDeFerias(itens);
    } catch (err) {
      if (err instanceof PrevisaoIlegivelError) {
        throw new BadRequestException(err.message);
      }
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao ler ${arquivo.originalname}: ${motivo}`);
      throw new BadRequestException(`Não consegui abrir este PDF: ${motivo}`);
    }

    const existente = await this.prisma.previsaoFerias.findUnique({
      where: { dataRelatorio: previsao.dataRelatorio },
      select: { id: true, arquivoNome: true, _count: { select: { itens: true } } },
    });

    return {
      previsao,
      arquivoNome: arquivo.originalname,
      divergencia: conferir(previsao),
      jaExiste: existente
        ? {
            id: existente.id,
            arquivoNome: existente.arquivoNome,
            itens: existente._count.itens,
          }
        : null,
    };
  }

  /**
   * Grava a previsão conferida na tela. Uma remessa por dia de relatório: subir
   * o mesmo arquivo de novo substitui, porque duas filas ao mesmo tempo seriam
   * duas respostas diferentes para "quem é o próximo".
   */
  async gravar(dto: GravarPrevisaoDto, usuarioId?: string) {
    if (dto.itens.length === 0) {
      throw new BadRequestException('A previsão não tem nenhum empregado.');
    }

    const dataRelatorio = soData(new Date(dto.dataRelatorio));
    const vinculos = await this.acharFuncionarios(dto.itens.map((i) => i.nome));

    return this.prisma.$transaction(async (tx) => {
      await tx.previsaoFerias.deleteMany({ where: { dataRelatorio } });
      return tx.previsaoFerias.create({
        data: {
          dataRelatorio,
          empresa: dto.empresa || null,
          cnpj: dto.cnpj || null,
          mesesLimite: dto.mesesLimite ?? null,
          arquivoNome: dto.arquivoNome,
          criadoPor: usuarioId ?? null,
          itens: {
            create: dto.itens.map((item) => ({
              ordem: item.ordem,
              codigo: item.codigo,
              nome: item.nome,
              cargo: item.cargo || null,
              admissao: item.admissao ? soData(new Date(item.admissao)) : null,
              periodoInicio: soData(new Date(item.periodoInicio)),
              periodoFim: soData(new Date(item.periodoFim)),
              dataLimite: soData(new Date(item.dataLimite)),
              diasDireito: new Prisma.Decimal(item.diasDireito),
              diasAcumulados:
                item.diasAcumulados == null
                  ? null
                  : new Prisma.Decimal(item.diasAcumulados),
              diasRestantes:
                item.diasRestantes == null
                  ? null
                  : new Prisma.Decimal(item.diasRestantes),
              funcionarioId: vinculos.get(nomeComparavel(item.nome)) ?? null,
            })),
          },
        },
        include: { _count: { select: { itens: true } } },
      });
    });
  }

  /**
   * A fila de hoje: quem é o próximo, quanto prazo cada um ainda tem e quem já
   * está de férias. As contas são refeitas a cada consulta — a previsão é de um
   * dia, e o que interessa é quantos dias faltam agora.
   */
  async fila(hoje = new Date()): Promise<FilaDeFerias> {
    const previsao = await this.prisma.previsaoFerias.findFirst({
      orderBy: [{ dataRelatorio: 'desc' }, { createdAt: 'desc' }],
      include: { itens: { orderBy: { dataLimite: 'asc' } } },
    });
    if (!previsao) return { previsao: null, fila: [], marcadas: [] };

    const marcadas = await this.prisma.feriasMarcada.findMany({
      where: { codigo: { in: previsao.itens.map((i) => i.codigo) } },
    });
    const porPeriodo = new Map(
      marcadas.map((m) => [chaveDoPeriodo(m.codigo, m.periodoFim), m]),
    );

    /*
     * Quem está fora agora está fora, mesmo que o relatório novo já o tenha
     * virado de período.
     *
     * A marca se prende ao período aquisitivo — é o que impede mandar duas
     * vezes pelo mesmo. Só que a contabilidade manda o relatório todo mês, e
     * quem saiu de férias aparece nele já rolado para o período seguinte: o
     * `periodoFim` muda, a chave deixa de bater e a marca sumia da tela. A
     * pessoa voltava para a fila como disponível **enquanto ainda estava de
     * férias** — e a fila é o que responde "quem é o próximo".
     *
     * Então, não achando marca do período de agora, vale a que estiver em
     * curso, de qualquer período. Férias terminadas não entram: aí a pessoa
     * voltou mesmo, e o período novo é uma fila nova, que é o certo.
     */
    const emCurso = new Map(
      marcadas.filter((m) => estaDeFerias(m, hoje)).map((m) => [m.codigo, m]),
    );

    const pessoas = previsao.itens.map((item) => {
      const marcada =
        porPeriodo.get(chaveDoPeriodo(item.codigo, item.periodoFim)) ??
        emCurso.get(item.codigo);
      return {
        itemId: item.id,
        ordem: item.ordem,
        codigo: item.codigo,
        nome: item.nome,
        cargo: item.cargo,
        funcionarioId: item.funcionarioId,
        admissao: item.admissao,
        periodoInicio: item.periodoInicio,
        periodoFim: item.periodoFim,
        dataLimite: item.dataLimite,
        diasDireito: Number(item.diasDireito),
        diasAcumulados:
          item.diasAcumulados === null ? null : Number(item.diasAcumulados),
        ...situacaoDeFerias(item, hoje),
        ferias: marcada
          ? {
              id: marcada.id,
              inicio: marcada.inicio,
              fim: marcada.fim,
              dias: marcada.dias,
              observacao: marcada.observacao,
              emCurso: estaDeFerias(marcada, hoje),
            }
          : null,
      };
    });

    return {
      previsao: {
        id: previsao.id,
        dataRelatorio: previsao.dataRelatorio,
        empresa: previsao.empresa,
        arquivoNome: previsao.arquivoNome,
        diasDesdeORelatorio: Math.max(
          0,
          diasEntre(previsao.dataRelatorio, hoje),
        ),
      },
      // Ordem da fila: menor prazo primeiro. É a mesma do relatório, mas
      // recontada por data limite para o dia de hoje mandar, não o do PDF.
      fila: pessoas
        .filter((p) => !p.ferias)
        .sort((a, b) => a.diasAteLimite - b.diasAteLimite),
      marcadas: pessoas
        .filter((p) => p.ferias)
        .sort(
          (a, b) =>
            (a.ferias?.inicio.getTime() ?? 0) - (b.ferias?.inicio.getTime() ?? 0),
        ),
    };
  }

  /**
   * Manda alguém para férias: registra quem saiu, quando volta e por qual
   * período aquisitivo. Não paga nada nem mexe na folha — as férias são pagas
   * pela contabilidade; aqui fica quem está fora e até quando.
   */
  async marcar(dto: MarcarFeriasDto, usuarioId?: string, hoje = new Date()) {
    const item = await this.prisma.itemPrevisaoFerias.findUnique({
      where: { id: dto.itemId },
    });
    if (!item) throw new NotFoundException('Pessoa não está na previsão atual');

    const { situacao, diasParaLiberar } = situacaoDeFerias(item, hoje);
    if (situacao === 'AGUARDANDO') {
      throw new BadRequestException(
        `${item.nome} ainda não completou o período aquisitivo (fecha em ${formatarDia(item.periodoFim)}, daqui a ${diasParaLiberar} dia(s)). Antes disso as férias não podem ser concedidas.`,
      );
    }

    const inicio = soData(new Date(dto.inicio));
    try {
      return await this.prisma.feriasMarcada.create({
        data: {
          codigo: item.codigo,
          nome: item.nome,
          funcionarioId: item.funcionarioId,
          inicio,
          fim: fimDasFerias(inicio, dto.dias),
          dias: dto.dias,
          periodoInicio: item.periodoInicio,
          periodoFim: item.periodoFim,
          observacao: dto.observacao?.trim() || null,
          criadoPor: usuarioId ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `${item.nome} já foi mandado para férias por este período aquisitivo.`,
        );
      }
      throw err;
    }
  }

  /** Desfaz o "mandar para férias" — a pessoa volta para a fila. */
  async desmarcar(id: string) {
    const marcada = await this.prisma.feriasMarcada.findUnique({
      where: { id },
    });
    if (!marcada) throw new NotFoundException('Registro de férias não encontrado');
    await this.prisma.feriasMarcada.delete({ where: { id } });
  }

  /** As remessas já enviadas, da mais nova para a mais velha. */
  listarPrevisoes() {
    return this.prisma.previsaoFerias.findMany({
      orderBy: [{ dataRelatorio: 'desc' }],
      take: 24,
      include: { _count: { select: { itens: true } } },
    });
  }

  async removerPrevisao(id: string) {
    const previsao = await this.prisma.previsaoFerias.findUnique({
      where: { id },
    });
    if (!previsao) throw new NotFoundException('Previsão não encontrada');
    await this.prisma.previsaoFerias.delete({ where: { id } });
  }

  /**
   * Liga cada nome do relatório ao cadastro daqui, quando existir. O PDF da
   * contabilidade não traz CPF, então o nome é o que há — e por isso o vínculo
   * é só uma comodidade (abrir a ficha da pessoa), nunca condição para nada.
   */
  private async acharFuncionarios(
    nomes: string[],
  ): Promise<Map<string, string>> {
    const funcionarios = await this.prisma.funcionario.findMany({
      select: { id: true, nome: true },
    });
    const procurados = new Set(nomes.map(nomeComparavel));

    const achados = new Map<string, string>();
    for (const f of funcionarios) {
      const chave = nomeComparavel(f.nome);
      if (procurados.has(chave) && !achados.has(chave)) {
        achados.set(chave, f.id);
      }
    }
    return achados;
  }
}

function chaveDoPeriodo(codigo: string, periodoFim: Date): string {
  return `${codigo}|${periodoFim.toISOString().slice(0, 10)}`;
}

function formatarDia(d: Date): string {
  return d.toISOString().slice(0, 10).split('-').reverse().join('/');
}
