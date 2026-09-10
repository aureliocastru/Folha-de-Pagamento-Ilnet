import { HistoricoPagamentosService } from './historico-pagamentos.service';
import type { BaixaNoIxc } from './baixas-do-ixc.mapper';

/**
 * Esta tela diz quanto saiu do caixa num período, e a pergunta que decide tudo é
 * "em que dia o dinheiro saiu". O título do IXC não responde isso: `data_pagamento`
 * traz o dia em que a baixa foi **registrada**. Quem paga pelo banco e lança
 * depois — que aqui é a regra, não a exceção — tinha todas as contas datadas
 * pelo lançamento, e a tela cobrava atraso de pagamento feito no prazo.
 *
 * O que este arquivo protege é a fronteira que sai daí: com a data corrigida, um
 * pagamento pode mudar de período. Ele tem de aparecer **em exatamente um** — o
 * do dia em que o dinheiro saiu. Sumir de todos é o pior resultado possível numa
 * tela de conferência, e aparecer em dois soma dinheiro que saiu uma vez só.
 */

const PERIODO = { de: '2026-08-01', ate: '2026-08-31' };

/** Um fn_apagar cru já baixado, como o IXC devolve. */
function titulo(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '36949',
    status: 'F',
    id_fornecedor: '77',
    // Nome de fachada: o repositório é público, e fornecedor de verdade não
    // entra em arquivo versionado.
    fornecedor: 'FULANO DE TAL',
    valor: '50.000,00',
    data_emissao: '15/08/2026',
    data_vencimento: '15/08/2026',
    // O dia em que a baixa foi registrada: um dia depois do pagamento.
    data_pagamento: '16/08/2026',
    valor_total_pago: '50.000,00',
    valor_aberto: '0,00',
    tipo_pagamento: 'Pix',
    id_contas: '15',
    ...over,
  };
}

function baixaEm(
  idFnApagar: number,
  dia: string,
  id = 1724287,
): BaixaNoIxc {
  const [ano, mes, d] = dia.split('-').map(Number);
  return { id, idFnApagar, data: new Date(Date.UTC(ano, mes - 1, d)), campo: 'data' };
}

function montarServico(opts: {
  /** O que a leitura por data do título traz. */
  brutos?: Array<Record<string, unknown>>;
  /** As baixas do período, pelo id do título. */
  baixasLidas?: BaixaNoIxc[];
  /** O que o IXC responde quando se pergunta a baixa de um título só. */
  baixasAvulsas?: BaixaNoIxc[];
  /** Títulos que só a busca por id alcança. */
  porId?: Array<Record<string, unknown>>;
  /** As baixas não puderam ser lidas nesta base. */
  semBaixas?: boolean;
}) {
  const brutos = opts.brutos ?? [];
  const porId = new Map(
    (opts.porId ?? []).map((raw) => [Number(raw.id), raw] as const),
  );

  const ixc = {
    list: jest.fn(async (recurso: string, params: Record<string, unknown>) => {
      if (recurso !== 'fn_apagar') return { total: 0, page: 1, registros: [] };
      // A sonda pergunta totais com uma linha só: o da tabela inteira e o de
      // quantos títulos têm baixa. O segundo tem de ser menor, senão a sonda
      // entende que o filtro foi ignorado.
      if (params.rp === 1) {
        const total = params.qtype === 'fn_apagar.id' ? 900 : 400;
        return { total, page: 1, registros: [] };
      }
      const pagina = Number(params.page ?? 1);
      return {
        total: brutos.length,
        page: pagina,
        registros: pagina === 1 ? brutos : [],
      };
    }),
    getById: jest.fn(async (_r: string, _campo: string, id: number | string) => {
      return porId.get(Number(id)) ?? null;
    }),
  };

  const porTitulo = new Map(
    (opts.baixasLidas ?? []).map((b) => [b.idFnApagar, b] as const),
  );
  const avulsas = new Map(
    (opts.baixasAvulsas ?? []).map((b) => [b.idFnApagar, b] as const),
  );

  const baixas = {
    daJanela: jest.fn(async () => ({
      disponivel: !opts.semBaixas,
      porTitulo: opts.semBaixas ? new Map() : porTitulo,
      lidas: porTitulo.size,
      cortado: false,
      como: opts.semBaixas ? 'Não achei as baixas.' : 'Lido das baixas.',
    })),
    doTitulo: jest.fn(async (id: number) => avulsas.get(id) ?? null),
  };

  const prisma = { contaPagar: { findMany: jest.fn().mockResolvedValue([]) } };
  const categorias = {
    dosTitulos: jest.fn().mockResolvedValue(new Map()),
    rateiosDosTitulos: jest.fn().mockResolvedValue(new Map()),
  };
  const contasAbertas = {
    nomesDosFornecedores: jest.fn().mockResolvedValue(new Map()),
    nomesDasContasDeDespesa: jest.fn().mockResolvedValue(new Map()),
    contasDePagamento: jest.fn().mockResolvedValue([]),
  };

  const service = new HistoricoPagamentosService(
    ixc as never,
    prisma as never,
    categorias as never,
    baixas as never,
    contasAbertas as never,
  );

  return { service, ixc, baixas };
}

/** O período de agosto, como o controller o entrega. */
function agosto() {
  const [a1, m1, d1] = PERIODO.de.split('-').map(Number);
  const [a2, m2, d2] = PERIODO.ate.split('-').map(Number);
  return {
    de: new Date(Date.UTC(a1, m1 - 1, d1)),
    ate: new Date(Date.UTC(a2, m2 - 1, d2)),
  };
}

describe('a data que o histórico mostra', () => {
  it('é a informada na baixa, não a do dia em que se lançou', async () => {
    const { service } = montarServico({
      brutos: [titulo()],
      baixasLidas: [baixaEm(36949, '2026-08-15')],
    });

    const r = await service.listar(agosto());

    expect(r.pagamentos).toHaveLength(1);
    const p = r.pagamentos[0];
    expect(p.pagoEm.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(p.registradoEm.toISOString().slice(0, 10)).toBe('2026-08-16');
    // Vencia no dia 15 e foi pago no dia 15: em dia.
    expect(p.diasDeAtraso).toBe(0);
    expect(r.resumo.emDia.quantidade).toBe(1);
    expect(r.resumo.emAtraso.quantidade).toBe(0);
  });

  /*
   * O título foi registrado em agosto, mas o dinheiro saiu em julho. Ele não é
   * de agosto — e some daqui sem alarde nenhum porque aparece em julho, pela
   * busca do outro teste. O aviso existe para quem estranhar o total do mês.
   */
  it('tira do período o que foi lançado nele mas pago antes', async () => {
    const { service, baixas } = montarServico({
      brutos: [titulo({ data_pagamento: '05/08/2026' })],
      // A leitura das baixas recua antes do período justamente para achar esta.
      baixasLidas: [baixaEm(36949, '2026-07-30')],
    });

    const r = await service.listar(agosto());

    expect(r.pagamentos).toHaveLength(0);
    expect(r.resumo.total).toBe(0);
    expect(r.avisos.join(' ')).toContain('o dinheiro saiu antes dele');
    // A janela já respondeu: não se pergunta título por título à toa.
    expect(baixas.doTitulo).not.toHaveBeenCalled();
  });

  /*
   * Lançamento atrasado além do que a janela recua. São poucos, e cada um custa
   * uma pergunta — mas continua sendo o IXC quem diz o dia, não o registro.
   */
  it('pergunta a baixa do título que a janela não alcançou', async () => {
    const { service, baixas } = montarServico({
      brutos: [titulo({ data_pagamento: '05/08/2026' })],
      baixasLidas: [],
      baixasAvulsas: [baixaEm(36949, '2026-01-20')],
    });

    const r = await service.listar(agosto());

    expect(baixas.doTitulo).toHaveBeenCalledWith(36949);
    expect(r.pagamentos).toHaveLength(0);
    expect(r.avisos.join(' ')).toContain('o dinheiro saiu antes dele');
  });

  /*
   * O outro lado do mesmo lançamento atrasado: pago em 30 de julho, registrado
   * em 5 de agosto. A leitura por data do título procura julho e não acha esse
   * registro; sem esta busca o pagamento não apareceria em mês nenhum.
   */
  it('traz o pagamento do período que foi registrado depois dele', async () => {
    const { service, ixc } = montarServico({
      brutos: [],
      baixasLidas: [baixaEm(36949, '2026-08-20')],
      porId: [titulo({ data_pagamento: '03/09/2026' })],
    });

    const r = await service.listar(agosto());

    expect(ixc.getById).toHaveBeenCalledWith('fn_apagar', 'fn_apagar.id', 36949);
    expect(r.pagamentos).toHaveLength(1);
    expect(r.pagamentos[0].pagoEm.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  /*
   * Baixa estornada não é dinheiro que saiu. O título vindo pela busca por id
   * passa pelo mesmo filtro do resto da tela — senão a correção de data seria
   * uma porta de entrada para pagamento cancelado.
   */
  it('não deixa entrar por essa busca o título cancelado', async () => {
    const { service } = montarServico({
      brutos: [],
      baixasLidas: [baixaEm(36949, '2026-08-20')],
      porId: [titulo({ status: 'C' })],
    });

    const r = await service.listar(agosto());
    expect(r.pagamentos).toHaveLength(0);
  });

  it('sem as baixas, mostra a data do registro e avisa que é ela', async () => {
    const { service } = montarServico({
      brutos: [titulo()],
      semBaixas: true,
    });

    const r = await service.listar(agosto());

    expect(r.pagamentos).toHaveLength(1);
    expect(r.pagamentos[0].fonteDaData).toBe('titulo');
    expect(r.pagamentos[0].pagoEm.toISOString().slice(0, 10)).toBe('2026-08-16');
    expect(r.avisos.join(' ')).toContain('não necessariamente o dia em que o dinheiro saiu');
  });

  /*
   * Título com baixa que a listagem do período não trouxe e a pergunta avulsa
   * também não: ele fica com a data do registro em vez de sumir. Descartá-lo
   * apagaria da tela um pagamento que existe.
   */
  it('mantém o pagamento cuja baixa não apareceu, dizendo de onde veio a data', async () => {
    const { service } = montarServico({
      brutos: [titulo()],
      baixasLidas: [],
      baixasAvulsas: [],
    });

    const r = await service.listar(agosto());

    expect(r.pagamentos).toHaveLength(1);
    expect(r.pagamentos[0].fonteDaData).toBe('titulo');
    expect(r.avisos.join(' ')).toContain('não achei a linha de baixa deles');
  });
});
