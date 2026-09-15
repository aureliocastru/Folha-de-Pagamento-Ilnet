import { BadRequestException } from '@nestjs/common';
import { StatusContaPagar } from '@prisma/client';
import { resumir, situacao, VeiculosService } from './veiculos.service';

/**
 * Quanto um veículo custou é a soma das contas lançadas com ele marcado. O que
 * se protege aqui:
 *
 *  - paga e em aberto contam; cancelada e a que não chegou ao IXC, não;
 *  - a ficha soma por categoria, que é o que responde "foi peça ou mão de obra?";
 *  - veículo com gasto não se apaga — desliga.
 */

const MOTO = {
  id: 'v1',
  apelido: 'Moto do Anderson',
  tipo: 'MOTO' as const,
  placa: 'ABC1D23',
  modelo: 'Honda CG 160',
  ano: 2022,
  observacao: null,
  ativo: true,
};

function conta(
  valor: number,
  status: StatusContaPagar,
  vencimento: string,
  extra: Record<string, unknown> = {},
) {
  return {
    valor,
    status,
    pagoEm: null as Date | null,
    dataVencimento: new Date(`${vencimento}T00:00:00Z`),
    ...extra,
  };
}

describe('situação do gasto', () => {
  it('lê paga pelo retorno do banco mesmo com o status atrasado', () => {
    expect(situacao({ status: StatusContaPagar.APROVADO, pagoEm: new Date() })).toBe('paga');
    expect(situacao({ status: StatusContaPagar.AGUARDANDO_APROVACAO, pagoEm: null })).toBe('em aberto');
    expect(situacao({ status: StatusContaPagar.ERRO, pagoEm: null })).toBe('nao enviada');
    expect(situacao({ status: StatusContaPagar.CANCELADO, pagoEm: null })).toBe('cancelada');
  });
});

describe('resumir', () => {
  it('soma pago e em aberto, e deixa fora o cancelado e o que não foi ao IXC', () => {
    const r = resumir(MOTO, [
      conta(120.5, StatusContaPagar.PAGO, '2026-08-10'),
      conta(80, StatusContaPagar.APROVADO, '2026-09-20'),
      conta(999, StatusContaPagar.CANCELADO, '2026-09-25'),
      conta(50, StatusContaPagar.ERRO, '2026-09-30'),
    ]);
    expect(r.gasto).toBe(200.5);
    expect(r.emAberto).toBe(80);
    expect(r.quantidade).toBe(2);
    // O último gasto é o que conta — o cancelado de depois não empurra a data.
    expect(r.ultimoGasto).toBe('2026-09-20');
  });
});

describe('VeiculosService', () => {
  function montar(contas: Array<ReturnType<typeof conta>>, etiquetas = new Map()) {
    const prisma = {
      veiculo: {
        findUnique: jest.fn(async () => ({ ...MOTO, contas })),
        delete: jest.fn(async () => MOTO),
      },
      contaPagar: { count: jest.fn(async () => contas.length) },
      abastecimento: { count: jest.fn(async () => 0) },
    };
    const categorias = { dosTitulos: jest.fn(async () => etiquetas) };
    const abastecimentos = {
      resumo: jest.fn(async () => ({ total: 90, quantidade: 2, ultimoKm: 1500, kmRodados: 300, custoPorKm: 0.15 })),
      doVeiculo: jest.fn(async () => []),
    };
    return {
      service: new VeiculosService(prisma as never, categorias as never, abastecimentos as never),
      prisma,
    };
  }

  it('a ficha soma por categoria, com o grupo na frente', async () => {
    const pecas = { id: 'c1', nome: 'Peças', grupo: { id: 'g', nome: 'Veículos' } };
    const mao = { id: 'c2', nome: 'Mão de obra', grupo: { id: 'g', nome: 'Veículos' } };
    const { service } = montar(
      [
        conta(300, StatusContaPagar.PAGO, '2026-08-01', { id: 'a', idFnApagarIxc: 1, beneficiarioNome: 'Moto Peças', observacao: 'Kit relação' }),
        conta(100, StatusContaPagar.PAGO, '2026-08-02', { id: 'b', idFnApagarIxc: 2, beneficiarioNome: 'Oficina', observacao: 'Troca' }),
        conta(50, StatusContaPagar.APROVADO, '2026-08-03', { id: 'c', idFnApagarIxc: 3, beneficiarioNome: 'Moto Peças', observacao: 'Óleo' }),
        conta(20, StatusContaPagar.APROVADO, '2026-08-04', { id: 'd', idFnApagarIxc: 4, beneficiarioNome: 'Posto', observacao: 'Sem etiqueta' }),
      ],
      new Map([
        [1, pecas],
        [2, mao],
        [3, pecas],
      ]),
    );

    const ficha = await service.ficha('v1');

    expect(ficha.porCategoria).toEqual([
      { nome: 'Veículos › Peças', valor: 350 },
      { nome: 'Veículos › Mão de obra', valor: 100 },
      { nome: 'Sem categoria', valor: 20 },
    ]);
    expect(ficha.veiculo.gasto).toBe(470);
    // O combustível fica ao lado, fora da soma das contas: é pago pela fatura do posto.
    expect(ficha.veiculo.combustivel).toBe(90);
    expect(ficha.veiculo.ultimoKm).toBe(1500);
    expect(ficha.gastos[1]).toMatchObject({ fornecedor: 'Oficina', situacao: 'paga', categoria: mao });
  });

  it('veículo com gasto não se apaga', async () => {
    const { service, prisma } = montar([conta(10, StatusContaPagar.PAGO, '2026-08-01')]);
    await expect(service.remover('v1')).rejects.toThrow(BadRequestException);
    expect(prisma.veiculo.delete).not.toHaveBeenCalled();
  });
});
