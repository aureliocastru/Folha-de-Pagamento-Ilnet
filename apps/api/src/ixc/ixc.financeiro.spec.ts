import {
  aprenderTipoChavePix,
  camposDoTipoChavePix,
  buildAuditoriaPayload,
  buildContaPagarPayload,
  buildFornecedorPayload,
  formatDataIxc,
  formatValorIxc,
  inferirTipoChavePix,
  lerSituacaoContaPagar,
  lerStatusAuditoria,
  normalizarTipoChavePix,
  parseCodigosTipoChavePix,
  serializarCodigosTipoChavePix,
} from './ixc.financeiro';

describe('formatDataIxc / formatValorIxc', () => {
  it('formata data como DD/MM/AAAA (UTC)', () => {
    expect(formatDataIxc(new Date(Date.UTC(2026, 6, 21)))).toBe('21/07/2026');
    expect(formatDataIxc(new Date(Date.UTC(2025, 0, 5)))).toBe('05/01/2025');
  });
  it('formata valor com 2 casas e ponto decimal', () => {
    expect(formatValorIxc(1234.5)).toBe('1234.50');
    expect(formatValorIxc(1270.8)).toBe('1270.80');
    expect(formatValorIxc(0.1 + 0.2)).toBe('0.30');
  });
});

describe('buildContaPagarPayload', () => {
  it('mapeia conta de pagamento, conta contábil, filial e datas', () => {
    const hoje = new Date(Date.UTC(2026, 6, 21));
    const body = buildContaPagarPayload({
      idFornecedor: 55,
      valor: 1270.8,
      contaPagamentoId: 18,
      contaContabilId: 2420,
      filialId: 1,
      dataEmissao: hoje,
      dataVencimento: hoje,
      observacao: 'saldo salarial referente ao mês 07/2026',
    });
    expect(body).toMatchObject({
      id_fornecedor: '55',
      id_contas: '18', // conta de pagamento
      id_conta: '2420', // conta contábil
      filial_id: '1',
      valor: '1270.80',
      data_emissao: '21/07/2026',
      data_vencimento: '21/07/2026',
      // Regime de caixa, como a tela do IXC grava.
      previsao: 'S',
      // A tela grava os dois; vazio não é `N`, e é a busca pelos não
      // comunicados que lista o pagamento na conciliação.
      comunicado: 'N',
      eh_despesa_veiculo: 'N',
      liberado: 'S',
      obs: 'saldo salarial referente ao mês 07/2026',
      tipo_pagamento: 'Pix', // padrão quando não informado
      chave_pix: '',
      tipo_pix: '',
    });
  });

  it('envia chave PIX e tipo de pagamento quando informados', () => {
    const hoje = new Date(Date.UTC(2026, 6, 21));
    const body = buildContaPagarPayload({
      idFornecedor: 55,
      valor: 500,
      contaPagamentoId: 18,
      contaContabilId: 2662,
      filialId: 1,
      dataEmissao: hoje,
      dataVencimento: hoje,
      observacao: 'adiantamento',
      tipoPagamento: 'Pix',
      chavePix: 'henrico@pix.com',
    });
    expect(body).toMatchObject({
      tipo_pagamento: 'Pix',
      chave_pix: 'henrico@pix.com',
      tipo_pix: 'EMAIL',
      id_conta: '2662',
    });
  });

  // O fn_apagar recusa a chave reescrita em +55: o celular vai com a máscara
  // do cadastro, que é o que a tela do IXC aceita.
  it('manda o celular exatamente como está no cadastro', () => {
    const hoje = new Date(Date.UTC(2026, 6, 21));
    const body = buildContaPagarPayload({
      idFornecedor: 55,
      valor: 500,
      contaPagamentoId: 18,
      contaContabilId: 2420,
      filialId: 1,
      dataEmissao: hoje,
      dataVencimento: hoje,
      observacao: 'saldo salarial',
      chavePix: '(99) 98107-4450',
    });
    expect(body).toMatchObject({
      tipo_pix: 'CELULAR',
      chave_pix: '(99) 98107-4450',
    });
  });
});

describe('tipo da chave PIX vindo do cadastro', () => {
  const hoje = new Date(Date.UTC(2026, 6, 21));
  const base = {
    idFornecedor: 55,
    valor: 500,
    contaPagamentoId: 18,
    contaContabilId: 2420,
    filialId: 1,
    dataEmissao: hoje,
    dataVencimento: hoje,
    observacao: 'saldo salarial',
  };

  it('marca o tipo preferencial do fornecedor em vez de deduzir', () => {
    // Chave de 11 dígitos que o formato leria como CPF: o cadastro diz Celular.
    const body = buildContaPagarPayload({
      ...base,
      chavePix: '75981074450',
      tipoChavePix: 'Celular',
    });
    expect(body).toMatchObject({
      tipo_pix: 'CELULAR',
      chave_pix: '75981074450',
    });
  });

  it('sem tipo no cadastro, continua deduzindo pelo formato', () => {
    const body = buildContaPagarPayload({ ...base, chavePix: 'ana@pix.com' });
    expect(body).toMatchObject({ tipo_pix: 'EMAIL' });
  });

  it('usa a coluna e o código aprendidos desta base do IXC', () => {
    const body = buildContaPagarPayload({
      ...base,
      chavePix: 'ana@pix.com',
      mapaTipoChave: {
        campo: 'pix_tipo',
        codigos: { 'E-mail': 'E', Celular: 'C' },
      },
    });
    expect(body).toMatchObject({ pix_tipo: 'E' });
    // A coluna do palpite antigo não vai junto: quem manda é a aprendida.
    expect('tipo_chave_pix' in body).toBe(false);
  });

  it('tipo sem código aprendido cai no rótulo, na coluna certa', () => {
    const body = buildContaPagarPayload({
      ...base,
      chavePix: 'ana@pix.com',
      mapaTipoChave: { campo: 'pix_tipo', codigos: { Celular: 'C' } },
    });
    expect(body).toMatchObject({ pix_tipo: 'E-mail' });
  });

  /*
   * Aprende-se um tipo de cada conta que já existe no IXC, então uma base onde
   * ninguém nunca pagou por chave aleatória não tem de onde ensinar essa. Foi o
   * que travou um lançamento em 18/08/2026: o mapa sabia CPF/CNPJ, celular,
   * e-mail e copia-e-cola, a conta ia com chave aleatória, e o rótulo acentuado
   * voltou como "Tipo da chave Pix inválido!".
   */
  it('tipo que faltou no aprendizado usa o código conhecido, na coluna conhecida', () => {
    const body = buildContaPagarPayload({
      ...base,
      chavePix: '8e2b1f4a-3c7d-4e51-9a06-b2f8d1c47e93',
      mapaTipoChave: {
        campo: 'tipo_pix',
        codigos: {
          'CPF/CNPJ': 'CPF_CNPJ',
          Celular: 'CELULAR',
          'E-mail': 'EMAIL',
          'Código copia e cola': 'COPIA_E_COLA',
        },
      },
    });
    expect(body).toMatchObject({ tipo_pix: 'ALEATORIA' });
  });

  it('o que o aprendizado sabe continua mandando sobre o código conhecido', () => {
    const body = buildContaPagarPayload({
      ...base,
      chavePix: 'ana@pix.com',
      mapaTipoChave: { campo: 'tipo_pix', codigos: { 'E-mail': 'E' } },
    });
    expect(body).toMatchObject({ tipo_pix: 'E' });
  });
});

/**
 * O rádio "Tipo da chave Pix" em branco trava o pagamento — o banco recusa PIX
 * sem o tipo. Como o nome da coluna e o código variam por base do IXC, isto é
 * aprendido das contas que já existem lá, feitas na tela.
 */
describe('aprenderTipoChavePix', () => {
  it('aprende a coluna e o código de cada tipo pelas contas existentes', () => {
    const mapa = aprenderTipoChavePix([
      { id: '1', chave_pix: '+5599984631517', tipo_chave_pix_apagar: 'C' },
      { id: '2', chave_pix: 'ana@pix.com', tipo_chave_pix_apagar: 'E' },
      { id: '3', chave_pix: '', tipo_chave_pix_apagar: '' },
    ]);
    expect(mapa).toEqual({
      campo: 'tipo_chave_pix_apagar',
      codigos: { Celular: 'C', 'E-mail': 'E' },
    });
  });

  it('descarta coluna que se contradiz: não é a coluna do tipo', () => {
    // `pix_tipo_qualquer` dá dois códigos para celular — não serve.
    const mapa = aprenderTipoChavePix([
      { id: '1', chave_pix: '+5599984631517', pix_tipo_qualquer: 'X' },
      { id: '2', chave_pix: '+5575981074450', pix_tipo_qualquer: 'Y' },
    ]);
    expect(mapa).toBeNull();
  });

  it('nunca confunde a coluna da chave com a do tipo', () => {
    const mapa = aprenderTipoChavePix([
      { id: '1', chave_pix: 'ana@pix.com', tipo_chave_pix: 'E-mail' },
    ]);
    expect(mapa?.campo).toBe('tipo_chave_pix');
  });

  it('sem conta antiga com PIX, não inventa nada', () => {
    expect(aprenderTipoChavePix([{ id: '1', chave_pix: '' }])).toBeNull();
    expect(aprenderTipoChavePix([])).toBeNull();
  });

  it('prefere a coluna que explica mais tipos', () => {
    const mapa = aprenderTipoChavePix([
      { id: '1', chave_pix: '+5599984631517', pix_tipo: 'C', tipo_pix_2: '1' },
      { id: '2', chave_pix: 'ana@pix.com', pix_tipo: 'E' },
    ]);
    expect(mapa?.campo).toBe('pix_tipo');
  });
});

describe('parseCodigosTipoChavePix', () => {
  it('lê o mapeamento informado à mão', () => {
    expect(parseCodigosTipoChavePix('Celular=C, E-mail=E,CPF/CNPJ=D')).toEqual({
      Celular: 'C',
      'E-mail': 'E',
      'CPF/CNPJ': 'D',
    });
  });

  it('ignora lixo e entradas sem código', () => {
    expect(parseCodigosTipoChavePix('Celular=,=X,,xyz')).toEqual({});
    expect(parseCodigosTipoChavePix('')).toEqual({});
    expect(parseCodigosTipoChavePix(null)).toEqual({});
  });
});

describe('normalizarTipoChavePix', () => {
  it('entende o rótulo e o nome da coluna', () => {
    expect(normalizarTipoChavePix('Celular')).toBe('Celular');
    expect(normalizarTipoChavePix('pix_celular')).toBe('Celular');
    expect(normalizarTipoChavePix('E-mail')).toBe('E-mail');
    expect(normalizarTipoChavePix('pix_email')).toBe('E-mail');
    expect(normalizarTipoChavePix('CPF/CNPJ')).toBe('CPF/CNPJ');
    expect(normalizarTipoChavePix('Chave aleatória')).toBe('Aleatória');
  });

  it('não chuta em código de uma letra nem em valor vazio', () => {
    expect(normalizarTipoChavePix('C')).toBeNull();
    expect(normalizarTipoChavePix('')).toBeNull();
    expect(normalizarTipoChavePix(null)).toBeNull();
    expect(normalizarTipoChavePix('outro')).toBeNull();
  });
});

describe('inferirTipoChavePix', () => {
  it('distingue celular de CPF (ambos com 11 dígitos)', () => {
    expect(inferirTipoChavePix('(99) 98107-4450')).toBe('Celular');
    expect(inferirTipoChavePix('99981074450')).toBe('Celular');
    expect(inferirTipoChavePix('082.935.753-01')).toBe('CPF/CNPJ');
    expect(inferirTipoChavePix('638.302.843-06')).toBe('CPF/CNPJ');
  });

  it('reconhece e-mail, CNPJ, aleatória e telefone com DDI', () => {
    expect(inferirTipoChavePix('ana@pix.com')).toBe('E-mail');
    expect(inferirTipoChavePix('12.345.678/0001-00')).toBe('CPF/CNPJ');
    expect(inferirTipoChavePix('+55 99 98107-4450')).toBe('Celular');
    expect(
      inferirTipoChavePix('3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
    ).toBe('Aleatória');
  });

  it('a chave aleatória sem hífen também é aleatória', () => {
    // Alguns bancos mostram os 32 caracteres corridos, e é assim que a pessoa
    // copia. Sem reconhecer, o rádio ia em branco e o banco não pagava.
    expect(inferirTipoChavePix('3f2504e04f8911d39a0c0305e82c3301')).toBe(
      'Aleatória',
    );
  });

  it('sem chave, sem tipo', () => {
    expect(inferirTipoChavePix('')).toBeNull();
    expect(inferirTipoChavePix(null)).toBeNull();
  });
});

/**
 * O rádio "Tipo da chave Pix" pode ir em duas colunas.
 *
 * A coluna certa é aprendida da própria base, e o aprendizado pode apontar
 * outra que não seja a que a tela lê — aí o IXC grava calado, o rádio fica em
 * branco e o banco não paga. Mandando também a coluna conhecida, o pior caso
 * vira um campo ignorado em vez de um pagamento parado.
 */
describe('camposDoTipoChavePix', () => {
  it('coluna conhecida: vai uma só', () => {
    expect(camposDoTipoChavePix('CPF/CNPJ', null)).toEqual({
      tipo_pix: 'CPF_CNPJ',
    });
  });

  it('coluna aprendida diferente: vão as duas', () => {
    const campos = camposDoTipoChavePix('CPF/CNPJ', {
      campo: 'pix_tipo_chave',
      codigos: { 'CPF/CNPJ': '1' },
    });

    expect(campos).toEqual({ pix_tipo_chave: '1', tipo_pix: 'CPF_CNPJ' });
  });

  it('na mesma coluna, o aprendido manda — ele veio desta base', () => {
    const campos = camposDoTipoChavePix('Celular', {
      campo: 'tipo_pix',
      codigos: { Celular: 'CEL' },
    });

    expect(campos).toEqual({ tipo_pix: 'CEL' });
  });

  it('sem tipo, a coluna vai vazia e nenhuma outra é inventada', () => {
    expect(camposDoTipoChavePix(null, null)).toEqual({ tipo_pix: '' });
  });
});

describe('buildAuditoriaPayload', () => {
  it('monta aprovação (A) com id do fn_apagar', () => {
    const body = buildAuditoriaPayload({
      idFnApagar: 3000,
      status: 'A',
      motivo: 'Aprovado via app',
    });
    expect(body).toMatchObject({
      status: 'A',
      id_fn_apagar: '3000',
      tipo: 'E',
      motivo: 'Aprovado via app',
    });
  });
});

describe('buildFornecedorPayload', () => {
  it('cria pessoa física por padrão com cidade obrigatória', () => {
    const body = buildFornecedorPayload({ nome: 'João Patrocínio', cidadeId: 1 });
    expect(body).toMatchObject({
      ativo: 'S',
      tipo_pessoa: 'F',
      razao: 'João Patrocínio',
      cidade: '1',
    });
  });
});

describe('lerSituacaoContaPagar', () => {
  it('detecta pago quando há data de pagamento', () => {
    const s = lerSituacaoContaPagar({
      valor: '1000.00',
      valor_aberto: '0.00',
      valor_total_pago: '1000.00',
      data_pagamento: '2026-07-21',
      status_auditoria: 'A',
    });
    expect(s.pago).toBe(true);
    expect(s.statusAuditoria).toBe('A');
  });
  it('não considera pago quando ainda há valor aberto', () => {
    const s = lerSituacaoContaPagar({
      valor: '1000.00',
      valor_aberto: '1000.00',
      valor_total_pago: '0',
      status_auditoria: '',
    });
    expect(s.pago).toBe(false);
    expect(s.statusAuditoria).toBeNull();
  });

  it('lê a reprovação feita na tela do IXC', () => {
    const s = lerSituacaoContaPagar({
      valor: '1000.00',
      valor_aberto: '1000.00',
      status: 'A', // aberto, não é "aprovado"
      status_auditoria: 'R',
    });
    expect(s.pago).toBe(false);
    expect(s.cancelada).toBe(false);
    expect(s.statusAuditoria).toBe('R');
  });

  it('detecta conta cancelada no IXC', () => {
    const s = lerSituacaoContaPagar({ valor: '1000.00', status: 'C' });
    expect(s.cancelada).toBe(true);
    expect(s.pago).toBe(false);
  });
});

describe('lerStatusAuditoria', () => {
  it('lê os nomes de campo conhecidos', () => {
    expect(lerStatusAuditoria({ status_auditoria: 'r' })).toBe('R');
    expect(lerStatusAuditoria({ auditoria: 'A' })).toBe('A');
    expect(lerStatusAuditoria({ status_aud: 'C' })).toBe('C');
  });

  it('aceita o rótulo em vez do código', () => {
    expect(lerStatusAuditoria({ status_auditoria: 'Reprovado' })).toBe('R');
    expect(lerStatusAuditoria({ status_auditoria: 'Aprovada' })).toBe('A');
  });

  it('acha qualquer campo com "audit" no nome', () => {
    expect(lerStatusAuditoria({ fn_auditoria_status: 'R' })).toBe('R');
  });

  it('ignora campos de auditoria que não são o status', () => {
    expect(
      lerStatusAuditoria({ data_auditoria: '2026-07-21', id_auditoria: '9' }),
    ).toBeNull();
  });

  it('não confunde o status da conta com o da auditoria', () => {
    // fn_apagar.status = A significa "aberto".
    expect(lerStatusAuditoria({ status: 'A' })).toBeNull();
  });
});

describe('serializarCodigosTipoChavePix', () => {
  it('escreve no mesmo formato que o parse lê (ida e volta)', () => {
    const codigos = {
      Celular: 'C',
      'E-mail': 'E',
      'CPF/CNPJ': 'D',
      Aleatória: 'A',
    } as const;
    const texto = serializarCodigosTipoChavePix(codigos);
    expect(texto).toBe('CPF/CNPJ=D,Celular=C,E-mail=E,Aleatória=A');
    expect(parseCodigosTipoChavePix(texto)).toEqual(codigos);
  });

  it('nada aprendido vira texto vazio', () => {
    expect(serializarCodigosTipoChavePix({})).toBe('');
  });
});
