import { BadRequestException } from '@nestjs/common';
import { DocumentosRhService } from './documentos.service';

/**
 * Mover é o gesto de arrumar a pasta: marcar os papéis e mandar todos para
 * outra divisória. O que este arquivo protege:
 *
 *  - o que existe se move, e o que sumiu no meio do caminho é contado, não
 *    escondido — a tela mandou o que ela via, e outra aba pode ter apagado um;
 *  - pasta de destino que não existe recusa a mudança inteira, antes de mexer
 *    em qualquer documento: mover para o nada é perder o papel de vista;
 *  - código repetido não move duas vezes nem infla a contagem;
 *  - marcar tudo e mandar para onde alguns já estão não é erro.
 */

function montarServico(opts: {
  pasta?: { id: string; nome: string } | null;
  existentes?: string[];
} = {}) {
  const prisma = {
    pastaRh: {
      findUnique: jest.fn(async () =>
        opts.pasta === undefined
          ? { id: 'destino', nome: 'Balanços' }
          : opts.pasta,
      ),
    },
    documentoRh: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => (opts.existentes ?? where.id.in).includes(id))
          .map((id) => ({ id, titulo: `Documento ${id}`, pastaId: 'origem' })),
      ),
      updateMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        }),
      ),
      deleteMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => ({
          count: where.id.in.length,
        }),
      ),
    },
  };

  const servico = new DocumentosRhService(prisma as never, {
    paraPdf: jest.fn(),
  } as never);

  return { servico, prisma };
}

describe('mover documentos', () => {
  it('move os marcados para a pasta escolhida', async () => {
    const { servico, prisma } = montarServico();

    const r = await servico.mover(['a', 'b', 'c'], 'destino');

    expect(r).toMatchObject({
      movidos: 3,
      sumiram: 0,
      pasta: { id: 'destino', nome: 'Balanços' },
    });
    expect(prisma.documentoRh.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b', 'c'] } },
      data: { pastaId: 'destino' },
    });
  });

  it('move o que existe e conta o que sumiu, em vez de recusar tudo', async () => {
    const { servico } = montarServico({ existentes: ['a', 'c'] });

    const r = await servico.mover(['a', 'b', 'c'], 'destino');

    expect(r.movidos).toBe(2);
    expect(r.sumiram).toBe(1);
  });

  it('não move nada quando a pasta de destino não existe', async () => {
    const { servico, prisma } = montarServico({ pasta: null });

    await expect(servico.mover(['a'], 'fantasma')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.documentoRh.updateMany).not.toHaveBeenCalled();
  });

  it('recusa quando nenhum dos documentos existe mais', async () => {
    const { servico, prisma } = montarServico({ existentes: [] });

    await expect(servico.mover(['a', 'b'], 'destino')).rejects.toThrow(
      /existe mais/i,
    );
    expect(prisma.documentoRh.updateMany).not.toHaveBeenCalled();
  });

  it('não conta duas vezes o código repetido', async () => {
    const { servico } = montarServico();

    const r = await servico.mover(['a', 'a', 'b'], 'destino');

    expect(r.movidos).toBe(2);
    expect(r.sumiram).toBe(0);
  });
});

/**
 * Apagar é o oposto do mover em consequência: o que se move está na outra
 * gaveta, o que se apaga não está em lugar nenhum. O que se protege aqui é o
 * mesmo cuidado com a lista que a tela mandou, mais o registro no log — depois
 * de apagar não há mais onde ler qual era o sétimo documento.
 */
describe('apagar vários documentos', () => {
  it('apaga os marcados e conta quantos foram', async () => {
    const { servico, prisma } = montarServico();

    const r = await servico.apagarVarios(['a', 'b']);

    expect(r).toMatchObject({ apagados: 2, sumiram: 0 });
    expect(prisma.documentoRh.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
    });
  });

  it('apaga o que existe e conta o que já tinha sumido', async () => {
    const { servico } = montarServico({ existentes: ['a'] });

    const r = await servico.apagarVarios(['a', 'b', 'c']);

    expect(r).toMatchObject({ apagados: 1, sumiram: 2 });
  });

  it('recusa quando nenhum existe mais, em vez de dizer que apagou zero', async () => {
    const { servico, prisma } = montarServico({ existentes: [] });

    await expect(servico.apagarVarios(['a'])).rejects.toThrow(/existe mais/i);
    expect(prisma.documentoRh.deleteMany).not.toHaveBeenCalled();
  });

  it('lê os títulos antes de apagar — é o único registro que sobra', async () => {
    const { servico, prisma } = montarServico();

    await servico.apagarVarios(['a']);

    const ordem = prisma.documentoRh.findMany.mock.invocationCallOrder[0];
    const depois = prisma.documentoRh.deleteMany.mock.invocationCallOrder[0];
    expect(ordem).toBeLessThan(depois);
    expect(prisma.documentoRh.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, titulo: true, pastaId: true },
      }),
    );
  });
});
