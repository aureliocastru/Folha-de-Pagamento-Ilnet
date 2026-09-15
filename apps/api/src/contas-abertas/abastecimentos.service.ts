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
  /** Null = ainda na conferência: o administrador não pôs o valor da nota. */
  valor: number | null;
  km: number;
  /** ISO */
  data: string;
  lancadoPor: string;
  temFoto: boolean;
  conferidoPor: string | null;
}

/** Um abastecimento na fila da conferência, com o veículo dele. */
export interface AbastecimentoAConferir extends AbastecimentoNaTela {
  veiculo: { id: string; apelido: string; placa: string | null };
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
  /** Só o que já foi conferido: o que está na fila ainda não tem valor. */
  total: number;
  quantidade: number;
  /** Quantos esperam o administrador pôr o valor. */
  aConferir: number;
  ultimoKm: number | null;
  /** Do primeiro ao último abastecimento. */
  kmRodados: number | null;
  /**
   * Quanto custou cada km rodado. O primeiro abastecimento fica de fora da
   * conta: o combustível dele foi gasto antes do primeiro km registrado. Null
   * enquanto algum da conta está sem valor — um custo por km que pula a nota
   * que falta sairia menor do que foi.
   */
  custoPorKm: number | null;
}

type AbastecimentoCru = {
  id: string;
  valor: { toString(): string } | number | null;
  km: number;
  data: Date;
  lancadoPor: string;
  conferidoPor: string | null;
  foto: { id: string } | null;
};

/**
 * O abastecimento dos veículos: controle, e não conta a pagar.
 *
 * O posto manda a fatura da semana com desconto, e é ela que se paga. O que se
 * quer daqui é quanto cada veículo gasta, o km de cada ida ao posto e a nota.
 *
 * Quem abastece lança só o km e a foto — pelo portal do CPF, no veículo de que
 * é responsável. O valor é o administrador quem põe, lendo a nota, na
 * conferência de Veículos.
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

  /** O abastecimento que o responsável fez agora: o km e a foto da nota. */
  async lancarPeloPortal(
    cpf: string,
    dados: { veiculoId: string; km: number; foto: string },
  ): Promise<AbastecimentoNaTela> {
    const funcionario = await this.funcionarioPeloCpf(cpf);
    conferirFoto(dados.foto);
    const km = kmValido(dados.km);

    const veiculo = await this.veiculoAtivo(dados.veiculoId);
    if (veiculo.responsavelId !== funcionario.id) {
      throw new ForbiddenException(
        'Este veículo não está com você. Peça ao administrador para colocá-lo no seu nome.',
      );
    }
    await this.conferirKm(veiculo, km);

    const criado = await this.prisma.abastecimento.create({
      data: {
        veiculoId: veiculo.id,
        km,
        data: new Date(),
        funcionarioId: funcionario.id,
        lancadoPor: funcionario.apelido || funcionario.nome,
        foto: { create: { foto: dados.foto } },
      },
      include: { foto: { select: { id: true } } },
    });
    this.logger.log(`${funcionario.nome} abasteceu ${veiculo.apelido} com ${km} km (a conferir).`);
    return naTela(criado);
  }

  // --- O sistema ---

  /**
   * O abastecimento lançado por dentro, na ficha do veículo. Aqui o valor pode
   * vir junto — quem lança é o administrador, com a nota na mão —, e aí ele já
   * nasce conferido.
   */
  async lancarPeloSistema(
    veiculoId: string,
    dados: { km: number; foto: string; valor?: number | null },
    quem: { id?: string; nome: string },
  ): Promise<AbastecimentoNaTela> {
    conferirFoto(dados.foto);
    const km = kmValido(dados.km);
    const valor = dados.valor == null ? null : valorValido(dados.valor);
    const veiculo = await this.veiculoAtivo(veiculoId);
    await this.conferirKm(veiculo, km);

    const criado = await this.prisma.abastecimento.create({
      data: {
        veiculoId: veiculo.id,
        km,
        valor,
        data: new Date(),
        usuarioId: quem.id ?? null,
        lancadoPor: quem.nome,
        ...(valor != null ? { conferidoPor: quem.nome, conferidoEm: new Date() } : {}),
        foto: { create: { foto: dados.foto } },
      },
      include: { foto: { select: { id: true } } },
    });
    this.logger.log(`${quem.nome} lançou abastecimento em ${veiculo.apelido} com ${km} km.`);
    return naTela(criado);
  }

  /** O administrador põe (ou corrige) o valor lido na nota. */
  async conferir(id: string, valor: number, quem: string): Promise<AbastecimentoNaTela> {
    const achado = await this.prisma.abastecimento.findUnique({ where: { id }, select: { id: true } });
    if (!achado) throw new NotFoundException('Abastecimento não encontrado.');
    const atualizado = await this.prisma.abastecimento.update({
      where: { id },
      data: { valor: valorValido(valor), conferidoPor: quem, conferidoEm: new Date() },
      include: { foto: { select: { id: true } } },
    });
    return naTela(atualizado);
  }

  /** A fila da conferência: os abastecimentos de todos os veículos ainda sem valor. */
  async aConferir(): Promise<AbastecimentoAConferir[]> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { valor: null },
      orderBy: [{ data: 'asc' }],
      include: {
        foto: { select: { id: true } },
        veiculo: { select: { id: true, apelido: true, placa: true } },
      },
    });
    return lista.map((a) => ({ ...naTela(a), veiculo: a.veiculo }));
  }

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
    return resumirCombustivel(
      lista.map((a) => ({ valor: a.valor == null ? null : Number(a.valor), km: a.km })),
    );
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

  private async veiculoAtivo(id: string) {
    const veiculo = await this.prisma.veiculo.findUnique({
      where: { id },
      select: { id: true, apelido: true, ativo: true, responsavelId: true },
    });
    if (!veiculo || !veiculo.ativo) {
      throw new NotFoundException('Este veículo não está mais na frota.');
    }
    return veiculo;
  }

  /** O km não anda para trás — é o erro de digitação mais comum no posto. */
  private async conferirKm(veiculo: { id: string; apelido: string }, km: number) {
    const anterior = await this.ultimoKm(veiculo.id);
    if (anterior != null && km < anterior) {
      throw new BadRequestException(
        `O último abastecimento de ${veiculo.apelido} foi com ${anterior.toLocaleString('pt-BR')} km. ` +
          'O km de agora não pode ser menor — confira o painel.',
      );
    }
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

function conferirFoto(foto: string) {
  if (!foto) throw new BadRequestException('Tire ou anexe a foto da nota do posto.');
  conferirArquivo(lerDataUrl(foto), FOTO_ACEITA, FOTO_MAXIMA, 'A foto precisa ser JPEG, PNG ou WebP.');
}

function kmValido(km: number): number {
  const n = Number(km);
  if (!Number.isInteger(n) || n < 0 || n > 9_999_999) {
    throw new BadRequestException('Digite o km do painel, só os números.');
  }
  return n;
}

function valorValido(valor: number): number {
  const v = Math.round(Number(valor) * 100) / 100;
  if (!(v > 0) || v > VALOR_MAXIMO) {
    throw new BadRequestException('Digite o valor da nota do posto.');
  }
  return v;
}

function naTela(a: AbastecimentoCru): AbastecimentoNaTela {
  return {
    id: a.id,
    valor: a.valor == null ? null : Number(a.valor),
    km: a.km,
    data: a.data.toISOString(),
    lancadoPor: a.lancadoPor,
    temFoto: !!a.foto,
    conferidoPor: a.conferidoPor,
  };
}

/** Recebe os abastecimentos em ordem de km. */
export function resumirCombustivel(
  lista: Array<{ valor: number | null; km: number }>,
): ResumoDoCombustivel {
  const total = lista.reduce((s, a) => s + (a.valor ?? 0), 0);
  const primeiro = lista[0];
  const ultimo = lista[lista.length - 1];
  const kmRodados = lista.length > 1 ? ultimo.km - primeiro.km : null;
  const depoisDoPrimeiro = lista.slice(1);
  const todosComValor = depoisDoPrimeiro.every((a) => a.valor != null);
  const gastoDepois = depoisDoPrimeiro.reduce((s, a) => s + (a.valor ?? 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    quantidade: lista.length,
    aConferir: lista.filter((a) => a.valor == null).length,
    ultimoKm: ultimo?.km ?? null,
    kmRodados,
    custoPorKm:
      kmRodados && kmRodados > 0 && todosComValor
        ? Math.round((gastoDepois / kmRodados) * 100) / 100
        : null,
  };
}
