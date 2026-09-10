import { BadRequestException } from '@nestjs/common';
import {
  CartoesCreditoService,
  normalizarCompra,
  observacaoDaFatura,
  parcelasDaCompra,
} from './cartoes-credito.service';

/**
 * O cartão de crédito. O que este arquivo protege:
 *
 *  - cada parcela cai na fatura certa, e a soma das parcelas é a compra — sem
 *    o centavo que some ao dividir R$ 100 em três;
 *  - a fatura vira UMA conta a pagar, no valor da soma, e uma vez só;
 *  - fatura já lançada não muda de valor por baixo do título do IXC.
 */

function cartao(over: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    apelido: 'Sicoob Visa',
    final: '1234',
    idFornecedorIxc: 900,
    fornecedorNome: 'Banco Sicoob',
    diaDeVencimento: 15,
    contaContabil: 77,
    contaPagamento: 14,
    tipoPagamentoIxc: 'Boleto',
    categoriaId: null,
    ativo: true,
    ...over,
  };
}

function compra(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    cartaoId: 'k1',
    descricao: 'Posto Ipiranga',
    valorTotal: 120,
    parcelas: 1,
    parcelaInicial: 1,
    primeiraFatura: '2026-10',
    createdAt: new Date(),
    ...over,
  };
}

function montarServico(
  opts: {
    compras?: Record<string, unknown>[];
    /** As contas a pagar já ligadas ao cartão. */
    contas?: Record<string, unknown>[];
    /** Como a conta volta de `criarDespesa`. */
    criada?: Record<string, unknown>;
  } = {},
) {
  const compras = opts.compras ?? [];
  const contas = opts.contas ?? [];
  const criadas: Array<Record<string, unknown>> = [];
  const vinculos: Array<Record<string, unknown>> = [];

  const prisma = {
    cartaoCredito: {
      findUnique: jest.fn(async () => cartao()),
      findMany: jest.fn(async () => [{ ...cartao(), compras }]),
    },
    compraNoCartao: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          compras.find((c) => c.id === where.id) ?? null,
      ),
      findMany: jest.fn(async () => compras),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
    contaPagar: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { competencia?: string | { in: string[] } };
        }) => {
          const filtro = where.competencia;
          if (!filtro) return contas;
          const meses = typeof filtro === 'string' ? [filtro] : filtro.in;
          return contas.filter((c) => meses.includes(c.competencia as string));
        },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        vinculos.push(data);
        return { id: 'c1', ...data };
      }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const contasPagar = {
    criarDespesa: jest.fn(async (dados: Record<string, unknown>) => {
      criadas.push(dados);
      return {
        id: 'c1',
        idFnApagarIxc: 5555,
        status: 'APROVADO',
        erro: null,
        ...opts.criada,
      };
    }),
  };

  const categorias = { classificar: jest.fn().mockResolvedValue(undefined) };

  const service = new CartoesCreditoService(
    prisma as never,
    contasPagar as never,
    categorias as never,
  );
  return { service, prisma, contasPagar, criadas, vinculos };
}

describe('parcelasDaCompra', () => {
  it('divide em centavos e põe a sobra na primeira parcela', () => {
    const p = parcelasDaCompra({
      valorTotal: 100,
      parcelas: 3,
      parcelaInicial: 1,
      primeiraFatura: '2026-11',
    });
    expect(p.map((x) => x.valor)).toEqual([33.34, 33.33, 33.33]);
    expect(p.map((x) => x.competencia)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('a compra que já vinha sendo paga começa na parcela que a fatura mostra', () => {
    const p = parcelasDaCompra({
      valorTotal: 899,
      parcelas: 10,
      parcelaInicial: 3,
      primeiraFatura: '2026-10',
    });
    expect(p).toHaveLength(8);
    expect(p[0]).toEqual({ numero: 3, competencia: '2026-10', valor: 89.9 });
    expect(p[7]).toEqual({ numero: 10, competencia: '2027-05', valor: 89.9 });
  });
});

describe('normalizarCompra', () => {
  it('o valor da parcela vira o total da compra', () => {
    const c = normalizarCompra({
      descricao: ' Amazon ',
      valor: 89.9,
      valorDe: 'PARCELA',
      parcelas: 10,
      parcelaInicial: 3,
      primeiraFatura: '2026-10',
    });
    expect(c.valorTotal).toBe(899);
    expect(c.descricao).toBe('Amazon');
  });

  it('recusa parcela desta fatura maior que o número de parcelas', () => {
    expect(() =>
      normalizarCompra({
        descricao: 'X',
        valor: 10,
        parcelas: 3,
        parcelaInicial: 4,
        primeiraFatura: '2026-10',
      }),
    ).toThrow(BadRequestException);
  });

  it('recusa valor zero, mas aceita o estorno (negativo)', () => {
    const base = { descricao: 'X', parcelas: 1, primeiraFatura: '2026-10' };
    expect(() => normalizarCompra({ ...base, valor: 0 })).toThrow(
      BadRequestException,
    );
    expect(normalizarCompra({ ...base, valor: -25.5 }).valorTotal).toBe(-25.5);
  });
});

describe('observacaoDaFatura', () => {
  it('lista as compras, com a parcela quando há', () => {
    const texto = observacaoDaFatura(cartao(), '2026-10', [
      { descricao: 'Posto', parcela: 1, parcelas: 1, valor: 120 },
      { descricao: 'Amazon', parcela: 3, parcelas: 10, valor: 89.9 },
    ]);
    expect(texto).toBe(
      'Fatura Sicoob Visa final 1234 outubro/2026 - 2 lançamento(s): ' +
        'Posto 120,00; Amazon 3/10 89,90',
    );
  });

  it('não passa do teto do campo, e diz quantas ficaram de fora', () => {
    const itens = Array.from({ length: 60 }, (_, i) => ({
      descricao: `Loja numero ${i}`,
      parcela: 1,
      parcelas: 1,
      valor: 10,
    }));
    const texto = observacaoDaFatura(cartao(), '2026-10', itens);
    expect(texto.length).toBeLessThanOrEqual(500);
    expect(texto).toMatch(/; e mais \d+$/);
  });
});

describe('CartoesCreditoService.gerarFatura', () => {
  it('a fatura vira uma conta só, no valor da soma das parcelas do mês', async () => {
    const { service, criadas, vinculos } = montarServico({
      compras: [
        compra(),
        // 3x de 33,33 (+1 centavo na primeira), primeira em setembro: a de
        // outubro é a segunda parcela, 33,33.
        compra({ id: 'p2', descricao: 'Kalunga', valorTotal: 100, parcelas: 3, primeiraFatura: '2026-09' }),
        // Só começa em novembro: não entra.
        compra({ id: 'p3', descricao: 'Futura', valorTotal: 50, primeiraFatura: '2026-11' }),
      ],
    });

    const r = await service.gerarFatura('k1', '2026-10', {});

    expect(r.total).toBe(153.33);
    expect(r.itens).toBe(2);
    expect(criadas).toHaveLength(1);
    expect(criadas[0]).toMatchObject({
      idFornecedorIxc: 900,
      valor: 153.33,
      contaContabil: 77,
      contaPagamento: 14,
      tipoPagamentoIxc: 'Boleto',
    });
    // 15/10/2026 é quinta-feira: o dia do cadastro vale como está.
    expect((criadas[0].dataVencimento as Date).toISOString().slice(0, 10)).toBe(
      '2026-10-15',
    );
    expect(criadas[0].observacao).toContain('Kalunga 2/3 33,33');
    expect(vinculos[0]).toEqual({ cartaoCreditoId: 'k1', competencia: '2026-10' });
  });

  it('não lança a mesma fatura duas vezes', async () => {
    const { service, contasPagar } = montarServico({
      compras: [compra()],
      contas: [
        { id: 'c0', competencia: '2026-10', idFnApagarIxc: 4444, valor: 120, status: 'APROVADO' },
      ],
    });

    await expect(service.gerarFatura('k1', '2026-10', {})).rejects.toThrow(
      /já foi lançada \(título 4444/,
    );
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('fatura cancelada no IXC não trava o mês', async () => {
    const { service, criadas } = montarServico({
      compras: [compra()],
      contas: [
        { id: 'c0', competencia: '2026-10', idFnApagarIxc: 4444, valor: 120, status: 'CANCELADO' },
      ],
    });

    await service.gerarFatura('k1', '2026-10', {});
    expect(criadas).toHaveLength(1);
  });

  it('fatura vazia não vira conta', async () => {
    const { service, contasPagar } = montarServico({ compras: [] });
    await expect(service.gerarFatura('k1', '2026-10', {})).rejects.toThrow(
      /está vazia/,
    );
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('recusada pelo IXC, a conta daqui é apagada e a recusa sobe', async () => {
    const { service, prisma } = montarServico({
      compras: [compra()],
      criada: { idFnApagarIxc: null, status: 'ERRO', erro: 'fornecedor inválido' },
    });

    await expect(service.gerarFatura('k1', '2026-10', {})).rejects.toThrow(
      /fornecedor inválido/,
    );
    expect(prisma.contaPagar.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(prisma.contaPagar.update).not.toHaveBeenCalled();
  });

  it('o código da fatura decide boleto ou pix', async () => {
    const { service, criadas } = montarServico({ compras: [compra()] });
    const linha = '2'.repeat(47);
    await service.gerarFatura('k1', '2026-10', { codigo: linha });
    expect(criadas[0]).toMatchObject({ codigoBarras: linha, tipoPagamentoIxc: 'Boleto' });
  });
});

describe('CartoesCreditoService — fatura lançada não muda por baixo', () => {
  const lancadaEmOutubro = [
    { id: 'c0', competencia: '2026-10', idFnApagarIxc: 4444, valor: 120, status: 'APROVADO' },
  ];

  it('recusa compra nova que cairia numa fatura já lançada', async () => {
    const { service, prisma } = montarServico({ contas: lancadaEmOutubro });
    await expect(
      service.criarCompra('k1', {
        descricao: 'Esquecida',
        valor: 30,
        parcelas: 1,
        primeiraFatura: '2026-10',
      }),
    ).rejects.toThrow(/outubro\/2026 já virou conta a pagar no IXC \(título 4444/);
    expect(prisma.compraNoCartao.create).not.toHaveBeenCalled();
  });

  it('aceita a mesma compra na fatura seguinte', async () => {
    const { service, prisma } = montarServico({ contas: lancadaEmOutubro });
    await service.criarCompra('k1', {
      descricao: 'Esquecida',
      valor: 30,
      parcelas: 1,
      primeiraFatura: '2026-11',
    });
    expect(prisma.compraNoCartao.create).toHaveBeenCalled();
  });

  it('trocar só a descrição de uma compra já faturada passa', async () => {
    const { service, prisma } = montarServico({
      compras: [compra()],
      contas: lancadaEmOutubro,
    });
    await service.atualizarCompra('p1', { descricao: 'Posto Shell' });
    expect(prisma.compraNoCartao.update).toHaveBeenCalled();
  });

  it('mudar o valor de uma compra já faturada é recusado', async () => {
    const { service, prisma } = montarServico({
      compras: [compra()],
      contas: lancadaEmOutubro,
    });
    await expect(
      service.atualizarCompra('p1', { valor: 130, valorDe: 'TOTAL' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.compraNoCartao.update).not.toHaveBeenCalled();
  });

  it('apagar compra de fatura já lançada é recusado', async () => {
    const { service, prisma } = montarServico({
      compras: [compra()],
      contas: lancadaEmOutubro,
    });
    await expect(service.removerCompra('p1')).rejects.toThrow(BadRequestException);
    expect(prisma.compraNoCartao.delete).not.toHaveBeenCalled();
  });
});

describe('CartoesCreditoService.listar', () => {
  it('mostra os itens da fatura pedida e o que já está comprometido depois', async () => {
    const { service } = montarServico({
      compras: [
        compra(),
        compra({ id: 'p2', descricao: 'Notebook', valorTotal: 3000, parcelas: 10, primeiraFatura: '2026-09' }),
      ],
      contas: [
        { id: 'c0', cartaoCreditoId: 'k1', competencia: '2026-09', idFnApagarIxc: 4444, valor: 300, status: 'PAGO', pagoEm: new Date(), dataVencimento: new Date() },
      ],
    });

    const r = await service.listar('2026-10');
    const k = r.cartoes[0];

    expect(k.itens.map((i) => [i.descricao, i.parcela, i.valor])).toEqual([
      ['Posto Ipiranga', 1, 120],
      ['Notebook', 2, 300],
    ]);
    expect(k.total).toBe(420);
    expect(k.lancada).toBeNull();
    // Oito parcelas de 300 depois de outubro.
    expect(k.comprometidoDepois).toBe(2400);
    expect(k.faturas.map((f) => f.competencia)).toEqual([
      '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ]);
    expect(k.faturas[1].lancada?.idFnApagarIxc).toBe(4444);
  });
});
