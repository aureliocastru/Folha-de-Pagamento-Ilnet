import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StatusContaPagar, type TipoVeiculo, type Veiculo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AbastecimentosService,
  type AbastecimentoNaTela,
  type ResumoDoCombustivel,
} from './abastecimentos.service';
import { CategoriasService, type EtiquetaDoTitulo } from './categorias.service';
import type { AtualizarVeiculoDto, CriarVeiculoDto } from './dto/veiculo.dto';

/** Um veículo na lista, com o que já se gastou nele. */
export interface VeiculoNaLista {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  modelo: string | null;
  ano: number | null;
  observacao: string | null;
  ativo: boolean;
  /** Quem anda com ele e o abastece pelo portal. */
  responsavel: { id: string; nome: string } | null;
  /** Tudo o que foi lançado nele e chegou ao IXC, pago ou não. */
  gasto: number;
  /** A parte do gasto que ainda não foi paga. */
  emAberto: number;
  quantidade: number;
  /** O vencimento do lançamento mais recente, "AAAA-MM-DD". */
  ultimoGasto: string | null;
  /** O que se abasteceu nele — controle, fora das contas a pagar. */
  combustivel: number;
  abastecimentos: number;
  /** Quantos esperam o administrador pôr o valor da nota. */
  abastecimentosAConferir: number;
  ultimoKm: number | null;
}

/** Um gasto do veículo, como a ficha dele mostra. */
export interface GastoDoVeiculo {
  contaId: string;
  idFnApagarIxc: number | null;
  fornecedor: string;
  observacao: string;
  valor: number;
  /** "AAAA-MM-DD" */
  vencimento: string;
  situacao: 'paga' | 'em aberto' | 'nao enviada' | 'cancelada';
  categoria: EtiquetaDoTitulo | null;
}

export interface FichaDoVeiculo {
  veiculo: VeiculoNaLista;
  gastos: GastoDoVeiculo[];
  /** Quanto foi para cada categoria — peça, mão de obra —, do maior para o menor. */
  porCategoria: Array<{ nome: string; valor: number }>;
  combustivel: ResumoDoCombustivel;
  abastecimentos: AbastecimentoNaTela[];
}

/**
 * A frota: os veículos e o que cada um já custou.
 *
 * O gasto não é guardado aqui — ele é a conta a pagar lançada com o veículo
 * marcado, e a soma sai dela. Assim a revisão paga pelo IXC, a peça em mãos e
 * a parcela que ainda vai vencer contam do mesmo jeito, e não há um segundo
 * número para desencontrar do financeiro.
 */
@Injectable()
export class VeiculosService {
  private readonly logger = new Logger(VeiculosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categorias: CategoriasService,
    private readonly abastecimentos: AbastecimentosService,
  ) {}

  async listar(incluirDesligados = true): Promise<VeiculoNaLista[]> {
    const [veiculos, combustivel] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: incluirDesligados ? undefined : { ativo: true },
        orderBy: [{ ativo: 'desc' }, { apelido: 'asc' }],
        include: {
          contas: { select: CAMPOS_DA_CONTA },
          responsavel: { select: RESPONSAVEL },
        },
      }),
      this.prisma.abastecimento.groupBy({
        by: ['veiculoId'],
        _sum: { valor: true },
        // `valor` conta só os que têm valor: a diferença é a fila da conferência.
        _count: { _all: true, valor: true },
        _max: { km: true },
      }),
    ]);
    const porVeiculo = new Map(
      combustivel.map((c) => [
        c.veiculoId,
        {
          total: Number(c._sum.valor ?? 0),
          quantidade: c._count._all,
          aConferir: c._count._all - c._count.valor,
          ultimoKm: c._max.km ?? null,
        },
      ]),
    );
    return veiculos.map((v) => resumir(v, v.contas, porVeiculo.get(v.id)));
  }

  /**
   * Os funcionários que podem ficar responsáveis por um veículo — os mesmos
   * que o portal do CPF reconhece.
   */
  responsaveis(): Promise<Array<{ id: string; nome: string; apelido: string | null }>> {
    return this.prisma.funcionario.findMany({
      where: { ativo: true, isentoIcms: true },
      select: { id: true, nome: true, apelido: true },
      orderBy: { nome: 'asc' },
    });
  }

  async ficha(id: string): Promise<FichaDoVeiculo> {
    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id },
      include: {
        responsavel: { select: RESPONSAVEL },
        contas: {
          select: {
            ...CAMPOS_DA_CONTA,
            id: true,
            idFnApagarIxc: true,
            beneficiarioNome: true,
            observacao: true,
          },
          orderBy: { dataVencimento: 'desc' },
        },
      },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado.');

    const etiquetas = await this.categorias.dosTitulos(
      veiculo.contas
        .map((c) => c.idFnApagarIxc)
        .filter((n): n is number => n != null),
    );

    const gastos: GastoDoVeiculo[] = veiculo.contas.map((c) => ({
      contaId: c.id,
      idFnApagarIxc: c.idFnApagarIxc,
      fornecedor: c.beneficiarioNome,
      observacao: c.observacao,
      valor: Number(c.valor),
      vencimento: c.dataVencimento.toISOString().slice(0, 10),
      situacao: situacao(c),
      categoria:
        c.idFnApagarIxc != null ? (etiquetas.get(c.idFnApagarIxc) ?? null) : null,
    }));

    const porNome = new Map<string, number>();
    for (const g of gastos) {
      if (!contaNoGasto(g.situacao)) continue;
      const nome = g.categoria
        ? g.categoria.grupo
          ? `${g.categoria.grupo.nome} › ${g.categoria.nome}`
          : g.categoria.nome
        : 'Sem categoria';
      porNome.set(nome, (porNome.get(nome) ?? 0) + g.valor);
    }

    const [combustivel, abastecimentos] = await Promise.all([
      this.abastecimentos.resumo(id),
      this.abastecimentos.doVeiculo(id),
    ]);

    return {
      veiculo: resumir(veiculo, veiculo.contas, combustivel),
      gastos,
      porCategoria: [...porNome]
        .map(([nome, valor]) => ({ nome, valor: centavos(valor) }))
        .sort((a, b) => b.valor - a.valor),
      combustivel,
      abastecimentos,
    };
  }

  async criar(dto: CriarVeiculoDto, usuarioId?: string): Promise<Veiculo> {
    if (dto.responsavelId) await this.conferirResponsavel(dto.responsavelId);
    const veiculo = await this.prisma.veiculo.create({
      data: {
        apelido: dto.apelido.trim(),
        tipo: dto.tipo,
        placa: placaLimpa(dto.placa),
        modelo: dto.modelo?.trim() || null,
        ano: dto.ano ?? null,
        observacao: dto.observacao?.trim() || null,
        responsavelId: dto.responsavelId || null,
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(`Veículo cadastrado: ${veiculo.apelido}.`);
    return veiculo;
  }

  async atualizar(id: string, dto: AtualizarVeiculoDto): Promise<Veiculo> {
    await this.existente(id);
    if (dto.responsavelId) await this.conferirResponsavel(dto.responsavelId);
    return this.prisma.veiculo.update({
      where: { id },
      data: {
        apelido: dto.apelido?.trim(),
        tipo: dto.tipo,
        placa: dto.placa === undefined ? undefined : placaLimpa(dto.placa),
        modelo: dto.modelo === undefined ? undefined : dto.modelo?.trim() || null,
        ano: dto.ano,
        observacao:
          dto.observacao === undefined ? undefined : dto.observacao?.trim() || null,
        ativo: dto.ativo,
        responsavelId: dto.responsavelId,
      },
    });
  }

  /**
   * Apagar só o que nunca teve gasto. Com gasto, o caminho é desligar: apagar
   * soltaria as contas do veículo, e a pergunta "quanto a moto custou?" perderia
   * a resposta sem ninguém ter pedido isso.
   */
  async remover(id: string): Promise<void> {
    await this.existente(id);
    const [contas, abastecimentos] = await Promise.all([
      this.prisma.contaPagar.count({ where: { veiculoId: id } }),
      this.prisma.abastecimento.count({ where: { veiculoId: id } }),
    ]);
    if (contas + abastecimentos > 0) {
      throw new BadRequestException(
        `Este veículo já tem ${contas} gasto(s) e ${abastecimentos} abastecimento(s). ` +
          'Desligue em vez de apagar — o histórico dele continua valendo.',
      );
    }
    await this.prisma.veiculo.delete({ where: { id } });
  }

  private async conferirResponsavel(funcionarioId: string): Promise<void> {
    const f = await this.prisma.funcionario.findFirst({
      where: { id: funcionarioId, ativo: true },
      select: { id: true },
    });
    if (!f) throw new BadRequestException('O responsável escolhido não é um funcionário ativo.');
  }

  private async existente(id: string): Promise<Veiculo> {
    const veiculo = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado.');
    return veiculo;
  }
}

const RESPONSAVEL = { id: true, nome: true, apelido: true } as const;

const CAMPOS_DA_CONTA = {
  valor: true,
  status: true,
  pagoEm: true,
  dataVencimento: true,
} as const;

interface ContaResumida {
  valor: { toString(): string } | number;
  status: StatusContaPagar;
  pagoEm: Date | null;
  dataVencimento: Date;
}

/**
 * Em que pé está o gasto. "Não enviada" é a conta que ficou deste lado sem
 * chegar ao IXC (a tela de contas em aberto avisa dela); não entra na soma,
 * porque ainda não é dívida de ninguém.
 */
export function situacao(conta: {
  status: StatusContaPagar;
  pagoEm: Date | null;
}): GastoDoVeiculo['situacao'] {
  if (conta.status === StatusContaPagar.CANCELADO) return 'cancelada';
  if (conta.pagoEm || conta.status === StatusContaPagar.PAGO) return 'paga';
  if (
    conta.status === StatusContaPagar.RASCUNHO ||
    conta.status === StatusContaPagar.ERRO
  ) {
    return 'nao enviada';
  }
  return 'em aberto';
}

function contaNoGasto(s: GastoDoVeiculo['situacao']): boolean {
  return s === 'paga' || s === 'em aberto';
}

export function resumir(
  v: Pick<
    Veiculo,
    'id' | 'apelido' | 'tipo' | 'placa' | 'modelo' | 'ano' | 'observacao' | 'ativo'
  > & { responsavel?: { id: string; nome: string; apelido: string | null } | null },
  contas: ContaResumida[],
  combustivel?: {
    total: number;
    quantidade: number;
    aConferir?: number;
    ultimoKm: number | null;
  },
): VeiculoNaLista {
  let gasto = 0;
  let emAberto = 0;
  let quantidade = 0;
  let ultimo: Date | null = null;
  for (const c of contas) {
    const s = situacao(c);
    if (!contaNoGasto(s)) continue;
    const valor = Number(c.valor);
    gasto += valor;
    if (s === 'em aberto') emAberto += valor;
    quantidade += 1;
    if (!ultimo || c.dataVencimento > ultimo) ultimo = c.dataVencimento;
  }
  return {
    id: v.id,
    apelido: v.apelido,
    tipo: v.tipo,
    placa: v.placa,
    modelo: v.modelo,
    ano: v.ano,
    observacao: v.observacao,
    ativo: v.ativo,
    responsavel: v.responsavel
      ? { id: v.responsavel.id, nome: v.responsavel.apelido || v.responsavel.nome }
      : null,
    gasto: centavos(gasto),
    emAberto: centavos(emAberto),
    quantidade,
    ultimoGasto: ultimo ? ultimo.toISOString().slice(0, 10) : null,
    combustivel: centavos(combustivel?.total ?? 0),
    abastecimentos: combustivel?.quantidade ?? 0,
    abastecimentosAConferir: combustivel?.aConferir ?? 0,
    ultimoKm: combustivel?.ultimoKm ?? null,
  };
}

/** "abc-1d23" → "ABC1D23": a placa se compara e se procura sem traço. */
function placaLimpa(placa: string | null | undefined): string | null {
  const limpa = String(placa ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return limpa || null;
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}
