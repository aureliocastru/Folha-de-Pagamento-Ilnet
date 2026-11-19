import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import { primeiraData } from './contas-abertas.mapper';
import { ehFeriado, ehFimDeSemana, proximoDiaUtil } from './dias-uteis';

/**
 * O vencimento de uma conta em aberto, relido do código de barras dela.
 *
 * O boleto traz o dia escrito nos números (o fator), e é ele que vale — não o
 * que alguém digitou ao lançar. E o dia do boleto que cai em sábado, domingo
 * ou feriado paga-se sem juros no próximo dia útil: é esse que vai para o IXC,
 * para a lista dizer o dia em que dá para pagar de verdade.
 *
 * Mexe só onde o código é, sem dúvida, o desta conta:
 *  - boleto bancário (44 ou 47 dígitos); conta de consumo (48, começa em 8)
 *    não tem o dia escrito;
 *  - o valor do código é o valor da conta — código de outra conta, copiado
 *    junto ao duplicar, não passa;
 *  - o código aparece numa conta só — nas parcelas que herdaram o código da
 *    primeira, ele não diz de qual delas é.
 */

const UM_DIA = 24 * 60 * 60 * 1000;

/**
 * O dia pelo fator do boleto. O fator conta dias desde 07/10/1997, chegou a
 * 9999 em 21/02/2025 e recomeçou em 1000 em 22/02/2025 (Febraban): vale o
 * ciclo mais perto de hoje. É a mesma conta de `apps/web/src/lib/codigo-de-pagamento.ts`.
 */
function diaDoFator(fator: number, hoje: Date): Date | null {
  if (!Number.isInteger(fator) || fator < 1000) return null;
  const antigo = new Date(Date.UTC(1997, 9, 7) + fator * UM_DIA);
  const novo = new Date(Date.UTC(2025, 1, 22) + (fator - 1000) * UM_DIA);
  const longe = (d: Date) => Math.abs(d.getTime() - hoje.getTime());
  return longe(novo) <= longe(antigo) ? novo : antigo;
}

/** Vencimento e valor de um boleto bancário: código de barras (44) ou linha digitável (47). */
export function lerBoletoBancario(
  codigo: string,
  hoje = new Date(),
): { vencimento: Date | null; valor: number | null } | null {
  const d = codigo.replace(/\D/g, '');
  let barras: string;
  if (d.length === 44) barras = d;
  else if (d.length === 47) {
    barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  } else return null;
  // Começar em 8 é arrecadação (conta de consumo, guia): outro desenho, sem fator.
  if (barras[0] === '8') return null;
  const valor = Number(barras.slice(9, 19)) / 100;
  return {
    vencimento: diaDoFator(Number(barras.slice(5, 9)), hoje),
    valor: valor > 0 ? valor : null,
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Uma conta cujo vencimento não é o que o código dela diz. */
export interface AcertoDeVencimento {
  idFnApagar: number;
  idFornecedor: number | null;
  /** O vencimento que está no IXC, "AAAA-MM-DD". */
  de: string;
  /** O dia certo: o do código, levado ao dia útil. */
  para: string;
  /** O dia escrito no código. */
  doCodigo: string;
  /** Por que `para` não é `doCodigo`: o dia do código cai em... */
  porque: 'sábado' | 'domingo' | 'feriado' | null;
}

/**
 * As contas, entre os títulos em aberto (já filtrados), cujo vencimento não é
 * o do código de barras — com o dia certo de cada uma.
 */
export function acertosDeVencimento(
  abertos: Array<Record<string, unknown>>,
  hoje = new Date(),
): AcertoDeVencimento[] {
  // Quantas contas carregam cada código: repetido, não se sabe de qual é.
  const vezes = new Map<string, number>();
  for (const raw of abertos) {
    const codigo = String(raw.codigo_barras ?? '').replace(/\D/g, '');
    if (codigo) vezes.set(codigo, (vezes.get(codigo) ?? 0) + 1);
  }

  const acertos: AcertoDeVencimento[] = [];
  for (const raw of abertos) {
    const idFnApagar = parseIxcId(raw.id);
    const codigo = String(raw.codigo_barras ?? '').replace(/\D/g, '');
    if (idFnApagar === null || !codigo || (vezes.get(codigo) ?? 0) > 1) continue;

    const boleto = lerBoletoBancario(codigo, hoje);
    if (!boleto?.vencimento || !boleto.valor) continue;
    const valorDaConta = parseIxcDecimal(raw.valor ?? raw.valor_documento);
    if (Math.abs(valorDaConta - boleto.valor) >= 0.01) continue;

    const venceNoIxc = primeiraData(raw, ['data_vencimento']);
    const certo = proximoDiaUtil(boleto.vencimento);
    if (venceNoIxc && iso(venceNoIxc) === iso(certo)) continue;

    const dia = boleto.vencimento.getUTCDay();
    acertos.push({
      idFnApagar,
      idFornecedor: parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id),
      de: venceNoIxc ? iso(venceNoIxc) : '',
      para: iso(certo),
      doCodigo: iso(boleto.vencimento),
      porque: ehFimDeSemana(boleto.vencimento)
        ? dia === 6
          ? 'sábado'
          : 'domingo'
        : ehFeriado(boleto.vencimento)
          ? 'feriado'
          : null,
    });
  }
  return acertos;
}
