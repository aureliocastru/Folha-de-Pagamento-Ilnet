import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AReceberService } from './a-receber.service';

/**
 * A aba Controle: quem deve a quem está logado. O que este arquivo protege é
 * que o lembrete é de quem cadastrou — outro login não lista, não edita e não
 * apaga — e que "pagou" só muda o lugar dele na tela.
 */

interface Linha {
  id: string;
  usuarioId: string;
  pessoa: string;
  valor: Prisma.Decimal;
  observacao: string | null;
  recebidoEm: Date | null;
  createdAt: Date;
}

function montar(linhas: Linha[]) {
  const banco = [...linhas];
  const prisma = {
    dinheiroAReceber: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { usuarioId: string; recebidoEm: null | { not: null } };
        }) =>
          banco.filter(
            (l) =>
              l.usuarioId === where.usuarioId &&
              (where.recebidoEm === null
                ? l.recebidoEm === null
                : l.recebidoEm !== null),
          ),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; usuarioId: string } }) =>
          banco.find((l) => l.id === where.id && l.usuarioId === where.usuarioId) ??
          null,
      ),
      create: jest.fn(async ({ data }: { data: Omit<Linha, 'id' | 'createdAt' | 'recebidoEm'> }) => {
        const nova: Linha = {
          id: `n${banco.length + 1}`,
          createdAt: new Date(),
          recebidoEm: null,
          ...data,
        };
        banco.push(nova);
        return nova;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<Linha> }) => {
          const l = banco.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return l;
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        banco.splice(
          banco.findIndex((x) => x.id === where.id),
          1,
        );
      }),
    },
  };
  return { service: new AReceberService(prisma as never), prisma, banco };
}

const doAurelio: Linha = {
  id: 'a1',
  usuarioId: 'aurelio',
  pessoa: 'Fulano',
  valor: new Prisma.Decimal(500),
  observacao: 'emprestei para o conserto',
  recebidoEm: null,
  createdAt: new Date('2026-09-01T12:00:00Z'),
};

const deOutro: Linha = {
  ...doAurelio,
  id: 'o1',
  usuarioId: 'outro',
  pessoa: 'Ciclano',
};

describe('a aba Controle', () => {
  it('lista só o que é de quem está logado', async () => {
    const { service } = montar([doAurelio, deOutro]);

    const r = await service.listar('aurelio');

    expect(r.devendo.map((l) => l.pessoa)).toEqual(['Fulano']);
    expect(r.devendo[0].valor).toBe(500);
    expect(r.recebidos).toEqual([]);
  });

  it('cadastra só quem e quanto — sem data de receber', async () => {
    const { service } = montar([]);

    const novo = await service.criar('aurelio', {
      pessoa: '  Beltrano ',
      valor: 120,
    });

    expect(novo).toMatchObject({
      pessoa: 'Beltrano',
      valor: 120,
      observacao: null,
      recebidoEm: null,
    });
  });

  it('pagou: sai do "devendo" e vai para os recebidos, e dá para desfazer', async () => {
    const { service } = montar([{ ...doAurelio }]);

    await service.marcarRecebido('aurelio', 'a1', true);
    let r = await service.listar('aurelio');
    expect(r.devendo).toEqual([]);
    expect(r.recebidos.map((l) => l.id)).toEqual(['a1']);

    await service.marcarRecebido('aurelio', 'a1', false);
    r = await service.listar('aurelio');
    expect(r.devendo.map((l) => l.id)).toEqual(['a1']);
  });

  it('pagou uma parte: o valor se corrige', async () => {
    const { service } = montar([{ ...doAurelio }]);

    const salvo = await service.editar('aurelio', 'a1', { valor: 300 });

    expect(salvo.valor).toBe(300);
    expect(salvo.observacao).toBe('emprestei para o conserto');
  });

  it('o lembrete de outro login não se edita, não se marca e não se apaga', async () => {
    const { service, prisma } = montar([deOutro]);

    await expect(service.editar('aurelio', 'o1', { valor: 1 })).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.marcarRecebido('aurelio', 'o1', true)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.apagar('aurelio', 'o1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dinheiroAReceber.update).not.toHaveBeenCalled();
    expect(prisma.dinheiroAReceber.delete).not.toHaveBeenCalled();
  });
});
