import { BadRequestException } from '@nestjs/common';
import {
  buildBaixaContaPagarPayload,
  formatValorBaixaIxc,
} from '../ixc/ixc.financeiro';
import { PagamentosService } from './pagamentos.service';

/**
 * Pagar daqui mexe no financeiro de verdade da empresa. O que este arquivo
 * protege:
 *
 *  - conta já paga não é paga de novo (o erro mais caro desta tela: o dinheiro
 *    sairia duas vezes do caixa);
 *  - conta cancelada ou reprovada na auditoria não passa por cima de quem
 *    decidiu isso;
 *  - o valor vai no formato que o IXC entende — com vírgula. Com ponto ele
 *    grava outro número sem reclamar, e a conta consta paga por valor errado;
 *  - "pelo banco" não dá baixa nenhuma: só aprova. Quem paga é o banco depois.
 */

const CFG = {
  contaPagamentoId: 18,
  contaPagamentoCaixaId: 23,
  contaContabilAvulso: 324,
  filialId: 1,
};

function montarServico(
  opts: {
    titulo?: Record<string, unknown> | null;
    /** Como o título fica quando relido depois da baixa. */
    depoisDaBaixa?: Record<string, unknown>;
    /** O IXC recusa a baixa com esta mensagem. */
    recusaABaixa?: string;
    /** A releitura de conferência também falha. */
    naoDeixaReler?: boolean;
    /** O cadastro da conta não traz a conta do razão. */
    contaSemPlanejamento?: boolean;
  } = {},
) {
  const titulo =
    'titulo' in opts
      ? opts.titulo
      : {
          id: '4242',
          status: 'A',
          valor: '1500.00',
          valor_aberto: '1500.00',
          id_contas: '18',
          id_conta: '2420',
          filial_id: '1',
          documento: 'NF 123',
        };

  const criados: Array<{ recurso: string; payload: Record<string, unknown> }> = [];
  let leituras = 0;

  const ixc = {
    getById: jest.fn(async (recurso: string) => {
      /*
       * O cadastro da conta de onde o dinheiro sai. O `id_planejamento` é a
       * conta do razão dela, e é ela que a baixa manda no `id_conta` — sem
       * isso o lançamento não chega ao banco e o pagamento não aparece para
       * conciliar. Não conta como leitura do título.
       */
      if (recurso === 'contas') {
        return opts.contaSemPlanejamento
          ? { id: '23', conta: 'CX - Werick' }
          : { id: '23', conta: 'CX - Werick', id_planejamento: '12833' };
      }
      if (recurso === 'filial') return { id: '1', filial: 'Matriz' };

      leituras += 1;
      // A segunda leitura é a conferência de depois da baixa: por padrão o IXC
      // devolve o título já quitado, que é o que acontece quando dá certo.
      if (leituras > 1) {
        if (opts.naoDeixaReler) throw new Error('IXC fora do ar');
        return (
          opts.depoisDaBaixa ?? {
            ...titulo,
            status: 'P',
            valor_aberto: '0',
            valor_total_pago: titulo?.valor_aberto,
            data_pagamento: '15/08/2026',
          }
        );
      }
      return titulo;
    }),
    create: jest.fn(async (recurso: string, payload: Record<string, unknown>) => {
      criados.push({ recurso, payload });
      return { id: 1, raw: {} };
    }),
    // A baixa vai pelo endpoint de botão do IXC, não pelo CRUD.
    action: jest.fn(async (recurso: string, payload: Record<string, unknown>) => {
      criados.push({ recurso, payload });
      if (opts.recusaABaixa) throw new Error(opts.recusaABaixa);
      return {};
    }),
    remove: jest.fn(async () => ({})),
  };

  const config = { obter: jest.fn().mockResolvedValue(CFG) };
  const prisma = {
    contaPagar: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      // De onde sai o nome de quem recebeu, para o histórico da baixa. Sem
      // cadastro daqui o serviço cai no que o título trouxer.
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  // O quarto: quem sabe o que cai junto ao apagar uma conta a pagar daqui.
  const contasPagar = { apagarLocalPorTituloIxc: jest.fn() };
  const service = new PagamentosService(
    ixc as never,
    config as never,
    prisma as never,
    contasPagar as never,
  );
  return { service, ixc, criados, prisma, contasPagar };
}

describe('PagamentosService.pagar', () => {
  it('pela conta do ModoBank: só aprova, sem baixa', async () => {
    const { service, criados } = montarServico();

    // 18 é a `contaPagamentoId` da configuração — a conta que o banco paga
    // sozinho, pela tela do IXC.
    const r = await service.pagar(4242, { contaPagamento: 18 }, 'Aurelio');

    expect(r).toMatchObject({
      aprovada: true,
      paga: false,
      aguardandoBanco: true,
      valor: 1500,
    });
    expect(criados.map((c) => c.recurso)).toEqual(['fn_apagar_auditoria']);
  });

  it('pela conta do ModoBank, com o dinheiro já saído: aprova e baixa nela', async () => {
    // O único motivo de não baixar na conta do ModoBank é haver um pagamento
    // do banco a esperar. Quem diz que o dinheiro já saiu desfaz essa premissa
    // — e a baixa é a mesma que se daria à mão na tela do IXC, na data em que
    // ele saiu, que é por onde a conciliação acha a linha do extrato.
    const { service, criados } = montarServico();

    const r = await service.pagar(
      4242,
      { contaPagamento: 18, data: '2026-08-08', jaSaiu: true },
      'Aurelio',
    );

    expect(r).toMatchObject({
      aprovada: true,
      paga: true,
      aguardandoBanco: false,
    });
    expect(criados.map((c) => c.recurso)).toEqual([
      'fn_apagar_auditoria',
      'botao_pagar_26409',
    ]);

    const baixa = criados.at(-1)!;
    expect(baixa.payload).toMatchObject({
      conta_: 18,
      // A data informada, não a de hoje: foi nela que o dinheiro saiu.
      data: '08/08/2026',
    });
  });

  it('por qualquer outra conta: aprova e dá a baixa nela', async () => {
    const { service, criados } = montarServico();

    const r = await service.pagar(
      4242,
      { contaPagamento: CFG.contaPagamentoCaixaId, data: '2026-08-15' },
      'Aurelio',
    );

    expect(criados.map((c) => c.recurso)).toEqual([
      'fn_apagar_auditoria',
      'botao_pagar_26409',
    ]);
    const baixa = criados[1].payload;
    expect(baixa).toMatchObject({
      id_pagar: 4242,
      // O dinheiro sai do caixa configurado, não da conta do banco do título.
      conta_: CFG.contaPagamentoCaixaId,
      // A conta do **razão** daquela conta de pagamento, não a contábil do
      // título (2420). É ela que faz a baixa lançar na conta de onde o
      // dinheiro saiu — e é dessa conta que a conciliação lê os movimentos.
      id_conta: 12833,
      data: '15/08/2026',
      documento: 'NF 123',
      valor_total_pago: '1500,00',
    });
    expect(r.paga).toBe(true);
  });

  /*
   * Desconto por antecipação.
   *
   * O que vai para o IXC é o líquido: é ele que vira a linha da movimentação
   * financeira, e é essa linha que a conciliação casa com o extrato. Mandar o
   * valor cheio poria lá uma saída que o banco não teve, e a conta não
   * conciliaria nunca.
   */
  it('com desconto, para o IXC vai o que saiu — e o título continua devendo o cheio', async () => {
    const { service, criados } = montarServico();

    const r = await service.pagar(
      4242,
      { contaPagamento: CFG.contaPagamentoCaixaId, data: '2026-08-15', desconto: 100 },
      'Aurelio',
    );

    expect(criados[1].payload).toMatchObject({
      vdesconto: '100,00',
      debito: '1500,00',
      valor_total_pago: '1400,00',
    });
    expect(r).toMatchObject({ valor: 1500, valorPago: 1400, desconto: 100 });
  });

  it('desconto que não cabe no percentual do IXC é recusado antes da viagem', async () => {
    /*
     * O IXC guarda o desconto como percentual de quatro casas e recusa o que
     * não couber — mas só depois de receber a baixa, com uma mensagem sobre
     * casas decimais e sem dizer que valor serve. Aqui a conta é feita antes,
     * e a recusa diz o que fazer.
     *
     * O título do fixture é de R$ 1.500,00: um centavo dá 0,0007%, que cabe;
     * o caso que não cabe é o título grande. Este teste usa um de R$ 31.000,00,
     * que é o que apareceu no uso real.
     */
    const { service, criados } = montarServico({
      titulo: {
        id: '31646',
        status: 'A',
        valor: '31000.00',
        valor_aberto: '31000.00',
        id_contas: '18',
        filial_id: '1',
      },
    });

    await expect(
      service.pagar(31646, {
        contaPagamento: CFG.contaPagamentoCaixaId,
        desconto: 0.01,
      }),
    ).rejects.toThrow(/quatro casas/i);

    // Nada foi escrito no IXC — nem a aprovação da auditoria.
    expect(criados).toEqual([]);
  });

  it('desconto que come o título inteiro não é pagamento', async () => {
    const { service, criados } = montarServico();

    await expect(
      service.pagar(
        4242,
        { contaPagamento: CFG.contaPagamentoCaixaId, desconto: 1500 },
        'Aurelio',
      ),
    ).rejects.toThrow(BadRequestException);

    // E recusa antes de escrever qualquer coisa no IXC.
    expect(criados).toEqual([]);
  });

  it('pelo ModoBank o desconto não é aplicado, e a tela fica sabendo', async () => {
    // Lá quem paga é o banco, pela tela dele: o abatimento tem de ser
    // informado ali. Guardá-lo em silêncio faria a economia aparecer neste
    // app sem um centavo a menos ter saído.
    const { service } = montarServico();

    const r = await service.pagar(4242, { contaPagamento: 18, desconto: 100 });

    expect(r).toMatchObject({ aguardandoBanco: true, desconto: 0, valorPago: 1500 });
    expect(r.avisos.join(' ')).toMatch(/desconto/i);
  });

  it('o lote recusa desconto para várias contas de uma vez', async () => {
    // Ratear inventaria abatimento em título que ninguém negociou; repetir
    // multiplicaria a economia pelo tamanho do lote.
    const { service } = montarServico();

    await expect(
      service.pagarEmLote([4242, 4243], {
        contaPagamento: CFG.contaPagamentoCaixaId,
        desconto: 100,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('o lote soma o que saiu do caixa e o que se economizou', async () => {
    const { service } = montarServico();

    const r = await service.pagarEmLote([4242], {
      contaPagamento: CFG.contaPagamentoCaixaId,
      desconto: 100,
    });

    expect(r).toMatchObject({ total: 1400, economia: 100 });
  });

  it('a baixa lança na conta do razão do banco, que é o que a conciliação lê', async () => {
    /*
     * A baixa cria um par de linhas em `fn_movim_finan`: uma `M`, o dinheiro
     * saindo da conta bancária, e uma `P`, a despesa. A conciliação lê a `M`,
     * e ela só existe na conta do razão do banco.
     *
     * Mandando aqui a conta contábil do título, o IXC escrevia as duas linhas
     * nela e nada era lançado no banco: o pagamento constava pago e não
     * aparecia para conciliar, sem erro em lugar nenhum. Comparado com um
     * título pago pela tela do IXC, as duas linhas dele têm contas diferentes;
     * nos nossos, tinham a mesma.
     */
    const { service, criados } = montarServico();

    await service.pagar(4242, { contaPagamento: 23 }, 'Aurelio');

    const baixa = criados.at(-1)!.payload;
    // 12833 é o `id_planejamento` do cadastro da conta; 2420 é a contábil do
    // título, que era o que ia antes.
    expect(baixa.id_conta).toBe(12833);
    expect(baixa.id_conta).not.toBe(2420);
  });

  /**
   * Antes, sem o razão a baixa saía assim mesmo, com a conta contábil no lugar
   * dele, e um aviso na tela. O aviso não salvou ninguém: oito pagamentos de
   * agosto foram para a conta da despesa, o título constou pago, e a
   * conciliação ficou sem o que listar até alguém estornar e refazer à mão.
   *
   * Recusar sai mais barato — e recusa antes de mandar a baixa, com o título
   * ainda aprovado e nada pago: quem clicou tenta de novo.
   */
  it('sem a conta do razão, não paga — e não deixa rastro no IXC', async () => {
    const { service, criados } = montarServico({ contaSemPlanejamento: true });

    await expect(
      service.pagar(4242, { contaPagamento: 23 }, 'Aurelio'),
    ).rejects.toThrow(/conciliação bancária/i);

    expect(criados.some((c) => c.recurso.includes('botao_pagar'))).toBe(false);
  });

  it('título já pago não é pago de novo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'P',
        valor: '1500.00',
        valor_aberto: '0',
        valor_total_pago: '1500.00',
        data_pagamento: '10/08/2026',
      },
    });

    await expect(service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('título cancelado no IXC não é pago', async () => {
    const { service, criados } = montarServico({
      titulo: { id: '4242', status: 'C', valor: '1500.00', valor_aberto: '1500.00' },
    });

    await expect(service.pagar(4242, { contaPagamento: 18 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('reprovado na auditoria não é destravado por baixo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
        status_auditoria: 'R',
      },
    });

    await expect(service.pagar(4242, { contaPagamento: 18 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(criados).toHaveLength(0);
  });

  it('já aprovado antes não é aprovado de novo', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
        status_auditoria: 'A',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.aprovada).toBe(true);
    expect(criados.map((c) => c.recurso)).toEqual(['botao_pagar_26409']);
  });

  it('paga o saldo em aberto, não o valor cheio do título', async () => {
    const { service, criados } = montarServico({
      titulo: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        // Metade já foi paga antes; o que sai agora é o resto.
        valor_aberto: '500.00',
        valor_total_pago: '1000.00',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.valor).toBe(500);
    expect(criados[1].payload).toMatchObject({ valor_total_pago: '500,00' });
  });

  it('avisa quando o IXC aceita a baixa mas o título segue aberto lá', async () => {
    const { service } = montarServico({
      depoisDaBaixa: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
      },
    });

    const r = await service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId });

    expect(r.paga).toBe(false);
    expect(r.avisos.join(' ')).toContain('continua aparecendo como aberto');
  });
});

describe('formatValorBaixaIxc', () => {
  it('usa vírgula decimal e duas casas', () => {
    expect(formatValorBaixaIxc(1500)).toBe('1500,00');
    expect(formatValorBaixaIxc(0.2)).toBe('0,20');
    expect(formatValorBaixaIxc(1234.567)).toBe('1234,57');
  });

  it('não põe separador de milhar', () => {
    // "1.234,56" faria o IXC ler 1,23456 — a conta constaria paga por um real.
    expect(formatValorBaixaIxc(1234.56)).not.toContain('.');
  });
});

describe('buildBaixaContaPagarPayload', () => {
  it('manda as três colunas de valor iguais numa quitação de uma vez', () => {
    const p = buildBaixaContaPagarPayload({
      idFnApagar: 7,
      contaPagamentoId: 23,
      contaPlanejamentoId: 2420,
      filialId: 1,
      valor: 340.5,
      data: new Date(Date.UTC(2026, 7, 15)),
      historico: 'Pagamento em mãos',
    });

    expect(p).toMatchObject({
      valor_parcela: '340,50',
      debito: '340,50',
      valor_total_pago: '340,50',
      tipo_pagamento: 'D',
      tipo_lanc: 'P',
      data: '15/08/2026',
    });
  });
});

/**
 * O IXC recusando a baixa que ele mesmo gravou.
 *
 * Aconteceu em produção: HTTP 200, `type: "error"`, sem mensagem — e a conta
 * quitada do outro lado. A tela dizia "0 contas pagas / 1 não saíram", e o
 * passo seguinte natural de quem lê isso é pagar de novo, tirando o dinheiro
 * duas vezes.
 *
 * A regra que este bloco fixa: quem decide se o pagamento saiu não é a resposta
 * da chamada, é o estado do título no IXC depois dela.
 */
describe('PagamentosService.pagar — quando o IXC recusa a baixa', () => {
  const RECUSA = 'IXC (/botao_pagar_26409): recusou sem dizer o motivo (HTTP 200)';

  it('recusou mas quitou: vale como pago, com o aviso para ninguém repetir', async () => {
    const { service } = montarServico({ recusaABaixa: RECUSA });

    const r = await service.pagar(4242, {
      contaPagamento: CFG.contaPagamentoCaixaId,
    });

    expect(r.paga).toBe(true);
    expect(r.valor).toBe(1500);
    expect(r.avisos.join(' ')).toContain('não repita');
  });

  /** Recusou e a conta continua aberta: aí a recusa e recusa mesmo. */
  it('recusou e não quitou: falha, para ninguém dar por pago o que não saiu', async () => {
    const { service } = montarServico({
      recusaABaixa: RECUSA,
      depoisDaBaixa: {
        id: '4242',
        status: 'A',
        valor: '1500.00',
        valor_aberto: '1500.00',
      },
    });

    await expect(
      service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId }),
    ).rejects.toThrow(/recusou sem dizer o motivo/);
  });

  /**
   * Recusou e nem deu para conferir. Sem saber, o unico caminho honesto e
   * parar e mandar olhar o IXC — dizer "pago" seria adivinhar sobre dinheiro,
   * e dizer "não saiu" convidaria a pagar de novo.
   */
  it('recusou e não deu para conferir: manda olhar no IXC antes de repetir', async () => {
    const { service } = montarServico({
      recusaABaixa: RECUSA,
      naoDeixaReler: true,
    });

    await expect(
      service.pagar(4242, { contaPagamento: CFG.contaPagamentoCaixaId }),
    ).rejects.toThrow(/antes de pagar de novo/);
  });

  it('baixa aceita continua sem aviso nenhum', async () => {
    const { service } = montarServico();

    const r = await service.pagar(4242, {
      contaPagamento: CFG.contaPagamentoCaixaId,
    });

    expect(r.paga).toBe(true);
    expect(r.avisos).toEqual([]);
  });
});

/**
 * Apagado é apagado.
 *
 * Aqui havia um `deleteMany` na `ContaPagar` e mais nada. A FK do pagamento
 * avulso é `SetNull`: o pagamento não ia junto, ficava sem conta a pagar e sem
 * lançamento no caixa, e nesse estado o painel o lia como "já saiu" — contado
 * no gasto e invisível como pendente. Foi assim que um acerto de teste apagado
 * continuou somando duas vendas no gráfico.
 *
 * A regra do que cai junto mora no `ContasPagarService`. O que este arquivo
 * protege é que este caminho a chame, em vez de decidir por conta própria.
 */
describe('apagar o título leva junto o que só existia por causa dele', () => {
  const emAberto = {
    id: '4242',
    status: 'A',
    valor: '100,00',
    valor_aberto: '100,00',
    data_pagamento: '',
  };

  it('chama quem sabe o que cai junto, e não apaga a conta por fora', async () => {
    const { service, contasPagar, prisma } = montarServico({
      titulo: emAberto,
    });

    await service.excluir(4242);

    expect(contasPagar.apagarLocalPorTituloIxc).toHaveBeenCalledWith(4242);
    // O `deleteMany` solto era justamente o que deixava o pagamento órfão.
    expect(prisma.contaPagar.deleteMany).not.toHaveBeenCalled();
  });

  it('título com baixa não é apagado, e nada cai junto', async () => {
    const { service, contasPagar } = montarServico({
      titulo: { ...emAberto, status: 'F' },
    });

    await expect(service.excluir(4242)).rejects.toThrow(/baixa/i);
    expect(contasPagar.apagarLocalPorTituloIxc).not.toHaveBeenCalled();
  });
});
