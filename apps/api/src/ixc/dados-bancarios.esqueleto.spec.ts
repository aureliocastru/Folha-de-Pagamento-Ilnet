import { DadosBancariosService } from './dados-bancarios.service';

/**
 * A gravação da chave PIX na aba "Dados bancários" do fornecedor.
 *
 * O IXC quer o registro inteiro: coluna que não vai no corpo é coluna "não
 * preenchida", e ele recusa nomeando justamente a que faltou ("Preencha
 * banco!") — mesmo existindo, na base, linha válida com banco vazio.
 *
 * Os nomes de coluna aqui são os da base de verdade, lidos do log:
 * `meio_pagamento_preferencial`, `conta_principal`, `tipo_pix_preferencial`.
 */
describe('gravar a chave PIX nos dados bancários', () => {
  /** Uma linha do grid como o IXC a devolve. */
  const linha = (over: Record<string, unknown> = {}) => ({
    id: '368',
    id_fornecedor: '3260',
    meio_pagamento_preferencial: 'PIX',
    tipo_pix_preferencial: 'CPF_CNPJ',
    conta_principal: 'S',
    tipo_conta: 'C',
    banco: '',
    cod_banco: '',
    cod_agencia: '',
    cod_conta: '',
    titular: '',
    cnpj_cpf: '',
    pix_cpf_cnpj: '617.696.563-24',
    pix_celular: '',
    pix_email: '',
    pix_aleatorio: '',
    id_vendedor: '0',
    ...over,
  });

  function montar(doFornecedor: Array<Record<string, unknown>>) {
    const amostra = [linha()];
    const ixc = {
      list: jest.fn(async (_tabela: string, params: Record<string, unknown>) => {
        // A consulta por fornecedor devolve o que este caso pediu; as outras
        // (descoberta da tabela, amostra para aprender) devolvem o molde.
        const porFornecedor = String(params.qtype ?? '').includes('fornecedor');
        return { registros: porFornecedor ? doFornecedor : amostra, total: 1 };
      }),
      create: jest.fn(
        async (_tabela: string, _corpo: Record<string, unknown>) => ({
          id: 999,
        }),
      ),
      update: jest.fn(
        async (
          _tabela: string,
          _id: string,
          _corpo: Record<string, unknown>,
        ) => ({ id: 368 }),
      ),
    };
    return { service: new DadosBancariosService(ixc as never), ixc };
  }

  /**
   * Criando: a linha nasce com todas as colunas, e do molde de outra pessoa só
   * atravessam os códigos de uma ou duas letras — padrões do formulário.
   */
  it('cria mandando a linha inteira, sem dado de quem serviu de molde', async () => {
    const { service, ixc } = montar([]);

    const r = await service.gravarPix(3265, '000.295.663-20', 'CPF/CNPJ');

    expect(r.gravado).toBe(true);
    const corpo = ixc.create.mock.calls[0][1] as Record<string, string>;

    // O que o IXC exigia: a coluna presente, ainda que vazia.
    expect(corpo).toHaveProperty('banco', '');
    expect(corpo).toHaveProperty('cod_banco', '');
    expect(corpo).toHaveProperty('titular', '');

    // O que a tela precisa marcado.
    expect(corpo.id_fornecedor).toBe('3265');
    expect(corpo.pix_cpf_cnpj).toBe('000.295.663-20');
    expect(corpo.meio_pagamento_preferencial).toBe('PIX');
    expect(corpo.tipo_pix_preferencial).toBe('CPF_CNPJ');
    expect(corpo.conta_principal).toBe('S');

    // Padrões curtos do formulário passam; o `id` do molde não vai junto.
    expect(corpo.tipo_conta).toBe('C');
    expect(corpo.id_vendedor).toBe('0');
    expect(corpo).not.toHaveProperty('id');

    // E a chave de quem serviu de molde não vaza para o cadastro novo.
    expect(Object.values(corpo)).not.toContain('617.696.563-24');
  });

  /**
   * Editando: o IXC substitui o registro inteiro. Mandar só a chave apagaria o
   * banco, a agência e a conta de quem já os tinha.
   */
  it('editando, preserva o que já estava preenchido na linha', async () => {
    const daPessoa = linha({
      id: '400',
      id_fornecedor: '3265',
      banco: 'Banco do Brasil',
      cod_banco: '001',
      cod_agencia: '1234',
      cod_conta: '567890',
      titular: 'Marco Aurelio Sousa Castro',
      pix_cpf_cnpj: '',
      conta_principal: 'N',
      meio_pagamento_preferencial: 'BOLETO',
    });
    const { service, ixc } = montar([daPessoa]);

    const r = await service.gravarPix(3265, '000.295.663-20', 'CPF/CNPJ');

    expect(r.gravado).toBe(true);
    const [, id, corpo] = ixc.update.mock.calls[0];
    expect(id).toBe('400');

    // O que era dela continua dela.
    expect(corpo.banco).toBe('Banco do Brasil');
    expect(corpo.cod_agencia).toBe('1234');
    expect(corpo.titular).toBe('Marco Aurelio Sousa Castro');

    // E o que a gravação veio fazer, feito.
    expect(corpo.pix_cpf_cnpj).toBe('000.295.663-20');
    expect(corpo.meio_pagamento_preferencial).toBe('PIX');
    expect(corpo.conta_principal).toBe('S');
  });
});
