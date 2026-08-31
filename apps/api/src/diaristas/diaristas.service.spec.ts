import {
  FormaPagamento,
  StatusContaPagar,
  TipoLancamento,
} from '@prisma/client';
import { DiaristasService } from './diaristas.service';

/**
 * O que importa aqui: dinheiro entregue na mão nunca se perde. Se o caixa do
 * IXC não aceitar (ou nem for encontrado), a diária tem de ficar registrada
 * com o motivo — nunca sumir porque o IXC não respondeu.
 */
const DIARISTA = {
  id: 'd1',
  nome: 'João da Silva',
  cpfCnpj: null,
  telefone: null,
  chavePix: 'joao@pix',
  tipoChavePix: null,
  valorDiaria: 120,
  formaPagamento: FormaPagamento.IXC,
  observacoes: null,
  ativo: true,
  idFornecedorIxc: null,
  cidadeIxc: null,
};

const CFG = {
  contaPagamentoCaixaId: 23,
  caixaEmMaosId: 0,
  caixaEmMaosNome: 'CX - Werick',
  caixaTabelaContas: '',
  caixaTabelaMovimento: '',
};

function montarServico(
  opts: {
    /** null = o app não achou o caixa no IXC. */
    caixaId?: number | null;
    /** Erro devolvido pelo lançamento no caixa. */
    erroLancamento?: string;
    avisoLancamento?: string;
    /** O IXC recusou criar o fornecedor do cadastro novo. */
    erroFornecedor?: string;
    /** O fornecedor já existia lá com aquele CPF. */
    fornecedorReaproveitado?: boolean;
    /** Por que a chave PIX não foi para a aba "Dados bancários". */
    motivoEspelhoPix?: string;
    /** O IXC não devolveu número para a conta criada. */
    contaSemNumeroIxc?: boolean;
    /** O que a baixa da conta em mãos devolve — ou o erro que ela levanta. */
    erroDaBaixa?: string;
    baixaNaoPagou?: boolean;
  } = {},
) {
  const diarias = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const prisma = {
    diarista: {
      findUnique: jest.fn().mockResolvedValue(DIARISTA),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...DIARISTA,
        ...data,
      })),
      update: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...DIARISTA,
          ...data,
        }),
      ),
    },
    diaria: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `di${++seq}`;
        const registro = { id, ...data };
        diarias.set(id, registro);
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
          const atual = { ...diarias.get(where.id), ...data };
          diarias.set(where.id, atual);
          return atual;
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        diarias.get(where.id) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const d = diarias.get(where.id);
        if (!d) throw new Error(`diária ${where.id} não existe`);
        return d;
      }),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(async ({ where }: { where: { id: string } }) => {
        const existia = diarias.delete(where.id);
        return { count: existia ? 1 : 0 };
      }),
    },
  } as any;

  const config = { obter: jest.fn().mockResolvedValue(CFG) } as any;

  const contasPagar = {
    criar: jest.fn().mockResolvedValue([
      {
        id: 'conta-1',
        // O número que o IXC devolve ao criar o título. Sem ele não há o que
        // baixar, que é um dos caminhos que este arquivo cobre.
        idFnApagarIxc: opts.contaSemNumeroIxc ? null : 9001,
        contaPagamento: CFG.contaPagamentoCaixaId,
      },
    ]),
    remover: jest.fn().mockResolvedValue(undefined),
    sincronizarStatus: jest.fn().mockResolvedValue(undefined),
  } as any;

  const pagar = jest.fn(async () => {
    if (opts.erroDaBaixa) throw new Error(opts.erroDaBaixa);
    return {
      idFnApagar: 9001,
      aprovada: true,
      paga: !opts.baixaNaoPagou,
      valor: 120,
      contaPagamento: CFG.contaPagamentoCaixaId,
      aguardandoBanco: false,
      avisos: [],
    };
  });
  const pagamentos = { pagar } as any;

  const lancarSaida = jest.fn(async () => {
    if (opts.erroLancamento) throw new Error(opts.erroLancamento);
    return { tabela: 'fn_lancamento_caixa', id: 900, aviso: opts.avisoLancamento };
  });
  const caixa = {
    resolverCaixa: jest
      .fn()
      .mockResolvedValue(opts.caixaId === undefined ? 27 : opts.caixaId),
    lancarSaida,
  } as any;

  /**
   * Uma diária do tempo em que "em mãos" escrevia direto na movimentação
   * financeira: sem conta a pagar, pendente no caixa. É o que ainda existe no
   * banco e precisa continuar sendo fechável.
   */
  async function diariaAntigaEmMaos(): Promise<string> {
    const { id } = await prisma.diaria.create({
      data: {
        diaristaId: 'd1',
        data: new Date(Date.UTC(2026, 7, 10)),
        quantidade: 1,
        valorDiaria: 120,
        valor: 120,
        vendas: 0,
        valorPorVenda: null,
        comissaoVendas: 0,
        valorExtra: 0,
        descricaoExtra: null,
        descricao: 'Roçada',
        forma: FormaPagamento.EM_MAOS,
        caixaIxc: 27,
        erroIxc: 'tabela não encontrada',
      },
    });
    return id as string;
  }

  const vincularDiarista = jest.fn(async () => {
    if (opts.erroFornecedor) throw new Error(opts.erroFornecedor);
    return {
      idFornecedor: 55,
      reaproveitado: opts.fornecedorReaproveitado ?? false,
      marcadoComoDiarista: !opts.fornecedorReaproveitado,
    };
  });
  const espelharPixNoIxc = jest.fn(
    async () => opts.motivoEspelhoPix ?? null,
  );
  const fornecedores = { vincularDiarista, espelharPixNoIxc };

  return {
    service: new DiaristasService(
      prisma,
      config,
      contasPagar,
      pagamentos,
      caixa,
      fornecedores as never,
    ),
    contasPagar,
    pagar,
    lancarSaida,
    prisma,
    diariaAntigaEmMaos,
    vincularDiarista,
    espelharPixNoIxc,
  };
}

/**
 * Em mãos, a conta nasce e morre no mesmo gesto.
 *
 * O dinheiro saiu da gaveta antes de o título existir e o diarista foi embora
 * com ele: não há banco a esperar, nem decisão a tomar. Uma conta em aberto no
 * IXC depois disso não guarda decisão nenhuma — guarda uma tarefa que alguém
 * vai ter de lembrar de fazer, no meio das contas que ainda esperam dinheiro
 * de verdade.
 */
describe('diária paga em mãos quita no ato', () => {
  it('aprova e dá baixa na conta, no dia da diária', async () => {
    const { service, pagar, contasPagar } = montarServico();

    await service.pagar(
      'd1',
      {
        data: '2026-08-14',
        quantidade: 1,
        descricao: 'Roçada',
        forma: FormaPagamento.EM_MAOS,
      },
      'user-1',
    );

    expect(pagar).toHaveBeenCalledWith(9001, {
      contaPagamento: CFG.contaPagamentoCaixaId,
      // O dia da diária, e não o de hoje: é quando a gaveta abriu.
      data: '2026-08-14',
      // Não há banco a esperar quando o pagamento aconteceu antes do título.
      jaSaiu: true,
    });
    // O status daqui vem de lá, relido depois da baixa.
    expect(contasPagar.sincronizarStatus).toHaveBeenCalledWith('conta-1');
  });

  it('paga pelo banco não é baixada aqui: o banco ainda tem de pagar', async () => {
    const { service, pagar, contasPagar } = montarServico();

    await service.pagar(
      'd1',
      { quantidade: 1, descricao: 'Roçada', forma: FormaPagamento.IXC },
      'user-1',
    );

    expect(pagar).not.toHaveBeenCalled();
    expect(contasPagar.sincronizarStatus).not.toHaveBeenCalled();
  });

  /*
   * O dinheiro já saiu. Negar o registro seria negar o fato — então a diária
   * fica gravada de todo jeito, e a conta fica em aberto no IXC, que é onde a
   * tela mostra "aguardando" e onde dá para terminar à mão.
   */
  it('baixa que falha não derruba a diária', async () => {
    const { service } = montarServico({ erroDaBaixa: 'IXC fora do ar' });

    const diaria = await service.pagar(
      'd1',
      { quantidade: 1, descricao: 'Roçada', forma: FormaPagamento.EM_MAOS },
      'user-1',
    );

    expect(diaria).toMatchObject({ contaPagarId: 'conta-1' });
  });

  it('conta sem número do IXC não tenta baixa nenhuma', async () => {
    const { service, pagar } = montarServico({ contaSemNumeroIxc: true });

    const diaria = await service.pagar(
      'd1',
      { quantidade: 1, descricao: 'Roçada', forma: FormaPagamento.EM_MAOS },
      'user-1',
    );

    expect(pagar).not.toHaveBeenCalled();
    expect(diaria).toMatchObject({ contaPagarId: 'conta-1' });
  });
});

describe('pagar pelo IXC', () => {
  it('vira conta a pagar de diária, com a observação montada', async () => {
    const { service, contasPagar } = montarServico();

    const diaria = await service.pagar(
      'd1',
      {
        quantidade: 2,
        descricao: 'Pintura do galpão',
        forma: FormaPagamento.IXC,
      },
      'user-1',
    );

    expect(contasPagar.criar).toHaveBeenCalledWith(
      {
        itens: [
          {
            diaristaId: 'd1',
            tipo: TipoLancamento.DIARIA,
            valor: 240,
            observacao: 'Pintura do galpão (2 diárias de R$ 120,00)',
          },
        ],
      },
      'user-1',
    );
    expect(diaria).toMatchObject({ contaPagarId: 'conta-1' });
  });

  it('usa o valor da diária do cadastro quando não vem na tela', async () => {
    const { service, contasPagar } = montarServico();
    await service.pagar('d1', { descricao: 'Capina' });
    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(120);
  });

  /**
   * O diarista também é vendedor externo, e às vezes fez um serviço por fora no
   * mesmo acerto. Sai um pagamento só — é assim que ele recebe.
   */
  it('diárias, comissão de venda e extra viram um pagamento só', async () => {
    const { service, contasPagar } = montarServico();

    const diaria = await service.pagar('d1', {
      quantidade: 2,
      valorDiaria: 140,
      vendas: 3,
      valorPorVenda: 50,
      valorExtra: 80,
      descricaoExtra: 'instalação',
      descricao: 'Acerto da semana',
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0]).toMatchObject({
      valor: 510,
      observacao:
        'Acerto da semana (2 diárias de R$ 140,00 · 3 vendas de R$ 50,00 = ' +
        'R$ 150,00 · extra R$ 80,00: instalação)',
    });
    expect(Number((diaria as { comissaoVendas: unknown }).comissaoVendas)).toBe(
      150,
    );
  });

  /** Semana só de venda: não houve dia trabalhado para cobrar. */
  it('paga um acerto que é só de comissão', async () => {
    const { service, contasPagar } = montarServico();
    await service.pagar('d1', {
      quantidade: 0,
      vendas: 4,
      valorPorVenda: 50,
      descricao: 'Vendas da semana',
    });
    expect(contasPagar.criar.mock.calls[0][0].itens[0].valor).toBe(200);
  });

  it('recusa o pagamento que ficou em zero', async () => {
    const { service, contasPagar } = montarServico();
    await expect(
      service.pagar('d1', { quantidade: 0, descricao: 'Nada' }),
    ).rejects.toThrow(/zero/i);
    expect(contasPagar.criar).not.toHaveBeenCalled();
  });

  /**
   * A chave recusada pelo IXC se acerta na hora de pagar. Como é o cadastro que
   * alimenta a conta a pagar, o acerto tem de ficar gravado — senão o próximo
   * pagamento repete o mesmo erro.
   */
  it('grava no cadastro a chave PIX corrigida na hora', async () => {
    const { service, prisma } = montarServico();

    await service.pagar('d1', {
      descricao: 'Capina',
      chavePix: '(99) 99230-0993',
      tipoChavePix: 'Celular',
    });

    expect(prisma.diarista.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { chavePix: '(99) 99230-0993', tipoChavePix: 'Celular' },
    });
  });

  it('chave igual à do cadastro não mexe no cadastro', async () => {
    const { service, prisma } = montarServico();
    await service.pagar('d1', { descricao: 'Capina', chavePix: 'joao@pix' });
    expect(prisma.diarista.update).not.toHaveBeenCalled();
  });
});

/**
 * Pagar em mãos é a mesma conta a pagar de sempre: muda a conta de onde o
 * dinheiro sai (o caixa, 23, em vez do banco, 18) e o tipo de pagamento.
 *
 * O caminho antigo — escrever direto na movimentação financeira do IXC —
 * dependia de uma tabela que não está na documentação do webservice e não
 * existe nesta base. Diária nova nenhuma passa por ele.
 */
describe('pagar em mãos', () => {
  it('vira conta a pagar na conta do caixa, em dinheiro', async () => {
    const { service, contasPagar, lancarSaida } = montarServico();

    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamento.EM_MAOS,
    });

    expect(contasPagar.criar.mock.calls[0][0].itens[0]).toMatchObject({
      diaristaId: 'd1',
      valor: 120,
      contaPagamento: 23,
      tipoPagamentoIxc: 'Dinheiro',
      observacao: 'Roçada (1 diária de R$ 120,00)',
    });
    expect(diaria).toMatchObject({ contaPagarId: 'conta-1' });
    expect(lancarSaida).not.toHaveBeenCalled();
  });

  /** Pelo banco continua na conta de pagamento padrão, sem tipo próprio. */
  it('pelo IXC não mexe na conta de pagamento', async () => {
    const { service, contasPagar } = montarServico();

    await service.pagar('d1', { descricao: 'Capina', forma: FormaPagamento.IXC });

    const item = contasPagar.criar.mock.calls[0][0].itens[0];
    expect(item.contaPagamento).toBeUndefined();
    expect(item.tipoPagamentoIxc).toBeUndefined();
  });

  it('usa a forma habitual do cadastro quando a tela não escolhe', async () => {
    const { service, contasPagar } = montarServico();
    // O cadastro do João é IXC: sem escolha na tela, vai por lá.
    await service.pagar('d1', { descricao: 'Capina' });
    expect(contasPagar.criar.mock.calls[0][0].itens[0].contaPagamento).toBeUndefined();
  });

  /**
   * Se a conta a pagar já sai do caixa, lançar de novo na movimentação
   * financeira tiraria o mesmo dinheiro duas vezes.
   */
  it('não lança no caixa o que já é conta a pagar', async () => {
    const { service } = montarServico();
    const diaria = await service.pagar('d1', {
      descricao: 'Roçada',
      forma: FormaPagamento.EM_MAOS,
    });

    await expect(service.lancarNoCaixa(diaria.id)).rejects.toThrow(/duas vezes/);
    await expect(service.marcarLancadoManual(diaria.id)).rejects.toThrow(
      /não há nada/,
    );
  });
});

/**
 * As diárias em mãos antigas ficaram penduradas fora do caixa. Elas não somem
 * com a mudança — continuam precisando de um jeito de fechar.
 */
describe('diárias antigas: tentar de novo e fechar à mão', () => {
  it('tentar de novo depois de configurar o caixa resolve a pendência', async () => {
    const { service, lancarSaida, diariaAntigaEmMaos } = montarServico();
    const id = await diariaAntigaEmMaos();

    lancarSaida.mockImplementation(async () => ({
      tabela: 'fn_lancamento_caixa',
      id: 901,
      aviso: undefined,
    }));
    const resolvida = await service.lancarNoCaixa(id);
    expect(resolvida).toMatchObject({ idLancamentoIxc: 901, erroIxc: null });
  });

  it('lançado à mão no IXC fecha a pendência sem inventar id', async () => {
    const { service, diariaAntigaEmMaos } = montarServico();
    const id = await diariaAntigaEmMaos();

    const fechada = await service.marcarLancadoManual(id);
    expect(fechada).toMatchObject({ lancadoManual: true, erroIxc: null });
    expect(fechada.idLancamentoIxc).toBeUndefined();
  });

  it('não lança duas vezes a mesma diária', async () => {
    const { service, diariaAntigaEmMaos } = montarServico();
    const id = await diariaAntigaEmMaos();

    await service.lancarNoCaixa(id);
    await expect(service.lancarNoCaixa(id)).rejects.toThrow(/já saiu do caixa/i);
  });

  it('diária já lançada no caixa não é apagada daqui às escondidas', async () => {
    const { service, prisma, diariaAntigaEmMaos } = montarServico();
    const id = await diariaAntigaEmMaos();

    await service.lancarNoCaixa(id);
    await expect(service.removerDiaria(id)).rejects.toThrow(
      /Apague por lá primeiro/i,
    );
    expect(prisma.diaria.delete).not.toHaveBeenCalled();
  });

  /**
   * Apagar a conta a pagar já leva a diária junto (é ela que paga a pessoa),
   * então este caminho passa duas vezes pela mesma exclusão. Não pode estourar
   * na segunda.
   */
  it('apagar diária do IXC apaga também a conta a pagar', async () => {
    const { service, contasPagar, prisma } = montarServico();
    const diaria = await service.pagar('d1', {
      descricao: 'Capina',
      forma: FormaPagamento.IXC,
    });
    await service.removerDiaria(diaria.id);
    expect(contasPagar.remover).toHaveBeenCalledWith('conta-1');
    expect(prisma.diaria.deleteMany).toHaveBeenCalledWith({
      where: { id: diaria.id },
    });
  });
});

/**
 * "Já pago" é o que saiu do bolso, não o que foi tentado. Conta a pagar parada
 * na auditoria — ou recusada pelo IXC — ainda não pagou ninguém, e somá-la ao
 * total faria a tela dizer que o diarista recebeu o que não recebeu.
 */
describe('resumo da listagem', () => {
  function comDiarias(diarias: Array<Record<string, unknown>>) {
    const { service, prisma } = montarServico();
    prisma.diarista.findMany.mockResolvedValue([
      { ...DIARISTA, diarias },
    ]);
    return service.listar();
  }

  const emMaos = (valor: number) => ({
    valor,
    data: new Date(Date.UTC(2026, 7, 10)),
    forma: FormaPagamento.EM_MAOS,
    idLancamentoIxc: 900,
    lancadoManual: false,
    contaPagar: null,
  });

  const peloIxc = (valor: number, status: StatusContaPagar) => ({
    valor,
    data: new Date(Date.UTC(2026, 7, 10)),
    forma: FormaPagamento.IXC,
    idLancamentoIxc: null,
    lancadoManual: false,
    contaPagar: { status },
  });

  it('conta a pagar recusada pelo IXC não entra no total pago', async () => {
    const [r] = await comDiarias([peloIxc(770, StatusContaPagar.ERRO)]);
    expect(r.totalPago).toBe(0);
    expect(r.quantidadePagas).toBe(0);
    expect(r.quantidadeComErro).toBe(1);
    // Mas continua no histórico: o registro existe e precisa de conserto.
    expect(r.quantidadeDiarias).toBe(1);
  });

  it('lançada no IXC e ainda a caminho aparece separada do que já saiu', async () => {
    const [r] = await comDiarias([
      peloIxc(300, StatusContaPagar.AGUARDANDO_APROVACAO),
      peloIxc(200, StatusContaPagar.AGUARDANDO_PAGAMENTO),
    ]);
    expect(r.totalPago).toBe(0);
    expect(r.totalAguardando).toBe(500);
    expect(r.quantidadeAguardando).toBe(2);
  });

  it('o banco confirmou: aí sim entra no total pago', async () => {
    const [r] = await comDiarias([
      peloIxc(140, StatusContaPagar.PAGO),
      peloIxc(770, StatusContaPagar.ERRO),
    ]);
    expect(r.totalPago).toBe(140);
    expect(r.quantidadePagas).toBe(1);
    expect(r.totalAguardando).toBe(0);
  });

  it('em mãos conta como pago na hora — o dinheiro já saiu da gaveta', async () => {
    const [r] = await comDiarias([emMaos(120), emMaos(80)]);
    expect(r.totalPago).toBe(200);
    expect(r.quantidadePagas).toBe(2);
    expect(r.quantidadeAguardando).toBe(0);
  });

  it('reprovada e cancelada não ficam eternamente "a caminho"', async () => {
    const [r] = await comDiarias([
      peloIxc(100, StatusContaPagar.REPROVADO),
      peloIxc(100, StatusContaPagar.CANCELADO),
    ]);
    expect(r.totalPago).toBe(0);
    expect(r.totalAguardando).toBe(0);
    expect(r.quantidadeAguardando).toBe(0);
  });
});

/**
 * Cadastrar aqui tem de deixar a pessoa pronta para receber, e quem paga é o
 * IXC. Mas o IXC não é dono do cadastro: quando ele falha, o que alguém acabou
 * de digitar não pode evaporar junto.
 */
describe('cadastrar diarista', () => {
  const CADASTRO = { nome: 'Antonio Clebes', cpfCnpj: '689.606.330-03' };

  it('cria o fornecedor no IXC, marcado como diarista', async () => {
    const { service, vincularDiarista } = montarServico();

    const r = await service.criar(CADASTRO);

    expect(vincularDiarista).toHaveBeenCalled();
    expect(r.ixc).toMatchObject({
      idFornecedor: 55,
      reaproveitado: false,
      marcadoComoDiarista: true,
      erro: null,
    });
  });

  it('espelha a chave PIX na aba de dados bancários do fornecedor', async () => {
    const { service, espelharPixNoIxc } = montarServico();

    await service.criar(CADASTRO);

    expect(espelharPixNoIxc).toHaveBeenCalledWith(55, 'joao@pix', null);
  });

  /**
   * Vincular a um fornecedor que já existia é mexer em cadastro que não é
   * nosso — pode ser uma empresa fornecedora de verdade. A marcação fica de
   * fora, e a tela avisa.
   */
  it('não marca como diarista o fornecedor que já existia lá', async () => {
    const { service } = montarServico({ fornecedorReaproveitado: true });

    const r = await service.criar(CADASTRO);

    expect(r.ixc.reaproveitado).toBe(true);
    expect(r.ixc.marcadoComoDiarista).toBe(false);
  });

  it('guarda o cadastro mesmo com o IXC fora do ar, e diz por quê', async () => {
    const { service } = montarServico({ erroFornecedor: 'timeout' });

    const r = await service.criar(CADASTRO);

    expect(r.diarista.nome).toBe('Antonio Clebes');
    expect(r.ixc.idFornecedor).toBeNull();
    expect(r.ixc.erro).toBe('timeout');
  });

  /** A chave também vai em cada conta a pagar: falhar aqui é só comodidade. */
  it('não derruba o cadastro quando só o espelho do PIX falha', async () => {
    const { service } = montarServico({
      motivoEspelhoPix: 'tabela de dados bancários não encontrada',
    });

    const r = await service.criar(CADASTRO);

    expect(r.ixc.idFornecedor).toBe(55);
    expect(r.ixc.erro).toBeNull();
    expect(r.ixc.avisoPix).toBe('tabela de dados bancários não encontrada');
  });
});
