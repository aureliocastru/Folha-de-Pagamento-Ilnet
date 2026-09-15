import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { TipoVeiculo } from '@prisma/client';
import { conferirArquivo, lerDataUrl } from '../arquivos/data-url';
import { somenteDigitos } from '../pontuacao/cpf';
import { PrismaService } from '../prisma/prisma.service';

/** A foto da nota chega reduzida pelo navegador; o teto é para o celular que não reduz. */
const FOTO_ACEITA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FOTO_MAXIMA = 3 * 1024 * 1024;

/** Nenhuma nota de posto passa disto; acima é dedo escorregado no zero. */
const VALOR_MAXIMO = 10_000;

/** Quantos abastecimentos o portal mostra embaixo de cada veículo. */
const ULTIMOS_NO_PORTAL = 5;

/** Um abastecimento, como as telas o mostram. A foto se pede à parte. */
export interface AbastecimentoNaTela {
  id: string;
  valor: number;
  km: number;
  /** ISO */
  data: string;
  lancadoPor: string;
  temFoto: boolean;
}

/** O veículo como o portal o mostra a quem o abastece. */
export interface VeiculoDoPortal {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  modelo: string | null;
  /** O km do último abastecimento — o menor que o próximo pode ter. */
  ultimoKm: number | null;
  ultimos: AbastecimentoNaTela[];
}

/** O combustível de um veículo, somado para a ficha. */
export interface ResumoDoCombustivel {
  total: number;
  quantidade: number;
  ultimoKm: number | null;
  /** Do primeiro ao último abastecimento. */
  kmRodados: number | null;
  /**
   * Quanto custou cada km rodado. O primeiro abastecimento fica de fora da
   * conta: o combustível dele foi gasto antes do primeiro km registrado.
   */
  custoPorKm: number | null;
}

/**
 * O abastecimento dos veículos: controle, e não conta a pagar.
 *
 * O posto manda a fatura da semana com desconto, e é ela que se paga. O que se
 * quer daqui é quanto cada veículo gasta, o km de cada ida ao posto e a nota.
 * Quem lança é quem anda com o veículo, pelo portal do CPF — o mesmo da
 * pontuação —, e só no veículo de que é responsável.
 */
@Injectable()
export class AbastecimentosService {
  private readonly logger = new Logger(AbastecimentosService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- O portal ---

  /** Os veículos deste CPF, com o último km e os abastecimentos recentes. */
  async doPortal(cpf: string): Promise<{ nome: string; veiculos: VeiculoDoPortal[] }> {
    const funcionario = await this.funcionarioPeloCpf(cpf);
    const veiculos = await this.prisma.veiculo.findMany({
      where: { responsavelId: funcionario.id, ativo: true },
      orderBy: { apelido: 'asc' },
      include: {
        abastecimentos: {
          orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
          take: ULTIMOS_NO_PORTAL,
          include: { foto: { select: { id: true } } },
        },
      },
    });
    return {
      nome: funcionario.apelido || funcionario.nome,
      veiculos: await Promise.all(
        veiculos.map(async (v) => ({
          id: v.id,
          apelido: v.apelido,
          tipo: v.tipo,
          placa: v.placa,
          modelo: v.modelo,
          ultimoKm: await this.ultimoKm(v.id),
          ultimos: v.abastecimentos.map(naTela),
        })),
      ),
    };
  }

  /**
   * Lança o abastecimento que o responsável fez agora.
   *
   * Tudo se confere antes de gravar — a foto, o veículo, o km —, para não ficar
   * um abastecimento sem a nota que ele devia provar.
   */
  async lancarPeloPortal(
    cpf: string,
    dados: { veiculoId: string; valor: number; km: number; foto: string },
  ): Promise<AbastecimentoNaTela> {
    const funcionario = await this.funcionarioPeloCpf(cpf);

    if (!dados.foto) {
      throw new BadRequestException('Tire ou anexe a foto da nota do posto.');
    }
    conferirArquivo(
      lerDataUrl(dados.foto),
      FOTO_ACEITA,
      FOTO_MAXIMA,
      'A foto precisa ser JPEG, PNG ou WebP.',
    );

    const valor = Math.round(Number(dados.valor) * 100) / 100;
    if (!(valor > 0) || valor > VALOR_MAXIMO) {
      throw new BadRequestException('Digite o valor da nota do posto.');
    }

    const km = Number(dados.km);
    if (!Number.isInteger(km) || km < 0 || km > 9_999_999) {
      throw new BadRequestException('Digite o km do painel, só os números.');
    }

    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id: dados.veiculoId },
      select: { id: true, apelido: true, ativo: true, responsavelId: true },
    });
    if (!veiculo || !veiculo.ativo) {
      throw new NotFoundException('Este veículo não está mais na frota.');
    }
    if (veiculo.responsavelId !== funcionario.id) {
      throw new ForbiddenException(
        'Este veículo não está com você. Peça ao administrador para colocá-lo no seu nome.',
      );
    }

    const anterior = await this.ultimoKm(veiculo.id);
    if (anterior != null && km < anterior) {
      throw new BadRequestException(
        `O último abastecimento de ${veiculo.apelido} foi com ${anterior.toLocaleString('pt-BR')} km. ` +
          'O km de agora não pode ser menor — confira o painel.',
      );
    }

    const criado = await this.prisma.abastecimento.create({
      data: {
        veiculoId: veiculo.id,
        valor,
        km,
        data: new Date(),
        funcionarioId: funcionario.id,
        lancadoPor: funcionario.apelido || funcionario.nome,
        foto: { create: { foto: dados.foto } },
      },
      include: { foto: { select: { id: true } } },
    });
    this.logger.log(
      `${funcionario.nome} abasteceu ${veiculo.apelido}: R$ ${valor} com ${km} km.`,
    );
    return naTela(criado);
  }

  // --- O sistema ---

  async doVeiculo(veiculoId: string): Promise<AbastecimentoNaTela[]> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { veiculoId },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      include: { foto: { select: { id: true } } },
    });
    return lista.map(naTela);
  }

  async resumo(veiculoId: string): Promise<ResumoDoCombustivel> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { veiculoId },
      orderBy: [{ km: 'asc' }, { data: 'asc' }],
      select: { valor: true, km: true },
    });
    return resumirCombustivel(lista.map((a) => ({ valor: Number(a.valor), km: a.km })));
  }

  async foto(id: string): Promise<{ foto: string }> {
    const f = await this.prisma.fotoDoAbastecimento.findUnique({
      where: { abastecimentoId: id },
    });
    if (!f) throw new NotFoundException('Foto não encontrada.');
    return { foto: f.foto };
  }

  /** O administrador apaga o lançado errado — o km trocado, a nota repetida. */
  async apagar(id: string): Promise<void> {
    const achado = await this.prisma.abastecimento.findUnique({ where: { id } });
    if (!achado) throw new NotFoundException('Abastecimento não encontrado.');
    await this.prisma.abastecimento.delete({ where: { id } });
  }

  private async ultimoKm(veiculoId: string): Promise<number | null> {
    const r = await this.prisma.abastecimento.aggregate({
      where: { veiculoId },
      _max: { km: true },
    });
    return r._max.km ?? null;
  }

  /**
   * O funcionário ativo com este CPF — a mesma regra do portal de pontos:
   * comparação pelos dígitos, porque o cadastro guarda o CPF com máscara.
   */
  private async funcionarioPeloCpf(
    cpf: string,
  ): Promise<{ id: string; nome: string; apelido: string | null }> {
    const digitos = somenteDigitos(cpf);
    if (digitos.length !== 11) {
      throw new BadRequestException('Digite os 11 números do CPF.');
    }
    const ativos = await this.prisma.funcionario.findMany({
      where: { ativo: true, isentoIcms: true, cpfCnpj: { not: null } },
      select: { id: true, nome: true, apelido: true, cpfCnpj: true },
    });
    const achado = ativos.find((f) => somenteDigitos(f.cpfCnpj) === digitos);
    if (!achado) {
      throw new NotFoundException(
        'Este CPF não está entre os funcionários da empresa. Confira os números.',
      );
    }
    return { id: achado.id, nome: achado.nome, apelido: achado.apelido };
  }
}

function naTela(a: {
  id: string;
  valor: { toString(): string } | number;
  km: number;
  data: Date;
  lancadoPor: string;
  foto: { id: string } | null;
}): AbastecimentoNaTela {
  return {
    id: a.id,
    valor: Number(a.valor),
    km: a.km,
    data: a.data.toISOString(),
    lancadoPor: a.lancadoPor,
    temFoto: !!a.foto,
  };
}

/** Recebe os abastecimentos em ordem de km. */
export function resumirCombustivel(
  lista: Array<{ valor: number; km: number }>,
): ResumoDoCombustivel {
  const total = lista.reduce((s, a) => s + a.valor, 0);
  const primeiro = lista[0];
  const ultimo = lista[lista.length - 1];
  const kmRodados = lista.length > 1 ? ultimo.km - primeiro.km : null;
  const depoisDoPrimeiro = total - (primeiro?.valor ?? 0);
  return {
    total: Math.round(total * 100) / 100,
    quantidade: lista.length,
    ultimoKm: ultimo?.km ?? null,
    kmRodados,
    custoPorKm:
      kmRodados && kmRodados > 0
        ? Math.round((depoisDoPrimeiro / kmRodados) * 100) / 100
        : null,
  };
}
