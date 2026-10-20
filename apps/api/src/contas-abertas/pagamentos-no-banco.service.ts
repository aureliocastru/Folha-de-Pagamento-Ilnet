import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PagamentoNoBanco, SituacaoNoBanco } from '@prisma/client';
import { IxcClient } from '../ixc/ixc.client';
import { lerSituacaoContaPagar } from '../ixc/ixc.financeiro';
import {
  ModobankClient,
  RecusaDoBanco,
  type PagamentoAceito,
  type SituacaoDoPagamento,
} from '../modobank/modobank.client';
import { MODOBANK_RECEBER } from '../modobank/modobank.module';
import { lerPixDaGuia } from '../impostos/guias.parse';
import { PrismaService } from '../prisma/prisma.service';
import {
  comoPagar,
  motivoDoPix,
  novaChave,
  situacaoDoStatus,
  type ComoPagar,
} from './pagamentos-no-banco.regras';

/** As situações em que o pagamento ainda pode virar dinheiro saindo. */
export const SITUACOES_EM_ANDAMENTO: SituacaoNoBanco[] = [
  'ENVIANDO',
  'NO_BANCO',
  'AGUARDANDO_APROVACAO',
];

/** O que a janela de pagar mostra antes de confirmar. */
export interface PreviaNoBanco {
  forma: 'BOLETO' | 'PIX';
  /** Quem recebe, segundo o banco. */
  favorecido: string | null;
  /** O que vai sair. No boleto, o que o banco cobra hoje. */
  valor: number;
  /** O que o título pede no IXC — difere do valor no boleto com juros. */
  valorDoTitulo: number;
}

/** Um pagamento no banco, como a lista de contas o mostra. */
export interface NoBancoNaLista {
  situacao: SituacaoNoBanco;
  forma: 'BOLETO' | 'PIX';
  valor: number;
  favorecido: string | null;
  erro: string | null;
  /** O banco pagou e o IXC ainda não recebeu a baixa. */
  faltaBaixa: boolean;
  comComprovante: boolean;
  enviadoEm: Date;
}

/**
 * Pagar pelo ModoBank direto daqui: o boleto ou o Pix do título vai para a API
 * do banco, e esta tabela guarda o que foi mandado e o que ele respondeu.
 *
 * A baixa no IXC **não** é feita aqui: ela só sai quando o banco diz que o
 * dinheiro saiu, e quem pergunta isso a ele é o `PagamentosNoBancoPoller`.
 */
@Injectable()
export class PagamentosNoBancoService {
  private readonly logger = new Logger(PagamentosNoBancoService.name);

  constructor(
    private readonly banco: ModobankClient,
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    /** O recebimento (cash in): por ora só se confere que a credencial abre. */
    @Optional() @Inject(MODOBANK_RECEBER) private readonly receber?: ModobankClient,
  ) {}

  get ativo(): boolean {
    return this.banco.configurado;
  }

  /**
   * Se a credencial do recebimento está no ambiente e o banco a aceita.
   * Ainda não há tela que receba: é o "já está no jeito" para quando houver.
   */
  async situacaoDoRecebimento(): Promise<{
    configurado: boolean;
    conectado: boolean;
    erro: string | null;
    /** Só quando o token não sai: o que cada caminho comum de token respondeu. */
    caminhos?: Array<{ caminho: string; status: number | string }>;
  }> {
    if (!this.receber?.configurado) return { configurado: false, conectado: false, erro: null };
    try {
      await this.receber.conectar();
      return { configurado: true, conectado: true, erro: null };
    } catch (err) {
      const erro = mensagem(err);
      // Caminho errado: procura o certo, para não adivinhar de deploy em deploy.
      const caminhos = /404/.test(erro) ? await this.receber.sondarToken() : undefined;
      return { configurado: true, conectado: false, erro, caminhos };
    }
  }

  /** Para a tela: se dá para pagar pelo banco, e o saldo de agora. */
  async situacao(): Promise<{
    ativo: boolean;
    pedeAprovacao: boolean;
    saldo: number | null;
    erro: string | null;
  }> {
    if (!this.banco.configurado) {
      return { ativo: false, pedeAprovacao: false, saldo: null, erro: null };
    }
    const pedeAprovacao = this.banco.fluxo === 'APPROVAL_REQUIRED';
    try {
      return { ativo: true, pedeAprovacao, saldo: await this.banco.saldo(), erro: null };
    } catch (err) {
      // O saldo é enfeite: sem ele a tela ainda paga, mas diz por que não leu.
      return { ativo: true, pedeAprovacao, saldo: null, erro: mensagem(err) };
    }
  }

  /** Quem recebe e quanto sai — lido no banco, antes de confirmar. */
  async previa(idFnApagar: number): Promise<PreviaNoBanco> {
    this.exigirAtivo();
    const raw = await this.titulo(idFnApagar);
    const valorDoTitulo = lerSituacaoContaPagar(raw).valorAberto;
    const como = await this.exigirComo(idFnApagar, raw);
    const destino = await this.resolver(como, valorDoTitulo, novaChave(idFnApagar));
    return {
      forma: como.forma,
      favorecido: destino.favorecido,
      valor: destino.valor,
      valorDoTitulo,
    };
  }

  /**
   * Manda o título ao banco. Chamado pelo `PagamentosService.pagar`, que já
   * conferiu que o título existe, está em aberto e não foi reprovado.
   *
   * Grava antes de chamar: se a resposta se perder no caminho, a linha fica
   * ENVIANDO com a chave, e o acompanhamento pergunta ao banco por ela — sem
   * a linha, um pagamento que chegou lá ficaria sem ninguém para dar a baixa.
   */
  async enviar(
    idFnApagar: number,
    raw: Record<string, unknown>,
    opcoes: { valorDoTitulo: number; desconto: number; usuario?: string },
  ): Promise<{ pagamento: PagamentoNoBanco; avisos: string[] }> {
    this.exigirAtivo();
    const avisos: string[] = [];

    /*
     * "Comunicado com a Modobank" = a tela do IXC já passou este título ao
     * banco. Mandar de novo daqui é o mesmo boleto pago duas vezes.
     */
    if (String(raw.comunicado ?? '').trim().toUpperCase() === 'S') {
      throw new BadRequestException(
        `O título ${idFnApagar} já foi mandado ao ModoBank pela tela do IXC. ` +
          'Nada foi enviado de novo.',
      );
    }

    const anterior = await this.prisma.pagamentoNoBanco.findFirst({
      where: { idFnApagar, situacao: { not: 'RECUSADO' } },
      orderBy: { createdAt: 'desc' },
    });
    if (anterior) {
      throw new BadRequestException(
        `O título ${idFnApagar} já foi mandado ao banco em ` +
          `${anterior.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ` +
          `(${rotulo(anterior.situacao)}). Nada foi enviado de novo.`,
      );
    }

    const como = await this.exigirComo(idFnApagar, raw);
    const chave = novaChave(idFnApagar);
    const valorPix = Math.round((opcoes.valorDoTitulo - opcoes.desconto) * 100) / 100;
    const destino = await this.resolver(como, valorPix, chave);

    if (como.forma === 'BOLETO' && opcoes.desconto > 0) {
      avisos.push(
        'O desconto não foi aplicado: no boleto quem decide o valor é o banco, ' +
          `e ele cobra ${moeda(destino.valor)} hoje.`,
      );
    }

    const pagamento = await this.prisma.pagamentoNoBanco.create({
      data: {
        idFnApagar,
        forma: como.forma,
        destino: destino.destino,
        favorecido: destino.favorecido,
        valor: destino.valor,
        chave,
        criadoPor: opcoes.usuario ?? null,
      },
    });

    let aceito: PagamentoAceito;
    try {
      aceito =
        como.forma === 'BOLETO'
          ? await this.banco.pagarBoleto({
              linhaDigitavel: destino.destino,
              valor: destino.valor,
              descricao: descricao(idFnApagar, raw),
              chave,
            })
          : await this.banco.pagarPix({
              destino: destino.destino,
              copiaECola: como.copiaECola,
              valor: destino.valor,
              descricao: descricao(idFnApagar, raw),
              chave,
              endToEndIdDaConsulta: destino.endToEndIdDaConsulta,
            });
    } catch (err) {
      /*
       * 4xx é o banco dizendo não, com certeza: nada saiu. O resto (rede,
       * 5xx, tempo esgotado) não diz se chegou — a linha fica ENVIANDO e o
       * acompanhamento pergunta ao banco pela chave.
       */
      if (err instanceof RecusaDoBanco && err.statusDoBanco < 500) {
        await this.prisma.pagamentoNoBanco.update({
          where: { id: pagamento.id },
          data: { situacao: 'RECUSADO', erro: err.message },
        });
        throw new BadRequestException(`${err.message}. Nenhum dinheiro saiu.`);
      }
      this.logger.warn(
        `Título ${idFnApagar}: resposta do banco não chegou (${mensagem(err)}); ` +
          `fica ENVIANDO com a chave ${chave}.`,
      );
      avisos.push(
        'O banco não confirmou o recebimento. O sistema confere sozinho em ' +
          'instantes — não mande de novo.',
      );
      return { pagamento, avisos };
    }

    const atualizado = await this.prisma.pagamentoNoBanco.update({
      where: { id: pagamento.id },
      data: {
        idNoBanco: aceito.idNoBanco,
        statusDoBanco: aceito.status,
        situacao: situacaoDoStatus(aceito.status, 'ENVIANDO'),
        pagoEm: aceito.status === 'LIQUIDATED' ? new Date() : null,
      },
    });
    this.logger.log(
      `Título ${idFnApagar}: ${como.forma} de ${moeda(destino.valor)} mandado ao ` +
        `ModoBank (${aceito.status ?? 'sem status'}, ${aceito.idNoBanco ?? 'sem id'}).`,
    );
    return { pagamento: atualizado, avisos };
  }

  /**
   * Pergunta ao banco onde está um pagamento e guarda a resposta. Devolve a
   * linha como ficou. Não dá baixa: isso é do poller.
   */
  async atualizar(p: PagamentoNoBanco): Promise<PagamentoNoBanco> {
    let lido: SituacaoDoPagamento | null;
    if (p.idNoBanco) {
      lido =
        p.forma === 'BOLETO'
          ? await this.banco.situacaoDoBoleto(p.idNoBanco)
          : await this.banco.situacaoDoPix(p.idNoBanco);
    } else {
      lido =
        p.forma === 'BOLETO'
          ? await this.banco.boletoPelaChave(p.chave)
          : await this.banco.pixPelaChave(p.chave);
      /*
       * O banco não conhece a chave. Logo depois do envio pode ser atraso
       * dele; passados dez minutos, o pedido não chegou — e aí o título pode
       * ser mandado de novo.
       */
      if (!lido) {
        if (Date.now() - p.createdAt.getTime() < 10 * 60_000) return p;
        return this.prisma.pagamentoNoBanco.update({
          where: { id: p.id },
          data: {
            situacao: 'RECUSADO',
            erro: 'O pedido não chegou ao banco. Nenhum dinheiro saiu — dá para mandar de novo.',
          },
        });
      }
    }

    const situacao = situacaoDoStatus(lido.status, p.situacao);
    const motivo = situacao === 'RECUSADO' ? motivoDoPix(lido.codigoDoErro) : null;
    if (
      situacao === p.situacao &&
      lido.status === p.statusDoBanco &&
      (lido.idNoBanco ?? p.idNoBanco) === p.idNoBanco
    ) {
      return p;
    }
    return this.prisma.pagamentoNoBanco.update({
      where: { id: p.id },
      data: {
        situacao,
        statusDoBanco: lido.status,
        idNoBanco: p.idNoBanco ?? lido.idNoBanco,
        pagoEm: situacao === 'PAGO' ? (p.pagoEm ?? lido.liquidadoEm ?? new Date()) : p.pagoEm,
        erro:
          situacao === 'RECUSADO'
            ? `O banco não pagou${motivo ? `: ${motivo}` : ` (${lido.status ?? 'sem status'})`}.`
            : p.erro,
      },
    });
  }

  /** O comprovante em PDF do pagamento que saiu por este título. */
  async comprovante(idFnApagar: number): Promise<{ pdf: Buffer; nome: string }> {
    this.exigirAtivo();
    const p = await this.prisma.pagamentoNoBanco.findFirst({
      where: { idFnApagar, situacao: 'PAGO', idNoBanco: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!p?.idNoBanco) {
      throw new NotFoundException(
        `O título ${idFnApagar} não tem pagamento feito pelo banco por aqui.`,
      );
    }
    return {
      pdf: await this.banco.comprovante(p.forma, p.idNoBanco),
      nome: `comprovante-titulo-${idFnApagar}.pdf`,
    };
  }

  /**
   * Anexa o comprovante do banco ao título, no IXC.
   *
   * É de lá que o Já pagos mostra os arquivos do pagamento e que a
   * Contabilidade tira o comprovante de cada saída — anexado no título, ele
   * aparece nos dois sem caminho novo. Falhou, fica anotado, e o
   * acompanhamento tenta de novo depois.
   */
  async anexarComprovante(p: PagamentoNoBanco): Promise<boolean> {
    if (!p.idNoBanco) return false;
    try {
      const pdf = await this.banco.comprovante(p.forma, p.idNoBanco);
      await this.ixc.upload(
        'fn_apagar_arquivos',
        'arquivo',
        { nome: `comprovante-modobank-${p.idFnApagar}.pdf`, tipo: 'application/pdf', conteudo: pdf },
        { id_apagar: String(p.idFnApagar), descricao: 'Comprovante ModoBank' },
      );
      await this.prisma.pagamentoNoBanco.update({
        where: { id: p.id },
        data: { comprovanteEm: new Date(), comprovanteErro: null },
      });
      this.logger.log(`ModoBank, título ${p.idFnApagar}: comprovante anexado no IXC.`);
      return true;
    } catch (err) {
      await this.prisma.pagamentoNoBanco.update({
        where: { id: p.id },
        data: { comprovanteErro: err instanceof Error ? err.message : String(err) },
      });
      return false;
    }
  }

  /** O último pagamento no banco de cada título, para a lista de contas. */
  async naLista(ids: number[]): Promise<Map<number, NoBancoNaLista>> {
    const mapa = new Map<number, NoBancoNaLista>();
    if (ids.length === 0) return mapa;
    const linhas = await this.prisma.pagamentoNoBanco.findMany({
      where: { idFnApagar: { in: ids } },
      orderBy: { createdAt: 'asc' },
    });
    // Do mais velho para o mais novo: o que sobra no mapa é o último.
    for (const p of linhas) {
      mapa.set(p.idFnApagar, {
        situacao: p.situacao,
        forma: p.forma,
        valor: Number(p.valor),
        favorecido: p.favorecido,
        erro: p.erro,
        faltaBaixa: p.situacao === 'PAGO' && !p.baixadoEm,
        comComprovante: p.situacao === 'PAGO' && !!p.idNoBanco,
        enviadoEm: p.createdAt,
      });
    }
    return mapa;
  }

  /**
   * Quem recebe, quanto, e o destino do jeito que o banco aceita.
   *
   * No boleto o valor é o que o banco calcula hoje, e não o do título: ele
   * paga o valor atualizado do boleto de qualquer forma, e mandar outro número
   * é ser recusado. No Pix é o do título.
   */
  private async resolver(
    como: ComoPagar,
    valorDoPix: number,
    chave: string,
  ): Promise<{
    destino: string;
    favorecido: string | null;
    valor: number;
    endToEndIdDaConsulta: string | null;
  }> {
    if (como.forma === 'BOLETO') {
      const boleto = await this.banco.consultarBoleto(como.codigo);
      if (boleto.valorLivre) {
        throw new BadRequestException(
          'Este boleto deixa quem paga escolher o valor (como fatura de cartão), ' +
            'e o banco não paga esse tipo pela API. Pague pelo aplicativo do banco.',
        );
      }
      if (!(boleto.valor > 0)) {
        throw new BadRequestException('O banco não achou valor a pagar neste boleto.');
      }
      return {
        destino: boleto.linhaDigitavel,
        favorecido: boleto.favorecido,
        valor: boleto.valor,
        endToEndIdDaConsulta: null,
      };
    }

    if (como.copiaECola) {
      const qr = await this.banco.lerCopiaECola(como.codigo, chave);
      return {
        destino: como.codigo,
        favorecido: qr.favorecido,
        valor: qr.valor ?? valorDoPix,
        endToEndIdDaConsulta: null,
      };
    }

    let usada = como.chave;
    let dono = await this.banco.donoDaChave(como.chave);
    if (!dono && como.alternativa) {
      usada = como.alternativa;
      dono = await this.banco.donoDaChave(como.alternativa);
    }
    if (!dono) {
      throw new BadRequestException(
        `A chave Pix "${como.chave}" não existe no Pix. Corrija a chave na conta.`,
      );
    }
    return {
      destino: usada,
      favorecido: dono.nome,
      valor: valorDoPix,
      endToEndIdDaConsulta: dono.endToEndId,
    };
  }

  private exigirAtivo(): void {
    if (!this.banco.configurado) {
      throw new ServiceUnavailableException(
        'O pagamento direto pelo ModoBank ainda não está ligado no servidor.',
      );
    }
  }

  private async exigirComo(idFnApagar: number, raw: Record<string, unknown>): Promise<ComoPagar> {
    const como = comoPagar(raw);
    if (!como) {
      throw new BadRequestException(
        `O título ${idFnApagar} não tem código de barras nem chave Pix: o banco ` +
          'não tem para onde mandar. Edite a conta e preencha um dos dois.',
      );
    }
    if (como.forma !== 'BOLETO' || !como.codigo.startsWith('8')) return como;

    /*
     * Guia de arrecadação sem Pix no título: o banco recusaria o código de
     * barras. Se a guia entrou pelos Impostos, o QR Pix dela está no texto
     * guardado do PDF — e é por ele que ela se paga.
     */
    const guia = await this.prisma.guia.findFirst({
      where: { contaPagar: { idFnApagarIxc: idFnApagar } },
      select: { textoOriginal: true },
    });
    const pix = guia?.textoOriginal ? lerPixDaGuia(guia.textoOriginal) : null;
    if (pix) return { forma: 'PIX', copiaECola: true, codigo: pix };
    // O `codigo` é o que faz a janela de pagar oferecer o PDF e a câmera.
    throw new BadRequestException({
      codigo: 'GUIA_SEM_PIX',
      message:
        'Guia paga pelo Pix dela: o ModoBank não paga DARF, DAS, DARE ou conta de consumo ' +
        'pelo código de barras. Mande o PDF da guia ou leia o QR Code Pix dela.',
    });
  }

  private async titulo(idFnApagar: number): Promise<Record<string, unknown>> {
    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      idFnApagar,
    );
    if (!raw) {
      throw new BadRequestException(`O título ${idFnApagar} não existe mais no IXC.`);
    }
    return raw;
  }
}

/** O que vai no extrato do banco: o título, e o documento quando há. */
function descricao(idFnApagar: number, raw: Record<string, unknown>): string {
  const doc = String(raw.documento ?? '').trim();
  return `Titulo ${idFnApagar}${doc ? ` doc ${doc}` : ''}`.slice(0, 140);
}

export function rotulo(s: SituacaoNoBanco): string {
  switch (s) {
    case 'ENVIANDO':
      return 'enviando';
    case 'NO_BANCO':
      return 'no banco';
    case 'AGUARDANDO_APROVACAO':
      return 'esperando aprovação no banco';
    case 'PAGO':
      return 'pago';
    case 'RECUSADO':
      return 'recusado';
  }
}

function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
