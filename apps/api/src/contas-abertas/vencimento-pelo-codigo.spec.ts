import { acertosDeVencimento, lerBoletoBancario } from './vencimento-pelo-codigo';

const HOJE = new Date(Date.UTC(2026, 10, 19));
const UM_DIA = 24 * 60 * 60 * 1000;

/** Um código de barras de 44 que vence no dia `iso` e vale `valor`. */
function barras(iso: string, valor: number, livre = '1234567890123456789012345'): string {
  const dias = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(2025, 1, 22)) / UM_DIA);
  const fator = String(1000 + dias);
  const centavos = String(Math.round(valor * 100)).padStart(10, '0');
  return `2379` + `1` + fator + centavos + livre;
}

/** O mesmo boleto como linha digitável de 47 (os dígitos dos blocos não importam aqui). */
function linha(codigo: string): string {
  const livre = codigo.slice(19);
  return (
    codigo.slice(0, 4) + livre.slice(0, 5) + '0' + livre.slice(5, 15) + '0' +
    livre.slice(15, 25) + '0' + codigo[4] + codigo.slice(5, 19)
  );
}

const titulo = (id: number, vencimento: string, valor: string, codigo: string) => ({
  id: String(id),
  id_fornecedor: '7',
  data_vencimento: vencimento,
  valor,
  codigo_barras: codigo,
});

describe('lerBoletoBancario', () => {
  it('lê o dia e o valor do código de 44 e da linha de 47', () => {
    const c = barras('2026-11-20', 1846.03);
    for (const codigo of [c, linha(c)]) {
      const b = lerBoletoBancario(codigo, HOJE);
      expect(b?.valor).toBe(1846.03);
      expect(b?.vencimento?.toISOString().slice(0, 10)).toBe('2026-11-20');
    }
  });

  it('não lê conta de consumo, que não tem o dia escrito', () => {
    expect(lerBoletoBancario('8'.padEnd(48, '1'), HOJE)).toBeNull();
  });
});

describe('acertosDeVencimento', () => {
  it('leva o boleto que vence no feriado para o próximo dia útil', () => {
    // 20/11/2026 é Consciência Negra (sexta): paga-se na segunda, 23.
    const acertos = acertosDeVencimento(
      [titulo(38200, '2026-11-20', '1846.03', barras('2026-11-20', 1846.03))],
      HOJE,
    );
    expect(acertos).toEqual([
      {
        idFnApagar: 38200,
        idFornecedor: 7,
        de: '2026-11-20',
        para: '2026-11-23',
        doCodigo: '2026-11-20',
        porque: 'feriado',
      },
    ]);
  });

  it('leva o do sábado para a segunda', () => {
    const [a] = acertosDeVencimento(
      [titulo(1, '2026-11-28', '50.00', barras('2026-11-28', 50))],
      HOJE,
    );
    expect(a).toMatchObject({ para: '2026-11-30', porque: 'sábado' });
  });

  it('acerta pelo dia do código quando o IXC tem outro dia', () => {
    const [a] = acertosDeVencimento(
      [titulo(2, '2026-12-10', '300.00', linha(barras('2026-11-25', 300)))],
      HOJE,
    );
    expect(a).toMatchObject({ de: '2026-12-10', para: '2026-11-25', porque: null });
  });

  it('não mexe na conta que já está no dia certo', () => {
    expect(
      acertosDeVencimento([titulo(3, '2026-11-23', '10.00', barras('2026-11-20', 10))], HOJE),
    ).toEqual([]);
  });

  it('não mexe quando o valor do código não é o da conta', () => {
    expect(
      acertosDeVencimento([titulo(4, '2026-11-20', '99.00', barras('2026-11-20', 10))], HOJE),
    ).toEqual([]);
  });

  it('não mexe no código repetido em mais de uma conta (parcelas que herdaram o da primeira)', () => {
    const c = barras('2026-11-20', 10);
    expect(
      acertosDeVencimento(
        [titulo(5, '2026-11-20', '10.00', c), titulo(6, '2026-12-20', '10.00', c)],
        HOJE,
      ),
    ).toEqual([]);
  });

  it('ignora conta sem código', () => {
    expect(acertosDeVencimento([titulo(7, '2026-11-20', '10.00', '')], HOJE)).toEqual([]);
  });
});
