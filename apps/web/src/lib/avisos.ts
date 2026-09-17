import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Modulo } from './modulos';

export interface AvisoDoMenu {
  quantos: number;
  /** O que está na fila, no singular: "abastecimento a conferir". */
  oQue: string;
}

/**
 * Os pontinhos do menu: o que está parado esperando alguém.
 *
 * A conferência dos abastecimentos é trabalho que chega de fora — quem
 * abastece lança o km e a foto pelo portal, e o valor da nota fica esperando
 * um administrador ler. Sem um aviso, essa fila só aparece para quem abre a
 * tela de Veículos por outro motivo, e nota nenhuma cobra sozinha.
 *
 * A chave do mapa é o `to` do item do menu, e o número é quantos esperam. É a
 * mesma consulta que a tela de Veículos faz (mesma `queryKey`): conferir um
 * abastecimento lá apaga o ponto daqui, sem ninguém avisar ninguém.
 */
export function useAvisosDoMenu(modulo: Modulo): Record<string, AvisoDoMenu> {
  const aConferir = useQuery({
    queryKey: ['veiculos', 'a-conferir'],
    queryFn: async () =>
      (await api.get<unknown[]>('/veiculos/abastecimentos/a-conferir')).data,
    enabled: modulo.id === 'contas-pagar',
    staleTime: 60_000,
    // A nota chega do posto a qualquer hora: de cinco em cinco minutos o menu
    // se dá conta dela sem que se precise sair da tela e voltar.
    refetchInterval: 5 * 60_000,
    // Perfil que não enxerga a fila simplesmente não ganha o ponto.
    retry: false,
  });

  const quantos = aConferir.data?.length ?? 0;
  return quantos > 0
    ? { veiculos: { quantos, oQue: 'abastecimento esperando conferência' } }
    : {};
}
