import { avaliarPreco } from './precos-do-estoque';

/**
 * O preço de cada produto do estoque. O que este arquivo protege:
 *
 *  - preço de acerto (R$ 0,01) e preço absurdo aparecem como suspeitos, com a sugestão da compra;
 *  - preço que bate com a última compra está certo;
 *  - preço conferido vale, até o IXC mudar por fora.
 */
describe('o preço do produto do estoque', () => {
  const base = { ultimaCompra: 0, custoMedio: 0, conferido: null };

  it('R$ 0,01 é acerto, e a sugestão é a última compra', () => {
    expect(avaliarPreco({ ...base, preco: 0.01, ultimaCompra: 89.9 })).toMatchObject({
      situacao: 'suspeito',
      sugestao: 89.9,
    });
  });

  it('o preço longe da última compra é suspeito; perto, está certo', () => {
    expect(avaliarPreco({ ...base, preco: 3765200, ultimaCompra: 376.52 }).situacao).toBe('suspeito');
    expect(avaliarPreco({ ...base, preco: 400, ultimaCompra: 376.52 }).situacao).toBe('ok');
  });

  it('preço absurdo é suspeito mesmo quando a compra foi digitada igual', () => {
    expect(avaliarPreco({ ...base, preco: 800000, ultimaCompra: 800000, custoMedio: 800000 })).toMatchObject({
      situacao: 'suspeito',
      sugestao: null,
    });
  });

  it('sem compra, o custo médio é a referência', () => {
    expect(avaliarPreco({ ...base, preco: 10, custoMedio: 50 }).situacao).toBe('suspeito');
    expect(avaliarPreco({ ...base, preco: 10, custoMedio: 11 }).situacao).toBe('ok');
    expect(avaliarPreco({ ...base, preco: 10 }).situacao).toBe('ok');
  });

  it('o conferido vale enquanto for o preço do IXC', () => {
    expect(avaliarPreco({ ...base, preco: 25000, conferido: 25000 }).situacao).toBe('conferido');
    expect(avaliarPreco({ ...base, preco: 0.01, conferido: 25000 }).situacao).toBe('suspeito');
  });
});
