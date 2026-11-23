import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ItemDaRevisaoNaTela {
  id: string;
  descricao: string;
  quantidade: number;
  /** De cada unidade. Nulo quando não se sabe. */
  preco: number | null;
  /** Quantidade vezes o preço; nulo sem preço. */
  total: number | null;
}

export interface RevisaoNaTela {
  id: string;
  titulo: string;
  data: string;
  medidor: number | null;
  oficina: string | null;
  observacao: string | null;
  itens: ItemDaRevisaoNaTela[];
  /** A soma das linhas que têm preço. */
  total: number;
}

export interface DadosDaRevisao {
  titulo: string;
  data: string;
  medidor?: number | null;
  oficina?: string | null;
  observacao?: string | null;
  itens: Array<{ descricao: string; quantidade: number; preco?: number | null }>;
}

type RevisaoComItens = Prisma.RevisaoDoVeiculoGetPayload<{ include: { itens: true } }>;

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Quanto vale a linha: quantidade vezes o preço de cada, em centavos exatos. */
export function totalDaLinha(quantidade: Prisma.Decimal.Value, preco: Prisma.Decimal.Value | null): number | null {
  if (preco == null) return null;
  return new Prisma.Decimal(quantidade).times(preco).toDecimalPlaces(2).toNumber();
}

/** A soma das linhas, em centavos exatos. Linha sem preço não entra. */
export function totalDaRevisao(
  linhas: Array<{ quantidade: Prisma.Decimal.Value; preco: Prisma.Decimal.Value | null }>,
): number {
  return linhas
    .reduce(
      (soma, l) => (l.preco == null ? soma : soma.plus(new Prisma.Decimal(l.quantidade).times(l.preco).toDecimalPlaces(2))),
      new Prisma.Decimal(0),
    )
    .toNumber();
}

function naTela(r: RevisaoComItens): RevisaoNaTela {
  const itens = [...r.itens].sort((a, b) => a.ordem - b.ordem);
  return {
    id: r.id,
    titulo: r.titulo,
    data: dia(r.data),
    medidor: r.medidor == null ? null : Number(r.medidor),
    oficina: r.oficina,
    observacao: r.observacao,
    itens: itens.map((i) => ({
      id: i.id,
      descricao: i.descricao,
      quantidade: Number(i.quantidade),
      preco: i.preco == null ? null : Number(i.preco),
      total: totalDaLinha(i.quantidade, i.preco),
    })),
    total: totalDaRevisao(itens),
  };
}

function dataDaRevisao(iso: string): Date {
  const [ano, mes, d] = iso.slice(0, 10).split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, d));
  const agora = new Date();
  const hoje = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (data.getTime() > hoje + 24 * 60 * 60 * 1000) {
    throw new BadRequestException('A revisão não pode ter data no futuro.');
  }
  return data;
}

const limpo = (t?: string | null) => t?.trim() || null;

/**
 * As revisões de cada veículo: o que se trocou e se pôs, quantas peças e a que
 * preço — anotado só para ficar registrado (pedido do dono, 23/11/2026, para a
 * revisão dos 70 mil km da Hilux). Nada aqui paga nem muda a lista de itens da
 * manutenção.
 */
@Injectable()
export class RevisoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** As revisões do veículo, da mais recente para a mais antiga. */
  async doVeiculo(veiculoId: string): Promise<RevisaoNaTela[]> {
    const revisoes = await this.prisma.revisaoDoVeiculo.findMany({
      where: { veiculoId },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      include: { itens: true },
    });
    return revisoes.map(naTela);
  }

  async criar(veiculoId: string, dados: DadosDaRevisao, usuarioId?: string): Promise<RevisaoNaTela> {
    const veiculo = await this.prisma.veiculo.findUnique({ where: { id: veiculoId }, select: { id: true } });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    const criada = await this.prisma.revisaoDoVeiculo.create({
      data: {
        veiculoId,
        ...camposDa(dados),
        criadoPor: usuarioId ?? null,
        itens: { create: linhasDa(dados) },
      },
      include: { itens: true },
    });
    return naTela(criada);
  }

  /** Troca a revisão toda: os campos e as linhas. É o que o formulário manda. */
  async atualizar(revisaoId: string, dados: DadosDaRevisao): Promise<RevisaoNaTela> {
    await this.buscar(revisaoId);
    const [, atualizada] = await this.prisma.$transaction([
      this.prisma.itemDaRevisao.deleteMany({ where: { revisaoId } }),
      this.prisma.revisaoDoVeiculo.update({
        where: { id: revisaoId },
        data: { ...camposDa(dados), itens: { create: linhasDa(dados) } },
        include: { itens: true },
      }),
    ]);
    return naTela(atualizada);
  }

  async apagar(revisaoId: string): Promise<void> {
    await this.buscar(revisaoId);
    await this.prisma.revisaoDoVeiculo.delete({ where: { id: revisaoId } });
  }

  private async buscar(revisaoId: string) {
    const revisao = await this.prisma.revisaoDoVeiculo.findUnique({ where: { id: revisaoId } });
    if (!revisao) throw new NotFoundException('Essa revisão não existe mais.');
    return revisao;
  }
}

function camposDa(dados: DadosDaRevisao) {
  return {
    titulo: dados.titulo.trim(),
    data: dataDaRevisao(dados.data),
    medidor: dados.medidor == null ? null : new Prisma.Decimal(dados.medidor),
    oficina: limpo(dados.oficina),
    observacao: limpo(dados.observacao),
  };
}

function linhasDa(dados: DadosDaRevisao) {
  return dados.itens.map((i, ordem) => ({
    descricao: i.descricao.trim(),
    quantidade: new Prisma.Decimal(i.quantidade),
    preco: i.preco == null ? null : new Prisma.Decimal(i.preco),
    ordem,
  }));
}
