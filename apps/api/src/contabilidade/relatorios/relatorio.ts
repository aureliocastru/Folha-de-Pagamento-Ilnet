import type { Aba } from '../planilha';

/** Uma linha do resumo que a tela mostra no cartão do item. */
export interface LinhaDoResumo {
  rotulo: string;
  valor: number | string;
  tipo: 'moeda' | 'numero' | 'texto';
  /** O número principal do item — a tela o mostra grande. */
  destaque?: boolean;
}

/**
 * O que um item lido produz: o resumo da tela, o que pede atenção, e a
 * planilha que vai no zip.
 *
 * A planilha é guardada como as abas prontas (linhas e colunas), e não como
 * o arquivo: é o mesmo dado em menos espaço, e o .xlsx é montado na hora do
 * download.
 */
export interface Relatorio {
  resumo: LinhaDoResumo[];
  /** O que a pessoa precisa olhar antes de mandar — frases curtas. */
  avisos: string[];
  abas: Aba[];
  /** O nome da planilha dentro da pasta do item, sem a extensão. */
  arquivo: string;
}

export function moeda(rotulo: string, valor: number, destaque = false): LinhaDoResumo {
  return { rotulo, valor: Math.round(valor * 100) / 100, tipo: 'moeda', destaque };
}

export function quantidade(rotulo: string, valor: number): LinhaDoResumo {
  return { rotulo, valor, tipo: 'numero' };
}

export function soma<T>(itens: T[], valor: (i: T) => number): number {
  return Math.round(itens.reduce((s, i) => s + valor(i), 0) * 100) / 100;
}

/** "R$ 1.234,56", para os avisos e cabeçalhos escritos por extenso. */
export function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
