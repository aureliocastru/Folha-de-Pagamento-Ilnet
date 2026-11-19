/**
 * Dia útil bancário no Brasil.
 *
 * Serve a uma pergunta só: o banco paga neste dia? Por isso a lista inclui o
 * Carnaval e o Corpus Christi, que são ponto facultativo e não feriado — mas
 * em que os bancos não abrem, e boleto com vencimento neles só é liquidado
 * depois. Para o caixa da empresa, facultativo e feriado dão no mesmo.
 *
 * A tela tem uma cópia deste calendário em `apps/web/src/lib/dias-uteis.ts`
 * (o build da web não enxerga a API): mexeu num, mexa no outro.
 */

/** Feriados nacionais de data fixa: [mês, dia]. */
const FIXOS: Array<[number, number]> = [
  [1, 1], // Confraternização Universal
  [4, 21], // Tiradentes
  [5, 1], // Dia do Trabalho
  [9, 7], // Independência
  [10, 12], // Nossa Senhora Aparecida
  [11, 2], // Finados
  [11, 15], // Proclamação da República
  [11, 20], // Consciência Negra — nacional desde 2024 (Lei 14.759/2023)
  [12, 25], // Natal
];

/**
 * Domingo de Páscoa do ano, em UTC. É dele que saem Carnaval, Sexta-feira
 * Santa e Corpus Christi — os três feriados que mudam de data todo ano.
 *
 * O cálculo é o algoritmo de Meeus/Jones/Butcher, o mesmo que os bancos usam
 * para publicar o calendário; escrevê-lo evita depender de uma tabela que
 * precisaria ser atualizada todo dezembro.
 */
export function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function somarDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

function chave(data: Date): string {
  return `${data.getUTCFullYear()}-${data.getUTCMonth() + 1}-${data.getUTCDate()}`;
}

const cache = new Map<number, Set<string>>();

/** Os dias em que o banco não abre naquele ano. */
export function feriadosDoAno(ano: number): Set<string> {
  const guardado = cache.get(ano);
  if (guardado) return guardado;

  const pascoa = domingoDePascoa(ano);
  const dias = [
    ...FIXOS.map(([mes, dia]) => new Date(Date.UTC(ano, mes - 1, dia))),
    somarDias(pascoa, -48), // segunda de Carnaval
    somarDias(pascoa, -47), // terça de Carnaval
    somarDias(pascoa, -2), // Sexta-feira Santa
    somarDias(pascoa, 60), // Corpus Christi
  ];

  const set = new Set(dias.map(chave));
  cache.set(ano, set);
  return set;
}

export function ehFeriado(data: Date): boolean {
  return feriadosDoAno(data.getUTCFullYear()).has(chave(data));
}

export function ehFimDeSemana(data: Date): boolean {
  const dia = data.getUTCDay();
  return dia === 0 || dia === 6;
}

export function ehDiaUtil(data: Date): boolean {
  return !ehFimDeSemana(data) && !ehFeriado(data);
}

/**
 * O próprio dia, se for útil; senão o próximo que for.
 *
 * Empurra para frente e nunca para trás: antecipar mudaria a data combinada
 * com quem recebe, enquanto adiar é o que o banco faz de qualquer jeito com um
 * boleto que vence no sábado.
 */
export function proximoDiaUtil(data: Date): Date {
  let d = data;
  // O limite existe só para não virar laço infinito num erro de data; sete
  // dias cobrem qualquer emenda de feriado que exista no calendário.
  for (let i = 0; i < 10 && !ehDiaUtil(d); i++) {
    d = somarDias(d, 1);
  }
  return d;
}
