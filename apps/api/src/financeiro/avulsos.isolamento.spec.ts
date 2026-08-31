import {
  FormaPagamento,
  OrigemLancamento,
  StatusContaPagar,
} from '@prisma/client';
import { AvulsosService } from './avulsos.service';

/**
 * A divisa entre a folha e o contas a pagar.
 *
 * As duas telas de pagamento avulso são a mesma tela e escrevem nas mesmas
 * tabelas — o que muda é por onde se escolhe quem recebe: a folha lista o
 * cadastro desta casa, o contas a pagar lista os fornecedores do IXC. Sem
 * marca de origem, o que se pagou a um fornecedor entrava no custo da folha do
 * mês, na fatia "Pagamentos avulsos" e na lista de últimos lançamentos — e
 * bagunçava justamente os relatórios que saem dali.
 *
 * O que este arquivo protege:
 *
 *  - cadastro puxado da lista do IXC nasce marcado como do contas a pagar;
 *  - o pagamento e a conta a pagar herdam a origem de quem recebe, e não da
 *    tela — assim não há caminho, nem por engano nem por atalho, que faça um
 *    pagamento do contas a pagar entrar na folha;
 *  - cada listagem enxerga só o seu lado, e quem não diz nada vê o da folha.
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
  origem: OrigemLancamento.FOLHA,
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

const FORNECEDOR_NO_IXC = {
  idFornecedor: 196,
  nome: 'C Carvalho Silva ME',
  cpfCnpj: '12.345.678/0001-90',
  tipoPessoa: 'J',
  telefone: null,
  email: null,
  chavePix: 'carvalho@pix',
  tipoChavePix: null,
  cidadeIxc: 3,
};

function montarServico(opts: { beneficiario?: Record<string, unknown> } = {}) {
  const beneficiario = { ...BENEFICIARIO, ...opts.beneficiario };
  const criados: Record<string, unknown>[] = [];

  const prisma = {
    beneficiarioAvulso: {
      findUnique: jest.fn().mockResolvedValue(beneficiario),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        criados.push(data);
        return { ...beneficiario, ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...beneficiario,
        ...data,
      })),
    },
    pagamentoAvulso: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pa1',
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as any;

  const config = { obter: jest.fn().mockResolvedValue(CFG) } as any;
  const contasPagar = {
    criar: jest
      .fn()
      .mockResolvedValue([
        { id: 'cp1', status: StatusContaPagar.AGUARDANDO_APROVACAO },
      ]),
  } as any;
  const fornecedores = {
    buscarNoIxcPorId: jest.fn().mockResolvedValue(FORNECEDOR_NO_IXC),
    espelharPixNoIxc: jest.fn().mockResolvedValue(null),
  } as any;
  const caixa = {} as any;

  return {
    service: new AvulsosService(prisma, config, contasPagar, fornecedores, caixa),
    prisma,
    contasPagar,
    criados,
  };
}

describe('origem do pagamento avulso', () => {
  it('cadastro puxado da lista do IXC nasce do contas a pagar', async () => {
    const { service, criados } = montarServico();

    await service.garantirBeneficiarioDoIxc(196);

    expect(criados[0].origem).toBe(OrigemLancamento.CONTAS_PAGAR);
  });

  it('pagar quem veio do IXC não gera nada na folha', async () => {
    const { service, prisma, contasPagar } = montarServico({
      beneficiario: {
        origem: OrigemLancamento.CONTAS_PAGAR,
        idFornecedorIxc: 196,
      },
    });

    await service.pagar('b1', { valorServico: 899, descricao: 'serviço' });

    // O pagamento e a conta a pagar que ele gera: os dois marcados, porque é a
    // conta que aparece em "Últimos lançamentos" e soma no custo do mês.
    const [{ data }] = prisma.pagamentoAvulso.create.mock.calls[0];
    expect(data.origem).toBe(OrigemLancamento.CONTAS_PAGAR);

    const [{ itens }] = contasPagar.criar.mock.calls[0];
    expect(itens[0].origem).toBe(OrigemLancamento.CONTAS_PAGAR);
  });

  it('pagar alguém da folha continua sendo da folha', async () => {
    const { service, prisma, contasPagar } = montarServico();

    await service.pagar('b1', { valorServico: 500, descricao: 'pintura' });

    const [{ data }] = prisma.pagamentoAvulso.create.mock.calls[0];
    expect(data.origem).toBe(OrigemLancamento.FOLHA);

    const [{ itens }] = contasPagar.criar.mock.calls[0];
    expect(itens[0].origem).toBe(OrigemLancamento.FOLHA);
  });

  it('sem o módulo, a origem vem do cadastro', async () => {
    // Quem chega por outro caminho — um link antigo, um script — não diz o
    // módulo, e aí quem manda continua sendo de quem é o cadastro. É o que
    // impede um caminho velho de despejar na folha o que é do outro lado.
    const { service, prisma } = montarServico({
      beneficiario: { origem: OrigemLancamento.CONTAS_PAGAR },
    });

    await service.pagar('b1', {
      valorServico: 100,
      descricao: 'por outro caminho',
    });

    const [{ data }] = prisma.pagamentoAvulso.create.mock.calls[0];
    expect(data.origem).toBe(OrigemLancamento.CONTAS_PAGAR);
  });
});

describe('listagens de cada lado', () => {
  it('sem dizer o módulo, a lista é a da folha', async () => {
    const { service, prisma } = montarServico();

    await service.listarBeneficiarios();
    await service.listarPagamentos();

    expect(prisma.beneficiarioAvulso.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.FOLHA }),
    );
    expect(prisma.pagamentoAvulso.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.FOLHA }),
    );
  });

  it('a tela do contas a pagar enxerga o lado dela', async () => {
    const { service, prisma } = montarServico();

    await service.listarBeneficiarios(
      undefined,
      false,
      OrigemLancamento.CONTAS_PAGAR,
    );
    await service.listarPagamentos('b1', OrigemLancamento.CONTAS_PAGAR);

    expect(prisma.beneficiarioAvulso.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ origem: OrigemLancamento.CONTAS_PAGAR }),
    );
    expect(prisma.pagamentoAvulso.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        origem: OrigemLancamento.CONTAS_PAGAR,
        beneficiarioId: 'b1',
      }),
    );
  });
});

/**
 * Quem paga é a tela, quando ela diz quem é.
 *
 * A folha passou a listar os fornecedores do IXC, como o Contas a Pagar já
 * fazia. Pelo desenho antigo — origem sempre do cadastro — todo pagamento feito
 * ali nasceria "do Contas a Pagar", e a comissão de venda paga pela folha
 * sumiria do gráfico de vendas, que só conta pagamento com origem FOLHA.
 *
 * Então a tela pode dizer de onde está pagando. O que ela não pode é a ausência
 * dela mudar alguma coisa: sem módulo, vale o cadastro, como sempre valeu.
 */
describe('o módulo que paga decide a origem', () => {
  it('a folha paga como folha, mesmo quem foi puxado do IXC', async () => {
    const { service, prisma, contasPagar } = montarServico({
      beneficiario: {
        origem: OrigemLancamento.CONTAS_PAGAR,
        idFornecedorIxc: 196,
      },
    });

    await service.pagar(
      'b1',
      { vendas: 3, valorPorVenda: 50, descricao: 'comissão de agosto' },
      undefined,
      OrigemLancamento.FOLHA,
    );

    const [{ data }] = prisma.pagamentoAvulso.create.mock.calls[0];
    expect(data.origem).toBe(OrigemLancamento.FOLHA);
    // A comissão também: é ela que o gráfico de vendas soma.
    expect(Number(data.comissaoVendas)).toBe(150);

    const [{ itens }] = contasPagar.criar.mock.calls[0];
    expect(itens[0].origem).toBe(OrigemLancamento.FOLHA);
  });

  it('o contas a pagar paga como contas a pagar, mesmo quem é da folha', async () => {
    const { service, prisma, contasPagar } = montarServico();

    await service.pagar(
      'b1',
      { valorServico: 500, descricao: 'pintura' },
      undefined,
      OrigemLancamento.CONTAS_PAGAR,
    );

    const [{ data }] = prisma.pagamentoAvulso.create.mock.calls[0];
    expect(data.origem).toBe(OrigemLancamento.CONTAS_PAGAR);

    const [{ itens }] = contasPagar.criar.mock.calls[0];
    expect(itens[0].origem).toBe(OrigemLancamento.CONTAS_PAGAR);
  });

  it('o cadastro puxado do IXC pela folha nasce da folha', async () => {
    const { service, criados } = montarServico();

    await service.garantirBeneficiarioDoIxc(196, OrigemLancamento.FOLHA);

    expect(criados[0].origem).toBe(OrigemLancamento.FOLHA);
  });

  it('o cadastro que já existe não troca de lado ao ser puxado pela outra tela', async () => {
    const { service, prisma, criados } = montarServico();
    // Já puxado antes pelo Contas a Pagar: é o que o `findFirst` acha.
    prisma.beneficiarioAvulso.findFirst.mockResolvedValue({
      ...BENEFICIARIO,
      origem: OrigemLancamento.CONTAS_PAGAR,
      idFornecedorIxc: 196,
    });

    const b = await service.garantirBeneficiarioDoIxc(
      196,
      OrigemLancamento.FOLHA,
    );

    // Trocar a origem aqui o faria sumir da lista do outro módulo no meio de
    // um pagamento. Quem decide o relatório é a origem do pagamento.
    expect(b.origem).toBe(OrigemLancamento.CONTAS_PAGAR);
    expect(criados).toHaveLength(0);
  });
});
