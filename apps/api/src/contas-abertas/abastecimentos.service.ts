import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Combustivel, TipoVeiculo } from '@prisma/client';
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
  /**
   * Null = ainda na conferência: o administrador não pôs o valor da nota.
   *
   * Na saída de um galão o valor não vem da nota, e sim do preço do litro que
   * está lá dentro — por isso ele chega preenchido mesmo sem conferência
   * nenhuma.
   */
  valor: number | null;
  km: number | null;
  /** O horímetro da máquina, quando é uma. */
  horimetro: number | null;
  /** Quantos litros entraram. */
  litros: number | null;
  /** De qual galão saiu. Null = veio do posto, com nota. */
  galao: { id: string; apelido: string } | null;
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

/** O que saiu de um galão: para um veículo da frota, ou para outro destino escrito. */
export interface SaidaDoGalao extends AbastecimentoNaTela {
  veiculo: { id: string; apelido: string; placa: string | null } | null;
  /** "roçadeira", "sítio" — quando não foi para um veículo da frota. */
  outroDestino: string | null;
}

/** O que o portal precisa saber para lançar — a ida ao posto ou a saída do galão. */
export interface DadosDoLancamento {
  /**
   * Quem recebeu o combustível. Na saída do galão pode faltar: aí os litros
   * foram para `outroDestino`, que não é da frota.
   */
  veiculoId?: string | null;
  /** Na saída do galão, para onde foi quando não foi um veículo: "roçadeira". */
  outroDestino?: string | null;
  km?: number | null;
  horimetro?: number | null;
  litros?: number | null;
  /** Preenchido, estes litros saem deste galão e não do posto. */
  galaoId?: string | null;
  /** A foto da nota. Obrigatória na ida ao posto; a saída do galão não tem. */
  foto?: string;
}

/** O que o portal e a Minha área mostram a quem abastece. */
export interface RespostaDoPortal {
  nome: string;
  veiculos: VeiculoDoPortal[];
  /** Para onde os litros do galão podem ir. Vazio para quem não tem galão. */
  destinos: DestinoDoGalao[];
  /**
   * Os outros destinos já escritos numa saída de galão — "roçadeira",
   * "sítio" —, dos mais recentes: o campo os sugere, e o mesmo lugar não vira
   * três grafias diferentes no histórico.
   */
  outrosDestinos: string[];
}

/** O veículo como o portal o mostra a quem o abastece. */
export interface VeiculoDoPortal {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  modelo: string | null;
  combustivel: Combustivel | null;
  /** Quanto cabe, em litros. Só o galão tem. */
  capacidadeLitros: number | null;
  /** O km do último abastecimento — o menor que o próximo pode ter. */
  ultimoKm: number | null;
  /** O horímetro do último abastecimento, para as máquinas. */
  ultimoHorimetro: number | null;
  /** Quantos litros ainda há dentro do galão, e por quanto saiu o litro. */
  estoque: EstoqueDoGalao | null;
  /** A média que ele está fazendo. Quem abastece é quem a vê primeiro. */
  consumo: Consumo | null;
  ultimos: AbastecimentoNaTela[];
}

/** O que há dentro de um galão, e quanto custou. */
export interface EstoqueDoGalao {
  /** Litros que entraram menos os que saíram. */
  litros: number;
  /** A média do que se pagou pelo litro nas compras já conferidas. */
  precoPorLitro: number | null;
  /** O que está parado ali dentro, em dinheiro. */
  valor: number | null;
  /** Litros comprados cuja nota ainda não foi conferida. */
  litrosSemValor: number;
}

/** Para onde os litros de um galão podem ir: a frota inteira que está ligada. */
export interface DestinoDoGalao {
  id: string;
  apelido: string;
  tipo: TipoVeiculo;
  placa: string | null;
  /** O último medidor lançado — o menor que o próximo pode ter. */
  ultimoKm: number | null;
  ultimoHorimetro: number | null;
}

/** O combustível de um veículo, somado para a ficha. */
export interface ResumoDoCombustivel {
  /** Só o que já foi conferido: o que está na fila ainda não tem valor. */
  total: number;
  quantidade: number;
  /** Quantos esperam o administrador pôr o valor. */
  aConferir: number;
  /** Quantos litros entraram neste veículo, do posto ou do galão. */
  litros: number;
  ultimoKm: number | null;
  /** O horímetro da última vez, nas máquinas. */
  ultimoHorimetro: number | null;
  /** As horas trabalhadas entre o primeiro e o último abastecimento. */
  horasTrabalhadas: number | null;
  /** Quanto custou cada hora de máquina. */
  custoPorHora: number | null;
  /** Do primeiro ao último abastecimento. */
  kmRodados: number | null;
  /**
   * Quanto custou cada km rodado. O primeiro abastecimento fica de fora da
   * conta: o combustível dele foi gasto antes do primeiro km registrado. Null
   * enquanto algum da conta está sem valor — um custo por km que pula a nota
   * que falta sairia menor do que foi.
   */
  custoPorKm: number | null;
  /** A média que o veículo está fazendo: km/L, ou L/h nas máquinas. */
  consumo: Consumo;
}

/**
 * A média de consumo de um veículo — o galão não tem, porque não anda.
 *
 * `medio` é a vida inteira do veículo no sistema; `ultimo` é só o trecho entre
 * os dois últimos abastecimentos, que é onde um problema aparece primeiro: o
 * carro que fazia 12 e passou a fazer 8 tem algo errado agora, e a média geral
 * levaria meses para acusar isso.
 */
export interface Consumo {
  /** km por litro; nas máquinas, litros por hora. Null = ainda não dá para dizer. */
  medio: number | null;
  /** A mesma conta, só do trecho mais recente. */
  ultimo: number | null;
  /** 'km_por_litro' no que anda, 'litros_por_hora' na máquina. */
  unidade: 'km_por_litro' | 'litros_por_hora';
  /**
   * Quantos abastecimentos entraram na média. Dois é o mínimo: um só diz
   * quantos litros entraram, e não quanto o veículo andou com eles.
   */
  base: number;
  /** A média que se espera dele, cadastrada na ficha. */
  ideal: number | null;
  /** A média está pior do que a esperada — é o amarelo da tela. */
  irregular: boolean;
  /** O último trecho está pior do que o esperado, mesmo com a média de pé. */
  ultimoIrregular: boolean;
}

type AbastecimentoCru = {
  id: string;
  valor: { toString(): string } | number | null;
  km: number | null;
  horimetro: { toString(): string } | number | null;
  litros: { toString(): string } | number | null;
  galaoId?: string | null;
  galao?: { id: string; apelido: string } | null;
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
  async doPortal(cpf: string): Promise<RespostaDoPortal> {
    return this.doResponsavel(await this.funcionarioPeloCpf(cpf));
  }

  /** O abastecimento que o responsável fez agora, pelo portal do CPF. */
  async lancarPeloPortal(
    cpf: string,
    dados: DadosDoLancamento,
  ): Promise<AbastecimentoNaTela> {
    return this.lancarPeloResponsavel(await this.funcionarioPeloCpf(cpf), dados);
  }

  // --- A tela do colaborador (o login do sistema) ---

  /**
   * Os veículos do colaborador que entrou com o próprio login. É a mesma tela
   * do portal; muda só como se sabe quem é a pessoa — lá pelo CPF, aqui pelo
   * vínculo do login.
   */
  async doColaborador(funcionarioId: string): Promise<RespostaDoPortal> {
    return this.doResponsavel(await this.colaboradorAtivo(funcionarioId));
  }

  /** O abastecimento lançado pelo login do colaborador: fica o login também. */
  async lancarPeloColaborador(
    funcionarioId: string,
    usuarioId: string,
    dados: DadosDoLancamento,
  ): Promise<AbastecimentoNaTela> {
    return this.lancarPeloResponsavel(await this.colaboradorAtivo(funcionarioId), dados, usuarioId);
  }

  /** Quantos veículos ativos estão no nome desta pessoa. */
  quantosVeiculos(funcionarioId: string): Promise<number> {
    return this.prisma.veiculo.count({
      where: { responsaveis: { some: { funcionarioId } }, ativo: true },
    });
  }

  private async doResponsavel(funcionario: {
    id: string;
    nome: string;
    apelido: string | null;
  }): Promise<RespostaDoPortal> {
    const veiculos = await this.prisma.veiculo.findMany({
      where: { responsaveis: { some: { funcionarioId: funcionario.id } }, ativo: true },
      orderBy: { apelido: 'asc' },
      include: {
        abastecimentos: {
          orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
          take: ULTIMOS_NO_PORTAL,
          include: {
            foto: { select: { id: true } },
            galao: { select: { id: true, apelido: true } },
          },
        },
      },
    });

    const noPortal = await Promise.all(
      veiculos.map(async (v) => ({
        id: v.id,
        apelido: v.apelido,
        tipo: v.tipo,
        placa: v.placa,
        modelo: v.modelo,
        combustivel: v.combustivel,
        capacidadeLitros: v.capacidadeLitros,
        ultimoKm: await this.ultimoMedidor(v.id, 'km'),
        ultimoHorimetro: await this.ultimoMedidor(v.id, 'horimetro'),
        estoque: v.tipo === 'GALAO' ? await this.estoqueDoGalao(v.id) : null,
        consumo: await this.consumoDoVeiculo(v.id, v.tipo, numero(v.consumoIdeal)),
        ultimos: v.abastecimentos.map(naTela),
      })),
    );

    /*
     * Quem tem galão no nome precisa da frota inteira à mão.
     *
     * O galão não abastece a si mesmo: ele enche no posto e depois despeja na
     * máquina que estiver precisando — e a máquina quase nunca está no nome de
     * quem carrega o galão. Sem esta lista, o combustível entraria e nunca
     * teria como sair.
     */
    const temGalao = noPortal.some((v) => v.tipo === 'GALAO');
    const [destinos, outrosDestinos] = temGalao
      ? await Promise.all([this.destinosPossiveis(), this.outrosDestinosUsados()])
      : [[], []];

    return {
      nome: funcionario.apelido || funcionario.nome,
      veiculos: noPortal,
      destinos,
      outrosDestinos,
    };
  }

  /** Os destinos escritos das últimas saídas de galão, sem repetir. */
  private async outrosDestinosUsados(): Promise<string[]> {
    const recentes = await this.prisma.abastecimento.findMany({
      where: { outroDestino: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { outroDestino: true },
      take: 200,
    });
    const vistos = new Set<string>();
    const nomes: string[] = [];
    for (const { outroDestino } of recentes) {
      const nome = outroDestino?.trim();
      const chave = nome?.toLocaleLowerCase('pt-BR');
      if (!nome || !chave || vistos.has(chave)) continue;
      vistos.add(chave);
      nomes.push(nome);
    }
    return nomes.slice(0, 20);
  }

  /**
   * A média que o veículo está fazendo, do primeiro abastecimento até hoje.
   *
   * Galão não tem: ele não anda, e os litros que saem dele viram consumo da
   * máquina que os bebeu.
   */
  async consumoDoVeiculo(
    veiculoId: string,
    tipo: TipoVeiculo,
    ideal: number | null = null,
  ): Promise<Consumo | null> {
    if (tipo === 'GALAO') return null;
    const lista = await this.prisma.abastecimento.findMany({
      where: { veiculoId },
      orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
      select: { km: true, horimetro: true, litros: true },
    });
    return mediaDeConsumo(
      lista.map((a) => ({
        km: a.km,
        horimetro: numero(a.horimetro),
        litros: a.litros == null ? null : Number(a.litros),
      })),
      tipo === 'MAQUINA' ? 'horimetro' : 'km',
      ideal,
    );
  }

  /** A frota ligada, tirando os galões: é onde o combustível de fato acaba. */
  private async destinosPossiveis(): Promise<DestinoDoGalao[]> {
    const lista = await this.prisma.veiculo.findMany({
      where: { ativo: true, tipo: { not: 'GALAO' } },
      orderBy: [{ tipo: 'asc' }, { apelido: 'asc' }],
      select: { id: true, apelido: true, tipo: true, placa: true },
    });
    return Promise.all(
      lista.map(async (v) => ({
        ...v,
        ultimoKm: await this.ultimoMedidor(v.id, 'km'),
        ultimoHorimetro: await this.ultimoMedidor(v.id, 'horimetro'),
      })),
    );
  }

  /**
   * O que o responsável lançou agora. Dois caminhos, e o galão é quem separa.
   *
   * **Sem galão** é a ida ao posto: a nota, os litros e o medidor do que foi
   * abastecido. O valor não se digita — sai da nota, na conferência.
   *
   * **Com galão** é o combustível saindo dele: litros, e nada de nota — aquele
   * dinheiro já saiu no dia em que o galão foi enchido, e cobrá-lo de novo
   * contaria o mesmo diesel duas vezes. Vai para uma máquina ou veículo da
   * frota (com o horímetro ou o km dele), ou para outro destino escrito — a
   * roçadeira, o sítio —, que não tem painel nenhum.
   *
   * A data e a hora são as do servidor, e não as do celular — relógio de
   * celular atrasado não muda a ordem dos abastecimentos.
   */
  private async lancarPeloResponsavel(
    funcionario: { id: string; nome: string; apelido: string | null },
    dados: DadosDoLancamento,
    usuarioId?: string,
  ): Promise<AbastecimentoNaTela> {
    const quem = funcionario.apelido || funcionario.nome;

    if (dados.galaoId) {
      const galao = await this.veiculoAtivo(dados.galaoId);
      if (galao.tipo !== 'GALAO') {
        throw new BadRequestException(`${galao.apelido} não é um galão.`);
      }
      if (!estaNoNome(galao, funcionario.id)) {
        throw new ForbiddenException(
          'Este galão não está com você. Peça ao administrador para colocá-lo no seu nome.',
        );
      }

      // Para onde foi: um veículo da frota, ou o que se escreveu — um dos dois.
      const outroDestino = dados.outroDestino?.trim() || null;
      if (!dados.veiculoId && !outroDestino) {
        throw new BadRequestException(
          'Diga para onde foi o combustível: escolha a máquina ou escreva o outro destino.',
        );
      }
      if (dados.veiculoId && outroDestino) {
        throw new BadRequestException(
          'Escolha a máquina ou escreva outro destino — não os dois.',
        );
      }
      if (outroDestino && outroDestino.length < 2) {
        throw new BadRequestException('Escreva para onde foi o combustível.');
      }
      const destino = dados.veiculoId ? await this.veiculoAtivo(dados.veiculoId) : null;
      if (destino && galao.id === destino.id) {
        throw new BadRequestException('O galão não abastece a si mesmo.');
      }

      const litros = litrosValidos(dados.litros);
      const estoque = await this.estoqueDoGalao(galao.id);
      if (litros > estoque.litros + 0.001) {
        throw new BadRequestException(
          `No ${galao.apelido} há ${litrosEscritos(estoque.litros)} — não dá para tirar ${litrosEscritos(litros)}.`,
        );
      }

      // A roçadeira não tem painel: sem veículo, não há medidor a pedir.
      const medidor = destino
        ? await this.medidorDoDestino(destino, dados)
        : { km: null, horimetro: null };
      const criado = await this.prisma.abastecimento.create({
        data: {
          veiculoId: destino?.id ?? null,
          outroDestino,
          galaoId: galao.id,
          litros,
          ...medidor,
          data: new Date(),
          funcionarioId: funcionario.id,
          usuarioId: usuarioId ?? null,
          lancadoPor: quem,
        },
        include: {
          foto: { select: { id: true } },
          galao: { select: { id: true, apelido: true } },
        },
      });
      this.logger.log(
        `${funcionario.nome} pôs ${litrosEscritos(litros)} do ${galao.apelido} em ` +
          `${destino?.apelido ?? `"${outroDestino}"`}.`,
      );
      return this.valorizada(criado);
    }

    if (!dados.veiculoId) {
      throw new BadRequestException('Escolha o veículo que você abasteceu.');
    }
    const destino = await this.veiculoAtivo(dados.veiculoId);

    // A ida ao posto: só quem tem a coisa no nome é que a abastece.
    if (!estaNoNome(destino, funcionario.id)) {
      throw new ForbiddenException(
        'Este veículo não está com você. Peça ao administrador para colocá-lo no seu nome.',
      );
    }
    const foto = conferirFoto(dados.foto);
    // No galão os litros são o estoque: sem eles não há de onde tirar depois.
    const litros =
      destino.tipo === 'GALAO' ? litrosValidos(dados.litros) : litrosSeVierem(dados.litros);
    const medidor = await this.medidorDoDestino(destino, dados);

    const criado = await this.prisma.abastecimento.create({
      data: {
        veiculoId: destino.id,
        litros,
        ...medidor,
        data: new Date(),
        funcionarioId: funcionario.id,
        usuarioId: usuarioId ?? null,
        lancadoPor: quem,
        foto: { create: { foto } },
      },
      include: {
        foto: { select: { id: true } },
        galao: { select: { id: true, apelido: true } },
      },
    });
    this.logger.log(
      `${funcionario.nome} abasteceu ${destino.apelido} (a conferir).`,
    );
    return naTela(criado);
  }

  /**
   * O medidor de quem recebeu o combustível.
   *
   * A máquina conta horas — o horímetro é o painel dela —, o carro conta km, e
   * o galão não conta nada: ele não anda, só guarda. Nenhum dos dois volta
   * para trás, que é o erro de digitação de sempre no posto.
   */
  private async medidorDoDestino(
    veiculo: { id: string; apelido: string; tipo: TipoVeiculo },
    dados: { km?: number | null; horimetro?: number | null },
  ): Promise<{ km: number | null; horimetro: number | null }> {
    if (veiculo.tipo === 'GALAO') return { km: null, horimetro: null };

    if (veiculo.tipo === 'MAQUINA') {
      const horimetro = horimetroValido(
        dados.horimetro,
        'Digite o horímetro da máquina — as horas do painel, com o décimo se houver.',
      );
      await this.conferirMedidor(veiculo, 'horimetro', horimetro);
      return { km: null, horimetro };
    }

    const km = medidorValido(dados.km, 'Digite o km do painel, só os números.');
    await this.conferirMedidor(veiculo, 'km', km);
    return { km, horimetro: null };
  }

  // --- O sistema ---

  /**
   * O abastecimento lançado por dentro, na ficha do veículo. Aqui o valor pode
   * vir junto — quem lança é o administrador, com a nota na mão —, e aí ele já
   * nasce conferido.
   */
  async lancarPeloSistema(
    veiculoId: string,
    dados: { km?: number | null; horimetro?: number | null; litros?: number | null; foto: string; valor?: number | null },
    quem: { id?: string; nome: string },
  ): Promise<AbastecimentoNaTela> {
    conferirFoto(dados.foto);
    const valor = dados.valor == null ? null : valorValido(dados.valor);
    const veiculo = await this.veiculoAtivo(veiculoId);
    const litros =
      veiculo.tipo === 'GALAO' ? litrosValidos(dados.litros) : litrosSeVierem(dados.litros);
    const medidor = await this.medidorDoDestino(veiculo, dados);

    const criado = await this.prisma.abastecimento.create({
      data: {
        veiculoId: veiculo.id,
        litros,
        ...medidor,
        valor,
        data: new Date(),
        usuarioId: quem.id ?? null,
        lancadoPor: quem.nome,
        ...(valor != null ? { conferidoPor: quem.nome, conferidoEm: new Date() } : {}),
        foto: { create: { foto: dados.foto } },
      },
      include: {
        foto: { select: { id: true } },
        galao: { select: { id: true, apelido: true } },
      },
    });
    this.logger.log(`${quem.nome} lançou abastecimento em ${veiculo.apelido}.`);
    return naTela(criado);
  }

  /**
   * O administrador põe (ou corrige) o que está escrito na nota.
   *
   * O valor é o que se cobra; os litros vêm junto porque estão na mesma linha
   * do papel — quem abastece nem sempre olha a bomba, e sem os litros não há
   * média de consumo nenhuma. Litros ausente não mexe nos que já estavam lá.
   */
  async conferir(
    id: string,
    valor: number,
    quem: string,
    litros?: number | null,
  ): Promise<AbastecimentoNaTela> {
    const achado = await this.prisma.abastecimento.findUnique({ where: { id }, select: { id: true } });
    if (!achado) throw new NotFoundException('Abastecimento não encontrado.');
    const atualizado = await this.prisma.abastecimento.update({
      where: { id },
      data: {
        valor: valorValido(valor),
        litros: litros == null ? undefined : litrosValidos(litros),
        conferidoPor: quem,
        conferidoEm: new Date(),
      },
      include: { foto: { select: { id: true } } },
    });
    return naTela(atualizado);
  }

  /**
   * A fila da conferência: as idas ao posto que esperam o valor da nota.
   *
   * A saída de um galão não entra aqui. Não há nota para ler: o valor dela sai
   * do preço do litro que está no galão, e pedir que alguém o digite seria
   * pedir para inventar um número que já existe.
   */
  async aConferir(): Promise<AbastecimentoAConferir[]> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { valor: null, galaoId: null },
      orderBy: [{ data: 'asc' }],
      include: {
        foto: { select: { id: true } },
        galao: { select: { id: true, apelido: true } },
        veiculo: { select: { id: true, apelido: true, placa: true } },
      },
    });
    // A ida ao posto é sempre de um veículo; sem ele seria saída de galão, que não vem aqui.
    return lista.flatMap((a) => (a.veiculo ? [{ ...naTela(a), veiculo: a.veiculo }] : []));
  }

  async doVeiculo(veiculoId: string): Promise<AbastecimentoNaTela[]> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { veiculoId },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      include: {
        foto: { select: { id: true } },
        galao: { select: { id: true, apelido: true } },
      },
    });
    const precos = await this.precosDosGaloes();
    return lista.map((a) => valorizar(naTela(a), a.galaoId, precos));
  }

  /** O que já saiu deste galão, e para onde foi — veículo da frota ou outro destino. */
  async saidasDoGalao(galaoId: string): Promise<SaidaDoGalao[]> {
    const lista = await this.prisma.abastecimento.findMany({
      where: { galaoId },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
      include: {
        foto: { select: { id: true } },
        galao: { select: { id: true, apelido: true } },
        veiculo: { select: { id: true, apelido: true, placa: true } },
      },
    });
    const precos = await this.precosDosGaloes();
    return lista.map((a) => ({
      ...valorizar(naTela(a), a.galaoId, precos),
      veiculo: a.veiculo,
      outroDestino: a.outroDestino,
    }));
  }

  async resumo(veiculoId: string): Promise<ResumoDoCombustivel> {
    const [veiculo, lista, precos] = await Promise.all([
      this.prisma.veiculo.findUnique({
        where: { id: veiculoId },
        select: { tipo: true, consumoIdeal: true },
      }),
      this.prisma.abastecimento.findMany({
        where: { veiculoId },
        orderBy: [{ data: 'asc' }, { createdAt: 'asc' }],
        select: { valor: true, km: true, horimetro: true, litros: true, galaoId: true },
      }),
      this.precosDosGaloes(),
    ]);

    return resumirCombustivel(
      lista.map((a) => ({
        valor: valorDoAbastecimento(a, precos),
        km: a.km,
        horimetro: numero(a.horimetro),
        litros: a.litros == null ? null : Number(a.litros),
      })),
      veiculo?.tipo === 'MAQUINA' ? 'horimetro' : 'km',
      numero(veiculo?.consumoIdeal),
    );
  }

  /**
   * O que há dentro de um galão: os litros que entraram menos os que saíram, e
   * por quanto saiu o litro.
   *
   * O preço é a média do que se pagou nas compras **já conferidas** — a nota
   * que ainda não foi lida não tem valor, e entrar na média com zero faria o
   * diesel parecer de graça. Os litros dessa nota contam no estoque de
   * qualquer forma: eles estão lá dentro, conferidos ou não.
   */
  async estoqueDoGalao(galaoId: string): Promise<EstoqueDoGalao> {
    const [compras, conferidas, saidas] = await Promise.all([
      this.prisma.abastecimento.aggregate({
        where: { veiculoId: galaoId, galaoId: null },
        _sum: { litros: true },
      }),
      this.prisma.abastecimento.aggregate({
        where: { veiculoId: galaoId, galaoId: null, valor: { not: null } },
        _sum: { litros: true, valor: true },
      }),
      this.prisma.abastecimento.aggregate({
        where: { galaoId },
        _sum: { litros: true },
      }),
    ]);

    const entrou = Number(compras._sum.litros ?? 0);
    const saiu = Number(saidas._sum.litros ?? 0);
    const litrosPagos = Number(conferidas._sum.litros ?? 0);
    const pago = Number(conferidas._sum.valor ?? 0);
    const precoPorLitro = litrosPagos > 0 ? pago / litrosPagos : null;
    const litros = centavos(entrou - saiu);

    return {
      litros,
      precoPorLitro: precoPorLitro == null ? null : Math.round(precoPorLitro * 1e4) / 1e4,
      valor: precoPorLitro == null ? null : centavos(litros * precoPorLitro),
      litrosSemValor: centavos(entrou - litrosPagos),
    };
  }

  /**
   * Quanto custou o litro em cada galão, de uma vez só.
   *
   * As saídas não guardam valor: elas valem o preço do galão de onde vieram, e
   * esse preço muda quando uma nota atrasada é conferida. Calcular na hora de
   * mostrar é o que faz o custo da máquina se corrigir sozinho quando a nota
   * chega.
   */
  async precosDosGaloes(): Promise<Map<string, number>> {
    const compras = await this.prisma.abastecimento.groupBy({
      by: ['veiculoId'],
      where: {
        galaoId: null,
        valor: { not: null },
        litros: { not: null },
        veiculo: { tipo: 'GALAO' },
      },
      _sum: { valor: true, litros: true },
    });
    const precos = new Map<string, number>();
    for (const c of compras) {
      const litros = Number(c._sum.litros ?? 0);
      if (c.veiculoId && litros > 0) precos.set(c.veiculoId, Number(c._sum.valor ?? 0) / litros);
    }
    return precos;
  }

  /** Um lançamento só, com o valor da saída já calculado. */
  private async valorizada(a: AbastecimentoCru & { galaoId: string | null }) {
    return valorizar(naTela(a), a.galaoId, await this.precosDosGaloes());
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
      select: {
        id: true,
        apelido: true,
        tipo: true,
        ativo: true,
        responsaveis: { select: { funcionarioId: true } },
      },
    });
    if (!veiculo || !veiculo.ativo) {
      throw new NotFoundException('Este veículo não está mais na frota.');
    }
    return veiculo;
  }

  /** O medidor não anda para trás — é o erro de digitação mais comum no posto. */
  private async conferirMedidor(
    veiculo: { id: string; apelido: string },
    campo: 'km' | 'horimetro',
    valor: number,
  ) {
    const anterior = await this.ultimoMedidor(veiculo.id, campo);
    if (anterior != null && valor < anterior) {
      const unidade = campo === 'km' ? 'km' : 'horas';
      // O horímetro como está no painel da máquina: "1252.6", com o ponto.
      const escrito =
        campo === 'km'
          ? anterior.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
          : anterior.toFixed(1);
      throw new BadRequestException(
        `O último abastecimento de ${veiculo.apelido} foi com ${escrito} ${unidade}. ` +
          `O de agora não pode ser menor — confira o painel.`,
      );
    }
  }

  private async ultimoMedidor(
    veiculoId: string,
    campo: 'km' | 'horimetro',
  ): Promise<number | null> {
    const r = await this.prisma.abastecimento.aggregate({
      where: { veiculoId },
      _max: { km: true, horimetro: true },
    });
    // O horímetro é decimal no banco: vem como `Decimal`, e não como número.
    return numero(campo === 'km' ? r._max.km : r._max.horimetro);
  }

  /** O colaborador do login, ainda ativo na casa — a mesma régua do portal. */
  private async colaboradorAtivo(
    funcionarioId: string,
  ): Promise<{ id: string; nome: string; apelido: string | null }> {
    const achado = await this.prisma.funcionario.findFirst({
      where: { id: funcionarioId, ativo: true, isentoIcms: true },
      select: { id: true, nome: true, apelido: true },
    });
    if (!achado) {
      throw new NotFoundException('Seu cadastro não está entre os funcionários ativos da empresa.');
    }
    return achado;
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

/**
 * Se o veículo está no nome desta pessoa. Basta ser um dos responsáveis: o
 * carro de dois é de cada um deles por inteiro.
 */
function estaNoNome(
  veiculo: { responsaveis: Array<{ funcionarioId: string }> },
  funcionarioId: string,
): boolean {
  return veiculo.responsaveis.some((r) => r.funcionarioId === funcionarioId);
}

/** A nota do posto, que é o que prova a compra. Devolve a foto conferida. */
function conferirFoto(foto: string | undefined): string {
  if (!foto) throw new BadRequestException('Tire ou anexe a foto da nota do posto.');
  conferirArquivo(lerDataUrl(foto), FOTO_ACEITA, FOTO_MAXIMA, 'A foto precisa ser JPEG, PNG ou WebP.');
  return foto;
}

/** O km do painel: inteiro, e nunca negativo. */
function medidorValido(valor: number | null | undefined, reclamacao: string): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 9_999_999) {
    throw new BadRequestException(reclamacao);
  }
  return n;
}

/**
 * As horas do horímetro, com o décimo que o ponteiro mostra.
 *
 * 1252.6 é mil duzentas e cinquenta e duas horas e trinta e seis minutos — o
 * horímetro conta assim, de seis em seis minutos, e é assim que a pessoa lê o
 * painel. Mais de uma casa não existe no aparelho; o que vier a mais se
 * arredonda para o décimo mais perto.
 */
function horimetroValido(valor: number | null | undefined, reclamacao: string): number {
  const n = Math.round(Number(valor) * 10) / 10;
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) {
    throw new BadRequestException(reclamacao);
  }
  return n;
}

/** Nenhum galão da casa passa disto; acima é dedo escorregado no zero. */
const LITROS_MAXIMOS = 5_000;

function litrosValidos(litros: number | null | undefined): number {
  const n = Math.round(Number(litros) * 100) / 100;
  if (!(n > 0) || n > LITROS_MAXIMOS) {
    throw new BadRequestException('Digite quantos litros, só os números.');
  }
  return n;
}

/** Os litros do carro são bem-vindos, mas ninguém é obrigado a olhar a bomba. */
function litrosSeVierem(litros: number | null | undefined): number | null {
  if (litros == null || Number(litros) === 0) return null;
  return litrosValidos(litros);
}

/** O que o Prisma devolve de uma coluna decimal, como número — ou nada. */
function numero(v: { toString(): string } | number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/** "12,5 L" — para as mensagens de erro, que são lidas no posto. */
function litrosEscritos(litros: number): string {
  return `${litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;
}

/** Duas casas, que é o que o dinheiro e o litro têm. */
function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * O que este lançamento custou.
 *
 * A compra vale a nota. A saída de um galão vale os litros pelo preço daquele
 * galão — e enquanto nenhuma nota dele tiver sido conferida, não vale nada
 * ainda: o preço não existe para ser inventado.
 */
function valorDoAbastecimento(
  a: { valor: unknown; litros: unknown; galaoId: string | null },
  precos: Map<string, number>,
): number | null {
  if (a.valor != null) return Number(a.valor);
  if (!a.galaoId || a.litros == null) return null;
  const preco = precos.get(a.galaoId);
  return preco == null ? null : centavos(Number(a.litros) * preco);
}

/** O mesmo, já no formato da tela. */
function valorizar(
  base: AbastecimentoNaTela,
  galaoId: string | null | undefined,
  precos: Map<string, number>,
): AbastecimentoNaTela {
  if (base.valor != null || !galaoId || base.litros == null) return base;
  const preco = precos.get(galaoId);
  return preco == null ? base : { ...base, valor: centavos(base.litros * preco) };
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
    horimetro: numero(a.horimetro),
    litros: a.litros == null ? null : Number(a.litros),
    galao: a.galao ?? null,
    data: a.data.toISOString(),
    lancadoPor: a.lancadoPor,
    temFoto: !!a.foto,
    conferidoPor: a.conferidoPor,
  };
}

/**
 * O combustível de um veículo somado, em ordem de data.
 *
 * `medidor` diz em que unidade este veículo anda: o carro conta km, a máquina
 * conta as horas do horímetro. A conta é a mesma dos dois lados — quanto
 * custou cada km, quanto custou cada hora —, e o primeiro abastecimento fica
 * de fora dela: o combustível dele foi gasto antes do primeiro km registrado.
 */
export function resumirCombustivel(
  lista: Array<{
    valor: number | null;
    km?: number | null;
    horimetro?: number | null;
    litros?: number | null;
  }>,
  medidor: 'km' | 'horimetro' = 'km',
  /** A média que se espera do veículo, para o resumo já dizer se ela caiu. */
  ideal: number | null = null,
): ResumoDoCombustivel {
  const total = lista.reduce((s, a) => s + (a.valor ?? 0), 0);
  const litros = lista.reduce((s, a) => s + (a.litros ?? 0), 0);

  // Só os que trouxeram medidor entram na conta de rodagem: a saída de um
  // galão para um carro pode vir sem km, e o galão nunca tem nenhum.
  const comMedidor = lista
    .map((a) => (medidor === 'km' ? a.km : a.horimetro))
    .filter((n): n is number => n != null);
  const primeiro = comMedidor[0];
  const ultimo = comMedidor[comMedidor.length - 1];
  const andados =
    comMedidor.length > 1 ? Math.max(...comMedidor) - Math.min(...comMedidor) : null;

  const depoisDoPrimeiro = lista.slice(1);
  const todosComValor = depoisDoPrimeiro.every((a) => a.valor != null);
  const gastoDepois = depoisDoPrimeiro.reduce((s, a) => s + (a.valor ?? 0), 0);
  const porUnidade =
    andados && andados > 0 && todosComValor
      ? Math.round((gastoDepois / andados) * 100) / 100
      : null;

  return {
    total: Math.round(total * 100) / 100,
    quantidade: lista.length,
    aConferir: lista.filter((a) => a.valor == null).length,
    litros: Math.round(litros * 100) / 100,
    consumo: mediaDeConsumo(lista, medidor, ideal),
    ultimoKm: medidor === 'km' ? (ultimo ?? primeiro ?? null) : null,
    ultimoHorimetro: medidor === 'horimetro' ? (ultimo ?? primeiro ?? null) : null,
    kmRodados: medidor === 'km' ? andados : null,
    custoPorKm: medidor === 'km' ? porUnidade : null,
    horasTrabalhadas: medidor === 'horimetro' ? andados : null,
    custoPorHora: medidor === 'horimetro' ? porUnidade : null,
  };
}

/**
 * A média que o veículo está fazendo.
 *
 * A conta é a do posto: **o combustível de um abastecimento é o que leva o
 * veículo até o próximo**. Por isso o primeiro fica de fora dos litros — o que
 * entrou nele foi queimado antes do primeiro km que se conhece — e o que se
 * divide é o que se andou do primeiro ao último medidor pelos litros que
 * vieram depois dele.
 *
 * Só entram os abastecimentos que trouxeram medidor: a saída de um galão para
 * uma máquina pode vir sem, e um litro sem quilômetro nenhum atrás dele
 * estragaria a média dos outros.
 *
 * Nas máquinas a conta se inverte — ninguém pergunta quantos quilômetros uma
 * retroescavadeira faz por litro; pergunta-se quantos litros ela come por hora
 * de trabalho.
 */
export function mediaDeConsumo(
  lista: Array<{ km?: number | null; horimetro?: number | null; litros?: number | null }>,
  medidor: 'km' | 'horimetro' = 'km',
  /** A média que se espera deste veículo, quando a casa a cadastrou. */
  ideal: number | null = null,
): Consumo {
  const unidade = medidor === 'km' ? 'km_por_litro' : 'litros_por_hora';
  const medidos = lista.filter(
    (a) => (medidor === 'km' ? a.km : a.horimetro) != null,
  );
  const vazio: Consumo = {
    medio: null,
    ultimo: null,
    unidade,
    base: medidos.length,
    ideal,
    irregular: false,
    ultimoIrregular: false,
  };
  if (medidos.length < 2) return vazio;

  const valor = (a: (typeof medidos)[number]) =>
    (medidor === 'km' ? a.km : a.horimetro) as number;

  const andados = valor(medidos[medidos.length - 1]) - valor(medidos[0]);
  const litrosDepois = medidos
    .slice(1)
    .reduce((soma, a) => soma + (a.litros ?? 0), 0);
  if (andados <= 0 || litrosDepois <= 0) return vazio;

  // O trecho mais recente: o que se andou desde a última vez, pelos litros
  // que entraram agora.
  const ultimo = medidos[medidos.length - 1];
  const penultimo = medidos[medidos.length - 2];
  const andadosAgora = valor(ultimo) - valor(penultimo);
  const litrosAgora = ultimo.litros ?? 0;

  const conta = (distancia: number, litros: number) =>
    medidor === 'km' ? distancia / litros : litros / distancia;

  const medio = arredondar(conta(andados, litrosDepois));
  const ultimoTrecho =
    andadosAgora > 0 && litrosAgora > 0
      ? arredondar(conta(andadosAgora, litrosAgora))
      : null;

  /*
   * Pior que o esperado quer dizer coisas opostas nos dois medidores: o carro
   * que faz menos quilômetros por litro está gastando mais, e a máquina que
   * faz mais litros por hora também.
   */
  const pior = (valor: number | null) =>
    valor != null && ideal != null && (medidor === 'km' ? valor < ideal : valor > ideal);

  return {
    medio,
    ultimo: ultimoTrecho,
    unidade,
    base: medidos.length,
    ideal,
    irregular: pior(medio),
    ultimoIrregular: pior(ultimoTrecho),
  };
}

/** Duas casas: "8,25 km/L" já é mais precisão do que a bomba do posto tem. */
function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
