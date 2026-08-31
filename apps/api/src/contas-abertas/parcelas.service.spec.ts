import { marcacaoDeParcela } from './contas-abertas.mapper';
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
 *
 * E protege o que vem antes do palpite: quando a parcela está escrita no
 * título — "29/36" no número da nota, "(3/6)" na observação —, é ela que vale,
 * porque o palpite errava justamente aí (parcela de financiamento muda de
 * valor no meio, e a dedução partia a compra em pedaços).
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

  it('a parcela escrita no título ganha da dedução por valor', () => {
    // O financiamento da Hilux: o IXC tem quatro títulos, e o juro fez dois
    // deles saírem por outro valor. A dedução via "duas compras de dois";
    // o número da nota diz que são a 29, a 30, a 31 e a 32 de 36.
    const grupos = agruparParcelas([
      titulo({
        idFnApagar: 1,
        valor: 8217.95,
        vencimento: dia('2027-01-29'),
        marcacao: { posicao: 29, total: 36, fonte: 'nota' },
      }),
      titulo({
        idFnApagar: 2,
        valor: 8217.95,
        vencimento: dia('2027-02-28'),
        marcacao: { posicao: 30, total: 36, fonte: 'nota' },
      }),
      titulo({
        idFnApagar: 3,
        valor: 8301.4,
        vencimento: dia('2027-03-29'),
        marcacao: { posicao: 31, total: 36, fonte: 'nota' },
      }),
      titulo({
        idFnApagar: 4,
        valor: 8301.4,
        vencimento: dia('2027-04-29'),
        marcacao: { posicao: 32, total: 36, fonte: 'nota' },
      }),
    ]);

    expect(grupos['1']).toMatchObject({
      posicao: 29,
      total: 36,
      pagas: 28,
      faltam: 8,
      fonte: 'nota',
    });
    expect(grupos['3']).toMatchObject({ posicao: 31, total: 36 });
  });

  it('conta a sequência inteira mesmo com um título só, quando ele está marcado', () => {
    const grupos = agruparParcelas([
      titulo({
        idFnApagar: 7,
        vencimento: dia('2027-04-29'),
        marcacao: { posicao: 29, total: 36, fonte: 'nota' },
      }),
    ]);

    // O contrário da compra à vista: aqui o próprio título diz que faz parte
    // de uma sequência de 36, e as 28 anteriores já passaram.
    expect(grupos['7']).toMatchObject({ posicao: 29, total: 36, pagas: 28, faltam: 8 });
  });

  it('não conta como pagas menos do que o IXC mostra pago', () => {
    const grupos = agruparParcelas([
      titulo({
        idFnApagar: 1,
        vencimento: dia('2026-01-10'),
        paga: true,
        marcacao: { posicao: 1, total: 6, fonte: 'observacao' },
      }),
      titulo({
        idFnApagar: 2,
        vencimento: dia('2026-02-10'),
        paga: true,
        marcacao: { posicao: 2, total: 6, fonte: 'observacao' },
      }),
      titulo({
        idFnApagar: 3,
        vencimento: dia('2026-03-10'),
        marcacao: { posicao: 3, total: 6, fonte: 'observacao' },
      }),
    ]);

    expect(grupos['3']).toMatchObject({ pagas: 2, faltam: 4, fonte: 'observacao' });
  });

  it('separa dois parcelamentos do mesmo fornecedor pelo total declarado', () => {
    const grupos = agruparParcelas([
      titulo({
        idFnApagar: 1,
        vencimento: dia('2026-08-10'),
        marcacao: { posicao: 2, total: 36, fonte: 'nota' },
      }),
      titulo({
        idFnApagar: 2,
        vencimento: dia('2026-08-20'),
        marcacao: { posicao: 5, total: 12, fonte: 'nota' },
      }),
    ]);

    expect(grupos['1']).toMatchObject({ total: 36 });
    expect(grupos['2']).toMatchObject({ total: 12 });
  });

  it('a dedução continua valendo para o título sem marca nenhuma', () => {
    const grupos = agruparParcelas([
      titulo({ idFnApagar: 1, vencimento: dia('2026-08-10'), paga: true }),
      titulo({ idFnApagar: 2, vencimento: dia('2026-09-10') }),
    ]);

    expect(grupos['1']).toMatchObject({ posicao: 1, total: 2, fonte: 'deducao' });
  });
});

/**
 * O que conta como parcela escrita — e o que não conta.
 *
 * O campo "Número da nota" do IXC guarda número de nota fiscal na maioria dos
 * títulos: ler qualquer coisa com barra como parcela transformaria "nota
 * 123/2024" na parcela 123 de 2024.
 */
describe('marcacaoDeParcela', () => {
  it('lê a parcela do número da nota', () => {
    expect(marcacaoDeParcela({ numero_nota: '29/36' })).toEqual({
      posicao: 29,
      total: 36,
      fonte: 'nota',
    });
  });

  it('lê a marca que esta casa escreve na observação', () => {
    expect(marcacaoDeParcela({ obs: 'Cabo UTP (3/6)' })).toEqual({
      posicao: 3,
      total: 6,
      fonte: 'observacao',
    });
  });

  it('prefere o número da nota à observação', () => {
    expect(
      marcacaoDeParcela({ numero_nota: '29/36', obs: 'Parcela Hilux (1/2)' }),
    ).toMatchObject({ posicao: 29, fonte: 'nota' });
  });

  it('não lê nota fiscal com série como parcela', () => {
    expect(marcacaoDeParcela({ numero_nota: '123/2024' })).toBeNull();
    expect(marcacaoDeParcela({ numero_nota: '45678' })).toBeNull();
  });

  it('não lê número solto no meio da observação', () => {
    expect(marcacaoDeParcela({ obs: 'Cabo 2/4 polegadas' })).toBeNull();
  });

  it('recusa a numeração impossível', () => {
    expect(marcacaoDeParcela({ numero_nota: '7/6' })).toBeNull();
    expect(marcacaoDeParcela({ numero_nota: '0/6' })).toBeNull();
    expect(marcacaoDeParcela({ numero_nota: '1/1' })).toBeNull();
  });
});
