import { agruparParcelas, type TituloParaAgrupar } from './parcelas.service';

/**
 * O IXC não guarda o vínculo entre as parcelas de uma compra: são títulos
 * soltos. O que este arquivo protege é o palpite que os junta de novo:
 *
 *  - mesmo fornecedor e mesmo valor viram uma sequência, e cada título sabe
 *    que lugar ocupa nela;
 *  - a contagem de pagas atravessa o tempo — parcela quitada no ano passado
 *    conta igual, porque a leitura é por fornecedor e não por período;
 *  - título sozinho não vira "parcela 1 de 1";
 *  - fornecedores diferentes com o mesmo valor não se misturam;
 *  - a ordem é a dos vencimentos, e não a da chegada do IXC.
 */

function titulo(
  partes: Partial<TituloParaAgrupar> & { idFnApagar: number },
): TituloParaAgrupar {
  return {
    idFornecedor: 1,
    valor: 10000,
    vencimento: null,
    paga: false,
    ...partes,
  };
}

/** "2026-08-04" na meia-noite UTC, como o resto do módulo trata datas. */
function dia(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

describe('agruparParcelas', () => {
  it('numera as parcelas pelo vencimento e conta pagas e a pagar', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 3, vencimento: dia('2026-10-10') }),
      titulo({ idFnApagar: 1, vencimento: dia('2026-08-10'), paga: true }),
      titulo({ idFnApagar: 2, vencimento: dia('2026-09-10'), paga: true }),
      titulo({ idFnApagar: 4, vencimento: dia('2026-11-10') }),
    ]);

    expect(grupos['1']).toMatchObject({ posicao: 1, total: 4, pagas: 2, faltam: 2 });
    expect(grupos['2'].posicao).toBe(2);
    expect(grupos['3'].posicao).toBe(3);
    expect(grupos['4']).toMatchObject({ posicao: 4, pagas: 2, faltam: 2 });
  });

  it('conta a parcela paga há muito tempo, fora de qualquer janela da tela', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, vencimento: dia('2024-01-10'), paga: true }),
      titulo({ idFnApagar: 2, vencimento: dia('2025-01-10'), paga: true }),
      titulo({ idFnApagar: 3, vencimento: dia('2026-01-10') }),
    ]);

    expect(grupos['3']).toMatchObject({ posicao: 3, total: 3, pagas: 2, faltam: 1 });
  });

  it('não inventa parcela para a compra à vista', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, valor: 50000, vencimento: dia('2026-08-10') }),
    ]);

    expect(grupos).toEqual({});
  });

  it('não junta fornecedores diferentes que pagam o mesmo valor', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, idFornecedor: 10, vencimento: dia('2026-08-10') }),
      titulo({ idFnApagar: 2, idFornecedor: 20, vencimento: dia('2026-09-10') }),
    ]);

    expect(grupos).toEqual({});
  });

  it('não junta valores diferentes do mesmo fornecedor', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, valor: 10000, vencimento: dia('2026-08-10') }),
      titulo({ idFnApagar: 2, valor: 7500, vencimento: dia('2026-09-10') }),
      titulo({ idFnApagar: 3, valor: 7500, vencimento: dia('2026-10-10') }),
    ]);

    expect(grupos['1']).toBeUndefined();
    expect(grupos['2']).toMatchObject({ posicao: 1, total: 2 });
    expect(grupos['3']).toMatchObject({ posicao: 2, total: 2 });
  });

  it('trata o centavo do float como o mesmo dinheiro', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, valor: 1000.1, vencimento: dia('2026-08-10') }),
      titulo({ idFnApagar: 2, valor: 1000.0999999, vencimento: dia('2026-09-10') }),
    ]);

    expect(grupos['1']).toMatchObject({ total: 2 });
  });

  it('guarda o primeiro e o último vencimento, para a tela poder mostrar de quando até quando', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 2, vencimento: dia('2026-09-10') }),
      titulo({ idFnApagar: 1, vencimento: dia('2026-08-10') }),
    ]);

    expect(grupos['1'].primeiroVencimento).toEqual(dia('2026-08-10'));
    expect(grupos['1'].ultimoVencimento).toEqual(dia('2026-09-10'));
  });

  it('joga para o fim o que não tem vencimento, sem perder a contagem', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 9, vencimento: null }),
      titulo({ idFnApagar: 1, vencimento: dia('2026-08-10'), paga: true }),
    ]);

    expect(grupos['1'].posicao).toBe(1);
    expect(grupos['9']).toMatchObject({ posicao: 2, total: 2, pagas: 1, faltam: 1 });
  });
});
