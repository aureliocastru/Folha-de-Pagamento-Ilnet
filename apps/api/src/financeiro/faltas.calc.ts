/**
 * O que uma falta custa.
 *
 * Duas coisas, e a segunda é a que escapa de quem calcula à mão: o dia, e o
 * descanso semanal remunerado daquela semana. Pela CLT, quem falta sem
 * justificativa perde o DSR da semana em que faltou — então marcar um dia
 * desconta dois.
 *
 * A conta do DSR é **por semana**, e não por falta: quem faltou três dias na
 * mesma semana perde um domingo, não três. O descanso é um só.
 *
 * As datas são dias, e não instantes: elas nascem, andam e são lidas em UTC à
 * meia-noite, de ponta a ponta. Misturar fusos aqui faz o dia mudar de casa —
 * e num calendário isso não é arredondamento, é o dia errado marcado.
 */

/** Quanto vale um dia de trabalho. */
export const DIAS_DO_MES = 30;

export interface DescontoDeFaltas {
  /** Quantos dias foram marcados */
  dias: number;
  /** Quantas semanas tiveram ao menos uma falta — é o número de DSR perdidos */
  semanasComFalta: number;
  /** Quanto vale um dia (salário ÷ 30) */
  valorDoDia: number;
  /** dias × valor do dia */
  valorDosDias: number;
  /** semanasComFalta × valor do dia */
  valorDoDsr: number;
  /** O que sai do salário: os dias mais os descansos perdidos */
  total: number;
}

/** O desconto com os dias que o causaram — o que a folha mostra, parcela a parcela. */
export interface FaltasDoMes extends DescontoDeFaltas {
  /** Os dias marcados, "AAAA-MM-DD", do primeiro ao último. */
  datas: string[];
}

/**
 * O desconto das faltas de uma competência.
 *
 * O valor do dia é o salário dividido por 30, que é a praxe: o mês da folha tem
 * trinta dias sempre, independente de fevereiro ter 28 e março ter 31. Usar o
 * número real de dias faria a mesma falta custar preços diferentes conforme o
 * mês, o que ninguém consegue explicar para quem recebeu a menos.
 */
export function calcularDescontoDeFaltas(
  salarioBase: number,
  dias: Date[],
): DescontoDeFaltas {
  const valorDoDia = arredondar(salarioBase / DIAS_DO_MES);
  const quantos = dias.length;

  /*
   * As semanas são identificadas pelo domingo que as abre.
   *
   * Duas faltas em dias diferentes da mesma semana derrubam o mesmo domingo, e
   * contá-lo duas vezes cobraria da pessoa um descanso que ela não tinha para
   * perder. É por isso que a conta passa por um conjunto, e não por uma soma.
   */
  const semanas = new Set(dias.map((d) => domingoDaSemana(d).getTime()));

  const valorDosDias = arredondar(valorDoDia * quantos);
  const valorDoDsr = arredondar(valorDoDia * semanas.size);

  return {
    dias: quantos,
    semanasComFalta: semanas.size,
    valorDoDia,
    valorDosDias,
    valorDoDsr,
    total: arredondar(valorDosDias + valorDoDsr),
  };
}

/**
 * O domingo que abre a semana de uma data.
 *
 * Tudo em UTC, como o resto das faltas: uma falta é um **dia**, não um
 * instante, e ler o dia no fuso de quem calcula faz a mesma data cair em
 * semanas diferentes conforme o servidor. Com o fuso do container em UTC e o
 * navegador em Brasília, era assim que o dia 3 virava o dia 2.
 */
export function domingoDaSemana(d: Date): Date {
  const domingo = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  domingo.setUTCDate(domingo.getUTCDate() - domingo.getUTCDay());
  return domingo;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
