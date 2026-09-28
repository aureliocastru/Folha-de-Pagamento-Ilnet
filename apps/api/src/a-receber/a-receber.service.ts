import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CriarAReceberDto,
  EditarAReceberDto,
} from './dto/a-receber.dto';

/** Um lembrete de quem deve, como a tela o recebe. */
export interface AReceber {
  id: string;
  pessoa: string;
  valor: number;
  observacao: string | null;
  recebidoEm: Date | null;
  createdAt: Date;
}

/** Quantos já pagos a tela mostra embaixo, para desfazer um engano. */
const RECEBIDOS_NA_TELA = 30;

/**
 * A aba Controle: quem deve a quem está logado, e quanto.
 *
 * É lembrete, e só isso — não tem data de receber, não soma em painel nenhum e
 * não vai ao IXC. E é de quem cadastrou: toda consulta e toda escrita passam
 * pelo id do login, e o de outro login responde como se não existisse.
 */
@Injectable()
export class AReceberService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(usuarioId: string): Promise<{
    devendo: AReceber[];
    recebidos: AReceber[];
  }> {
    const [devendo, recebidos] = await Promise.all([
      this.prisma.dinheiroAReceber.findMany({
        where: { usuarioId, recebidoEm: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dinheiroAReceber.findMany({
        where: { usuarioId, recebidoEm: { not: null } },
        orderBy: { recebidoEm: 'desc' },
        take: RECEBIDOS_NA_TELA,
      }),
    ]);
    return { devendo: devendo.map(paraTela), recebidos: recebidos.map(paraTela) };
  }

  async criar(usuarioId: string, dto: CriarAReceberDto): Promise<AReceber> {
    const criado = await this.prisma.dinheiroAReceber.create({
      data: {
        usuarioId,
        pessoa: dto.pessoa.trim(),
        valor: new Prisma.Decimal(dto.valor),
        observacao: dto.observacao?.trim() || null,
      },
    });
    return paraTela(criado);
  }

  async editar(
    usuarioId: string,
    id: string,
    dto: EditarAReceberDto,
  ): Promise<AReceber> {
    await this.doLogado(usuarioId, id);
    const salvo = await this.prisma.dinheiroAReceber.update({
      where: { id },
      data: {
        ...(dto.pessoa === undefined ? {} : { pessoa: dto.pessoa.trim() }),
        ...(dto.valor === undefined
          ? {}
          : { valor: new Prisma.Decimal(dto.valor) }),
        ...(dto.observacao === undefined
          ? {}
          : { observacao: dto.observacao?.trim() || null }),
      },
    });
    return paraTela(salvo);
  }

  async marcarRecebido(
    usuarioId: string,
    id: string,
    recebido: boolean,
  ): Promise<AReceber> {
    await this.doLogado(usuarioId, id);
    const salvo = await this.prisma.dinheiroAReceber.update({
      where: { id },
      data: { recebidoEm: recebido ? new Date() : null },
    });
    return paraTela(salvo);
  }

  async apagar(usuarioId: string, id: string): Promise<void> {
    await this.doLogado(usuarioId, id);
    await this.prisma.dinheiroAReceber.delete({ where: { id } });
  }

  /** O lembrete, se for deste login. O de outro responde como inexistente. */
  private async doLogado(usuarioId: string, id: string) {
    const achado = await this.prisma.dinheiroAReceber.findFirst({
      where: { id, usuarioId },
      select: { id: true },
    });
    if (!achado) throw new NotFoundException('Este lembrete não existe mais.');
  }
}

function paraTela(r: {
  id: string;
  pessoa: string;
  valor: Prisma.Decimal;
  observacao: string | null;
  recebidoEm: Date | null;
  createdAt: Date;
}): AReceber {
  return {
    id: r.id,
    pessoa: r.pessoa,
    valor: Number(r.valor),
    observacao: r.observacao,
    recebidoEm: r.recebidoEm,
    createdAt: r.createdAt,
  };
}
