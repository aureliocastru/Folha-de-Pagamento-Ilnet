import { DespesasService } from './despesas.service';
import type { CriarDespesaDto } from './dto/despesa.dto';

/**
 * A conta lançada em vezes vira uma conta a pagar por parcela no IXC — e é
 * pela observação que alguém, olhando a lista de lá, sabe qual é qual. O que
 * este arquivo protege:
 *
 *  - cada parcela sai com o valor e o vencimento da sua linha, não do total;
 *  - a numeração da observação ("3/6") sai certa;
 *  - num consórcio a numeração é a do grupo ("13/120"), e não a posição na
 *    lista: quem entra no meio já pagou as primeiras fora do sistema, e o
 *    número tem de bater com o boleto que chega;
 *  - parcela que falha no meio não derruba as que já entraram no IXC, e quem
 *    lançou fica sabendo em qual parou.
 */

/** O que o serviço manda ao `ContasPagarService` — só o que os testes leem. */
interface DadosDaDespesa {
  valor: number;
  dataVencimento: Date;
  observacao: string;
  documento?: string | null;
  codigoBarras?: string | null;
}

function montarServico(opts: { falharNa?: number } = {}) {
  let n = 0;
  const contasPagar = {
    criarDespesa: jest.fn(
      async (_dados: DadosDaDespesa, _usuarioId?: string) => {
        n++;
        if (opts.falharNa === n) throw new Error('IXC recusou');
        return { id: `conta-${n}`, idFnApagarIxc: 5000 + n };
      },
    ),
  };
  const categorias = {
    classificar: jest.fn(
      async (_idFnApagar: number, _categoriaId: string, _usuarioId?: string) =>
        undefined,
    ),
  };

  const pagamentos = {
    pagar: jest.fn(async (idFnApagar: number) => ({
      idFnApagar,
      aprovada: true,
      paga: true,
      valor: 100,
      avisos: [],
    })),
  };

  // O cliente do IXC só é usado para anexar a nota ao título; nenhum caso daqui
  // passa por lá, e um dublê mudo basta para o construtor.
  const ixc = { upload: jest.fn() };

  const service = new DespesasService(
    contasPagar as never,
    categorias as never,
    pagamentos as never,
    ixc as never,
    // Sem veículo nestes casos: o banco não é consultado.
    {} as never,
  );
  return { service, contasPagar, categorias, pagamentos , ixc };
}

const BASE: CriarDespesaDto = {
  idFornecedorIxc: 196,
  fornecedorNome: 'New Holland Consórcio',
  valor: 3554.32,
  observacao: 'Consórcio de Trator',
};

describe('DespesasService.lancar em parcelas', () => {
  it('cada parcela leva o próprio valor e o próprio vencimento', async () => {
    const { service, contasPagar } = montarServico();

    const r = await service.lancar({
      ...BASE,
      parcelas: [
        { valor: 100.5, dataVencimento: '2026-09-10' },
        { valor: 200.25, dataVencimento: '2026-10-10' },
      ],
    });

    expect(r.contas).toHaveLength(2);
    const [primeira] = contasPagar.criarDespesa.mock.calls[0];
    const [segunda] = contasPagar.criarDespesa.mock.calls[1];
    expect(primeira.valor).toBe(100.5);
    expect(primeira.dataVencimento.toISOString()).toBe(
      '2026-09-10T00:00:00.000Z',
    );
    expect(segunda.valor).toBe(200.25);
    expect(segunda.dataVencimento.toISOString()).toBe(
      '2026-10-10T00:00:00.000Z',
    );
  });

  it('numera a observação pela posição quando a nota é nova', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar({
      ...BASE,
      observacao: 'Nota 4471 ',
      parcelas: [
        { valor: 100, dataVencimento: '2026-09-10' },
        { valor: 100, dataVencimento: '2026-10-10' },
        { valor: 100, dataVencimento: '2026-11-10' },
      ],
    });

    const observacoes = contasPagar.criarDespesa.mock.calls.map(
      ([d]) => d.observacao,
    );
    expect(observacoes).toEqual([
      'Nota 4471 (1/3)',
      'Nota 4471 (2/3)',
      'Nota 4471 (3/3)',
    ]);
  });

  it('no consórcio a numeração é a do grupo, não a da lista', async () => {
    const { service, contasPagar } = montarServico();

    // Consórcio de 120 com 35 pagas: a primeira a lançar é a 36 de 120.
    await service.lancar({
      ...BASE,
      parcelas: [
        { valor: 3554.32, dataVencimento: '2026-09-09', rotulo: '36/120' },
        { valor: 3554.32, dataVencimento: '2026-10-09', rotulo: '37/120' },
      ],
    });

    const observacoes = contasPagar.criarDespesa.mock.calls.map(
      ([d]) => d.observacao,
    );
    expect(observacoes).toEqual([
      'Consórcio de Trator (36/120)',
      'Consórcio de Trator (37/120)',
    ]);
  });

  it('parcela que falha no meio deixa as anteriores de pé e avisa qual parou', async () => {
    const { service, contasPagar } = montarServico({ falharNa: 3 });

    const r = await service.lancar({
      ...BASE,
      parcelas: [
        { valor: 100, dataVencimento: '2026-09-10' },
        { valor: 100, dataVencimento: '2026-10-10' },
        { valor: 100, dataVencimento: '2026-11-10' },
        { valor: 100, dataVencimento: '2026-12-10' },
      ],
    });

    // Parou na 3 e não tentou a 4: insistir depois de o IXC recusar costuma
    // repetir a mesma recusa, e o que interessa é saber onde parou.
    expect(contasPagar.criarDespesa).toHaveBeenCalledTimes(3);
    expect(r.contas).toHaveLength(2);
    expect(r.avisoCategoria).toContain('parcela 3 de 4');
    expect(r.avisoCategoria).toContain('IXC recusou');
  });

  it('nenhuma parcela criada é erro, não sucesso vazio', async () => {
    const { service } = montarServico({ falharNa: 1 });

    await expect(
      service.lancar({
        ...BASE,
        parcelas: [{ valor: 100, dataVencimento: '2026-09-10' }],
      }),
    ).rejects.toThrow('IXC recusou');
  });

  it('a categoria é aplicada a todas as parcelas, pelo número do IXC', async () => {
    const { service, categorias } = montarServico();

    await service.lancar({
      ...BASE,
      categoriaId: '11111111-1111-1111-1111-111111111111',
      parcelas: [
        { valor: 100, dataVencimento: '2026-09-10' },
        { valor: 100, dataVencimento: '2026-10-10' },
      ],
    });

    expect(categorias.classificar).toHaveBeenCalledTimes(2);
    expect(categorias.classificar).toHaveBeenNthCalledWith(
      1,
      5001,
      '11111111-1111-1111-1111-111111111111',
      undefined,
    );
    expect(categorias.classificar).toHaveBeenNthCalledWith(
      2,
      5002,
      '11111111-1111-1111-1111-111111111111',
      undefined,
    );
  });
});
