import { acertosDeConta, temCodigoDePagamento } from './conta-pelo-codigo';

const MODOBANK = 18;
const SICOOB = 5;
const LINHA = '65590000020094950000300046893004116410000533333';

const titulo = (campos: Record<string, unknown>) => ({
  id: '100',
  id_fornecedor: '151',
  id_contas: String(SICOOB),
  tipo_pagamento: 'Boleto',
  codigo_barras: LINHA,
  chave_pix: '',
  ...campos,
});

describe('temCodigoDePagamento', () => {
  it('boleto com a linha inteira (44, 47 ou 48 números, com pontos e espaços)', () => {
    expect(temCodigoDePagamento(titulo({}))).toBe(true);
    expect(temCodigoDePagamento(titulo({ codigo_barras: '8'.padEnd(48, '1') }))).toBe(true);
    expect(
      temCodigoDePagamento(
        titulo({ codigo_barras: '65590.00002 00949.500003 00046.893004 1 16410000533333' }),
      ),
    ).toBe(true);
  });

  it('boleto sem linha, ou com a linha pela metade, não conta', () => {
    expect(temCodigoDePagamento(titulo({ codigo_barras: '' }))).toBe(false);
    expect(temCodigoDePagamento(titulo({ codigo_barras: LINHA.slice(0, 30) }))).toBe(false);
  });

  it('Pix com a chave escrita', () => {
    expect(
      temCodigoDePagamento(
        titulo({ tipo_pagamento: 'Pix', codigo_barras: '', chave_pix: 'financeiro@exemplo.com' }),
      ),
    ).toBe(true);
    expect(temCodigoDePagamento(titulo({ tipo_pagamento: 'Pix', codigo_barras: '' }))).toBe(false);
  });

  it('dinheiro e outras formas de pagar não contam, mesmo com sobra de código', () => {
    expect(temCodigoDePagamento(titulo({ tipo_pagamento: 'Dinheiro' }))).toBe(false);
    expect(temCodigoDePagamento(titulo({ tipo_pagamento: '' }))).toBe(false);
  });
});

describe('acertosDeConta', () => {
  it('leva para o ModoBank o boleto com linha que está em outra conta', () => {
    expect(acertosDeConta([titulo({})], MODOBANK)).toEqual([
      { idFnApagar: 100, idFornecedor: 151, de: SICOOB, para: MODOBANK },
    ]);
  });

  it('leva também o Pix com chave', () => {
    const pix = titulo({ id: '101', tipo_pagamento: 'Pix', codigo_barras: '', chave_pix: 'a@b.co' });
    expect(acertosDeConta([pix], MODOBANK).map((a) => a.idFnApagar)).toEqual([101]);
  });

  it('não mexe no que já está no ModoBank, no que não tem código nem no que não tem conta', () => {
    const jaNoBanco = titulo({ id: '102', id_contas: String(MODOBANK) });
    const semCodigo = titulo({ id: '103', codigo_barras: '' });
    const semConta = titulo({ id: '104', id_contas: '0' });
    const emMaos = titulo({ id: '105', tipo_pagamento: 'Dinheiro', id_contas: '23' });
    expect(acertosDeConta([jaNoBanco, semCodigo, semConta, emMaos], MODOBANK)).toEqual([]);
  });
});
