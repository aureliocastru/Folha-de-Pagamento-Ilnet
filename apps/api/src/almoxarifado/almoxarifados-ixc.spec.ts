import {
  montarEdicaoAlmoxarifado,
  montarEdicaoDoVinculo,
  montarNovoAlmoxarifado,
  montarVinculo,
} from './almoxarifados-ixc';

describe('montarVinculo', () => {
  it('liga usuário e almoxarifado como no exemplo "Almoxarifados do Usuário (inserir)"', () => {
    expect(montarVinculo(41, 4)).toEqual({ id_usuario: '41', id_almox: '4', padrao_usuario: 'N' });
    expect(montarVinculo(41, 4, true).padrao_usuario).toBe('S');
  });

  it('recusa id faltando', () => {
    expect(() => montarVinculo(0, 4)).toThrow(/usuário/);
  });
});

describe('montarEdicaoDoVinculo', () => {
  const VINCULO_NO_IXC = {
    id: '77',
    id_usuario: '41',
    id_almox: '4',
    padrao_usuario: 'N',
  };

  it('devolve a ligação inteira, só com o padrão por cima', () => {
    expect(montarEdicaoDoVinculo(VINCULO_NO_IXC, true)).toEqual({
      id: '77',
      id_usuario: '41',
      id_almox: '4',
      padrao_usuario: 'S',
    });
  });

  it('desmarcar deixa o resto onde está', () => {
    const marcado = { ...VINCULO_NO_IXC, padrao_usuario: 'S' };
    expect(montarEdicaoDoVinculo(marcado, false)).toEqual({ ...VINCULO_NO_IXC });
  });
});

/**
 * Os corpos que vão ao IXC para a tabela `almox`, conferidos contra os
 * exemplos da documentação oficial ("Almoxarifados", coleção Postman "API -
 * IXC Provedor"). O que este arquivo protege:
 *
 *  - o cadastro novo leva todo obrigatório, inclusive o oculto
 *    `requisitar_preferencialmente_de` (vazio, como o exemplo da doc);
 *  - a edição devolve o registro **inteiro** — o `PUT` reescreve a linha.
 */

const ALMOX_NO_IXC = {
  id: '3',
  descricao: 'Van do Anderson',
  id_filial: '1',
  ativo: 'S',
  requisitar_preferencialmente_de: '1',
};

describe('montarNovoAlmoxarifado', () => {
  it('leva os obrigatórios, com o oculto vazio', () => {
    expect(montarNovoAlmoxarifado({ descricao: 'Van do Cleyson', filialId: 1 })).toEqual({
      descricao: 'Van do Cleyson',
      id_filial: '1',
      ativo: 'S',
      requisitar_preferencialmente_de: '',
    });
  });

  it('recusa nome curto e filial faltando', () => {
    expect(() => montarNovoAlmoxarifado({ descricao: 'a', filialId: 1 })).toThrow(/curto/);
    expect(() => montarNovoAlmoxarifado({ descricao: 'Van nova', filialId: 0 })).toThrow(
      /filial/,
    );
  });
});

describe('montarEdicaoAlmoxarifado', () => {
  it('devolve o cadastro inteiro, com a mudança por cima', () => {
    const corpo = montarEdicaoAlmoxarifado(ALMOX_NO_IXC, { descricao: '  Van do Anderson 2 ' });
    expect(corpo).toEqual({
      id: '3',
      descricao: 'Van do Anderson 2',
      id_filial: '1',
      ativo: 'S',
      // Preservado — esta tela nunca mexe nele.
      requisitar_preferencialmente_de: '1',
    });
  });

  it('ativo é S/N, e a filial vai como texto', () => {
    expect(montarEdicaoAlmoxarifado(ALMOX_NO_IXC, { ativo: false }).ativo).toBe('N');
    expect(montarEdicaoAlmoxarifado(ALMOX_NO_IXC, { ativo: true }).ativo).toBe('S');
    expect(montarEdicaoAlmoxarifado(ALMOX_NO_IXC, { filialId: 2 }).id_filial).toBe('2');
  });

  it('recusa nome curto', () => {
    expect(() => montarEdicaoAlmoxarifado(ALMOX_NO_IXC, { descricao: 'a' })).toThrow(/curto/);
  });
});
