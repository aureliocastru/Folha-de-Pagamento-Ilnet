import { montarComodatos, resumirComodatos } from './comodato.mapper';

/**
 * O comodato montado a partir das três tabelas do IXC. Nomes e endereços
 * inventados.
 */

const contratos = new Map([
  [100, { id: '100', id_cliente: '10', contrato: 'Fibra 300M', status: 'A', endereco: 'Rua das Flores', numero: '12', bairro: 'Centro' }],
  [101, { id: '101', id_cliente: '11', contrato: 'Fibra 500M', status: 'A', endereco: 'Av. Brasil', numero: '', bairro: 'Cohab' }],
]);
const clientes = new Map([
  [10, { id: '10', razao: 'Maria Exemplo' }],
  [11, { id: '11', razao: '', fantasia: 'Mercadinho Teste' }],
]);
const produtos = new Map([[36, 'ONU GPON X']]);
const almox = new Map([[1, 'Estoque central']]);

describe('montarComodatos', () => {
  it('diz de quem é a peça e onde ela está', () => {
    const [item] = montarComodatos(
      [{ id: '1', id_produto: '36', id_contrato: '100', id_almox: '1', qtde_saida: '1.000', numero_serie: 'ABC123', mac: '00:11:22:33:44:55', data: '2026-05-02', status_comodato: 'E' }],
      contratos,
      clientes,
      produtos,
      almox,
    );
    expect(item).toMatchObject({
      produto: 'ONU GPON X',
      quantidade: 1,
      numeroSerie: 'ABC123',
      mac: '00:11:22:33:44:55',
      desde: '2026-05-02',
      almoxarifado: 'Estoque central',
      plano: 'Fibra 300M',
      cliente: 'Maria Exemplo',
      endereco: 'Rua das Flores, 12 — Centro',
    });
  });

  it('usa o nome fantasia quando falta a razão, e deixa de fora o devolvido', () => {
    const itens = montarComodatos(
      [
        { id: '2', id_produto: '36', id_contrato: '101', qtde_saida: '1', status_comodato: 'E' },
        { id: '3', id_produto: '36', id_contrato: '100', qtde_saida: '1', status_comodato: 'D' },
      ],
      contratos,
      clientes,
      produtos,
      almox,
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ cliente: 'Mercadinho Teste', endereco: 'Av. Brasil — Cohab' });
  });

  it('contrato que não voltou do IXC ainda aparece, pelo número', () => {
    const [item] = montarComodatos(
      [{ id: '4', id_produto: '99', id_contrato: '555', qtde_saida: '2', status_comodato: 'E', descricao: 'Roteador' }],
      contratos,
      clientes,
      produtos,
      almox,
    );
    expect(item).toMatchObject({ cliente: 'Contrato 555', produto: 'Roteador', quantidade: 2 });
  });
});

describe('resumirComodatos', () => {
  it('soma por produto e conta os contratos', () => {
    const itens = montarComodatos(
      [
        { id: '1', id_produto: '36', id_contrato: '100', qtde_saida: '1', status_comodato: 'E' },
        { id: '2', id_produto: '36', id_contrato: '101', qtde_saida: '1', status_comodato: 'E' },
        { id: '3', id_produto: '36', id_contrato: '101', qtde_saida: '1', status_comodato: 'E' },
      ],
      contratos,
      clientes,
      produtos,
      almox,
    );
    expect(resumirComodatos(itens)).toEqual([
      { produtoId: 36, produto: 'ONU GPON X', quantidade: 3, contratos: 2 },
    ]);
  });
});
