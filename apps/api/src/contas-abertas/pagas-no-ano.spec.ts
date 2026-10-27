import { ContasAbertasService } from './contas-abertas.service';

/**
 * As colunas "mês a mês" do dashboard: o pago de cada mês do ano numa leitura
 * só do IXC. O que este arquivo protege:
 *
 *  - cada pagamento cai no mês da sua data, e o ano anterior fica de fora;
 *  - a leitura para quando uma página inteira já é de antes de janeiro — o
 *    histórico de pagas tem dezenas de milhares de títulos;
 *  - o mês sozinho (`pagasNoMes`) e a coluna dele no ano dão o mesmo número.
 */

/** Um título pago, como o `fn_apagar` o devolve. */
function pago(data: string, valor: number) {
  return {
    status: 'F',
    data_pagamento: data,
    valor_total_pago: valor.toFixed(2),
    valor_aberto: '0.00',
  };
}

/** De outubro a janeiro de 2026, 60 pagamentos de R$ 10 por mês; depois 2025. */
function historico() {
  const registros: ReturnType<typeof pago>[] = [];
  for (let mes = 10; mes >= 1; mes--) {
    for (let i = 0; i < 60; i++) {
      registros.push(pago(`2026-${String(mes).padStart(2, '0')}-15`, 10));
    }
  }
  for (let mes = 12; mes >= 1; mes--) {
    for (let i = 0; i < 125; i++) {
      registros.push(pago(`2025-${String(mes).padStart(2, '0')}-15`, 99));
    }
  }
  return registros;
}

/** O IXC de mentira: pagina o histórico do mais novo para o mais velho. */
function ixcFalso() {
  const registros = historico();
  const paginasPedidas: string[] = [];
  const ixc = {
    list: jest.fn(async (_tabela: string, p: { query: string; page: number; rp: number }) => {
      paginasPedidas.push(`${p.query}:${p.page}`);
      if (p.query !== 'F') return { total: 0, registros: [] };
      const inicio = (p.page - 1) * p.rp;
      return { total: registros.length, registros: registros.slice(inicio, inicio + p.rp) };
    }),
  };
  return { ixc, paginasPedidas };
}

function servico(ixc: unknown) {
  return new ContasAbertasService(ixc as never, {} as never, {} as never);
}

describe('pagasNoAno', () => {
  it('soma cada mês à parte e deixa o ano anterior de fora', async () => {
    const { ixc } = ixcFalso();
    const ano = await servico(ixc).pagasNoAno(2026);

    expect(ano.meses).toHaveLength(12);
    expect(ano.meses[0]).toMatchObject({ mes: '2026-01', total: 600, quantidade: 60 });
    expect(ano.meses[9]).toMatchObject({ mes: '2026-10', total: 600, quantidade: 60 });
    // Novembro e dezembro ainda não chegaram: zero, mas com a coluna no lugar.
    expect(ano.meses[10]).toMatchObject({ mes: '2026-11', total: 0, quantidade: 0 });
    expect(ano.meses[11]).toMatchObject({ mes: '2026-12', total: 0, quantidade: 0 });
    expect(ano.completo).toBe(true);
  });

  it('para de ler quando a página inteira já é de antes de janeiro', async () => {
    const { ixc, paginasPedidas } = ixcFalso();
    await servico(ixc).pagasNoAno(2026);

    // Página 1: só 2026. Página 2: o resto de 2026 e começo de 2025. Página 3:
    // só 2025 — aí para. O "P" desta base vem vazio na primeira.
    expect(paginasPedidas).toEqual(['F:1', 'F:2', 'F:3', 'P:1']);
  });

  it('o mês sozinho bate com a coluna dele no ano', async () => {
    const { ixc } = ixcFalso();
    const marco = await servico(ixc).pagasNoMes('2026-03');
    expect(marco).toMatchObject({ mes: '2026-03', total: 600, quantidade: 60 });
  });
});
