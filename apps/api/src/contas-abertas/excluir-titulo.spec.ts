import { marcaDeBaixa } from './pagamentos.service';

/**
 * A trava que faltou num acerto da rua de R$ 300,00.
 *
 * O título tinha sido criado, baixado contra o caixa e apagado em seguida.
 * Apagar `fn_apagar` não desfaz o movimento em `fn_movim_finan`: sobrou uma
 * saída de trezentos reais no caixa sem nada atrás dela, e nem o IXC nem este
 * sistema tinham mais o registro do que era.
 *
 * A trava de então perguntava "está quitado?" — status "P", data de pagamento
 * preenchida, ou saldo zerado. A pergunta certa é "houve baixa?", que é o que
 * apagar destrói. O que este arquivo protege:
 *
 *  - o status desta base é "F", e não o "P" da documentação;
 *  - a data da baixa mora em colunas diferentes conforme a instalação;
 *  - baixa parcial também tirou dinheiro da gaveta;
 *  - título realmente em aberto continua podendo ser apagado — senão o
 *    lançamento errado nunca mais sai de lá.
 */

describe('marcaDeBaixa', () => {
  it('reconhece o "F" desta base, que a trava antiga deixava passar', () => {
    expect(marcaDeBaixa({ status: 'F', valor: '300,00' })).toContain('F');
  });

  it('reconhece o "P" da documentação', () => {
    expect(marcaDeBaixa({ status: 'P' })).toContain('P');
  });

  it('reconhece a baixa pela coluna da data, qualquer que seja ela', () => {
    expect(marcaDeBaixa({ status: 'A', data_pagamento: '2026-08-26' })).toBe(
      'a coluna data_pagamento',
    );
    expect(marcaDeBaixa({ status: 'A', data_baixa: '26/08/2026' })).toBe(
      'a coluna data_baixa',
    );
    expect(marcaDeBaixa({ status: 'A', dt_baixa: '2026-08-26' })).toBe(
      'a coluna dt_baixa',
    );
  });

  it('reconhece a baixa parcial: sobrou saldo, mas dinheiro saiu', () => {
    const marca = marcaDeBaixa({
      status: 'A',
      valor: '300,00',
      valor_total_pago: '100,00',
      valor_aberto: '200,00',
    });
    expect(marca).toContain('100.00');
  });

  it('deixa passar o título que nunca teve baixa', () => {
    expect(
      marcaDeBaixa({
        status: 'A',
        valor: '300,00',
        valor_aberto: '300,00',
        data_pagamento: '',
        valor_total_pago: '0,00',
      }),
    ).toBeNull();
  });

  it('não confunde data vazia, zero ou "0000-00-00" com baixa', () => {
    // O IXC devolve data zerada em vez de nula, e a lista de campos de baixa
    // aprendeu isso antes — aqui é só a garantia de que continua valendo.
    expect(
      marcaDeBaixa({ status: 'A', data_pagamento: '0000-00-00', valor: '10' }),
    ).toBeNull();
    expect(marcaDeBaixa({ status: 'A', data_baixa: '0', valor: '10' })).toBeNull();
  });

  it('o caso do acerto de R$ 300: baixado com status F e sem data', () => {
    // Como o título estava quando foi apagado — a trava antiga via "não pago"
    // porque o status não era "P", não havia data e o saldo não estava zerado.
    const titulo = {
      status: 'F',
      valor: '300,00',
      valor_aberto: '300,00',
      data_pagamento: '',
    };
    expect(marcaDeBaixa(titulo)).not.toBeNull();
  });
});
