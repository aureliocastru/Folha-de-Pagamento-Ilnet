import {
  estaEmAberto,
  explicarFiltro,
  mapContaAberta,
  motivoDeNaoEstarAberto,
  ordenarPorUrgencia,
  resumirContasAbertas,
  type ContaAberta,
} from './contas-abertas.mapper';

/**
 * Esta tela responde "quanto a empresa deve e o que já venceu". Um erro aqui
 * não quebra nada — ele mente, que é pior. Por isso os casos cobrem os nomes
 * de coluna que mudam entre versões do IXC, o pagamento parcial e a virada do
 * dia do vencimento.
 */

const HOJE = new Date('2026-08-14T15:00:00Z');

/** Um fn_apagar cru como o IXC devolve: tudo string. */
function bruto(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '4821',
    status: 'A',
    id_fornecedor: '77',
    fornecedor: 'ENERGISA CEARA',
    valor: '1.250,00',
    data_emissao: '01/08/2026',
    data_vencimento: '20/08/2026',
    documento: 'NF 55123',
    obs: 'Energia da torre',
    ...over,
  };
}

describe('o que conta como aberto', () => {
  it('aceita a conta em aberto', () => {
    expect(estaEmAberto(bruto())).toBe(true);
  });

  it('descarta paga e cancelada mesmo se o IXC as devolver', () => {
    expect(estaEmAberto(bruto({ status: 'P' }))).toBe(false);
    expect(estaEmAberto(bruto({ status: 'C' }))).toBe(false);
  });

  /**
   * Base que ignora um `qtype` desconhecido devolve a tabela inteira. Sem
   * status para olhar, o desempate é o dinheiro: título quitado não é dívida.
   */
  it('sem coluna de status, decide pelo que falta pagar', () => {
    expect(estaEmAberto(bruto({ status: '', valor_aberto: '300,00' }))).toBe(true);
    expect(
      estaEmAberto(
        bruto({ status: '', valor: '300,00', valor_total_pago: '300,00' }),
      ),
    ).toBe(false);
  });
});

describe('ler uma conta', () => {
  it('traz valor, vencimento, documento e fornecedor', () => {
    const c = mapContaAberta(bruto(), HOJE)!;

    expect(c.idFnApagar).toBe(4821);
    expect(c.valor).toBe(1250);
    expect(c.documento).toBe('NF 55123');
    expect(c.fornecedor).toEqual({ id: 77, nome: 'ENERGISA CEARA' });
    expect(c.vencimento?.toISOString().slice(0, 10)).toBe('2026-08-20');
    expect(c.observacao).toBe('Energia da torre');
  });

  it('acha o nome do fornecedor com os outros nomes de coluna', () => {
    const c = mapContaAberta(
      bruto({ fornecedor: '', razao: 'CLARO S.A.' }),
      HOJE,
    )!;
    expect(c.fornecedor.nome).toBe('CLARO S.A.');
  });

  it('acha o vencimento com os outros nomes de coluna', () => {
    const c = mapContaAberta(
      bruto({ data_vencimento: '', vencimento: '25/08/2026' }),
      HOJE,
    )!;
    expect(c.vencimento?.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('ignora registro sem id — não há conta sem título', () => {
    expect(mapContaAberta(bruto({ id: '' }), HOJE)).toBeNull();
  });

  describe('quanto ainda falta pagar', () => {
    it('usa o valor em aberto quando a base o tem', () => {
      const c = mapContaAberta(
        bruto({ valor: '1.000,00', valor_aberto: '400,00' }),
        HOJE,
      )!;
      expect(c.valor).toBe(1000);
      expect(c.valorAberto).toBe(400);
    });

    /** Pagamento parcial numa base sem `valor_aberto`: o resto é conta. */
    it('desconta o que já foi pago quando não há valor em aberto', () => {
      const c = mapContaAberta(
        bruto({ valor: '1.000,00', valor_total_pago: '250,00' }),
        HOJE,
      )!;
      expect(c.valorAberto).toBe(750);
    });

    it('nunca devolve saldo negativo', () => {
      const c = mapContaAberta(
        bruto({ valor: '100,00', valor_total_pago: '150,00' }),
        HOJE,
      )!;
      expect(c.valorAberto).toBe(0);
    });
  });

  describe('vencimento', () => {
    it('conta os dias que faltam', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '20/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(6);
      expect(c.vencida).toBe(false);
    });

    /** Vence hoje é dia de pagar, não dia de estar atrasado. */
    it('a que vence hoje ainda não está vencida', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '14/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(0);
      expect(c.vencida).toBe(false);
    });

    it('conta os dias de atraso da que já venceu', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '04/08/2026' }), HOJE)!;
      expect(c.diasParaVencer).toBe(-10);
      expect(c.vencida).toBe(true);
    });

    it('conta sem vencimento não é dada como vencida', () => {
      const c = mapContaAberta(bruto({ data_vencimento: '' }), HOJE)!;
      expect(c.diasParaVencer).toBeNull();
      expect(c.vencida).toBe(false);
    });
  });
});

/**
 * A parcela escrita no título.
 *
 * O financiamento chega ao IXC com "29/36" no número da nota, e é assim que se
 * sabe qual das trinta e seis é aquela linha — sem contar nada, sem depender
 * de o fornecedor ter poucos títulos.
 */
describe('a parcela que vem escrita no título', () => {
  it('lê o número da nota e mostra de onde veio', () => {
    const c = mapContaAberta(bruto({ numero_nota: '29/36' }), HOJE)!;
    expect(c.parcela).toEqual({ posicao: 29, total: 36, fonte: 'nota' });
  });

  it('lê a marca que esta casa escreve na observação', () => {
    const c = mapContaAberta(bruto({ obs: 'Cabo UTP (3/6)' }), HOJE)!;
    expect(c.parcela).toEqual({ posicao: 3, total: 6, fonte: 'observacao' });
  });

  it('título sem marca nenhuma não inventa parcela', () => {
    const c = mapContaAberta(bruto({ obs: 'Parcela Hilux' }), HOJE)!;
    expect(c.parcela).toBeNull();
  });

  it('nota fiscal com série não vira parcela', () => {
    const c = mapContaAberta(bruto({ numero_nota: '123/2024' }), HOJE)!;
    expect(c.parcela).toBeNull();
  });
});

describe('resumo', () => {
  function conta(dias: number | null, valorAberto: number): ContaAberta {
    return {
      idFnApagar: 1,
      documento: null,
      fornecedor: { id: null, nome: 'x' },
      valor: valorAberto,
      valorAberto,
      emissao: null,
      vencimento: dias === null ? null : new Date(),
      diasParaVencer: dias,
      vencida: dias !== null && dias < 0,
      observacao: null,
      parcela: null,
      statusAuditoria: null,
      categoria: { id: null, nome: null },
      classificacao: null,
      origem: null,
    };
  }

  it('separa vencidas, a vencer em uma semana e o resto', () => {
    const r = resumirContasAbertas([
      conta(-3, 100),
      conta(-1, 50),
      conta(0, 200),
      conta(7, 300),
      conta(8, 400),
      conta(null, 25),
    ]);

    expect(r.quantidade).toBe(6);
    expect(r.total).toBe(1075);
    expect(r.vencidas).toEqual({ quantidade: 2, total: 150 });
    // O dia 0 e o dia 7 são as bordas: os dois entram na semana.
    expect(r.venceEmSeteDias).toEqual({ quantidade: 2, total: 500 });
    expect(r.demais).toEqual({ quantidade: 1, total: 400 });
    expect(r.semVencimento).toEqual({ quantidade: 1, total: 25 });
  });

  it('soma o que falta pagar, não o valor do título', () => {
    const parcial = { ...conta(5, 0), valor: 1000, valorAberto: 400 };
    expect(resumirContasAbertas([parcial]).total).toBe(400);
  });

  it('lista vazia não quebra', () => {
    const r = resumirContasAbertas([]);
    expect(r.quantidade).toBe(0);
    expect(r.total).toBe(0);
  });

  it('ordena da mais atrasada para a mais distante, com a sem data no fim', () => {
    const ordenada = ordenarPorUrgencia([
      conta(5, 10),
      conta(null, 10),
      conta(-8, 10),
      conta(0, 10),
    ]);
    expect(ordenada.map((c) => c.diasParaVencer)).toEqual([-8, 0, 5, null]);
  });

  it('no mesmo dia, o valor maior vem primeiro', () => {
    const ordenada = ordenarPorUrgencia([conta(3, 100), conta(3, 900)]);
    expect(ordenada.map((c) => c.valorAberto)).toEqual([900, 100]);
  });
});

/**
 * Os quatro titulos fantasma.
 *
 * A primeira versao desta tela mostrou quatro contas de 2023 como vencidas que
 * a tela do proprio IXC nao listava: 532 aqui contra 528 la. Todas com
 * `status = A`. O status sozinho nao diz se a conta ainda e devida -- e uma
 * conta que nao e devida aparecendo como vencida faz alguem correr atras de
 * uma divida que nao existe.
 */
describe('o que parece aberto mas nao e', () => {
  it('titulo baixado por inteiro nao e divida, mesmo com status A', () => {
    expect(
      estaEmAberto(
        bruto({ status: 'A', valor: '877,89', valor_baixado: '877,89' }),
      ),
    ).toBe(false);
  });

  it('baixa parcial continua sendo divida pelo que sobrou', () => {
    const raw = bruto({ status: 'A', valor: '1.000,00', valor_baixado: '400,00' });
    expect(estaEmAberto(raw)).toBe(true);
    expect(mapContaAberta(raw, HOJE)!.valorAberto).toBe(600);
  });

  it('conta cancelada sai da lista mesmo com saldo em aberto', () => {
    expect(
      estaEmAberto(bruto({ status: 'A', data_cancelamento: '10/08/2023' })),
    ).toBe(false);
    expect(estaEmAberto(bruto({ status: 'A', cancelado: 'S' }))).toBe(false);
  });

  /**
   * A licao que custou caro: aceitar qualquer coluna com "cancel" no nome
   * derrubou a lista de 532 titulos para 65. O `fn_apagar` tem colunas de
   * configuracao que falam de cancelamento sem cancelar conta nenhuma, e
   * elas nao podem tirar uma divida da tela.
   */
  it('coluna de configuracao com "cancel" no nome nao cancela conta', () => {
    expect(estaEmAberto(bruto({ cancelamento_automatico: 'S' }))).toBe(true);
    expect(estaEmAberto(bruto({ dias_para_cancelar: '30' }))).toBe(true);
    expect(estaEmAberto(bruto({ permite_cancelamento: 'S' }))).toBe(true);
    expect(estaEmAberto(bruto({ id_usuario_cancelamento: '14' }))).toBe(true);
  });

  it('diz por qual campo o titulo ficou de fora', () => {
    expect(motivoDeNaoEstarAberto(bruto({ status: 'P' }))).toEqual({
      motivo: 'pago',
      campo: 'status',
    });
    expect(
      motivoDeNaoEstarAberto(bruto({ cancelado: 'S' })),
    ).toEqual({ motivo: 'cancelado', campo: 'cancelado' });
    expect(
      motivoDeNaoEstarAberto(
        bruto({ valor: '100,00', valor_total_pago: '100,00' }),
      ),
    ).toEqual({ motivo: 'quitado', campo: 'valor' });
    expect(motivoDeNaoEstarAberto(bruto())).toBeNull();
  });

  /** Coluna de cancelamento vazia e o estado normal de quem nunca cancelou. */
  it('coluna de cancelamento em branco nao cancela nada', () => {
    expect(estaEmAberto(bruto({ motivo_cancelamento: '' }))).toBe(true);
    expect(estaEmAberto(bruto({ cancelado: 'N' }))).toBe(true);
    expect(estaEmAberto(bruto({ data_cancelamento: '0000-00-00' }))).toBe(true);
    expect(estaEmAberto(bruto({ data_cancelamento: '00/00/0000' }))).toBe(true);
  });

  /** O botao "Estornar cancelamento" desfaz -- nao e marca de cancelada. */
  it('o estorno do cancelamento nao conta como cancelamento', () => {
    expect(
      estaEmAberto(bruto({ data_estorno_cancelamento: '12/08/2023' })),
    ).toBe(true);
  });

  it('sem nada a pagar nao aparece, ainda que ninguem tenha mudado o status', () => {
    expect(
      estaEmAberto(bruto({ status: 'A', valor: '100,00', valor_aberto: '0,00', valor_total_pago: '100,00' })),
    ).toBe(false);
  });
});

describe('categoria da despesa', () => {
  it('le o codigo da conta de despesa', () => {
    const c = mapContaAberta(bruto({ id_conta: '2420' }), HOJE)!;
    expect(c.categoria.id).toBe(2420);
  });

  it('usa o nome quando o proprio registro o traz', () => {
    const c = mapContaAberta(
      bruto({ id_conta: '318', descricao_conta: 'VEICULOS' }),
      HOJE,
    )!;
    expect(c.categoria).toEqual({ id: 318, nome: 'VEICULOS' });
  });

  it('sem conta nenhuma, fica vazia em vez de inventar', () => {
    const c = mapContaAberta(bruto(), HOJE)!;
    expect(c.categoria).toEqual({ id: null, nome: null });
  });
});

/**
 * Os titulos da Comercial Rofe, reproduzidos do registro real.
 *
 * Apareciam como vencidos desde 2023 numa tela que dizia "contas em aberto".
 * Estao pagos no IXC -- "Valor baixado", "Data/hora baixa" e "Data pagamento"
 * preenchidos, "Valor aberto" vazio --, mas o `status` deles nunca saiu de
 * "A", entao a consulta por status os trazia. E a conferencia por valor nao os
 * pegava: a listagem do webservice nao devolve as colunas de valor pago, e sem
 * elas "valor menos o que ja foi pago" da o titulo inteiro em aberto.
 */
describe('titulo pago com o status parado em A', () => {
  /** Como o registro chega da listagem: sem as colunas de valor pago. */
  function rofe(over: Record<string, unknown> = {}) {
    return bruto({
      id: '15996',
      status: 'A',
      fornecedor: 'Comercial Rofe Ltda',
      valor: '877,89',
      valor_aberto: '',
      data_emissao: '25/04/2022',
      data_vencimento: '16/06/2023',
      data_hora_baixa: '16/06/2023 08:47:56',
      data_pagamento: '16/06/2023',
      ...over,
    });
  }

  it('sai da lista pela data de baixa, mesmo sem coluna de valor pago', () => {
    expect(estaEmAberto(rofe())).toBe(false);
    expect(motivoDeNaoEstarAberto(rofe())).toEqual({
      motivo: 'pago',
      campo: 'data_pagamento',
    });
  });

  it('a data de baixa sozinha ja basta', () => {
    const so_baixa = rofe({ data_pagamento: '' });
    expect(motivoDeNaoEstarAberto(so_baixa)).toEqual({
      motivo: 'pago',
      campo: 'data_hora_baixa',
    });
  });

  it('data de baixa zerada nao e baixa', () => {
    expect(
      estaEmAberto(
        rofe({ data_pagamento: '00/00/0000', data_hora_baixa: '0000-00-00 00:00:00' }),
      ),
    ).toBe(true);
  });

  /**
   * O contrario disto seria pior que o defeito: pagamento parcial tem data de
   * baixa e continua devendo o que sobrou. Por isso o saldo declarado pelo IXC
   * e olhado antes da baixa.
   */
  it('pagamento parcial continua na lista mesmo com data de baixa', () => {
    const parcial = rofe({ valor_aberto: '400,00' });
    expect(estaEmAberto(parcial)).toBe(true);
    expect(mapContaAberta(parcial, HOJE)!.valorAberto).toBe(400);
  });

  it('sem baixa e sem saldo declarado, o titulo continua sendo divida', () => {
    const emAberto = rofe({
      data_pagamento: '',
      data_hora_baixa: '',
      valor_aberto: '',
    });
    expect(estaEmAberto(emAberto)).toBe(true);
    expect(mapContaAberta(emAberto, HOJE)!.valorAberto).toBe(877.89);
  });
});

/**
 * O titulo 15676, copiado do registro real que veio do IXC.
 *
 * Ele aparecia como vencido desde 2023 numa tela que dizia "contas em aberto",
 * e nao estava na tela de contas a pagar do proprio IXC. Pelos campos de
 * dinheiro ele esta aberto mesmo -- valor_aberto cheio, nada pago, sem
 * cancelamento --, e foi por isso que duas correcoes seguidas nao o pegaram: o
 * problema nunca foi pagamento. Ele nasceu da entrada de uma nota e nunca foi
 * liberado.
 */
describe('titulo que existe mas nunca foi liberado', () => {
  const T15676: Record<string, unknown> = {
    id: '15676',
    liberado: 'N',
    filial_id: '1',
    status: 'A',
    data_emissao: '2023-05-17',
    data_vencimento: '2023-05-17',
    valor: '89.00',
    valor_aberto: '89.00',
    valor_pago: '0.00',
    data_pagamento: '',
    id_fornecedor: '14',
    valor_total_pago: '0.00',
    status_auditoria: 'N',
    estornado: '',
    documento: '1716022/1',
    id_entrada: '2846',
    tipo_pagamento: 'Boleto',
    previsao: 'N',
    id_conta: '0',
    id_contas: '0',
    valor_cancelado: '',
    id_mot_cancelamento: '',
    data_cancelamento: '',
  };

  it('fica de fora, e diz que foi pela coluna liberado', () => {
    expect(estaEmAberto(T15676)).toBe(false);
    expect(motivoDeNaoEstarAberto(T15676)).toEqual({
      motivo: 'nao-liberado',
      campo: 'liberado',
    });
  });

  /** Nao e caso de pagamento: por dinheiro ele esta aberto, e continua assim. */
  it('o mesmo titulo, uma vez liberado, e divida de verdade', () => {
    const liberado = { ...T15676, liberado: 'S' };
    expect(estaEmAberto(liberado)).toBe(true);
    expect(mapContaAberta(liberado, HOJE)!.valorAberto).toBe(89);
  });

  /**
   * Base sem esse controle nao pode perder as contas dela por causa de um
   * campo que nao existe la.
   */
  it('coluna ausente ou vazia nao exclui ninguem', () => {
    const semColuna = { ...T15676 };
    delete semColuna.liberado;
    expect(estaEmAberto(semColuna)).toBe(true);
    expect(estaEmAberto({ ...T15676, liberado: '' })).toBe(true);
  });

  it('a ficha do debito mostra a coluna liberado com o valor lido', () => {
    const olhado = explicarFiltro(T15676).olhou.find(
      (c) => c.campo === 'liberado',
    );
    expect(olhado?.valor).toBe('N');
  });
});

/**
 * Um titulo com `previsao = S`, copiado do registro real que veio do IXC.
 *
 * Este bloco existe para impedir uma correcao que ja foi feita e desfeita no
 * mesmo dia. A tela de contas a pagar do IXC nao mostra esses titulos, e daí
 * parecia que a lista daqui estava inflada de gasto planejado -- eles foram
 * filtrados, e o que sumiu da fila foi conta com boleto que vence e precisa ser
 * paga. Nesta empresa a marca de previsao nao quer dizer "ainda nao e divida".
 *
 * Entao: `previsao` nao decide nada aqui. Ela aparece na ficha, com o valor que
 * veio do IXC, para quem estiver investigando "esta aqui e nao esta la" -- que
 * continua sendo pergunta aberta, e se responde olhando, nao presumindo.
 */
describe('a marca de previsao nao tira conta da fila', () => {
  const PREVISAO: Record<string, unknown> = {
    id: '33854',
    liberado: 'S',
    filial_id: '1',
    status: 'A',
    data_emissao: '2025-03-20',
    data_vencimento: '2026-08-17',
    valor: '85.14',
    valor_aberto: '85.14',
    valor_pago: '0.00',
    data_pagamento: '',
    valor_total_pago: '0.00',
    status_auditoria: '',
    documento: '',
    id_entrada: '0',
    tipo_pagamento: 'Boleto',
    previsao: 'S',
    id_conta: '11925',
    id_contas: '18',
  };

  it('continua na fila de pagamento, com o saldo que o IXC declara', () => {
    expect(estaEmAberto(PREVISAO)).toBe(true);
    expect(motivoDeNaoEstarAberto(PREVISAO)).toBeNull();
    expect(mapContaAberta(PREVISAO, HOJE)!.valorAberto).toBe(85.14);
  });

  it('a marca nao muda nada: com S ou com N, a conta e a mesma', () => {
    expect(estaEmAberto({ ...PREVISAO, previsao: 'N' })).toBe(true);
    expect(estaEmAberto({ ...PREVISAO, previsao: '' })).toBe(true);
  });

  /** Baixada, sai da fila por estar paga -- como qualquer outra conta. */
  it('uma vez baixada, sai por pagamento e nao por outra regra', () => {
    const baixada = {
      ...PREVISAO,
      data_pagamento: '17/08/2026',
      valor_aberto: '0,00',
    };
    expect(motivoDeNaoEstarAberto(baixada)?.motivo).toBe('pago');
  });

  it('a ficha do debito mostra a coluna previsao com o valor lido', () => {
    const olhado = explicarFiltro(PREVISAO).olhou.find(
      (c) => c.campo === 'previsao',
    );
    expect(olhado?.valor).toBe('S');
  });
});
