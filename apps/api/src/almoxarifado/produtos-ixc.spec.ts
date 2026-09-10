import {
  hojeParaIxc,
  montarEdicaoProduto,
  montarEntrada,
  montarItemDaEntrada,
  montarItemDaTransferencia,
  montarNovoProduto,
  montarTransferencia,
} from './produtos-ixc';

/**
 * Os corpos que vão ao IXC, conferidos contra os exemplos da documentação
 * oficial da API ("API - IXC Provedor", coleção do Postman). O que este
 * arquivo protege:
 *
 *  - a edição devolve o cadastro **inteiro** — o `PUT` reescreve a linha, e
 *    faltar um campo é apagá-lo lá;
 *  - o produto novo leva todo obrigatório do "Produtos (inserir)", com o
 *    fiscal copiado do modelo, e recusa modelo sem fiscal, patrimônio e
 *    serviço;
 *  - transferência e entrada saem com os campos e os formatos dos exemplos
 *    ("1.00000", "DD/MM/AAAA", `status: "A"`…).
 */

// O cadastro como o IXC o devolve na leitura: tudo texto, data AAAA-MM-DD.
const PRODUTO_NO_IXC = {
  id: '36',
  ativo: 'S',
  id_sub_grupo: '3',
  subgrupo_tipo: '',
  descricao: 'Conector APC',
  codigo_barras: '7890000000001',
  tipo: 'C',
  controla_estoque: 'S',
  movimentacao: 'A',
  unidade: '1',
  vencimento_garantia: '2027-01-31',
  preco_base: '1.50',
  aceita_valor: 'P',
  icms_issqn: 'ICMS',
  id_class_fiscal: '1',
  id_class_fiscal_entrada: '2',
  ncm: '85367000',
  id_conta_estoque: '10',
  mostra_valor_ecommerce: 'P',
  tipo_ecommerce: 'P',
  ecommerce_prioridade: '1',
  ultima_atualizacao: '2026-08-01 10:00:00',
  coluna_que_o_app_nao_conhece: 'guardada',
};

describe('montarEdicaoProduto', () => {
  it('devolve o cadastro inteiro, com a mudança por cima', () => {
    const corpo = montarEdicaoProduto(PRODUTO_NO_IXC, { descricao: '  Conector  APC azul ' });
    expect(corpo).toMatchObject({
      descricao: 'Conector APC azul',
      ncm: '85367000',
      id_class_fiscal: '1',
      id_sub_grupo: '3',
      codigo_barras: '7890000000001',
      coluna_que_o_app_nao_conhece: 'guardada',
    });
  });

  it('data volta no formato da escrita, e a última atualização vai vazia', () => {
    const corpo = montarEdicaoProduto(PRODUTO_NO_IXC, { precoBase: 2 });
    expect(corpo.vencimento_garantia).toBe('31/01/2027');
    expect(corpo.ultima_atualizacao).toBe('');
    expect(corpo.preco_base).toBe('2.00');
  });

  it('ativo é S/N, e a unidade vai como texto', () => {
    expect(montarEdicaoProduto(PRODUTO_NO_IXC, { ativo: false }).ativo).toBe('N');
    expect(montarEdicaoProduto(PRODUTO_NO_IXC, { ativo: true }).ativo).toBe('S');
    expect(montarEdicaoProduto(PRODUTO_NO_IXC, { unidadeId: 4 }).unidade).toBe('4');
  });

  it('recusa nome curto e preço negativo', () => {
    expect(() => montarEdicaoProduto(PRODUTO_NO_IXC, { descricao: 'a' })).toThrow(/curto/);
    expect(() => montarEdicaoProduto(PRODUTO_NO_IXC, { precoBase: -1 })).toThrow(/preço/);
  });
});

describe('montarNovoProduto', () => {
  const novo = { descricao: 'Conector SC/APC', precoBase: 1.2, unidadeId: 1 };

  it('leva todos os obrigatórios do "Produtos (inserir)"', () => {
    const corpo = montarNovoProduto(novo, PRODUTO_NO_IXC);
    expect(corpo).toMatchObject({
      ativo: 'S',
      id_sub_grupo: '3',
      descricao: 'Conector SC/APC',
      tipo: 'C',
      controla_estoque: 'S',
      movimentacao: 'A',
      unidade: '1',
      preco_base: '1.20',
      aceita_valor: 'P',
      icms_issqn: 'ICMS',
      id_class_fiscal: '1',
      ncm: '85367000',
      mostra_valor_ecommerce: 'P',
      tipo_ecommerce: 'P',
      ecommerce_prioridade: '1',
    });
  });

  it('não copia o que é só do modelo: código de barras, id, saldo', () => {
    const corpo = montarNovoProduto(novo, PRODUTO_NO_IXC);
    expect(corpo).not.toHaveProperty('id');
    expect(corpo).not.toHaveProperty('codigo_barras');
    expect(corpo).not.toHaveProperty('coluna_que_o_app_nao_conhece');
  });

  it('recusa modelo sem o fiscal preenchido', () => {
    expect(() => montarNovoProduto(novo, { ...PRODUTO_NO_IXC, ncm: '' })).toThrow(/NCM/);
    expect(() => montarNovoProduto(novo, { ...PRODUTO_NO_IXC, id_class_fiscal: '0' })).toThrow(
      /classificação fiscal/,
    );
  });

  it('recusa patrimônio e serviço como modelo', () => {
    expect(() => montarNovoProduto(novo, { ...PRODUTO_NO_IXC, tipo: 'P' })).toThrow(/patrimônio/);
    expect(() => montarNovoProduto(novo, { ...PRODUTO_NO_IXC, tipo: 'S' })).toThrow(/serviço/);
  });
});

describe('transferência', () => {
  it('a transferência sai com origem, destino, filiais e data', () => {
    expect(
      montarTransferencia({
        almoxSaida: 1,
        filialSaida: 1,
        almoxEntrada: 2,
        filialEntrada: 1,
        data: '10/09/2026',
        observacao: 'para a van',
      }),
    ).toEqual({
      id_almox_saida: '1',
      id_filial: '1',
      id_almox_entrada: '2',
      id_filial_entrada: '1',
      data: '10/09/2026',
      operador: '',
      obs: 'para a van',
    });
  });

  it('recusa origem igual ao destino', () => {
    expect(() =>
      montarTransferencia({
        almoxSaida: 1,
        filialSaida: 1,
        almoxEntrada: 1,
        filialEntrada: 1,
        data: '10/09/2026',
        observacao: '',
      }),
    ).toThrow(/mesmo almoxarifado/);
  });

  it('o item vai no formato do exemplo', () => {
    expect(
      montarItemDaTransferencia(5, {
        produtoId: 43,
        unidadeId: 1,
        unidadeSigla: 'UND',
        quantidade: 1,
        tipoProduto: 'C',
      }),
    ).toEqual({
      id_patrimonio: '',
      id_produto: '43',
      id_unidade: '1',
      unidade_sigla: 'UND',
      qtde: '1.00000',
      fator_conversao: '1.000000000',
      id_transf_almox: '5',
      tipo_produto: 'C',
    });
  });

  it('recusa quantidade zero', () => {
    expect(() =>
      montarItemDaTransferencia(5, {
        produtoId: 43,
        unidadeId: 1,
        unidadeSigla: 'UND',
        quantidade: 0,
        tipoProduto: 'C',
      }),
    ).toThrow(/maior que zero/);
  });
});

describe('entrada de compra', () => {
  it('a compra nasce aberta, sem frete, com os obrigatórios do exemplo', () => {
    expect(
      montarEntrada({
        tipoDocumentoId: 201,
        fornecedorId: 7,
        condicaoPagamentoId: 1,
        filialId: 1,
        data: '10/09/2026',
        numeroNota: '123',
        valorTotal: 150,
      }),
    ).toMatchObject({
      tipo_documento: '201',
      id_fornecedor: '7',
      condicoes_pagamento: '1',
      filial_id: '1',
      data_emissao: '10/09/2026',
      data_entrada: '10/09/2026',
      numero_nf: '123',
      valor_total: '150.00',
      gera_estoque: 'N',
      status: 'A',
      nfe_emitida: 'N',
      tipo_frete: '9',
    });
  });

  it('o item é uma entrada (tipo E) que conta no estoque (estoque S)', () => {
    expect(
      montarItemDaEntrada(9, {
        produtoId: 36,
        unidadeId: 2,
        unidadeSigla: 'MC',
        almoxId: 1,
        filialId: 1,
        quantidade: 3,
        valorUnitario: 12.5,
        data: '10/09/2026',
      }),
    ).toMatchObject({
      id_produto: '36',
      id_unidade: '2',
      id_almox: '1',
      quantidade: '3.00000',
      valor_unitario: '12.50',
      valor_total: '37.50',
      estoque: 'S',
      id_entrada: '9',
      tipo: 'E',
      unidade_sigla: 'MC',
    });
  });
});

describe('hojeParaIxc', () => {
  it('usa o dia de Brasília, e não o do servidor em UTC', () => {
    // 01:30 UTC do dia 11 ainda é 22:30 do dia 10 em Brasília.
    expect(hojeParaIxc(new Date('2026-09-11T01:30:00Z'))).toBe('10/09/2026');
  });
});
