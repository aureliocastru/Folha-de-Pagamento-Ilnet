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

export function formatData(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
