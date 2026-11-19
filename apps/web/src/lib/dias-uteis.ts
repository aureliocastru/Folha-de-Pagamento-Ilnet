/**
 * Dia útil bancário no Brasil, do lado da tela.
 *
 * É o mesmo calendário de `apps/api/src/contas-abertas/dias-uteis.ts` — mexeu
 * num, mexa no outro. Fica copiado porque o build da web só leva a pasta
 * `apps/web` (ver o Dockerfile), e o vencimento lido de um boleto precisa ser
 * acertado na hora, sem ida à API.
 *
 * A lista inclui o Carnaval e o Corpus Christi, que são ponto facultativo e
 * não feriado — mas em que os bancos não abrem.
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

/** Domingo de Páscoa (Meeus/Jones/Butcher), em UTC: dele saem os feriados móveis. */
function domingoDePascoa(ano: number): Date {
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

const UM_DIA = 24 * 60 * 60 * 1000;

const daData = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);

const cache = new Map<number, Set<string>>();

function feriadosDoAno(ano: number): Set<string> {
  const guardado = cache.get(ano);
  if (guardado) return guardado;
  const pascoa = domingoDePascoa(ano).getTime();
  const dias = [
    ...FIXOS.map(([mes, dia]) => new Date(Date.UTC(ano, mes - 1, dia))),
    new Date(pascoa - 48 * UM_DIA), // segunda de Carnaval
    new Date(pascoa - 47 * UM_DIA), // terça de Carnaval
    new Date(pascoa - 2 * UM_DIA), // Sexta-feira Santa
    new Date(pascoa + 60 * UM_DIA), // Corpus Christi
  ];
  const set = new Set(dias.map(paraIso));
  cache.set(ano, set);
  return set;
}

/** Por que o banco não abre neste dia ("AAAA-MM-DD"), ou null se abre. */
export function porQueNaoEUtil(iso: string): 'sábado' | 'domingo' | 'feriado' | null {
  const d = daData(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCDay() === 6) return 'sábado';
  if (d.getUTCDay() === 0) return 'domingo';
  return feriadosDoAno(d.getUTCFullYear()).has(paraIso(d)) ? 'feriado' : null;
}

/**
 * O próprio dia, se o banco abre; senão o primeiro útil na direção pedida.
 *
 * Para frente é o boleto: vencido no sábado, paga-se na segunda sem juros. Para
 * trás é o Pix: ele não ganha esse prazo, e depois do dia a cobrança pode vir
 * com multa — o último dia útil antes é o que dá para pagar sem ela.
 */
export function diaUtil(iso: string, direcao: 'depois' | 'antes'): string {
  let d = daData(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const passo = direcao === 'depois' ? UM_DIA : -UM_DIA;
  // Dez dias cobrem qualquer emenda de feriado; o limite só evita laço infinito.
  for (let i = 0; i < 10 && porQueNaoEUtil(paraIso(d)); i++) d = new Date(d.getTime() + passo);
  return paraIso(d);
}
