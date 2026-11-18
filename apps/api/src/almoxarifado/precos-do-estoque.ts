/**
 * O preço de cada produto do estoque — o preço base do cadastro no IXC, o
 * único lugar onde ele mora: o valor do Estoque, a Contabilidade e esta lista
 * leem dali, e gravar aqui é gravar lá.
 *
 * Nesta base há preço de acerto (R$ 0,01) e preço absurdo (nota digitada com
 * a vírgula no lugar errado). Este arquivo diz, de cada produto, se o preço
 * dele merece confiança, e qual seria o certo.
 */

/** Abaixo disto é acerto de estoque, não preço de compra. */
export const MENOR_PRECO_DE_VERDADE = 0.1;
/** A maior não passa de uma vez e meia a menor: é o "concordam" da contabilidade. */
const CONCORDAM = 1.5;
/** Nada do almoxarifado custa isto por unidade; acima, só valendo depois de conferido. */
export const PRECO_ALTO_DEMAIS = 20_000;

export type SituacaoDoPreco = 'conferido' | 'ok' | 'suspeito';

export interface FontesDoPreco {
  /** O preço base do IXC: o preço que vale. */
  preco: number;
  /** Valor unitário da última compra de verdade (entrada de nota), 0 quando não há. */
  ultimaCompra: number;
  /** O custo médio do IXC (às vezes lixo: R$ 55 mi num roteador). */
  custoMedio: number;
  /** O preço que alguém conferiu nesta tela (ou que a nota gravou), quando há. */
  conferido: number | null;
}

export interface AvaliacaoDoPreco {
  situacao: SituacaoDoPreco;
  motivo: string | null;
  /** O preço que a tela oferece com um toque — o da última compra, de preferência. */
  sugestao: number | null;
}

const tem = (v: number) => Number.isFinite(v) && v >= MENOR_PRECO_DE_VERDADE;
const longe = (a: number, b: number) => Math.max(a, b) / Math.min(a, b) > CONCORDAM;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function avaliarPreco(f: FontesDoPreco): AvaliacaoDoPreco {
  // Sugestão absurda não é sugestão: o custo médio do IXC chega a R$ 55 mi num roteador.
  const plausivel = (v: number) => tem(v) && v <= PRECO_ALTO_DEMAIS;
  const sugestao = plausivel(f.ultimaCompra)
    ? arredondar(f.ultimaCompra)
    : plausivel(f.custoMedio)
      ? arredondar(f.custoMedio)
      : null;
  if (f.conferido !== null && Math.abs(f.conferido - f.preco) < 0.005 && tem(f.preco)) {
    return { situacao: 'conferido', motivo: null, sugestao: null };
  }
  if (!tem(f.preco)) {
    return {
      situacao: 'suspeito',
      motivo: f.preco > 0 ? `Preço de ${brl(f.preco)} — é de acerto, não de compra` : 'Sem preço',
      sugestao,
    };
  }
  // Preço e compra iguais e errados acontecem (a mesma nota digitada errado copiada nos dois).
  if (f.preco > PRECO_ALTO_DEMAIS) {
    return { situacao: 'suspeito', motivo: `Preço de ${brl(f.preco)} por unidade — alto demais`, sugestao };
  }
  if (tem(f.ultimaCompra)) {
    return longe(f.preco, f.ultimaCompra)
      ? { situacao: 'suspeito', motivo: `Longe da última compra (${brl(f.ultimaCompra)})`, sugestao }
      : { situacao: 'ok', motivo: null, sugestao: null };
  }
  // Custo médio absurdo não acusa ninguém: ele é que está errado.
  if (plausivel(f.custoMedio) && longe(f.preco, f.custoMedio)) {
    return { situacao: 'suspeito', motivo: `Sem compra, e longe do custo médio (${brl(f.custoMedio)})`, sugestao };
  }
  return { situacao: 'ok', motivo: null, sugestao: null };
}

export function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}
