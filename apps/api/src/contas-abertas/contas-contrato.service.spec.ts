import { BadRequestException } from '@nestjs/common';
import { ContasContratoService, foraDoPadrao } from './contas-contrato.service';

/**
 * A conta de luz de cada endereço. O que este arquivo protege:
 *
 *  - a mesma fatura não é lançada duas vezes. São onze contas parecidas da
 *    mesma distribuidora no mesmo mês, e a que chega atrasada é sempre a
 *    candidata a entrar de novo sem ninguém lembrar;
 *  - o número da conta contrato vai no documento do título, que é como se
 *    descobre, meses depois, de que endereço era uma conta paga;
 *  - o que já entrou fica de pé quando a seguinte falha — são contas a pagar
 *    de verdade no IXC;
 *  - o vencimento sugerido não escorrega para o mês seguinte, e não cai num
 *    dia em que o banco não paga.
 */

function contrato(over: Record<string, unknown> = {}) {
  return {
    id: 'cc1',
    apelido: 'Garagem',
    numero: '3009834981',
    idFornecedorIxc: 501,
    fornecedorNome: 'Distribuidora de Energia',
    diaDeChegada: 5,
    diaDeVencimento: 10,
    valorDeReferencia: null,
    contaContabil: 331,
    contaPagamento: 18,
    tipoPagamentoIxc: 'Boleto',
    categoriaId: null,
    observacao: null,
    ativa: true,
    ...over,
  };
}

function montarServico(
  opts: {
    contratos?: Record<string, unknown>[];
    /** As contas a pagar que já existem ligadas a uma conta contrato. */
    jaLancadas?: Record<string, unknown>[];
    erroAoCriar?: string;
  } = {},
) {
  const contratos = opts.contratos ?? [contrato()];
  const criadas: Array<Record<string, unknown>> = [];
  const vinculos: Array<Record<string, unknown>> = [];

  const prisma = {
    contaContrato: {
      findMany: jest.fn().mockResolvedValue(contratos),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        contratos.find((c) => c.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: unknown }) => data),
      update: jest.fn(async ({ data }: { data: unknown }) => data),
      delete: jest.fn(),
    },
    contaPagar: {
      findMany: jest.fn().mockResolvedValue(opts.jaLancadas ?? []),
      findFirst: jest.fn(async () => opts.jaLancadas?.[0] ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        vinculos.push(data);
        return { id: 'c1', idFnApagarIxc: 7777, valor: 320.55, ...data };
      }),
    },
  };

  const contasPagar = {
    criarDespesa: jest.fn(async (dados: Record<string, unknown>) => {
      if (opts.erroAoCriar) throw new Error(opts.erroAoCriar);
      criadas.push(dados);
      return { id: 'c1', idFnApagarIxc: 7777, valor: dados.valor };
    }),
  };

  const categorias = { classificar: jest.fn() };

  const service = new ContasContratoService(
    prisma as never,
    contasPagar as never,
    categorias as never,
  );
  return { service, prisma, contasPagar, categorias, criadas, vinculos };
}

describe('ContasContratoService.gerar', () => {
  it('a fatura vira conta a pagar com o endereço e o mês escritos nela', async () => {
    const { service, criadas, vinculos } = montarServico();

    const r = await service.gerar('2026-08', [{ id: 'cc1', valor: 320.55 }]);

    expect(r.geradas).toHaveLength(1);
    expect(r.total).toBe(320.55);
    expect(criadas[0]).toMatchObject({
      idFornecedorIxc: 501,
      valor: 320.55,
      // O número da conta contrato: é por ele que se acha de que endereço era
      // uma conta paga, sem depender de o texto ter sido escrito igual.
      documento: '3009834981',
      contaContabil: 331,
      contaPagamento: 18,
      tipoPagamentoIxc: 'Boleto',
    });
    expect(criadas[0].observacao).toBe('Energia Garagem agosto/2026');
    // O vínculo é o que responde "a de agosto da Garagem já foi lançada?".
    expect(vinculos[0]).toMatchObject({
      contaContratoId: 'cc1',
      competencia: '2026-08',
    });
  });

  it('não lança a mesma competência duas vezes', async () => {
    const { service, contasPagar } = montarServico({
      jaLancadas: [{ id: 'c9', idFnApagarIxc: 4242, valor: 300 }],
    });

    const r = await service.gerar('2026-08', [{ id: 'cc1', valor: 320.55 }]);

    expect(r.geradas).toHaveLength(0);
    expect(r.falhas[0].erro).toMatch(/já foi lançada/i);
    // E recusa antes de escrever no IXC: nada de conta criada para depois
    // alguém descobrir que era repetida.
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('sem valor não há o que lançar', async () => {
    const { service, contasPagar } = montarServico();

    const r = await service.gerar('2026-08', [{ id: 'cc1', valor: 0 }]);

    expect(r.falhas[0].erro).toMatch(/valor/i);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('o que já entrou fica de pé quando a seguinte falha', async () => {
    const { service } = montarServico({
      contratos: [contrato(), contrato({ id: 'cc2', apelido: 'Loja' })],
      erroAoCriar: 'IXC fora do ar',
    });

    const r = await service.gerar('2026-08', [
      { id: 'cc1', valor: 100 },
      { id: 'cc2', valor: 200 },
    ]);

    expect(r.geradas).toHaveLength(0);
    expect(r.falhas).toHaveLength(2);
    // As duas foram tentadas: a falha de uma não interrompe o maço.
    expect(r.falhas.map((f) => f.apelido)).toEqual(['Garagem', 'Loja']);
  });

  it('sem data informada, vence no dia de sempre — andando para o dia útil', async () => {
    // Dia 10 de outubro de 2026 é um sábado: o banco não paga, e a conta
    // nasceria vencida se a data fosse ao pé da letra.
    const { service, criadas } = montarServico();

    await service.gerar('2026-10', [{ id: 'cc1', valor: 100 }]);

    expect(criadas[0].dataVencimento).toEqual(new Date(Date.UTC(2026, 9, 13)));
  });

  it('o dia de vencimento não escorrega para o mês seguinte', async () => {
    const { service, criadas } = montarServico({
      contratos: [contrato({ diaDeVencimento: 31 })],
    });

    // 31 de fevereiro não existe: vale o último dia do mês (28, em 2026), que
    // é um sábado — e daí o próximo dia útil.
    await service.gerar('2026-02', [{ id: 'cc1', valor: 100 }]);

    expect(criadas[0].dataVencimento).toEqual(new Date(Date.UTC(2026, 2, 2)));
  });

  it('a data informada manda sobre o dia de sempre', async () => {
    const { service, criadas } = montarServico();

    await service.gerar('2026-08', [
      { id: 'cc1', valor: 100, dataVencimento: '2026-08-22' },
    ]);

    expect(criadas[0].dataVencimento).toEqual(new Date(Date.UTC(2026, 7, 22)));
  });

  it('competência que não é um mês não passa', async () => {
    const { service } = montarServico();

    await expect(
      service.gerar('agosto', [{ id: 'cc1', valor: 100 }]),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ContasContratoService.listar', () => {
  it('diz o que já foi lançado no mês e o que aquele endereço costuma custar', async () => {
    const { service } = montarServico({
      jaLancadas: [
        {
          id: 'c1',
          contaContratoId: 'cc1',
          competencia: '2026-07',
          valor: 300,
          dataVencimento: new Date(Date.UTC(2026, 6, 10)),
          status: 'APROVADO',
          pagoEm: null,
          idFnApagarIxc: 1,
        },
        {
          id: 'c2',
          contaContratoId: 'cc1',
          competencia: '2026-06',
          valor: 400,
          dataVencimento: new Date(Date.UTC(2026, 5, 10)),
          status: 'PAGO',
          pagoEm: new Date(Date.UTC(2026, 5, 9)),
          idFnApagarIxc: 2,
        },
      ],
    });

    const r = await service.listar('2026-08');

    expect(r.competencia).toBe('2026-08');
    // A de agosto ainda não existe — as duas lidas são de meses anteriores.
    expect(r.contas[0].gerada).toBeNull();
    expect(r.contas[0].media).toBe(350);
    expect(r.contas[0].historico).toHaveLength(2);
  });

  it('a competência aberta não entra na própria média', async () => {
    // Senão a média já conteria o número que se está tentando conferir com ela.
    const { service } = montarServico({
      jaLancadas: [
        {
          id: 'c1',
          contaContratoId: 'cc1',
          competencia: '2026-08',
          valor: 9000,
          dataVencimento: new Date(Date.UTC(2026, 7, 10)),
          status: 'APROVADO',
          pagoEm: null,
          idFnApagarIxc: 1,
        },
        {
          id: 'c2',
          contaContratoId: 'cc1',
          competencia: '2026-07',
          valor: 300,
          dataVencimento: new Date(Date.UTC(2026, 6, 10)),
          status: 'PAGO',
          pagoEm: null,
          idFnApagarIxc: 2,
        },
      ],
    });

    const r = await service.listar('2026-08');

    expect(r.contas[0].gerada).toMatchObject({ valor: 9000 });
    expect(r.contas[0].media).toBe(300);
  });
});

describe('foraDoPadrao', () => {
  it('estranha o dobro e a metade — não a variação da estação', () => {
    expect(foraDoPadrao(3000, 300)).toBe(true);
    expect(foraDoPadrao(100, 300)).toBe(true);
    expect(foraDoPadrao(380, 300)).toBe(false);
  });

  it('sem histórico não estranha nada', () => {
    expect(foraDoPadrao(3000, null)).toBe(false);
  });
});
