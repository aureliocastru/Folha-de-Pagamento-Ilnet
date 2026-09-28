import { montarEdicao, PagamentosService } from './pagamentos.service';

/**
 * Editar um título é um `PUT`, e o `PUT` do webservice reescreve a linha
 * inteira. O que este arquivo protege:
 *
 *  - o que não foi alterado vai de volta igual — mandar só o campo mudado
 *    apagaria fornecedor, valor e vencimento de uma vez;
 *  - as datas voltam no formato que o IXC aceita (ele devolve AAAA-MM-DD na
 *    leitura e só aceita DD/MM/AAAA na escrita);
 *  - `liberado` e `previsao` não são mexidos: são eles que fazem a conta
 *    existir para o financeiro de lá.
 */

const ATUAL = {
  id: '4242',
  id_fornecedor: '196',
  data_emissao: '2026-08-15',
  data_vencimento: '2026-09-14',
  valor: '125.00',
  id_contas: '18',
  id_conta: '324',
  filial_id: '1',
  tipo_pagamento: 'Pix',
  chave_pix: '617.696.563-24',
  codigo_barras: '',
  documento: 'NF 99',
  numero_nota: '99',
  obs: 'Teste (2/4)',
  previsao: 'N',
  liberado: 'S',
};

describe('montarEdicao', () => {
  it('devolve o registro inteiro quando muda só o tipo de pagamento', async () => {
    const p = await montarEdicao(ATUAL, { tipoPagamento: 'Boleto' });

    expect(p).toMatchObject({
      tipo_pagamento: 'Boleto',
      // Tudo o mais volta como estava — é isto que o PUT exige.
      id_fornecedor: '196',
      valor: '125.00',
      data_vencimento: '14/09/2026',
      id_contas: '18',
      id_conta: '324',
      obs: 'Teste (2/4)',
      documento: 'NF 99',
      numero_nota: '99',
      chave_pix: '617.696.563-24',
    });
  });

  it('converte as datas para o formato que o IXC aceita', async () => {
    const p = await montarEdicao(ATUAL, { dataVencimento: '2026-12-01' });

    expect(p.data_vencimento).toBe('01/12/2026');
    expect(p.data_emissao).toBe('15/08/2026');
  });

  it('não mexe no que faz a conta existir para o IXC', async () => {
    const p = await montarEdicao(ATUAL, { valor: 200 });

    expect(p).toMatchObject({ liberado: 'S', previsao: 'N', valor: '200.00' });
  });

  it('boleto vai só com dígitos', async () => {
    const p = await montarEdicao(ATUAL, {
      tipoPagamento: 'Boleto',
      codigoBarras: '23791.14206 90000.088246 16001.444005 1 15650000008998',
    });

    expect(p.codigo_barras).toBe(
      '23791142069000008824616001444005115650000008998',
    );
  });

  /*
   * Editar abre a mesma tela de lançar: tudo que ela mostra, ela salva.
   */
  it('troca fornecedor, emissão e número da nota', async () => {
    const p = await montarEdicao(ATUAL, {
      idFornecedor: 311,
      dataEmissao: '2026-08-20',
      numeroNota: '1234',
    });

    expect(p).toMatchObject({
      id_fornecedor: '311',
      data_emissao: '20/08/2026',
      numero_nota: '1234',
    });
  });

  /*
   * O PUT reescreve a linha inteira. O rádio do tipo da chave em branco é um
   * pagamento que o banco não faz; o `comunicado` em branco tira o pagamento
   * da conciliação. Nenhum dos dois era da edição, e os dois se perdiam.
   */
  it('devolve o tipo da chave e o comunicado como estavam', async () => {
    const p = await montarEdicao(
      { ...ATUAL, tipo_pix: 'CPF_CNPJ', comunicado: 'N', eh_despesa_veiculo: 'N' },
      { valor: 200 },
    );

    expect(p).toMatchObject({
      tipo_pix: 'CPF_CNPJ',
      comunicado: 'N',
      eh_despesa_veiculo: 'N',
    });
  });

  it('coluna que o registro não tem não é inventada', async () => {
    const p = await montarEdicao(ATUAL, { valor: 200 });

    expect(p).not.toHaveProperty('comunicado');
    expect(p).not.toHaveProperty('tipo_pix');
  });

  it('o tipo da chave trocado vai com o código do IXC', async () => {
    const p = await montarEdicao(
      { ...ATUAL, tipo_pix: 'CPF_CNPJ' },
      { chavePix: 'financeiro@exemplo.com', tipoChavePix: 'E-mail' },
      { tipoChave: 'E-mail', mapaTipoChave: null },
    );

    expect(p).toMatchObject({
      chave_pix: 'financeiro@exemplo.com',
      tipo_pix: 'EMAIL',
    });
  });

  it('registro que já veio com data brasileira não é remexido', async () => {
    const p = await montarEdicao(
      { ...ATUAL, data_vencimento: '14/09/2026' },
      { observacao: 'nova' },
    );

    expect(p.data_vencimento).toBe('14/09/2026');
    expect(p.obs).toBe('nova');
  });
});

/**
 * O IXC recusa editar conta com auditoria aprovada — e as lançadas daqui
 * nascem aprovadas. O ciclo reprova, edita e aprova de novo; o que este bloco
 * protege é que a conta nunca fique reprovada por acidente, porque reprovada
 * ela deixa de ser pagável.
 */
describe('editar conta aprovada', () => {
  function montar(
    opts: { auditoria?: string; erroAoEditar?: string; semLocal?: boolean } = {},
  ) {
    const passos: string[] = [];
    const ixc = {
      getById: jest.fn().mockResolvedValue({
        ...ATUAL,
        status: 'A',
        valor_aberto: '125.00',
        status_auditoria: opts.auditoria ?? 'A',
      }),
      create: jest.fn(async (_r: string, payload: Record<string, unknown>) => {
        passos.push(`auditoria:${String(payload.status)}`);
        return { id: 1, raw: {} };
      }),
      update: jest.fn(async () => {
        passos.push('editar');
        if (opts.erroAoEditar) throw new Error(opts.erroAoEditar);
        return {};
      }),
    };
    const contaPagar = {
      deleteMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: opts.semLocal ? 0 : 1 }),
    };
    const contasPagar = {
      apagarLocalPorTituloIxc: jest.fn(),
      mapaDoTipoChavePix: jest.fn().mockResolvedValue(null),
    };
    const service = new PagamentosService(
      ixc as never,
      { obter: jest.fn().mockResolvedValue({}) } as never,
      { contaPagar } as never,
      contasPagar as never,
    );
    return { service, passos, ixc, contaPagar };
  }

  it('reprova, edita e aprova de novo', async () => {
    const { service, passos } = montar();

    const r = await service.editar(4242, { tipoPagamento: 'Boleto' });

    expect(passos).toEqual(['auditoria:R', 'editar', 'auditoria:A']);
    expect(r.reaprovada).toBe(true);
  });

  it('conta não aprovada é editada direto, sem mexer na auditoria', async () => {
    const { service, passos } = montar({ auditoria: '' });

    const r = await service.editar(4242, { tipoPagamento: 'Boleto' });

    expect(passos).toEqual(['editar']);
    expect(r.reaprovada).toBe(false);
  });

  it('se a edição falhar, a conta é aprovada de volta mesmo assim', async () => {
    const { service, passos } = montar({ erroAoEditar: 'IXC fora do ar' });

    await expect(
      service.editar(4242, { tipoPagamento: 'Boleto' }),
    ).rejects.toThrow('IXC fora do ar');

    // Sem o terceiro passo, a conta ficaria reprovada e sem poder ser paga.
    expect(passos).toEqual(['auditoria:R', 'editar', 'auditoria:A']);
  });

  /*
   * O veículo mora só aqui. Trocá-lo não é motivo para reprovar e reaprovar
   * a conta no IXC — lá nada mudou.
   */
  it('só o veículo: grava aqui e não toca no IXC', async () => {
    const { service, passos, contaPagar } = montar();

    const r = await service.editar(4242, { veiculoId: 'v1' });

    expect(contaPagar.updateMany).toHaveBeenCalledWith({
      where: { idFnApagarIxc: 4242 },
      data: { veiculoId: 'v1' },
    });
    expect(passos).toEqual([]);
    expect(r.reaprovada).toBe(false);
  });

  it('veículo em conta que não foi lançada aqui é recusado antes do IXC', async () => {
    const { service, passos } = montar({ semLocal: true });

    await expect(
      service.editar(4242, { veiculoId: 'v1', valor: 300 }),
    ).rejects.toThrow(/não foi lançada por este app/);
    expect(passos).toEqual([]);
  });

  it('chave trocada sem tipo leva o tipo pelo formato dela', async () => {
    const { service, ixc } = montar({ auditoria: '' });

    await service.editar(4242, { chavePix: 'financeiro@exemplo.com' });

    const [, , corpo] = ixc.update.mock.calls[0] as unknown as [
      string,
      number,
      Record<string, unknown>,
    ];
    expect(corpo.tipo_pix).toBe('EMAIL');
  });
});
