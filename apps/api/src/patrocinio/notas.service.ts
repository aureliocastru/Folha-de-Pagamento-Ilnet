import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModoAssinatura, Prisma, TipoDePatrocinio } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AssinarDto } from '../assinaturas/dto/assinatura.dto';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { PrismaService } from '../prisma/prisma.service';
import { paraNomeDeArquivo } from './contratos.service';
import { declaracaoDaNota, gerarNotaPdf } from './nota.pdf';
import { NOTA_NA_LISTA, PatrocinioService } from './patrocinio.service';

/**
 * Quanto tempo o link da nota fica de pé sem ninguém assinar. O do contrato
 * (15 dias), e não a semana do recibo da diária: o patrocinado nem sempre está
 * perto — o dinheiro sai por PIX, e a nota vai pelo WhatsApp.
 */
export const VALIDADE_DA_NOTA_DIAS = 15;

/** As abas da tela de notas. */
export type SituacaoDaNota = 'A_BAIXAR' | 'AGUARDANDO' | 'BAIXADAS';

/** Quantas notas baixadas a aba traz: as mais recentes. As velhas estão na ficha de cada um. */
const BAIXADAS_NA_LISTA = 300;

/**
 * A nota como a tela pública a mostra: o que a pessoa precisa ler para saber o
 * que está assinando, e nada do cadastro além disso — a página abre sem login.
 */
export interface NotaPublica {
  empresa: { nome: string; cnpj: string | null };
  patrocinado: { nome: string; cpfCnpj: string | null; projeto: string | null };
  /** O nome que a tela sugere para quem assina: o responsável, ou o próprio. */
  quemAssina: string;
  /** A frase que sai no papel, com o nome de quem assina — o que a assinatura confirma. */
  declaracao: string;
  valor: string;
  referente: string;
  vencimento: Date | null;
  pagoEm: Date | null;
  assinado: boolean;
  assinadoEm: Date | null;
  assinaturaPng: string | null;
  nomeAssinante: string | null;
  modo: ModoAssinatura;
}

/**
 * As notas de recebimento: o patrocinado assina, pelo link, que recebeu o
 * dinheiro de um pagamento; a nota assinada cai na aba Notas, onde alguém
 * confere e dá baixa.
 *
 * Uma nota por título do IXC. O valor vem do título, lido de novo no IXC na
 * hora do link — nunca do que a tela mandou —, e fica congelado na nota.
 *
 * A baixa é só daqui: diz que a nota foi conferida e arquivada. O título no IXC
 * não é tocado; pagar continua sendo do Contas a Pagar.
 */
@Injectable()
export class NotasDeRecebimentoService {
  private readonly logger = new Logger(NotasDeRecebimentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigFinanceiraService,
    private readonly patrocinio: PatrocinioService,
  ) {}

  /**
   * Abre (ou renova) o link da nota de um pagamento.
   *
   * Havendo nota sem assinatura para o mesmo título, ela é reaproveitada com
   * outro token e o retrato de agora — é o "perdi o link" e também o "o valor
   * do título mudou". Assinada, não se gera outra: o papel está feito.
   */
  async gerarLink(patrocinadoId: string, idFnApagar: number, usuarioId?: string) {
    const p = await this.prisma.patrocinado.findUnique({ where: { id: patrocinadoId } });
    if (!p) throw new NotFoundException('Patrocinado não encontrado.');
    if (p.tipo === TipoDePatrocinio.DESCONTO && !p.idFornecedorIxc) {
      throw new BadRequestException(
        'Este patrocínio é desconto na mensalidade: não há dinheiro, nem nota para assinar.',
      );
    }
    if (!p.idFornecedorIxc) {
      throw new BadRequestException(
        'Este patrocinado não está ligado a nenhum fornecedor do IXC — não há pagamento para a nota.',
      );
    }

    const existente = await this.prisma.notaDeRecebimento.findUnique({ where: { idFnApagar } });
    if (existente?.assinadoEm) {
      throw new BadRequestException('A nota deste pagamento já foi assinada.');
    }

    // O título conferido no IXC: o valor da nota é o dele, e ele tem de ser
    // deste patrocinado.
    const pagamentos = await this.patrocinio.pagamentosDoFornecedor(p.idFornecedorIxc);
    const pagamento = pagamentos.find((pg) => pg.idFnApagar === idFnApagar);
    if (!pagamento) {
      throw new NotFoundException(
        `O título nº ${idFnApagar} não está entre os pagamentos de ${p.nome} no IXC.`,
      );
    }
    if (!(pagamento.valor > 0)) {
      throw new BadRequestException('Este pagamento está sem valor no IXC — não há o que receber.');
    }

    const cfg = await this.config.obter();
    const retrato = {
      patrocinadoId,
      token: novoToken(),
      expiraEm: daquiADias(VALIDADE_DA_NOTA_DIAS),
      valor: new Prisma.Decimal(pagamento.valor),
      referente: pagamento.descricao?.trim() || referentePadrao(p.nome, pagamento.vencimento),
      vencimento: pagamento.vencimento,
      pagoEm: pagamento.pagoEm,
      nomePatrocinado: p.nome,
      cpfPatrocinado: p.cpfCnpj,
      projeto: p.projeto,
      empresaNome: cfg.empresaNome.trim() || 'ILNET',
      empresaCnpj: cfg.empresaCnpj.trim() || null,
      criadoPor: usuarioId ?? null,
    };

    let nota;
    if (existente) {
      // Condicional: se a assinatura chegou entre a leitura e aqui, o link
      // que a pessoa usou não pode ser trocado por baixo dela.
      const r = await this.prisma.notaDeRecebimento.updateMany({
        where: { id: existente.id, assinadoEm: null },
        data: retrato,
      });
      if (r.count === 0) throw new BadRequestException('A nota deste pagamento acabou de ser assinada.');
      nota = await this.prisma.notaDeRecebimento.findUniqueOrThrow({
        where: { id: existente.id },
        select: NOTA_NA_LISTA,
      });
    } else {
      try {
        nota = await this.prisma.notaDeRecebimento.create({
          data: { ...retrato, idFnApagar },
          select: NOTA_NA_LISTA,
        });
      } catch (err) {
        // Duas telas gerando a nota do mesmo pagamento: o banco desempata.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new BadRequestException(
            'A nota deste pagamento acabou de ser gerada por outra tela. Abra de novo.',
          );
        }
        throw err;
      }
    }

    this.logger.log(
      `Nota de recebimento ${existente ? 'renovada' : 'aberta'} para o título ${idFnApagar} ` +
        `do patrocinado ${patrocinadoId} (nota ${nota.id}).`,
    );
    return nota;
  }

  /** As notas de uma aba, com quem é o patrocinado, e quantas há em cada aba. */
  async listar(situacao: SituacaoDaNota) {
    const onde: Record<SituacaoDaNota, Prisma.NotaDeRecebimentoWhereInput> = {
      A_BAIXAR: { assinadoEm: { not: null }, baixadaEm: null },
      AGUARDANDO: { assinadoEm: null },
      BAIXADAS: { baixadaEm: { not: null } },
    };
    // A dar baixa: a mais antiga primeiro, que é a que espera há mais tempo.
    const ordem: Record<SituacaoDaNota, Prisma.NotaDeRecebimentoOrderByWithRelationInput> = {
      A_BAIXAR: { assinadoEm: 'asc' },
      AGUARDANDO: { createdAt: 'desc' },
      BAIXADAS: { baixadaEm: 'desc' },
    };

    const [notas, aBaixar, aguardando, baixadas] = await Promise.all([
      this.prisma.notaDeRecebimento.findMany({
        where: onde[situacao],
        orderBy: ordem[situacao],
        take: situacao === 'BAIXADAS' ? BAIXADAS_NA_LISTA : undefined,
        select: {
          ...NOTA_NA_LISTA,
          patrocinado: { select: { id: true, nome: true, telefone: true, responsavel: true } },
        },
      }),
      this.prisma.notaDeRecebimento.count({ where: onde.A_BAIXAR }),
      this.prisma.notaDeRecebimento.count({ where: onde.AGUARDANDO }),
      this.prisma.notaDeRecebimento.count({ where: onde.BAIXADAS }),
    ]);

    return { situacao, notas, contagem: { A_BAIXAR: aBaixar, AGUARDANDO: aguardando, BAIXADAS: baixadas } };
  }

  /** Uma nota, para a janela que espera a assinatura chegar. */
  async daNota(id: string) {
    const n = await this.prisma.notaDeRecebimento.findUnique({
      where: { id },
      select: { ...NOTA_NA_LISTA, assinaturaPng: true },
    });
    if (!n) throw new NotFoundException('Nota não encontrada.');
    return n;
  }

  /**
   * Dá baixa: a nota assinada foi conferida e arquivada. Dar baixa duas vezes
   * não é erro — a segunda tela só confirma o que a primeira fez.
   */
  async darBaixa(id: string, quem: string | null) {
    const r = await this.prisma.notaDeRecebimento.updateMany({
      where: { id, assinadoEm: { not: null }, baixadaEm: null },
      data: { baixadaEm: new Date(), baixadaPor: quem?.trim() || null },
    });
    const n = await this.daNota(id);
    if (r.count === 0 && !n.baixadaEm) {
      throw new BadRequestException('Esta nota ainda não foi assinada — não há o que baixar.');
    }
    if (r.count > 0) this.logger.log(`Nota ${id} baixada por ${quem ?? 'alguém sem nome'}.`);
    return n;
  }

  /** Volta a nota para "a dar baixa" — a baixa dada por engano. */
  async desfazerBaixa(id: string) {
    await this.daNota(id);
    await this.prisma.notaDeRecebimento.update({
      where: { id },
      data: { baixadaEm: null, baixadaPor: null },
    });
    this.logger.log(`Baixa da nota ${id} desfeita.`);
    return this.daNota(id);
  }

  /**
   * Cancela o link que ninguém assinou. A assinada fica: ela é a prova de que
   * o dinheiro chegou, e quem a apagasse apagaria a única via.
   */
  async remover(id: string): Promise<void> {
    const r = await this.prisma.notaDeRecebimento.deleteMany({ where: { id, assinadoEm: null } });
    if (r.count > 0) return;
    await this.daNota(id);
    throw new BadRequestException('Nota assinada não se apaga: ela é a prova de que o dinheiro chegou.');
  }

  /** A nota assinada em PDF, montada do retrato a cada vez que se pede. */
  async paraBaixar(id: string): Promise<{ nome: string; tipo: string; conteudo: Buffer }> {
    const n = await this.prisma.notaDeRecebimento.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Nota não encontrada.');
    if (!n.assinadoEm || !n.assinaturaPng) {
      throw new BadRequestException('Esta nota ainda não foi assinada — não há o que imprimir.');
    }

    const pdf = await gerarNotaPdf({
      id: n.id,
      empresa: { nome: n.empresaNome, cnpj: n.empresaCnpj },
      patrocinado: { nome: n.nomePatrocinado, cpfCnpj: n.cpfPatrocinado, projeto: n.projeto },
      valor: Number(n.valor),
      referente: n.referente,
      vencimento: n.vencimento,
      pagoEm: n.pagoEm,
      idFnApagar: n.idFnApagar,
      assinadoEm: n.assinadoEm,
      assinaturaPng: n.assinaturaPng,
      nomeAssinante: n.nomeAssinante ?? n.nomePatrocinado,
      modo: n.modo,
      ip: n.ip,
      userAgent: n.userAgent,
    });
    return {
      nome: `nota-de-recebimento-${paraNomeDeArquivo(n.nomePatrocinado)}-${n.idFnApagar}.pdf`,
      tipo: 'application/pdf',
      conteudo: pdf,
    };
  }

  // --- De quem assina (público, só com o link) ---

  /**
   * Abre o link. Já assinada não é erro: é o comprovante — quem abrir de novo
   * vê o que assinou, em vez de uma tela quebrada.
   */
  async abrirPorToken(token: string): Promise<NotaPublica> {
    const n = await this.buscarPorToken(token);
    if (!n.assinadoEm && n.expiraEm < new Date()) {
      throw new GoneException('Este link venceu. Peça um novo à ILNET.');
    }
    const empresa = { nome: n.empresaNome, cnpj: n.empresaCnpj };
    const patrocinado = { nome: n.nomePatrocinado, cpfCnpj: n.cpfPatrocinado, projeto: n.projeto };
    const quemAssina = n.patrocinado.responsavel?.trim() || n.nomePatrocinado;
    return {
      empresa,
      patrocinado,
      quemAssina,
      declaracao: declaracaoDaNota({
        empresa,
        patrocinado,
        valor: Number(n.valor),
        referente: n.referente,
        nomeAssinante: n.nomeAssinante ?? quemAssina,
      }),
      valor: n.valor.toString(),
      referente: n.referente,
      vencimento: n.vencimento,
      pagoEm: n.pagoEm,
      assinado: n.assinadoEm !== null,
      assinadoEm: n.assinadoEm,
      assinaturaPng: n.assinaturaPng,
      nomeAssinante: n.nomeAssinante,
      modo: n.modo,
    };
  }

  /**
   * Guarda a assinatura. Uma vez só: a gravação é condicional — só pega a nota
   * com este token e ainda sem assinatura —, então dois toques no botão, ou o
   * link renovado lá dentro no meio da leitura, não viram duas assinaturas nem
   * uma assinatura num valor que a pessoa não viu.
   */
  async assinar(
    token: string,
    dto: AssinarDto,
    origem: { ip?: string; userAgent?: string },
  ): Promise<NotaPublica> {
    const n = await this.buscarPorToken(token);
    if (n.assinadoEm) throw new BadRequestException('Esta nota já foi assinada.');
    if (n.expiraEm < new Date()) throw new GoneException('Este link venceu. Peça um novo à ILNET.');

    const r = await this.prisma.notaDeRecebimento.updateMany({
      where: { id: n.id, token, assinadoEm: null },
      data: {
        assinaturaPng: dto.assinatura,
        assinadoEm: new Date(),
        modo: dto.modo ?? ModoAssinatura.DESENHADA,
        nomeAssinante: dto.nome?.trim() || n.patrocinado.responsavel?.trim() || n.nomePatrocinado,
        ip: origem.ip?.slice(0, 60) ?? null,
        userAgent: origem.userAgent?.slice(0, 300) ?? null,
      },
    });
    if (r.count === 0) {
      throw new BadRequestException('Este link acabou de ser trocado ou assinado. Abra o link mais recente.');
    }

    this.logger.log(`Nota de recebimento ${n.id} assinada pelo link.`);
    return this.abrirPorToken(token);
  }

  private async buscarPorToken(token: string) {
    const n = await this.prisma.notaDeRecebimento.findUnique({
      where: { token },
      include: { patrocinado: { select: { responsavel: true } } },
    });
    if (!n) {
      throw new NotFoundException(
        'Link de nota não encontrado. Ele pode ter sido substituído por um novo.',
      );
    }
    return n;
  }
}

/** Título sem descrição no IXC: a nota diz de quem e de quando. */
function referentePadrao(nome: string, vencimento: Date | null): string {
  const dia = vencimento
    ? ` com vencimento em ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(vencimento)}`
    : '';
  return `patrocínio de ${nome}${dia}`;
}

/** O segredo da URL: 32 bytes sorteados, como o do contrato. */
function novoToken(): string {
  return randomBytes(32).toString('base64url');
}

function daquiADias(dias: number): Date {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
}
