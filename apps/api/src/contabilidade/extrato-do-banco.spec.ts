import { ModobankClient } from '../modobank/modobank.client';
import {
  abaDoExtrato,
  conferirComOBanco,
  detalheDoQueNaoFecha,
  entraNoExtrato,
  fecharComOBanco,
  lerTransacao,
  ofxDoExtrato,
  pdfDoExtrato,
  resumoDoConsolidado,
  type ExtratoDoBanco,
} from './extrato-do-banco';
import { lerOfx } from './ofx';
import { montarPlanilha } from './planilha';

// Nomes, documentos e valores inventados: o repositório é público.
const pix = (over: Record<string, unknown> = {}) => ({
  id: 'a1b2',
  eventDate: '2026-10-05T13:30:00.000Z',
  status: 'LIQUIDATED',
  endToEndId: 'E123',
  creditDebitType: 'CREDIT',
  transactionType: 'PIX',
  transactionAmount: { currency: 'BRL', available: 150.5 },
  ...over,
});

describe('lerTransacao', () => {
  it('entrada e saída com sinal, no dia e hora de Brasília', () => {
    expect(lerTransacao(pix())).toMatchObject({
      dia: '2026-10-05',
      hora: '10:30',
      valor: 150.5,
      tipo: 'Pix',
      descricao: 'Pix recebido',
    });
    expect(lerTransacao(pix({ creditDebitType: 'DEBIT' }))?.valor).toBe(-150.5);
    expect(lerTransacao(pix({ transactionType: 'BILLET', creditDebitType: 'DEBIT' }))?.descricao).toBe('Boleto pago');
  });

  it('o Pix das 22h do dia 31 é do dia 31, ainda que em UTC seja dia 1º', () => {
    expect(lerTransacao(pix({ eventDate: '2026-11-01T01:30:00Z' }))).toMatchObject({ dia: '2026-10-31', hora: '22:30' });
  });

  it('valor em texto e nome de quem pagou, quando vêm', () => {
    const l = lerTransacao(
      pix({
        transactionAmount: { available: '1234.56' },
        debtorAccount: { name: 'Fulano de Tal', document: '11122233344' },
      }),
    );
    expect(l).toMatchObject({ valor: 1234.56, contraparte: 'Fulano de Tal', documento: '11122233344' });
  });

  it('sem valor ou sem data não vira linha', () => {
    expect(lerTransacao(pix({ transactionAmount: {} }))).toBeNull();
    expect(lerTransacao(pix({ eventDate: 'ontem' }))).toBeNull();
  });

  it('só o dinheiro que andou entra', () => {
    expect(entraNoExtrato('LIQUIDATED')).toBe(true);
    expect(entraNoExtrato('REFUNDED')).toBe(true);
    expect(entraNoExtrato('')).toBe(true);
    expect(entraNoExtrato('CANCELED')).toBe(false);
    expect(entraNoExtrato('WAITING_APPROVAL')).toBe(false);
  });
});

describe('conferência com o saldo do banco', () => {
  const lancs = [
    lerTransacao(pix({ transactionAmount: { available: 100 } }))!,
    lerTransacao(pix({ id: 'b', creditDebitType: 'DEBIT', transactionAmount: { available: 30.25 } }))!,
  ];
  const resumo = resumoDoConsolidado([
    { periodDate: '2026-10-02', creditAmount: 0, debitAmount: '-30.25', initialBalance: 1100, finalBalance: '1069.75' },
    { periodDate: '2026-10-01', creditAmount: 100, debitAmount: 0, initialBalance: 1000, finalBalance: 1100 },
  ]);

  it('o resumo junta os dias: inicial do primeiro, final do último', () => {
    expect(resumo).toMatchObject({ saldoInicial: 1000, saldoFinal: 1069.75, entradas: 100, saidas: 30.25 });
  });

  it('fecha ao centavo', () => {
    const c = conferirComOBanco(lancs, resumo);
    expect(c.aviso).toBeNull();
    expect(c.frase).toContain('Conferido com o banco');
  });

  it('faltou um lançamento: avisa com a diferença', () => {
    const c = conferirComOBanco(lancs.slice(0, 1), resumo);
    expect(c.aviso).toMatch(/não fecham.*30,25/);
  });

  it('sem o saldo do banco, não acusa nada', () => {
    expect(conferirComOBanco(lancs, null).aviso).toBeNull();
  });
});

describe('fecharComOBanco', () => {
  const l = (id: string, dia: string, valor: number, status: string) =>
    lerTransacao(
      pix({
        id,
        eventDate: `${dia}T15:00:00Z`,
        status,
        creditDebitType: valor > 0 ? 'CREDIT' : 'DEBIT',
        transactionAmount: { available: Math.abs(valor) },
      }),
    )!;
  const todos = [
    l('a', '2026-10-01', 100, 'LIQUIDATED'),
    l('b', '2026-10-01', -30, 'LIQUIDATED'),
    l('c', '2026-10-02', -50, 'REFUNDED'), // o banco não conta: saiu e voltou
    l('d', '2026-10-02', -20, 'LIQUIDATED'),
    l('e', '2026-10-02', -999, 'CANCELED'),
  ];
  const resumo = resumoDoConsolidado([
    { periodDate: '2026-10-01', creditAmount: 100, debitAmount: -30, initialBalance: 0, finalBalance: 70 },
    { periodDate: '2026-10-02', creditAmount: 0, debitAmount: -20, initialBalance: 70, finalBalance: 50 },
  ]);

  it('acha pela soma a situação que o banco não conta, e o extrato fecha', () => {
    const f = fecharComOBanco(todos, resumo);
    expect(f.tiradasPelaSoma).toEqual(['REFUNDED']);
    expect(f.lancamentos.map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(conferirComOBanco(f.lancamentos, resumo).aviso).toBeNull();
    expect(f.porSituacao.REFUNDED).toEqual({ n: 1, entradas: 0, saidas: 50 });
  });

  it('já fechando, não tira nada além da lista fixa', () => {
    const f = fecharComOBanco(todos.filter((x) => x.id !== 'c'), resumo);
    expect(f.tiradasPelaSoma).toEqual([]);
    expect(f.lancamentos.map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });

  it('não fechando de jeito nenhum, aponta o dia que não bate', () => {
    const errado = [...todos.filter((x) => x.id !== 'c'), l('f', '2026-10-02', -7, 'LIQUIDATED')];
    const f = fecharComOBanco(errado, resumo);
    expect(f.diasQueNaoBatem).toEqual([
      { dia: '2026-10-02', entradas: 0, saidas: 27, bancoEntradas: 0, bancoSaidas: 20 },
    ]);
    expect(detalheDoQueNaoFecha(f)).toMatch(/02\/10\/2026: saídas R\$\s27,00 × banco R\$\s20,00/);
  });
});

function extrato(n: number): ExtratoDoBanco {
  const lancamentos = Array.from({ length: n }, (_, i) =>
    lerTransacao(
      pix({
        id: `id-${i}`,
        eventDate: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T15:00:00Z`,
        creditDebitType: i % 3 === 0 ? 'DEBIT' : 'CREDIT',
        transactionAmount: { available: 10 + i },
        debtorAccount: { name: `Cliente <${i}> & Cia` },
        creditorAccount: { name: `Fornecedor Ação ${i}` },
      }),
    )!,
  ).sort((a, b) => a.dia.localeCompare(b.dia));
  return {
    conta: { nome: 'Conta Exemplo PIX', banco: '999', agencia: '0001', numero: '12345' },
    de: '2026-10-01',
    ate: '2026-10-31',
    geradoEm: new Date('2026-11-04T19:00:00Z'),
    lancamentos,
    saldoInicial: 500,
    saldoFinal: 500 + lancamentos.reduce((s, l) => s + l.valor, 0),
    conferencia: 'Conferido com o banco.',
  };
}

describe('os arquivos', () => {
  it('o OFX volta inteiro pelo leitor do próprio sistema', () => {
    const e = extrato(40);
    const lido = lerOfx(ofxDoExtrato(e));
    expect(lido).toMatchObject({ banco: '999', agencia: '0001', conta: '12345', inicio: '2026-10-01', fim: '2026-10-31' });
    expect(lido.lancamentos).toHaveLength(40);
    const soma = (xs: Array<{ valor: number }>) => Math.round(xs.reduce((s, l) => s + l.valor, 0) * 100);
    expect(soma(lido.lancamentos)).toBe(soma(e.lancamentos));
    expect(lido.saldoFinal).toBeCloseTo(e.saldoFinal!, 2);
    // O acento passa (Windows-1252), e `<`/`&` não quebram o arquivo.
    expect(lido.lancamentos.find((l) => l.valor < 0)?.descricao).toContain('Fornecedor Ação');
  });

  it('PDF de várias páginas, sem página em branco do rodapé', async () => {
    const pdf = await pdfDoExtrato(extrato(300));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const paginas = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(paginas).toBeGreaterThan(3);
    expect(paginas).toBeLessThan(12);
  });

  it('a planilha sai', async () => {
    const xlsx = await montarPlanilha([abaDoExtrato(extrato(5))]);
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('ModobankClient.transacoes — a paginação', () => {
  const cliente = (responder: (offset: number) => unknown[], total?: number) => {
    const c = new ModobankClient({} as never);
    const pedidos: number[] = [];
    (c as unknown as { pedir: (m: string, url: string) => Promise<unknown> }).pedir = async (_m, url) => {
      const offset = Number(new URL(`http://x${url}`).searchParams.get('page_offset'));
      pedidos.push(offset);
      return { meta: total !== undefined ? { total } : undefined, data: responder(offset) };
    };
    return { c, pedidos };
  };
  const itens = (de: number, ate: number) =>
    Array.from({ length: Math.max(0, ate - de) }, (_, i) => ({ id: `t${de + i}` }));

  it('offset por posição de item: 250 lançamentos em 3 páginas, nenhum repetido', async () => {
    const { c } = cliente((o) => itens(o, Math.min(o + 100, 250)), 250);
    const r = await c.transacoes('2026-10-01', '2026-10-31');
    expect(r.itens).toHaveLength(250);
    expect(new Set(r.itens.map((x) => x.id)).size).toBe(250);
  });

  it('offset por número de página: 250 lançamentos, nenhum pulado', async () => {
    const { c } = cliente((p) => itens(p * 100, Math.min(p * 100 + 100, 250)), 250);
    const r = await c.transacoes('2026-10-01', '2026-10-31');
    expect(r.itens).toHaveLength(250);
    expect(r.total).toBe(250);
  });

  it('uma página só: um pedido', async () => {
    const { c, pedidos } = cliente(() => itens(0, 7));
    expect((await c.transacoes('2026-10-01', '2026-10-31')).itens).toHaveLength(7);
    expect(pedidos).toEqual([0]);
  });

  it('exatamente 200: para na página vazia', async () => {
    const { c } = cliente((p) => itens(p * 100, Math.min(p * 100 + 100, 200)));
    expect((await c.transacoes('2026-10-01', '2026-10-31')).itens).toHaveLength(200);
  });
});
