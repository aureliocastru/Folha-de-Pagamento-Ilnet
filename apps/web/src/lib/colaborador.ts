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
  /** O que da Minha área o administrador deu a este login. */
  areas: string[];
}

/**
 * As partes da Minha área, na ordem dos chips da tela de Usuários e dos
 * cartões. Distribuídas login a login, junto dos módulos.
 */
export const AREAS_DO_COLABORADOR = [
  { id: 'pontuacao', nome: 'Pontuação' },
  { id: 'abastecimento', nome: 'Abastecimento' },
  { id: 'pontuar', nome: 'Pontuar' },
] as const;

/** O padrão de um login novo: o que todo colaborador tem. Pontuar, não. */
export const AREAS_PADRAO = ['pontuacao', 'abastecimento'];

/**
 * Que cartões este login vê. Marcado não basta: a pontuação é da pessoa, e
 * sem o login ligado ao cadastro não há de quem mostrar; o abastecimento, sem
 * veículo no nome dela, não tem onde lançar.
 */
export function cartoesDoColaborador(inicio?: InicioDoColaborador | null) {
  const areas = inicio?.areas ?? [];
  const ligado = !!inicio?.colaborador;
  const pontuacao = ligado && areas.includes('pontuacao');
  const abastecimento = ligado && areas.includes('abastecimento') && (inicio?.veiculos ?? 0) > 0;
  const pontuar = areas.includes('pontuar');
  return {
    pontuacao,
    abastecimento,
    pontuar,
    algum: pontuacao || abastecimento || pontuar,
    /** Marcou algo que é da pessoa, mas o login não está ligado a ela. */
    faltaLigar: !ligado && (areas.includes('pontuacao') || areas.includes('abastecimento')),
  };
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
