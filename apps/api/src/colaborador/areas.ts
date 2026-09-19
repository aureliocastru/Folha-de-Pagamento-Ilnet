/**
 * O que da Minha área cada login abre — distribuído na tela de Usuários, junto
 * dos módulos.
 *
 * - `pontuacao`: a pontuação da própria pessoa;
 * - `abastecimento`: o abastecimento do veículo que está no nome dela;
 * - `pontuar`: é coordenador — pontua os outros, transfere entre
 *   almoxarifados, e não vê a análise de risco.
 *
 * Mora à parte de `MODULOS` de propósito: lá, lista vazia é "todos", e aqui
 * isso daria o painel de pontuar a qualquer login esquecido.
 */
export const AREAS_DO_COLABORADOR = ['pontuacao', 'abastecimento', 'pontuar'] as const;
export type AreaDoColaborador = (typeof AREAS_DO_COLABORADOR)[number];

/**
 * Pode levar material de um almoxarifado para outro: o coordenador, marcado
 * no login pelo administrador — a mesma marca que o deixa pontuar (pedido do
 * dono, em 19/09/2026: o almoxarife dá saída e confere, mas não transfere).
 *
 * O ADMIN passa sempre: é ele quem marca os coordenadores, e trancar a si
 * mesmo não teria conserto pela tela.
 */
export function transfereEntreAlmoxarifados(
  usuario?: { role?: string; minhaArea?: string[] | null } | null,
): boolean {
  if (!usuario) return false;
  return usuario.role === 'ADMIN' || (usuario.minhaArea ?? []).includes('pontuar');
}
