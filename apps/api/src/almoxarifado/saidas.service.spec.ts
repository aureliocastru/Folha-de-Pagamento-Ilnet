import { SaidasService } from './saidas.service';

/**
 * A saída de material. O que este arquivo protege:
 *
 *  - o saldo sai no IXC por transferência para o almoxarifado "Saídas", e só
 *    depois a saída é registrada — registro sem transferência seria histórico
 *    de uma bucha que continua na prateleira;
 *  - inativo e patrimônio não saem por aqui;
 *  - não se tira de Perdas nem da própria Saídas.
 */

function produto(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    descricao: 'BUCHA 6',
    ativo: true,
    tipo: 'C',
    unidade: 'UN',
    saldos: [
      { almoxId: 1, almoxarifado: 'Almoxarifado Principal', saldo: 40 },
      { almoxId: 43, almoxarifado: 'Perdas e Falhas', saldo: 2, perdas: true },
    ],
    total: 40,
    ...over,
  };
}

function montar(over: Record<string, unknown> = {}) {
  const produtos = {
    detalhar: jest.fn().mockResolvedValue(produto(over)),
    paraMovimentar: jest
      .fn()
      .mockResolvedValue([[], [{ id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true }]]),
    transferir: jest.fn().mockResolvedValue({ transferenciaId: 3001 }),
  };
  const almoxarifados = {
    almoxDeSaidas: jest.fn().mockResolvedValue({ id: 50, nome: 'Saídas' }),
  };
  const prisma = {
    saidaDeEstoque: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 's1',
        createdAt: new Date(),
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new SaidasService(prisma as never, produtos as never, almoxarifados as never);
  return { service, produtos, almoxarifados, prisma };
}

const pedido = {
  almoxId: 1,
  quantidade: 1,
  destino: 'Obra do POP Centro',
  quemPegou: 'Cleyson',
  observacao: 'fixar a caixa',
};

describe('SaidasService.darSaida', () => {
  it('transfere para Saídas no IXC e registra pra onde foi e quem pegou', async () => {
    const { service, produtos, almoxarifados, prisma } = montar();

    const saida = await service.darSaida(7, pedido, { nome: 'Henrico' });

    expect(almoxarifados.almoxDeSaidas).toHaveBeenCalledWith(1, { nome: 'Henrico' });
    expect(produtos.transferir).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ de: 1, para: 50, quantidade: 1 }),
      { nome: 'Henrico' },
    );
    expect(prisma.saidaDeEstoque.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        produtoId: 7,
        almoxarifado: 'Almoxarifado Principal',
        destino: 'Obra do POP Centro',
        quemPegou: 'Cleyson',
        observacao: 'fixar a caixa',
        transferenciaIxcId: 3001,
        registradoPor: 'Henrico',
      }),
    });
    expect(saida).toMatchObject({ quantidade: 1, destino: 'Obra do POP Centro' });
  });

  it('se o IXC recusa a transferência, nada é registrado', async () => {
    const { service, produtos, prisma } = montar();
    produtos.transferir.mockRejectedValue(new Error('IXC fora do ar'));

    await expect(service.darSaida(7, pedido, { nome: 'Henrico' })).rejects.toThrow('IXC fora do ar');
    expect(prisma.saidaDeEstoque.create).not.toHaveBeenCalled();
  });

  it('inativo não sai', async () => {
    const { service, produtos } = montar({ ativo: false });

    await expect(service.darSaida(7, pedido, { nome: 'Henrico' })).rejects.toThrow(/inativo/);
    expect(produtos.transferir).not.toHaveBeenCalled();
  });

  it('patrimônio não sai por quantidade', async () => {
    const { service, produtos } = montar({ tipo: 'P' });

    await expect(service.darSaida(7, pedido, { nome: 'Henrico' })).rejects.toThrow(/patrimônio/);
    expect(produtos.transferir).not.toHaveBeenCalled();
  });

  it('não tira de Perdas e Falhas', async () => {
    const { service, produtos } = montar();

    await expect(
      service.darSaida(7, { ...pedido, almoxId: 43 }, { nome: 'Henrico' }),
    ).rejects.toThrow(/não tem saldo/);
    expect(produtos.transferir).not.toHaveBeenCalled();
  });
});

describe('SaidasService.historico', () => {
  it('sugere os nomes já usados, sem repetir', async () => {
    const { service, prisma } = montar();
    prisma.saidaDeEstoque.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { destino: 'Obra', quemPegou: 'Cleyson' },
        { destino: 'obra', quemPegou: 'CLEYSON' },
        { destino: 'Cliente Maria', quemPegou: 'Juan' },
      ]);

    const h = await service.historico(7);

    expect(h.destinos).toEqual(['Obra', 'Cliente Maria']);
    expect(h.pessoas).toEqual(['Cleyson', 'Juan']);
  });
});
