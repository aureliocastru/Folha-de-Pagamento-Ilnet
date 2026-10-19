import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { PagamentoNoBanco } from '@prisma/client';
import { ConfigFinanceiraService } from '../financeiro/config-financeira.service';
import { IxcClient } from '../ixc/ixc.client';
import { lerSituacaoContaPagar } from '../ixc/ixc.financeiro';
import { PrismaService } from '../prisma/prisma.service';
import { diaEmBrasilia } from './pagamentos-no-banco.regras';
import {
  PagamentosNoBancoService,
  SITUACOES_EM_ANDAMENTO,
} from './pagamentos-no-banco.service';
import { PagamentosService } from './pagamentos.service';

/** De quanto em quanto tempo perguntar ao banco. */
const INTERVALO_MS = 60_000;

/** Depois de uma baixa que falhou, quanto esperar para tentar de novo. */
const ESPERA_DEPOIS_DE_FALHA_MS = 10 * 60_000;

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
  private timer: NodeJS.Timeout | null = null;
  private executando = false;

  constructor(
    private readonly noBanco: PagamentosNoBancoService,
    private readonly pagamentos: PagamentosService,
    private readonly config: ConfigFinanceiraService,
    private readonly prisma: PrismaService,
    private readonly ixc: IxcClient,
  ) {}

  onModuleInit(): void {
    if (!this.noBanco.ativo) {
      this.logger.log('ModoBank: sem credencial no ambiente — pagamento direto desligado');
      return;
    }
    this.timer = setInterval(() => void this.acompanhar(), INTERVALO_MS);
    this.timer.unref?.();
    this.logger.log('ModoBank: acompanhando os pagamentos a cada minuto');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async acompanhar(): Promise<void> {
    if (this.executando) return;
    this.executando = true;
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
          this.logger.warn(
            `ModoBank, título ${p.idFnApagar}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.executando = false;
    }
  }

  /**
   * A baixa no IXC do que o banco pagou.
   *
   * O valor é o que saiu do banco. No boleto pago com juros ele passa do
   * título, e o título sobe para ele; abaixo, a diferença vai como desconto —
   * as duas coisas que a janela de pagar já faz com o "valor pago".
   */
  private async baixar(p: PagamentoNoBanco): Promise<void> {
    if (p.erro && Date.now() - p.updatedAt.getTime() < ESPERA_DEPOIS_DE_FALHA_MS) {
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
