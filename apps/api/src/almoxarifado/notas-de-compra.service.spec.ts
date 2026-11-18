import { NotasDeCompraService, conferirParcelas, totalDosItens } from './notas-de-compra.service';
import { mesmaNota, numeroDaNotaParaIxc } from './produtos.service';

/**
 * A nota de compra do almoxarifado. O que este arquivo protege:
 *
 *  - lançar a nota põe os produtos no IXC e **não** cria conta a pagar;
 *  - as contas só nascem na confirmação, uma por parcela, e nunca em dobro;
 *  - a mesma nota do mesmo fornecedor não entra duas vezes no estoque.
 */

const PEDIDO = {
  fornecedorId: 14,
  fornecedorNome: 'Fornecedor Exemplo',
  numeroNota: '1234',
  dataEmissao: '2026-11-13',
  almoxId: 1,
  itens: [
    { produtoId: 10, quantidade: 10, valorUnitario: 4.5 },
    { produtoId: 20, quantidade: 2, valorUnitario: 77.5 },
  ],
  parcelas: [
    { vencimento: '2026-12-13', valor: 100 },
    { vencimento: '2027-01-13', valor: 100 },
  ],
};

function montar(existente: Record<string, unknown> | null = null) {
  let guardada: Record<string, unknown> | null = existente;
  const prisma = {
    notaDeCompra: {
      findFirst: jest.fn(async () => existente),
      findUnique: jest.fn(async () => guardada),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        guardada = { id: 'nota-1', createdAt: new Date(), decididaPor: null, motivoDaRecusa: null, ...data };
        return guardada;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        guardada = { ...guardada, ...data };
        return guardada;
      }),
      delete: jest.fn(async () => {
        guardada = null;
        return {};
      }),
    },
    contaPagar: {
      findFirst: jest.fn(async ({ where }: { where: { idFnApagarIxc: number } }) => ({
        id: `conta-${where.idFnApagarIxc}`,
      })),
    },
    classificacaoConta: { upsert: jest.fn(async () => ({})) },
  };
  const produtos = {
    lancarCompra: jest.fn(async (d: typeof PEDIDO) => ({
      entradaId: 3600,
      almoxarifado: 'ILNET',
      compraAberta: null,
      itens: d.itens.map((i) => ({
        ...i,
        descricao: `Produto ${i.produtoId}`,
        unidade: 'UND',
        entrou: true,
        motivo: null,
      })),
    })),
    desfazerCompra: jest.fn(async () => ({ ok: true }) as { ok: boolean; erro?: string }),
  };
  let proximo = 9000;
  const contasPagar = {
    criarDespesa: jest.fn(async (_dados: Record<string, unknown>) => ({
      id: 'c',
      idFnApagarIxc: ++proximo,
    })),
  };
  (contasPagar as Record<string, unknown>).remover = jest.fn(async () => undefined);
  /** Os títulos no IXC: todos em aberto, a menos que o teste diga outra coisa. */
  const ixc = {
    getById: jest.fn(async (): Promise<Record<string, unknown> | null> => ({ status: 'A', valor_pago: '0.00', valor_aberto: '100.00' })),
    remove: jest.fn(async () => undefined),
  };
  const patrimonios = {
    ultimaPeca: jest.fn(async () => 32067),
    pecasCriadas: jest.fn(async (): Promise<Array<Record<string, unknown>>> => []),
    numerar: jest.fn(async (linhas: Array<Record<string, unknown>>) =>
      linhas.map((l, n) => ({ patrimonioId: Number(l.id), numero: 37871 + n })),
    ),
  };
  const precos = { daNota: jest.fn(async () => undefined) };
  const service = new NotasDeCompraService(
    prisma as never,
    produtos as never,
    contasPagar as never,
    ixc as never,
    patrimonios as never,
    precos as never,
  );
  return { service, prisma, produtos, contasPagar: contasPagar as typeof contasPagar & { remover: jest.Mock }, ixc, patrimonios, precos };
}

describe('a nota de compra do almoxarifado', () => {
  it('a peça de patrimônio que a nota cria recebe o número da casa, e ele fica na nota', async () => {
    const { service, produtos, patrimonios } = montar();
    produtos.lancarCompra.mockImplementationOnce(async (d: typeof PEDIDO) => ({
      entradaId: 3600,
      almoxarifado: 'ILNET',
      compraAberta: null,
      itens: d.itens.map((i) => ({
        ...i,
        descricao: `Produto ${i.produtoId}`,
        unidade: 'UND',
        entrou: true,
        motivo: null,
        ...(i.produtoId === 20 ? { patrimonio: true } : {}),
      })),
    }));
    patrimonios.pecasCriadas.mockResolvedValueOnce([{ id: '32068' }, { id: '32069' }]);
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    // Só o produto de patrimônio, e procurado depois da última peça de antes da nota.
    expect(patrimonios.pecasCriadas).toHaveBeenCalledTimes(1);
    expect(patrimonios.pecasCriadas).toHaveBeenCalledWith(32067, 20, 1);
    expect(nota.itens.find((i) => i.produtoId === 20)?.pecas).toEqual([
      { patrimonioId: 32068, numero: 37871 },
      { patrimonioId: 32069, numero: 37872 },
    ]);
    expect(nota.itens.find((i) => i.produtoId === 10)?.pecas).toBeUndefined();
  });

  it('numerar falhar não derruba a nota: o estoque já entrou', async () => {
    const { service, produtos, patrimonios } = montar();
    produtos.lancarCompra.mockImplementationOnce(async (d: typeof PEDIDO) => ({
      entradaId: 3600,
      almoxarifado: 'ILNET',
      compraAberta: null,
      itens: d.itens.map((i) => ({ ...i, descricao: 'X', unidade: 'UND', entrou: true, motivo: null, patrimonio: true })),
    }));
    patrimonios.pecasCriadas.mockRejectedValue(new Error('IXC fora'));
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    expect(nota.situacao).toBe('AGUARDANDO');
    expect(nota.itens[0].pecas?.[0]).toMatchObject({ numero: null, erro: 'IXC fora' });
  });

  it('lançar põe os produtos no IXC e não cria conta: fica aguardando', async () => {
    const { service, produtos, contasPagar } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    expect(produtos.lancarCompra).toHaveBeenCalledTimes(1);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
    expect(nota).toMatchObject({ situacao: 'AGUARDANDO', valorTotal: 200, entradaId: 3600 });
  });

  it('o preço que a nota pagou vai para o preço do produto', async () => {
    const { service, precos } = montar();
    await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    expect(precos.daNota).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ produtoId: 10, valorUnitario: 4.5, entrou: true })]),
      '1234',
      { nome: 'Almoxarife' },
    );
  });

  it('sem parcela nenhuma, não há o que confirmar', async () => {
    const { service } = montar();
    const nota = await service.lancar({ ...PEDIDO, parcelas: [] }, { nome: 'Almoxarife' });
    expect(nota.situacao).toBe('SEM_CONTA');
  });

  it('parcelas que não somam o total param antes de tocar no IXC', async () => {
    const { service, produtos } = montar();
    await expect(
      service.lancar(
        { ...PEDIDO, parcelas: [{ vencimento: '2026-12-13', valor: 150 }] },
        { nome: 'Almoxarife' },
      ),
    ).rejects.toThrow(/parcelas somam/);
    expect(produtos.lancarCompra).not.toHaveBeenCalled();
  });

  it('a mesma nota do mesmo fornecedor não entra duas vezes', async () => {
    const { service, produtos } = montar({
      fornecedorNome: 'Fornecedor Exemplo',
      lancadaPor: 'Outro',
      idEntradaIxc: 3500,
    });
    await expect(service.lancar(PEDIDO, { nome: 'Almoxarife' })).rejects.toThrow(/já foi lançada/);
    expect(produtos.lancarCompra).not.toHaveBeenCalled();
  });

  it('confirmar cria uma conta por parcela, e a que já virou conta não vira de novo', async () => {
    const { service, contasPagar } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });

    // O IXC cai na segunda parcela: a primeira fica gravada.
    contasPagar.criarDespesa
      .mockResolvedValueOnce({ id: 'c', idFnApagarIxc: 9001 })
      .mockRejectedValueOnce(new Error('IXC fora'));
    await expect(service.confirmar(nota.id, {}, { nome: 'Chefe' })).rejects.toThrow(/parcela 2/);

    const confirmada = await service.confirmar(nota.id, {}, { nome: 'Chefe' });
    expect(contasPagar.criarDespesa).toHaveBeenCalledTimes(3);
    expect(confirmada.situacao).toBe('CONFIRMADA');
    expect(confirmada.parcelas.map((p) => p.idFnApagar)).toEqual([9001, expect.any(Number)]);
    expect(contasPagar.criarDespesa.mock.calls[0][0]).toMatchObject({
      idFornecedorIxc: 14,
      valor: 100,
      numeroNota: '1234',
      observacao: 'NF 1234 · parcela 1/2 · 10 Produto 10, 2 Produto 20',
    });

    await expect(service.confirmar(nota.id, {}, { nome: 'Chefe' })).rejects.toThrow(/já foi decidida/);
  });

  it('recusar não cria conta nenhuma', async () => {
    const { service, contasPagar } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    const recusada = await service.recusar(nota.id, 'já foi paga no caixa', { nome: 'Chefe' });
    expect(recusada).toMatchObject({ situacao: 'RECUSADA', motivoDaRecusa: 'já foi paga no caixa' });
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });
});

describe('desfazer a nota', () => {
  it('apaga as contas, desfaz a compra no IXC e a nota some', async () => {
    const { service, prisma, produtos, contasPagar } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    await service.confirmar(nota.id, {}, { nome: 'Chefe' });

    await expect(service.desfazer(nota.id, { nome: 'Almoxarife' })).resolves.toEqual({ desfeita: true });
    expect(contasPagar.remover).toHaveBeenCalledTimes(2);
    expect(produtos.desfazerCompra).toHaveBeenCalledWith(
      3600,
      { numeroNota: '1234', fornecedorId: 14 },
      { nome: 'Almoxarife' },
    );
    expect(prisma.notaDeCompra.delete).toHaveBeenCalledTimes(1);
  });

  it('uma conta já paga para tudo, antes de mexer em qualquer coisa', async () => {
    const { service, prisma, produtos, contasPagar, ixc } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    await service.confirmar(nota.id, {}, { nome: 'Chefe' });
    ixc.getById.mockResolvedValueOnce({ status: 'A' }).mockResolvedValueOnce({ status: 'P' });

    await expect(service.desfazer(nota.id, { nome: 'Almoxarife' })).rejects.toThrow(/já foi paga/);
    expect(contasPagar.remover).not.toHaveBeenCalled();
    expect(produtos.desfazerCompra).not.toHaveBeenCalled();
    expect(prisma.notaDeCompra.delete).not.toHaveBeenCalled();
  });

  it('compra que o IXC não desfaz deixa a nota aqui, já sem as contas', async () => {
    const { service, prisma, produtos } = montar();
    const nota = await service.lancar(PEDIDO, { nome: 'Almoxarife' });
    await service.confirmar(nota.id, {}, { nome: 'Chefe' });
    produtos.desfazerCompra.mockResolvedValueOnce({ ok: false, erro: 'o IXC não tirou o produto' });

    await expect(service.desfazer(nota.id, { nome: 'Almoxarife' })).rejects.toThrow(/compra não foi desfeita/);
    expect(prisma.notaDeCompra.delete).not.toHaveBeenCalled();
    // De novo: não há mais conta para apagar, e a compra agora vai.
    await expect(service.desfazer(nota.id, { nome: 'Almoxarife' })).resolves.toEqual({ desfeita: true });
  });

  it('nota sem conta nenhuma só desfaz a compra', async () => {
    const { service, produtos, contasPagar } = montar();
    const nota = await service.lancar({ ...PEDIDO, parcelas: [] }, { nome: 'Almoxarife' });
    await service.desfazer(nota.id, { nome: 'Almoxarife' });
    expect(contasPagar.remover).not.toHaveBeenCalled();
    expect(produtos.desfazerCompra).toHaveBeenCalledTimes(1);
  });
});

describe('o número da nota e o IXC', () => {
  it('vai ao IXC só com os algarismos, e a nota guardada é a mesma', async () => {
    expect(numeroDaNotaParaIxc(' 166.192.941 ')).toBe('166192941');
    expect(numeroDaNotaParaIxc('NF-A12')).toBe('NF-A12');
    const { service, produtos } = montar();
    const nota = await service.lancar({ ...PEDIDO, numeroNota: '166.192.941' }, { nome: 'Almoxarife' });
    expect(nota.numeroNota).toBe('166192941');
    expect(produtos.lancarCompra.mock.calls[0][0]).toMatchObject({ numeroNota: '166192941' });
  });

  it('a compra que o IXC gravou com o número cortado ainda é reconhecida', () => {
    // A #3546: digitado "166.192.941", gravado "166192".
    expect(mesmaNota('166192', '166.192.941')).toBe(true);
    expect(mesmaNota('166192941', '166192941')).toBe(true);
    expect(mesmaNota('2427546', '166.192.941')).toBe(false);
    expect(mesmaNota('', '166.192.941')).toBe(false);
  });
});

describe('as contas da nota', () => {
  it('o total soma linha a linha, ao centavo', () => {
    expect(totalDosItens([{ quantidade: 3, valorUnitario: 0.33 }, { quantidade: 1.5, valorUnitario: 10 }])).toBe(15.99);
  });

  it('parcelas fecham com o total ou são recusadas', () => {
    expect(() => conferirParcelas([{ vencimento: '2026-12-01', valor: 15.99 }], 15.99)).not.toThrow();
    expect(() => conferirParcelas([], 15.99)).not.toThrow();
    expect(() => conferirParcelas([{ vencimento: '2026-12-01', valor: 15.98 }], 15.99)).toThrow();
  });
});
