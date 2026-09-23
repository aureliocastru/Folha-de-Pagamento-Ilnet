import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TipoVeiculo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  itensPadrao,
  NOMES_CONHECIDOS,
  ordemDeAtencao,
  situacaoDoItem,
  type SituacaoDoItem,
} from './manutencao';

export interface TrocaNaTela {
  id: string;
  medidor: number | null;
  data: string;
  observacao: string | null;
}

export interface ItemNaTela {
  id: string;
  nome: string;
  intervaloMedidor: number | null;
  intervaloMeses: number | null;
  ultimaTrocaMedidor: number | null;
  ultimaTrocaEm: string | null;
  observacao: string | null;
  situacao: SituacaoDoItem;
  trocas: TrocaNaTela[];
}

export interface ManutencaoDoVeiculo {
  veiculo: { id: string; apelido: string; tipo: TipoVeiculo };
  /** A máquina conta em horas; o resto, em km. */
  unidade: 'km' | 'h';
  /** O maior km (horas) que o veículo já marcou: abastecimento ou troca. */
  medidorAtual: number | null;
  /** O dia do abastecimento que deu esse número. */
  medidorEm: string | null;
  itens: ItemNaTela[];
  resumo: { vencidos: number; perto: number; semRegistro: number };
  /** Para sugerir o nome ao adicionar um item. */
  nomesConhecidos: string[];
}

/** Quantas trocas de cada item a tela mostra no histórico. */
const TROCAS_NA_TELA = 12;

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const numero = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

function dataUtc(iso: string): Date {
  const [ano, mes, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d));
}

/**
 * A manutenção de cada veículo da frota: a lista do que se troca, quando foi a
 * última vez e quanto falta — contado do km do último abastecimento, de modo
 * que abastecer já atualiza tudo. Ver `manutencao.ts` para as contas.
 */
@Injectable()
export class ManutencaoService {
  constructor(private readonly prisma: PrismaService) {}

  async doVeiculo(veiculoId: string): Promise<ManutencaoDoVeiculo> {
    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id: veiculoId },
      select: { id: true, apelido: true, tipo: true, manutencaoIniciada: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');

    /*
     * Na primeira abertura, a lista padrão do tipo já entra pronta — "já deixa
     * preenchido", pedido do dono. Uma vez só: quem apagar um item não o vê
     * voltar sozinho.
     */
    if (!veiculo.manutencaoIniciada) {
      const padrao = itensPadrao(veiculo.tipo);
      await this.prisma.$transaction([
        this.prisma.itemDeManutencao.createMany({
          data: padrao.map((p, i) => ({
            veiculoId,
            nome: p.nome,
            intervaloMedidor: p.medidor,
            intervaloMeses: p.meses,
            ordem: i,
          })),
        }),
        this.prisma.veiculo.update({
          where: { id: veiculoId },
          data: { manutencaoIniciada: true },
        }),
      ]);
    }

    const [itens, medidor] = await Promise.all([
      this.prisma.itemDeManutencao.findMany({
        where: { veiculoId },
        orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
        include: { trocas: { orderBy: [{ data: 'desc' }, { createdAt: 'desc' }], take: TROCAS_NA_TELA } },
      }),
      this.medidorAtual(veiculoId, veiculo.tipo),
    ]);

    const hoje = hojeUtc();
    const naTela: ItemNaTela[] = itens.map((i) => {
      const ultimaTrocaMedidor = numero(i.ultimaTrocaMedidor);
      return {
        id: i.id,
        nome: i.nome,
        intervaloMedidor: i.intervaloMedidor,
        intervaloMeses: i.intervaloMeses,
        ultimaTrocaMedidor,
        ultimaTrocaEm: dia(i.ultimaTrocaEm),
        observacao: i.observacao,
        situacao: situacaoDoItem(
          {
            intervaloMedidor: i.intervaloMedidor,
            intervaloMeses: i.intervaloMeses,
            ultimaTrocaMedidor,
            ultimaTrocaEm: i.ultimaTrocaEm,
          },
          medidor.valor,
          hoje,
        ),
        trocas: i.trocas.map((t) => ({
          id: t.id,
          medidor: numero(t.medidor),
          data: dia(t.data)!,
          observacao: t.observacao,
        })),
      };
    });
    naTela.sort((a, b) => ordemDeAtencao(a.situacao, b.situacao));

    return {
      veiculo: { id: veiculo.id, apelido: veiculo.apelido, tipo: veiculo.tipo },
      unidade: veiculo.tipo === 'MAQUINA' ? 'h' : 'km',
      medidorAtual: medidor.valor,
      medidorEm: medidor.em,
      itens: naTela,
      resumo: {
        vencidos: naTela.filter((i) => i.situacao.estado === 'VENCIDO').length,
        perto: naTela.filter((i) => i.situacao.estado === 'PERTO').length,
        semRegistro: naTela.filter((i) => i.situacao.estado === 'SEM_REGISTRO').length,
      },
      nomesConhecidos: NOMES_CONHECIDOS,
    };
  }

  async criarItem(
    veiculoId: string,
    dados: { nome: string; intervaloMedidor?: number | null; intervaloMeses?: number | null; observacao?: string },
  ) {
    exigirIntervalo(dados.intervaloMedidor, dados.intervaloMeses);
    const veiculo = await this.prisma.veiculo.findUnique({ where: { id: veiculoId }, select: { id: true } });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    const ultimo = await this.prisma.itemDeManutencao.aggregate({
      where: { veiculoId },
      _max: { ordem: true },
    });
    return this.prisma.itemDeManutencao.create({
      data: {
        veiculoId,
        nome: dados.nome.trim(),
        intervaloMedidor: dados.intervaloMedidor ?? null,
        intervaloMeses: dados.intervaloMeses ?? null,
        observacao: dados.observacao?.trim() || null,
        ordem: (ultimo._max.ordem ?? -1) + 1,
      },
    });
  }

  async atualizarItem(
    itemId: string,
    dados: {
      nome?: string;
      intervaloMedidor?: number | null;
      intervaloMeses?: number | null;
      observacao?: string | null;
    },
  ) {
    const atual = await this.buscarItem(itemId);
    exigirIntervalo(
      dados.intervaloMedidor === undefined ? atual.intervaloMedidor : dados.intervaloMedidor,
      dados.intervaloMeses === undefined ? atual.intervaloMeses : dados.intervaloMeses,
    );
    return this.prisma.itemDeManutencao.update({
      where: { id: itemId },
      data: {
        ...(dados.nome === undefined ? {} : { nome: dados.nome.trim() }),
        ...(dados.intervaloMedidor === undefined ? {} : { intervaloMedidor: dados.intervaloMedidor }),
        ...(dados.intervaloMeses === undefined ? {} : { intervaloMeses: dados.intervaloMeses }),
        ...(dados.observacao === undefined ? {} : { observacao: dados.observacao?.trim() || null }),
      },
    });
  }

  async apagarItem(itemId: string): Promise<void> {
    await this.buscarItem(itemId);
    await this.prisma.itemDeManutencao.delete({ where: { id: itemId } });
  }

  /**
   * Traz de volta o que falta da lista padrão do tipo — pelo nome, sem
   * duplicar o que já está lá. Serve a quem apagou demais, ou trocou o tipo
   * do veículo depois de cadastrado.
   */
  async completarComPadrao(veiculoId: string): Promise<number> {
    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id: veiculoId },
      select: { tipo: true, manutencao: { select: { nome: true, ordem: true } } },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado');
    const tem = new Set(veiculo.manutencao.map((i) => i.nome.trim().toLowerCase()));
    const faltam = itensPadrao(veiculo.tipo).filter((p) => !tem.has(p.nome.toLowerCase()));
    const base = Math.max(-1, ...veiculo.manutencao.map((i) => i.ordem)) + 1;
    if (faltam.length > 0) {
      await this.prisma.itemDeManutencao.createMany({
        data: faltam.map((p, i) => ({
          veiculoId,
          nome: p.nome,
          intervaloMedidor: p.medidor,
          intervaloMeses: p.meses,
          ordem: base + i,
        })),
      });
    }
    await this.prisma.veiculo.update({ where: { id: veiculoId }, data: { manutencaoIniciada: true } });
    return faltam.length;
  }

  /**
   * Registra uma troca feita. Sem km informado, vale o de agora; sem data, hoje.
   *
   * A troca vira a "última" do item só se for a mais recente — lançar hoje uma
   * troca de março, para completar o histórico, não pode fazer o item parecer
   * trocado em março.
   */
  async registrarTroca(
    itemId: string,
    dados: { medidor?: number | null; data?: string; observacao?: string },
    usuarioId?: string,
  ) {
    const item = await this.buscarItem(itemId);
    const veiculo = await this.prisma.veiculo.findUniqueOrThrow({
      where: { id: item.veiculoId },
      select: { tipo: true },
    });
    const data = dados.data ? dataUtc(dados.data) : hojeUtc();
    if (data.getTime() > hojeUtc().getTime() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('A troca não pode ter data no futuro.');
    }
    const medidor =
      dados.medidor === undefined
        ? (await this.medidorAtual(item.veiculoId, veiculo.tipo)).valor
        : dados.medidor;

    const maisRecente = !item.ultimaTrocaEm || data.getTime() >= item.ultimaTrocaEm.getTime();

    const [troca] = await this.prisma.$transaction([
      this.prisma.trocaDeManutencao.create({
        data: {
          itemId,
          medidor: medidor == null ? null : new Prisma.Decimal(medidor),
          data,
          observacao: dados.observacao?.trim() || null,
          criadoPor: usuarioId ?? null,
        },
      }),
      ...(maisRecente
        ? [
            this.prisma.itemDeManutencao.update({
              where: { id: itemId },
              data: {
                ultimaTrocaEm: data,
                ultimaTrocaMedidor: medidor == null ? null : new Prisma.Decimal(medidor),
              },
            }),
          ]
        : []),
    ]);
    return troca;
  }

  /** Desfaz uma troca lançada por engano: a última volta a ser a anterior. */
  async desfazerTroca(trocaId: string): Promise<void> {
    const troca = await this.prisma.trocaDeManutencao.findUnique({ where: { id: trocaId } });
    if (!troca) throw new NotFoundException('Essa troca não existe mais.');
    await this.prisma.trocaDeManutencao.delete({ where: { id: trocaId } });
    const anterior = await this.prisma.trocaDeManutencao.findFirst({
      where: { itemId: troca.itemId },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    await this.prisma.itemDeManutencao.update({
      where: { id: troca.itemId },
      data: {
        ultimaTrocaEm: anterior?.data ?? null,
        ultimaTrocaMedidor: anterior?.medidor ?? null,
      },
    });
  }

  /**
   * Quantos itens vencidos e perto de vencer cada veículo tem — o selo da
   * lista da frota e do botão da ficha. Uma consulta para a frota inteira.
   */
  async alertasDaFrota(): Promise<Map<string, { vencidos: number; perto: number }>> {
    const [itens, medidas, trocas] = await Promise.all([
      this.prisma.itemDeManutencao.findMany({
        select: {
          veiculoId: true,
          intervaloMedidor: true,
          intervaloMeses: true,
          ultimaTrocaMedidor: true,
          ultimaTrocaEm: true,
          veiculo: { select: { tipo: true } },
        },
      }),
      this.prisma.abastecimento.groupBy({
        by: ['veiculoId'],
        where: { veiculoId: { not: null } },
        _max: { km: true, horimetro: true },
      }),
      this.prisma.itemDeManutencao.groupBy({
        by: ['veiculoId'],
        _max: { ultimaTrocaMedidor: true },
      }),
    ]);
    const porAbastecimento = new Map(medidas.map((m) => [m.veiculoId as string, m._max]));
    const porTroca = new Map(trocas.map((t) => [t.veiculoId, numero(t._max.ultimaTrocaMedidor)]));
    const hoje = hojeUtc();
    const alertas = new Map<string, { vencidos: number; perto: number }>();
    for (const i of itens) {
      const m = porAbastecimento.get(i.veiculoId);
      const doAbastecimento = i.veiculo.tipo === 'MAQUINA' ? numero(m?.horimetro ?? null) : (m?.km ?? null);
      const medidor = maior(doAbastecimento, porTroca.get(i.veiculoId) ?? null);
      const { estado } = situacaoDoItem(
        {
          intervaloMedidor: i.intervaloMedidor,
          intervaloMeses: i.intervaloMeses,
          ultimaTrocaMedidor: numero(i.ultimaTrocaMedidor),
          ultimaTrocaEm: i.ultimaTrocaEm,
        },
        medidor,
        hoje,
      );
      if (estado !== 'VENCIDO' && estado !== 'PERTO') continue;
      const a = alertas.get(i.veiculoId) ?? { vencidos: 0, perto: 0 };
      if (estado === 'VENCIDO') a.vencidos += 1;
      else a.perto += 1;
      alertas.set(i.veiculoId, a);
    }
    return alertas;
  }

  /**
   * O km (horas) de agora: o maior que o veículo já marcou num abastecimento
   * — é por isso que abastecer já atualiza a manutenção. Uma troca lançada
   * com km maior que o do último abastecimento também conta: o veículo já
   * chegou lá.
   */
  private async medidorAtual(
    veiculoId: string,
    tipo: TipoVeiculo,
  ): Promise<{ valor: number | null; em: string | null }> {
    const maquina = tipo === 'MAQUINA';
    const [abastecimento, troca] = await Promise.all([
      this.prisma.abastecimento.findFirst({
        where: { veiculoId, ...(maquina ? { horimetro: { not: null } } : { km: { not: null } }) },
        orderBy: maquina ? { horimetro: 'desc' } : { km: 'desc' },
        select: { km: true, horimetro: true, data: true },
      }),
      this.prisma.itemDeManutencao.aggregate({
        where: { veiculoId },
        _max: { ultimaTrocaMedidor: true },
      }),
    ]);
    const doAbastecimento = abastecimento
      ? maquina
        ? numero(abastecimento.horimetro)
        : abastecimento.km
      : null;
    const daTroca = numero(troca._max.ultimaTrocaMedidor);
    const valor = maior(doAbastecimento, daTroca);
    return {
      valor,
      em: valor != null && valor === doAbastecimento ? dia(abastecimento?.data ?? null) : null,
    };
  }

  private async buscarItem(itemId: string) {
    const item = await this.prisma.itemDeManutencao.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Esse item de manutenção não existe mais.');
    return item;
  }
}

function maior(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Um item sem km e sem meses nunca venceria: não é manutenção, é lembrete solto. */
function exigirIntervalo(medidor: number | null | undefined, meses: number | null | undefined) {
  if (!medidor && !meses) {
    throw new BadRequestException(
      'Diga de quanto em quanto se troca: em km (ou horas), em meses, ou nos dois.',
    );
  }
}
