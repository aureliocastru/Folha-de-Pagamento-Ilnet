import { PagamentosService } from './pagamentos.service';

/**
 * De onde e em que dia o dinheiro de um título saiu — a pergunta que o caixa
 * faz para a nota da rua acompanhar o IXC.
 *
 * O caso que a criou: a nota da Oficina do Murilo (título 37671) foi lançada
 * com 28/10 no lugar de 28/09 e corrigida no IXC. O título passou a dizer
 * 28/09 em `debito_data`; a linha de baixa, que seria o caminho natural, o
 * webservice desta base não devolve. O que este arquivo protege:
 *
 *  - o dia é o do débito, e não o de quando a baixa foi registrada;
 *  - o status desta base é "F";
 *  - estornado, não há saída — e isso é diferente de "não deu para saber";
 *  - título que sumiu não é estorno: apagar não desfaz a baixa.
 */

function servico(raw: Record<string, unknown> | null | Error) {
  const ixc = {
    getById: jest.fn(async () => {
      if (raw instanceof Error) throw raw;
      return raw;
    }),
  };
  return new PagamentosService(
    ixc as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('saidaDoTitulo', () => {
  it('pago: o dia do débito e a conta do título', async () => {
    const r = await servico({
      id: '37671',
      status: 'F',
      valor: '400.00',
      valor_aberto: '0.00',
      valor_total_pago: '400.00',
      // Registrada no dia em que alguém refez a baixa; o dinheiro saiu antes.
      data_pagamento: '2026-10-02 19:40:12',
      debito_data: '2026-09-28',
      id_contas: '23',
    }).saidaDoTitulo(37671);

    expect(r).toEqual({ dia: new Date(Date.UTC(2026, 8, 28)), conta: 23 });
  });

  it('estornado e em aberto de novo: não há saída', async () => {
    const r = await servico({
      id: '37671',
      status: 'A',
      valor: '400.00',
      valor_aberto: '400.00',
      valor_total_pago: '0.00',
      data_pagamento: '0000-00-00',
      debito_data: '0000-00-00',
      id_contas: '23',
    }).saidaDoTitulo(37671);

    expect(r).toBe('sem-baixa');
  });

  it('cancelado: não há saída', async () => {
    const r = await servico({ id: '37671', status: 'C', valor: '400.00' })
      .saidaDoTitulo(37671);

    expect(r).toBe('sem-baixa');
  });

  it('título que não existe mais não é estorno', async () => {
    expect(await servico(null).saidaDoTitulo(37671)).toBeNull();
  });

  it('IXC fora do ar: não deu para saber', async () => {
    expect(await servico(new Error('timeout')).saidaDoTitulo(37671)).toBeNull();
  });
});
