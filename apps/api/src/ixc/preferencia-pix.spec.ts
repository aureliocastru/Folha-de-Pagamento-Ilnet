import { aprenderPreferenciaPix } from './ixc.fornecedor';

/**
 * A aba "Dados bancários" do fornecedor tem três coisas que decidem se o
 * dinheiro sai: a caixa "Pagar preferencialmente nesta conta", o rádio
 * obrigatório "Pagar preferencialmente por" e o "Tipo de Pix preferencial".
 *
 * Os códigos de cada uma variam por instalação e não estão documentados, então
 * são aprendidos das linhas que já estão configuradas assim — chutar deixaria
 * um rádio obrigatório com lixo, e o banco recusa o pagamento do mesmo jeito
 * que recusaria com ele em branco.
 */
describe('aprender a preferência de pagamento por PIX', () => {
  /** Como as linhas do grid aparecem nesta base. */
  const linha = (over: Record<string, unknown> = {}) => ({
    id: '1',
    id_fornecedor: '188',
    padrao: 'N',
    forma_pagamento: 'B',
    tipo_pix_preferencial: '',
    pix_celular: '',
    pix_email: '',
    pix_cpf_cnpj: '',
    ...over,
  });

  it('copia o código de "Pix" de quem já paga por PIX', () => {
    const r = aprenderPreferenciaPix([
      linha({ id: '1', forma_pagamento: 'B' }),
      linha({
        id: '2',
        padrao: 'S',
        forma_pagamento: 'P',
        pix_celular: '(99) 99230-0993',
        tipo_pix_preferencial: 'Celular',
      }),
      linha({
        id: '3',
        padrao: 'S',
        forma_pagamento: 'P',
        pix_email: 'deda@pix.com',
        tipo_pix_preferencial: 'E-mail',
      }),
    ]);

    expect(r.campos).toEqual({ padrao: 'S', forma_pagamento: 'P' });
    // A chave da própria linha diz que tipo aquele código representa.
    expect(r.codigosTipo).toMatchObject({
      Celular: 'Celular',
      'E-mail': 'E-mail',
    });
  });

  /**
   * "S" é o sim do IXC no cadastro inteiro. Mesmo que a maioria das linhas com
   * PIX esteja com a caixa desmarcada — conta secundária de alguém —, o que se
   * grava é o sim.
   */
  it('marca a caixa com o "S" do IXC, e não com o valor mais repetido', () => {
    const r = aprenderPreferenciaPix([
      linha({ id: '1', padrao: 'N', pix_celular: '(99) 99230-0993' }),
      linha({ id: '2', padrao: 'N', pix_celular: '(99) 98888-7777' }),
      linha({ id: '3', padrao: 'S', pix_email: 'x@y.com' }),
    ]);

    expect(r.campos.padrao).toBe('S');
  });

  /**
   * Base sem ninguém pagando por PIX ainda: não há de onde copiar o código do
   * rádio, e inventar um é pior que deixá-lo em branco — em branco alguém vê e
   * corrige; inventado, parece preenchido e o pagamento é recusado depois.
   */
  it('sem linha com PIX, não inventa o código da forma de pagamento', () => {
    const r = aprenderPreferenciaPix([
      linha({ id: '1' }),
      linha({ id: '2', forma_pagamento: 'B' }),
    ]);

    expect(r.campos.forma_pagamento).toBeUndefined();
    expect(r.codigosTipo).toEqual({});
    // A caixa ainda dá para marcar: o "S" não depende de aprender nada.
    expect(r.campos.padrao).toBe('S');
  });

  /**
   * Base sem essas colunas: grava só a chave, como antes disto existir — e
   * devolve os nomes que ela tem de verdade.
   *
   * É o caso que apareceu na base do cliente: a coluna do "Pagar
   * preferencialmente por" não se chama nada do que o app esperava, e sem os
   * nomes reais a mensagem de erro repetia a recusa do IXC sem ajudar ninguém.
   */
  it('base sem as colunas devolve vazio, mas diz que colunas existem', () => {
    const r = aprenderPreferenciaPix([
      { id: '1', id_fornecedor: '188', pix_celular: '(99) 99230-0993' },
    ]);

    expect(r.campos).toEqual({});
    expect(r.colunas).toEqual(['id', 'id_fornecedor', 'pix_celular']);
  });

  /**
   * O IXC omite da resposta a coluna vazia naquele registro, então uma linha só
   * não descreve a tabela: os nomes saem da união de todas as lidas.
   */
  it('junta as colunas de todas as linhas, não só da primeira', () => {
    const r = aprenderPreferenciaPix([
      { id: '1', id_fornecedor: '188' },
      { id: '2', id_fornecedor: '189', pix_email: 'x@y.com' },
    ]);

    expect(r.colunas).toEqual(['id', 'id_fornecedor', 'pix_email']);
  });

  it('tabela vazia não trava nada', () => {
    expect(aprenderPreferenciaPix([])).toEqual({
      campos: {},
      codigosTipo: {},
      formaDesconhecida: null,
      colunas: [],
    });
  });

  /**
   * Base em que o grid só tem conta de boleto: não há de onde copiar o código
   * de "Pix", e o que sobe na mensagem de erro é o que se viu na coluna. É por
   * essa lista que se descobre, numa ida só, qual daqueles códigos é o certo —
   * o IXC recusa dizendo só "Preencha Pagar preferencialmente por".
   */
  it('não sabendo o código, diz que valores existem na coluna', () => {
    const r = aprenderPreferenciaPix([
      linha({ id: '1', forma_pagamento: 'B' }),
      linha({ id: '2', forma_pagamento: 'T' }),
      linha({ id: '3', forma_pagamento: 'B' }),
    ]);

    expect(r.campos.forma_pagamento).toBeUndefined();
    expect(r.formaDesconhecida).toEqual({
      campo: 'forma_pagamento',
      valores: ['B', 'T'],
    });
  });

  /**
   * Um código que **diz** pix é pix — reconhecer não é inventar. Vale para a
   * base que guarda o rótulo em vez de uma letra.
   */
  it('reconhece o código que se chama "Pix" mesmo sem linha com chave', () => {
    const r = aprenderPreferenciaPix([
      linha({ id: '1', forma_pagamento: 'Boleto' }),
      linha({ id: '2', forma_pagamento: 'PIX' }),
    ]);

    expect(r.campos.forma_pagamento).toBe('PIX');
    expect(r.formaDesconhecida).toBeNull();
  });
});
