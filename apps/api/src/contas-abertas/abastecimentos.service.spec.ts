import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AbastecimentosService, resumirCombustivel } from './abastecimentos.service';

/**
 * O abastecimento entra pelo portal do CPF, sem login. O que se protege aqui:
 *
 *  - só o responsável lança, e só no veículo que está no nome dele;
 *  - sem a foto da nota não entra;
 *  - o km não anda para trás — é o erro de digitação mais comum no posto;
 *  - o custo por km não conta o combustível do primeiro abastecimento.
 */

const CPF = '529.982.247-25';
const FOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

function montar(opts: { responsavelId?: string; ultimoKm?: number | null } = {}) {
  const prisma = {
    funcionario: {
      findMany: jest.fn(async () => [
        { id: 'f1', nome: 'Anderson Silva', apelido: 'Anderson', cpfCnpj: '529.982.247-25' },
      ]),
    },
    veiculo: {
      findUnique: jest.fn(async () => ({
        id: 'v1',
        apelido: 'Moto do almoxarifado',
        ativo: true,
        responsavelId: opts.responsavelId ?? 'f1',
      })),
    },
    abastecimento: {
      aggregate: jest.fn(async () => ({ _max: { km: opts.ultimoKm ?? null } })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'a1',
        ...data,
        foto: { id: 'foto1' },
      })),
    },
  };
  return { service: new AbastecimentosService(prisma as never), prisma };
}

const PEDIDO = { veiculoId: 'v1', valor: 35.5, km: 12_500, foto: FOTO };

describe('AbastecimentosService.lancarPeloPortal', () => {
  it('grava valor, km, foto e quem lançou', async () => {
    const { service, prisma } = montar({ ultimoKm: 12_300 });
    const r = await service.lancarPeloPortal(CPF, PEDIDO);
    expect(prisma.abastecimento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          veiculoId: 'v1',
          valor: 35.5,
          km: 12_500,
          funcionarioId: 'f1',
          lancadoPor: 'Anderson',
          foto: { create: { foto: FOTO } },
        }),
      }),
    );
    expect(r).toMatchObject({ valor: 35.5, km: 12_500, temFoto: true });
  });

  it('só no veículo que está no nome de quem lança', async () => {
    const { service, prisma } = montar({ responsavelId: 'outro' });
    await expect(service.lancarPeloPortal(CPF, PEDIDO)).rejects.toThrow(ForbiddenException);
    expect(prisma.abastecimento.create).not.toHaveBeenCalled();
  });

  it('sem a foto da nota não entra', async () => {
    const { service, prisma } = montar();
    await expect(service.lancarPeloPortal(CPF, { ...PEDIDO, foto: '' })).rejects.toThrow(/foto da nota/);
    expect(prisma.abastecimento.create).not.toHaveBeenCalled();
  });

  it('o km não anda para trás', async () => {
    const { service } = montar({ ultimoKm: 13_000 });
    await expect(service.lancarPeloPortal(CPF, PEDIDO)).rejects.toThrow(/13\.000 km/);
  });

  it('CPF que não é de funcionário não lança', async () => {
    const { service } = montar();
    await expect(service.lancarPeloPortal('111.444.777-35', PEDIDO)).rejects.toThrow(NotFoundException);
  });

  it('valor zerado não entra', async () => {
    const { service } = montar();
    await expect(service.lancarPeloPortal(CPF, { ...PEDIDO, valor: 0 })).rejects.toThrow(BadRequestException);
  });
});

describe('resumirCombustivel', () => {
  it('custo por km sem o combustível do primeiro abastecimento', () => {
    const r = resumirCombustivel([
      { valor: 50, km: 1000 },
      { valor: 40, km: 1200 },
      { valor: 20, km: 1400 },
    ]);
    expect(r).toEqual({ total: 110, quantidade: 3, ultimoKm: 1400, kmRodados: 400, custoPorKm: 0.15 });
  });

  it('um abastecimento só ainda não diz quanto custa o km', () => {
    expect(resumirCombustivel([{ valor: 50, km: 1000 }])).toMatchObject({
      kmRodados: null,
      custoPorKm: null,
    });
  });
});
