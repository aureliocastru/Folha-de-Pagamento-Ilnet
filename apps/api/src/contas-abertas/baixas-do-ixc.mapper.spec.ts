import {
  colunaDoTitulo,
  mapBaixa,
  ultimaBaixaPorTitulo,
  type BaixaNoIxc,
} from './baixas-do-ixc.mapper';

/**
 * A linha de baixa existe aqui para responder uma pergunta só: em que dia o
 * dinheiro saiu. Errar isso não quebra tela nenhuma — faz a tela acusar atraso
 * em pagamento feito no prazo, que foi o que aconteceu. Por isso os casos cobrem
 * a linha que não é baixa de conta a pagar, a que não tem data legível, e o
 * título pago em duas vezes.
 */

/** Uma linha crua de baixa, como o IXC devolve: tudo string. */
function baixa(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1724287',
    id_pagar: '36949',
    data: '15/08/2026',
    valor: '50.000,00',
    documento: '36949',
    historico: 'Pag. Fulano de Tal - doc.: 36949',
    ...over,
  };
}

describe('a linha de baixa do IXC', () => {
  it('lê o título, o dia e o número da linha', () => {
    expect(mapBaixa(baixa())).toEqual({
      id: 1724287,
      idFnApagar: 36949,
      data: new Date(Date.UTC(2026, 7, 15)),
      campo: 'data',
      contaPagamento: null,
    });
  });

  it('lê a conta que pagou, e não a do razão', () => {
    // `id_conta` na movimentação é o plano de contas (12833); o banco é `id_contas`.
    expect(mapBaixa(baixa({ id_contas: '18', id_conta: '12833' }))?.contaPagamento).toBe(18);
  });

  it('reconhece os outros nomes da coluna do título', () => {
    for (const campo of ['id_apagar', 'id_fn_apagar', 'id_contas_apagar']) {
      const linha = baixa({ id_pagar: '', [campo]: '36949' });
      expect(colunaDoTitulo(linha)).toBe(campo);
      expect(mapBaixa(linha)?.idFnApagar).toBe(36949);
    }
  });

  /*
   * A tabela de movimentação financeira guarda muito mais que baixa de conta a
   * pagar. Linha sem título não é ignorada por capricho: colada num pagamento
   * qualquer, ela mudaria o dia de um pagamento de verdade.
   */
  it('descarta o lançamento que não é baixa de conta a pagar', () => {
    expect(mapBaixa(baixa({ id_pagar: '', id_entrada: '9' }))).toBeNull();
    expect(colunaDoTitulo(baixa({ id_pagar: '' }))).toBeNull();
  });

  it('descarta a linha sem dia legível', () => {
    expect(mapBaixa(baixa({ data: '' }))).toBeNull();
    expect(mapBaixa(baixa({ data: '0000-00-00' }))).toBeNull();
  });

  it('aceita o dia em ISO, que é como parte das telas do IXC devolve', () => {
    expect(mapBaixa(baixa({ data: '2026-08-15' }))?.data).toEqual(
      new Date(Date.UTC(2026, 7, 15)),
    );
  });

  it('procura a data nos outros nomes conhecidos', () => {
    const linha = baixa({ data: '', data_pagamento: '15/08/2026' });
    expect(mapBaixa(linha)?.campo).toBe('data_pagamento');
  });
});

describe('título pago em mais de uma vez', () => {
  const linhas: BaixaNoIxc[] = [
    { id: 1, idFnApagar: 36949, data: new Date(Date.UTC(2026, 6, 30)), campo: 'data' },
    { id: 9, idFnApagar: 36949, data: new Date(Date.UTC(2026, 7, 15)), campo: 'data' },
    { id: 4, idFnApagar: 12, data: new Date(Date.UTC(2026, 7, 3)), campo: 'data' },
  ];

  /*
   * Quando o título ficou quitado é a última baixa. A primeira responde outra
   * pergunta — quando começou a ser pago —, e não é a desta tela.
   */
  it('vale a baixa mais recente', () => {
    const porTitulo = ultimaBaixaPorTitulo(linhas);
    expect(porTitulo.get(36949)?.id).toBe(9);
    expect(porTitulo.get(12)?.id).toBe(4);
  });

  it('no mesmo dia, decide a linha lançada depois', () => {
    const mesmoDia = new Date(Date.UTC(2026, 7, 15));
    const porTitulo = ultimaBaixaPorTitulo([
      { id: 7, idFnApagar: 5, data: mesmoDia, campo: 'data' },
      { id: 8, idFnApagar: 5, data: mesmoDia, campo: 'data' },
    ]);
    expect(porTitulo.get(5)?.id).toBe(8);
  });
});
