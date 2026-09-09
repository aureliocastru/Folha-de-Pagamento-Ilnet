import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Um empréstimo, como a tela o lê. */
export interface EmprestimoNaTela {
  id: string;
  quem: string;
  funcionarioId: string | null;
  saiuEm: Date;
  previsaoDeVolta: Date | null;
  voltouEm: Date | null;
  observacao: string | null;
  registradoPor: string | null;
  recebidoPor: string | null;
  /** Está fora e o dia combinado já passou. */
  atrasado: boolean;
  /** Há quantos dias ela saiu. */
  diasFora: number;
}

/** Uma ferramenta com a resposta que a tela existe para dar. */
export interface FerramentaNaTela {
  id: string;
  nome: string;
  patrimonio: string | null;
  descricao: string | null;
  ixcProdutoId: number | null;
  ativa: boolean;
  /** Quem está com ela agora. Null = está no almoxarifado. */
  comQuem: EmprestimoNaTela | null;
  /** Quantas vezes ela já saiu. */
  saidas: number;
}

/**
 * O caderno de ferramentas: quem levou o quê, e quando devolveu.
 *
 * A pergunta desta tela não é "quantas máquinas de fusão temos" — essa o
 * estoque responde. É **"quem está com ela?"**, e essa não se responde com
 * saldo: uma ferramenta que saiu continua existindo, e o que mudou foi o lugar
 * dela. Por isso não é baixa de estoque, é uma linha de saída que espera uma
 * linha de volta.
 *
 * É registro desta casa, e não do IXC — de propósito. O que o IXC tem é
 * comodato de cliente e produto consumido em ordem de serviço; nenhum dos dois
 * é a chave de fenda que o técnico levou na sexta e não devolveu.
 */
@Injectable()
export class FerramentasService {
  private readonly logger = new Logger(FerramentasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(opcoes: {
    busca?: string;
    incluirBaixadas?: boolean;
    /** Só as que estão na rua agora. */
    soEmprestadas?: boolean;
  }): Promise<FerramentaNaTela[]> {
    const busca = opcoes.busca?.trim();

    const ferramentas = await this.prisma.ferramenta.findMany({
      where: {
        ...(opcoes.incluirBaixadas ? {} : { ativa: true }),
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { patrimonio: { contains: busca, mode: 'insensitive' } },
                { descricao: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      include: {
        // Só o empréstimo aberto: o histórico inteiro de trinta ferramentas
        // seria uma lista dentro de outra para responder "onde ela está".
        emprestimos: {
          where: { voltouEm: null },
          orderBy: { saiuEm: 'desc' },
          take: 1,
        },
        _count: { select: { emprestimos: true } },
      },
    });

    const lista = ferramentas.map((f) => ({
      id: f.id,
      nome: f.nome,
      patrimonio: f.patrimonio,
      descricao: f.descricao,
      ixcProdutoId: f.ixcProdutoId,
      ativa: f.ativa,
      comQuem: f.emprestimos[0] ? naTela(f.emprestimos[0]) : null,
      saidas: f._count.emprestimos,
    }));

    return opcoes.soEmprestadas ? lista.filter((f) => f.comQuem) : lista;
  }

  /**
   * Só os nomes de quem trabalha aqui, para o campo "quem levou".
   *
   * Serve pelo almoxarifado, e não pelo `/funcionarios` do módulo folha, de
   * propósito: aquela rota devolve a ficha inteira — salário, PIX, adiantamento
   * —, e quem abre o almoxarifado não tem por que enxergar isso. Aqui saem três
   * campos: id, nome e apelido.
   */
  async pessoas(): Promise<
    Array<{ id: string; nome: string; apelido: string | null }>
  > {
    return this.prisma.funcionario.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, apelido: true },
      orderBy: { nome: 'asc' },
    });
  }

  /** O histórico de uma ferramenta, do mais recente para o mais antigo. */
  async historico(id: string): Promise<EmprestimoNaTela[]> {
    await this.buscar(id);
    const emprestimos = await this.prisma.emprestimoDeFerramenta.findMany({
      where: { ferramentaId: id },
      orderBy: { saiuEm: 'desc' },
      take: 100,
    });
    return emprestimos.map(naTela);
  }

  async criar(dados: {
    nome: string;
    patrimonio?: string | null;
    descricao?: string | null;
    ixcProdutoId?: number | null;
  }): Promise<FerramentaNaTela> {
    await this.recusarPatrimonioRepetido(dados.patrimonio ?? null);

    const criada = await this.prisma.ferramenta.create({
      data: {
        nome: dados.nome,
        patrimonio: dados.patrimonio ?? null,
        descricao: dados.descricao ?? null,
        ixcProdutoId: dados.ixcProdutoId ?? null,
      },
    });
    this.logger.log(`Ferramenta cadastrada: ${criada.nome}`);

    return {
      ...criada,
      comQuem: null,
      saidas: 0,
    };
  }

  async atualizar(
    id: string,
    dados: {
      nome?: string;
      patrimonio?: string | null;
      descricao?: string | null;
      ixcProdutoId?: number | null;
      ativa?: boolean;
    },
  ): Promise<FerramentaNaTela> {
    const atual = await this.buscar(id);

    if (
      dados.patrimonio !== undefined &&
      dados.patrimonio !== atual.patrimonio
    ) {
      await this.recusarPatrimonioRepetido(dados.patrimonio, id);
    }

    await this.prisma.ferramenta.update({ where: { id }, data: dados });
    const [nova] = await this.listar({ incluirBaixadas: true }).then((l) =>
      l.filter((f) => f.id === id),
    );
    return nova;
  }

  async excluir(id: string): Promise<void> {
    const ferramenta = await this.prisma.ferramenta.findUnique({
      where: { id },
      include: { _count: { select: { emprestimos: true } } },
    });
    if (!ferramenta) throw new NotFoundException('Ferramenta não encontrada');

    if (ferramenta._count.emprestimos > 0) {
      /*
       * Ferramenta que já saiu alguma vez não se apaga: o caderno é o registro
       * de quem levou o quê, e apagar a linha apagaria junto a resposta de
       * "quem ficou com ela". O caminho é dar baixa — ela some da lista de
       * emprestar e o histórico continua de pé.
       */
      throw new ConflictException(
        `"${ferramenta.nome}" já saiu ${ferramenta._count.emprestimos} vez(es). ` +
          'Dê baixa nela em vez de apagar — assim o histórico de quem a levou ' +
          'continua guardado.',
      );
    }

    await this.prisma.ferramenta.delete({ where: { id } });
    this.logger.log(`Ferramenta apagada: ${ferramenta.nome}`);
  }

  /**
   * Entrega a ferramenta a alguém.
   *
   * O nome vai escrito na linha mesmo havendo funcionário: é o que sobra
   * quando o cadastro muda, e é o que permite entregar ao terceirizado que não
   * está em cadastro nenhum.
   */
  async emprestar(
    id: string,
    dados: {
      funcionarioId?: string | null;
      quem?: string;
      previsaoDeVolta?: string;
      observacao?: string | null;
    },
    registradoPor?: string,
  ): Promise<FerramentaNaTela> {
    const ferramenta = await this.buscar(id);
    if (!ferramenta.ativa) {
      throw new BadRequestException(
        `"${ferramenta.nome}" está baixada. Religue-a antes de emprestar.`,
      );
    }

    let quem = dados.quem?.trim() ?? '';
    if (dados.funcionarioId) {
      const funcionario = await this.prisma.funcionario.findUnique({
        where: { id: dados.funcionarioId },
        select: { nome: true, apelido: true },
      });
      if (!funcionario) {
        throw new NotFoundException('Funcionário não encontrado');
      }
      quem = quem || funcionario.apelido || funcionario.nome;
    }
    if (quem.length < 2) {
      throw new BadRequestException('Diga quem está levando a ferramenta.');
    }

    try {
      await this.prisma.emprestimoDeFerramenta.create({
        data: {
          ferramentaId: id,
          funcionarioId: dados.funcionarioId ?? null,
          quem,
          previsaoDeVolta: dados.previsaoDeVolta
            ? dataUtc(dados.previsaoDeVolta)
            : null,
          observacao: dados.observacao ?? null,
          registradoPor: registradoPor ?? null,
        },
      });
    } catch (e) {
      /*
       * O índice parcial do banco recusa o segundo empréstimo aberto da mesma
       * ferramenta. Sem esta tradução, dois cliques no botão devolveriam um
       * erro cru de chave duplicada — e a tela diria "erro" onde a resposta
       * certa é "ela já está com alguém".
       */
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const aberto = await this.prisma.emprestimoDeFerramenta.findFirst({
          where: { ferramentaId: id, voltouEm: null },
          select: { quem: true },
        });
        throw new ConflictException(
          `"${ferramenta.nome}" já está com ${aberto?.quem ?? 'alguém'}. ` +
            'Registre a devolução antes de emprestar de novo.',
        );
      }
      throw e;
    }

    this.logger.log(`Ferramenta ${ferramenta.nome} saiu com ${quem}`);
    return this.uma(id);
  }

  /** Recebe a ferramenta de volta. */
  async devolver(
    id: string,
    dados: { observacao?: string | null },
    recebidoPor?: string,
  ): Promise<FerramentaNaTela> {
    const ferramenta = await this.buscar(id);

    const aberto = await this.prisma.emprestimoDeFerramenta.findFirst({
      where: { ferramentaId: id, voltouEm: null },
      orderBy: { saiuEm: 'desc' },
    });
    if (!aberto) {
      throw new BadRequestException(
        `"${ferramenta.nome}" não está com ninguém — ela já está no almoxarifado.`,
      );
    }

    await this.prisma.emprestimoDeFerramenta.update({
      where: { id: aberto.id },
      data: {
        voltouEm: new Date(),
        recebidoPor: recebidoPor ?? null,
        // A observação da volta não apaga a da saída: as duas contam coisas
        // diferentes ("foi para a obra do Lago Verde" e "voltou sem a bateria").
        observacao: dados.observacao
          ? [aberto.observacao, dados.observacao].filter(Boolean).join(' — ')
          : aberto.observacao,
      },
    });

    this.logger.log(`Ferramenta ${ferramenta.nome} voltou de ${aberto.quem}`);
    return this.uma(id);
  }

  private async uma(id: string): Promise<FerramentaNaTela> {
    const [f] = await this.listar({ incluirBaixadas: true }).then((l) =>
      l.filter((x) => x.id === id),
    );
    return f;
  }

  private async buscar(id: string) {
    const f = await this.prisma.ferramenta.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Ferramenta não encontrada');
    return f;
  }

  private async recusarPatrimonioRepetido(
    patrimonio: string | null,
    exceto?: string,
  ): Promise<void> {
    if (!patrimonio) return;
    const existe = await this.prisma.ferramenta.findFirst({
      where: {
        patrimonio: { equals: patrimonio, mode: 'insensitive' },
        ...(exceto ? { id: { not: exceto } } : {}),
      },
      select: { nome: true },
    });
    if (existe) {
      throw new ConflictException(
        `O patrimônio ${patrimonio} já é de "${existe.nome}".`,
      );
    }
  }
}

const DIA_MS = 24 * 60 * 60 * 1000;

function naTela(e: {
  id: string;
  quem: string;
  funcionarioId: string | null;
  saiuEm: Date;
  previsaoDeVolta: Date | null;
  voltouEm: Date | null;
  observacao: string | null;
  registradoPor: string | null;
  recebidoPor: string | null;
}): EmprestimoNaTela {
  const fim = e.voltouEm ?? new Date();
  return {
    ...e,
    // Atraso só existe para o que ainda está fora: a que voltou depois do dia
    // combinado voltou, e cobrá-la para sempre no histórico não muda nada.
    atrasado:
      e.voltouEm === null &&
      e.previsaoDeVolta !== null &&
      e.previsaoDeVolta.getTime() < Date.now(),
    diasFora: Math.max(
      0,
      Math.floor((fim.getTime() - e.saiuEm.getTime()) / DIA_MS),
    ),
  };
}

/** "AAAA-MM-DD" → meia-noite em UTC, como as datas desta base são gravadas. */
function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}
