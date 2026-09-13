import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DOCUMENTO_DA_CONFERENCIA } from './conferencia';
import { ConferenciaService } from './conferencia.service';
import { EstoqueService } from './estoque.service';

/**
 * A conferência contra um IXC de mentira que **guarda saldo**: transferência
 * move, compra soma, apagar a compra desfaz. O que se confere aqui não é o
 * corpo mandado — isso é de `produtos-ixc.spec` —, é o saldo que fica:
 *
 *  - faltou vai para Perdas e Falhas; sobrou volta de lá, e o resto é compra;
 *  - nada se lança quando o saldo mudou, falta o valor, ou o produto não serve;
 *  - ONU por peça: a não achada vai, a trazida vem, a sem cadastro é compra;
 *  - o IXC que recusa e grava mesmo assim não leva duas vezes;
 *  - desfazer volta ao saldo de antes, e só quando ninguém mexeu depois.
 */

const PRINCIPAL = { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true };
const ILNET = { id: 4, nome: 'ILNET', filialId: 1, ativo: true };
const PERDAS = { id: 43, nome: 'Perdas e Falhas', filialId: 1, ativo: true };

const PRODUTOS: Record<number, Record<string, string>> = {
  10: { id: '10', descricao: 'Conector SC/APC', tipo: 'C', unidade: '1', ativo: 'S', controla_estoque: 'S', preco_base: '3.40', custo_medio: '2.90' },
  70: { id: '70', descricao: 'ONU SIMPLES', tipo: 'P', unidade: '1', ativo: 'S', controla_estoque: 'S', preco_base: '120.00' },
  80: { id: '80', descricao: 'Ativação', tipo: 'S', unidade: '1', ativo: 'S', controla_estoque: 'S' },
  90: { id: '90', descricao: 'Switch velho', tipo: 'C', unidade: '1', ativo: 'S', controla_estoque: 'N' },
};

interface Peca {
  id: string;
  id_produto: string;
  id_almoxarifado: string;
  situacao: string;
  serial: string;
  serial_fornecedor: string;
  id_mac: string;
  id_movimento_produto: string;
}

function montar(opts: { almoxarifados?: typeof PRINCIPAL[] } = {}) {
  const saldos = new Map<string, number>();
  const pecas: Peca[] = [];
  const entradas = new Map<number, Record<string, string>>();
  const movimentos = new Map<number, { id: number; id_entrada: number; produto: number; almox: number; quantidade: number }>();
  const transferencias = new Map<number, { de: number; para: number }>();
  let proximo = 1000;
  /** Recusas programadas: a próxima inserção de item falha (e grava ou não). */
  const recusas: Array<{ grava: boolean }> = [];

  const chave = (p: number, a: number) => `${p}:${a}`;
  const mover = (p: number, de: number, para: number, q: number) => {
    saldos.set(chave(p, de), (saldos.get(chave(p, de)) ?? 0) - q);
    saldos.set(chave(p, para), (saldos.get(chave(p, para)) ?? 0) + q);
  };
  const nomeDoAlmox = (id: number) =>
    [PRINCIPAL, ILNET, PERDAS].find((a) => a.id === id)?.nome ?? `Almox ${id}`;

  const linhasDeSaldo = (produtoId: number) =>
    [...saldos.entries()]
      .filter(([k]) => Number(k.split(':')[0]) === produtoId)
      .map(([k, v]) => {
        const [p, a] = k.split(':').map(Number);
        return {
          id: k,
          id_produto: String(p),
          produto_descricao: PRODUTOS[p]?.descricao,
          produto_unidade: '1',
          produto_tipo: PRODUTOS[p]?.tipo,
          produto_controla_estoque: PRODUTOS[p]?.controla_estoque,
          produto_ativo: 'S',
          id_almox: String(a),
          almox_descricao: nomeDoAlmox(a),
          saldo: String(v),
        };
      });

  const filtrarPecas = (params: { qtype: string; query: string; gridParam?: unknown }) => {
    const filtros: Array<{ TB: string; P: string }> = [
      { TB: params.qtype, P: params.query },
      ...((params.gridParam as Array<{ TB: string; P: string }>) ?? []),
    ];
    return pecas.filter((l) =>
      filtros.every((f) => String((l as unknown as Record<string, string>)[f.TB.replace('patrimonio.', '')]) === f.P),
    );
  };

  const ixc = {
    list: jest.fn(async (tabela: string, params: { qtype: string; query: string; gridParam?: unknown }) => {
      if (tabela === 'patrimonio') {
        const r = filtrarPecas(params);
        return { total: r.length, page: 1, registros: r };
      }
      return { total: 0, page: 1, registros: [] };
    }),
    listAll: jest.fn(async (tabela: string, params: { qtype: string; query: string; gridParam?: unknown }) => {
      if (tabela === 'estoque_produtos_almox_filial') {
        if (params.qtype.endsWith('id_produto')) return linhasDeSaldo(Number(params.query));
        const todos = new Set([...saldos.keys()].map((k) => Number(k.split(':')[0])));
        return [...todos].flatMap(linhasDeSaldo);
      }
      if (tabela === 'unidades') return [{ id: '1', sigla: 'UND' }];
      if (tabela === 'patrimonio') return filtrarPecas(params);
      return [];
    }),
    getById: jest.fn(async (tabela: string, _campo: string, id: number | string) => {
      if (tabela === 'patrimonio') return pecas.find((p) => p.id === String(id)) ?? null;
      if (tabela === 'produtos') return PRODUTOS[Number(id)] ?? null;
      return null;
    }),
    create: jest.fn(async (tabela: string, corpo: Record<string, string>) => {
      const id = ++proximo;
      if (tabela === 'transf_almox_top') {
        transferencias.set(id, { de: Number(corpo.id_almox_saida), para: Number(corpo.id_almox_entrada) });
        return { id, raw: {} };
      }
      if (tabela === 'transf_almox_item') {
        const recusa = recusas.shift();
        const t = transferencias.get(Number(corpo.id_transf_almox))!;
        const gravar = () => {
          if (corpo.id_patrimonio) {
            const p = pecas.find((x) => x.id === corpo.id_patrimonio)!;
            p.id_almoxarifado = String(t.para);
            mover(Number(corpo.id_produto), t.de, t.para, 1);
          } else {
            mover(Number(corpo.id_produto), t.de, t.para, Number(corpo.qtde));
          }
        };
        if (recusa) {
          if (recusa.grava) gravar();
          throw new Error('Ocorreu um erro ao processar. Contate o suporte IXC Soft.');
        }
        gravar();
        return { id, raw: {} };
      }
      if (tabela === 'entrada') {
        entradas.set(id, { ...corpo, id: String(id), status: 'A' });
        return { id, raw: {} };
      }
      if (tabela === 'movimento_produtos') {
        const produto = Number(corpo.id_produto);
        const almox = Number(corpo.id_almox);
        const quantidade = Number(corpo.quantidade);
        movimentos.set(id, { id, id_entrada: Number(corpo.id_entrada), produto, almox, quantidade });
        saldos.set(chave(produto, almox), (saldos.get(chave(produto, almox)) ?? 0) + quantidade);
        if (PRODUTOS[produto]?.tipo === 'P') {
          for (let i = 0; i < quantidade; i += 1) {
            pecas.push({ id: String(++proximo), id_produto: String(produto), id_almoxarifado: String(almox), situacao: '1', serial: `AUTO${i}`, serial_fornecedor: '', id_mac: '', id_movimento_produto: String(id) });
          }
        }
        return { id, raw: {} };
      }
      throw new Error(`create inesperado em ${tabela}`);
    }),
    remove: jest.fn(async (tabela: string, id: number | string) => {
      if (tabela === 'movimento_produtos') {
        const m = movimentos.get(Number(id))!;
        saldos.set(chave(m.produto, m.almox), (saldos.get(chave(m.produto, m.almox)) ?? 0) - m.quantidade);
        for (let i = pecas.length - 1; i >= 0; i -= 1) if (pecas[i].id_movimento_produto === String(id)) pecas.splice(i, 1);
        movimentos.delete(Number(id));
      }
      if (tabela === 'entrada') entradas.delete(Number(id));
      return { type: 'success' };
    }),
  };

  const estoque = new EstoqueService(ixc as never);
  const almoxarifados = opts.almoxarifados ?? [PRINCIPAL, ILNET, PERDAS];
  const produtos = {
    paraMovimentar: jest.fn(async () => [[{ id: 1, sigla: 'UND', descricao: 'Unidade' }], almoxarifados]),
    cadastrosPorId: jest.fn(async (ids: number[]) => new Map(ids.filter((i) => PRODUTOS[i]).map((i) => [i, PRODUTOS[i]]))),
    saldoPelosMovimentos: jest.fn(async (p: number, a: number) => saldos.get(chave(p, a)) ?? 0),
    entradaCrua: jest.fn(async (id: number) => ({
      entrada: entradas.get(id) ?? null,
      itens: [...movimentos.values()].filter((m) => m.id_entrada === id).map((m) => ({ id: String(m.id) })),
    })),
    ultimaEntradaDoFornecedor: jest.fn(async () => ({ entradaId: 3403, tipoDocumentoId: 203, condicaoPagamentoId: 1 })),
  };
  const transferenciasService = {
    acharPeca: jest.fn(async (codigo: string) => {
      const p = pecas.find((x) => [x.serial, x.serial_fornecedor, x.id_mac].includes(codigo));
      if (!p) throw new NotFoundException('nenhuma');
      return { descricao: 'ONU', almoxarifado: nomeDoAlmox(Number(p.id_almoxarifado)), situacao: 'disponível' };
    }),
  };
  const fornecedores = {
    buscarNoIxcPorNome: jest.fn(async () => [{ idFornecedor: 221, nome: 'Fornecedor Avulso' }]),
  };

  // O banco de mentira: só o que a conferência usa.
  const rodadas: Array<Record<string, unknown>> = [];
  const conferencias: Array<Record<string, unknown>> = [];
  const casa = (c: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v !== null && typeof v === 'object' && 'not' in (v as object)
        ? c[k] !== (v as { not: unknown }).not
        : c[k] === v,
    );
  const ordenar = (lista: Array<Record<string, unknown>>) =>
    [...lista].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || (b.seq as number) - (a.seq as number));
  let seq = 0;
  const prisma = {
    inventarioRodada: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rodadas.find((r) => casa(r, where)) ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const r = { id: `rodada-${rodadas.length + 1}`, iniciadoEm: new Date(), encerradoEm: null, ...data };
        rodadas.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = rodadas.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
    conferenciaDeEstoque: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const c = {
          id: `00000000-0000-4000-8000-${String(conferencias.length + 1).padStart(12, '0')}`,
          createdAt: new Date(),
          seq: ++seq,
          lancamentos: [],
          pendencias: [],
          pecas: null,
          erro: null,
          saldoDepois: null,
          terminadoEm: null,
          desfeitoEm: null,
          desfeitoPor: null,
          valorUnitario: null,
          ...data,
        };
        conferencias.push(c);
        return { ...c };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = conferencias.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { ...c };
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const c = conferencias.find((x) => x.id === where.id);
        return c ? { ...c } : null;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const c = ordenar(conferencias).find((x) => casa(x, where));
        return c ? { ...c } : null;
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        ordenar(conferencias).filter((x) => casa(x, where)).map((x) => ({ ...x })),
      ),
    },
  };

  const service = new ConferenciaService(
    prisma as never,
    ixc as never,
    estoque,
    produtos as never,
    transferenciasService as never,
    fornecedores as never,
  );
  service.esperaMaximaMs = 5_000;
  service.pausaAntesDeRepetirMs = 0;

  const peca = (over: Partial<Peca>): Peca => {
    const p: Peca = { id: String(++proximo), id_produto: '70', id_almoxarifado: '1', situacao: '1', serial: '', serial_fornecedor: '', id_mac: '', id_movimento_produto: '0', ...over };
    pecas.push(p);
    return p;
  };

  return {
    service,
    ixc,
    saldos,
    pecas,
    entradas,
    conferencias,
    recusas,
    saldo: (p: number, a: number) => saldos.get(chave(p, a)) ?? 0,
    porSaldo: (p: number, a: number, q: number) => saldos.set(chave(p, a), q),
    peca,
    escritas: () => ixc.create.mock.calls.length + ixc.remove.mock.calls.length,
  };
}

const eu = { nome: 'Aurelio' };

describe('ConferenciaService — produto comum', () => {
  it('faltou: 25 no IXC, contou 20 — as 5 vão para Perdas e Falhas', async () => {
    const t = montar();
    t.porSaldo(10, 1, 25);

    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu);

    expect(c.situacao).toBe('AJUSTADO');
    expect(c.saldoDepois).toBe(20);
    expect(t.saldo(10, 1)).toBe(20);
    expect(t.saldo(10, 43)).toBe(5);
    expect(c.lancamentos).toEqual([
      expect.objectContaining({ tipo: 'transferencia', motivo: 'falta', quantidade: 5, ok: true, para: { id: 43, nome: 'Perdas e Falhas' } }),
    ]);
    expect(c.lancamentosDitos[0]).toMatch(/^5 UND de Almoxarifado Principal para Perdas e Falhas \(transferência #\d+\)$/);
    expect(c.podeDesfazer).toBe(true);
  });

  it('sobrou: volta de Perdas o que tem lá, e o resto entra por compra com o valor informado', async () => {
    const t = montar();
    t.porSaldo(10, 1, 20);
    t.porSaldo(10, 43, 2);

    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 25, valorUnitario: 3.5 }, eu);

    expect(c.situacao).toBe('AJUSTADO');
    expect(t.saldo(10, 1)).toBe(25);
    expect(t.saldo(10, 43)).toBe(0);
    const compra = t.ixc.create.mock.calls.find(([tabela]) => tabela === 'entrada')![1];
    expect(compra).toMatchObject({ documento: DOCUMENTO_DA_CONFERENCIA, id_fornecedor: '221', tipo_documento: '203', valor_total: '10,50' });
    const item = t.ixc.create.mock.calls.find(([tabela]) => tabela === 'movimento_produtos')![1];
    expect(item).toMatchObject({ quantidade: '3.00000', valor_unitario: '3,50', id_almox: '1' });
    expect(c.valorUnitario).toBe(3.5);
  });

  it('conferiu 20 e depois achou mais 5: as 5 voltam de Perdas, sem compra e sem pedir valor', async () => {
    const t = montar();
    t.porSaldo(10, 1, 25);
    await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu);
    expect(t.saldo(10, 43)).toBe(5);

    // "Achei mais 5": a tela manda o saldo de agora (20) + 5.
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 25 }, eu);

    expect(c.situacao).toBe('AJUSTADO');
    expect(t.saldo(10, 1)).toBe(25);
    expect(t.saldo(10, 43)).toBe(0);
    expect(t.entradas.size).toBe(0);
    expect(c.lancamentos).toEqual([expect.objectContaining({ motivo: 'volta-de-perdas', quantidade: 5, ok: true })]);
  });

  it('ONU: conferiu, uma foi para Perdas, e apareceu — bipada, volta de Perdas', async () => {
    const t = montar();
    const a = t.peca({ serial: '1', serial_fornecedor: 'FHTTA' });
    const b = t.peca({ serial: '2', serial_fornecedor: 'FHTTB' });
    t.porSaldo(70, 1, 2);
    await t.service.conferir({ almoxId: 1, produtoId: 70, sistemaVisto: 2, pecasAchadas: [Number(a.id)] }, eu);
    expect(b.id_almoxarifado).toBe('43');

    // "Achei mais": as daqui vêm marcadas, e a que apareceu é bipada — o IXC a acha em Perdas.
    const c = await t.service.conferir(
      { almoxId: 1, produtoId: 70, sistemaVisto: 1, pecasAchadas: [Number(a.id)], pecasTrazidas: [Number(b.id)] },
      eu,
    );
    expect(c.situacao).toBe('AJUSTADO');
    expect(b.id_almoxarifado).toBe('1');
    expect(t.saldo(70, 1)).toBe(2);
    expect(t.saldo(70, 43)).toBe(0);
  });

  it('bateu: nada vai ao IXC', async () => {
    const t = montar();
    t.porSaldo(10, 1, 12);
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 12, contado: 12 }, eu);
    expect(c.situacao).toBe('BATEU');
    expect(t.escritas()).toBe(0);
    expect(c.podeDesfazer).toBe(false);
  });

  it('o saldo mudou no IXC depois de a tela ler: nada se lança', async () => {
    const t = montar();
    t.porSaldo(10, 1, 24);
    await expect(
      t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu),
    ).rejects.toThrow(ConflictException);
    expect(t.escritas()).toBe(0);
    expect(t.conferencias).toHaveLength(0);
  });

  it('sobrou sem valor: recusa antes de lançar qualquer coisa — nem a volta de Perdas', async () => {
    const t = montar();
    t.porSaldo(10, 1, 20);
    t.porSaldo(10, 43, 1);
    await expect(
      t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 25 }, eu),
    ).rejects.toThrow(/valor de cada unidade/);
    expect(t.escritas()).toBe(0);
    expect(t.saldo(10, 43)).toBe(1);
  });

  it('serviço, produto sem controle de estoque e Perdas que não existe: recusa, sem lançar', async () => {
    const t = montar();
    await expect(t.service.conferir({ almoxId: 1, produtoId: 80, sistemaVisto: 0, contado: 1 }, eu)).rejects.toThrow(/Serviço/);
    await expect(t.service.conferir({ almoxId: 1, produtoId: 90, sistemaVisto: 0, contado: 1 }, eu)).rejects.toThrow(/Controla estoque/);
    await expect(t.service.conferir({ almoxId: 43, produtoId: 10, sistemaVisto: 0, contado: 1 }, eu)).rejects.toThrow(/não se confere/);

    const semPerdas = montar({ almoxarifados: [PRINCIPAL, ILNET] });
    semPerdas.porSaldo(10, 1, 5);
    await expect(
      semPerdas.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 5, contado: 3 }, eu),
    ).rejects.toThrow(/Perdas e Falhas/);
    expect(t.escritas() + semPerdas.escritas()).toBe(0);
  });

  it('o IXC recusa o item e não grava: tenta de novo uma vez, e move uma vez só', async () => {
    const t = montar();
    t.porSaldo(10, 1, 10);
    t.recusas.push({ grava: false });
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 10, contado: 7 }, eu);
    expect(c.situacao).toBe('AJUSTADO');
    expect(t.saldo(10, 43)).toBe(3);
  });

  it('o IXC diz que recusou mas gravou: não manda de novo', async () => {
    const t = montar();
    t.porSaldo(10, 1, 10);
    t.recusas.push({ grava: true });
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 10, contado: 7 }, eu);
    expect(c.situacao).toBe('AJUSTADO');
    expect(t.saldo(10, 1)).toBe(7);
    expect(t.saldo(10, 43)).toBe(3);
    expect(t.ixc.create.mock.calls.filter(([tabela]) => tabela === 'transf_almox_item')).toHaveLength(1);
  });

  it('dois pedidos do mesmo produto ao mesmo tempo: o segundo é recusado', async () => {
    const t = montar();
    t.porSaldo(10, 1, 10);
    const [a, b] = await Promise.allSettled([
      t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 10, contado: 4 }, eu),
      t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 10, contado: 4 }, eu),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(t.saldo(10, 43)).toBe(6);
  });
});

describe('ConferenciaService — desfazer', () => {
  it('volta a compra (apagada) e a volta de Perdas, e o saldo fica o de antes', async () => {
    const t = montar();
    t.porSaldo(10, 1, 20);
    t.porSaldo(10, 43, 2);
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 25, valorUnitario: 3 }, eu);

    const d = await t.service.desfazer(c.id, eu);

    expect(d.situacao).toBe('DESFEITO');
    expect(t.saldo(10, 1)).toBe(20);
    expect(t.saldo(10, 43)).toBe(2);
    expect(t.entradas.size).toBe(0);
    expect(d.podeDesfazer).toBe(false);
    await expect(t.service.desfazer(c.id, eu)).rejects.toThrow(/já foi desfeita/);
  });

  it('alguém mexeu no saldo depois: não desfaz', async () => {
    const t = montar();
    t.porSaldo(10, 1, 25);
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu);
    t.porSaldo(10, 1, 19); // uma OS baixou uma
    const antes = t.escritas();
    await expect(t.service.desfazer(c.id, eu)).rejects.toThrow(/mudou depois da conferência/);
    expect(t.escritas()).toBe(antes);
  });

  it('só a mais nova do produto se desfaz', async () => {
    const t = montar();
    t.porSaldo(10, 1, 25);
    const primeira = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu);
    await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 18 }, eu);
    await expect(t.service.desfazer(primeira.id, eu)).rejects.toThrow(/mais nova/);
  });

  it('compra já finalizada no IXC: desfaz o que dá, e diz o que ficou', async () => {
    const t = montar();
    t.porSaldo(10, 1, 20);
    const c = await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 20, contado: 23, valorUnitario: 3 }, eu);
    for (const e of t.entradas.values()) e.status = 'F';
    const d = await t.service.desfazer(c.id, eu);
    expect(d.situacao).toBe('INCOMPLETO');
    expect(d.erro).toMatch(/finalizada/);
    expect(t.saldo(10, 1)).toBe(23);
  });
});

describe('ConferenciaService — patrimônio (ONU)', () => {
  it('por peça: a não achada vai para Perdas, a trazida vem da ILNET, a sem cadastro entra por compra', async () => {
    const t = montar();
    const a = t.peca({ serial: '36249', serial_fornecedor: 'FHTT0001' });
    const b = t.peca({ serial: '36250', serial_fornecedor: 'FHTT0002' });
    const sumiu = t.peca({ serial: '36251', serial_fornecedor: 'FHTT0003' });
    const daIlnet = t.peca({ id_almoxarifado: '4', serial: '40000', serial_fornecedor: 'FHTT0009' });
    t.porSaldo(70, 1, 3);
    t.porSaldo(70, 4, 1);

    const c = await t.service.conferir(
      {
        almoxId: 1,
        produtoId: 70,
        sistemaVisto: 3,
        pecasAchadas: [Number(a.id), Number(b.id)],
        pecasTrazidas: [Number(daIlnet.id)],
        codigosSemCadastro: ['FHTTNOVA01'],
        valorUnitario: 120,
      },
      eu,
    );

    expect(c.situacao).toBe('AJUSTADO');
    expect(c.contado).toBe(4);
    expect(t.saldo(70, 1)).toBe(4);
    expect(t.saldo(70, 4)).toBe(0);
    expect(t.saldo(70, 43)).toBe(1);
    expect(sumiu.id_almoxarifado).toBe('43');
    expect(daIlnet.id_almoxarifado).toBe('1');
    expect(c.lancamentos.find((l) => l.tipo === 'compra')).toMatchObject({ ok: true, pecasCriadas: ['nº AUTO0'] });
    expect(c.pendencias.some((p) => /sem MAC/.test(p))).toBe(true);
  });

  it('trazida que o IXC já tem aqui conta como achada — não vai para Perdas', async () => {
    const t = montar();
    const a = t.peca({ serial: '1', serial_fornecedor: 'FHTTA' });
    const b = t.peca({ serial: '2', serial_fornecedor: 'FHTTB' });
    t.porSaldo(70, 1, 2);
    const c = await t.service.conferir(
      { almoxId: 1, produtoId: 70, sistemaVisto: 2, pecasAchadas: [Number(a.id)], pecasTrazidas: [Number(b.id)] },
      eu,
    );
    expect(c.situacao).toBe('BATEU');
    expect(b.id_almoxarifado).toBe('1');
  });

  it('código "sem cadastro" que o IXC tem: recusa, sem lançar', async () => {
    const t = montar();
    const a = t.peca({ serial: '1', serial_fornecedor: 'FHTTA' });
    t.peca({ id_almoxarifado: '4', serial: '2', serial_fornecedor: 'FHTTB' });
    t.porSaldo(70, 1, 1);
    await expect(
      t.service.conferir(
        { almoxId: 1, produtoId: 70, sistemaVisto: 1, pecasAchadas: [Number(a.id)], codigosSemCadastro: ['FHTTB'], valorUnitario: 100 },
        eu,
      ),
    ).rejects.toThrow(/é de uma peça que o IXC tem/);
    expect(t.escritas()).toBe(0);
  });

  it('pela quantidade: o saldo sem peça que não se contou vai para Perdas', async () => {
    const t = montar();
    for (let i = 0; i < 3; i += 1) t.peca({ serial: String(100 + i), serial_fornecedor: `FHTT${i}` });
    t.porSaldo(70, 1, 10);
    const c = await t.service.conferir({ almoxId: 1, produtoId: 70, sistemaVisto: 10, contado: 5 }, eu);
    expect(c.situacao).toBe('AJUSTADO');
    expect(t.saldo(70, 1)).toBe(5);
    expect(t.saldo(70, 43)).toBe(5);
    expect(t.pecas.filter((p) => p.id_almoxarifado === '1')).toHaveLength(3);
  });

  it('pela quantidade, menos que as peças cadastradas: pede para bipar, sem lançar', async () => {
    const t = montar();
    for (let i = 0; i < 3; i += 1) t.peca({ serial: String(100 + i) });
    t.porSaldo(70, 1, 3);
    await expect(
      t.service.conferir({ almoxId: 1, produtoId: 70, sistemaVisto: 3, contado: 2 }, eu),
    ).rejects.toThrow(/bipe as que estão na prateleira/);
    expect(t.escritas()).toBe(0);
  });

  it('peça trazida de onde o saldo não a cobre: recusa (deixaria negativo lá)', async () => {
    const t = montar();
    const daIlnet = t.peca({ id_almoxarifado: '4', serial: '5', serial_fornecedor: 'FHTTZ' });
    t.porSaldo(70, 4, 0);
    await expect(
      t.service.conferir({ almoxId: 1, produtoId: 70, sistemaVisto: 0, pecasAchadas: [], pecasTrazidas: [Number(daIlnet.id)] }, eu),
    ).rejects.toThrow(BadRequestException);
    expect(t.escritas()).toBe(0);
  });

  it('desfazer por peça: a de Perdas volta, a trazida volta para a ILNET', async () => {
    const t = montar();
    const a = t.peca({ serial: '1', serial_fornecedor: 'FHTTA' });
    const sumiu = t.peca({ serial: '2', serial_fornecedor: 'FHTTB' });
    const daIlnet = t.peca({ id_almoxarifado: '4', serial: '3', serial_fornecedor: 'FHTTC' });
    t.porSaldo(70, 1, 2);
    t.porSaldo(70, 4, 1);
    const c = await t.service.conferir(
      { almoxId: 1, produtoId: 70, sistemaVisto: 2, pecasAchadas: [Number(a.id)], pecasTrazidas: [Number(daIlnet.id)] },
      eu,
    );
    expect(sumiu.id_almoxarifado).toBe('43');

    const d = await t.service.desfazer(c.id, eu);
    expect(d.situacao).toBe('DESFEITO');
    expect(sumiu.id_almoxarifado).toBe('1');
    expect(daIlnet.id_almoxarifado).toBe('4');
    expect(t.saldo(70, 1)).toBe(2);
    expect(t.saldo(70, 4)).toBe(1);
    expect(t.saldo(70, 43)).toBe(0);
  });
});

describe('ConferenciaService — rodada e lista', () => {
  it('a primeira conferência abre o inventário; a lista do almoxarifado mostra o conferido', async () => {
    const t = montar();
    t.porSaldo(10, 1, 25);
    t.porSaldo(70, 1, 0);
    await t.service.conferir({ almoxId: 1, produtoId: 10, sistemaVisto: 25, contado: 20 }, eu);

    const lista = await t.service.doAlmoxarifado(1);
    expect(lista.rodada).toMatchObject({ iniciadoPor: 'Aurelio', conferidos: 1 });
    expect(lista.rodada?.nome).toMatch(/^Inventário de \S+ de \d{4}$/);
    expect(lista.itens).toEqual([
      expect.objectContaining({ produtoId: 10, saldo: 20, conferencia: expect.objectContaining({ situacao: 'AJUSTADO' }) }),
    ]);

    const painel = await t.service.painel();
    expect(painel.perdas).toMatchObject({ id: 43 });
    expect(painel.almoxarifados.map((a) => a.id)).not.toContain(43);
    expect(painel.almoxarifados.find((a) => a.id === 1)).toMatchObject({ itens: 1, conferidos: 1 });
  });
});
