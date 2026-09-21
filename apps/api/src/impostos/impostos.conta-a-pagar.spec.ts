import { ImpostosService } from './impostos.service';

/**
 * A guia de imposto virando conta a pagar.
 *
 * O que este arquivo protege é o que dói errar: **imposto pago em dobro não se
 * estorna, se compensa** — meses depois, com a contabilidade no meio. Por isso
 * a geração é idempotente e o vínculo mora no banco.
 *
 * O resto é sobre a conta chegar pagável do outro lado: com o vencimento
 * impresso na guia (dia 20, não o dia em que alguém subiu o PDF), com o valor
 * do documento, e com o código que veio no papel — linha digitável no DARF, PIX
 * copia e cola no FGTS. Conta sem código chega ao IXC e fica parada.
 */

const TEXTO_DARF = [
  'Documento de Arrecadação de Receitas Federais',
  'Pagar este documento até 20/08/2026',
  '85830000012 3 34560000000 0 00000000000 0 00011122233 4 AUTENTICAÇÃO MECÂNICA',
].join('\n');

const TEXTO_FGTS = [
  'GFD - Guia do FGTS Digital',
  '00020101021226900014br.gov.bcb.pix2568pix-qrcode.caixa.gov.br/api/v2/cobv/00000000000000000000000000000000520400005303986580',
  'PIX Copia e Cola:',
  'pix-qrcode.caixa.gov.br/api/v2/cobv/00000000000000000000000000000000',
].join('\n');

// A linha do PIX precisa terminar no CRC para valer como payload; o fixture
// acima quebra em duas por largura, então a de verdade é montada aqui.
const TEXTO_FGTS_COMPLETO = TEXTO_FGTS.replace(
  '520400005303986580',
  '5204000053039865802BR5923CAIXA ECONOMICA FEDERAL6008Brasilia62070503***63040000',
);

function guiaGravada(over: Record<string, unknown> = {}) {
  return {
    id: 'guia-1',
    tipo: 'DARF_INSS',
    competencia: '2026-07',
    vencimento: new Date(Date.UTC(2026, 7, 20)),
    valorTotal: 4310.76,
    numeroDocumento: '07.16.11111.2222222-3',
    textoOriginal: TEXTO_DARF,
    contaPagar: null,
    itens: [{ denominacao: 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO' }],
    ...over,
  };
}

function montarServico(opts: { guia?: Record<string, unknown>; semFornecedor?: boolean } = {}) {
  const guia = opts.guia ?? guiaGravada();

  const prisma = {
    guia: {
      findUnique: jest.fn().mockResolvedValue(guia),
      update: jest.fn().mockResolvedValue({ ...guia, contaPagarId: 'conta-1' }),
      create: jest.fn().mockResolvedValue(guia),
      findFirst: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(guia),
    },
  };

  const criadas: Array<Record<string, unknown>> = [];
  const contasPagar = {
    remover: jest.fn().mockResolvedValue(undefined),
    criarDespesa: jest.fn(async (dados: Record<string, unknown>) => {
      criadas.push(dados);
      return {
        id: 'conta-1',
        idFnApagarIxc: 90001,
        valor: dados.valor,
        dataVencimento: dados.dataVencimento,
        beneficiarioNome: dados.fornecedorNome,
        idFornecedorIxc: dados.idFornecedorIxc,
      };
    }),
  };

  const fornecedores = {
    buscarNoIxcPorNome: jest.fn(async () =>
      opts.semFornecedor
        ? []
        : [
            { idFornecedor: 4242, nome: 'RECEITA FEDERAL' },
            { idFornecedor: 77, nome: 'Receita Federal do Brasil - PGFN' },
          ],
    ),
  };

  const service = new ImpostosService(
    prisma as never,
    contasPagar as never,
    fornecedores as never,
  );

  return { service, prisma, contasPagar, fornecedores, criadas };
}

describe('a guia entra na fila de pagamento', () => {
  it('lança a conta com o valor, o vencimento e o fornecedor da guia', async () => {
    const { service, criadas } = montarServico();

    const r = await service.gerarContaAPagar('guia-1', 'usuario-1');

    expect(criadas[0]).toMatchObject({
      idFornecedorIxc: 4242,
      fornecedorNome: 'RECEITA FEDERAL',
      valor: 4310.76,
      // O dia 20 vem impresso na guia. Datar pelo dia em que alguém subiu o PDF
      // poria um imposto vencido na fila como se vencesse hoje.
      dataVencimento: new Date(Date.UTC(2026, 7, 20)),
      documento: '07.16.11111.2222222-3',
    });
    expect(criadas[0].observacao).toBe('DARF INSS · competência 07/2026');
    expect(r).toMatchObject({ idFnApagarIxc: 90001, jaExistia: false, aviso: null });
  });

  /*
   * O nome exato ganha da busca por aproximação: "Receita Federal" e "Receita
   * Federal do Brasil - PGFN" são cadastros diferentes no IXC, e a conta tem de
   * sair sempre no mesmo — senão o histórico do fornecedor fica partido em dois.
   */
  it('prefere o cadastro de nome exato entre os parecidos', async () => {
    const { service, criadas } = montarServico();
    await service.gerarContaAPagar('guia-1');
    expect(criadas[0].idFornecedorIxc).toBe(4242);
  });

  it('leva a linha digitável do DARF, para a conta poder ser paga', async () => {
    const { service, criadas } = montarServico();
    await service.gerarContaAPagar('guia-1');

    expect(criadas[0]).toMatchObject({
      tipoPagamentoIxc: 'Boleto',
      codigoBarras: '858300000123345600000000000000000000000111222334',
    });
  });

  /*
   * O FGTS Digital não tem código de barras: quem recebe é a Caixa, e ela quer
   * PIX. O payload do QR vira a chave "copia e cola" da conta no IXC.
   */
  it('no FGTS leva o PIX copia e cola em vez do boleto', async () => {
    const { service, criadas } = montarServico({
      guia: guiaGravada({ tipo: 'FGTS', textoOriginal: TEXTO_FGTS_COMPLETO }),
    });
    await service.gerarContaAPagar('guia-1');

    expect(criadas[0]).toMatchObject({
      tipoPagamentoIxc: 'Pix',
      tipoChavePix: 'Código copia e cola',
    });
    expect(String(criadas[0].chavePix)).toContain('br.gov.bcb.pix');
    expect(criadas[0].codigoBarras).toBeUndefined();
  });

  /*
   * Guia digitada à mão não tem o texto do PDF, e aí não há código nenhum para
   * achar. A conta é lançada assim mesmo — o imposto vence de qualquer jeito —,
   * mas quem paga precisa saber que vai ter de colar o código lá.
   */
  it('sem código no PDF, lança mesmo assim e avisa', async () => {
    const { service, criadas } = montarServico({
      guia: guiaGravada({ textoOriginal: null }),
    });

    const r = await service.gerarContaAPagar('guia-1');

    expect(criadas[0].codigoBarras).toBeUndefined();
    expect(criadas[0].chavePix).toBeUndefined();
    expect(r.formaDePagamento).toBeNull();
    expect(r.aviso).toMatch(/sem como ser paga/);
  });

  /*
   * O consignado chega numa guia do FGTS à parte, no mesmo mês. Com o mesmo
   * nome, as duas contas na fila pareceriam uma lançada duas vezes.
   */
  it('a guia só do consignado entra na fila com nome próprio', async () => {
    const { service, criadas } = montarServico({
      guia: guiaGravada({
        tipo: 'FGTS',
        textoOriginal: TEXTO_FGTS_COMPLETO,
        itens: [
          { denominacao: 'Consignado retido do trabalhador' },
          { denominacao: 'Encargos do consignado (atraso)' },
        ],
      }),
    });
    await service.gerarContaAPagar('guia-1');
    expect(criadas[0].observacao).toBe('FGTS Consignado · competência 07/2026');
  });
});

/*
 * Apagar a guia é como se desfaz uma leitura errada para lançar de novo. Se a
 * conta ficasse, o título velho continuaria na fila do IXC e a guia relançada
 * abriria outro — o mesmo imposto duas vezes.
 */
describe('apagar a guia', () => {
  const conta = (status: string) => ({ contaPagar: { id: 'conta-ja', status } });

  it('leva junto a conta que ainda não foi paga', async () => {
    const { service, prisma, contasPagar } = montarServico({
      guia: guiaGravada(conta('AGUARDANDO_PAGAMENTO')),
    });
    await service.remover('guia-1');
    expect(contasPagar.remover).toHaveBeenCalledWith('conta-ja');
    expect(prisma.guia.delete).toHaveBeenCalledWith({ where: { id: 'guia-1' } });
  });

  it('conta já paga fica: dinheiro que saiu é histórico', async () => {
    const { service, prisma, contasPagar } = montarServico({ guia: guiaGravada(conta('PAGO')) });
    await service.remover('guia-1');
    expect(contasPagar.remover).not.toHaveBeenCalled();
    expect(prisma.guia.delete).toHaveBeenCalled();
  });

  it('o IXC recusando apagar a conta, a guia também fica', async () => {
    const { service, prisma, contasPagar } = montarServico({
      guia: guiaGravada(conta('AGUARDANDO_APROVACAO')),
    });
    contasPagar.remover.mockRejectedValueOnce(new Error('O IXC não apagou a conta'));
    await expect(service.remover('guia-1')).rejects.toThrow(/IXC não apagou/);
    expect(prisma.guia.delete).not.toHaveBeenCalled();
  });
});

describe('a mesma guia não vira duas contas', () => {
  it('devolve a conta que já existe, sem lançar outra', async () => {
    const { service, contasPagar } = montarServico({
      guia: guiaGravada({
        contaPagar: {
          id: 'conta-ja',
          idFnApagarIxc: 555,
          valor: 4310.76,
          dataVencimento: new Date(Date.UTC(2026, 7, 20)),
          beneficiarioNome: 'RECEITA FEDERAL',
          idFornecedorIxc: 4242,
        },
      }),
    });

    const r = await service.gerarContaAPagar('guia-1');

    expect(r).toMatchObject({ jaExistia: true, idFnApagarIxc: 555 });
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });
});

describe('lançar a guia', () => {
  it('grava a guia e já gera a conta a pagar', async () => {
    const { service, contasPagar } = montarServico();

    const r = (await service.gravar(
      {
        tipo: 'DARF_INSS',
        competencia: '2026-07',
        vencimento: '2026-08-20',
        valorTotal: 4310.76,
        arquivoNome: 'darf.pdf',
        textoOriginal: TEXTO_DARF,
        itens: [{ denominacao: 'CP segurado', valor: 4310.76, classe: 'FOLHA_RETIDO' }],
      } as never,
      'usuario-1',
    )) as { conta: { idFnApagarIxc: number } | null; avisoConta: string | null };

    expect(contasPagar.criarDespesa).toHaveBeenCalled();
    expect(r.conta?.idFnApagarIxc).toBe(90001);
    expect(r.avisoConta).toBeNull();
  });

  /*
   * A guia já está gravada quando a conta falha. Derrubar o lançamento por
   * causa disso deixaria o pior dos dois mundos: nada registrado aqui e o
   * imposto continuando a vencer lá fora.
   */
  it('a guia fica gravada mesmo quando a conta não sai, e diz por quê', async () => {
    const { service } = montarServico({ semFornecedor: true });

    const r = (await service.gravar(
      {
        tipo: 'DARF_INSS',
        competencia: '2026-07',
        vencimento: '2026-08-20',
        valorTotal: 4310.76,
        arquivoNome: 'darf.pdf',
        textoOriginal: TEXTO_DARF,
        itens: [{ denominacao: 'CP segurado', valor: 4310.76, classe: 'FOLHA_RETIDO' }],
      } as never,
      'usuario-1',
    )) as { id: string; conta: unknown; avisoConta: string | null };

    expect(r.id).toBe('guia-1');
    expect(r.conta).toBeNull();
    expect(r.avisoConta).toMatch(/Receita Federal/);
  });
});
