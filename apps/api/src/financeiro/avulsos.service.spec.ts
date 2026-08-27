import { FormaPagamento, StatusContaPagar, TipoLancamento } from '@prisma/client';
import { AvulsosService } from './avulsos.service';

/**
 * Pagamento avulso é mão de obra contratada — quem recebe está esperando o
 * dinheiro. O que este arquivo protege:
 *
 *  - o IXC não recusa o pagamento por falta de chave PIX (o erro que mais
 *    trava, porque o rádio do fn_apagar fica em branco);
 *  - a conta contábil dos avulsos sai da configuração, não de digitação;
 *  - dinheiro entregue na mão nunca se perde, mesmo com o IXC fora do ar;
 *  - "já pago" só conta o que de fato saiu.
 */

const BENEFICIARIO = {
  id: 'b1',
  nome: 'Deda Pedreiro',
  cpfCnpj: '111.222.333-44',
  tipoPessoa: 'F',
  telefone: null,
  email: null,
  chavePix: 'deda@pix',
  tipoChavePix: null,
  formaPagamento: FormaPagamento.IXC,
  observacoes: null,
  ativo: true,
  idFornecedorIxc: null,
  cidadeIxc: null,
  fornecedorNovoNoIxc: false,
};

const CFG = {
  contaContabilAvulso: 324,
  contaPagamentoCaixaId: 23,
  caixaEmMaosId: 0,
  caixaEmMaosNome: 'CX - Werick',
  caixaTabelaContas: '',
  caixaTabelaMovimento: '',
};

function montarServico(
  opts: {
    /** O que muda no cadastro para este caso (ex.: ficar sem chave PIX). */
    beneficiario?: Record<string, unknown>;
    /** null = o app não achou o caixa no IXC. */
    caixaId?: number | null;
    erroLancamento?: string;
    /** Fornecedor que o IXC devolve na consulta por CPF/CNPJ. */
    fornecedorNoIxc?: unknown;
    /** IXC fora do ar na hora de consultar o documento. */
    erroConsulta?: string;
    /** Por que a chave não subiu para os dados bancários do fornecedor. */
    motivoEspelho?: string;
    /** null = o IXC criou a conta mas não devolveu o número do título. */
    idFnApagar?: number | null;
    /** A categoria escolhida não existe mais no cadastro daqui. */
    categoriaSumiu?: boolean;
    /** Por que a etiqueta não pôde ser gravada. */
    erroEtiqueta?: string;
  } = {},
) {
  const beneficiario = { ...BENEFICIARIO, ...opts.beneficiario };
  const pagamentos = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const prisma = {
    beneficiarioAvulso: {
      findUnique: jest.fn().mockResolvedValue(beneficiario),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...beneficiario,
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...beneficiario,
        ...data,
      })),
      delete: jest.fn(),
    },
    pagamentoAvulso: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `pa${++seq}`;
        const registro = { id, ...data };
        pagamentos.set(id, registro);
        return registro;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const atual = { ...pagamentos.get(where.id), ...data };
          pagamentos.set(where.id, atual);
          return atual;
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        pagamentos.get(where.id),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    },
    categoriaDespesa: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        opts.categoriaSumiu ? null : { id: where.id },
      ),
    },
    classificacaoConta: {
      upsert: jest.fn(async () => {
        if (opts.erroEtiqueta) throw new Error(opts.erroEtiqueta);
      }),
    },
  } as any;

  const config = { obter: jest.fn().mockResolvedValue(CFG) } as any;

  const contasPagar = {
    criar: jest.fn().mockResolvedValue([
      {
        id: 'cp1',
        status: StatusContaPagar.AGUARDANDO_APROVACAO,
        // O número do título no IXC: é por ele que a etiqueta se prende.
        idFnApagarIxc: opts.idFnApagar === undefined ? 9001 : opts.idFnApagar,
      },
    ]),
    remover: jest.fn(),
  } as any;

  const fornecedores = {
    procurarNoIxcPorCpfCnpj: jest.fn(async () => {
      if (opts.erroConsulta) throw new Error(opts.erroConsulta);
      return opts.fornecedorNoIxc ?? null;
    }),
    espelharPixNoIxc: jest.fn(async () => opts.motivoEspelho ?? null),
  } as any;

  const caixa = {
    resolverCaixa: jest
      .fn()
      .mockResolvedValue(opts.caixaId === undefined ? 7 : opts.caixaId),
    lancarSaida: jest.fn(async () => {
      if (opts.erroLancamento) throw new Error(opts.erroLancamento);
      return { tabela: 'fn_caixa_mov', id: 555 };
    }),
  } as any;

  return {
    service: new AvulsosService(prisma, config, contasPagar, fornecedores, caixa),
    prisma,
    contasPagar,
    fornecedores,
    caixa,
  };
}

describe('pagamento pelo IXC', () => {
  it('vira conta a pagar com a conta contábil dos avulsos', async () => {
    const { service, contasPagar } = montarServico();

    await service.pagar('b1', {
      valorServico: 500,
      descricao: 'pintura do galpão',
    });

    expect(contasPagar.criar).toHaveBeenCalledWith(
      {
        itens: [
          {
            beneficiarioAvulsoId: 'b1',
            tipo: TipoLancamento.AVULSO,
            valor: 500,
            contaContabil: 324,
            observacao: 'pintura do galpão (serviço R$ 500,00)',
          },
        ],
      },
      undefined,
    );
  });

  it('a conta contábil informada no pagamento vence a da configuração', async () => {
    const { service, contasPagar } = montarServico();

    await service.pagar('b1', {
      valorServico: 500,
      descricao: 'serviço',
      contaContabil: 999,
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0].contaContabil).toBe(999);
  });

  /**
   * Cliente da empresa também vende e comissiona, e às vezes fez um serviço por
   * fora no mesmo acerto. Sai um pagamento só: é assim que a pessoa recebe, e
   * três contas a pagar de R$ 50 entupiriam a auditoria do IXC.
   */
  it('serviço, comissão de venda e extra viram um pagamento só', async () => {
    const { service, contasPagar } = montarServico();

    const pago = await service.pagar('b1', {
      valorServico: 400,
      vendas: 3,
      valorPorVenda: 50,
      valorExtra: 80,
      descricaoExtra: 'instalação',
      descricao: 'acerto de agosto',
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0]).toMatchObject({
      valor: 630,
      observacao:
        'acerto de agosto (serviço R$ 400,00 · 3 vendas de R$ 50,00 = ' +
        'R$ 150,00 · extra R$ 80,00: instalação)',
    });
    // A comissão fica congelada no registro: é dela que sai o "gasto com
    // vendas" do mês, e corrigir o cadastro depois não pode reescrever isso.
    expect(pago).toMatchObject({ vendas: 3, comissaoVendas: expect.anything() });
    expect(Number((pago as { comissaoVendas: unknown }).comissaoVendas)).toBe(150);
  });

  /** Quem só vendeu recebe só a comissão — não há serviço a informar. */
  it('paga um acerto que é só de comissão', async () => {
    const { service, contasPagar } = montarServico();

    await service.pagar('b1', {
      vendas: 4,
      valorPorVenda: 50,
      descricao: 'comissão de agosto',
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(200);
  });

  /** Sem nada informado, o pagamento fecharia em zero e iria ao IXC assim. */
  it('recusa o pagamento que ficou em zero', async () => {
    const { service, contasPagar } = montarServico();

    await expect(
      service.pagar('b1', { vendas: 3, descricao: 'comissão' }),
    ).rejects.toThrow(/zero/i);
    expect(contasPagar.criar).not.toHaveBeenCalled();
  });

  /** O valor por venda combinado no cadastro poupa digitar a cada acerto. */
  it('sem valor por venda na tela, usa o do cadastro', async () => {
    const { service, contasPagar } = montarServico({
      beneficiario: { valorPorVenda: 50 },
    });

    await service.pagar('b1', { vendas: 2, descricao: 'comissão de agosto' });

    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(100);
  });

  /**
   * Sem chave o banco não paga, e a conta a pagar já teria nascido no IXC —
   * sobrando para alguém apagar lá. Barrar antes é mais barato.
   */
  it('recusa antes de criar a conta quando não há chave PIX', async () => {
    const { service, contasPagar } = montarServico({
      beneficiario: { chavePix: null },
    });

    await expect(
      service.pagar('b1', { valorServico: 500, descricao: 'serviço' }),
    ).rejects.toThrow(/chave PIX/i);
    expect(contasPagar.criar).not.toHaveBeenCalled();
  });

  /** A chave digitada na hora de pagar fica no cadastro para a próxima vez. */
  it('grava no cadastro a chave corrigida no pagamento', async () => {
    const { service, prisma } = montarServico({
      beneficiario: { chavePix: 'errada@pix' },
    });

    await service.pagar('b1', {
      valorServico: 100,
      descricao: 'serviço',
      chavePix: 'certa@pix',
      tipoChavePix: 'E-mail',
    });

    expect(prisma.beneficiarioAvulso.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { chavePix: 'certa@pix', tipoChavePix: 'E-mail' },
    });
  });

  /** Em mãos não passa pelo banco: a falta de chave não pode barrar. */
  it('pagar em mãos não exige chave PIX', async () => {
    const { service, contasPagar } = montarServico({
      beneficiario: { chavePix: null },
    });

    const pago = await service.pagar('b1', {
      valorServico: 200,
      descricao: 'serviço',
      forma: FormaPagamento.EM_MAOS,
    });

    expect(pago).toMatchObject({ contaPagarId: 'cp1' });
    // "Dinheiro" é o que faz o fn_apagar não cobrar chave de quem recebeu
    // dinheiro vivo — o payload sai sem chave nenhuma.
    expect(contasPagar.criar.mock.calls[0][0].itens[0]).toMatchObject({
      tipoPagamentoIxc: 'Dinheiro',
    });
  });
});

/**
 * A que se refere o pagamento.
 *
 * A etiqueta é desta casa — o IXC não tem onde recebê-la — e é por ela que o
 * dashboard do Contas a Pagar separa os gastos. O que este bloco protege: ela
 * não depende de a tela lembrar de fazer um segundo pedido, ela se guarda no
 * cadastro de quem recebeu, e quando não dá para gravá-la, alguém fica sabendo.
 */
describe('categoria do pagamento', () => {
  it('etiqueta o título no IXC e vira o padrão de quem recebeu', async () => {
    const { service, prisma } = montarServico();

    const pago = await service.pagar(
      'b1',
      { valorServico: 500, descricao: 'pintura', categoriaId: 'cat-obras' },
      'u9',
    );

    expect(prisma.classificacaoConta.upsert).toHaveBeenCalledWith({
      where: { idFnApagar: 9001 },
      create: {
        idFnApagar: 9001,
        categoriaId: 'cat-obras',
        classificadoPor: 'u9',
      },
      update: { categoriaId: 'cat-obras', classificadoPor: 'u9' },
    });
    expect(prisma.beneficiarioAvulso.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { categoriaId: 'cat-obras' },
    });
    expect(pago.avisoCategoria).toBeNull();
  });

  /** O segundo pagamento não precisa dizer de novo: o cadastro já sabe. */
  it('sem categoria no pedido, vale a do cadastro', async () => {
    const { service, prisma } = montarServico({
      beneficiario: { categoriaId: 'cat-obras' },
    });

    await service.pagar('b1', { valorServico: 500, descricao: 'pintura' });

    expect(prisma.classificacaoConta.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idFnApagar: 9001 } }),
    );
    // Já é o padrão: não há o que regravar no cadastro.
    expect(prisma.beneficiarioAvulso.update).not.toHaveBeenCalled();
  });

  /**
   * O dinheiro já foi. Derrubar o pagamento porque a etiqueta não colou seria
   * trocar um problema de relatório por um de pagamento — mas ninguém pode
   * descobrir isso um mês depois, olhando o gráfico.
   */
  it('título sem número no IXC devolve aviso, e o pagamento fica de pé', async () => {
    const { service } = montarServico({ idFnApagar: null });

    const pago = await service.pagar('b1', {
      valorServico: 500,
      descricao: 'pintura',
      categoriaId: 'cat-obras',
    });

    expect(pago.contaPagarId).toBe('cp1');
    expect(pago.avisoCategoria).toMatch(/não devolveu o número do título/);
  });

  it('etiqueta que falha não derruba o pagamento, mas avisa', async () => {
    const { service } = montarServico({ erroEtiqueta: 'banco fora' });

    const pago = await service.pagar('b1', {
      valorServico: 500,
      descricao: 'pintura',
      categoriaId: 'cat-obras',
    });

    expect(pago.contaPagarId).toBe('cp1');
    expect(pago.avisoCategoria).toMatch(/banco fora/);
  });

  /**
   * Categoria apagada por outra pessoa enquanto a janela estava aberta: melhor
   * recusar aqui, com nada criado ainda, do que descobrir depois de o título já
   * estar no IXC.
   */
  it('categoria que não existe mais barra o pagamento antes de criar a conta', async () => {
    const { service, contasPagar } = montarServico({ categoriaSumiu: true });

    await expect(
      service.pagar('b1', {
        valorServico: 500,
        descricao: 'pintura',
        categoriaId: 'cat-sumida',
      }),
    ).rejects.toThrow(/não existe mais/);
    expect(contasPagar.criar).not.toHaveBeenCalled();
  });
});

/**
 * Pagar em mãos é a mesma conta a pagar de sempre: muda a conta de onde o
 * dinheiro sai (o caixa, 23, em vez do banco, 18) e o tipo de pagamento.
 *
 * O caminho antigo — escrever direto na movimentação financeira do IXC —
 * dependia de uma tabela que não está na documentação do webservice e não
 * existe nesta base. Ninguém mais passa por ele.
 */
describe('pagamento em mãos', () => {
  it('vira conta a pagar na conta do caixa, em dinheiro', async () => {
    const { service, contasPagar } = montarServico();

    const pago = await service.pagar('b1', {
      valorServico: 350,
      descricao: 'carreto',
      forma: FormaPagamento.EM_MAOS,
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0]).toMatchObject({
      beneficiarioAvulsoId: 'b1',
      valor: 350,
      contaPagamento: 23,
      tipoPagamentoIxc: 'Dinheiro',
      observacao: 'carreto (serviço R$ 350,00)',
    });
    expect(pago).toMatchObject({ contaPagarId: 'cp1' });
  });

  /** Pelo banco continua na conta de pagamento padrão, sem tipo próprio. */
  it('pelo IXC não mexe na conta de pagamento', async () => {
    const { service, contasPagar } = montarServico();

    await service.pagar('b1', { valorServico: 350, descricao: 'carreto' });

    const item = contasPagar.criar.mock.calls[0][0].itens[0];
    expect(item.contaPagamento).toBeUndefined();
    expect(item.tipoPagamentoIxc).toBeUndefined();
  });

  /**
   * Se a conta a pagar já sai do caixa, lançar de novo na movimentação
   * financeira tiraria o mesmo dinheiro duas vezes.
   */
  it('não lança no caixa o que já é conta a pagar', async () => {
    const { service, caixa } = montarServico();

    const pago = await service.pagar('b1', {
      valorServico: 350,
      descricao: 'carreto',
      forma: FormaPagamento.EM_MAOS,
    });

    expect(caixa.lancarSaida).not.toHaveBeenCalled();
    await expect(
      service.lancarNoCaixa((pago as { id: string }).id),
    ).rejects.toThrow(/duas vezes/);
    await expect(
      service.marcarLancadoManual((pago as { id: string }).id),
    ).rejects.toThrow(/não há nada/);
  });
});

describe('consulta do CPF/CNPJ', () => {
  /**
   * Reaproveitar o fornecedor é quase sempre o certo — é lá que estão os dados
   * bancários — mas "quase sempre" não é sempre. Quem decide é quem cadastra.
   */
  it('conta o que já existe no IXC para a tela poder perguntar', async () => {
    const { service } = montarServico({
      fornecedorNoIxc: {
        idFornecedor: 42,
        nome: 'DEDA SERVICOS',
        nomeFantasia: null,
        cpfCnpj: '111.222.333-44',
        email: null,
        telefone: null,
        ativo: true,
      },
    });

    const r = await service.consultarCpfCnpj('111.222.333-44');
    expect(r.fornecedor).toMatchObject({ idFornecedor: 42, nome: 'DEDA SERVICOS' });
    expect(r.ixcIndisponivel).toBeNull();
  });

  /** IXC fora do ar não pode travar um cadastro — só avisar. */
  it('IXC fora do ar não impede o cadastro', async () => {
    const { service } = montarServico({ erroConsulta: 'timeout' });

    const r = await service.consultarCpfCnpj('111.222.333-44');
    expect(r.fornecedor).toBeNull();
    expect(r.ixcIndisponivel).toBe('timeout');
  });
});

describe('a chave PIX sobe para o fornecedor no IXC', () => {
  /**
   * É o que faz o próximo pagamento não pedir a chave de novo — e o que deixa
   * a tela de contas a pagar do IXC preencher sozinha quando alguém lançar
   * por lá.
   */
  it('grava nos dados bancários quando o fornecedor já é conhecido', async () => {
    const { service, prisma, fornecedores } = montarServico();
    prisma.beneficiarioAvulso.create.mockResolvedValue({
      ...BENEFICIARIO,
      idFornecedorIxc: 14,
      chavePix: '(99) 99230-0993',
      tipoChavePix: 'Celular',
    });

    const r = await service.criarBeneficiario({ nome: 'Deda Pedreiro' });

    expect(fornecedores.espelharPixNoIxc).toHaveBeenCalledWith(
      14,
      '(99) 99230-0993',
      'Celular',
    );
    expect(r.avisoIxc).toBeNull();
  });

  /** Quem ainda não tem fornecedor ganha um no primeiro pagamento. */
  it('não tenta gravar em quem ainda não tem fornecedor no IXC', async () => {
    const { service, prisma, fornecedores } = montarServico();
    prisma.beneficiarioAvulso.create.mockResolvedValue({
      ...BENEFICIARIO,
      idFornecedorIxc: null,
    });

    await service.criarBeneficiario({ nome: 'Deda Pedreiro' });
    expect(fornecedores.espelharPixNoIxc).not.toHaveBeenCalled();
  });

  /**
   * O cadastro não pode se perder porque o IXC não aceitou a escrita: a chave
   * vale daqui, que é de onde a conta a pagar a tira. Perde-se a comodidade,
   * não o pagamento — e a tela diz o que aconteceu.
   */
  it('o cadastro é salvo mesmo quando a gravação no IXC falha', async () => {
    const { service, prisma } = montarServico({
      motivoEspelho: 'não achei a tabela de dados bancários',
    });
    prisma.beneficiarioAvulso.create.mockResolvedValue({
      ...BENEFICIARIO,
      idFornecedorIxc: 14,
      chavePix: 'deda@pix',
    });

    const r = await service.criarBeneficiario({ nome: 'Deda Pedreiro' });

    expect(r.beneficiario.chavePix).toBe('deda@pix');
    expect(r.avisoIxc).toMatch(/não achei a tabela de dados bancários/);
  });
});

describe('resumo do beneficiário', () => {
  /** Verde só quando o dinheiro saiu: em mãos na hora, pelo IXC no banco. */
  it('separa o que saiu do que ainda está a caminho', async () => {
    const { service, prisma } = montarServico();
    prisma.beneficiarioAvulso.findMany.mockResolvedValue([
      {
        ...BENEFICIARIO,
        pagamentos: [
          {
            valor: 100,
            data: new Date('2026-08-01'),
            forma: FormaPagamento.EM_MAOS,
            idLancamentoIxc: 1,
            lancadoManual: false,
            contaPagar: null,
          },
          {
            valor: 200,
            data: new Date('2026-08-02'),
            forma: FormaPagamento.IXC,
            idLancamentoIxc: null,
            lancadoManual: false,
            contaPagar: { status: StatusContaPagar.PAGO },
          },
          {
            valor: 400,
            data: new Date('2026-08-03'),
            forma: FormaPagamento.IXC,
            idLancamentoIxc: null,
            lancadoManual: false,
            contaPagar: { status: StatusContaPagar.AGUARDANDO_APROVACAO },
          },
          {
            valor: 800,
            data: new Date('2026-08-04'),
            forma: FormaPagamento.IXC,
            idLancamentoIxc: null,
            lancadoManual: false,
            contaPagar: { status: StatusContaPagar.ERRO },
          },
        ],
      },
    ]);

    const [resumo] = await service.listarBeneficiarios();
    expect(resumo).toMatchObject({
      totalPago: 300,
      quantidadePagas: 2,
      totalAguardando: 400,
      quantidadeAguardando: 1,
      quantidadeComErro: 1,
    });
  });
});
