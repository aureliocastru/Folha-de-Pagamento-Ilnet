import { OrigemDoContrato } from '@prisma/client';
import {
  mapContaAberta,
  motivoDeNaoEstarAberto,
  primeiroTexto,
} from '../contas-abertas/contas-abertas.mapper';
import { mapPagamento } from '../contas-abertas/historico-pagamentos.mapper';
import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';

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
 * Onde está um pagamento ao patrocinado, lido do título no IXC.
 *
 * - `PAGO`: o título foi baixado — o dinheiro saiu;
 * - `EM_ABERTO`: o título existe e ainda espera ser pago.
 *
 * Título cancelado, ou que nunca foi liberado, não entra: não é dinheiro que
 * saiu nem que vai sair.
 */
export type SituacaoDoPagamento = 'PAGO' | 'EM_ABERTO';

export interface PagamentoAoPatrocinado {
  idFnApagar: number;
  situacao: SituacaoDoPagamento;
  /** Pago: o que saiu do caixa. Em aberto: o que ainda falta pagar. */
  valor: number;
  vencimento: Date | null;
  /** O dia em que o dinheiro saiu. Null no em aberto, ou quando o IXC não diz. */
  pagoEm: Date | null;
  /** A observação do título — "Patrocínio Maria Clara - outubro de 2026". */
  descricao: string | null;
  documento: string | null;
}

/**
 * Um título do `fn_apagar` como pagamento ao patrocinado, ou null quando ele
 * não conta: de outro fornecedor (base que ignora o filtro da consulta),
 * cancelado ou nunca liberado.
 *
 * As réguas são as mesmas das telas do Contas a Pagar — o "Já pago"
 * (`mapPagamento`) e as contas em aberto (`motivoDeNaoEstarAberto`) —, para a
 * ficha do patrocinado nunca dizer que um título está pago quando a lista de
 * contas diz que ele está devendo.
 */
export function pagamentoDoTitulo(
  raw: Record<string, unknown>,
  idFornecedor: number,
): PagamentoAoPatrocinado | null {
  const idFnApagar = parseIxcId(raw.id);
  if (idFnApagar === null) return null;
  if (parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id) !== idFornecedor) return null;

  const descricao = primeiroTexto(raw, ['obs', 'observacao', 'historico']);

  const pago = mapPagamento(raw);
  if (pago) {
    return {
      idFnApagar,
      situacao: 'PAGO',
      valor: pago.valorPago,
      vencimento: pago.vencimento,
      pagoEm: pago.pagoEm,
      descricao,
      documento: pago.documento,
    };
  }

  const fora = motivoDeNaoEstarAberto(raw);
  const titulo = mapContaAberta(raw);
  if (!titulo) return null;

  if (!fora) {
    return {
      idFnApagar,
      situacao: 'EM_ABERTO',
      valor: titulo.valorAberto > 0 ? titulo.valorAberto : titulo.valor,
      vencimento: titulo.vencimento,
      pagoEm: null,
      descricao,
      documento: titulo.documento,
    };
  }

  // Quitado sem o dia da baixa: saiu, só não se sabe quando.
  if (fora.motivo === 'pago' || fora.motivo === 'quitado') {
    return {
      idFnApagar,
      situacao: 'PAGO',
      valor: parseIxcDecimal(raw.valor ?? raw.valor_documento),
      vencimento: titulo.vencimento,
      pagoEm: null,
      descricao,
      documento: titulo.documento,
    };
  }
  return null;
}

/** O dia que a linha do tempo usa: o do pagamento, e na falta dele o vencimento. */
export function diaDoPagamento(p: PagamentoAoPatrocinado): Date | null {
  return p.pagoEm ?? p.vencimento;
}

/** Do mais recente para o mais antigo; sem data nenhuma vai para o fim. */
export function ordenarPagamentos(pagamentos: PagamentoAoPatrocinado[]): PagamentoAoPatrocinado[] {
  return [...pagamentos].sort((a, b) => {
    const da = diaDoPagamento(a)?.getTime() ?? -Infinity;
    const db = diaDoPagamento(b)?.getTime() ?? -Infinity;
    return db - da;
  });
}

export interface ResumoDosPagamentos {
  /** Só o que saiu de verdade. */
  totalPago: number;
  quantidadePagos: number;
  /** Lançado no IXC e ainda não pago. */
  totalEmAberto: number;
  /** O dia do último pagamento que saiu. */
  ultimoPagamento: Date | null;
}

export function resumirPagamentos(pagamentos: PagamentoAoPatrocinado[]): ResumoDosPagamentos {
  let totalPago = 0;
  let quantidadePagos = 0;
  let totalEmAberto = 0;
  let ultimoPagamento: Date | null = null;

  for (const p of pagamentos) {
    if (p.situacao === 'PAGO') {
      totalPago += p.valor;
      quantidadePagos += 1;
      const dia = diaDoPagamento(p);
      if (dia && (!ultimoPagamento || dia > ultimoPagamento)) ultimoPagamento = dia;
    } else {
      totalEmAberto += p.valor;
    }
  }

  return {
    // Soma de dinheiro em ponto flutuante: arredonda no centavo, ou R$ 0,1 +
    // R$ 0,2 aparece como 0,30000000000000004 na tela.
    totalPago: centavos(totalPago),
    quantidadePagos,
    totalEmAberto: centavos(totalEmAberto),
    ultimoPagamento,
  };
}

/**
 * De que mês ("AAAA-MM") é um pagamento: o do vencimento do título.
 *
 * O vencimento, e não o dia em que saiu, porque a pergunta é "o patrocínio de
 * outubro já foi?" — e o de outubro pago no dia 2 de novembro continua sendo o
 * de outubro. Sem vencimento, vale o dia do pagamento.
 */
export function mesDoPagamento(p: PagamentoAoPatrocinado): string | null {
  const dia = p.vencimento ?? p.pagoEm;
  return dia ? dia.toISOString().slice(0, 7) : null;
}

export interface PagamentosDoMes {
  pago: number;
  emAberto: number;
  pagamentos: PagamentoAoPatrocinado[];
}

export function pagamentosDoMes(
  pagamentos: PagamentoAoPatrocinado[],
  mes: string,
): PagamentosDoMes {
  const doMes = pagamentos.filter((p) => mesDoPagamento(p) === mes);
  const soma = (s: SituacaoDoPagamento) =>
    centavos(doMes.filter((p) => p.situacao === s).reduce((t, p) => t + p.valor, 0));
  return { pago: soma('PAGO'), emAberto: soma('EM_ABERTO'), pagamentos: doMes };
}

/**
 * Como está o mês de um patrocinado, numa palavra:
 *
 * - `PAGO`: saiu o combinado (ou, sem valor combinado, saiu alguma coisa);
 * - `EM_ABERTO`: o combinado está lançado no IXC, esperando ser pago;
 * - `PARCIAL`: saiu ou foi lançada uma parte, e falta o resto;
 * - `FALTA`: nada lançado no mês, e há valor combinado;
 * - `SEM_PAGAMENTO`: nada no mês, e também não há valor combinado para cobrar.
 */
export type SituacaoDoMes = 'PAGO' | 'EM_ABERTO' | 'PARCIAL' | 'FALTA' | 'SEM_PAGAMENTO';

export function situacaoDoMes(
  valorMensal: number | null,
  mes: Pick<PagamentosDoMes, 'pago' | 'emAberto'>,
): SituacaoDoMes {
  // Meio centavo de folga: a soma de várias parcelas não precisa errar por um fio.
  const folga = 0.005;
  if (!valorMensal || valorMensal <= 0) {
    if (mes.pago > 0) return 'PAGO';
    if (mes.emAberto > 0) return 'EM_ABERTO';
    return 'SEM_PAGAMENTO';
  }
  if (mes.pago >= valorMensal - folga) return 'PAGO';
  if (mes.pago + mes.emAberto >= valorMensal - folga) return 'EM_ABERTO';
  if (mes.pago > 0 || mes.emAberto > 0) return 'PARCIAL';
  return 'FALTA';
}

function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}
