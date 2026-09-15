import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AbastecimentosService, resumirCombustivel } from './abastecimentos.service';

/**
 * O abastecimento entra pelo portal do CPF, sem login, só com o km e a foto; o
 * valor é o administrador quem põe, na conferência. O que se protege aqui:
 *
 *  - só o responsável lança, e só no veículo que está no nome dele;
 *  - sem a foto da nota não entra;
 *  - o km não anda para trás — é o erro de digitação mais comum no posto;
 *  - o que está na fila não entra no total, e não deixa sair custo por km errado.
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
      findUnique: jest.fn(async () => ({ id: 'a1' })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'a1',
        valor: null,
        conferidoPor: null,
        ...data,
        foto: { id: 'foto1' },
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'a1',
        km: 12_500,
        data: new Date(),
        lancadoPor: 'Anderson',
        ...data,
        foto: { id: 'foto1' },
      })),
    },
  };
  return { service: new AbastecimentosService(prisma as never), prisma };
}

const PEDIDO = { veiculoId: 'v1', km: 12_500, foto: FOTO };

describe('AbastecimentosService.lancarPeloPortal', () => {
  it('grava km, foto e quem lançou — sem valor, que é da conferência', async () => {
    const { service, prisma } = montar({ ultimoKm: 12_300 });
    const r = await service.lancarPeloPortal(CPF, PEDIDO);
    const dados = prisma.abastecimento.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({
      veiculoId: 'v1',
      km: 12_500,
      funcionarioId: 'f1',
      lancadoPor: 'Anderson',
      foto: { create: { foto: FOTO } },
    });
    expect(dados).not.toHaveProperty('valor');
    expect(r).toMatchObject({ valor: null, km: 12_500, temFoto: true });
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
});

describe('a conferência', () => {
  it('põe o valor lido na nota e diz quem conferiu', async () => {
    const { service, prisma } = montar();
    const r = await service.conferir('a1', 45.5, 'Administrador');
    expect(prisma.abastecimento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ valor: 45.5, conferidoPor: 'Administrador' }),
      }),
    );
    expect(r).toMatchObject({ valor: 45.5, conferidoPor: 'Administrador' });
  });

  it('valor zerado não confere', async () => {
    const { service } = montar();
    await expect(service.conferir('a1', 0, 'Administrador')).rejects.toThrow(/valor da nota/);
  });

  it('lançado pela ficha com o valor já nasce conferido', async () => {
    const { service, prisma } = montar();
    await service.lancarPeloSistema('v1', { km: 12_500, foto: FOTO, valor: 50 }, { nome: 'Administrador' });
    expect(prisma.abastecimento.create.mock.calls[0][0].data).toMatchObject({
      valor: 50,
      conferidoPor: 'Administrador',
    });
  });
});

describe('resumirCombustivel', () => {
  it('custo por km sem o combustível do primeiro abastecimento', () => {
    const r = resumirCombustivel([
      { valor: 50, km: 1000 },
      { valor: 40, km: 1200 },
      { valor: 20, km: 1400 },
    ]);
    expect(r).toEqual({
      total: 110,
      quantidade: 3,
      aConferir: 0,
      ultimoKm: 1400,
      kmRodados: 400,
      custoPorKm: 0.15,
    });
  });

  it('com nota na fila: fora do total, e sem custo por km', () => {
    const r = resumirCombustivel([
      { valor: 50, km: 1000 },
      { valor: null, km: 1200 },
      { valor: 20, km: 1400 },
    ]);
    expect(r).toMatchObject({ total: 70, aConferir: 1, kmRodados: 400, custoPorKm: null });
  });

  it('um abastecimento só ainda não diz quanto custa o km', () => {
    expect(resumirCombustivel([{ valor: 50, km: 1000 }])).toMatchObject({
      kmRodados: null,
      custoPorKm: null,
    });
  });
});
