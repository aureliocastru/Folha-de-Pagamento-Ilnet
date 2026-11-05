/**
 * O recibo do 13º salário vira um bônus na folha de quem o recebe.
 *
 * O 13º vem da contabilidade em arquivo à parte, separado do recibo do mês, em
 * duas parcelas: a 1ª (o adiantamento) em novembro e a 2ª em dezembro. O
 * líquido de cada recibo não é o salário de ninguém — não pode trocar o "A
 * receber na folha" —, e é pago por aqui como bônus avulso, com a descrição
 * dizendo que é o 13º (pedido de 05/11/2026).
 *
 * O bônus avulso é de um **mês trabalhado** e sai na folha do quinto dia do mês
 * seguinte. O 13º da competência de novembro, então, é lançado no mês
 * trabalhado de outubro: sai na folha de 05/11, dentro do prazo da 1ª parcela.
 * Se a folha daquele dia já saiu para a pessoa, o mês trabalhado está fechado —
 * um lançamento nele não seria pago nunca — e o bônus vai para a seguinte.
 */

import { competenciaAnterior, competenciaSeguinte } from '../financeiro/folha.calc';
import type { FuncionarioDaFolha } from './recibos.a-receber';

export type ParcelaDo13 = 1 | 2;

/**
 * O tipo com que o recibo do 13º entra na pasta. Um por parcela: o índice
 * único da pasta é tipo + competência, e as duas parcelas não podem disputar a
 * mesma vaga se a contabilidade imprimir o mesmo mês nas duas.
 */
export const TIPO_RECIBO_13: Record<ParcelaDo13, string> = {
  1: 'Recibo de 13º salário (1ª parcela)',
  2: 'Recibo de 13º salário (2ª parcela)',
};

/** "13º salário 2026 — 1ª parcela": o nome do bônus na folha. */
export function descricaoDoBonus13(parcela: ParcelaDo13, ano: string): string {
  return `13º salário ${ano} — ${parcela}ª parcela`;
}

/**
 * A folha do quinto dia que paga o bônus: a do mês impresso no recibo, ou a
 * primeira depois dela que ainda não saiu para a pessoa.
 *
 * `fechadas` são as competências de folha em que já há salário ou bônus gerado
 * para ela. É a mesma régua da ficha do funcionário: folha que saiu fecha o mês
 * trabalhado, e gerar o bônus de novo pagaria duas vezes o que já foi.
 */
export function folhaDoBonus13(competencia: string, fechadas: Set<string>): string {
  let folha = competencia;
  // Um ano é o bastante: ninguém tem doze folhas adiante já geradas.
  for (let i = 0; i < 12 && fechadas.has(folha); i++) {
    folha = competenciaSeguinte(folha);
  }
  return folha;
}

/** O bônus deste 13º que a pessoa já tem — o mesmo PDF mandado de novo. */
export interface BonusDo13Existente {
  id: string;
  valor: number;
  /** O mês trabalhado do lançamento; null = alguém o fez fixo à mão. */
  competencia: string | null;
}

/**
 * Por que um recibo não vira bônus:
 * - `sem-liquido`, `sem-cadastro`, `fora-da-folha`, `inativo`: não há a quem
 *   pagar pela folha;
 * - `ja-pago`: o bônus já existe e a folha que o paga já saiu, então o valor
 *   novo não entra — mudar agora não mudaria o que foi pago.
 */
export type MotivoDoBonus13 =
  | 'sem-liquido'
  | 'sem-cadastro'
  | 'fora-da-folha'
  | 'inativo'
  | 'ja-pago';

const AVISO: Record<MotivoDoBonus13, string> = {
  'sem-liquido': 'o recibo não trouxe o líquido',
  'sem-cadastro': 'ninguém na folha com este CPF',
  'fora-da-folha': 'o cadastro deste CPF não está marcado como funcionário',
  inativo: 'o cadastro deste CPF está inativo',
  'ja-pago': 'o bônus já saiu na folha com outro valor: fica como está',
};

/** O que acontece com o bônus do 13º do dono de um recibo. */
export interface BonusDoRecibo {
  funcionarioId: string | null;
  /** O bônus que já existe, quando o PDF é mandado de novo. */
  lancamentoId: string | null;
  /** O valor do bônus que já existe. Null = ainda não há bônus. */
  antes: number | null;
  /** O valor que fica. Null = nada nasce nem muda. */
  depois: number | null;
  /** "AAAA-MM" da folha do quinto dia que paga o bônus. */
  folha: string | null;
  /** O mês trabalhado do lançamento (a folha menos um mês). */
  mesTrabalhado: string | null;
  motivo: MotivoDoBonus13 | null;
  aviso: string | null;
}

export function bonusDoRecibo(
  liquido: number | null,
  dono: FuncionarioDaFolha | null,
  existente: BonusDo13Existente | null,
  /** "AAAA-MM" impresso no recibo. */
  competencia: string,
  /** As folhas que já saíram para o dono (salário ou bônus gerado). */
  fechadas: Set<string>,
): BonusDoRecibo {
  const resultado = (
    campos: Partial<BonusDoRecibo>,
    motivo: MotivoDoBonus13 | null = null,
  ): BonusDoRecibo => ({
    funcionarioId: dono?.id ?? null,
    lancamentoId: existente?.id ?? null,
    antes: existente?.valor ?? null,
    depois: null,
    folha: null,
    mesTrabalhado: null,
    ...campos,
    motivo,
    aviso: motivo ? AVISO[motivo] : null,
  });

  if (liquido === null || liquido <= 0) return resultado({}, 'sem-liquido');
  if (!dono) return resultado({}, 'sem-cadastro');
  if (!dono.naFolha) return resultado({}, 'fora-da-folha');
  if (!dono.ativo) return resultado({}, 'inativo');

  if (existente) {
    const folha = existente.competencia
      ? competenciaSeguinte(existente.competencia)
      : null;
    const igual = Math.round(existente.valor * 100) === Math.round(liquido * 100);
    if (igual) return resultado({ folha, mesTrabalhado: existente.competencia });
    // Bônus que alguém fez fixo à mão não é mais deste recibo: não se mexe.
    if (!folha || fechadas.has(folha)) {
      return resultado({ folha, mesTrabalhado: existente.competencia }, 'ja-pago');
    }
    return resultado({
      depois: liquido,
      folha,
      mesTrabalhado: existente.competencia,
    });
  }

  const folha = folhaDoBonus13(competencia, fechadas);
  return resultado({
    depois: liquido,
    folha,
    mesTrabalhado: competenciaAnterior(folha),
  });
}
