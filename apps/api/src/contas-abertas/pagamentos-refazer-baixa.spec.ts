import { PagamentosService } from './pagamentos.service';

/**
 * Trocar a conta de um pagamento já feito é estornar no IXC e baixar de novo.
 * O que este arquivo protege é a ordem: tudo que pode recusar recusa antes do
 * estorno, e o estorno só vale se o IXC de fato reabriu o título — senão a
 * baixa nova pagaria a conta duas vezes.
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

function montar(opts: { outroTituloNaBaixa?: boolean; estornoNaoPega?: boolean } = {}) {
  let titulo: Record<string, unknown> = { ...PAGO };
  const ixc = {
    getById: jest.fn(async (recurso: string) => {
      if (recurso === 'contas') return { id: '15', conta: 'Conta Banco Bradesco', id_planejamento: '10064' };
      if (recurso === 'filial') return { id: '1', filial: 'Matriz' };
      if (recurso === 'fornecedor') return { id: '88', razao: 'FULANO' };
      return titulo;
    }),
    list: jest.fn(async (_r: string, p: { qtype: string }) => {
      if (p.qtype === 'fn_movim_finan.documento') {
        return {
          total: 1,
          page: 1,
          registros: [{ id: '1788309', id_movim_finan: '1788308', tipo_lanc: 'P', documento: '38114' }],
        };
      }
      const registros = [
        { id: '1788308', tipo_lanc: 'M', documento: '' },
        { id: '1788309', tipo_lanc: 'P', documento: '38114' },
      ];
      if (opts.outroTituloNaBaixa) registros.push({ id: '1788310', tipo_lanc: 'P', documento: '38112' });
      return { total: registros.length, page: 1, registros };
    }),
    remove: jest.fn(async () => {
      if (!opts.estornoNaoPega) {
        titulo = {
          ...titulo,
          status: 'A',
          valor_aberto: '156.52',
          valor_total_pago: '0',
          valor_pago: '0',
          data_pagamento: '0000-00-00 00:00:00',
          debito_data: '0000-00-00',
        };
      }
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
  const contasPagar = { acompanharTitulo: jest.fn() };
  const service = new PagamentosService(
    ixc as never,
    { obter: jest.fn().mockResolvedValue(CFG) } as never,
    prisma as never,
    contasPagar as never,
  );
  return { service, ixc };
}

describe('PagamentosService.refazerBaixa', () => {
  it('estorna a baixa do título e baixa de novo na conta escolhida, no mesmo dia', async () => {
    const { service, ixc } = montar();

    const r = await service.refazerBaixa(38114, { contaPagamento: 15 }, 'Henrico');

    expect(ixc.remove).toHaveBeenCalledWith('fn_apagar_baixas', 1788308);
    expect(r.paga).toBe(true);
    expect(r.estornado).toBe(1788308);
    const [, baixa] = ixc.action.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(baixa.conta_).toBe(15);
    expect(baixa.id_conta).toBe(10064);
    expect(baixa.data).toBe('10/11/2026');
    expect(ixc.remove.mock.invocationCallOrder[0]).toBeLessThan(
      ixc.action.mock.invocationCallOrder[0],
    );
  });

  it('não estorna a baixa que também pagou outro título', async () => {
    const { service, ixc } = montar({ outroTituloNaBaixa: true });

    await expect(service.refazerBaixa(38114, { contaPagamento: 15 })).rejects.toThrow(
      'também paga outra coisa',
    );
    expect(ixc.remove).not.toHaveBeenCalled();
  });

  it('com o estorno sem efeito, não dá a baixa nova', async () => {
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
