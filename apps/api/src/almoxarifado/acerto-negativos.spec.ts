import {
  naoControlaEstoque,
  negativosParaAcertar,
  rastrearNegativo,
  valorUnitarioDoAcerto,
} from './acerto-negativos';
import { AcertoDeNegativosService, type AndamentoDoAcerto } from './acerto-negativos.service';
import type { ItemDeEstoque } from './estoque.mapper';

/**
 * O acerto dos saldos negativos. O que se protege aqui:
 *
 *  - entra a quantidade exata que zera, no almoxarifado negativo;
 *  - serviço, produto sem unidade e almoxarifado que o sistema não enxerga
 *    ficam de fora, com o porquê;
 *  - uma compra por filial, itens um por vez;
 *  - o que já foi lançado e não subiu não é lançado de novo (daria o dobro);
 *  - a conferência no fim diz o que o IXC tem, e não o que foi mandado.
 */

const UNIDADES = [
  { id: 1, sigla: 'UND' },
  { id: 2, sigla: 'MT' },
];
const ALMOX = [
  { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true },
  { id: 4, nome: 'ILNET', filialId: 1, ativo: true },
  { id: 3, nome: 'GARAGEM', filialId: 1, ativo: false },
];
const CADASTROS = new Map<number, Record<string, unknown>>([
  [307, { id: '307', tipo: 'C', unidade: '2', preco_base: '0.59' }],
  [603, { id: '603', tipo: 'C', unidade: '1', preco_base: '0.00' }],
  [26, { id: '26', tipo: 'S', unidade: '1', preco_base: '450' }],
  [184, { id: '184', tipo: 'P', unidade: '1', preco_base: '400' }],
  [99, { id: '99', tipo: 'C', unidade: '77', preco_base: '1' }],
]);

const saldo = (almoxId: number, almoxarifado: string, s: number) => ({
  almoxId,
  almoxarifado,
  saldo: s,
  minimo: null,
  maximo: null,
  abaixoDoMinimo: false,
});
const item = (produtoId: number, descricao: string, saldos: ReturnType<typeof saldo>[]) =>
  ({
    produtoId,
    descricao,
    unidade: null,
    precoBase: null,
    ativo: true,
    saldos,
    total: saldos.reduce((t, s) => t + s.saldo, 0),
    abaixoDoMinimo: false,
    semNenhum: false,
  }) satisfies ItemDeEstoque;

describe('negativosParaAcertar', () => {
  it('cada negativo vira a entrada que o zera; o positivo não entra', () => {
    const { itens } = negativosParaAcertar(
      [
        item(307, 'CABO DROP', [saldo(1, 'Almoxarifado Principal', -2754), saldo(4, 'ILNET', -81952.5)]),
        item(603, 'BUCHA Nº 06', [saldo(4, 'ILNET', 449), saldo(1, 'Almoxarifado Principal', -200)]),
      ],
      CADASTROS,
      UNIDADES,
      ALMOX,
    );
    expect(itens.map((i) => [i.chave, i.quantidade, i.unidadeSigla, i.almoxarifado])).toEqual([
      ['603:1', 200, 'UND', 'Almoxarifado Principal'],
      ['307:1', 2754, 'MT', 'Almoxarifado Principal'],
      ['307:4', 81952.5, 'MT', 'ILNET'],
    ]);
  });

  it('serviço, sem unidade e almoxarifado não enxergado ficam — com o porquê', () => {
    const { itens, deFora } = negativosParaAcertar(
      [
        item(26, 'Ativação', [saldo(1, 'Almoxarifado Principal', -1)]),
        item(99, 'Sem unidade', [saldo(1, 'Almoxarifado Principal', -1)]),
        item(184, 'ONU', [saldo(55, 'TÉCNICO NÃO LIBERADO', -1)]),
        item(1234, 'Sem cadastro', [saldo(1, 'Almoxarifado Principal', -1)]),
      ],
      CADASTROS,
      UNIDADES,
      ALMOX,
    );
    expect(itens).toEqual([]);
    expect(Object.fromEntries(deFora.map((d) => [d.produtoId, d.motivo]))).toEqual({
      26: expect.stringMatching(/serviço/),
      99: expect.stringMatching(/sem unidade/),
      184: expect.stringMatching(/libere/),
      1234: expect.stringMatching(/cadastro/),
    });
  });

  it('almoxarifado inativo entra — o IXC é quem diz se aceita', () => {
    const { itens } = negativosParaAcertar(
      [item(307, 'CABO DROP', [saldo(3, 'GARAGEM', -1)])],
      CADASTROS,
      UNIDADES,
      ALMOX,
    );
    expect(itens).toEqual([expect.objectContaining({ almoxId: 3, almoxAtivo: false })]);
  });
});

describe('rastrearNegativo', () => {
  const mov = (id: number, data: string, entra: number, sai: number, extra: Record<string, string> = {}) => ({
    id: String(id),
    data,
    estoque: 'S',
    quantidade: String(entra),
    qtde_saida: String(sai),
    id_entrada: '0',
    id_saida: '0',
    id_transf_almox_item: '0',
    id_inventario: '0',
    ...extra,
  });

  it('acha o movimento que levou o saldo abaixo de zero — e as saídas desde então', () => {
    const r = rastrearNegativo(
      [
        mov(1, '2021-01-10', 100, 0, { id_entrada: '55' }),
        mov(2, '2021-02-01', 0, 60, { id_saida: '7001' }),
        mov(3, '2022-09-12', 0, 80, { id_transf_almox_item: '900' }),
        mov(4, '2023-01-05', 0, 10),
        mov(5, '2023-02-01', 0, 5, { estoque: 'N', id_saida: '7002' }), // não vale
      ],
      [{ id: '900', id_transf_almox: '2887' }],
    );
    expect(r).toMatchObject({ saldoPelosMovimentos: -50, movimentos: 4, semEfeito: 1 });
    expect(r.ficouNegativoEm).toEqual({
      id: 3,
      data: '12/09/2022',
      referencia: 'transferência #2887',
      quantidade: -80,
      saldoDepois: -40,
    });
    expect(r.saidasDesde.map((s) => s.referencia)).toEqual([
      'transferência #2887',
      'OS ou comodato (movimento #4 no IXC)',
    ]);
  });

  it('o negativo de agora é o da última vez que cruzou o zero', () => {
    const r = rastrearNegativo(
      [
        mov(1, '2020-01-01', 0, 2, { id_saida: '1' }),
        mov(2, '2020-02-01', 5, 0, { id_entrada: '2' }),
        mov(3, '2021-03-01', 0, 4, { id_saida: '3' }),
      ],
      [],
    );
    expect(r.saldoPelosMovimentos).toBe(-1);
    expect(r.ficouNegativoEm?.referencia).toBe('saída #3');
  });

  it('sem negativo, sem culpado', () => {
    const r = rastrearNegativo([mov(1, '2020-01-01', 3, 0), mov(2, '2020-02-01', 0, 3)], []);
    expect(r).toMatchObject({ saldoPelosMovimentos: 0, ficouNegativoEm: null, saidasDesde: [] });
  });
});

describe('naoControlaEstoque', () => {
  it('só o "N" do cadastro desliga — ausente conta como controlado', () => {
    expect(naoControlaEstoque({ controla_estoque: 'N' })).toBe(true);
    expect(naoControlaEstoque({ controla_estoque: 'S' })).toBe(false);
    expect(naoControlaEstoque({})).toBe(false);
  });

  it('produto que não controla estoque fica fora do acerto — a entrada não mudaria nada', () => {
    const { itens, deFora } = negativosParaAcertar(
      [item(25, 'SWITCH', [saldo(1, 'Almoxarifado Principal', -1)])],
      new Map([[25, { tipo: 'C', unidade: '1', controla_estoque: 'N' }]]),
      UNIDADES,
      ALMOX,
    );
    expect(itens).toEqual([]);
    expect(deFora[0].motivo).toMatch(/Controla estoque: Não/);
  });
});

describe('valorUnitarioDoAcerto', () => {
  it('preço base do cadastro, ou um centavo — nunca zero', () => {
    const [cabo, bucha] = negativosParaAcertar(
      [
        item(307, 'CABO DROP', [saldo(1, 'P', -1)]),
        item(603, 'BUCHA', [saldo(1, 'P', -1)]),
      ],
      CADASTROS,
      UNIDADES,
      ALMOX,
    ).itens.sort((a, b) => a.produtoId - b.produtoId);
    expect(valorUnitarioDoAcerto(cabo, 'preco')).toBe(0.59);
    expect(valorUnitarioDoAcerto(bucha, 'preco')).toBe(0.01); // preço base zero
    expect(valorUnitarioDoAcerto(cabo, 'centavo')).toBe(0.01);
  });
});

describe('AcertoDeNegativosService', () => {
  /** O IXC de mentira: a entrada soma no saldo se `somaAberta`, e recusa o que pedirem. */
  function montar(opts: { somaAberta?: boolean; recusar?: number[] } = {}) {
    const somaAberta = opts.somaAberta ?? true;
    const entradas = new Map<string, number>();
    let emVoo = 0;
    let pico = 0;
    const base = [
      item(307, 'CABO DROP', [saldo(1, 'Almoxarifado Principal', -2754), saldo(4, 'ILNET', -10)]),
      item(603, 'BUCHA Nº 06', [saldo(1, 'Almoxarifado Principal', -200), saldo(4, 'ILNET', 449)]),
      item(26, 'Ativação', [saldo(1, 'Almoxarifado Principal', -1)]),
    ];
    const ixc = {
      create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
        if (tabela === 'entrada') return { id: 900, raw: {} };
        emVoo += 1;
        pico = Math.max(pico, emVoo);
        await new Promise((r) => setTimeout(r, 1));
        emVoo -= 1;
        if (opts.recusar?.includes(Number(corpo.id_produto))) {
          throw new Error('IXC: produto inativo');
        }
        const chave = `${corpo.id_produto}:${corpo.id_almox}`;
        entradas.set(chave, (entradas.get(chave) ?? 0) + Number(corpo.quantidade));
        return { id: 1, raw: {} };
      }),
    };
    const estoque = {
      esquecer: jest.fn(),
      listar: jest.fn(async () => ({
        itens: base.map((i) => ({
          ...i,
          saldos: i.saldos.map((s) => ({
            ...s,
            saldo: s.saldo + (somaAberta ? (entradas.get(`${i.produtoId}:${s.almoxId}`) ?? 0) : 0),
          })),
        })),
      })),
    };
    const produtos = {
      paraMovimentar: jest.fn(async () => [UNIDADES, ALMOX]),
      cadastrosPorId: jest.fn(async () => CADASTROS),
    };
    const service = new AcertoDeNegativosService(ixc as never, estoque as never, produtos as never);
    return { service, ixc, pico: () => pico };
  }

  async function terminar(service: AcertoDeNegativosService, a: AndamentoDoAcerto) {
    for (let i = 0; i < 500 && service.andamento(a.id).status === 'rodando'; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    return service.andamento(a.id);
  }

  const eu = { nome: 'Administrador' };
  const pedido = (chaves: string[]) => ({
    fornecedorId: 253,
    tipoDocumentoId: 13,
    condicaoPagamentoId: 27,
    valor: 'preco' as const,
    chaves,
  });

  it('uma compra de acerto, um item por negativo, um de cada vez — e zera', async () => {
    const { service, ixc, pico } = montar();
    const { itens, deFora } = await service.listar();
    expect(itens.map((i) => i.chave)).toEqual(['603:1', '307:1', '307:4']);
    expect(deFora.map((d) => d.produtoId)).toEqual([26]);

    const fim = await terminar(service, await service.iniciar(pedido(itens.map((i) => i.chave)), eu));
    expect(fim).toMatchObject({ status: 'terminou', compras: [900], zerados: 3, falharam: [] });
    expect(pico()).toBe(1);
    expect(ixc.create).toHaveBeenCalledWith(
      'entrada',
      expect.objectContaining({
        id_fornecedor: '253',
        tipo_documento: '13',
        condicoes_pagamento: '27',
        status: 'A',
      }),
    );
    expect(ixc.create).toHaveBeenCalledWith(
      'movimento_produtos',
      expect.objectContaining({ id_produto: '307', id_almox: '1', quantidade: '2754.00000', id_entrada: '900' }),
    );
    // Zerado, não aparece mais para acertar.
    expect((await service.listar()).itens).toEqual([]);
  });

  it('só os marcados — e o recusado pelo IXC aparece com o motivo', async () => {
    const { service, ixc } = montar({ recusar: [603] });
    const fim = await terminar(service, await service.iniciar(pedido(['603:1', '307:4']), eu));
    expect(fim.lancados.map((l) => l.chave)).toEqual(['307:4']);
    expect(fim.falharam).toEqual([expect.objectContaining({ chave: '603:1', motivo: expect.stringMatching(/inativo/) })]);
    expect(ixc.create.mock.calls.filter(([t]) => t === 'movimento_produtos')).toHaveLength(2);
  });

  it('se o IXC só soma depois de finalizar: avisa, e não deixa lançar de novo', async () => {
    const { service } = montar({ somaAberta: false });
    const fim = await terminar(service, await service.iniciar(pedido(['307:1']), eu));
    expect(fim).toMatchObject({ zerados: 0, aindaNegativos: [expect.objectContaining({ chave: '307:1' })] });

    const depois = await service.listar();
    expect(depois.itens.map((i) => i.chave)).not.toContain('307:1');
    expect(depois.deFora).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chave: '307:1', motivo: expect.stringMatching(/compra de acerto #900/) }),
      ]),
    );
    await expect(service.iniciar(pedido(['307:1']), eu)).rejects.toThrow(/Nada para acertar/);
  });

  it('compra que não abre: nada lançado, dito uma vez — e dá para tentar de novo', async () => {
    const { service, ixc } = montar();
    ixc.create.mockImplementationOnce(async () => {
      throw new Error('IXC (/entrada): Ocorreu um erro ao processar.');
    });
    const fim = await terminar(service, await service.iniciar(pedido(['307:1', '603:1']), eu));
    expect(fim).toMatchObject({ status: 'falhou', compras: [], lancados: [], falharam: [] });
    expect(fim.erro).toMatch(/não abriu .* Nada foi lançado/);
    expect((await service.listar()).itens.map((i) => i.chave)).toContain('307:1');
  });

  it('não roda dois acertos ao mesmo tempo', async () => {
    const { service } = montar();
    const primeiro = await service.iniciar(pedido(['307:1']), eu);
    await expect(service.iniciar(pedido(['307:4']), eu)).rejects.toThrow(/rodando/);
    await terminar(service, primeiro);
  });
});
