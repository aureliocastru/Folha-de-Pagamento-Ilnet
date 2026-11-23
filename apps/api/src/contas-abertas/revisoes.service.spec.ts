import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalvarRevisaoDto } from './dto/manutencao.dto';
import { RevisoesService, totalDaLinha, totalDaRevisao } from './revisoes.service';

/**
 * As revisões do veículo: o registro do que se trocou, com quantidade e preço.
 *
 *  - o total da linha é a quantidade vezes o preço de cada, em centavos exatos;
 *  - linha sem preço aparece, mas não soma;
 *  - trocar a revisão troca as linhas todas, na ordem em que vieram;
 *  - data no futuro e revisão que não existe são recusadas.
 */

const D = (n: number | string) => new Prisma.Decimal(n);

function dados(extra: Record<string, unknown> = {}) {
  return {
    titulo: '  Revisão dos 70 mil km ',
    data: '2026-11-20',
    medidor: 70000,
    oficina: ' Auto Center ',
    observacao: '',
    itens: [
      { descricao: ' Óleo 5W30 ', quantidade: 6.5, preco: 39.9 },
      { descricao: 'Filtro de ar', quantidade: 1, preco: 85 },
      { descricao: 'Mão de obra', quantidade: 1 },
    ],
    ...extra,
  };
}

function montar(opts: { veiculo?: boolean; revisao?: boolean } = {}) {
  const prisma = {
    veiculo: {
      findUnique: jest.fn().mockResolvedValue(opts.veiculo === false ? null : { id: 'v1' }),
    },
    revisaoDoVeiculo: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(opts.revisao === false ? null : { id: 'r1' }),
      create: jest.fn(async ({ data }: { data: { itens: { create: Array<Record<string, unknown>> } } }) => ({
        id: 'r1',
        veiculoId: 'v1',
        titulo: 'x',
        data: new Date('2026-11-20T00:00:00Z'),
        medidor: null,
        oficina: null,
        observacao: null,
        itens: data.itens.create.map((i, n) => ({ id: `i${n}`, ...i })),
      })),
      update: jest.fn(async ({ data }: { data: { itens: { create: Array<Record<string, unknown>> } } }) => ({
        id: 'r1',
        veiculoId: 'v1',
        titulo: 'x',
        data: new Date('2026-11-20T00:00:00Z'),
        medidor: null,
        oficina: null,
        observacao: null,
        itens: data.itens.create.map((i, n) => ({ id: `n${n}`, ...i })),
      })),
      delete: jest.fn(),
    },
    itemDaRevisao: { deleteMany: jest.fn(async (a: unknown) => a) },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { service: new RevisoesService(prisma as never), prisma };
}

describe('totais da revisão', () => {
  it('a linha é a quantidade vezes o preço de cada', () => {
    expect(totalDaLinha(4, 45.5)).toBe(182);
    expect(totalDaLinha(D('6.5'), D('39.90'))).toBe(259.35);
  });

  it('sem preço não há total', () => {
    expect(totalDaLinha(1, null)).toBeNull();
  });

  it('arredonda o meio centavo para cima, sem erro de ponto flutuante', () => {
    expect(totalDaLinha(0.5, 0.05)).toBe(0.03);
    expect(totalDaLinha(3, 0.1)).toBe(0.3);
  });

  it('a revisão soma só as linhas que têm preço', () => {
    expect(
      totalDaRevisao([
        { quantidade: 6.5, preco: 39.9 },
        { quantidade: 1, preco: 85 },
        { quantidade: 1, preco: null },
      ]),
    ).toBe(344.35);
    expect(totalDaRevisao([])).toBe(0);
  });
});

describe('o que a tela manda (SalvarRevisaoDto)', () => {
  const validar = async (corpo: unknown) => {
    const dto = plainToInstance(SalvarRevisaoDto, corpo);
    return { dto, erros: await validate(dto, { whitelist: true }) };
  };

  it('aceita o corpo completo, com preço nulo e a vírgula de quem digita', async () => {
    const { dto, erros } = await validar({
      titulo: 'Revisão dos 70 mil km',
      data: '2026-11-20',
      medidor: '1261,9',
      itens: [
        { descricao: ' Óleo ', quantidade: '6,5', preco: '39,90' },
        { descricao: 'Mão de obra', quantidade: 1, preco: null },
      ],
    });
    expect(erros).toHaveLength(0);
    expect(dto.medidor).toBe(1261.9);
    expect(dto.itens[0]).toMatchObject({ descricao: 'Óleo', quantidade: 6.5, preco: 39.9 });
    expect(dto.itens[1].preco).toBeNull();
  });

  it('recusa linha sem descrição, quantidade zero e preço negativo', async () => {
    const { erros } = await validar({
      titulo: 'Revisão',
      data: '2026-11-20',
      itens: [
        { descricao: '   ', quantidade: 1 },
        { descricao: 'Pneu', quantidade: 0 },
        { descricao: 'Vela', quantidade: 4, preco: -1 },
      ],
    });
    expect(erros).toHaveLength(1);
    const filhos = erros[0].children?.map((c) => c.property) ?? [];
    expect(filhos).toEqual(['0', '1', '2']);
  });

  it('recusa título curto e data que não é data', async () => {
    const { erros } = await validar({ titulo: 'R', data: 'ontem', itens: [] });
    expect(erros.map((e) => e.property).sort()).toEqual(['data', 'titulo']);
  });
});

describe('RevisoesService', () => {
  it('cria a revisão limpando os textos e numerando as linhas', async () => {
    const { service, prisma } = montar();
    const r = await service.criar('v1', dados(), 'u1');

    const chamada = prisma.revisaoDoVeiculo.create.mock.calls[0][0] as {
      data: Record<string, unknown> & { itens: { create: Array<Record<string, unknown>> } };
    };
    expect(chamada.data.titulo).toBe('Revisão dos 70 mil km');
    expect(chamada.data.oficina).toBe('Auto Center');
    expect(chamada.data.observacao).toBeNull();
    expect(chamada.data.criadoPor).toBe('u1');
    expect((chamada.data.data as Date).toISOString()).toBe('2026-11-20T00:00:00.000Z');
    expect(chamada.data.itens.create.map((i) => [i.descricao, i.ordem])).toEqual([
      ['Óleo 5W30', 0],
      ['Filtro de ar', 1],
      ['Mão de obra', 2],
    ]);
    // Sem preço informado, a linha fica sem preço — e não vira zero.
    expect(chamada.data.itens.create[2].preco).toBeNull();

    expect(r.itens.map((i) => i.total)).toEqual([259.35, 85, null]);
    expect(r.total).toBe(344.35);
  });

  it('não cria revisão de um veículo que não existe', async () => {
    const { service, prisma } = montar({ veiculo: false });
    await expect(service.criar('nada', dados())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.revisaoDoVeiculo.create).not.toHaveBeenCalled();
  });

  it('recusa a revisão com data no futuro', async () => {
    const { service, prisma } = montar();
    const longe = new Date();
    longe.setFullYear(longe.getFullYear() + 1);
    await expect(
      service.criar('v1', dados({ data: longe.toISOString().slice(0, 10) })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.revisaoDoVeiculo.create).not.toHaveBeenCalled();
  });

  it('trocar a revisão apaga as linhas de antes e põe as novas, numa transação só', async () => {
    const { service, prisma } = montar();
    const r = await service.atualizar('r1', dados({ itens: [{ descricao: 'Pastilha', quantidade: 2, preco: 120 }] }));

    expect(prisma.itemDaRevisao.deleteMany).toHaveBeenCalledWith({ where: { revisaoId: 'r1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(r.itens).toHaveLength(1);
    expect(r.total).toBe(240);
  });

  it('não troca nem apaga revisão que não existe mais', async () => {
    const { service, prisma } = montar({ revisao: false });
    await expect(service.atualizar('r9', dados())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.apagar('r9')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.revisaoDoVeiculo.delete).not.toHaveBeenCalled();
    expect(prisma.itemDaRevisao.deleteMany).not.toHaveBeenCalled();
  });

  it('apaga a revisão', async () => {
    const { service, prisma } = montar();
    await service.apagar('r1');
    expect(prisma.revisaoDoVeiculo.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});
