import {
  filtrarEstoque,
  montarEstoque,
  numeroDoIxc,
  resumirEstoque,
  type LinhaDeEstoqueIxc,
} from './estoque.mapper';

/**
 * O estoque lido do IXC. O que este arquivo protege:
 *
 *  - o IXC devolve **uma linha por produto × almoxarifado**, e a tela pergunta
 *    por produto: o mesmo conector em três almoxarifados é um item com três
 *    saldos, e não três itens;
 *  - tudo lá é texto ("saldo": "4.000000000"), e um `NaN` que escape se
 *    espalha por toda soma que o encostar e chega à tela como "R$ NaN";
 *  - "abaixo do mínimo" só existe onde alguém definiu um mínimo. Marcar de
 *    vermelho o que não tem cadastro apagaria o alerta de quem tem.
 */

function linha(over: Partial<LinhaDeEstoqueIxc> = {}): LinhaDeEstoqueIxc {
  return {
    id: '1',
    id_produto: '49',
    produto_descricao: 'Conector SC/APC',
    produto_unidade: '14',
    produto_ativo: 'S',
    produto_preco_base: '3.40',
    id_almox: '1',
    almox_descricao: 'Estoque',
    almox_ativo: 'S',
    saldo: '4.000000000',
    ...over,
  };
}

describe('numeroDoIxc', () => {
  it('lê o texto de nove casas que o IXC manda', () => {
    expect(numeroDoIxc('4.000000000')).toBe(4);
    expect(numeroDoIxc('7800.00')).toBe(7800);
  });

  it('não deixa NaN escapar', () => {
    // Zero, e não NaN: um NaN aqui contamina toda soma adiante e chega à tela.
    expect(numeroDoIxc('')).toBe(0);
    expect(numeroDoIxc(undefined)).toBe(0);
    expect(numeroDoIxc('abacaxi')).toBe(0);
  });
});

describe('montarEstoque', () => {
  it('junta o mesmo produto de vários almoxarifados num item só', () => {
    const itens = montarEstoque([
      linha({ id_almox: '1', almox_descricao: 'Estoque', saldo: '4' }),
      linha({ id_almox: '2', almox_descricao: 'Van do Anderson', saldo: '11' }),
      linha({ id_almox: '3', almox_descricao: 'Obra', saldo: '2.5' }),
    ]);

    expect(itens).toHaveLength(1);
    expect(itens[0].total).toBe(17.5);
    // Do maior saldo para o menor: quem vai buscar quer saber onde tem mais.
    expect(itens[0].saldos.map((s) => s.almoxarifado)).toEqual([
      'Van do Anderson',
      'Estoque',
      'Obra',
    ]);
  });

  it('separa produtos diferentes', () => {
    const itens = montarEstoque([
      linha({ id_produto: '49', produto_descricao: 'Conector' }),
      linha({ id_produto: '50', produto_descricao: 'Cabo drop', saldo: '900' }),
    ]);

    expect(itens.map((i) => i.descricao)).toEqual(['Cabo drop', 'Conector']);
  });

  it('ignora a linha que veio sem produto', () => {
    // Agrupá-la sob o id 0 criaria um "produto" que soma o lixo da consulta.
    const itens = montarEstoque([linha(), linha({ id_produto: '' })]);
    expect(itens).toHaveLength(1);
  });

  it('marca abaixo do mínimo só onde há mínimo cadastrado', () => {
    const itens = montarEstoque(
      [
        linha({ id_produto: '49', id_almox: '1', saldo: '2' }),
        linha({ id_produto: '50', produto_descricao: 'Cabo', id_almox: '1', saldo: '0' }),
      ],
      [{ id_produto: '49', id_almox: '1', qtd_min: '10', qtd_max: '50' }],
    );

    const conector = itens.find((i) => i.produtoId === 49)!;
    const cabo = itens.find((i) => i.produtoId === 50)!;

    expect(conector.abaixoDoMinimo).toBe(true);
    expect(conector.saldos[0].minimo).toBe(10);
    // Zerado, mas sem mínimo cadastrado: não é alerta, é só zero.
    expect(cabo.abaixoDoMinimo).toBe(false);
    expect(cabo.semNenhum).toBe(true);
  });

  it('o mínimo é por almoxarifado, e basta um furado', () => {
    const itens = montarEstoque(
      [
        linha({ id_almox: '1', saldo: '100' }),
        linha({ id_almox: '2', almox_descricao: 'Van', saldo: '1' }),
      ],
      [{ id_produto: '49', id_almox: '2', qtd_min: '5' }],
    );

    expect(itens[0].abaixoDoMinimo).toBe(true);
    expect(itens[0].saldos.find((s) => s.almoxId === 1)!.abaixoDoMinimo).toBe(
      false,
    );
  });

  it('traduz a unidade quando o cadastro dela veio junto', () => {
    const itens = montarEstoque([linha()], [], new Map([[14, 'UN']]));
    expect(itens[0].unidade).toBe('UN');

    const semCadastro = montarEstoque([linha()]);
    expect(semCadastro[0].unidade).toBeNull();
  });

  it('trata produto sem a coluna "ativo" como ativo', () => {
    // O cadastro antigo do IXC tem linha sem ela, e escondê-las seria esconder
    // estoque que existe na prateleira.
    const itens = montarEstoque([linha({ produto_ativo: undefined })]);
    expect(itens[0].ativo).toBe(true);
  });
});

describe('resumirEstoque', () => {
  it('conta o que precisa de atenção e quanto está guardado', () => {
    const itens = montarEstoque(
      [
        linha({ id_produto: '49', saldo: '4', produto_preco_base: '3.40' }),
        linha({
          id_produto: '50',
          produto_descricao: 'Cabo',
          saldo: '0',
          produto_preco_base: '1.20',
        }),
      ],
      [{ id_produto: '49', id_almox: '1', qtd_min: '10' }],
    );

    expect(resumirEstoque(itens)).toEqual({
      itens: 2,
      abaixoDoMinimo: 1,
      semNenhum: 1,
      valorEmEstoque: 13.6,
    });
  });
});

describe('filtrarEstoque', () => {
  const itens = montarEstoque([
    linha({ id_produto: '49', produto_descricao: 'Conector SC/APC' }),
    linha({ id_produto: '50', produto_descricao: 'Cabo drop 1FO' }),
  ]);

  it('acha por pedaço da descrição, sem caixa', () => {
    expect(filtrarEstoque(itens, 'DROP').map((i) => i.produtoId)).toEqual([50]);
  });

  it('acha pelo código do produto', () => {
    expect(filtrarEstoque(itens, '49').map((i) => i.produtoId)).toEqual([49]);
  });

  it('sem termo, devolve tudo', () => {
    expect(filtrarEstoque(itens, '  ')).toHaveLength(2);
  });
});
