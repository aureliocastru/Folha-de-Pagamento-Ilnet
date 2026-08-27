import { estaEmAberto } from './contas-abertas.mapper';
import {
  aplicarBaixa,
  mapPagamento,
  motivoDeNaoSerPagamento,
  ordenarPorPagamento,
  resumirPagamentos,
  type PagamentoFeito,
} from './historico-pagamentos.mapper';

/**
 * Esta tela responde "isto saiu mesmo, no dia certo, pelo valor certo?". Um erro
 * aqui não quebra nada — ele diz que um pagamento aconteceu, que é pior. Por
 * isso os casos cobrem o estorno, o status que fica parado em "A", o pagamento
 * parcial, e a fronteira com a tela de contas em aberto: nenhum título pode
 * ficar nas duas listas nem fora das duas.
 */

/**
 * Um fn_apagar cru já baixado, como o IXC devolve: tudo string.
 *
 * O status vem "F" porque é o desta base — são 34 mil títulos com ele, e "P",
 * que é o código documentado, não aparece em nenhum. O fixture usa o real de
 * propósito: com "P" aqui, os testes passariam e a tela reclamaria de todos os
 * pagamentos do IXC de verdade.
 */
function pago(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '4821',
    status: 'F',
    id_fornecedor: '77',
    fornecedor: 'ENERGISA CEARA',
    valor: '1.250,00',
    data_emissao: '01/07/2026',
    data_vencimento: '20/07/2026',
    data_pagamento: '20/07/2026',
    valor_total_pago: '1.250,00',
    valor_aberto: '0,00',
    tipo_pagamento: 'Pix',
    id_contas: '18',
    documento: 'NF 55123',
    obs: 'Energia da torre',
    ...over,
  };
}

describe('o que conta como pagamento feito', () => {
  it('aceita o título baixado', () => {
    expect(motivoDeNaoSerPagamento(pago())).toBeNull();
  });

  it('recusa o título que ainda é dívida', () => {
    const aberto = pago({
      status: 'A',
      data_pagamento: '',
      valor_total_pago: '',
      valor_aberto: '1.250,00',
    });
    expect(motivoDeNaoSerPagamento(aberto)).toEqual({
      motivo: 'nao-pago',
      campo: 'status',
    });
  });

  /**
   * O status preso em "A" é o caso que fez quatro títulos de 2023 aparecerem
   * como vencidos na tela de contas a pagar. Quem manda é a baixa.
   */
  it('aceita o título baixado com o status parado em A', () => {
    const preso = pago({ status: 'A' });
    expect(motivoDeNaoSerPagamento(preso)).toBeNull();
    expect(mapPagamento(preso)!.statusNoIxc).toBe('A');
  });

  it('acha a baixa nos outros nomes de coluna', () => {
    for (const campo of ['data_baixa', 'data_hora_baixa', 'dt_baixa']) {
      const raw = pago({ status: 'A', data_pagamento: '', [campo]: '20/07/2026' });
      expect(mapPagamento(raw)!.campoDaBaixa).toBe(campo);
    }
  });

  /**
   * Estorno é a única coisa que esta tela não pode confundir: contar um
   * pagamento cancelado inventa uma despesa que não houve.
   */
  it('recusa o pagamento estornado, mesmo com a baixa preenchida', () => {
    expect(motivoDeNaoSerPagamento(pago({ status: 'C' }))).toEqual({
      motivo: 'cancelado',
      campo: 'status',
    });
    expect(
      motivoDeNaoSerPagamento(pago({ data_cancelamento: '25/07/2026' })),
    ).toEqual({ motivo: 'cancelado', campo: 'data_cancelamento' });
    expect(mapPagamento(pago({ status: 'C' }))).toBeNull();
  });

  it('separa o pago sem dia do pago com dia', () => {
    const semDia = pago({ data_pagamento: '' });
    expect(motivoDeNaoSerPagamento(semDia)).toEqual({
      motivo: 'sem-data',
      campo: 'status',
    });
  });

  /**
   * Os dois códigos de pago valem: "F" é o desta base, "P" é o documentado e o
   * de outras instalações. Um erro aqui não some com nada da tela — ele põe
   * ressalva em todo pagamento, o que é o mesmo que não ter conferência.
   */
  it('aceita os dois codigos de status pago', () => {
    for (const status of ['F', 'P']) {
      const raw = pago({ status, data_pagamento: '' });
      expect(motivoDeNaoSerPagamento(raw)).toEqual({
        motivo: 'sem-data',
        campo: 'status',
      });

      const p = mapPagamento(pago({ status }))!;
      expect(p.conferencia.fecha).toBe(true);
      // A tela mostra "F — pago" a partir disto. Sem ele, ela escreveria
      // "baixado mesmo assim" nos 34 mil pagamentos normais desta base.
      expect(p.statusEhDePago).toBe(true);
    }
  });

  it('marca como suspeito o status que nao e de pago', () => {
    const preso = mapPagamento(pago({ status: 'A' }))!;
    expect(preso.statusEhDePago).toBe(false);
    expect(preso.conferencia.fecha).toBe(false);
  });

  it('não conta 0000-00-00 como baixa', () => {
    const zerada = pago({ status: 'A', data_pagamento: '0000-00-00' });
    expect(motivoDeNaoSerPagamento(zerada)).toEqual({
      motivo: 'nao-pago',
      campo: 'status',
    });
  });
});

/**
 * A fronteira entre as duas telas. Um título é dívida **ou** pagamento — as duas
 * listas saem da mesma tabela, e se discordassem uma conta poderia aparecer nas
 * duas (cobrança em dobro na leitura de quem confere) ou em nenhuma (dinheiro
 * que saiu e não está em lugar nenhum).
 */
describe('nenhum título nas duas listas nem fora das duas', () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ['aberto normal', pago({ status: 'A', data_pagamento: '', valor_aberto: '1.250,00' })],
    ['pago normal', pago()],
    ['baixado com status preso', pago({ status: 'A' })],
    ['cancelado', pago({ status: 'C' })],
    ['nunca liberado', pago({ status: 'A', data_pagamento: '', liberado: 'N', valor_aberto: '1.250,00' })],
  ];

  it.each(casos)('%s fica em exatamente um lado', (_nome, raw) => {
    const aberto = estaEmAberto(raw);
    const pagamento = motivoDeNaoSerPagamento(raw) === null;
    expect(aberto && pagamento).toBe(false);
  });

  /**
   * O pagamento parcial é a exceção proposital, e a única: ele é dívida pelo
   * saldo **e** pagamento pelo que já saiu. Aparecer nas duas telas é o certo —
   * o que não pode é o valor ser contado inteiro nos dois lados.
   */
  it('o parcial aparece nos dois, cada um com a sua parte', () => {
    const parcial = pago({
      status: 'A',
      valor_aberto: '250,00',
      valor_total_pago: '1.000,00',
    });

    expect(estaEmAberto(parcial)).toBe(true);
    const p = mapPagamento(parcial)!;
    expect(p.parcial).toBe(true);
    expect(p.valorPago).toBe(1000);
    expect(p.valorAberto).toBe(250);
  });
});

describe('ler um pagamento', () => {
  it('traz o dia, o valor que saiu e de onde saiu', () => {
    const p = mapPagamento(pago())!;

    expect(p.idFnApagar).toBe(4821);
    expect(p.valor).toBe(1250);
    expect(p.valorPago).toBe(1250);
    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(p.campoDaBaixa).toBe('data_pagamento');
    expect(p.formaPagamento).toBe('Pix');
    expect(p.caixa.id).toBe(18);
    expect(p.fornecedor).toEqual({ id: 77, nome: 'ENERGISA CEARA' });
  });

  /**
   * `conta_pagamento` promete o nome da conta e entrega o código dela — e só
   * vem preenchida nos títulos lançados pela tela do IXC. Lida como nome, a
   * lista de pagos mostrava "14" numa linha e "Conta Sicoob" na de baixo, para
   * a mesma conta, e quem visse "14" não tinha como saber de onde saiu.
   */
  it('código na coluna de nome não vira nome — fica para o índice de contas', () => {
    const p = mapPagamento(pago({ conta_pagamento: '14', id_contas: '14' }))!;

    expect(p.caixa.id).toBe(14);
    expect(p.caixa.nome).toBeNull();
  });

  it('nome de verdade na coluna de nome é aproveitado', () => {
    const p = mapPagamento(pago({ conta_pagamento: 'Conta Sicoob' }))!;

    expect(p.caixa.nome).toBe('Conta Sicoob');
  });

  it('conta os dias de atraso pelo dia civil', () => {
    expect(mapPagamento(pago())!.diasDeAtraso).toBe(0);
    expect(
      mapPagamento(pago({ data_pagamento: '23/07/2026' }))!.diasDeAtraso,
    ).toBe(3);
    expect(
      mapPagamento(pago({ data_pagamento: '18/07/2026' }))!.diasDeAtraso,
    ).toBe(-2);
  });

  it('sem vencimento no IXC, não inventa atraso', () => {
    const p = mapPagamento(pago({ data_vencimento: '' }))!;
    expect(p.diasDeAtraso).toBeNull();
  });

  /**
   * A listagem do webservice não devolve as colunas de valor pago em toda base —
   * foi o que fez um título já baixado aparecer devendo o valor inteiro na outra
   * tela. Sem elas, o que saiu é o título menos o que ainda falta.
   */
  it('sem coluna de valor pago, calcula pelo que falta', () => {
    const semColuna = pago({ valor_total_pago: '', valor_aberto: '250,00' });
    expect(mapPagamento(semColuna)!.valorPago).toBe(1000);

    const integral = pago({ valor_total_pago: '', valor_aberto: '0,00' });
    expect(mapPagamento(integral)!.valorPago).toBe(1250);
  });

  it('lê o pago da coluna de baixa quando é a única preenchida', () => {
    const raw = pago({ valor_total_pago: '', valor_baixado: '1.250,00' });
    expect(mapPagamento(raw)!.valorPago).toBe(1250);
  });

  it('não aceita baixa com conteúdo que não é data', () => {
    expect(mapPagamento(pago({ data_pagamento: 'pago' }))).toBeNull();
  });
});

/**
 * O dia do dinheiro está no próprio título, e não era ele que se lia.
 *
 * `data_pagamento` é o dia em que a **baixa foi registrada** — a tela do IXC a
 * mostra como "Data/hora baixa", com hora. O dia informado ao baixar fica em
 * `debito_data`, na coluna que aquela tela chama de "Data pagamento".
 *
 * O caso real: título 37037, estacas de eucalipto, vencimento 10/08/2026, pago
 * no dia e lançado aqui em 18/08 às 15:48. A tela dizia "pago 8 dias depois" de
 * uma conta paga no vencimento — no IXC, ao lado, estava certo.
 */
describe('o dia do débito, que o título já traz', () => {
  const lancadoOitoDiasDepois = pago({
    data_vencimento: '10/08/2026',
    data_pagamento: '18/08/2026 15:48:03',
    debito_data: '10/08/2026',
    valor: '19.500,00',
    valor_total_pago: '19.500,00',
  });

  it('o pagamento é do dia do débito, não do dia do registro', () => {
    const p = mapPagamento(lancadoOitoDiasDepois)!;

    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(p.diasDeAtraso).toBe(0);
    expect(p.fonteDaData).toBe('debito');
    expect(p.campoDoDia).toBe('debito_data');
  });

  /* O dia do registro não se perde: é por ele que o título é achado na leitura
     do IXC, e é ele que explica por que a conta apareceu naquele período. */
  it('guarda à parte o dia em que a baixa foi registrada', () => {
    const p = mapPagamento(lancadoOitoDiasDepois)!;
    expect(p.registradoEm.toISOString().slice(0, 10)).toBe('2026-08-18');
  });

  it('sem o dia do débito, continua valendo o do registro', () => {
    const p = mapPagamento(
      pago({ data_vencimento: '10/08/2026', data_pagamento: '18/08/2026' }),
    )!;

    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-08-18');
    expect(p.fonteDaData).toBe('titulo');
    expect(p.campoDoDia).toBe('data_pagamento');
    expect(p.diasDeAtraso).toBe(8);
  });

  /* Coluna vazia é coluna que não existe: `00/00/0000` é como o IXC escreve
     "ainda não" na parcela que não foi paga. */
  it('débito zerado não vira data de pagamento', () => {
    const p = mapPagamento(
      pago({ data_pagamento: '18/08/2026', debito_data: '00/00/0000' }),
    )!;

    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-08-18');
    expect(p.fonteDaData).toBe('titulo');
    // A ficha nomeia a coluna que respondeu, e não a que foi consultada.
    expect(p.campoDoDia).toBe('data_pagamento');
  });
});

/**
 * O caso que trouxe isto: uma compra vencida em 15/08 e paga no dia, lançada
 * aqui no dia 16. O IXC grava em `data_pagamento` o dia do registro, e a tela
 * dizia "pago 1 dia depois" de um pagamento feito no vencimento — cobrando de
 * quem pagou um atraso que foi do lançamento. Quem sabe o dia do dinheiro é a
 * linha de baixa, que é o que a aba "Pagamentos" do IXC mostra.
 */
describe('a data que a baixa corrige', () => {
  const lancadoNoDiaSeguinte = pago({
    data_vencimento: '15/08/2026',
    data_pagamento: '16/08/2026',
  });

  it('o dia do pagamento passa a ser o informado na baixa', () => {
    const p = mapPagamento(lancadoNoDiaSeguinte)!;
    expect(p.diasDeAtraso).toBe(1);

    aplicarBaixa(p, {
      id: 1724287,
      idFnApagar: p.idFnApagar,
      data: new Date(Date.UTC(2026, 7, 15)),
      campo: 'data',
    });

    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(p.diasDeAtraso).toBe(0);
    expect(p.fonteDaData).toBe('baixa');
    expect(p.baixaNoIxc).toBe(1724287);
  });

  /*
   * O dia do registro não é jogado fora: é por ele que se acha o título na
   * leitura do IXC, e é ele que explica por que a conta apareceu num período e
   * não no outro.
   */
  it('guarda o dia em que a baixa foi registrada', () => {
    const p = mapPagamento(lancadoNoDiaSeguinte)!;
    aplicarBaixa(p, {
      id: 1,
      idFnApagar: p.idFnApagar,
      data: new Date(Date.UTC(2026, 7, 15)),
      campo: 'data',
    });
    expect(p.registradoEm.toISOString().slice(0, 10)).toBe('2026-08-16');
  });

  it('sem vencimento no IXC, continua sem inventar atraso', () => {
    const p = mapPagamento(pago({ data_vencimento: '' }))!;
    aplicarBaixa(p, {
      id: 1,
      idFnApagar: p.idFnApagar,
      data: new Date(Date.UTC(2026, 7, 15)),
      campo: 'data',
    });
    expect(p.diasDeAtraso).toBeNull();
  });

  it('sem baixa lida, a data é a do título e a ficha diz isso', () => {
    const p = mapPagamento(lancadoNoDiaSeguinte)!;
    expect(p.fonteDaData).toBe('titulo');
    expect(p.baixaNoIxc).toBeNull();
    expect(p.registradoEm).toEqual(p.pagoEm);
  });
});

describe('a conferência do pagamento', () => {
  it('não aponta nada no pagamento integral e em dia', () => {
    expect(mapPagamento(pago())!.conferencia).toEqual({
      fecha: true,
      ressalvas: [],
    });
  });

  it('avisa do status que ficou parado em A', () => {
    const c = mapPagamento(pago({ status: 'A' }))!.conferencia;
    expect(c.fecha).toBe(false);
    expect(c.ressalvas.join(' ')).toContain('status');
  });

  it('avisa do parcial e diz quanto sobrou', () => {
    const c = mapPagamento(
      pago({ status: 'A', valor_aberto: '250,00', valor_total_pago: '1.000,00' }),
    )!.conferencia;
    expect(c.ressalvas.some((r) => r.includes('parcial'))).toBe(true);
  });

  it('avisa quando o IXC não diz quanto saiu', () => {
    const c = mapPagamento(
      pago({ valor: '0,00', valor_total_pago: '', valor_aberto: '' }),
    )!.conferencia;
    expect(c.ressalvas.some((r) => r.includes('quanto saiu'))).toBe(true);
  });

  it('aceita pagar mais que o título quando há juros e multa', () => {
    const comJuros = pago({
      valor_total_pago: '1.310,00',
      valor_juros: '40,00',
      valor_multa: '20,00',
      data_pagamento: '05/08/2026',
    });
    const p = mapPagamento(comJuros)!;
    expect(p.juros).toBe(40);
    expect(p.multa).toBe(20);
    expect(p.conferencia.fecha).toBe(true);
  });

  it('estranha o que saiu além do título sem juros que expliquem', () => {
    const c = mapPagamento(pago({ valor_total_pago: '1.900,00' }))!.conferencia;
    expect(c.fecha).toBe(false);
    expect(c.ressalvas.some((r) => r.includes('não está explicada'))).toBe(true);
  });

  it('estranha a baixa de título com auditoria reprovada', () => {
    const c = mapPagamento(pago({ status_auditoria: 'R' }))!.conferencia;
    expect(c.ressalvas.some((r) => r.includes('reprovada'))).toBe(true);
  });
});

describe('o apanhado do período', () => {
  const lista = (): PagamentoFeito[] =>
    [
      pago({ id: '1', data_pagamento: '20/07/2026' }),
      pago({
        id: '2',
        data_pagamento: '25/07/2026',
        valor_total_pago: '1.310,00',
        valor_juros: '40,00',
        valor_multa: '20,00',
      }),
      pago({
        id: '3',
        status: 'A',
        data_pagamento: '18/07/2026',
        valor_aberto: '250,00',
        valor_total_pago: '1.000,00',
      }),
    ].map((raw) => mapPagamento(raw)!);

  it('soma o que saiu do caixa, não o valor dos títulos', () => {
    const r = resumirPagamentos(lista());
    expect(r.quantidade).toBe(3);
    expect(r.total).toBe(1250 + 1310 + 1000);
    expect(r.jurosEMulta).toBe(60);
  });

  it('separa em dia de em atraso pelo vencimento', () => {
    const r = resumirPagamentos(lista());
    // Vencimento 20/07: pagos em 20 e 18 são em dia; o de 25 está atrasado.
    expect(r.emDia.quantidade).toBe(2);
    expect(r.emAtraso.quantidade).toBe(1);
    expect(r.emAtraso.total).toBe(1310);
  });

  it('conta os parciais e os que pedem conferência', () => {
    const r = resumirPagamentos(lista());
    expect(r.parciais.quantidade).toBe(1);
    expect(r.comRessalva.quantidade).toBe(1);
  });

  it('põe o pagamento mais recente no topo', () => {
    const ordenado = ordenarPorPagamento(lista());
    expect(ordenado.map((p) => p.idFnApagar)).toEqual([2, 1, 3]);
  });
});
