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
  function montar(
    contas: Array<ReturnType<typeof conta>>,
    etiquetas = new Map(),
    /** As notas desta moto em contas pagas de uma vez. */
    partes: Array<{
      id?: string;
      valor: number;
      descricao: string | null;
      categoria?: { id: string; nome: string; pai: { id: string; nome: string } | null } | null;
      _count?: { fotos: number };
      conta: ReturnType<typeof conta>;
    }> = [],
  ) {
    const prisma = {
      veiculo: {
        findUnique: jest.fn(async () => ({ ...MOTO, contas, partesDeContas: partes })),
        delete: jest.fn(async () => MOTO),
      },
      contaPagar: { count: jest.fn(async () => contas.length) },
      parteDaConta: { count: jest.fn(async () => partes.length) },
      abastecimento: { count: jest.fn(async () => 0) },
      funcionario: {
        findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
          [{ id: 'f1', nome: 'Anderson Silva', apelido: 'Anderson' }].filter(
            (f) => !where.id || where.id.in.includes(f.id),
          ),
        ),
      },
      user: {
        findMany: jest.fn(async ({ where }: { where: { id?: { in: string[] } } }) =>
          [
            { id: 'u-dono', nome: 'Aurélio' },
            { id: 'u-anderson', nome: 'anderson.silva' },
          ].filter((u) => !where.id || where.id.in.includes(u.id)),
        ),
      },
    };
    Object.assign(prisma.veiculo, { create: jest.fn(async () => MOTO) });
    const categorias = { dosTitulos: jest.fn(async () => etiquetas) };
    const abastecimentos = {
      resumo: jest.fn(async () => ({ total: 90, quantidade: 2, ultimoKm: 1500, kmRodados: 300, custoPorKm: 0.15 })),
      doVeiculo: jest.fn(async () => []),
    };
    // O login do Anderson já é o funcionário Anderson; o do dono não é ninguém.
    const vinculos = { todos: jest.fn(async () => new Map([['u-anderson', { id: 'f1' }]])) };
    return {
      service: new VeiculosService(
        prisma as never,
        categorias as never,
        abastecimentos as never,
        vinculos as never,
      ),
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
    expect(ficha.gastos.find((g) => g.fornecedor === 'Oficina')).toMatchObject({
      situacao: 'paga',
      categoria: mao,
    });
    // Do mais novo para o mais velho.
    expect(ficha.gastos.map((g) => g.vencimento)).toEqual([
      '2026-08-04',
      '2026-08-03',
      '2026-08-02',
      '2026-08-01',
    ]);
  });

  /*
   * A oficina cobrou três carros num pagamento só, de R$ 450,00. A moto foi
   * R$ 120,00 dele: é isso que a ficha dela soma, e não os R$ 450,00.
   */
  it('na conta dividida, a ficha soma só a parte deste veículo', async () => {
    const dividida = conta(450, StatusContaPagar.PAGO, '2026-10-05', {
      id: 'x',
      idFnApagarIxc: 9,
      beneficiarioNome: 'Oficina do Murilo',
      // Embaixo, o detalhamento de todas as notas do título: não é desta moto.
      observacao: [
        'Notas de outubro',
        '1. Moto — troca de óleo: R$ 120,00',
        '2. Strada — pneu: R$ 330,00',
      ].join('\n'),
    });
    const { service } = montar(
      [conta(100, StatusContaPagar.PAGO, '2026-08-02', { id: 'b', idFnApagarIxc: 2, beneficiarioNome: 'Oficina', observacao: 'Troca' })],
      new Map(),
      [
        {
          id: 'parte-1',
          valor: 120,
          descricao: 'troca de óleo',
          categoria: { id: 'c1', nome: 'Peças', pai: { id: 'g', nome: 'Veículos' } },
          _count: { fotos: 1 },
          conta: dividida,
        },
      ],
    );

    const ficha = await service.ficha('v1');

    expect(ficha.veiculo.gasto).toBe(220);
    expect(ficha.veiculo.quantidade).toBe(2);
    expect(ficha.gastos[0]).toMatchObject({
      contaId: 'x',
      fornecedor: 'Oficina do Murilo',
      valor: 120,
      observacao: 'troca de óleo — Notas de outubro',
      vencimento: '2026-10-05',
      // A categoria é a da nota, e a foto é só a dela.
      categoria: { id: 'c1', nome: 'Peças', grupo: { id: 'g', nome: 'Veículos' } },
      parteId: 'parte-1',
      notasGuardadas: 1,
    });
    expect(ficha.porCategoria).toContainEqual({ nome: 'Veículos › Peças', valor: 120 });
  });

  it('veículo com parte numa conta dividida também não se apaga', async () => {
    const dividida = conta(450, StatusContaPagar.PAGO, '2026-10-05');
    const { service, prisma } = montar([], new Map(), [
      { valor: 120, descricao: null, conta: dividida },
    ]);

    await expect(service.remover('v1')).rejects.toThrow(BadRequestException);
    expect(prisma.veiculo.delete).not.toHaveBeenCalled();
  });

  it('quem pode ficar com o veículo: os funcionários, e o login de quem não é um', async () => {
    const { service } = montar([]);
    expect(await service.responsaveis()).toEqual([
      { id: 'f1', nome: 'Anderson Silva', apelido: 'Anderson', login: false },
      // O login do Anderson não se repete: ele entra pelo cadastro.
      { id: 'u-dono', nome: 'Aurélio', apelido: null, login: true },
    ]);
  });

  it('o veículo fica no nome do funcionário e do login ao mesmo tempo', async () => {
    const { service, prisma } = montar([]);
    await service.criar({ apelido: 'Hilux', tipo: 'CAMINHONETE', responsaveisIds: ['f1', 'u-dono'] });
    expect((prisma.veiculo as unknown as { create: jest.Mock }).create.mock.calls[0][0].data).toMatchObject({
      responsaveis: { create: [{ funcionarioId: 'f1' }] },
      logins: { create: [{ usuarioId: 'u-dono' }] },
    });
  });

  it('quem não é funcionário nem login não fica com o veículo', async () => {
    const { service } = montar([]);
    await expect(
      service.criar({ apelido: 'Hilux', tipo: 'CAMINHONETE', responsaveisIds: ['ninguem'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('veículo com gasto não se apaga', async () => {
    const { service, prisma } = montar([conta(10, StatusContaPagar.PAGO, '2026-08-01')]);
    await expect(service.remover('v1')).rejects.toThrow(BadRequestException);
    expect(prisma.veiculo.delete).not.toHaveBeenCalled();
  });
});

/**
 * A frota de um mês só. A moto teve três contas — a de setembro paga em
 * outubro, a de outubro em aberto e a de novembro — e abastecimentos em
 * setembro e outubro. O que se protege:
 *
 *  - a conta paga pesa no mês do pagamento, e a em aberto no do vencimento;
 *  - o abastecimento é do dia em Brasília: o das 22h do dia 30 é de setembro;
 *  - a média do mês parte do último medidor de antes dele;
 *  - sem mês, tudo desde sempre, como antes.
 */
describe('a frota num mês', () => {
  const dia = (iso: string) => new Date(iso);
  const abastecimentos = [
    { veiculoId: 'v1', galaoId: null, valor: 50, km: 1000, horimetro: null, litros: 10, data: dia('2026-09-10T15:00:00Z') },
    // 22h do dia 30 em Brasília: 1h do dia 1º em UTC, e ainda é setembro.
    { veiculoId: 'v1', galaoId: null, valor: 60, km: 1300, horimetro: null, litros: 10, data: dia('2026-10-01T01:00:00Z') },
    { veiculoId: 'v1', galaoId: null, valor: 70, km: 1700, horimetro: null, litros: 10, data: dia('2026-10-15T15:00:00Z') },
    { veiculoId: 'v1', galaoId: null, valor: null, km: 2000, horimetro: null, litros: 10, data: dia('2026-10-20T15:00:00Z') },
  ];

  function montar() {
    const contas = [
      // Venceu em setembro e foi paga em outubro: é de outubro.
      { ...conta(300, StatusContaPagar.PAGO, '2026-09-25'), pagoEm: dia('2026-10-02T00:00:00Z') },
      conta(80, StatusContaPagar.APROVADO, '2026-10-20'),
      conta(40, StatusContaPagar.APROVADO, '2026-11-05'),
    ];
    type Filtro = { galaoId?: unknown; data?: { gte: Date; lt: Date } };
    const filtrar = (where: Filtro) =>
      abastecimentos.filter(
        (a) =>
          (where.galaoId === null ? a.galaoId === null : a.galaoId !== null) &&
          (!where.data || (a.data >= where.data.gte && a.data < where.data.lt)),
      );
    const prisma = {
      veiculo: {
        findMany: jest.fn(async () => [
          { ...MOTO, consumoIdeal: null, contas, partesDeContas: [], responsaveis: [], logins: [] },
        ]),
      },
      abastecimento: {
        groupBy: jest.fn(async ({ where }: { where: Filtro }) => {
          const lista = filtrar(where);
          if (lista.length === 0) return [];
          return [
            {
              veiculoId: 'v1',
              galaoId: null,
              _sum: { valor: lista.reduce((s, a) => s + (a.valor ?? 0), 0), litros: 0 },
              _count: { _all: lista.length, valor: lista.filter((a) => a.valor != null).length },
              _max: { km: Math.max(...lista.map((a) => a.km)), horimetro: null },
            },
          ];
        }),
        findMany: jest.fn(async () => abastecimentos),
      },
    };
    const servicoDeAbastecimentos = { precosDosGaloes: jest.fn(async () => new Map()) };
    return new VeiculosService(
      prisma as never,
      {} as never,
      servicoDeAbastecimentos as never,
      {} as never,
    );
  }

  it('em outubro, só o de outubro', async () => {
    const [moto] = await montar().listar(true, '2026-10');

    // A paga em outubro e a em aberto que vence em outubro; a de novembro, não.
    expect(moto.gasto).toBe(380);
    expect(moto.emAberto).toBe(80);
    expect(moto.quantidade).toBe(2);
    // Os dois de outubro; o das 22h do dia 30 ficou em setembro.
    expect(moto.combustivel).toBe(70);
    expect(moto.abastecimentos).toBe(2);
    expect(moto.abastecimentosAConferir).toBe(1);
    expect(moto.ultimoKm).toBe(2000);
    // De 1300 km (o último de setembro) a 2000 km, com os 20 L de outubro.
    expect(moto.consumo).toMatchObject({ medio: 35, base: 2 });
  });

  it('em setembro, a conta que só foi paga em outubro não aparece', async () => {
    const [moto] = await montar().listar(true, '2026-09');

    expect(moto.gasto).toBe(0);
    expect(moto.quantidade).toBe(0);
    expect(moto.combustivel).toBe(110);
    expect(moto.abastecimentos).toBe(2);
    // Sem nada antes de setembro, a média começa no dia 10: 300 km com 10 L.
    expect(moto.consumo).toMatchObject({ medio: 30, base: 2 });
  });

  it('mês sem abastecimento fica sem média', async () => {
    const [moto] = await montar().listar(true, '2026-11');

    expect(moto.gasto).toBe(40);
    expect(moto.combustivel).toBe(0);
    expect(moto.abastecimentos).toBe(0);
    expect(moto.consumo).toMatchObject({ medio: null, base: 0 });
  });

  it('sem mês, tudo desde sempre', async () => {
    const [moto] = await montar().listar(true);

    expect(moto.gasto).toBe(420);
    expect(moto.combustivel).toBe(180);
    expect(moto.abastecimentos).toBe(4);
    // De 1000 a 2000 km com os 30 L de depois do primeiro.
    expect(moto.consumo).toMatchObject({ medio: 33.33, base: 4 });
  });

  it('mês fora do formato é recusado', async () => {
    await expect(montar().listar(true, '10/2026')).rejects.toThrow(BadRequestException);
  });
});
