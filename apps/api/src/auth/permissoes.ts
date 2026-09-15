import { MODULOS, type ModuloId } from './modulos.guard';

/** O que um perfil criado permite num módulo. */
export const NIVEIS = ['nao', 'ver', 'mexer'] as const;
export type Nivel = (typeof NIVEIS)[number];

export type Permissoes = Record<ModuloId, Nivel>;

/**
 * As permissões de um perfil, lidas do JSON do banco.
 *
 * Tudo o que não for um nível conhecido vira "não abre": um módulo novo, que
 * ainda não existia quando o perfil foi montado, nasce fechado para ele — o
 * administrador abre de propósito, em vez de alguém ganhar acesso por omissão.
 */
export function lerPermissoes(json: unknown): Permissoes {
  const cru = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return Object.fromEntries(
    MODULOS.map((m) => {
      const nivel = cru[m];
      return [m, (NIVEIS as readonly unknown[]).includes(nivel) ? nivel : 'nao'];
    }),
  ) as Permissoes;
}

/** Os módulos que o perfil abre, para ver ou para mexer. */
export function modulosQueAbre(p: Permissoes): ModuloId[] {
  return MODULOS.filter((m) => p[m] !== 'nao');
}
