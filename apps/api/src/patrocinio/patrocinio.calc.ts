import {
  FormaPagamento,
  OrigemDoContrato,
  Prisma,
  StatusContaPagar,
} from '@prisma/client';

/**
 * Onde está o contrato deste patrocinado, numa palavra.
 *
 * - `ASSINADO`: há papel valendo — assinado pelo link ou escaneado;
 * - `AGUARDANDO`: o link saiu e ninguém assinou ainda;
 * - `VENCIDO`: o link saiu, venceu, e não há outro papel;
 * - `SEM_CONTRATO`: nada foi feito.
 */
export type SituacaoDoContrato = 'ASSINADO' | 'AGUARDANDO' | 'VENCIDO' | 'SEM_CONTRATO';

export interface ContratoResumido {
  origem: OrigemDoContrato;
  assinadoEm: Date | null;
  expiraEm: Date | null;
}

/**
 * O escaneado conta como assinado mesmo sem data: o papel existe, só não se
 * sabe o dia escrito nele. É o caso de quase todo patrocínio antigo.
 */
export function contratoValendo(c: ContratoResumido): boolean {
  return c.origem === OrigemDoContrato.ESCANEADO || c.assinadoEm !== null;
}

export function situacaoDoContrato(
  contratos: ContratoResumido[],
  agora = new Date(),
): SituacaoDoContrato {
  if (contratos.some(contratoValendo)) return 'ASSINADO';
  const links = contratos.filter((c) => c.origem === OrigemDoContrato.LINK);
  if (links.some((c) => c.expiraEm && c.expiraEm >= agora)) return 'AGUARDANDO';
  if (links.length > 0) return 'VENCIDO';
  return 'SEM_CONTRATO';
}

/**
 * Onde está um pagamento ao patrocinado, lido da diária.
 *
 * A mesma régua da aba Diaristas (`diariaPaga`): pago é o que o IXC deu por
 * pago, ou a diária em mãos antiga que nunca teve conta a pagar. Contar como
 * mandado o que ainda espera aprovação faria a ficha dizer que o patrocinado
 * recebeu um dinheiro que não chegou.
 */
export type SituacaoDoPagamento = 'PAGO' | 'AGUARDANDO' | 'NAO_SAIU';

export interface PagamentoResumido {
  valor: Prisma.Decimal | number;
  data: Date;
  forma: FormaPagamento;
  contaPagar: { status: StatusContaPagar } | null;
}

const NAO_SAIU: ReadonlySet<StatusContaPagar> = new Set([
  StatusContaPagar.ERRO,
  StatusContaPagar.REPROVADO,
  StatusContaPagar.CANCELADO,
]);

export function situacaoDoPagamento(d: PagamentoResumido): SituacaoDoPagamento {
  if (!d.contaPagar) {
    // Pelo IXC e sem conta a pagar é a diária que travou no meio do caminho —
    // a conta não chegou a nascer, e o dinheiro não saiu.
    return d.forma === FormaPagamento.EM_MAOS ? 'PAGO' : 'NAO_SAIU';
  }
  if (d.contaPagar.status === StatusContaPagar.PAGO) return 'PAGO';
  if (NAO_SAIU.has(d.contaPagar.status)) return 'NAO_SAIU';
  return 'AGUARDANDO';
}

export interface ResumoDosPagamentos {
  /** Só o que saiu de verdade. */
  totalPago: number;
  quantidadePagos: number;
  /** Lançado e ainda a caminho do banco. */
  totalAguardando: number;
  /** O dia do último pagamento que saiu. */
  ultimoPagamento: Date | null;
}

export function resumirPagamentos(pagamentos: PagamentoResumido[]): ResumoDosPagamentos {
  let totalPago = 0;
  let quantidadePagos = 0;
  let totalAguardando = 0;
  let ultimoPagamento: Date | null = null;

  for (const p of pagamentos) {
    const situacao = situacaoDoPagamento(p);
    if (situacao === 'PAGO') {
      totalPago += Number(p.valor);
      quantidadePagos += 1;
      if (!ultimoPagamento || p.data > ultimoPagamento) ultimoPagamento = p.data;
    } else if (situacao === 'AGUARDANDO') {
      totalAguardando += Number(p.valor);
    }
  }

  return {
    // Soma de dinheiro em ponto flutuante: arredonda no centavo, ou R$ 0,1 +
    // R$ 0,2 aparece como 0,30000000000000004 na tela.
    totalPago: Math.round(totalPago * 100) / 100,
    quantidadePagos,
    totalAguardando: Math.round(totalAguardando * 100) / 100,
    ultimoPagamento,
  };
}
