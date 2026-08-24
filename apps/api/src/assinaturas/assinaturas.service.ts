import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssinaturaDiaria, FormaPagamento, ModoAssinatura } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { descreverPartes } from '../financeiro/pagamento.calc';
import { PrismaService } from '../prisma/prisma.service';
import { AssinarDto } from './dto/assinatura.dto';

/** Quanto tempo um link fica de pé sem ninguém usar. */
export const VALIDADE_DIAS = 7;

/**
 * O recibo como a tela pública o mostra: só o que a pessoa precisa ver para
 * saber o que está assinando. Nada do cadastro dela além do nome e do CPF que
 * já sairiam impressos no papel — a página é aberta, então o que não é do
 * recibo não passa por aqui.
 */
export interface ReciboPublico {
  quemPaga: { nome: string; cnpj: string | null };
  quemRecebe: { nome: string; cpfCnpj: string | null };
  valor: string;
  descricao: string;
  detalhamento: string | null;
  data: Date;
  /** Já assinado: a tela vira comprovante em vez de formulário. */
  assinado: boolean;
  /**
   * Espera-se outra assinatura, pedida lá de dentro.
   *
   * Vale mais que `assinado`: durante a recoleta os dois são verdade ao mesmo
   * tempo — a antiga continua guardada de propósito, porque o recibo dela pode
   * já ser a nota de um lançamento do caixa —, e é este que decide se a tela
   * mostra a prancheta ou o comprovante.
   */
  recoletando: boolean;
  assinadoEm: Date | null;
  assinaturaPng: string | null;
  /** Desenhada com o dedo, ou gerada a partir do nome */
  modo: ModoAssinatura;
}

@Injectable()
export class AssinaturasService {
  private readonly logger = new Logger(AssinaturasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
  ) {}

  /**
   * Abre (ou reabre) a coleta de assinatura de uma diária paga em mãos.
   *
   * O recibo é montado agora e congelado: valor, serviço, nomes e o CNPJ de
   * quem paga ficam gravados como estão neste instante. Se amanhã alguém
   * corrigir o cadastro do diarista, o papel que ele assinou continua dizendo o
   * que dizia quando ele assinou.
   *
   * Chamar de novo antes de alguém assinar sorteia outro token e estica o
   * prazo — é o "perdi o link, manda de novo".
   *
   * Depois de assinado, só com `substituir`. Assinado era o fim, e na prática
   * há motivo para refazer: assinou no lugar errado, o traço saiu ilegível, quem
   * segurava o celular era outra pessoa. Sem caminho, a saída era apagar a
   * diária e lançar de novo — mexer no caixa para consertar um rabisco. A
   * confirmação é da tela; aqui a recusa é só a rede de segurança, para nenhum
   * clique solto apagar uma assinatura.
   *
   * A assinatura antiga fica até a nova chegar: o recibo dela pode já ser a
   * nota de um lançamento do caixa, e limpá-la ao reabrir deixaria essa nota
   * sem documento no meio do caminho.
   */
  async gerarLink(
    diariaId: string,
    usuarioId?: string,
    substituir = false,
  ): Promise<AssinaturaDiaria> {
    const diaria = await this.prisma.diaria.findUnique({
      where: { id: diariaId },
      include: { diarista: true, assinatura: true },
    });
    if (!diaria) throw new NotFoundException('Diária não encontrada');

    if (diaria.forma !== FormaPagamento.EM_MAOS) {
      throw new BadRequestException(
        'Esta diária foi paga pelo IXC — o comprovante dela é o do banco. ' +
          'A assinatura serve ao dinheiro entregue em mãos.',
      );
    }
    const jaAssinada = !!diaria.assinatura?.assinadoEm;
    if (jaAssinada && !substituir) {
      throw new BadRequestException(
        'Esta diária já foi assinada. Para coletar de novo, confirme que quer ' +
          'substituir a assinatura atual.',
      );
    }

    const cfg = await this.config.obter();
    const detalhamento = descreverPartes({
      quantidade: Number(diaria.quantidade),
      valorDiaria: Number(diaria.valorDiaria),
      vendas: diaria.vendas,
      valorPorVenda: Number(diaria.valorPorVenda ?? 0),
      valorExtra: Number(diaria.valorExtra),
      descricaoExtra: diaria.descricaoExtra,
    }).join(' · ');

    const retrato = {
      valor: diaria.valor,
      descricao: diaria.descricao,
      dataDiaria: diaria.data,
      detalhamento: detalhamento || null,
      cpfAssinante: diaria.diarista.cpfCnpj,
      empresaNome: cfg.empresaNome.trim() || 'ILNET',
      empresaCnpj: cfg.empresaCnpj.trim() || null,
    };

    return this.prisma.assinaturaDiaria.upsert({
      where: { diariaId },
      create: {
        diariaId,
        token: novoToken(),
        expiraEm: daquiADias(VALIDADE_DIAS),
        criadoPor: usuarioId ?? null,
        ...retrato,
      },
      update: {
        token: novoToken(),
        expiraEm: daquiADias(VALIDADE_DIAS),
        criadoPor: usuarioId ?? null,
        ...retrato,
        // Reabrindo uma já assinada, fica marcado que se espera outra — é o que
        // destrava o link de assinar. A antiga continua respondendo pelo recibo
        // até a nova chegar.
        ...(jaAssinada
          ? { recoletandoDesde: new Date(), recoletadoPor: usuarioId ?? null }
          : {}),
      },
    });
  }

  /** O recibo de uma diária, para a tela de quem paga. */
  async doDiaria(diariaId: string): Promise<AssinaturaDiaria | null> {
    return this.prisma.assinaturaDiaria.findUnique({ where: { diariaId } });
  }

  /**
   * Abre o link. É a única porta de entrada de quem vai assinar, e ela não
   * pede login: o diarista não tem conta aqui e não vai criar uma para dizer
   * que recebeu o dinheiro dele.
   */
  async abrirPorToken(token: string): Promise<ReciboPublico> {
    const a = await this.buscarPorToken(token);

    // Já assinado não é erro: é o comprovante. Quem abrir de novo o link vê o
    // que assinou, em vez de uma tela quebrada.
    if (!a.assinadoEm && a.expiraEm < new Date()) {
      throw new GoneException(
        'Este link venceu. Peça um novo a quem fez o pagamento.',
      );
    }

    return {
      quemPaga: { nome: a.empresaNome, cnpj: a.empresaCnpj },
      quemRecebe: {
        nome: a.nomeAssinante ?? a.diaria.diarista.nome,
        cpfCnpj: a.cpfAssinante,
      },
      valor: a.valor.toString(),
      descricao: a.descricao,
      detalhamento: a.detalhamento,
      data: a.dataDiaria,
      assinado: a.assinadoEm !== null,
      recoletando: a.recoletandoDesde !== null,
      assinadoEm: a.assinadoEm,
      assinaturaPng: a.assinaturaPng,
      modo: a.modo,
    };
  }

  /**
   * Guarda a assinatura. O link morre aqui: um recibo é assinado uma vez, e
   * deixar o link vivo depois disso é convite para a mesma diária ganhar duas
   * assinaturas diferentes.
   *
   * A exceção é a recoleta, pedida de propósito lá de dentro: aí a nova
   * assinatura substitui a anterior, e a contagem de recoletas sobe — um recibo
   * assinado três vezes é uma pergunta que alguém vai querer fazer.
   *
   * O IP e o aparelho ficam junto. Não provam quem segurava o celular, mas são
   * o que existe para responder "de onde veio isso" se alguém contestar.
   */
  async assinar(
    token: string,
    dto: AssinarDto,
    origem: { ip?: string; userAgent?: string },
  ): Promise<ReciboPublico> {
    const a = await this.buscarPorToken(token);
    const recoletando = !!a.recoletandoDesde;
    if (a.assinadoEm && !recoletando) {
      throw new BadRequestException('Este recibo já foi assinado.');
    }
    if (a.expiraEm < new Date()) {
      throw new GoneException(
        'Este link venceu. Peça um novo a quem fez o pagamento.',
      );
    }

    await this.prisma.assinaturaDiaria.update({
      where: { id: a.id },
      data: {
        assinaturaPng: dto.assinatura,
        assinadoEm: new Date(),
        modo: dto.modo ?? ModoAssinatura.DESENHADA,
        nomeAssinante: dto.nome?.trim() || a.diaria.diarista.nome,
        ip: origem.ip?.slice(0, 60) ?? null,
        userAgent: origem.userAgent?.slice(0, 300) ?? null,
        ...(recoletando
          ? { recoletandoDesde: null, recoletas: { increment: 1 } }
          : {}),
      },
    });

    this.logger.log(
      `Diária ${a.diariaId} assinada por quem recebeu (recibo ${a.id})` +
        (recoletando
          ? ` — assinatura substituída (${a.recoletas + 1}ª recoleta)`
          : ''),
    );
    return this.abrirPorToken(token);
  }

  /** O recibo completo, com a diária e o diarista, para montar o PDF. */
  async paraRecibo(diariaId: string) {
    const a = await this.prisma.assinaturaDiaria.findUnique({
      where: { diariaId },
      include: { diaria: { include: { diarista: true } } },
    });
    if (!a) throw new NotFoundException('Esta diária não tem recibo.');
    if (!a.assinadoEm) {
      throw new BadRequestException(
        'Este recibo ainda não foi assinado — não há o que imprimir.',
      );
    }
    return a;
  }

  private async buscarPorToken(token: string) {
    const a = await this.prisma.assinaturaDiaria.findUnique({
      where: { token },
      include: { diaria: { include: { diarista: true } } },
    });
    if (!a) {
      throw new NotFoundException(
        'Link de assinatura não encontrado. Ele pode ter sido substituído por um novo.',
      );
    }
    return a;
  }
}

/**
 * O segredo que vai na URL. 32 bytes sorteados: é o que separa o recibo de
 * quem recebeu de qualquer um que resolva chutar endereços.
 */
function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

function daquiADias(dias: number): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}
