import { prazoDoPacote } from './pacote.service';
import { titulosEmAbertoNoDia, relatorioDeClientes } from './relatorios/clientes';
import { estoqueNoDia } from './relatorios/estoque';
import { dividasNoDia, lerPagamento, relatorioDeDescontos } from './relatorios/pagamentos';
import { lerRecebimento, relatorioDeFaturamento, relatorioDeJuros } from './relatorios/receitas';
import { saldoNoDia, type CaixaNoPeriodo } from './relatorios/caixa';

/**
 * Os números que vão para a contabilidade. O que este arquivo protege:
 *
 *  - o saldo de um dia passado é reconstruído a partir de hoje — o que foi
 *    recebido, pago ou cancelado depois do dia volta a contar como devido;
 *  - o boleto gerado com meses de antecedência não é dívida do cliente;
 *  - a renegociação e o cancelado não somam no faturamento;
 *  - o estoque desfaz para trás o que entrou e saiu depois do dia;
 *  - o desconto obtido sai de `valor_pago` − `valor_total_pago`;
 *  - o prazo é o 5º dia útil do mês seguinte, com feriado.
 *
 * Os registros copiam o formato do IXC desta casa (texto, ponto decimal, datas
 * ISO), com nomes e valores inventados — o repositório é público.
 */

const lidoEm = new Date('2026-10-09T15:00:00Z');
const clientes = new Map([
  [1, { nome: 'Ana Teste', documento: '000.000.000-01' }],
  [2, { nome: 'Bruno Exemplo', documento: '000.000.000-02' }],
]);

function titulo(campos: Record<string, string>): Record<string, unknown> {
  return {
    id: '1',
    status: 'A',
    liberado: 'S',
    data_emissao: '2026-08-20',
    data_vencimento: '2026-09-10',
    data_inicial: '2026-08-10',
    data_final: '2026-09-09',
    valor: '100.00',
    valor_aberto: '100.00',
    valor_recebido: '0.00',
    valor_cancelado: '0.00',
    data_cancelamento: '',
    id_cliente: '1',
    id_contrato: '10',
    ...campos,
  };
}

describe('06 — saldo de clientes no último dia', () => {
  const dia = '2026-09-30';

  it('conta o que está em aberto hoje e o que foi recebido ou cancelado depois do dia', () => {
    const { titulos } = titulosEmAbertoNoDia({
      dia,
      abertosHoje: [titulo({ id: '1' })],
      recebidosDepois: [
        { id: '900', data: '2026-10-03', id_receber: '2', credito: '80.00', vacrescimo: '2.00', vdesconto: '0.00' },
        // Recebido no próprio dia do saldo: já não devia nada no fim do dia.
        { id: '901', data: '2026-09-30', id_receber: '4', credito: '50.00' },
      ],
      titulosRecebidosDepois: [
        titulo({ id: '2', status: 'R', valor: '80.00', valor_aberto: '0.00', id_cliente: '2' }),
        titulo({ id: '4', status: 'R', valor: '50.00', valor_aberto: '0.00' }),
      ],
      canceladosDepois: [
        titulo({ id: '3', status: 'C', valor: '30.00', valor_aberto: '0.00', valor_cancelado: '30.00', data_cancelamento: '2026-10-05' }),
      ],
      clientes,
      lidoEm,
    });

    expect(titulos.map((t) => [t.id, t.abertoNoDia])).toEqual([
      [1, 100],
      [3, 30],
      [2, 80],
    ]);
    // O juro recebido depois não é dívida do dia: volta só o valor do título.
    expect(titulos.find((t) => t.id === 2)?.situacaoHoje).toBe('Recebido em 03/10/2026');
    expect(titulos.find((t) => t.id === 3)?.situacaoHoje).toBe('Cancelado em 05/10/2026');
  });

  it('deixa de fora o boleto de serviço que começa depois do dia e o emitido depois dele', () => {
    const { titulos, futurosForaDoSaldo } = titulosEmAbertoNoDia({
      dia,
      abertosHoje: [
        titulo({ id: '1' }),
        // Carnê gerado em 2024 para o serviço de novembro.
        titulo({ id: '5', data_emissao: '2024-10-05', data_inicial: '2026-10-20', data_vencimento: '2026-11-20', valor: '94.98', valor_aberto: '94.98' }),
        titulo({ id: '6', data_emissao: '2026-10-02' }),
        // Sem período de serviço (venda parcelada): conta pela emissão.
        titulo({ id: '7', data_inicial: '', data_final: '', data_emissao: '2023-12-12', data_vencimento: '2026-12-15', valor: '500.00', valor_aberto: '500.00' }),
      ],
      recebidosDepois: [],
      titulosRecebidosDepois: [],
      canceladosDepois: [],
      clientes,
      lidoEm,
    });

    expect(titulos.map((t) => t.id).sort()).toEqual([1, 7]);
    expect(futurosForaDoSaldo).toEqual({ quantidade: 1, valor: 94.98 });
  });

  it('separa o título oculto no IXC, fora do total, e faz as faixas de atraso', () => {
    const r = relatorioDeClientes({
      dia,
      abertosHoje: [
        titulo({ id: '1', data_vencimento: '2026-09-30' }), // vence no dia: vencido, 0 dias
        titulo({ id: '2', data_vencimento: '2025-01-10', valor: '70.00', valor_aberto: '70.00' }),
        titulo({ id: '3', data_vencimento: '2026-10-10', valor: '40.00', valor_aberto: '40.00' }),
        titulo({ id: '4', liberado: 'N', valor: '999.00', valor_aberto: '999.00' }),
      ],
      recebidosDepois: [],
      titulosRecebidosDepois: [],
      canceladosDepois: [],
      clientes,
      lidoEm,
    });

    expect(r.resumo[0]).toMatchObject({ valor: 210, destaque: true });
    const resumo = r.abas[0].linhas;
    expect(resumo[0]).toEqual(['Vencidos há até 30 dias', 1, 100]);
    expect(resumo[4]).toEqual(['Vencidos há mais de 1 ano', 1, 70]);
    expect(resumo[5]).toEqual(['A vencer depois de 30/09/2026', 1, 40]);
    expect(r.abas.map((a) => a.nome)).toContain('Ocultos no IXC');
  });
});

describe('07 e 19 — faturamento e juros', () => {
  const cadastros = { clientes, contas: new Map([[18, 'Conta Pix'], [15, 'Conta Boletos']]) };

  it('soma mensalidade pelo início do serviço e avulsa pela emissão, sem renegociação nem cancelado', () => {
    const r = relatorioDeFaturamento({
      de: '2026-09-01',
      ate: '2026-09-30',
      titulosDoServico: [
        titulo({ id: '1', data_inicial: '2026-09-06', status: 'R' }),
        titulo({ id: '2', data_inicial: '2026-09-15', status: 'A', valor: '80.00' }),
        titulo({ id: '3', data_inicial: '2026-09-20', status: 'C', valor: '50.00' }),
      ],
      titulosEmitidos: [
        // Aparece nas duas leituras: conta uma vez só.
        titulo({ id: '1', data_inicial: '2026-09-06', status: 'R', data_emissao: '2026-09-01' }),
        titulo({ id: '4', data_inicial: '', data_emissao: '2026-09-12', valor: '150.00', obs: 'Taxa de mudança' }),
        titulo({ id: '5', data_inicial: '', data_emissao: '2026-09-13', valor: '300.00', documento: 'RN010376', id_renegociacao_novo: '10376' }),
        // Serviço de outubro emitido em setembro: é do mês dele, não daqui.
        titulo({ id: '6', data_inicial: '2026-10-06', data_emissao: '2026-09-20' }),
      ],
      vendas: [
        { id: '70', modelo_nf: '62', status: 'F', valor_total: '100.00', id_cliente: '1', numero_nf: '7338', serie: '1', data_emissao: '2026-09-01' },
        { id: '71', modelo_nf: '62', status: 'PE', valor_total: '45.00', id_cliente: '2' },
        { id: '72', modelo_nf: '', status: 'F', valor_total: '104.98' },
      ],
      recebimentos: [
        lerRecebimento({ id: '1', data: '2026-09-05', id_receber: '1', conta_: '18', credito: '100.00', vacrescimo: '0.00', vdesconto: '10.00', valor_liquido_recebido: '90.00' })!,
      ],
      cadastros,
      lidoEm,
    });

    const valor = (rotulo: string) => r.resumo.find((l) => l.rotulo === rotulo)?.valor;
    expect(valor('Faturamento do período')).toBe(330);
    expect(valor('Mensalidades')).toBe(180);
    expect(valor('Cobranças avulsas')).toBe(150);
    expect(valor('Notas fiscais emitidas')).toBe(100);
    expect(valor('Recebido no período')).toBe(90);
    expect(r.avisos[0]).toMatch(/1 notas fiscais do período não foram autorizadas/);
  });

  it('lista os juros com o vencimento do título e os dias de atraso', () => {
    const recebimentos = [
      lerRecebimento({ id: '1', data: '2026-09-01', id_receber: '9', conta_: '15', credito: '99.99', vacrescimo: '10.58', vdesconto: '0.00', valor_liquido_recebido: '110.57' })!,
      lerRecebimento({ id: '2', data: '2026-09-02', id_receber: '8', conta_: '15', credito: '50.00', vacrescimo: '0.00', valor_liquido_recebido: '50.00' })!,
    ];
    const r = relatorioDeJuros({
      de: '2026-09-01',
      ate: '2026-09-30',
      recebimentos,
      titulos: new Map([[9, titulo({ id: '9', data_vencimento: '2026-08-06' })]]),
      cadastros,
      lidoEm,
    });
    expect(r.resumo[0].valor).toBe(10.58);
    expect(r.abas[0].linhas).toHaveLength(1);
    expect(r.abas[0].linhas[0].slice(3, 8)).toEqual([9, '2026-08-06', 26, 99.99, 10.58]);
  });

  it('ignora a linha de recebimento sem título (a perna do desconto concedido)', () => {
    expect(lerRecebimento({ id: '3', data: '2026-09-02', id_receber: '0', credito: '0.00' })).toBeNull();
  });
});

describe('08, 12 e 20 — o que saiu e o que se devia', () => {
  const cad = {
    fornecedores: new Map([[7, { nome: 'Madeireira Teste', documento: '00.000.000/0001-00' }]]),
    contas: new Map([[23, 'Caixa Teste']]),
    planoDeContas: new Map([[324, 'Serviços Terceiros']]),
  };

  it('tira o desconto e o acréscimo de valor_pago e valor_total_pago', () => {
    const comAcrescimo = lerPagamento(
      { id: '36730', debito_data: '2026-09-03', valor: '1250.00', valor_pago: '1250.00', valor_total_pago: '1252.50', id_fornecedor: '7', id_contas: '23', id_conta: '324' },
      cad,
    )!;
    expect(comAcrescimo).toMatchObject({ pago: 1252.5, acrescimo: 2.5, desconto: 0, fornecedor: 'Madeireira Teste', conta: 'Caixa Teste' });

    const comDesconto = lerPagamento({ id: '2', debito_data: '2026-09-04', valor: '100.00', valor_pago: '100.00', valor_total_pago: '95.00' }, cad)!;
    expect(comDesconto).toMatchObject({ pago: 95, desconto: 5 });
    const r = relatorioDeDescontos({ de: '2026-09-01', ate: '2026-09-30', lidoEm, pagamentos: [comAcrescimo, comDesconto] });
    expect(r.resumo[0].valor).toBe(5);
  });

  it('reconstrói o que se devia no dia: aberto hoje, pago depois e o status parado em aberto', () => {
    const base = { liberado: 'S', data_emissao: '2026-09-01', data_vencimento: '2026-09-20', id_fornecedor: '7', id_conta: '324' };
    const dividas = dividasNoDia({
      dia: '2026-09-30',
      abertosHoje: [
        { ...base, id: '1', status: 'A', valor: '100.00', valor_aberto: '100.00' },
        // Status parado em "A", mas baixado em 05/10: era dívida no dia 30.
        { ...base, id: '2', status: 'A', valor: '40.00', valor_aberto: '0.00', valor_pago: '40.00', data_pagamento: '2026-10-05 10:00:00', debito_data: '2026-10-05' },
        // Não liberado: nunca foi dívida.
        { ...base, id: '3', status: 'A', liberado: 'N', valor: '999.00', valor_aberto: '999.00' },
        // Emitido depois do dia.
        { ...base, id: '4', status: 'A', data_emissao: '2026-10-02', valor: '10.00', valor_aberto: '10.00' },
      ],
      pagosDepois: [{ ...base, id: '5', status: 'F', valor: '70.00', valor_pago: '70.00', valor_aberto: '0.00', debito_data: '2026-10-01' }],
      canceladosDepois: [],
      cadastros: cad,
      lidoEm,
    });
    expect(dividas.map((d) => [d.idFnApagar, d.abertoNoDia, d.situacaoHoje])).toEqual([
      [1, 100, 'Em aberto'],
      [2, 40, 'Pago em 05/10/2026'],
      [5, 70, 'Pago em 01/10/2026'],
    ]);
  });
});

describe('05 — estoque no último dia', () => {
  it('desfaz o que entrou e saiu depois do dia, tira Perdas e separa o inativo', () => {
    const r = estoqueNoDia({
      dia: '2026-09-30',
      produtos: [
        { id: '1', descricao: 'ONU TESTE', tipo: 'P', ativo: 'S', controla_estoque: 'S', custo_medio: '183.544815', preco_base: '250.00', unidade: '1' },
        { id: '2', descricao: 'CABO TESTE', tipo: 'C', ativo: 'S', controla_estoque: 'S', custo_medio: '0.000000', preco_base: '2.50', unidade: '2' },
        { id: '3', descricao: 'SWITCH ANTIGO', tipo: 'C', ativo: 'N', controla_estoque: 'S', custo_medio: '0', preco_base: '100.00' },
        { id: '4', descricao: 'INSTALAÇÃO', tipo: 'S', ativo: 'S', controla_estoque: 'S' },
      ],
      saldos: [
        { id_produto: '1', id_almox: '1', almox_descricao: 'Base', saldo: '10.000000000' },
        { id_produto: '1', id_almox: '9', almox_descricao: 'Perdas e Falhas', saldo: '3.000000000' },
        { id_produto: '2', id_almox: '1', almox_descricao: 'Base', saldo: '100.500000000' },
        { id_produto: '3', id_almox: '1', almox_descricao: 'Base', saldo: '2.000000000' },
        { id_produto: '4', id_almox: '1', almox_descricao: 'Base', saldo: '-5.000000000' },
      ],
      movimentosDepois: [
        // Depois do dia saíram 2 ONUs e entraram 50 m de cabo.
        { id_produto: '1', id_almox: '1', data: '2026-10-02', tipo: 'S', quantidade: '0', qtde_saida: '2.000000000', estoque: 'S' },
        { id_produto: '2', id_almox: '1', data: '2026-10-03', tipo: 'E', quantidade: '50.000000000', qtde_saida: '0', estoque: 'S' },
        // Lançado sem mexer no estoque: não desfaz nada.
        { id_produto: '2', id_almox: '1', data: '2026-10-04', tipo: 'S', quantidade: '0', qtde_saida: '7', estoque: 'N' },
      ],
      ultimaCompra: new Map([[2, { valor: 2.1, dia: '2026-08-01' }]]),
      almoxarifados: new Map(),
      unidades: new Map([[1, 'UN'], [2, 'M']]),
      lidoEm,
    });

    expect(r.produtos.map((p) => [p.descricao, p.quantidade, p.origemDoCusto, p.valor])).toEqual([
      ['CABO TESTE', 50.5, 'Última compra', 106.05],
      ['ONU TESTE', 12, 'Custo médio', 2202.54],
    ]);
    expect(r.inativos.map((p) => p.descricao)).toEqual(['SWITCH ANTIGO']);
  });
});

describe('11 — saldo do caixa no último dia', () => {
  const caixa = (mais: Partial<CaixaNoPeriodo>): CaixaNoPeriodo => ({
    caixaId: 23,
    nome: 'Caixa Teste',
    lancamentos: [],
    saldoInicial: 300,
    fechadoAte: '2026-09-15',
    saldoCalculadoNoFim: 420,
    fechamentos: [],
    informado: null,
    ...mais,
  });
  const fechamento = { de: '2026-09-16', saldoInicial: 300, saldoFinal: 420, totalNaRua: 50, totalEntradas: 0, totalSaidas: 0, conferidos: 0, lancamentos: 0, fechadoPor: null };

  it('prefere a contagem do fechamento do dia, depois o calculado', () => {
    expect(saldoNoDia(caixa({ fechamentos: [{ ...fechamento, ate: '2026-09-30', saldoContado: 415 }] }), '2026-09-30')).toMatchObject({ valor: 415, naRua: 50 });
    expect(saldoNoDia(caixa({ fechamentos: [{ ...fechamento, ate: '2026-09-30', saldoContado: null }] }), '2026-09-30').valor).toBe(420);
    expect(saldoNoDia(caixa({}), '2026-09-30').valor).toBe(420);
    expect(saldoNoDia(caixa({ informado: 400 }), '2026-09-30')).toMatchObject({ valor: 400, como: 'Informado aqui' });
    expect(saldoNoDia(caixa({ saldoCalculadoNoFim: null, saldoInicial: null }), '2026-09-30').valor).toBeNull();
  });
});

describe('prazo do papel', () => {
  it('é o 5º dia útil do mês seguinte, pulando fim de semana e feriado', () => {
    expect(prazoDoPacote('2026-09-30')).toBe('2026-10-07');
    // 02/11 é Finados.
    expect(prazoDoPacote('2026-10-31')).toBe('2026-11-09');
    expect(prazoDoPacote('2026-12-31')).toBe('2027-01-08');
  });
});
