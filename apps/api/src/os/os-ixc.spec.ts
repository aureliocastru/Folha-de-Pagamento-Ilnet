import {
  lerComodato,
  lerOs,
  montarBaixaDeComodato,
  montarComodatoNaOs,
  montarMaterialNaOs,
  osRecusaMaterial,
  produtoParaOs,
  type OsParaEscrever,
  type ProdutoParaOs,
} from './os-ixc';

/**
 * O que se escreve dentro da OS do IXC. O que este arquivo protege:
 *
 *  - cada corpo leva os obrigatórios da documentação, com o valor certo — o
 *    almoxarifado do técnico como origem, a OS, o contrato, a peça;
 *  - o que falta (contrato, unidade, classificação fiscal) recusa aqui, antes
 *    de ir ao IXC, e não lá, com a mensagem de lá;
 *  - patrimônio não sai como material, e quantidade zero não sai.
 */

const os: OsParaEscrever = {
  osId: 3788,
  contratoId: 2294,
  loginId: 51,
  filialId: 1,
  almoxId: 12,
  dia: '24/09/2026',
};

const onu: ProdutoParaOs = {
  id: 34,
  unidadeId: 1,
  unidadeSigla: 'UND',
  tipo: 'P',
  controlaEstoque: true,
  classificacaoFiscal: 7,
  valorUnitario: 189.9,
  descricao: 'ONU HUAWEI EG8145V5',
};

const conector: ProdutoParaOs = {
  id: 36,
  unidadeId: 2,
  unidadeSigla: 'UN',
  tipo: 'C',
  controlaEstoque: true,
  classificacaoFiscal: 7,
  valorUnitario: 1.25,
  descricao: 'CONECTOR SC/APC',
};

describe('lerOs', () => {
  it('lê a OS com o técnico, o contrato e o endereço juntos', () => {
    const lida = lerOs({
      id: '3788',
      protocolo: '2026092400123',
      status: 'ag',
      id_assunto: '4',
      id_cliente: '900',
      id_contrato_kit: '2294',
      id_login: '51',
      id_filial: '1',
      id_tecnico: '17',
      data_abertura: '2026-09-23 08:00:00',
      data_agenda: '2026-09-24 09:00:00',
      data_fechamento: '0000-00-00 00:00:00',
      mensagem: 'Trocar ONU queimada',
      endereco: 'Rua das Palmeiras',
      numero: '42',
      bairro: 'Centro',
      complemento: '',
      referencia: 'portão azul',
    });
    expect(lida).toEqual({
      id: 3788,
      protocolo: '2026092400123',
      status: 'AG',
      assuntoId: 4,
      clienteId: 900,
      contratoId: 2294,
      loginId: 51,
      filialId: 1,
      tecnicoId: 17,
      abertura: '2026-09-23 08:00:00',
      agenda: '2026-09-24 09:00:00',
      fechamento: null,
      mensagem: 'Trocar ONU queimada',
      endereco: 'Rua das Palmeiras, 42 — Centro — portão azul',
    });
  });

  it('o endereço que já vem montado não repete o bairro', () => {
    expect(
      lerOs({
        id: '92297',
        endereco: 'MA São Mateus do Maranhão 65470-000 Serraria - Rua da Serraria',
        numero: '169',
        bairro: 'Serraria',
        referencia: 'Casa do Mocinho da Van',
      })?.endereco,
    ).toBe('MA São Mateus do Maranhão 65470-000 Serraria - Rua da Serraria, 169 — Casa do Mocinho da Van');
  });

  it('linha sem id não é OS', () => {
    expect(lerOs({ status: 'A' })).toBeNull();
  });
});

describe('osRecusaMaterial', () => {
  const base = lerOs({ id: '1', status: 'F', data_fechamento: '2026-09-22 17:00:00' })!;

  it('OS aberta aceita', () => {
    expect(osRecusaMaterial({ ...base, status: 'EX' })).toBeNull();
  });

  it('finalizada há pouco ainda aceita — o técnico lança depois do atendimento fechar', () => {
    expect(osRecusaMaterial(base, new Date('2026-09-24T12:00:00-03:00'))).toBeNull();
  });

  it('finalizada há mais de 3 dias recusa', () => {
    expect(osRecusaMaterial(base, new Date('2026-09-26T18:00:00-03:00'))).toMatch(/mais de 3 dias/);
  });

  it('finalizada sem data recusa', () => {
    expect(osRecusaMaterial({ ...base, fechamento: null })).toMatch(/não diz quando/);
  });
});

describe('lerComodato', () => {
  it('lê a linha que a baixa vai receber, com a peça', () => {
    expect(
      lerComodato({
        id: '59195',
        id_produto: '34',
        id_patrimonio: '9',
        qtde_saida: '1.000000000',
        mac: 'AA:BB:CC:DD:EE:FF',
        numero_serie: 'HWTC1234',
        numero_patrimonial: 'SAFB0',
        data: '2025-03-10',
        status_comodato: 'e',
      }),
    ).toEqual({
      comodatoId: 59195,
      produtoId: 34,
      descricao: null,
      quantidade: 1,
      patrimonioId: 9,
      numeroPatrimonial: 'SAFB0',
      mac: 'AA:BB:CC:DD:EE:FF',
      numeroSerie: 'HWTC1234',
      desde: '2025-03-10',
      status: 'E',
    });
  });

  it('comodato de produto (sem peça) fica sem patrimônio', () => {
    expect(lerComodato({ id: '1', id_produto: '5', id_patrimonio: '0' })?.patrimonioId).toBeNull();
  });
});

describe('produtoParaOs', () => {
  const unidades = [{ id: 1, sigla: 'UND' }];
  const cadastro = {
    id: '34',
    descricao: 'ONU HUAWEI',
    unidade: '1',
    tipo: 'p',
    controla_estoque: 'S',
    id_class_fiscal: '7',
    preco_base: '189.90',
    ativo: 'S',
  };

  it('lê o que a escrita pede', () => {
    expect(produtoParaOs(cadastro, unidades)).toEqual({
      id: 34,
      unidadeId: 1,
      unidadeSigla: 'UND',
      tipo: 'P',
      controlaEstoque: true,
      classificacaoFiscal: 7,
      valorUnitario: 189.9,
      descricao: 'ONU HUAWEI',
    });
  });

  it('recusa sem unidade, sem classificação fiscal e inativo — o IXC recusaria lá', () => {
    expect(() => produtoParaOs({ ...cadastro, unidade: '9' }, unidades)).toThrow(/sem unidade/);
    expect(() => produtoParaOs({ ...cadastro, id_class_fiscal: '0' }, unidades)).toThrow(
      /classificação fiscal/,
    );
    expect(() => produtoParaOs({ ...cadastro, ativo: 'N' }, unidades)).toThrow(/inativo/);
    expect(() => produtoParaOs(undefined, unidades)).toThrow(/não foi achado/);
  });
});

describe('montarComodatoNaOs', () => {
  const peca = { patrimonioId: 9, numeroPatrimonial: 'SAFB0', mac: 'AA:BB', numeroSerie: 'HW1', situacao: '7' };

  it('igual à linha que o próprio IXC grava: tipo S (saída), e não o "C" da documentação', () => {
    // A linha 1016480 da OS 92279, lida na base em 24/09/2026.
    expect(montarComodatoNaOs(os, onu, peca)).toMatchObject({
      tipo: 'S',
      tipo_produto: 'P',
      garantia_oss: 'N',
      ultima_situacao_patrimonio: '7',
    });
  });

  it('a peça sai do almoxarifado do técnico e fica emprestada no contrato, dentro da OS', () => {
    const corpo = montarComodatoNaOs(os, onu, peca);
    expect(corpo).toMatchObject({
      id_oss_chamado: '3788',
      id_contrato: '2294',
      id_login: '51',
      id_patrimonio: '9',
      id_produto: '34',
      data: '24/09/2026',
      id_unidade: '1',
      id_almox: '12',
      filial_id: '1',
      qtde_saida: '1.00000',
      valor_unitario: '189.90',
      valor_total: '189.90',
      patrimonio: 'SAFB0',
      numero_patrimonial: 'SAFB0',
      mac: 'AA:BB',
      numero_serie: 'HW1',
      id_classificacao_tributaria: '7',
      tipo: 'S',
      estoque: 'S',
      unidade_sigla: 'UND',
      fator_conversao: '1.000000000',
      tipo_produto: 'P',
      status_comodato: 'E',
    });
  });

  it('OS sem login vai com o login vazio, não zero', () => {
    expect(montarComodatoNaOs({ ...os, loginId: 0 }, onu, peca).id_login).toBe('');
  });

  it('sem contrato não há onde pôr o comodato', () => {
    expect(() => montarComodatoNaOs({ ...os, contratoId: 0 }, onu, peca)).toThrow(/contrato/);
  });
});

describe('montarBaixaDeComodato', () => {
  it('manda a peça de volta ao almoxarifado dado, com os rótulos da tela do IXC', () => {
    expect(
      montarBaixaDeComodato({
        comodatoId: 59195,
        almoxId: 12,
        almoxNome: 'VAN CLEYSON',
        filialId: 1,
        filialNome: 'F1',
      }),
    ).toEqual({
      id: '59195',
      id_almox: '12',
      id_almox_label: 'VAN CLEYSON',
      id_filial_baixa: '1',
      id_filial_baixa_label: 'F1',
    });
  });

  it('sem a linha de comodato não baixa', () => {
    expect(() =>
      montarBaixaDeComodato({ comodatoId: 0, almoxId: 12, almoxNome: 'x', filialId: 1 }),
    ).toThrow(/comodato/);
  });
});

describe('montarMaterialNaOs', () => {
  it('o material sai do almoxarifado do técnico pela OS, com o valor da quantidade', () => {
    expect(montarMaterialNaOs(os, conector, 3)).toMatchObject({
      id_oss_chamado: '3788',
      id_patrimonio: '',
      id_produto: '36',
      id_almox: '12',
      qtde_saida: '3.00000',
      valor_unitario: '1.25',
      valor_total: '3.75',
      id_classificacao_tributaria: '7',
      tipo: 'S',
      estoque: 'S',
      unidade_sigla: 'UN',
      tipo_produto: 'C',
      garantia_oss: 'N',
    });
  });

  it('patrimônio não é material, e quantidade zero não sai', () => {
    expect(() => montarMaterialNaOs(os, onu, 1)).toThrow(/patrimônio/);
    expect(() => montarMaterialNaOs(os, conector, 0)).toThrow(/maior que zero/);
  });
});
