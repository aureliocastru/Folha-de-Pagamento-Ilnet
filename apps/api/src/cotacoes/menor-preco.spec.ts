import {
  compararCatalogo,
  compararProduto,
  precosQueValem,
  type CotacaoCrua,
  type ProdutoParaComparar,
} from './menor-preco';

/**
 * A comparação de preços é a única parte deste módulo que erra em silêncio.
 *
 * Um cadastro errado alguém vê na tela. Uma comparação errada não se vê: ela
 * aparece na nota fiscal do mês seguinte, quando já se comprou do mais caro
 * achando que era o mais barato. O que este arquivo protege:
 *
 *  - o preço que vale de um fornecedor é o **mais recente** dele, e não o mais
 *    barato que ele já deu — cotação de março não paga compra de setembro;
 *  - duas cotações do mesmo dia decidem pela ordem de digitação, que é como se
 *    corrige um valor lançado errado;
 *  - a ordem da lista é estável: dois fornecedores no mesmo preço não trocam
 *    de lugar entre duas leituras iguais;
 *  - a economia é sobre o mais caro, que é o quanto da conta some ao trocar de
 *    fornecedor;
 *  - fornecedor desativado continua na comparação — o que ele cobrava não
 *    deixa de ser verdade porque paramos de comprar dele.
 */

const drop: ProdutoParaComparar = {
  id: 'p-drop',
  nome: 'Cabo drop 1FO',
  codigo: 'DROP-1FO',
  unidade: 'M',
  observacao: null,
  ativo: true,
};

let sequencia = 0;

function cotacao(dados: Partial<CotacaoCrua> & { valor: number }): CotacaoCrua {
  sequencia += 1;
  return {
    id: `c${sequencia}`,
    produtoId: drop.id,
    fornecedor: { id: 'f1', nome: 'Fibratec', ativo: true },
    data: '2026-09-01',
    criadoEm: `2026-09-01T10:00:0${sequencia}.000Z`,
    quantidadeMinima: null,
    observacao: null,
    registradoPor: null,
    ...dados,
  };
}

const fibratec = { id: 'f1', nome: 'Fibratec', ativo: true };
const opticall = { id: 'f2', nome: 'Opticall', ativo: true };
const redemax = { id: 'f3', nome: 'Redemax', ativo: true };

describe('o preço que vale de cada fornecedor', () => {
  it('é o mais recente dele, e não o mais barato que ele já deu', () => {
    const precos = precosQueValem([
      cotacao({ fornecedor: fibratec, valor: 0.42, data: '2026-03-10' }),
      cotacao({ fornecedor: fibratec, valor: 0.68, data: '2026-09-01' }),
    ]);

    expect(precos).toHaveLength(1);
    expect(precos[0].valor).toBe(0.68);
    expect(precos[0].data).toBe('2026-09-01');
  });

  it('desempata duas do mesmo dia pela ordem de digitação', () => {
    // Alguém lançou 0,85 e viu que era 0,58. A correção é a segunda linha.
    const primeira = cotacao({
      valor: 0.85,
      data: '2026-09-01',
      criadoEm: '2026-09-01T09:00:00.000Z',
    });
    const correcao = cotacao({
      valor: 0.58,
      data: '2026-09-01',
      criadoEm: '2026-09-01T09:04:00.000Z',
    });

    expect(precosQueValem([primeira, correcao])[0].valor).toBe(0.58);
    // A ordem em que chegam do banco não pode mudar a resposta.
    expect(precosQueValem([correcao, primeira])[0].valor).toBe(0.58);
  });

  it('põe o mais barato na frente e diz quanto cada um custa a mais', () => {
    const precos = precosQueValem([
      cotacao({ fornecedor: fibratec, valor: 0.85 }),
      cotacao({ fornecedor: opticall, valor: 0.55 }),
      cotacao({ fornecedor: redemax, valor: 0.7 }),
    ]);

    expect(precos.map((p) => p.fornecedor.nome)).toEqual([
      'Opticall',
      'Redemax',
      'Fibratec',
    ]);
    // 0.7 - 0.55 em ponto flutuante dá 0.14999999999999997.
    expect(precos.map((p) => p.aMaisQueOMenor)).toEqual([0, 0.15, 0.3]);
  });

  it('mantém a ordem estável quando dois empatam no preço', () => {
    const empate = [
      cotacao({ fornecedor: redemax, valor: 0.6 }),
      cotacao({ fornecedor: opticall, valor: 0.6 }),
    ];

    expect(precosQueValem(empate).map((p) => p.fornecedor.nome)).toEqual([
      'Opticall',
      'Redemax',
    ]);
    expect(
      precosQueValem([...empate].reverse()).map((p) => p.fornecedor.nome),
    ).toEqual(['Opticall', 'Redemax']);
  });

  it('mantém na comparação o fornecedor desativado', () => {
    const precos = precosQueValem([
      cotacao({ fornecedor: fibratec, valor: 0.85 }),
      cotacao({ fornecedor: { ...opticall, ativo: false }, valor: 0.55 }),
    ]);

    expect(precos[0].fornecedor.nome).toBe('Opticall');
    expect(precos[0].fornecedor.ativo).toBe(false);
  });
});

describe('a comparação de um produto', () => {
  it('mede a economia sobre o mais caro, que é o que some da conta', () => {
    const comparado = compararProduto(drop, [
      cotacao({ fornecedor: fibratec, valor: 1 }),
      cotacao({ fornecedor: opticall, valor: 0.75 }),
    ]);

    expect(comparado.maisBarato?.fornecedor.nome).toBe('Opticall');
    expect(comparado.economia).toEqual({ valor: 0.25, percentual: 25 });
  });

  it('não inventa economia quando só um fornecedor cotou', () => {
    const comparado = compararProduto(drop, [
      cotacao({ fornecedor: fibratec, valor: 0.85 }),
    ]);

    expect(comparado.maisBarato?.valor).toBe(0.85);
    // Não há escolha a fazer: "0%" sugeriria que os preços empataram.
    expect(comparado.economia).toBeNull();
  });

  it('aguenta produto que ninguém cotou ainda', () => {
    const comparado = compararProduto(drop, []);

    expect(comparado.precos).toEqual([]);
    expect(comparado.maisBarato).toBeNull();
    expect(comparado.economia).toBeNull();
    expect(comparado.cotacoes).toBe(0);
  });

  it('conta o histórico inteiro, e não só os preços que valem', () => {
    const comparado = compararProduto(drop, [
      cotacao({ fornecedor: fibratec, valor: 0.42, data: '2026-03-10' }),
      cotacao({ fornecedor: fibratec, valor: 0.68, data: '2026-09-01' }),
      cotacao({ fornecedor: opticall, valor: 0.55, data: '2026-09-02' }),
    ]);

    expect(comparado.precos).toHaveLength(2);
    expect(comparado.cotacoes).toBe(3);
  });
});

describe('o catálogo inteiro', () => {
  const onu: ProdutoParaComparar = {
    id: 'p-onu',
    nome: 'ONU 1 porta',
    codigo: null,
    unidade: 'UN',
    observacao: null,
    ativo: true,
  };

  it('não deixa a cotação de um produto cair na conta do outro', () => {
    const lista = compararCatalogo(
      [drop, onu],
      [
        cotacao({ produtoId: drop.id, fornecedor: fibratec, valor: 0.85 }),
        cotacao({ produtoId: onu.id, fornecedor: fibratec, valor: 92 }),
        cotacao({ produtoId: onu.id, fornecedor: opticall, valor: 78.5 }),
      ],
    );

    expect(lista[0].maisBarato?.valor).toBe(0.85);
    expect(lista[0].cotacoes).toBe(1);
    expect(lista[1].maisBarato?.valor).toBe(78.5);
    expect(lista[1].maisBarato?.fornecedor.nome).toBe('Opticall');
  });
});
