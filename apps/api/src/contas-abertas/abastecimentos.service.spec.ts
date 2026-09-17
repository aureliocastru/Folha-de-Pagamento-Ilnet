import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AbastecimentosService,
  mediaDeConsumo,
  resumirCombustivel,
} from './abastecimentos.service';

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

function montar(
  opts: {
    /** Quem tem o veículo no nome. Um só, que é o do caso comum. */
    responsavelId?: string;
    ultimoKm?: number | null;
    ultimoHorimetro?: number | null;
    /** O que o `findUnique` de veículo devolve, por id. */
    veiculos?: Record<string, Record<string, unknown>>;
    /** Litros comprados, litros já conferidos e o que se pagou por eles. */
    galao?: { entrou?: number; litrosPagos?: number; pago?: number; saiu?: number };
  } = {},
) {
  const g = opts.galao;
  const prisma = {
    funcionario: {
      findMany: jest.fn(async () => [
        { id: 'f1', nome: 'Anderson Silva', apelido: 'Anderson', cpfCnpj: '529.982.247-25' },
      ]),
      // O colaborador do login: só o f1 é ativo na casa.
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'f1' ? { id: 'f1', nome: 'Anderson Silva', apelido: 'Anderson' } : null,
      ),
    },
    veiculo: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const padrao = {
          id: 'v1',
          apelido: 'Moto do almoxarifado',
          tipo: 'MOTO',
          ativo: true,
          responsaveis: [{ funcionarioId: opts.responsavelId ?? 'f1' }],
        };
        return opts.veiculos?.[where.id] ?? (where.id === 'v1' ? padrao : null);
      }),
      findMany: jest.fn(async () => [
        { id: 'm1', apelido: 'Retroescavadeira', tipo: 'MAQUINA', placa: null },
      ]),
    },
    abastecimento: {
      groupBy: jest.fn(async () =>
        g?.litrosPagos
          ? [{ veiculoId: 'g1', _sum: { valor: g.pago ?? 0, litros: g.litrosPagos } }]
          : [],
      ),
      aggregate: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ({
        _max: { km: opts.ultimoKm ?? null, horimetro: opts.ultimoHorimetro ?? null },
        // O estoque pergunta três vezes: o que entrou, o que entrou já
        // conferido, e o que saiu para as máquinas.
        _sum: where.galaoId
          ? { litros: g?.saiu ?? 0 }
          : where.valor
            ? { litros: g?.litrosPagos ?? 0, valor: g?.pago ?? 0 }
            : { litros: g?.entrou ?? 0 },
      })),
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

  it('o carro de dois: o segundo responsável lança igual ao primeiro', async () => {
    const { service, prisma } = montar({
      veiculos: {
        v1: {
          id: 'v1',
          apelido: 'Hilux',
          tipo: 'CAMINHONETE',
          ativo: true,
          responsaveis: [{ funcionarioId: 'outro' }, { funcionarioId: 'f1' }],
        },
      },
    });

    await service.lancarPeloPortal(CPF, PEDIDO);

    expect(prisma.abastecimento.create.mock.calls[0][0].data).toMatchObject({
      veiculoId: 'v1',
      funcionarioId: 'f1',
    });
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

/**
 * O mesmo lançamento, pelo login do sistema: quem é a pessoa vem do vínculo do
 * login, e não do CPF — e o login fica gravado junto.
 */
describe('AbastecimentosService.lancarPeloColaborador', () => {
  it('grava o colaborador, o login, o veículo e a hora', async () => {
    const { service, prisma } = montar({ ultimoKm: 12_300 });
    const antes = Date.now();
    await service.lancarPeloColaborador('f1', 'u1', PEDIDO);
    const dados = prisma.abastecimento.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({
      veiculoId: 'v1',
      km: 12_500,
      funcionarioId: 'f1',
      usuarioId: 'u1',
      lancadoPor: 'Anderson',
    });
    expect(dados).not.toHaveProperty('valor');
    expect((dados.data as Date).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('só no veículo que está no nome dele', async () => {
    const { service, prisma } = montar({ responsavelId: 'outro' });
    await expect(service.lancarPeloColaborador('f1', 'u1', PEDIDO)).rejects.toThrow(ForbiddenException);
    expect(prisma.abastecimento.create).not.toHaveBeenCalled();
  });

  it('quem saiu da casa não lança', async () => {
    const { service, prisma } = montar();
    await expect(service.lancarPeloColaborador('f-saiu', 'u1', PEDIDO)).rejects.toThrow(NotFoundException);
    expect(prisma.abastecimento.create).not.toHaveBeenCalled();
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

/**
 * O galão de 200 litros: a máquina não vai ao posto, o galão é que vai.
 *
 * São dois lançamentos bem diferentes com a mesma cara. **Encher o galão** é
 * uma compra: tem nota, tem foto, e o valor sai na conferência. **Pôr na
 * máquina** é uma saída: tem litros e horímetro, não tem nota nenhuma, e o que
 * ela custou vem do preço do litro que está dentro do galão.
 */
describe('o galão de combustível', () => {
  const GALAO = {
    id: 'g1',
    apelido: 'Galão do S10',
    tipo: 'GALAO',
    ativo: true,
    responsaveis: [{ funcionarioId: 'f1' }],
  };
  const MAQUINA = {
    id: 'm1',
    apelido: 'Retroescavadeira',
    tipo: 'MAQUINA',
    ativo: true,
    responsaveis: [{ funcionarioId: 'outro' }],
  };

  function comGalao(extra: Record<string, unknown> = {}) {
    return montar({
      veiculos: { g1: GALAO, m1: MAQUINA },
      ...extra,
    });
  }

  it('encher no posto grava os litros e a foto, e não pede km', async () => {
    const { service, prisma } = comGalao();

    await service.lancarPeloPortal(CPF, { veiculoId: 'g1', litros: 200, foto: FOTO });

    expect(prisma.abastecimento.create.mock.calls[0][0].data).toMatchObject({
      veiculoId: 'g1',
      litros: 200,
      km: null,
      horimetro: null,
      foto: { create: { foto: FOTO } },
    });
  });

  it('galão sem litros não entra: é o estoque que se está lançando', async () => {
    const { service } = comGalao();

    await expect(
      service.lancarPeloPortal(CPF, { veiculoId: 'g1', foto: FOTO }),
    ).rejects.toThrow(/quantos litros/);
  });

  it('o que sai do galão vai para a máquina com horímetro, e sem foto', async () => {
    const { service, prisma } = comGalao({ galao: { entrou: 200, litrosPagos: 200, pago: 1200 } });

    const r = await service.lancarPeloPortal(CPF, {
      veiculoId: 'm1',
      galaoId: 'g1',
      litros: 50,
      horimetro: 1320,
    });

    const dados = prisma.abastecimento.create.mock.calls[0][0].data;
    expect(dados).toMatchObject({
      veiculoId: 'm1',
      galaoId: 'g1',
      litros: 50,
      horimetro: 1320,
      km: null,
    });
    expect(dados).not.toHaveProperty('foto');
    // 1200 por 200 litros dá 6 o litro: 50 litros são 300 reais de máquina.
    expect(r).toMatchObject({ valor: 300, litros: 50, horimetro: 1320 });
  });

  it('não sai mais litro do que há dentro', async () => {
    const { service } = comGalao({ galao: { entrou: 200, litrosPagos: 200, pago: 1200, saiu: 180 } });

    await expect(
      service.lancarPeloPortal(CPF, {
        veiculoId: 'm1',
        galaoId: 'g1',
        litros: 50,
        horimetro: 1320,
      }),
    ).rejects.toThrow(/há 20 L/);
  });

  it('a máquina cobra o horímetro, e não o km', async () => {
    const { service } = comGalao({ galao: { entrou: 200, litrosPagos: 200, pago: 1200 } });

    await expect(
      service.lancarPeloPortal(CPF, { veiculoId: 'm1', galaoId: 'g1', litros: 50, km: 1320 }),
    ).rejects.toThrow(/horímetro/);
  });

  it('o horímetro não anda para trás', async () => {
    const { service } = comGalao({
      galao: { entrou: 200, litrosPagos: 200, pago: 1200 },
      ultimoHorimetro: 1400,
    });

    await expect(
      service.lancarPeloPortal(CPF, {
        veiculoId: 'm1',
        galaoId: 'g1',
        litros: 50,
        horimetro: 1320,
      }),
    ).rejects.toThrow(/1.400 horas/);
  });

  it('o galão não abastece a si mesmo', async () => {
    const { service } = comGalao({ galao: { entrou: 200, litrosPagos: 200, pago: 1200 } });

    await expect(
      service.lancarPeloPortal(CPF, { veiculoId: 'g1', galaoId: 'g1', litros: 50 }),
    ).rejects.toThrow(/a si mesmo/);
  });

  it('só tira do galão quem o tem no nome', async () => {
    const { service } = montar({
      veiculos: { g1: { ...GALAO, responsaveis: [{ funcionarioId: 'outro' }] }, m1: MAQUINA },
      galao: { entrou: 200, litrosPagos: 200, pago: 1200 },
    });

    await expect(
      service.lancarPeloPortal(CPF, {
        veiculoId: 'm1',
        galaoId: 'g1',
        litros: 50,
        horimetro: 1320,
      }),
    ).rejects.toThrow(/não está com você/);
  });

  it('o estoque é o que entrou menos o que saiu, ao preço das notas conferidas', async () => {
    const { service } = comGalao({
      galao: { entrou: 200, litrosPagos: 150, pago: 900, saiu: 50 },
    });

    // 900 por 150 litros dá 6 o litro; sobraram 150 dentro.
    expect(await service.estoqueDoGalao('g1')).toEqual({
      litros: 150,
      precoPorLitro: 6,
      valor: 900,
      litrosSemValor: 50,
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
    expect(r).toMatchObject({
      total: 110,
      quantidade: 3,
      aConferir: 0,
      ultimoKm: 1400,
      kmRodados: 400,
      custoPorKm: 0.15,
      horasTrabalhadas: null,
      custoPorHora: null,
    });
  });

  it('na máquina a conta é por hora de horímetro', () => {
    const r = resumirCombustivel(
      [
        { valor: 300, horimetro: 1000, litros: 50 },
        { valor: 300, horimetro: 1050, litros: 50 },
        { valor: 300, horimetro: 1100, litros: 50 },
      ],
      'horimetro',
    );
    // 600 reais depois da primeira, em 100 horas: 6 reais a hora.
    expect(r).toMatchObject({
      total: 900,
      litros: 150,
      ultimoHorimetro: 1100,
      horasTrabalhadas: 100,
      custoPorHora: 6,
      kmRodados: null,
      custoPorKm: null,
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

/**
 * A média de consumo — o número que quem anda com o veículo cobra primeiro.
 *
 * A conta é a do posto: o combustível de um abastecimento leva o veículo até o
 * próximo, e por isso o primeiro fica fora dos litros. Quem só olha "litros
 * totais dividido por km" erra sempre para menos.
 */
describe('mediaDeConsumo', () => {
  it('km por litro: o que se andou pelos litros que vieram depois do primeiro', () => {
    const r = mediaDeConsumo([
      { km: 1000, litros: 40 },
      { km: 1500, litros: 50 },
      { km: 2000, litros: 50 },
    ]);
    // 1000 km andados, 100 litros depois do primeiro: 10 km/L.
    expect(r).toMatchObject({ medio: 10, ultimo: 10, unidade: 'km_por_litro', base: 3 });
  });

  it('a última é só o trecho de agora — é nela que a queda aparece', () => {
    const r = mediaDeConsumo([
      { km: 1000, litros: 40 },
      { km: 1500, litros: 50 },
      { km: 1800, litros: 50 },
    ]);
    // Na média, 800 km por 100 L dão 8; no último trecho, 300 por 50 dão 6.
    expect(r).toMatchObject({ medio: 8, ultimo: 6 });
  });

  it('um abastecimento só não é média nenhuma', () => {
    expect(mediaDeConsumo([{ km: 1000, litros: 40 }])).toMatchObject({
      medio: null,
      ultimo: null,
      base: 1,
    });
  });

  it('o que veio sem medidor fica de fora, e não estraga a conta', () => {
    const r = mediaDeConsumo([
      { km: 1000, litros: 40 },
      { km: null, litros: 20 },
      { km: 1500, litros: 50 },
    ]);
    // Os 20 litros sem km nenhum atrás deles não entram: 500 km por 50 L.
    expect(r).toMatchObject({ medio: 10, base: 2 });
  });

  it('na máquina a média é de litros por hora de trabalho', () => {
    const r = mediaDeConsumo(
      [
        { horimetro: 1000, litros: 50 },
        { horimetro: 1050, litros: 50 },
        { horimetro: 1100, litros: 50 },
      ],
      'horimetro',
    );
    // 100 litros em 100 horas: um litro por hora.
    expect(r).toMatchObject({ medio: 1, ultimo: 1, unidade: 'litros_por_hora' });
  });
});
