import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  StatusContaPagar,
  type Combustivel,
  type TipoVeiculo,
  type Veiculo,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AbastecimentosService,
  mediaDeConsumo,
  type AbastecimentoNaTela,
  type SaidaDoGalao,
  type Consumo,
  type EstoqueDoGalao,
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
  /** Quem anda com ele e o abastece pelo portal. Pode ser mais de um. */
  responsaveis: Array<{ id: string; nome: string }>;
  /** Tudo o que foi lançado nele e chegou ao IXC, pago ou não. */
  gasto: number;
  /** A parte do gasto que ainda não foi paga. */
  emAberto: number;
  quantidade: number;
  /** O vencimento do lançamento mais recente, "AAAA-MM-DD". */
  ultimoGasto: string | null;
  /**
   * O que se abasteceu nele — controle, fora das contas a pagar.
   *
   * Soma as idas ao posto e o que veio de um galão, cada litro pelo preço do
   * galão de onde saiu. No galão, este número é o que ele **comprou**, e não o
   * que gastou: o gasto acontece quando o combustível entra na máquina.
   */
  combustivel: number;
  abastecimentos: number;
  /** Quantos esperam o administrador pôr o valor da nota. */
  abastecimentosAConferir: number;
  /** O que ele põe no tanque, e o que o galão carrega. */
  tipoCombustivel: Combustivel | null;
  /** Quanto cabe no galão. */
  capacidadeLitros: number | null;
  /** Quantos litros ainda há dentro do galão, e por quanto saiu o litro. */
  estoque: EstoqueDoGalao | null;
  ultimoKm: number | null;
  /** O horímetro da última vez, nas máquinas. */
  ultimoHorimetro: number | null;
  /** A média que ele está fazendo — km/L, ou L/h na máquina. Galão não tem. */
  consumo: Consumo | null;
  /** A média que se espera dele, cadastrada na ficha. */
  consumoIdeal: number | null;
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
  /**
   * Só no galão: o que saiu dele e para onde — a máquina da frota, ou o outro
   * destino escrito (a roçadeira, o sítio). Vazio nos outros veículos.
   */
  saidas: SaidaDoGalao[];
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
    const [veiculos, compras, saidas, precos, medidas] = await Promise.all([
      this.prisma.veiculo.findMany({
        where: incluirDesligados ? undefined : { ativo: true },
        orderBy: [{ ativo: 'desc' }, { apelido: 'asc' }],
        include: {
          contas: { select: CAMPOS_DA_CONTA },
          responsaveis: RESPONSAVEIS,
        },
      }),
      // As idas ao posto: têm nota, e é a nota que vira dinheiro.
      this.prisma.abastecimento.groupBy({
        by: ['veiculoId'],
        where: { galaoId: null },
        _sum: { valor: true },
        // `valor` conta só os que têm valor: a diferença é a fila da conferência.
        _count: { _all: true, valor: true },
        _max: { km: true, horimetro: true },
      }),
      // O que veio de um galão: vale os litros pelo preço daquele galão.
      this.prisma.abastecimento.groupBy({
        by: ['veiculoId', 'galaoId'],
        where: { galaoId: { not: null } },
        _sum: { litros: true },
        _count: { _all: true },
        _max: { km: true, horimetro: true },
      }),
      this.abastecimentos.precosDosGaloes(),
      /*
       * Os medidores de toda a frota, em ordem, para a média de consumo.
       *
       * Vem numa consulta só e se divide por veículo aqui: são três colunas de
       * número por abastecimento, e a conta da média precisa da sequência —
       * nenhum `groupBy` responde "quanto ele andou entre um e outro".
       */
      this.prisma.abastecimento.findMany({
        where: { veiculo: { tipo: { not: 'GALAO' } } },
        orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
        select: { veiculoId: true, km: true, horimetro: true, litros: true },
      }),
    ]);

    const medidasPorVeiculo = new Map<string, Medida[]>();
    for (const m of medidas) {
      if (!m.veiculoId) continue;
      const lista = medidasPorVeiculo.get(m.veiculoId) ?? [];
      lista.push({
        km: m.km,
        // Horímetro e litros são decimais no banco: chegam como `Decimal`.
        horimetro: m.horimetro == null ? null : Number(m.horimetro),
        litros: m.litros == null ? null : Number(m.litros),
      });
      medidasPorVeiculo.set(m.veiculoId, lista);
    }

    const porVeiculo = new Map<
      string,
      {
        total: number;
        quantidade: number;
        aConferir: number;
        ultimoKm: number | null;
        ultimoHorimetro: number | null;
      }
    >();
    const juntar = (
      id: string,
      total: number,
      quantidade: number,
      aConferir: number,
      km: number | null,
      horimetro: number | null,
    ) => {
      const atual = porVeiculo.get(id);
      porVeiculo.set(id, {
        total: (atual?.total ?? 0) + total,
        quantidade: (atual?.quantidade ?? 0) + quantidade,
        aConferir: (atual?.aConferir ?? 0) + aConferir,
        ultimoKm: maior(atual?.ultimoKm ?? null, km),
        ultimoHorimetro: maior(atual?.ultimoHorimetro ?? null, horimetro),
      });
    };

    for (const c of compras) {
      if (!c.veiculoId) continue;
      juntar(
        c.veiculoId,
        Number(c._sum.valor ?? 0),
        c._count._all,
        c._count._all - c._count.valor,
        c._max.km ?? null,
        c._max.horimetro == null ? null : Number(c._max.horimetro),
      );
    }
    for (const s of saidas) {
      // A que foi para a roçadeira, o sítio — fora da frota —, não é gasto de veículo nenhum.
      if (!s.veiculoId) continue;
      const preco = s.galaoId ? precos.get(s.galaoId) : undefined;
      const litros = Number(s._sum.litros ?? 0);
      juntar(
        s.veiculoId,
        preco == null ? 0 : litros * preco,
        s._count._all,
        // A saída não espera conferência nenhuma: o preço dela já existe.
        0,
        s._max.km ?? null,
        s._max.horimetro == null ? null : Number(s._max.horimetro),
      );
    }

    // O estoque é pergunta de galão, e galão a casa tem dois ou três.
    const estoques = new Map<string, EstoqueDoGalao>();
    for (const v of veiculos) {
      if (v.tipo !== 'GALAO') continue;
      estoques.set(v.id, await this.abastecimentos.estoqueDoGalao(v.id));
    }

    return veiculos.map((v) =>
      resumir(
        v,
        v.contas,
        porVeiculo.get(v.id),
        estoques.get(v.id) ?? null,
        mediaDeConsumo(
          medidasPorVeiculo.get(v.id) ?? [],
          v.tipo === 'MAQUINA' ? 'horimetro' : 'km',
          v.consumoIdeal == null ? null : Number(v.consumoIdeal),
        ),
      ),
    );
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
        responsaveis: RESPONSAVEIS,
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

    const [combustivel, abastecimentos, saidas] = await Promise.all([
      this.abastecimentos.resumo(id),
      this.abastecimentos.doVeiculo(id),
      veiculo.tipo === 'GALAO' ? this.abastecimentos.saidasDoGalao(id) : Promise.resolve([]),
    ]);

    return {
      veiculo: resumir(veiculo, veiculo.contas, combustivel),
      gastos,
      porCategoria: [...porNome]
        .map(([nome, valor]) => ({ nome, valor: centavos(valor) }))
        .sort((a, b) => b.valor - a.valor),
      combustivel,
      abastecimentos,
      saidas,
    };
  }

  async criar(dto: CriarVeiculoDto, usuarioId?: string): Promise<Veiculo> {
    const responsaveis = dto.responsaveisIds ?? [];
    await this.conferirResponsaveis(responsaveis);
    const veiculo = await this.prisma.veiculo.create({
      data: {
        apelido: dto.apelido.trim(),
        tipo: dto.tipo,
        placa: placaLimpa(dto.placa),
        modelo: dto.modelo?.trim() || null,
        ano: dto.ano ?? null,
        observacao: dto.observacao?.trim() || null,
        consumoIdeal: dto.consumoIdeal ?? null,
        responsaveis: {
          create: responsaveis.map((funcionarioId) => ({ funcionarioId })),
        },
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(`Veículo cadastrado: ${veiculo.apelido}.`);
    return veiculo;
  }

  async atualizar(id: string, dto: AtualizarVeiculoDto): Promise<Veiculo> {
    await this.existente(id);
    await this.conferirResponsaveis(dto.responsaveisIds ?? []);
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
        consumoIdeal: dto.consumoIdeal,
        /*
         * A lista que chega é a lista inteira: apaga as ligações e refaz. Não
         * há nada guardado na ligação além de quem é — refazer não perde nada,
         * e evita ter de descobrir quem entrou e quem saiu.
         */
        responsaveis: dto.responsaveisIds && {
          deleteMany: {},
          create: dto.responsaveisIds.map((funcionarioId) => ({ funcionarioId })),
        },
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

  /** Todo mundo da lista tem de ser funcionário ativo — senão, nenhum entra. */
  private async conferirResponsaveis(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const achados = await this.prisma.funcionario.count({
      where: { id: { in: ids }, ativo: true },
    });
    if (achados !== ids.length) {
      throw new BadRequestException(
        ids.length === 1
          ? 'O responsável escolhido não é um funcionário ativo.'
          : 'Algum dos responsáveis escolhidos não é um funcionário ativo.',
      );
    }
  }

  private async existente(id: string): Promise<Veiculo> {
    const veiculo = await this.prisma.veiculo.findUnique({ where: { id } });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado.');
    return veiculo;
  }
}

/** Os responsáveis do veículo, em ordem de nome — é como a tela os mostra. */
const RESPONSAVEIS = {
  select: { funcionario: { select: { id: true, nome: true, apelido: true } } },
  orderBy: { funcionario: { nome: 'asc' } },
} as const;

/** O que a média de consumo precisa de cada abastecimento. */
interface Medida {
  km: number | null;
  horimetro: number | null;
  litros: number | null;
}

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
  > & {
    combustivel?: Combustivel | null;
    capacidadeLitros?: number | null;
    consumoIdeal?: { toString(): string } | number | null;
    responsaveis?: Array<{
      funcionario: { id: string; nome: string; apelido: string | null };
    }>;
  },
  contas: ContaResumida[],
  combustivel?: {
    total: number;
    quantidade: number;
    aConferir?: number;
    ultimoKm: number | null;
    ultimoHorimetro?: number | null;
    consumo?: Consumo;
  },
  estoque: EstoqueDoGalao | null = null,
  /** A média de consumo, quando quem chama já a calculou. */
  consumo: Consumo | null = null,
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
    responsaveis: (v.responsaveis ?? []).map(({ funcionario: f }) => ({
      id: f.id,
      nome: f.apelido || f.nome,
    })),
    gasto: centavos(gasto),
    emAberto: centavos(emAberto),
    quantidade,
    ultimoGasto: ultimo ? ultimo.toISOString().slice(0, 10) : null,
    combustivel: centavos(combustivel?.total ?? 0),
    abastecimentos: combustivel?.quantidade ?? 0,
    abastecimentosAConferir: combustivel?.aConferir ?? 0,
    tipoCombustivel: v.combustivel ?? null,
    capacidadeLitros: v.capacidadeLitros ?? null,
    estoque,
    ultimoKm: combustivel?.ultimoKm ?? null,
    ultimoHorimetro: combustivel?.ultimoHorimetro ?? null,
    // O galão não faz média: ele não anda, e o que sai dele vira consumo da
    // máquina que o bebeu.
    consumo: v.tipo === 'GALAO' ? null : (consumo ?? combustivel?.consumo ?? null),
    consumoIdeal: v.consumoIdeal == null ? null : Number(v.consumoIdeal),
  };
}

/** O maior dos dois medidores, ignorando o que não veio. */
function maior(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
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
