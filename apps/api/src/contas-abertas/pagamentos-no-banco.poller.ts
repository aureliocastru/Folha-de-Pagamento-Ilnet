import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { PagamentoNoBanco } from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { IxcClient } from '../ixc/ixc.client';
import { lerSituacaoContaPagar } from '../ixc/ixc.financeiro';
import { PrismaService } from '../prisma/prisma.service';
import { HistoricoPagamentosService } from './historico-pagamentos.service';
import { diaEmBrasilia } from './pagamentos-no-banco.regras';
import {
  PagamentosNoBancoService,
  SITUACOES_EM_ANDAMENTO,
} from './pagamentos-no-banco.service';
import { PagamentosService } from './pagamentos.service';

/**
 * De quanto em quanto tempo perguntar ao banco. Curto de propósito: quem aprova
 * no banco e volta para a lista espera ver a conta sair dela.
 */
const INTERVALO_MS = 15_000;

/** De quanto em quanto tempo buscar os comprovantes que faltam. */
const INTERVALO_DOS_COMPROVANTES_MS = 60_000;

/** Depois de uma baixa que falhou, quanto esperar para tentar de novo. */
const ESPERA_DA_BAIXA_MS = 2 * 60_000;

/** Depois de um comprovante que falhou, quanto esperar para pedir de novo. */
const ESPERA_DO_COMPROVANTE_MS = 10 * 60_000;

/** Até quando insistir no comprovante de um pagamento que o banco não entrega. */
const PRAZO_DO_COMPROVANTE_MS = 30 * 24 * 60 * 60_000;

/**
 * O retorno do ModoBank: pergunta ao banco onde está cada pagamento mandado
 * daqui e, quando ele diz que pagou, dá a baixa no IXC.
 *
 * A baixa é a mesma do "já foi paga" da janela de pagar — aprova e baixa na
 * conta do ModoBank, com o dia em que o dinheiro saiu —, e por isso passa pelo
 * `PagamentosService`: um caminho só para escrever pagamento no IXC.
 *
 * Só roda com a credencial do banco no ambiente, e só pergunta pelo que ainda
 * está andando: com tudo resolvido, cada volta é uma consulta ao Postgres.
 */
@Injectable()
export class PagamentosNoBancoPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PagamentosNoBancoPoller.name);
  private timers: NodeJS.Timeout[] = [];
  private perguntando = false;
  private anexando = false;

  constructor(
    private readonly noBanco: PagamentosNoBancoService,
    private readonly pagamentos: PagamentosService,
    private readonly config: ConfigFinanceiraService,
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
    // A baixa torna velha a leitura guardada do "Já pago".
    @Optional() private readonly historico?: HistoricoPagamentosService,
  ) {}

  onModuleInit(): void {
    if (!this.noBanco.ativo) {
      this.logger.log('ModoBank: sem credencial no ambiente — pagamento direto desligado');
      return;
    }
    this.timers = [
      setInterval(() => void this.perguntarAoBanco(), INTERVALO_MS),
      setInterval(() => void this.anexarComprovantes(), INTERVALO_DOS_COMPROVANTES_MS),
    ];
    this.timers.forEach((t) => t.unref?.());
    this.logger.log('ModoBank: acompanhando os pagamentos a cada 15 segundos');
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }

  async acompanhar(): Promise<void> {
    await this.perguntarAoBanco();
    await this.anexarComprovantes();
  }

  /** Onde está o que ainda anda, e a baixa do que o banco já pagou. */
  private async perguntarAoBanco(): Promise<void> {
    if (this.perguntando) return;
    this.perguntando = true;
    try {
      const pendentes = await this.prisma.pagamentoNoBanco.findMany({
        where: {
          OR: [
            { situacao: { in: SITUACOES_EM_ANDAMENTO } },
            { situacao: 'PAGO', baixadoEm: null },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const p of pendentes) {
        try {
          const atual =
            p.situacao === 'PAGO' ? p : await this.noBanco.atualizar(p);
          if (atual.situacao === 'PAGO' && !atual.baixadoEm) {
            await this.baixar(atual);
          }
        } catch (err) {
          this.avisar(p.idFnApagar, err);
        }
      }
    } finally {
      this.perguntando = false;
    }
  }

  /**
   * Os comprovantes, à parte: banco lento para entregar um PDF não pode segurar
   * a baixa de quem está esperando a conta sair da lista.
   */
  private async anexarComprovantes(): Promise<void> {
    if (this.anexando) return;
    this.anexando = true;
    try {
      const faltando = await this.prisma.pagamentoNoBanco.findMany({
        where: {
          situacao: 'PAGO',
          baixadoEm: { not: null },
          comprovanteEm: null,
          createdAt: { gte: new Date(Date.now() - PRAZO_DO_COMPROVANTE_MS) },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const p of faltando) {
        try {
          await this.anexarComprovante(p.id);
        } catch (err) {
          this.avisar(p.idFnApagar, err);
        }
      }
    } finally {
      this.anexando = false;
    }
  }

  private avisar(idFnApagar: number, err: unknown): void {
    this.logger.warn(
      `ModoBank, título ${idFnApagar}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  /**
   * O comprovante, depois da baixa: só do que está pago e baixado, e sem
   * martelar o banco — depois de uma falha, espera antes de pedir de novo.
   */
  private async anexarComprovante(id: string): Promise<void> {
    const p = await this.prisma.pagamentoNoBanco.findUnique({ where: { id } });
    if (!p || p.situacao !== 'PAGO' || !p.baixadoEm || p.comprovanteEm) return;
    if (p.comprovanteErro && Date.now() - p.updatedAt.getTime() < ESPERA_DO_COMPROVANTE_MS) {
      return;
    }
    await this.noBanco.anexarComprovante(p);
  }

  /**
   * A baixa no IXC do que o banco pagou.
   *
   * O valor é o que saiu do banco. No boleto pago com juros ele passa do
   * título, e o título sobe para ele; abaixo, a diferença vai como desconto —
   * as duas coisas que a janela de pagar já faz com o "valor pago".
   */
  private async baixar(p: PagamentoNoBanco): Promise<void> {
    if (p.erro && Date.now() - p.updatedAt.getTime() < ESPERA_DA_BAIXA_MS) {
      return;
    }

    const raw = await this.ixc.getById<Record<string, unknown>>(
      'fn_apagar',
      'fn_apagar.id',
      p.idFnApagar,
    );
    const situacao = raw ? lerSituacaoContaPagar(raw) : null;
    /*
     * Já quitado lá: alguém deu a baixa à mão, ou o título sumiu. Baixar de
     * novo tiraria o dinheiro duas vezes do caixa do IXC — a linha só anota.
     */
    if (!raw || situacao?.pago) {
      await this.prisma.pagamentoNoBanco.update({
        where: { id: p.id },
        data: {
          baixadoEm: new Date(),
          erro: raw ? null : 'O título não existe mais no IXC: a baixa não foi dada.',
        },
      });
      return;
    }

    const cfg = await this.config.obter();
    const saiu = Number(p.valor);
    const aberto = situacao?.valorAberto ?? saiu;
    try {
      const r = await this.pagamentos.pagar(
        p.idFnApagar,
        {
          contaPagamento: cfg.contaPagamentoId,
          jaSaiu: true,
          data: diaEmBrasilia(p.pagoEm ?? new Date()),
          valorPago: saiu > aberto + 0.005 ? saiu : undefined,
          desconto: saiu < aberto - 0.005 ? Math.round((aberto - saiu) * 100) / 100 : undefined,
        },
        'ModoBank',
      );
      await this.prisma.pagamentoNoBanco.update({
        where: { id: p.id },
        data: r.paga
          ? { baixadoEm: new Date(), erro: null }
          : { erro: 'Pago no banco; o IXC aceitou a baixa mas o título continua aberto lá.' },
      });
      if (r.paga) {
        this.historico?.esquecerLeituras();
        this.logger.log(`ModoBank, título ${p.idFnApagar}: pago e baixado no IXC.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.pagamentoNoBanco.update({
        where: { id: p.id },
        data: { erro: `Pago no banco, mas a baixa no IXC falhou: ${msg}` },
      });
    }
  }
}
