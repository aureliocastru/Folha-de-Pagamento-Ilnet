import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecolhidosService } from './recolhidos.service';

/**
 * O aparelho que voltou de cliente, recebido na base. O que este arquivo
 * protege:
 *
 *  - a peça vai da van do técnico para a triagem por transferência no IXC, e
 *    só a que está de fato na van, na prateleira;
 *  - a que não está fica pendente, com o porquê — e "sem transferir" existe
 *    para quando ela já foi mexida no IXC por outro caminho;
 *  - a divergência nunca transfere: não há o que mover no IXC.
 */

function item(over: Record<string, unknown>) {
  return {
    id: 'i1',
    tipo: 'RETIRADO',
    situacao: 'GRAVADO',
    recebidoEm: null,
    almoxId: 12,
    almoxarifado: 'VAN CLEYSON',
    produtoId: 34,
    patrimonioId: 9,
    quantidade: new Prisma.Decimal(1),
    descricao: 'ONU HUAWEI',
    ...over,
  };
}

function montar(itens: Array<Record<string, unknown>>, pecas: Record<number, { situacao: string; almox: number }>) {
  const marcados: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    itemDeOs: {
      findMany: jest.fn(async () => itens),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        marcados.push({ id: where.id, data });
        return {};
      }),
    },
  };
  const ixc = {
    create: jest.fn(async (recurso: string, _corpo: Record<string, unknown>) => ({
      id: recurso === 'transf_almox_top' ? 5001 : 6001,
      raw: {},
    })),
  };
  const produtos = {
    paraMovimentar: jest.fn(async () => [
      [{ id: 1, sigla: 'UND', descricao: 'Unidade' }],
      [
        { id: 12, nome: 'VAN CLEYSON', filialId: 1, ativo: true },
        { id: 60, nome: 'Recolhidos (triagem)', filialId: 1, ativo: true },
        { id: 43, nome: 'Perdas e Falhas', filialId: 1, ativo: true },
      ],
    ]),
    cadastrosPorId: jest.fn(async () => new Map([[34, { id: '34', unidade: '1', tipo: 'P' }]])),
  };
  const almoxarifados = {
    almoxDeRecolhidos: jest.fn(async () => ({ id: 60, nome: 'Recolhidos (triagem)' })),
  };
  const doIxc = {
    saldosNoAlmox: jest.fn(async () => new Map([[34, 1]])),
    patrimonio: jest.fn(async (id: number) =>
      pecas[id]
        ? { id: String(id), situacao: pecas[id].situacao, id_almoxarifado: String(pecas[id].almox) }
        : null,
    ),
  };
  const service = new RecolhidosService(
    prisma as never,
    ixc as never,
    produtos as never,
    almoxarifados as never,
    { esquecer: jest.fn() } as never,
    doIxc as never,
  );
  return { service, ixc, marcados, almoxarifados };
}

const eu = { nome: 'Almoxarife' };

describe('RecolhidosService.receber', () => {
  it('leva a peça da van para a triagem, por transferência no IXC', async () => {
    const { service, ixc, marcados, almoxarifados } = montar([item({})], { 9: { situacao: '1', almox: 12 } });

    const r = await service.receber({ itens: ['i1'] }, eu);

    expect(almoxarifados.almoxDeRecolhidos).toHaveBeenCalledWith(1, eu);
    expect(ixc.create).toHaveBeenNthCalledWith(
      1,
      'transf_almox_top',
      expect.objectContaining({ id_almox_saida: '12', id_almox_entrada: '60' }),
    );
    expect(ixc.create).toHaveBeenNthCalledWith(
      2,
      'transf_almox_item',
      expect.objectContaining({ id_patrimonio: '9', id_transf_almox: '5001', tipo_produto: 'P' }),
    );
    expect(r).toMatchObject({ recebidos: 1, destino: 'Recolhidos (triagem)', transferencias: [5001], recusados: [] });
    expect(marcados[0].data).toMatchObject({
      recebidoPor: 'Almoxarife',
      destinoAlmoxId: 60,
      transferenciaIxcId: 5001,
    });
  });

  it('peça que não está na van fica pendente, dizendo onde o IXC a vê', async () => {
    const { service, ixc, marcados } = montar([item({})], { 9: { situacao: '1', almox: 1 } });

    const r = await service.receber({ itens: ['i1'] }, eu);

    expect(r.recebidos).toBe(0);
    expect(r.recusados[0].motivo).toMatch(/almoxarifado #1.*sem transferir/);
    expect(ixc.create).not.toHaveBeenCalled();
    expect(marcados).toHaveLength(0);
  });

  it('"sem transferir" e a divergência só marcam', async () => {
    const { service, ixc, marcados } = montar(
      [item({}), item({ id: 'i2', tipo: 'DIVERGENCIA', patrimonioId: null, produtoId: null })],
      {},
    );

    const r = await service.receber({ itens: ['i1', 'i2'], semTransferir: true }, eu);

    expect(r.recebidos).toBe(2);
    expect(ixc.create).not.toHaveBeenCalled();
    expect(marcados.map((m) => m.data.transferenciaIxcId)).toEqual([null, null]);
  });

  it('não manda para Perdas nem recebe o que ainda não foi gravado', async () => {
    const { service } = montar([item({})], { 9: { situacao: '1', almox: 12 } });
    await expect(service.receber({ itens: ['i1'], destinoAlmoxId: 43 }, eu)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const pendente = montar([item({ situacao: 'PENDENTE' })], {});
    const r = await pendente.service.receber({ itens: ['i1'] }, eu);
    expect(r.recusados[0].motivo).toMatch(/ainda não foi gravada/);
  });
});
