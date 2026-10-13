import {
  gerarComprovantePdf,
  type DadosDoComprovante,
  type ItemDoComprovante,
} from './comprovante-transferencia.pdf';

/**
 * O comprovante é desenhado à mão, e o `tsc` não vê nada disso: o que se prova
 * aqui é que ele sai — com uma ONU, com cem, sem observação, com recusados e
 * com a transferência parada no meio. Empresa e números inventados.
 */

function onu(n: number): ItemDoComprovante {
  const fim = String(n).padStart(4, '0');
  return {
    produtoId: 12,
    descricao: 'ONU GPON EXEMPLO F601',
    quantidade: 1,
    unidade: 'UND',
    peca: {
      patrimonioId: 900 + n,
      numeroPatrimonial: `0${fim}`,
      mac: `AA:BB:CC:00:${fim.slice(0, 2)}:${fim.slice(2)}`,
      numeroSerie: `EXMP${fim}A1B2C3`,
    },
  };
}

const CABO: ItemDoComprovante = {
  produtoId: 36,
  descricao: 'CABO DROP 1 FIBRA',
  quantidade: 1250.5,
  unidade: 'MT',
  peca: null,
};

function dados(extra: Partial<DadosDoComprovante> = {}): DadosDoComprovante {
  return {
    empresaNome: 'EMPRESA EXEMPLO DE TELECOMUNICAÇÕES LTDA',
    empresaCnpj: '11.222.333/0001-44',
    transferenciaId: 2931,
    de: 'ALMOXARIFADO PRINCIPAL',
    para: 'VAN DA EQUIPE 2',
    por: 'Fulano de Tal',
    feitaEm: new Date('2026-10-13T17:32:00.000Z'),
    data: '2026-10-13',
    observacao: 'kit da van da equipe 2',
    enviados: [onu(1), onu(2), CABO],
    recusados: [],
    parouNoMeio: null,
    ...extra,
  };
}

/** O cabeçalho de todo PDF, e a marca de fim de arquivo. */
function pareceUmPdf(buffer: Buffer): boolean {
  return (
    buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buffer.subarray(-1024).toString('latin1').includes('%%EOF')
  );
}

/** Quantas páginas — `/Type /Page`, e não `/Type /Pages`, que é a árvore. */
function contarPaginas(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('gerarComprovantePdf', () => {
  it('sai numa página com equipamento e material', async () => {
    const pdf = await gerarComprovantePdf(dados());
    expect(pareceUmPdf(pdf)).toBe(true);
    expect(contarPaginas(pdf)).toBe(1);
  });

  it('cem ONUs passam de página sem abrir folha em branco', async () => {
    const pdf = await gerarComprovantePdf(
      dados({ enviados: Array.from({ length: 100 }, (_, n) => onu(n + 1)) }),
    );
    expect(pareceUmPdf(pdf)).toBe(true);
    // ~30 linhas por folha: 100 ONUs são 4 folhas, nunca 8.
    expect(contarPaginas(pdf)).toBeGreaterThanOrEqual(3);
    expect(contarPaginas(pdf)).toBeLessThanOrEqual(5);
  });

  it('sai com recusados, retroativa, parada no meio e sem observação nem CNPJ', async () => {
    const pdf = await gerarComprovantePdf(
      dados({
        empresaCnpj: null,
        observacao: null,
        data: '2026-10-10',
        enviados: [onu(1)],
        recusados: [
          { ...onu(2), talvezTenhaIdo: false },
          { ...CABO, talvezTenhaIdo: true },
        ],
        parouNoMeio: 'o IXC parou de responder',
      }),
    );
    expect(pareceUmPdf(pdf)).toBe(true);
    expect(contarPaginas(pdf)).toBe(1);
  });

  it('peça sem tombo, MAC nem série não quebra a tabela', async () => {
    const semEtiqueta: ItemDoComprovante = {
      ...onu(1),
      peca: { patrimonioId: 7, numeroPatrimonial: null, mac: null, numeroSerie: null },
    };
    const pdf = await gerarComprovantePdf(dados({ enviados: [semEtiqueta] }));
    expect(pareceUmPdf(pdf)).toBe(true);
  });
});
