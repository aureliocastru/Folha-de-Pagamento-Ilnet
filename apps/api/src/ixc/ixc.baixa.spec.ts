import {
  buildBaixaContaPagarPayload,
  descontoQueOIxcAceita,
  descontosQueCabem,
  codigoTipoPagamentoBaixa,
  montarHistoricoBaixa,
  semAcento,
} from './ixc.financeiro';

/**
 * Uma baixa feita daqui tem de chegar ao IXC igual à que se faria na tela dele.
 * "Igual" não é figura de linguagem: é o mesmo corpo, campo por campo, como a
 * coleção oficial documenta em Sistema > Pagar > Botões > Baixa manual (Pagar).
 *
 * O que motivou este arquivo foi um pagamento que constava pago no título e não
 * aparecia para conciliar com o extrato. A causa estava num campo só — ver
 * `codigoTipoPagamentoBaixa`.
 */

describe('codigoTipoPagamentoBaixa', () => {
  it('PIX vira "X" — e não dinheiro, que era o que saía antes', () => {
    expect(codigoTipoPagamentoBaixa('Pix', false)).toBe('X');
    expect(codigoTipoPagamentoBaixa('PIX', false)).toBe('X');
  });

  it('dinheiro vira "D"', () => {
    expect(codigoTipoPagamentoBaixa('Dinheiro', true)).toBe('D');
    expect(codigoTipoPagamentoBaixa('Espécie', true)).toBe('D');
  });

  it('transferência, TED, boleto e cartão viram "T"', () => {
    for (const rotulo of ['Transferência', 'TED', 'DOC', 'Boleto', 'Cartão']) {
      expect(codigoTipoPagamentoBaixa(rotulo, false)).toBe('T');
    }
  });

  it('sem rótulo, quem decide é de onde o dinheiro saiu', () => {
    // Do caixa é dinheiro; de conta bancária é movimento de banco, e é isso
    // que o põe na conciliação.
    expect(codigoTipoPagamentoBaixa(null, true)).toBe('D');
    expect(codigoTipoPagamentoBaixa('', false)).toBe('T');
    expect(codigoTipoPagamentoBaixa('qualquer coisa', false)).toBe('T');
  });
});

describe('montarHistoricoBaixa', () => {
  it('escreve como o IXC escreve: "Pag. <quem> - doc.: <documento>"', () => {
    expect(
      montarHistoricoBaixa({
        beneficiario: 'Gilvan Pereira da Costa',
        documento: '36716',
      }),
    ).toBe('Pag. Gilvan Pereira da Costa - doc.: 36716');
  });

  it('sem documento, fica só quem recebeu', () => {
    expect(montarHistoricoBaixa({ beneficiario: 'Gilvan' })).toBe('Pag. Gilvan');
  });

  it('sem nome nenhum, não inventa: só o documento', () => {
    expect(montarHistoricoBaixa({ documento: '99' })).toBe('Pag. - doc.: 99');
  });

  it('sai sem acento — o IXC grava o nosso UTF-8 como Latin-1', () => {
    // "José" virava "JosÃ©" na tela do IXC, e o travessão virava "?".
    expect(
      montarHistoricoBaixa({ beneficiario: 'José Antônio — Ltda', documento: '1' }),
    ).toBe('Pag. Jose Antonio Ltda - doc.: 1');
  });
});

describe('semAcento', () => {
  it('tira acento e troca o que o Latin-1 não escreve', () => {
    expect(semAcento('lançamento')).toBe('lancamento');
    expect(semAcento('a — b')).toBe('a b');
  });
});

describe('buildBaixaContaPagarPayload', () => {
  const base = {
    idFnApagar: 37019,
    contaPagamentoId: 18,
    contaPagamentoNome: 'Conta ModoBank PIX',
    contaPlanejamentoId: 12833,
    filialId: 1,
    filialNome: 'Filial (Alterar)',
    valor: 167,
    data: new Date(Date.UTC(2026, 7, 8)),
    documento: '37019',
    tipoPagamento: 'X',
    historico: 'Pag. Gilvan Pereira da Costa - doc.: 37019',
  };

  it('leva os mesmos campos que a tela do IXC manda', () => {
    // A lista sai do exemplo oficial da coleção. Campo a menos aqui é campo
    // que a baixa feita daqui deixa de preencher lá.
    const esperados = [
      'id_pagar',
      'id_pagar_label',
      'filial',
      'filial_label',
      'filial_id',
      'conta_',
      'conta__label',
      'id_conta',
      'id_conta_class_finan_a',
      'id_conta_class_finan_a_label',
      'tipo_pagamento',
      'chave_pix',
      'cheque_banco',
      'cheque_numero',
      'cheque_nome',
      'cheque_predatado',
      'data',
      'documento',
      'pdesconto',
      'vdesconto',
      'pacrescimo',
      'vacrescimo',
      'valor_parcela',
      'debito',
      'valor_total_pago',
      'historico',
      'tipo_p',
      'tipo_lanc',
      'id_operador',
    ];
    const payload = buildBaixaContaPagarPayload(base);
    for (const campo of esperados) {
      expect(Object.keys(payload)).toContain(campo);
    }
  });

  it('manda o rótulo da conta junto do id, como todo campo de seleção de lá', () => {
    const payload = buildBaixaContaPagarPayload(base);
    expect(payload.conta_).toBe(18);
    expect(payload.conta__label).toBe('Conta ModoBank PIX');
  });

  it('a forma de pagamento vai como veio, sem cair no dinheiro', () => {
    expect(buildBaixaContaPagarPayload(base).tipo_pagamento).toBe('X');
  });

  it('sem rótulo de conta, o campo vai vazio em vez de sumir', () => {
    const { contaPagamentoNome: _, filialNome: __, ...semNomes } = base;
    const payload = buildBaixaContaPagarPayload(semNomes);
    expect(payload.conta__label).toBe('');
    expect(payload.filial_label).toBe('');
  });

  it('valores com vírgula decimal, que é o que a baixa aceita', () => {
    const payload = buildBaixaContaPagarPayload({ ...base, valor: 1234.5 });
    expect(payload.valor_parcela).toBe('1234,50');
    expect(payload.debito).toBe('1234,50');
    expect(payload.valor_total_pago).toBe('1234,50');
  });

  it('a data vai no dia informado, não no dia do registro', () => {
    expect(buildBaixaContaPagarPayload(base).data).toBe('08/08/2026');
  });

  /*
   * Desconto de antecipação. O que ele muda é só um número: o que saiu do
   * caixa. O título continua devendo o que devia, e é a diferença entre os
   * dois que o IXC entende como desconto.
   */
  it('o desconto separa o que se devia do que se pagou', () => {
    const payload = buildBaixaContaPagarPayload({
      ...base,
      valor: 8217.95,
      desconto: 200,
    });

    expect(payload.vdesconto).toBe('200,00');
    // O título devia 8.217,95...
    expect(payload.valor_parcela).toBe('8217,95');
    expect(payload.debito).toBe('8217,95');
    // ...e do banco saíram 8.017,95, que é a linha que a conciliação procura
    // no extrato.
    expect(payload.valor_total_pago).toBe('8017,95');
  });

  it('sem desconto, os três valores continuam iguais e o campo vai vazio', () => {
    const payload = buildBaixaContaPagarPayload(base);
    expect(payload.vdesconto).toBe('');
    expect(payload.valor_total_pago).toBe('167,00');
  });

  it('o desconto vai nos dois campos: em reais e no percentual que o IXC guarda', () => {
    // Lá o campo gravado é o percentual, com quatro casas — mandar só o valor
    // deixava o IXC derivar sozinho, e é dessa derivação que vinham as
    // recusas por casa decimal.
    const payload = buildBaixaContaPagarPayload({
      ...base,
      valor: 8217.95,
      desconto: 200,
    });
    expect(payload.vdesconto).toBe('200,00');
    expect(payload.pdesconto).toBe('2.4337');
  });

  it('sem desconto, o percentual também vai vazio', () => {
    expect(buildBaixaContaPagarPayload(base).pdesconto).toBe('');
  });
});

/**
 * O desconto guardado como percentual de quatro casas.
 *
 * É o próprio IXC que diz a regra, ao recusar: "o campo Desconto% aceita até 4
 * casas decimais. Portanto, descontos no valor de R$ 0,01 não serão aceitos
 * para títulos acima de R$ 10.000,00". Quanto maior o título, mais grosso o
 * passo do desconto — e é isso que estas contas protegem.
 */
describe('descontoQueOIxcAceita', () => {
  it('o desconto negociado de verdade cabe sem sobra', () => {
    const r = descontoQueOIxcAceita(8217.95, 200);
    expect(r).toMatchObject({ percentual: 2.4337, aplicado: 200, cabe: true });
  });

  it('um centavo cabe em dez mil, e não cabe em trinta e um mil', () => {
    // A fronteira que a mensagem do IXC nomeia: 0,0001% de R$ 10.000,00 é
    // exatamente um centavo; de qualquer título maior, é menos que isso.
    expect(descontoQueOIxcAceita(10000, 0.01).cabe).toBe(true);
    expect(descontoQueOIxcAceita(31000, 0.01)).toMatchObject({
      aplicado: 0,
      cabe: false,
    });
  });

  it('em título grande o desconto anda de passo em passo', () => {
    // Em R$ 100.000,00 o menor desconto expressável é R$ 0,10.
    expect(descontoQueOIxcAceita(100000, 0.05).cabe).toBe(false);
    expect(descontoQueOIxcAceita(100000, 0.1).cabe).toBe(true);
  });

  it('sem desconto não há o que conferir', () => {
    expect(descontoQueOIxcAceita(1000, 0).cabe).toBe(true);
  });
});

describe('descontosQueCabem', () => {
  it('diz os dois vizinhos que servem, para a recusa poder ensinar', () => {
    expect(descontosQueCabem(31000, 0.01)).toEqual({ abaixo: 0, acima: 0.03 });
    expect(descontosQueCabem(20000, 0.01)).toEqual({ abaixo: 0, acima: 0.02 });
  });

  it('em título pequeno os vizinhos ficam colados no pedido', () => {
    expect(descontosQueCabem(8217.95, 200)).toEqual({
      abaixo: 199.99,
      acima: 200,
    });
  });
});
