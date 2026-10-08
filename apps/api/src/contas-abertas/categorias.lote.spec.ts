import { NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';

/**
 * Classificar em massa é o que torna utilizável a etiqueta de despesa: são
 * quinhentos títulos em aberto, e um por um ninguém faria. O que este arquivo
 * protege:
 *
 *  - a mesma etiqueta chega a todos os títulos marcados, sem repetição;
 *  - trocar a etiqueta de quem já tinha uma não deixa duas para o mesmo título;
 *  - categoria inexistente não etiqueta nada — melhor recusar que gravar lixo
 *    no eixo dos relatórios.
 */

function montarServico(opts: { categoria?: unknown } = {}) {
  const prisma = {
    categoriaDespesa: {
      findUnique: jest.fn().mockResolvedValue(
        'categoria' in opts ? opts.categoria : { id: 'cat-1', nome: 'Energia' },
      ),
    },
    classificacaoConta: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    despesaRecorrente: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // A transação devolve o que as operações devolveriam; aqui só interessa
    // que as duas foram entregues juntas.
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };

  const service = new CategoriasService(prisma as never);
  return { service, prisma };
}

describe('CategoriasService.classificarEmLote', () => {
  it('etiqueta todos os títulos marcados de uma vez', async () => {
    const { service, prisma } = montarServico();

    const total = await service.classificarEmLote([10, 20, 30], 'cat-1', 'u1');

    expect(total).toBe(3);
    expect(prisma.classificacaoConta.createMany).toHaveBeenCalledWith({
      data: [
        { idFnApagar: 10, categoriaId: 'cat-1', classificadoPor: 'u1' },
        { idFnApagar: 20, categoriaId: 'cat-1', classificadoPor: 'u1' },
        { idFnApagar: 30, categoriaId: 'cat-1', classificadoPor: 'u1' },
      ],
    });
  });

  /*
   * A mensal cadastrada sem categoria gerava todo mês uma conta sem
   * classificação; classificada a conta dela, as próximas nascem com a mesma.
   */
  it('a mensal que gerou a conta passa a nascer com a categoria dada', async () => {
    const { service, prisma } = montarServico();

    await service.classificarEmLote([10, 20], 'cat-1');

    expect(prisma.despesaRecorrente.updateMany).toHaveBeenCalledWith({
      where: { contas: { some: { idFnApagarIxc: { in: [10, 20] } } } },
      data: { categoriaId: 'cat-1' },
    });
  });

  it('apaga a etiqueta antiga antes de gravar a nova, na mesma transação', async () => {
    const { service, prisma } = montarServico();

    await service.classificarEmLote([10, 20], 'cat-1');

    // Sem o deleteMany, o título que já tinha categoria ganharia uma segunda e
    // o mesmo gasto seria contado em duas fatias do painel.
    expect(prisma.classificacaoConta.deleteMany).toHaveBeenCalledWith({
      where: { idFnApagar: { in: [10, 20] } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('título repetido na seleção conta uma vez só', async () => {
    const { service, prisma } = montarServico();

    const total = await service.classificarEmLote([10, 10, 20], 'cat-1');

    expect(total).toBe(2);
    const { data } = prisma.classificacaoConta.createMany.mock.calls[0][0] as {
      data: unknown[];
    };
    expect(data).toHaveLength(2);
  });

  it('categoria vazia tira a etiqueta de todos', async () => {
    const { service, prisma } = montarServico();

    const total = await service.classificarEmLote([10, 20], null);

    expect(total).toBe(2);
    expect(prisma.classificacaoConta.createMany).not.toHaveBeenCalled();
    expect(prisma.classificacaoConta.deleteMany).toHaveBeenCalledWith({
      where: { idFnApagar: { in: [10, 20] } },
    });
  });

  it('categoria que não existe não etiqueta nada', async () => {
    const { service, prisma } = montarServico({ categoria: null });

    await expect(
      service.classificarEmLote([10], 'sumiu'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('seleção vazia não vai ao banco', async () => {
    const { service, prisma } = montarServico();

    expect(await service.classificarEmLote([], 'cat-1')).toBe(0);
    expect(prisma.classificacaoConta.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
