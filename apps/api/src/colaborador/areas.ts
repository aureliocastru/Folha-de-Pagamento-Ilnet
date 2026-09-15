/**
 * O que da Minha área cada login abre — distribuído na tela de Usuários, junto
 * dos módulos.
 *
 * - `pontuacao`: a pontuação da própria pessoa;
 * - `abastecimento`: o abastecimento do veículo que está no nome dela;
 * - `pontuar`: coordena — pontua os outros, e não vê a análise de risco.
 *
 * Mora à parte de `MODULOS` de propósito: lá, lista vazia é "todos", e aqui
 * isso daria o painel de pontuar a qualquer login esquecido.
 */
export const AREAS_DO_COLABORADOR = ['pontuacao', 'abastecimento', 'pontuar'] as const;
export type AreaDoColaborador = (typeof AREAS_DO_COLABORADOR)[number];
