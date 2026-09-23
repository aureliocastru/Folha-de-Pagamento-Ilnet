import { Prisma } from '@prisma/client';
import { ManutencaoService } from './manutencao.service';

/**
 * O serviço da manutenção, no que a conta pura não cobre:
 *
 *  - a lista padrão entra uma vez só;
 *  - lançar hoje uma troca antiga (para completar o histórico) não faz o item
 *    parecer trocado naquele dia;
 *  - desfazer a troca devolve a anterior como "última".
 */

function montar(opts: { iniciada?: boolean; item?: Record<string, unknown>; anterior?: unknown } = {}) {
  const atualizacoes: Array<Record<string, unknown>> = [];
  const prisma = {
    veiculo: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'v1',
        apelido: 'Caçamba',
        tipo: 'CAMINHAO',
        manutencaoIniciada: opts.iniciada ?? false,
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ tipo: 'CAMINHAO' }),
      update: jest.fn(async (a: unknown) => a),
    },
    itemDeManutencao: {
      createMany: jest.fn(async (a: unknown) => a),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(
        opts.item ?? { id: 'i1', veiculoId: 'v1', ultimaTrocaEm: null, ultimaTrocaMedidor: null },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        atualizacoes.push(data);
        return data;
      }),
      aggregate: jest.fn().mockResolvedValue({ _max: { ultimaTrocaMedidor: null } }),
    },
    trocaDeManutencao: {
      create: jest.fn(async ({ data }: { data: unknown }) => ({ id: 't1', ...(data as object) })),
      findUnique: jest.fn().mockResolvedValue({ id: 't9', itemId: 'i1' }),
      delete: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(opts.anterior ?? null),
    },
    abastecimento: {
      findFirst: jest.fn().mockResolvedValue({ km: 120500, horimetro: null, data: new Date('2026-09-20T00:00:00Z') }),
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  return { service: new ManutencaoService(prisma as never), prisma, atualizacoes };
}

describe('ManutencaoService', () => {
  it('na primeira abertura põe a lista padrão do tipo, e marca que já pôs', async () => {
    const { service, prisma } = montar();
    const r = await service.doVeiculo('v1');

    const criados = prisma.itemDeManutencao.createMany.mock.calls[0][0] as { data: Array<{ nome: string }> };
    expect(criados.data.map((d) => d.nome)).toContain('Óleo do motor');
    expect(prisma.veiculo.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { manutencaoIniciada: true },
    });
    expect(r.unidade).toBe('km');
    expect(r.medidorAtual).toBe(120500);
    expect(r.medidorEm).toBe('2026-09-20');
  });

  it('depois da primeira vez, não põe de novo', async () => {
    const { service, prisma } = montar({ iniciada: true });
    await service.doVeiculo('v1');
    expect(prisma.itemDeManutencao.createMany).not.toHaveBeenCalled();
  });

  it('"troquei" sem km usa o do último abastecimento', async () => {
    const { service, prisma, atualizacoes } = montar();
    await service.registrarTroca('i1', {});
    const criada = prisma.trocaDeManutencao.create.mock.calls[0][0] as { data: { medidor: Prisma.Decimal } };
    expect(Number(criada.data.medidor)).toBe(120500);
    expect(Number(atualizacoes[0].ultimaTrocaMedidor)).toBe(120500);
  });

  it('troca antiga lançada agora entra no histórico, mas não vira a última', async () => {
    const { service, prisma, atualizacoes } = montar({
      item: { id: 'i1', veiculoId: 'v1', ultimaTrocaEm: new Date('2026-08-01T00:00:00Z'), ultimaTrocaMedidor: 118000 },
    });
    await service.registrarTroca('i1', { data: '2026-03-10', medidor: 100000 });
    expect(prisma.trocaDeManutencao.create).toHaveBeenCalled();
    expect(atualizacoes).toHaveLength(0);
  });

  it('desfazer devolve a troca anterior como a última', async () => {
    const anterior = { data: new Date('2026-03-10T00:00:00Z'), medidor: new Prisma.Decimal(100000) };
    const { service, atualizacoes } = montar({ anterior });
    await service.desfazerTroca('t9');
    expect(atualizacoes[0]).toMatchObject({ ultimaTrocaEm: anterior.data, ultimaTrocaMedidor: anterior.medidor });
  });

  it('não aceita item sem intervalo nenhum', async () => {
    const { service } = montar();
    await expect(service.criarItem('v1', { nome: 'Lembrete' })).rejects.toThrow('de quanto em quanto');
  });
});
