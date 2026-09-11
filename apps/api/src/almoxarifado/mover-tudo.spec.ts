import { emParalelo, separarMoviveis } from './mover-tudo';
import { ProdutosService, type AndamentoDaMudanca } from './produtos.service';

/**
 * Mover tudo de um almoxarifado para outro. O que se protege aqui:
 *
 *  - só vai o que tem saldo, e patrimônio, serviço e produto sem unidade
 *    ficam de fora, com o motivo;
 *  - vai tudo numa transferência só, cada produto com a quantidade inteira;
 *  - um item recusado pelo IXC não para os outros, e o resultado diz qual;
 *  - não se roda duas mudanças com o mesmo almoxarifado ao mesmo tempo.
 */

const UNIDADES = [
  { id: 1, sigla: 'UND' },
  { id: 2, sigla: 'MT' },
];

describe('separarMoviveis', () => {
  const produtos = new Map<number, Record<string, unknown>>([
    [10, { id: '10', tipo: 'C', unidade: '1' }],
    [11, { id: '11', tipo: 'C', unidade: '2' }],
    [12, { id: '12', tipo: 'P', unidade: '1' }],
    [13, { id: '13', tipo: 'S', unidade: '1' }],
    [14, { id: '14', tipo: 'C', unidade: '99' }],
  ]);
  const item = (produtoId: number, saldo: number) => ({
    produtoId,
    descricao: `Produto ${produtoId}`,
    saldo,
    unidade: null,
  });

  it('leva o que tem saldo, com a unidade e o tipo que o item da transferência pede', () => {
    const { moviveis } = separarMoviveis([item(10, 5), item(11, 12.5)], produtos, UNIDADES);
    expect(moviveis).toEqual([
      { ...item(10, 5), unidadeId: 1, unidadeSigla: 'UND', tipoProduto: 'C' },
      { ...item(11, 12.5), unidadeId: 2, unidadeSigla: 'MT', tipoProduto: 'C' },
    ]);
  });

  it('saldo zero ou negativo nem entra na conta', () => {
    const r = separarMoviveis([item(10, 0), item(11, -2)], produtos, UNIDADES);
    expect(r).toEqual({ moviveis: [], deFora: [] });
  });

  it('patrimônio, serviço, sem unidade e sem cadastro ficam de fora, com o motivo', () => {
    const { moviveis, deFora } = separarMoviveis(
      [item(12, 1), item(13, 1), item(14, 1), item(99, 1)],
      produtos,
      UNIDADES,
    );
    expect(moviveis).toEqual([]);
    expect(deFora.map((d) => [d.produtoId, d.motivo])).toEqual([
      [12, expect.stringMatching(/patrimônio/)],
      [13, expect.stringMatching(/serviço/)],
      [14, expect.stringMatching(/unidade/)],
      [99, expect.stringMatching(/não foi achado/)],
    ]);
  });
});

describe('emParalelo', () => {
  it('faz todos, nunca mais que o limite ao mesmo tempo', async () => {
    let agora = 0;
    let pico = 0;
    const feitos: number[] = [];
    await emParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      agora += 1;
      pico = Math.max(pico, agora);
      await new Promise((r) => setTimeout(r, 1));
      feitos.push(n);
      agora -= 1;
    });
    expect(feitos.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pico).toBeLessThanOrEqual(3);
  });
});

describe('ProdutosService — mover tudo', () => {
  const ALMOX = [
    { id: '1', descricao: 'Almoxarifado Principal', id_filial: '1', ativo: 'S' },
    { id: '29', descricao: 'CLEYSON', id_filial: '1', ativo: 'S' },
  ];

  function montar(opts: { recusar?: number[] } = {}) {
    const saldoNaOrigem = [
      { produtoId: 10, descricao: 'Conector APC', total: 40, unidade: 'UND' },
      { produtoId: 11, descricao: 'Cabo drop', total: 120.5, unidade: 'MT' },
      { produtoId: 12, descricao: 'ONU (patrimônio)', total: 3, unidade: 'UND' },
    ];
    let moveu = false;
    const ixc = {
      listAll: jest.fn(async (tabela: string) => {
        if (tabela === 'almox') return ALMOX;
        if (tabela === 'unidades') {
          return [
            { id: '1', sigla: 'UND', descricao: 'Unidade' },
            { id: '2', sigla: 'MT', descricao: 'Metro' },
          ];
        }
        return [];
      }),
      getById: jest.fn(async (_t: string, _c: string, id: number) => {
        const cadastros: Record<number, Record<string, string>> = {
          10: { id: '10', tipo: 'C', unidade: '1' },
          11: { id: '11', tipo: 'C', unidade: '2' },
          12: { id: '12', tipo: 'P', unidade: '1' },
        };
        return cadastros[id] ?? null;
      }),
      create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
        if (tabela === 'transf_almox_top') return { id: 77, raw: {} };
        if (opts.recusar?.includes(Number(corpo.id_produto))) {
          throw new Error('IXC (transf_almox_item): saldo insuficiente');
        }
        moveu = true;
        return { id: 1, raw: {} };
      }),
    };
    const estoque = {
      esquecer: jest.fn(),
      listar: jest.fn(async () => ({
        // Depois de mover, a origem só guarda o que ficou de fora.
        itens: (moveu ? saldoNaOrigem.filter((s) => s.produtoId === 12) : saldoNaOrigem).map(
          (s) => ({ ...s, saldos: [] }),
        ),
        almoxarifados: [{ id: 29, nome: 'CLEYSON' }],
      })),
    };
    const service = new ProdutosService(ixc as never, estoque as never, {} as never);
    return { service, ixc };
  }

  /** A mudança roda em segundo plano; os mocks respondem na hora, então poucas voltas bastam. */
  async function terminar(service: ProdutosService, a: AndamentoDaMudanca) {
    for (let i = 0; i < 50 && service.andamentoDaMudanca(a.id).status === 'rodando'; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    return service.andamentoDaMudanca(a.id);
  }

  const eu = { nome: 'Administrador' };

  it('uma transferência só, um item por produto com a quantidade inteira', async () => {
    const { service, ixc } = montar();
    const inicio = await service.iniciarMoverTudo(29, { para: 1 }, eu);
    expect(inicio).toMatchObject({ status: 'rodando', total: 2, transferenciaId: 77 });

    const fim = await terminar(service, inicio);
    expect(fim).toMatchObject({ status: 'terminou', feitos: 2, restouNaOrigem: 0 });
    expect(fim.movidos.map((m) => [m.produtoId, m.quantidade])).toEqual(
      expect.arrayContaining([
        [10, 40],
        [11, 120.5],
      ]),
    );
    expect(fim.deFora.map((d) => d.produtoId)).toEqual([12]);

    const tops = ixc.create.mock.calls.filter(([t]) => t === 'transf_almox_top');
    expect(tops).toHaveLength(1);
    expect(tops[0][1]).toMatchObject({ id_almox_saida: '29', id_almox_entrada: '1' });
    expect(ixc.create).toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_produto: '11', qtde: '120.50000', id_transf_almox: '77' }),
    );
  });

  it('item recusado não para os outros — e o resultado diz qual e por quê', async () => {
    const { service } = montar({ recusar: [10] });
    const fim = await terminar(service, await service.iniciarMoverTudo(29, { para: 1 }, eu));
    expect(fim.movidos.map((m) => m.produtoId)).toEqual([11]);
    expect(fim.falharam).toEqual([
      expect.objectContaining({ produtoId: 10, motivo: expect.stringMatching(/insuficiente/) }),
    ]);
  });

  it('recusa origem igual ao destino, e destino que o sistema não enxerga', async () => {
    const { service } = montar();
    await expect(service.iniciarMoverTudo(29, { para: 29 }, eu)).rejects.toThrow(/mesmo/);
    await expect(service.iniciarMoverTudo(29, { para: 55 }, eu)).rejects.toThrow(/Libere/);
  });

  it('não roda duas mudanças com o mesmo almoxarifado ao mesmo tempo', async () => {
    const { service } = montar();
    const primeira = await service.iniciarMoverTudo(29, { para: 1 }, eu);
    await expect(service.iniciarMoverTudo(1, { para: 29 }, eu)).rejects.toThrow(/rodando/);
    await terminar(service, primeira);
    // Terminada, os almoxarifados ficam livres: a recusa agora é outra — a
    // origem só tem o patrimônio, que não vai.
    await expect(service.iniciarMoverTudo(29, { para: 1 }, eu)).rejects.toThrow(
      /nada para mover/,
    );
  });
});
