/**
 * A linha de baixa do IXC — o que a aba "Pagamentos" do título mostra.
 *
 * Ela entra nesta casa por um motivo só, e é uma data. Nesta base
 * `fn_apagar.data_pagamento` guarda o dia em que a baixa foi **registrada**, não
 * o dia em que o dinheiro saiu: uma conta paga no dia 15 e lançada no dia 16
 * fica lá com 16, e o histórico dizia "pago 1 dia depois" de um pagamento feito
 * no vencimento. Quem paga o boleto pelo banco e só depois vem lançar tem todas
 * as contas assim — o atraso que a tela mostrava era o do lançamento, não o do
 * pagamento.
 *
 * O dia informado por quem deu a baixa está na linha de baixa, na mesma coluna
 * "Data" que a tela do IXC mostra naquela aba. É ela que manda: foi o que
 * alguém digitou dizendo "o dinheiro saiu neste dia".
 */

import { parseIxcDate, parseIxcId } from '../ixc/ixc.parse';

/** Uma baixa, como esta casa a lê. */
export interface BaixaNoIxc {
  /** O id da linha — é o `id_movim_finan` do estorno, e serve para achá-la lá */
  id: number | null;
  /** O título que esta baixa quitou */
  idFnApagar: number;
  /** O dia informado na baixa: quando o dinheiro saiu de verdade */
  data: Date;
  /** A coluna de onde a data saiu, para a ficha poder mostrar de onde ela veio */
  campo: string;
  /**
   * A conta de onde o dinheiro saiu nesta baixa, quando a linha a traz.
   *
   * O título guarda a conta em que foi **lançado**; a baixa, a que de fato
   * pagou — e as duas nem sempre são a mesma. A ficha dizia "saiu do Bradesco"
   * lendo o título, de uma baixa feita na ModoBank (título 31646, 31/08/2026),
   * e foi isso que escondeu o engano até a conciliação.
   */
  contaPagamento?: number | null;
}

/**
 * Os nomes conhecidos da coluna que liga a baixa ao título.
 *
 * Lista fechada, como as de baixa e cancelamento: aceitar qualquer campo com
 * "id" no nome faria uma baixa apontar para o título errado, e título errado
 * aqui é data de pagamento errada num pagamento que existe.
 */
export const COLUNAS_DO_TITULO = [
  'id_pagar',
  'id_apagar',
  'id_fn_apagar',
  'id_contas_apagar',
  'id_conta_pagar',
] as const;

/** Os nomes conhecidos da coluna com o dia informado na baixa. */
export const COLUNAS_DA_DATA = [
  'data',
  'data_pagamento',
  'data_baixa',
  'data_movimento',
] as const;

/** A coluna que liga esta linha a um título, se houver alguma. */
export function colunaDoTitulo(raw: Record<string, unknown>): string | null {
  for (const campo of COLUNAS_DO_TITULO) {
    if (parseIxcId(raw[campo]) !== null) return campo;
  }
  return null;
}

/**
 * Uma linha crua de baixa, na forma que o histórico usa.
 *
 * Devolve null para o que não serve: linha sem título (a tabela de movimentação
 * também guarda lançamento de entrada e de saída, que não são baixa de conta a
 * pagar) e linha sem data legível — sem o dia ela não corrige nada, e o
 * pagamento continua pela data do título.
 */
export function mapBaixa(
  raw: Record<string, unknown>,
  colunaTitulo?: string,
): BaixaNoIxc | null {
  const coluna = colunaTitulo ?? colunaDoTitulo(raw);
  if (!coluna) return null;

  const idFnApagar = parseIxcId(raw[coluna]);
  if (idFnApagar === null) return null;

  for (const campo of COLUNAS_DA_DATA) {
    const data = parseIxcDate(raw[campo]);
    if (data) {
      return {
        id: parseIxcId(raw.id ?? raw.id_movim_finan),
        idFnApagar,
        data,
        campo,
        // `id_contas` é a conta de pagamento, como no título. `id_conta` não:
        // na movimentação ele é a conta do razão, e trocar uma pela outra
        // mostraria um código de plano de contas como se fosse o banco.
        contaPagamento: parseIxcId(raw.id_contas),
      };
    }
  }
  return null;
}

/**
 * A última baixa de cada título.
 *
 * Título pago em duas vezes tem duas linhas, e a que responde "quando ele ficou
 * quitado" é a mais recente. Empate no dia decide pelo id maior, que é a linha
 * lançada depois — nunca por ordem de chegada, que muda a cada leitura.
 */
export function ultimaBaixaPorTitulo(
  baixas: BaixaNoIxc[],
): Map<number, BaixaNoIxc> {
  const porTitulo = new Map<number, BaixaNoIxc>();

  for (const baixa of baixas) {
    const atual = porTitulo.get(baixa.idFnApagar);
    if (!atual || maisRecente(baixa, atual)) {
      porTitulo.set(baixa.idFnApagar, baixa);
    }
  }

  return porTitulo;
}

function maisRecente(candidata: BaixaNoIxc, atual: BaixaNoIxc): boolean {
  const dia = candidata.data.getTime() - atual.data.getTime();
  if (dia !== 0) return dia > 0;
  return (candidata.id ?? 0) > (atual.id ?? 0);
}
