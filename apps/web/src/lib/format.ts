const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Formata número/decimal (inclui strings vindas do Prisma) como moeda. */
export function formatBRL(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return brl.format(Number.isFinite(n) ? n : 0);
}

const precoUnitario = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * Preço de uma unidade, com até quatro casas.
 *
 * O resto da casa fala em reais e centavos porque o que ela mostra é o que sai
 * do caixa. Aqui não: drop se compra a R$ 0,4750 o metro, e arredondar isso
 * para R$ 0,48 erra R$ 25,00 num rolo de dez mil metros — bem acima do que
 * costuma separar dois fornecedores. Quem tem duas casas continua com duas:
 * "R$ 92,00" não vira "R$ 92,0000".
 */
export function formatPrecoUnitario(
  value: number | string | null | undefined,
): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return precoUnitario.format(Number.isFinite(n) ? n : 0);
}

const numeroBR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Número com vírgula decimal e ponto de milhar, sem o "R$": "2.107,03".
 *
 * `casas` existe para o preço unitário das cotações, que tem quatro. Sem
 * argumento são duas — o dinheiro que sai do caixa, que é o resto da casa —, e
 * esse caminho continua usando o formatador já montado.
 */
export function formatNumeroBR(valor: number, casas = 2): string {
  if (casas === 2) return numeroBR.format(valor);
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

/*
 * Aqui vivia o `parseValorBR`, que adivinhava o que a pessoa quis dizer ao
 * escrever "2.107,03", "2107.03" ou "1.234" — e a adivinhação existia porque o
 * campo de dinheiro aceitava texto livre. Com a máscara do `CampoDinheiro` o
 * campo só recebe dígitos, e a vírgula é sempre a mesma: não há mais o que
 * desempatar. Está no histórico, se um dia voltar a fazer falta.
 */

/**
 * Hoje, "AAAA-MM-DD", no fuso de Brasília — o mesmo dia que o servidor usa
 * para o IXC (`hojeParaIxc`), para a tela e a API não discordarem às 22h.
 */
export function hojeEmBrasilia(agora = new Date()): string {
  // en-CA escreve a data como o <input type="date"> a quer: 2026-09-19.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

export function formatData(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * A média de consumo: "8,25 km/L", ou "3,5 L/h" nas máquinas.
 *
 * A unidade vem do servidor junto com o número, e não do tipo do veículo —
 * quem faz a conta é quem sabe se ela é por quilômetro ou por hora de
 * horímetro.
 */
export function formatConsumo(
  valor: number,
  unidade: 'km_por_litro' | 'litros_por_hora',
): string {
  const n = valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return unidade === 'km_por_litro' ? `${n} km/L` : `${n} L/h`;
}

/**
 * O que se digita num medidor de painel, limpo enquanto se digita.
 *
 * O km é inteiro. O horímetro não: o ponteiro dele anda de décimo em décimo —
 * 1252,6 é mil duzentas e cinquenta e duas horas e trinta e seis minutos —, e
 * é assim que a máquina é lida. Por isso ele aceita uma vírgula e uma casa; o
 * ponto que vem do teclado numérico do celular vira vírgula, que é a que se
 * escreve aqui.
 */
export function medidorLimpo(bruto: string, comDecimo: boolean): string {
  if (!comDecimo) return bruto.replace(/\D/g, '').slice(0, 7);
  const [inteiro, ...resto] = bruto
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, ',')
    .split(',');
  const horas = inteiro.slice(0, 7);
  return resto.length ? `${horas},${resto.join('').slice(0, 1)}` : horas;
}

/** "1252,6" → 1252.6; vazio → null. O que a API espera é número. */
export function medidorNumero(digitado: string): number | null {
  if (!digitado) return null;
  const n = Number(digitado.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** O medidor escrito: "27.191" de km, "1.252,6" de horímetro. */
export function formatMedidor(valor: number, comDecimo = false): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: comDecimo ? 1 : 0 });
}
