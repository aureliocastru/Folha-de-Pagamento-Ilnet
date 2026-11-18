import { PagamentosService } from './pagamentos.service';

/**
 * Trocar a conta de um pagamento já feito, do jeito que se faz no IXC:
 * abre a conta > Pagamentos > seleciona o pagamento > Estornar > a conta volta
 * a ficar aberta > muda a conta ou o dia > paga de novo.
 *
 * O que este arquivo protege:
 *  - o Estornar vai na linha que a aba Pagamentos mostra (a filha), nunca na
 *    mãe dela — com o id da mãe, em 18/11/2026, o IXC apagou só a mãe e o
 *    38114 ficou pago e sem estorno possível;
 *  - baixa que não está inteira (mãe faltando, saída junto com outro título)
 *    é recusada antes de qualquer escrita;
 *  - só se paga de novo se o IXC de fato reabriu o título.
 */

const CFG = {
  contaPagamentoId: 18,
  contaPagamentoCaixaId: 23,
  contaContabilAvulso: 324,
  filialId: 1,
};

const PAGO = {
  id: '38114',
  status: 'F',
  valor: '156.52',
  valor_pago: '156.52',
  valor_total_pago: '156.52',
  valor_aberto: '0.00',
  conta_pagamento: '18',
  id_contas: '18',
  id_conta: '324',
  filial_id: '1',
  debito_data: '2026-11-10',
  data_pagamento: '2026-11-11 09:57:36',
  status_auditoria: 'A',
  tipo_pagamento: 'Pix',
};

const MAE = { id: '1788308', id_movim_finan: '1788308', tipo_lanc: 'M', documento: '' };
const FILHA = { id: '1788309', id_movim_finan: '1788308', tipo_lanc: 'P', documento: '38114' };

function montar(
  opts: { outroTituloNaSaida?: boolean; semMae?: boolean; estornoNaoPega?: boolean } = {},
) {
  let titulo: Record<string, unknown> = { ...PAGO };
  let linhas: Array<Record<string, string>> = opts.semMae ? [FILHA] : [MAE, FILHA];
  if (opts.outroTituloNaSaida) {
    linhas.push({ id: '1788310', id_movim_finan: '1788308', tipo_lanc: 'P', documento: '38112' });
  }

  const ixc = {
    getById: jest.fn(async (recurso: string) => {
      if (recurso === 'contas') {
        return { id: '15', conta: 'Conta Banco Bradesco', id_planejamento: '10064' };
      }
      if (recurso === 'filial') return { id: '1', filial: 'Matriz' };
      if (recurso === 'fornecedor') return { id: '88', razao: 'FULANO' };
      return titulo;
    }),
    list: jest.fn(async (_r: string, p: { qtype: string; query: string }) => {
      const coluna = p.qtype.replace('fn_movim_finan.', '');
      const registros = linhas.filter((l) => l[coluna] === p.query);
      return { total: registros.length, page: 1, registros };
    }),
    // O Estornar do IXC: na filha, leva as duas linhas e reabre o título.
    remove: jest.fn(async (_r: string, id: number) => {
      if (opts.estornoNaoPega || String(id) !== FILHA.id) return {};
      linhas = linhas.filter((l) => l.id_movim_finan !== FILHA.id_movim_finan);
      titulo = {
        ...titulo,
        status: 'A',
        valor_aberto: '156.52',
        valor_total_pago: '0',
        valor_pago: '0',
        data_pagamento: '0000-00-00 00:00:00',
        debito_data: '0000-00-00',
      };
      return {};
    }),
    action: jest.fn(async () => {
      titulo = { ...PAGO, conta_pagamento: '15' };
      return {};
    }),
    create: jest.fn(async () => ({ id: 1, raw: {} })),
    update: jest.fn(async () => ({})),
  };
  const prisma = {
    contaPagar: { findFirst: jest.fn().mockResolvedValue(null) },
    diaria: { findFirst: jest.fn().mockResolvedValue(null) },
    pagamentoNoBanco: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new PagamentosService(
    ixc as never,
    { obter: jest.fn().mockResolvedValue(CFG) } as never,
    prisma as never,
    { acompanharTitulo: jest.fn() } as never,
  );
  return { service, ixc };
}

describe('PagamentosService.refazerBaixa', () => {
  it('estorna a linha da aba Pagamentos e paga de novo na conta escolhida, no mesmo dia', async () => {
    const { service, ixc } = montar();

    const r = await service.refazerBaixa(38114, { contaPagamento: 15 }, 'Henrico');

    // A filha, que é a linha que o IXC mostra em Pagamentos — nunca a mãe.
    expect(ixc.remove).toHaveBeenCalledTimes(1);
    expect(ixc.remove).toHaveBeenCalledWith('fn_apagar_baixas', 1788309);
    expect(r.paga).toBe(true);
    expect(r.estornado).toBe(1788309);
    expect(r.avisos).toEqual([]);
    const [, baixa] = ixc.action.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(baixa.conta_).toBe(15);
    expect(baixa.id_conta).toBe(10064);
    expect(baixa.data).toBe('10/11/2026');
    expect(ixc.remove.mock.invocationCallOrder[0]).toBeLessThan(
      ixc.action.mock.invocationCallOrder[0],
    );
  });

  it('troca o dia quando pedido', async () => {
    const { service, ixc } = montar();

    await service.refazerBaixa(38114, { contaPagamento: 18, data: '2026-11-11' });

    const [, baixa] = ixc.action.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(baixa.data).toBe('11/11/2026');
  });

  it('com a linha do banco faltando (o caso do 38114), não estorna nada', async () => {
    const { service, ixc } = montar({ semMae: true });

    await expect(service.refazerBaixa(38114, { contaPagamento: 15 })).rejects.toThrow(
      'não existe mais',
    );
    expect(ixc.remove).not.toHaveBeenCalled();
    expect(ixc.action).not.toHaveBeenCalled();
  });

  it('não estorna a saída que também pagou outro título', async () => {
    const { service, ixc } = montar({ outroTituloNaSaida: true });

    await expect(service.refazerBaixa(38114, { contaPagamento: 15 })).rejects.toThrow(
      'junto com outro',
    );
    expect(ixc.remove).not.toHaveBeenCalled();
  });

  it('com o estorno sem efeito, não paga de novo', async () => {
    const { service, ixc } = montar({ estornoNaoPega: true });

    await expect(service.refazerBaixa(38114, { contaPagamento: 15 })).rejects.toThrow(
      'não estornou',
    );
    expect(ixc.action).not.toHaveBeenCalled();
  });

  it('a mesma conta e o mesmo dia não mexem em nada', async () => {
    const { service, ixc } = montar();

    await expect(service.refazerBaixa(38114, { contaPagamento: 18 })).rejects.toThrow(
      'nada a trocar',
    );
    expect(ixc.remove).not.toHaveBeenCalled();
  });
});

describe('PagamentosService.estornarPagamento', () => {
  it('estorna pela linha da aba Pagamentos e deixa o título aberto', async () => {
    const { service, ixc } = montar();

    const r = await service.estornarPagamento(38114);

    expect(ixc.remove).toHaveBeenCalledWith('fn_apagar_baixas', 1788309);
    expect(r.estornado).toBe(1788309);
    expect(ixc.action).not.toHaveBeenCalled();
  });
});
