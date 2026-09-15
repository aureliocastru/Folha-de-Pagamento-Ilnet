import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { modulosDoUsuario } from './modulos';
import type { ColaboradorDoLogin, Usuario } from './types';

/** O que a tela inicial do colaborador precisa saber de quem entrou. */
export interface InicioDoColaborador {
  /** Null = o login não está ligado a um cadastro, nem se achou pelo nome. */
  colaborador: ColaboradorDoLogin | null;
  /** Quantos veículos da frota estão no nome dele. */
  veiculos: number;
}

/**
 * Quem é o login que entrou, no cadastro, e quantos veículos estão com ele.
 *
 * Pergunta ao servidor a cada abertura da tela, e não guarda no login: o
 * veículo posto no nome da pessoa hoje à tarde tem de aparecer no próximo
 * toque, e não amanhã, quando o login expirar.
 */
export function useInicioDoColaborador(ativo = true) {
  return useQuery({
    queryKey: ['colaborador'],
    queryFn: async () => (await api.get<InicioDoColaborador>('/colaborador')).data,
    enabled: ativo,
    retry: 0,
  });
}

/**
 * Este login abre a análise de risco? Mantém a regra de sempre: o técnico de
 * campo abre sempre; os demais, se abrem o módulo Segurança do Trabalho — pelo
 * perfil fixo, pela lista de módulos ou pelo perfil criado. Quem recusa de
 * verdade continua sendo a API.
 */
export function abreAnaliseDeRisco(usuario?: Usuario | null): boolean {
  if (!usuario) return false;
  if (usuario.role === 'TECNICO') return true;
  return modulosDoUsuario(usuario).some((m) => m.id === 'seguranca');
}
