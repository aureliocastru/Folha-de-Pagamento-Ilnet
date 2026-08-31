import { BadRequestException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';

/**
 * O cadastro de categorias passou a ter dois níveis: "Veículos" agrupa "Compra
 * de veículos" e "Manutenção de veículos". O que este arquivo protege é a
 * forma da árvore, porque é dela que o dashboard depende para somar:
 *
 *  - nada de terceiro nível — gasto pendurado num neto não entraria em soma
 *    nenhuma, e ninguém veria que ele sumiu;
 *  - ninguém é mãe de si mesma, que é o mesmo buraco por outro caminho;
 *  - "não mexeu na mãe" e "tirou do grupo" são pedidos diferentes: renomear
 *    uma subcategoria não pode soltá-la do grupo de brinde;
 *  - a etiqueta que sai para as telas leva o grupo junto, senão cada linha da
 *    lista viraria uma consulta a mais para descobrir de quem ela é filha.
 */

interface Fixa {
  id: string;
  nome: string;
  paiId: string | null;
}

function montarServico(catalogo: Fixa[]) {
  const porId = new Map(catalogo.map((c) => [c.id, c]));

  const categoriaDespesa = {
    findUnique: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(porId.get(where.id) ?? null),
    ),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn(({ where }: { where: { paiId: string } }) =>
      Promise.resolve(catalogo.filter((c) => c.paiId === where.paiId).length),
    ),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...data, pai: null }),
    ),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        ...data,
        pai: null,
        _count: { classificacoes: 0, filhas: 0 },
      }),
    ),
  };

  const prisma = {
    categoriaDespesa,
    classificacaoConta: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  return { service: new CategoriasService(prisma as never), prisma };
}

const CATALOGO: Fixa[] = [
  { id: 'veiculos', nome: 'Veículos', paiId: null },
  { id: 'compra', nome: 'Compra de veículos', paiId: 'veiculos' },
  { id: 'energia', nome: 'Energia', paiId: null },
];

describe('CategoriasService — os dois níveis do cadastro', () => {
  it('põe uma categoria solta dentro de um grupo', async () => {
    const { service, prisma } = montarServico(CATALOGO);

    await service.atualizar('energia', { paiId: 'veiculos' });

    expect(prisma.categoriaDespesa.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'energia' },
        data: { paiId: 'veiculos' },
      }),
    );
  });

  it('tira do grupo quando a mãe vem nula', async () => {
    const { service, prisma } = montarServico(CATALOGO);

    await service.atualizar('compra', { paiId: null });

    expect(prisma.categoriaDespesa.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paiId: null } }),
    );
  });

  it('renomear não mexe na mãe', async () => {
    const { service, prisma } = montarServico(CATALOGO);

    await service.atualizar('compra', { nome: 'Compra de carros' });

    // Sem a distinção entre "ausente" e "nulo", esta chamada soltaria a
    // subcategoria do grupo sem ninguém ter pedido.
    expect(prisma.categoriaDespesa.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nome: 'Compra de carros' } }),
    );
  });

  it('recusa um terceiro nível', async () => {
    const { service } = montarServico(CATALOGO);

    // "Compra de veículos" já está dentro de "Veículos"; pendurar outra nela
    // esconderia o gasto num galho que o dashboard não soma.
    await expect(
      service.atualizar('energia', { paiId: 'compra' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa mãe de si mesma', async () => {
    const { service } = montarServico(CATALOGO);

    await expect(
      service.atualizar('energia', { paiId: 'energia' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quem já agrupa outras não entra dentro de uma terceira', async () => {
    const { service } = montarServico(CATALOGO);

    await expect(
      service.atualizar('veiculos', { paiId: 'energia' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nasce dentro do grupo quando a criação diz de quem é filha', async () => {
    const { service, prisma } = montarServico(CATALOGO);

    await service.criar('Manutenção de veículos', 'veiculos');

    expect(prisma.categoriaDespesa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nome: 'Manutenção de veículos',
          paiId: 'veiculos',
        }),
      }),
    );
  });

  it('não apaga categoria que agrupa outras', async () => {
    const { service } = montarServico(CATALOGO);

    // Apagar deixaria "Compra de veículos" órfã em silêncio — e um grupo que
    // some sozinho é número que muda sozinho no relatório.
    await expect(service.remover('veiculos')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a etiqueta do título sai com o grupo junto', async () => {
    const { service, prisma } = montarServico(CATALOGO);
    prisma.classificacaoConta.findMany.mockResolvedValue([
      {
        idFnApagar: 42,
        categoria: {
          id: 'compra',
          nome: 'Compra de veículos',
          pai: { id: 'veiculos', nome: 'Veículos' },
        },
      },
    ]);

    const etiquetas = await service.dosTitulos([42]);

    expect(etiquetas.get(42)).toEqual({
      id: 'compra',
      nome: 'Compra de veículos',
      grupo: { id: 'veiculos', nome: 'Veículos' },
    });
  });
});
