import { montarPatrimonioDaTransferencia } from './produtos-ixc';
import {
  emParalelo,
  identificacao,
  patrimoniosMoviveis,
  pecasForaDaPrateleira,
  pecasPresas,
  produtoInativo,
  semSaldoParaAPeca,
  separarMoviveis,
} from './mover-tudo';
import {
  dizerOMovimento,
  TransferenciasService,
  type AndamentoDaTransferencia,
} from './transferencias.service';

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

describe('produtoInativo', () => {
  it('só o "N" do IXC esconde o produto; sem cadastro, ele aparece', () => {
    expect(produtoInativo({ ativo: 'N' })).toBe(true);
    expect(produtoInativo({ ativo: 'n' })).toBe(true);
    expect(produtoInativo({ ativo: 'S' })).toBe(false);
    expect(produtoInativo({})).toBe(false);
    expect(produtoInativo(undefined)).toBe(false);
  });
});

describe('semSaldoParaAPeca', () => {
  it('peça de produto com saldo zero ou negativo aqui não vai — deixaria negativo', () => {
    const { patrimonios } = patrimoniosMoviveis([peca(1, '1'), peca(2, '1')], CADASTROS, UNIDADES);
    const semSaldo = semSaldoParaAPeca(patrimonios, new Map([[12, 0]]));
    expect(semSaldo.patrimonios).toEqual([]);
    expect(semSaldo.deFora).toEqual([
      expect.objectContaining({ produtoId: 12, motivo: expect.stringMatching(/saldo .* é 0/) }),
      expect.objectContaining({ produtoId: 12 }),
    ]);
    expect(semSaldoParaAPeca(patrimonios, new Map([[12, 2]])).patrimonios).toHaveLength(2);
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

  it('patrimônio não vai por quantidade — saldo sem peça é separado, com a unidade', () => {
    const tudoCoberto = separarMoviveis([item(12, 3)], CADASTROS, UNIDADES, new Map([[12, 3]]));
    expect(tudoCoberto).toEqual({ moviveis: [], semPeca: [], deFora: [] });

    const falta = separarMoviveis([item(12, 5)], CADASTROS, UNIDADES, new Map([[12, 3]]));
    expect(falta.moviveis).toEqual([]);
    expect(falta.deFora).toEqual([]);
    expect(falta.semPeca).toEqual([
      expect.objectContaining({
        produtoId: 12,
        saldo: 2,
        unidadeSigla: 'UND',
        tipoProduto: 'P',
        motivo: expect.stringMatching(/sem peça/),
      }),
    ]);
  });

  it('saldo sem peça fica quando há peça dele presa aqui — o saldo pode ser ela', () => {
    const fora = pecasForaDaPrateleira([peca(1, '8'), peca(2, '4'), peca(3, '1')]);
    expect([...(fora.get(12)?.entries() ?? [])]).toEqual([
      ['8', 1],
      ['4', 1],
    ]);
    const r = separarMoviveis([item(12, 1)], CADASTROS, UNIDADES, new Map(), fora);
    expect(r.semPeca).toEqual([]);
    expect(r.deFora).toEqual([
      expect.objectContaining({ produtoId: 12, motivo: expect.stringMatching(/1 indisponível/) }),
    ]);

    // Com o que o IXC grava na peça, o motivo aponta onde ela está presa.
    const presas = pecasPresas([
      peca(1, '8', {
        finalidade_indisponivel: 'TM',
        id_finalidade: '2871',
        data_movimentacao_indisponivel: '2026-08-30 10:12:00',
      }),
      peca(2, '4'),
    ]);
    const apontado = separarMoviveis([item(12, 1)], CADASTROS, UNIDADES, new Map(), fora, presas);
    expect(apontado.deFora[0].motivo).toMatch(
      /peça nº PAT1 · MAC .* \(código 1 no IXC\) está indisponível desde 30\/08\/2026, na transferência com confirmação #2871 — falta confirmar/,
    );
    expect(pecasPresas([peca(5, '8')]).get(12)).toMatch(
      /código 5 no IXC\) está indisponível, presa num movimento .* "Detalhes da indisponibilidade"/,
    );

    /* Sabendo qual compra segura a peça, o motivo diz a compra — e não mais
       "um movimento que o IXC não informou aqui". */
    expect(
      pecasPresas(
        [peca(5, '8')],
        new Map([[5, 'na entrada (compra) #2374 da NF 123555 — finalize a compra no IXC']]),
      ).get(12),
    ).toMatch(/está indisponível, na entrada \(compra\) #2374 da NF 123555/);

    /* Doze peças presas no mesmo lugar são uma frase, e não doze: a explicação
       uma vez, quantas são, e três números para procurar no IXC. */
    const muitas = pecasPresas(
      Array.from({ length: 12 }, (_, i) =>
        peca(100 + i, '8', { finalidade_indisponivel: 'E', id_finalidade: '77' }),
      ),
    ).get(12)!;
    expect(muitas).toMatch(/^12 peças estão indisponíveis, na entrada \(compra\) #77 ainda aberta/);
    expect(muitas).toMatch(/e mais 9$/);
    // A explicação aparece uma vez só.
    expect(muitas.match(/entrada \(compra\)/g)).toHaveLength(1);

    // Comodato não prende: a peça já saiu do saldo. Só explica.
    const soComodato = separarMoviveis(
      [item(12, 1)],
      CADASTROS,
      UNIDADES,
      new Map(),
      pecasForaDaPrateleira([peca(2, '4')]),
    );
    expect(soComodato.semPeca).toEqual([
      expect.objectContaining({ motivo: expect.stringMatching(/1 em comodato/) }),
    ]);
  });

  it('produto com "Controla estoque: Não" fica — a transferência não mexeria no saldo', () => {
    const { moviveis, deFora } = separarMoviveis(
      [item(25, 9)],
      new Map([[25, { id: '25', tipo: 'C', unidade: '1', controla_estoque: 'N' }]]),
      UNIDADES,
    );
    expect(moviveis).toEqual([]);
    expect(deFora[0].motivo).toMatch(/Controla estoque: Não/);
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

describe('dizerOMovimento', () => {
  /*
   * O IXC não põe a finalidade da indisponibilidade na listagem de
   * patrimônio, mas põe o `id_movimento_produto`. Seguindo esse número se
   * chega à compra que está segurando a peça — e o conserto é finalizá-la.
   */
  const movimento = { tipo: 'E', id_entrada: '2374' };

  it('compra aberta: diz qual é e o que fazer com ela', () => {
    const dito = dizerOMovimento(movimento, {
      status: 'A',
      numero_nf: '123555',
      data_entrada: '2022-01-26 00:00:00',
    });
    expect(dito).toBe(
      'na entrada (compra) #2374 da NF 123555, de 26/01/2022, ainda aberta — finalize a ' +
        'compra no IXC e a peça se solta',
    );
  });

  it('compra já finalizada não manda finalizar de novo', () => {
    const dito = dizerOMovimento(movimento, { status: 'F', numero_nf: '0', data_entrada: '' });
    expect(dito).toMatch(/#2374, já finalizada — a compra não está mais aberta/);
    // Sem nota e sem data, não inventa nenhuma das duas.
    expect(dito).not.toMatch(/NF|de \d/);
  });

  it('movimento que não é entrada de compra não vira conselho nenhum', () => {
    expect(dizerOMovimento({ tipo: 'S', id_entrada: '0' }, null)).toBeNull();
    expect(dizerOMovimento({ tipo: 'E', id_entrada: '0' }, null)).toBeNull();
  });
});

describe('TransferenciasService', () => {
  const ALMOXARIFADOS = [
    { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true },
    { id: 29, nome: 'CLEYSON', filialId: 1, ativo: true },
  ];

  /**
   * O IXC de mentira: lembra o que já saiu da origem (o saldo baixa, a peça
   * some da prateleira), para a releitura depois de mover dizer a verdade.
   *
   *  - `recusar`: sempre recusa;
   *  - `recusarUmaVez`: recusa a primeira tentativa e aceita a segunda;
   *  - `gravaMasDizQueFalhou`: move e mesmo assim responde erro.
   */
  function montar(
    opts: {
      recusar?: string[];
      recusarUmaVez?: string[];
      gravaMasDizQueFalhou?: string[];
      /** Saldo de ONU além das 2 peças — patrimônio sem peça. */
      onusSemPeca?: number;
      /** O que a soma dos movimentos confirma do saldo sem peça. */
      movimentosConfirmam?: number;
      /** Este produto está inativo no IXC. */
      inativo?: number;
      /** As peças que a busca por código enxerga no IXC. */
      pecasDoIxc?: Array<Record<string, string>>;
    } = {},
  ) {
    const saidas = new Map<string, number>();
    const jaRecusou = new Set<string>();
    const saldo = [
      { produtoId: 10, descricao: 'Conector APC', total: 40, unidade: 'UND' },
      { produtoId: 11, descricao: 'Cabo drop', total: 120.5, unidade: 'MT' },
      { produtoId: 12, descricao: 'ONU Huawei', total: 2 + (opts.onusSemPeca ?? 0), unidade: 'UND' },
    ];
    let emVoo = 0;
    /** Quantos itens já estavam sendo gravados quando cada um começou. */
    const concorrencia: number[] = [];
    const ixc = {
      listAll: jest.fn(
        async (tabela: string, params: { gridParam?: Array<{ P: string }> }) =>
          tabela === 'patrimonio'
            ? [peca(1, '1'), peca(2, '7'), peca(3, '4')].filter(
                (p) =>
                  !saidas.has(`p${p.id}`) &&
                  (!params.gridParam || p.situacao === params.gridParam[0].P),
              )
            : [],
      ),
      getById: jest.fn(async (_t: string, _c: string, id: number) => CADASTROS.get(id) ?? null),
      /* A busca por código: o webservice procura um campo de cada vez, e a
         peça responde no campo em que o código dela está. */
      list: jest.fn(async (tabela: string, params: { qtype: string; query: string }) => {
        if (tabela !== 'patrimonio') return { total: 0, page: 1, registros: [] };
        const campo = params.qtype.split('.')[1];
        const procurado = String(params.query).toUpperCase().replace(/[^0-9A-Z]/g, '');
        const registros = (opts.pecasDoIxc ?? [peca(1, '1'), peca(2, '7'), peca(3, '4')]).filter(
          (l) => {
            const v = String((l as Record<string, string>)[campo] ?? '')
              .toUpperCase()
              .replace(/[^0-9A-Z]/g, '');
            return v !== '' && procurado !== '' && v.includes(procurado);
          },
        );
        return { total: registros.length, page: 1, registros };
      }),
      create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
        if (tabela === 'transf_almox_top') return { id: 77, raw: {} };
        concorrencia.push(emVoo);
        emVoo += 1;
        try {
          await new Promise((r) => setTimeout(r, 1));
          const chave = corpo.id_patrimonio ? `p${corpo.id_patrimonio}` : `m${corpo.id_produto}`;
          if (opts.recusar?.includes(chave)) throw new Error('IXC: saldo insuficiente');
          if (opts.recusarUmaVez?.includes(chave) && !jaRecusou.has(chave)) {
            jaRecusou.add(chave);
            throw new Error('IXC: Ocorreu um erro ao processar.');
          }
          saidas.set(chave, (saidas.get(chave) ?? 0) + Number(corpo.qtde));
          if (opts.gravaMasDizQueFalhou?.includes(chave)) {
            throw new Error('IXC: Ocorreu um erro ao processar.');
          }
          return { id: 1, raw: {} };
        } finally {
          emVoo -= 1;
        }
      }),
    };
    const estoque = {
      esquecer: jest.fn(),
      listar: jest.fn(async () => ({
        itens: saldo
          .map((s) => ({
            ...s,
            ativo: s.produtoId !== opts.inativo,
            total:
              s.total -
              (saidas.get(`m${s.produtoId}`) ?? 0) -
              (s.produtoId === 12 ? ['p1', 'p2'].filter((p) => saidas.has(p)).length : 0),
            saldos: [],
          }))
          .filter((s) => s.total > 0),
        almoxarifados: [{ id: 29, nome: 'CLEYSON' }],
      })),
    };
    const produtos = {
      paraMovimentar: jest.fn(async () => [
        UNIDADES.map((u) => ({ ...u, descricao: u.sigla })),
        ALMOXARIFADOS,
      ]),
      saldoPelosMovimentos: jest.fn(async () => opts.movimentosConfirmam ?? 999),
      cadastrosPorId: jest.fn(
        async (ids: number[]) =>
          new Map(ids.flatMap((id) => (CADASTROS.has(id) ? [[id, CADASTROS.get(id)!]] : []))),
      ),
    };
    const service = new TransferenciasService(ixc as never, estoque as never, produtos as never);
    service.pausaAntesDeRepetirMs = 0;
    return { service, ixc, concorrencia };
  }

  /** A transferência roda em segundo plano; os mocks respondem quase na hora. */
  async function terminar(service: TransferenciasService, a: AndamentoDaTransferencia) {
    for (let i = 0; i < 500 && service.andamento(a.id).status === 'rodando'; i++) {
      await new Promise((r) => setTimeout(r, 1));
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

  describe('acharPeca', () => {
    it('acha pelo MAC e diz de qual almoxarifado ela sai', async () => {
      const { service } = montar();
      const achada = await service.acharPeca('AA:BB:CC:00:00:01');
      expect(achada).toMatchObject({
        patrimonioId: 1,
        produtoId: 12,
        descricao: 'ONU Huawei',
        almoxId: 29,
        almoxarifado: 'CLEYSON',
        situacao: 'disponível',
        podeMover: true,
        impedimento: null,
      });
    });

    it('o MAC digitado sem os dois-pontos é o mesmo MAC', async () => {
      const { service } = montar();
      const achada = await service.acharPeca('aabbcc000001');
      expect(achada.patrimonioId).toBe(1);
    });

    it('acha pelo nº patrimonial e pela série do fornecedor', async () => {
      const { service } = montar();
      expect((await service.acharPeca('PAT2')).patrimonioId).toBe(2);
      expect((await service.acharPeca('HWTC2')).patrimonioId).toBe(2);
    });

    it('peça fora da prateleira vem com o motivo, e não se move', async () => {
      const { service } = montar();
      const achada = await service.acharPeca('PAT3'); // situação 4: em comodato
      expect(achada).toMatchObject({
        patrimonioId: 3,
        podeMover: false,
        situacao: 'em comodato',
      });
      expect(achada.impedimento).toMatch(/não está na prateleira/);
    });

    it('almoxarifado que o sistema não enxerga: diz que falta liberar', async () => {
      const { service } = montar({
        pecasDoIxc: [peca(9, '1', { id_almoxarifado: '77' })],
      });
      const achada = await service.acharPeca('PAT9');
      expect(achada.podeMover).toBe(false);
      expect(achada.impedimento).toMatch(/liberado para o sistema/);
    });

    it('código curto não vai ao IXC', async () => {
      const { service, ixc } = montar();
      await expect(service.acharPeca('AA')).rejects.toThrow(/ao menos 3/);
      expect(ixc.list).not.toHaveBeenCalled();
    });

    it('nada achado diz o que fazer', async () => {
      const { service } = montar();
      await expect(service.acharPeca('ZZZZZZ')).rejects.toThrow(/Nenhuma peça no IXC/);
    });

    it('mais de uma peça com o pedaço digitado: pede o código inteiro', async () => {
      const { service } = montar();
      // "AABBCC0000" está no MAC das três peças.
      await expect(service.acharPeca('AA:BB:CC:00:00')).rejects.toThrow(/código inteiro/);
    });

    it('o código inteiro ganha do pedaço — a peça exata não vira empate', async () => {
      const { service } = montar({
        pecasDoIxc: [peca(1, '1', { serial: '100' }), peca(2, '1', { serial: '1001' })],
      });
      expect((await service.acharPeca('100')).patrimonioId).toBe(1);
    });
  });

  it('produto inativo no IXC não entra na janela — nem para mover, nem entre os que ficam', async () => {
    const { service } = montar({ inativo: 10 });
    const c = await service.conteudo(29);
    expect(c.moviveis.map((m) => m.produtoId)).toEqual([11]);
    expect(c.deFora).toEqual([]);
  });

  it('só pede ao IXC as peças da prateleira e as presas — o comodato não vem', async () => {
    const { service, ixc } = montar();
    await service.conteudo(29);
    const pedidas = ixc.listAll.mock.calls
      .filter(([t]) => t === 'patrimonio')
      .map(([, p]) => (p as { gridParam: Array<{ TB: string; P: string }> }).gridParam[0]);
    expect(pedidas.map((g) => g.TB)).toEqual(Array(4).fill('patrimonio.situacao'));
    expect(pedidas.map((g) => g.P).sort()).toEqual(['1', '6', '7', '8']);
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

  it('o primeiro item vai sozinho — os outros só depois que ele entrou', async () => {
    const { service, concorrencia } = montar();
    await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(concorrencia[0]).toBe(0);
    expect(concorrencia[1]).toBe(0); // o segundo não começou com o primeiro no ar
    expect(Math.max(...concorrencia)).toBeLessThanOrEqual(2); // e depois, até 3 juntos
  });

  it('o que o IXC recusa ganha uma segunda chance, e entra', async () => {
    const { service, ixc } = montar({ recusarUmaVez: ['m10', 'm11'] });
    const fim = await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(fim).toMatchObject({ status: 'terminou', falharam: [], restouNaOrigem: 0, tentandoDeNovo: 0 });
    expect(fim.movidos).toHaveLength(4);
    const doConector = ixc.create.mock.calls.filter(([, c]) => c.id_produto === '10');
    expect(doConector).toHaveLength(2);
  });

  it('não repete o que o IXC gravou dizendo que deu erro — e não oferece de novo', async () => {
    const { service, ixc } = montar({ gravaMasDizQueFalhou: ['m10'] });
    const fim = await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(ixc.create.mock.calls.filter(([, c]) => c.id_produto === '10')).toHaveLength(1);
    expect(fim.falharam).toEqual([
      expect.objectContaining({ chave: 'produto-10', motivo: expect.stringMatching(/já não tem/) }),
    ]);
    await expect(service.repetir(fim.id, eu)).rejects.toThrow(/Não sobrou/);
  });

  it('"tentar de novo" abre outra transferência só com o que ficou', async () => {
    const recusar = ['p1'];
    const { service, ixc } = montar({ recusar });
    const fim = await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(fim.falharam.map((f) => f.chave)).toEqual(['patrimonio-1']);

    recusar.length = 0; // o IXC voltou a aceitar
    ixc.create.mockClear();
    const denovo = await terminar(service, await service.repetir(fim.id, eu));
    expect(denovo).toMatchObject({ status: 'terminou', total: 1, falharam: [] });
    expect(denovo.movidos.map((m) => m.chave)).toEqual(['patrimonio-1']);
    expect(ixc.create).toHaveBeenCalledWith(
      'transf_almox_top',
      expect.objectContaining({ obs: expect.stringMatching(/de novo o que a #77/) }),
    );
  });

  it('saldo de patrimônio sem peça: fica, a não ser que peçam para levar', async () => {
    const { service, ixc } = montar({ onusSemPeca: 3 });
    const c = await service.conteudo(29);
    expect(c.semPeca).toEqual([expect.objectContaining({ produtoId: 12, saldo: 3 })]);

    const sem = await terminar(service, await service.iniciar({ de: 29, para: 1, tudo: true }, eu));
    expect(sem.deFora).toEqual([expect.objectContaining({ produtoId: 12, saldo: 3 })]);
    expect(ixc.create).not.toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_produto: '12', id_patrimonio: '' }),
    );

    const { service: s2, ixc: ixc2 } = montar({ onusSemPeca: 3 });
    const com = await terminar(
      s2,
      await s2.iniciar({ de: 29, para: 1, tudo: true, levarSemPeca: true }, eu),
    );
    expect(com).toMatchObject({ total: 5, deFora: [], restouNaOrigem: 0 });
    expect(ixc2.create).toHaveBeenCalledWith(
      'transf_almox_item',
      expect.objectContaining({ id_produto: '12', id_patrimonio: '', qtde: '3.00000', tipo_produto: 'P' }),
    );
  });

  it('recusa origem igual ao destino, destino que o sistema não enxerga e lista vazia', async () => {
    const { service } = montar();
    await expect(service.iniciar({ de: 29, para: 29, tudo: true }, eu)).rejects.toThrow(/mesmo/);
    await expect(service.iniciar({ de: 29, para: 55, tudo: true }, eu)).rejects.toThrow(/Libere/);
    await expect(service.iniciar({ de: 29, para: 1 }, eu)).rejects.toThrow(/vazia/);
  });

  it('saldo sem peça só vai o que os movimentos confirmam', async () => {
    const nada = await montar({ onusSemPeca: 1, movimentosConfirmam: 0 }).service.conteudo(29);
    expect(nada.semPeca).toEqual([]);
    expect(nada.deFora).toEqual([
      expect.objectContaining({ produtoId: 12, motivo: expect.stringMatching(/movimentos .* somam 0/) }),
    ]);
    const parte = await montar({ onusSemPeca: 3, movimentosConfirmam: 2 }).service.conteudo(29);
    expect(parte.semPeca).toEqual([expect.objectContaining({ produtoId: 12, saldo: 2 })]);
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
