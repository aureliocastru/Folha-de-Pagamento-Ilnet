import { BadRequestException } from '@nestjs/common';
import {
  ContasContratoService,
  foraDoPadrao,
  lerCodigoDaFatura,
} from './contas-contrato.service';

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
    /** Os títulos que o IXC devolve ao procurar o número na observação. */
    historicoIxc?: Record<string, unknown>[];
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

  // O quarto: quem vasculha o histórico do IXC atrás do que cada endereço
  // vem custando e do dia em que ele vence.
  const ixc = {
    list: jest.fn(async () => ({ registros: opts.historicoIxc ?? [], total: 0 })),
  };

  const service = new ContasContratoService(
    prisma as never,
    contasPagar as never,
    categorias as never,
    ixc as never,
  );
  return { service, prisma, contasPagar, categorias, ixc, criadas, vinculos };
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
    // O número vai escrito na observação, e não só no documento: é assim que
    // as contas de luz são procuradas no IXC.
    expect(criadas[0].observacao).toBe(
      'Energia Garagem agosto/2026 - conta contrato 3009834981',
    );
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

  it('o código da fatura decide como a conta vai ser paga', async () => {
    const { service, criadas } = montarServico();
    const emv = '00020126580014br.gov.bcb.pix0136abc6304ABCD';

    await service.gerar('2026-08', [{ id: 'cc1', valor: 100, codigo: emv }]);

    // O cadastro diz "Boleto"; a fatura chegou com QR Code, e é ela que manda.
    expect(criadas[0]).toMatchObject({
      chavePix: emv,
      tipoChavePix: 'Código copia e cola',
      tipoPagamentoIxc: 'Pix',
      codigoBarras: null,
    });
  });

  it('código irreconhecível não vira conta no IXC', async () => {
    const { service, contasPagar } = montarServico();

    const r = await service.gerar('2026-08', [
      { id: 'cc1', valor: 100, codigo: '123456' },
    ]);

    expect(r.falhas[0].erro).toMatch(/linha digitável|copia e cola/i);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
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

/**
 * O código com que a fatura se paga. Boleto e PIX moram em campos diferentes
 * do título no IXC: trocá-los deixa uma conta que nenhum banco paga.
 */
describe('lerCodigoDaFatura', () => {
  it('a linha digitável vira código de barras, e a conta vira boleto', () => {
    const linha = '8'.repeat(48);
    expect(lerCodigoDaFatura(linha)).toEqual({
      codigoBarras: linha,
      tipoPagamento: 'Boleto',
    });
  });

  it('a máscara do banco não vai junto', () => {
    const digitado = '84670000001-9 03390261202-3 40000063000-4 07110570460-2';
    expect(lerCodigoDaFatura(digitado).codigoBarras).toBe(
      digitado.replace(/\D/g, ''),
    );
  });

  it('o copia e cola vira chave PIX, e a conta vira Pix', () => {
    const emv = '00020126580014br.gov.bcb.pix0136abc6304ABCD';
    expect(lerCodigoDaFatura(emv)).toEqual({
      chavePix: emv,
      tipoChavePix: 'Código copia e cola',
      tipoPagamento: 'Pix',
    });
  });

  it('em branco não muda nada — a conta vai sem código', () => {
    expect(lerCodigoDaFatura('')).toEqual({});
    expect(lerCodigoDaFatura(undefined)).toEqual({});
  });

  it('o que não é nem um nem outro é recusado, e não chutado', () => {
    // Copia e cola truncado na cópia, ou meia linha digitável: mandar isso ao
    // IXC criaria um título sem como ser pago.
    expect(() => lerCodigoDaFatura('123456')).toThrow(BadRequestException);
  });
});

/**
 * A descoberta no histórico do IXC.
 *
 * A conta de luz é paga há anos, e cada fatura virou um título com o número da
 * conta contrato escrito na observação. É de lá que sai o que o cadastro
 * pergunta e ninguém tem de cabeça — e o que este bloco protege é o cuidado de
 * não trazer o dado do endereço errado.
 */
describe('ContasContratoService.descobrirNoHistorico', () => {
  function titulo(over: Record<string, unknown> = {}) {
    return {
      id: '1',
      obs: 'ENERGIA LOJA 3010664470',
      data_vencimento: '2026-07-10',
      valor: '1800.00',
      id_fornecedor: '3',
      id_conta: '54',
      id_contas: '14',
      tipo_pagamento: 'Boleto',
      status: 'F',
      ...over,
    };
  }

  it('lê o dia do vencimento, o fornecedor e a média do que já foi pago', async () => {
    const { service, ixc } = montarServico({
      historicoIxc: [
        titulo({ id: '1', data_vencimento: '2026-07-10', valor: '1800.00' }),
        titulo({ id: '2', data_vencimento: '2026-06-10', valor: '1600.00' }),
        titulo({ id: '3', data_vencimento: '2026-05-10', valor: '1700.00' }),
      ],
    });

    const r = await service.descobrirNoHistorico([
      { numero: '3010664470', apelido: 'Loja' },
    ]);

    expect(r.descobertas[0]).toMatchObject({
      numero: '3010664470',
      apelido: 'Loja',
      titulos: 3,
      diaDeVencimento: 10,
      contaContabil: 54,
      contaPagamento: 14,
      media: 1700,
      jaCadastrada: false,
    });
    expect(r.descobertas[0].fornecedor).toMatchObject({ id: 3 });
    // A busca é pelo texto da observação, que é onde o número mora no IXC.
    expect(ixc.list).toHaveBeenCalledWith(
      'fn_apagar',
      expect.objectContaining({ qtype: 'fn_apagar.obs', oper: 'L' }),
    );
  });

  it('o dia é o mais frequente, não o do último título', async () => {
    // Uma fatura paga com atraso e relançada com outra data não pode mudar o
    // dia do endereço inteiro.
    const { service } = montarServico({
      historicoIxc: [
        titulo({ id: '1', data_vencimento: '2026-07-28' }),
        titulo({ id: '2', data_vencimento: '2026-06-10' }),
        titulo({ id: '3', data_vencimento: '2026-05-10' }),
      ],
    });

    const r = await service.descobrirNoHistorico([{ numero: '3010664470' }]);

    expect(r.descobertas[0].diaDeVencimento).toBe(10);
  });

  it('não conta o título de outro endereço que o IXC devolveu junto', async () => {
    const { service } = montarServico({
      historicoIxc: [
        titulo({ id: '1', obs: 'ENERGIA LOJA 3010664470' }),
        titulo({ id: '2', obs: 'ENERGIA GARAGEM 3009834981', valor: '99.00' }),
      ],
    });

    const r = await service.descobrirNoHistorico([{ numero: '3010664470' }]);

    expect(r.descobertas[0].titulos).toBe(1);
  });

  it('título cancelado não entra na média nem no dia', async () => {
    const { service } = montarServico({
      historicoIxc: [
        titulo({ id: '1', status: 'C', valor: '99999.00' }),
        titulo({ id: '2', valor: '1800.00' }),
      ],
    });

    const r = await service.descobrirNoHistorico([{ numero: '3010664470' }]);

    expect(r.descobertas[0]).toMatchObject({ titulos: 1, media: 1800 });
  });

  it('sem nenhum título achado, diz o que houve em vez de inventar', async () => {
    const { service } = montarServico({ historicoIxc: [] });

    const r = await service.descobrirNoHistorico([{ numero: '3010664470' }]);

    expect(r.descobertas[0]).toMatchObject({
      titulos: 0,
      diaDeVencimento: null,
      media: null,
    });
    expect(r.descobertas[0].aviso).toMatch(/nenhum titulo/i);
  });

  it('a sugestão de cima é o que se repete em todos os endereços', async () => {
    const { service } = montarServico({ historicoIxc: [titulo()] });

    const r = await service.descobrirNoHistorico([
      { numero: '3010664470' },
      { numero: '3009834981' },
    ]);

    expect(r.sugestao).toMatchObject({
      contaContabil: 54,
      contaPagamento: 14,
      tipoPagamento: 'Boleto',
    });
    expect(r.sugestao.fornecedor).toMatchObject({ id: 3 });
  });

  it('o mesmo número duas vezes na lista é uma consulta só', async () => {
    const { service, ixc } = montarServico({ historicoIxc: [titulo()] });

    const r = await service.descobrirNoHistorico([
      { numero: '3010664470' },
      { numero: '3.010.664-470' },
    ]);

    expect(r.descobertas).toHaveLength(1);
    expect(ixc.list).toHaveBeenCalledTimes(1);
  });
});

describe('ContasContratoService.importar', () => {
  it('cadastra o que dá, e o repetido sai com o motivo', async () => {
    const { service, prisma } = montarServico();
    // O segundo número já está no cadastro: `criar` recusa por causa disso.
    prisma.contaContrato.findUnique = jest.fn(async ({ where }: never) =>
      (where as { numero?: string }).numero === '3009834981'
        ? { id: 'x', apelido: 'Garagem' }
        : null,
    ) as never;
    prisma.contaContrato.create = jest.fn(async ({ data }: never) => ({
      ...(data as object),
      id: 'novo',
    })) as never;

    const r = await service.importar(
      { idFornecedorIxc: 3, fornecedorNome: 'CEMAR', contaContabil: 54 },
      [
        {
          apelido: 'Loja',
          numero: '3010664470',
          diaDeChegada: 10,
          diaDeVencimento: 10,
          valorDeReferencia: 1700,
        },
        {
          apelido: 'Garagem',
          numero: '3009834981',
          diaDeChegada: 12,
          diaDeVencimento: 12,
        },
      ],
    );

    expect(r.criadas).toHaveLength(1);
    expect(r.falhas[0]).toMatchObject({ apelido: 'Garagem' });
    expect(r.falhas[0].erro).toMatch(/já está cadastrada/i);
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
