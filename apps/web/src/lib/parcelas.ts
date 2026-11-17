/**
 * Mudou o valor de uma parcela: as de cima ficam como estão, e o que falta
 * para fechar o total se divide por igual entre as de baixo. Os centavos que
 * sobram da divisão vão na primeira delas.
 *
 * Mexer na última não tem de onde tirar: a diferença fica à vista no aviso
 * da soma. Se as de cima já passam do total, as de baixo ficam zeradas.
 */
export function ajustarAbaixo<P extends { valor: string }>(
  parcelas: P[],
  indice: number,
  valorNovo: string,
  total: number,
): P[] {
  const lista = parcelas.map((p, i) => (i === indice ? { ...p, valor: valorNovo } : p));
  const abaixo = lista.length - indice - 1;
  if (abaixo <= 0 || !(total > 0)) return lista;

  const centavos = (v: string) => Math.round((Number(v) || 0) * 100);
  const fixos = lista.slice(0, indice + 1).reduce((s, p) => s + centavos(p.valor), 0);
  const resto = Math.max(Math.round(total * 100) - fixos, 0);
  const cada = Math.floor(resto / abaixo);
  const sobra = resto - cada * abaixo;

  return lista.map((p, i) =>
    i <= indice
      ? p
      : { ...p, valor: ((i === indice + 1 ? cada + sobra : cada) / 100).toFixed(2) },
  );
}
