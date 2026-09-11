import { montarPatrimonioDaTransferencia } from './produtos-ixc';
import {
  emParalelo,
  identificacao,
  patrimoniosMoviveis,
  separarMoviveis,
} from './mover-tudo';
import { TransferenciasService, type AndamentoDaTransferencia } from './transferencias.service';

/**
 * Transferência de vários itens entre almoxarifados — produto por
 * quantidade, patrimônio peça por peça. O que se protege aqui:
 *
 *  - patrimônio vai pelo registro dele (`id_patrimonio`, qtde 1, tipo "P"),
 *    e só o que está na prateleira (situação Disponível / Disponível Técnico);
 *  - produto de patrimônio não vai por quantidade — e saldo sem peça que o
 *    explique fica, avisado;
 *  - tudo numa transferência só; um item recusado não para os outros;
 *  - a lista escolhida é conferida contra o que a origem tem agora;
 *  - não se roda duas transferências com o mesmo almoxarifado ao mesmo tempo.
 */

const UNIDADES = [
  { id: 1, sigla: 'UND' },
  { id: 2, sigla: 'MT' },
];

const CADASTROS = new Map<number, Record<string, unknown>>([
  [10, { id: '10', descricao: 'Conector APC', tipo: 'C', unidade: '1' }],
  [11, { id: '11', descricao: 'Cabo drop', tipo: 'C', unidade: '2' }],
  [12, { id: '12', descricao: 'ONU Huawei', tipo: 'P', unidade: '1' }],
  [13, { id: '13', descricao: 'Instalação', tipo: 'S', unidade: '1' }],
  [14, { id: '14', descricao: 'Sem unidade', tipo: 'C', unidade: '99' }],
]);

const peca = (id: number, situacao: string, extra: Record<string, string> = {}) => ({
  id: String(id),
  id_produto: '12',
  id_almoxarifado: '29',
  situacao,
  serial: `PAT${id}`,
  id_mac: `AA:BB:CC:00:00:${String(id).padStart(2, '0')}`,
  serial_fornecedor: `HWTC${id}`,
  ...extra,
});

describe('patrimoniosMoviveis', () => {
  it('só vai o que está na prateleira: Disponível (1) e Disponível Técnico (7)', () => {
    const linhas = [peca(1, '1'), peca(2, '7'), peca(3, '4'), peca(4, '3'), peca(5, '8')];
    const { patrimonios } = patrimoniosMoviveis(linhas, CADASTROS, UNIDADES);
    expect(patrimonios.map((p) => p.patrimonioId)).toEqual([1, 2]);
    expect(patrimonios[0]).toEqual({
      patrimonioId: 1,
      produtoId: 12,
      descricao: 'ONU Huawei',
      numeroPatrimonial: 'PAT1',
      mac: 'AA:BB:CC:00:00:01',
      numeroSerie: 'HWTC1',
      unidadeId: 1,
      unidadeSigla: 'UND',
    });
  });

  it('peça de produto sem cadastro ou sem unidade fica, dizendo qual peça', () => {
    const { patrimonios, deFora } = patrimoniosMoviveis(
      [peca(6, '1', { id_produto: '99' }), peca(7, '1', { id_produto: '14' })],
      CADASTROS,
      UNIDADES,
    );
    expect(patrimonios).toEqual([]);
    expect(deFora.map((d) => d.descricao)).toEqual([
      expect.stringContaining('nº PAT6'),
      expect.stringContaining('nº PAT7'),
    ]);
  });
});

describe('identificacao', () => {
  it('diz o que identifica a peça, e o id quando não tem nada', () => {
    expect(
      identificacao({ patrimonioId: 9, numeroPatrimonial: '0042', mac: 'AA:BB', numeroSerie: null }),
    ).toBe('nº 0042 · MAC AA:BB');
    expect(
      identificacao({ patrimonioId: 9, numeroPatrimonial: null, mac: null, numeroSerie: null }),
    ).toBe('patrimônio #9');
  });
});

describe('separarMoviveis', () => {
  const item = (produtoId: number, saldo: number) => ({
    produtoId,
    descricao: `Produto ${produtoId}`,
    saldo,
    unidade: null,
  });

  it('produto comum vai pela quantidade, com a unidade e o tipo', () => {
    const { moviveis } = separarMoviveis([item(10, 5), item(11, 12.5)], CADASTROS, UNIDADES);
    expect(moviveis.map((m) => [m.produtoId, m.saldo, m.unidadeSigla, m.tipoProduto])).toEqual([
      [10, 5, 'UND', 'C'],
      [11, 12.5, 'MT', 'C'],
    ]);
  });

  it('patrimônio não vai por quantidade — e saldo sem peça fica, avisado', () => {
    const tudoCoberto = separarMoviveis([item(12, 3)], CADASTROS, UNIDADES, new Map([[12, 3]]));
    expect(tudoCoberto).toEqual({ moviveis: [], deFora: [] });

    const falta = separarMoviveis([item(12, 5)], CADASTROS, UNIDADES, new Map([[12, 3]]));
    expect(falta.deFora).toEqual([
      expect.objectContaining({ produtoId: 12, saldo: 2, motivo: expect.stringMatching(/peça/) }),
    ]);
  });

  it('saldo zero não conta; serviço, sem unidade e sem cadastro ficam', () => {
    const { moviveis, deFora } = separarMoviveis(
      [item(10, 0), item(13, 1), item(14, 1), item(99, 1)],
      CADASTROS,
      UNIDADES,
    );
    expect(moviveis).toEqual([]);
    expect(deFora.map((d) => d.produtoId)).toEqual([13, 14, 99]);
  });
});

describe('montarPatrimonioDaTransferencia', () => {
  it('é o exemplo "3. Inserir patrimônio na transferência"', () => {
    expect(
      montarPatrimonioDaTransferencia(5, {
        patrimonioId: 9,
        produtoId: 34,
        unidadeId: 1,
        unidadeSigla: 'UND',
      }),
    ).toEqual({
      id_patrimonio: '9',
      id_produto: '34',
      id_unidade: '1',
      unidade_sigla: 'UND',
      qtde: '1.00000',
      fator_conversao: '1.000000000',
      id_transf_almox: '5',
      tipo_produto: 'P',
    });
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

describe('TransferenciasService', () => {
  const ALMOXARIFADOS = [
    { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true },
    { id: 29, nome: 'CLEYSON', filialId: 1, ativo: true },
  ];

  function montar(opts: { recusar?: string[] } = {}) {
    let moveu = false;
    const saldo = [
      { produtoId: 10, descricao: 'Conector APC', total: 40, unidade: 'UND' },
      { produtoId: 11, descricao: 'Cabo drop', total: 120.5, unidade: 'MT' },
      { produtoId: 12, descricao: 'ONU Huawei', total: 2, unidade: 'UND' },
    ];
    const ixc = {
      listAll: jest.fn(async (tabela: string) =>
        tabela === 'patrimonio' ? (moveu ? [] : [peca(1, '1'), peca(2, '7'), peca(3, '4')]) : [],
      ),
      getById: jest.fn(async (_t: string, _c: string, id: number) => CADASTROS.get(id) ?? null),
      create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
        if (tabela === 'transf_almox_top') return { id: 77, raw: {} };
        const chave = corpo.id_patrimonio ? `p${corpo.id_patrimonio}` : `m${corpo.id_produto}`;
        if (opts.recusar?.includes(chave)) throw new Error('IXC: saldo insuficiente');
        moveu = true;
        return { id: 1, raw: {} };
      }),
    };
    const estoque = {
      esquecer: jest.fn(),
      listar: jest.fn(async () => ({
        itens: (moveu ? [] : saldo).map((s) => ({ ...s, saldos: [] })),
        almoxarifados: [{ id: 29, nome: 'CLEYSON' }],
      })),
    };
    const produtos = {
      paraMovimentar: jest.fn(async () => [
        UNIDADES.map((u) => ({ ...u, descricao: u.sigla })),
        ALMOXARIFADOS,
      ]),
    };
    const service = new TransferenciasService(ixc as never, estoque as never, produtos as never);
    return { service, ixc };
  }

  /** A transferência roda em segundo plano; os mocks respondem na hora. */
  async function terminar(service: TransferenciasService, a: AndamentoDaTransferencia) {
    for (let i = 0; i < 50 && service.andamento(a.id).status === 'rodando'; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    return service.andamento(a.id);
  }

  const eu = { nome: 'Administrador' };

  it('o conteúdo junta produto por quantidade e patrimônio peça por peça', async () => {
    const { service } = montar();
    const c = await service.conteudo(29);
    expect(c.moviveis.map((m) => m.produtoId)).toEqual([11, 10]); // por nome
    expect(c.patrimonios.map((p) => p.patrimonioId)).toEqual([1, 2]);
    expect(c.deFora).toEqual([]); // as 2 ONUs do saldo têm as 2 peças
  });

  it('mover tudo: uma transferência, produtos inteiros e cada peça de patrimônio', async () => {
    const { service, ixc } = montar();
    const inicio = await service.iniciar({ de: 29, para: 1, tudo: true }, eu);
    expect(inicio).toMatchObject({ status: 'rodando', total: 4, transferenciaId: 77 });

    const fim = await terminar(service, inicio);
    expect(fim).toMatchObject({ status: 'terminou', feitos: 4, restouNaOrigem: 0 });
    expect(ixc.create.mock.calls.filter(([t]) => t === 'transf_almox_top')).toHaveLength(1);
    expect(ixc.create).toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_produto: '11', qtde: '120.50000', id_patrimonio: '' }),
    );
    expect(ixc.create).toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_patrimonio: '2', qtde: '1.00000', tipo_produto: 'P' }),
    );
    expect(fim.movidos.map((m) => m.detalhe)).toEqual(
      expect.arrayContaining(['nº PAT1 · MAC AA:BB:CC:00:00:01 · série HWTC1']),
    );
  });

  it('a lista escolhida: só o que foi pedido, na quantidade pedida', async () => {
    const { service, ixc } = montar();
    const fim = await terminar(
      service,
      await service.iniciar(
        { de: 29, para: 1, produtos: [{ produtoId: 10, quantidade: 5 }], patrimonios: [2] },
        eu,
      ),
    );
    expect(fim.movidos.map((m) => m.chave).sort()).toEqual(['patrimonio-2', 'produto-10']);
    expect(ixc.create).toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_produto: '10', qtde: '5.00000' }),
    );
    expect(ixc.create).toHaveBeenCalledTimes(3); // a transferência e os dois itens
  });

  it('recusa a lista que não bate com a origem — antes de abrir a transferência', async () => {
    const { service, ixc } = montar();
    await expect(
      service.iniciar(
        { de: 29, para: 1, produtos: [{ produtoId: 10, quantidade: 50 }], patrimonios: [3] },
        eu,
      ),
    ).rejects.toThrow(/tem 40, não 50.*patrimônio #3 não está disponível/);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('item recusado não para os outros — e o resultado diz qual e por quê', async () => {
    const { service } = montar({ recusar: ['p1'] });
    const fim = await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(fim.movidos).toHaveLength(3);
    expect(fim.falharam).toEqual([
      expect.objectContaining({ chave: 'patrimonio-1', motivo: expect.stringMatching(/insuficiente/) }),
    ]);
  });

  it('recusa origem igual ao destino, destino que o sistema não enxerga e lista vazia', async () => {
    const { service } = montar();
    await expect(service.iniciar({ de: 29, para: 29, tudo: true }, eu)).rejects.toThrow(/mesmo/);
    await expect(service.iniciar({ de: 29, para: 55, tudo: true }, eu)).rejects.toThrow(/Libere/);
    await expect(service.iniciar({ de: 29, para: 1 }, eu)).rejects.toThrow(/vazia/);
  });

  it('não roda duas transferências com o mesmo almoxarifado ao mesmo tempo', async () => {
    const { service } = montar();
    const primeira = await service.iniciar({ de: 29, para: 1, tudo: true }, eu);
    await expect(service.iniciar({ de: 1, para: 29, tudo: true }, eu)).rejects.toThrow(/rodando/);
    await terminar(service, primeira);
    // Terminada, os almoxarifados ficam livres: a recusa agora é outra.
    await expect(service.iniciar({ de: 29, para: 1, tudo: true }, eu)).rejects.toThrow(
      /nada para mover/,
    );
  });
});
