import { BadRequestException } from '@nestjs/common';
import { DespesasService } from './despesas.service';
import type { CriarDespesaDto } from './dto/despesa.dto';

/**
 * A conta lançada à mão vira dívida de verdade no IXC no instante em que se
 * clica. O que este arquivo protege:
 *
 *  - a data que a pessoa escolheu é a data que sai (nada de "hoje" por baixo);
 *  - sem data escolhida, hoje — e em UTC, que é como o resto da base grava;
 *  - a etiqueta é aplicada ao número que o IXC devolveu, não ao id local;
 *  - a etiqueta falhar não derruba o lançamento: a conta já existe lá fora, e
 *    fingir que não existe seria pior que avisar.
 */

const HOJE = new Date('2026-08-15T09:30:00-03:00');

const MOTO = '6f1d2a3b-0000-4000-8000-000000000001';
const VEICULO_SUMIDO = '6f1d2a3b-0000-4000-8000-000000000099';
const CATEGORIA_SUMIDA = 'b3a1c2d4-0000-4000-8000-000000000099';

/** Como o cadastro chama cada um, para a observação que vai ao IXC. */
const APELIDOS: Record<string, string> = {
  [MOTO]: 'Moto',
  '6f1d2a3b-0000-4000-8000-000000000002': 'Strada',
};
const CATEGORIAS: Record<string, string> = {
  'b3a1c2d4-0000-4000-8000-000000000001': 'Peças',
  'b3a1c2d4-0000-4000-8000-000000000002': 'Escritório',
};

function montarServico(
  opts: {
    idFnApagarIxc?: number | null;
    erroAoClassificar?: string;
    /** O IXC recusa a baixa. */
    erroAoPagar?: string;
    /** O IXC aceita a baixa mas não dá a conta por quitada. */
    naoQuita?: boolean;
    /**
     * O que o `fn_apagar_arquivos_download` responde, uma por chamada: um
     * objeto vira JSON; um Buffer é o arquivo cru.
     */
    downloads?: Array<Record<string, unknown> | Buffer>;
    /** Os arquivos que o título tem, como a listagem do IXC os devolve. */
    arquivosDoTitulo?: Array<Record<string, unknown>>;
  } = {},
) {
  const conta = {
    id: 'conta-1',
    idFnApagarIxc:
      'idFnApagarIxc' in opts ? opts.idFnApagarIxc : 4242,
    status: 'AGUARDANDO_APROVACAO',
  };

  const contasPagar = {
    criarDespesa: jest.fn().mockResolvedValue(conta),
  };
  const categorias = {
    classificar: jest.fn(async () => {
      if (opts.erroAoClassificar) throw new Error(opts.erroAoClassificar);
    }),
  };
  const pagamentos = {
    pagar: jest.fn(async () => {
      if (opts.erroAoPagar) throw new Error(opts.erroAoPagar);
      return {
        idFnApagar: 4242,
        aprovada: true,
        paga: !opts.naoQuita,
        valor: 123.54,
        avisos: [],
      };
    }),
  };

  // O cliente do IXC: anexa a nota, lista os arquivos do título e baixa um
  // deles. As respostas do download vêm na ordem em que foram pedidas.
  const respostas = [...(opts.downloads ?? [])];
  const ixc = {
    upload: jest.fn(),
    baixar: jest.fn(async (_endpoint: string, _corpo: Record<string, string>) => {
      const r = respostas.shift() ?? {};
      return Buffer.isBuffer(r)
        ? { tipo: 'application/octet-stream', conteudo: r }
        : { tipo: 'application/json', conteudo: Buffer.from(JSON.stringify(r)) };
    }),
    list: jest.fn(async () => ({
      registros: opts.arquivosDoTitulo ?? [],
      total: (opts.arquivosDoTitulo ?? []).length,
    })),
  };

  // Só o veículo é lido do banco aqui: o id "sumido" faz o papel do que foi
  // apagado noutra aba.
  const prisma = {
    veiculo: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === VEICULO_SUMIDO ? null : { id: where.id },
      ),
      count: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => id !== VEICULO_SUMIDO).length,
      ),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, apelido: APELIDOS[id] ?? 'Veículo' })),
      ),
    },
    categoriaDespesa: {
      count: jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => id !== CATEGORIA_SUMIDA).length,
      ),
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, nome: CATEGORIAS[id] ?? 'Categoria' })),
      ),
    },
    parteDaConta: {
      create: jest.fn(async (_args: { data: Record<string, unknown> }) => ({
        id: `parte-${++partesCriadas}`,
      })),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'parte-1' ? { id: 'parte-1', conta: { idFnApagarIxc: 4242 } } : null,
      ),
    },
    fotoDaNota: { create: jest.fn(async () => ({ id: 'f1' })) },
    // As criações chegam já disparadas; a transação só espera todas.
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  let partesCriadas = 0;

  const service = new DespesasService(
    contasPagar as never,
    categorias as never,
    pagamentos as never,
    ixc as never,
    prisma as never,
  );
  return { service, contasPagar, categorias, pagamentos, conta , ixc, prisma };
}

const BASE: CriarDespesaDto = {
  idFornecedorIxc: 3,
  fornecedorNome: 'Companhia Energética do Maranhão',
  valor: 123.54,
  observacao: 'Energia da fazenda 08/2026',
};

describe('DespesasService.lancar', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('manda ao IXC o fornecedor, o valor e a observação da tela', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar(BASE, 'u1');

    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({
        idFornecedorIxc: 3,
        fornecedorNome: 'Companhia Energética do Maranhão',
        valor: 123.54,
        observacao: 'Energia da fazenda 08/2026',
      }),
      'u1',
    );
  });

  it('liga a conta ao veículo escolhido, junto com a categoria que a pessoa marcou', async () => {
    const { service, contasPagar, categorias } = montarServico();

    await service.lancar(
      { ...BASE, veiculoId: MOTO, categoriaId: 'b3a1c2d4-0000-4000-8000-000000000007' },
      'u1',
    );

    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ veiculoId: MOTO }),
      'u1',
    );
    // O veículo não troca a categoria: a de mão de obra continua sendo a de mão de obra.
    expect(categorias.classificar).toHaveBeenCalledWith(
      4242,
      'b3a1c2d4-0000-4000-8000-000000000007',
      'u1',
    );
  });

  it('veículo que não existe mais não deixa lançar nada no IXC', async () => {
    const { service, contasPagar } = montarServico();

    await expect(service.lancar({ ...BASE, veiculoId: VEICULO_SUMIDO })).rejects.toThrow(
      /veículo escolhido não existe/,
    );
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('usa as datas escolhidas, sem escorregar de dia pelo fuso', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar({
      ...BASE,
      dataEmissao: '2026-08-01',
      dataVencimento: '2026-09-10',
    });

    const [dados] = contasPagar.criarDespesa.mock.calls[0];
    // O IXC recebe DD/MM/AAAA lido em UTC: gravar meia-noite local faria a
    // conta lançada de madrugada sair com a data do dia anterior.
    expect(dados.dataEmissao.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(dados.dataVencimento.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('sem data escolhida, emissão e vencimento são hoje', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar(BASE);

    const [dados] = contasPagar.criarDespesa.mock.calls[0];
    expect(dados.dataEmissao.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(dados.dataVencimento.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('etiqueta a conta pelo número que o IXC devolveu', async () => {
    const { service, categorias } = montarServico();

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' }, 'u1');

    expect(categorias.classificar).toHaveBeenCalledWith(4242, 'cat-1', 'u1');
    expect(r.avisoCategoria).toBeNull();
  });

  it('sem categoria escolhida, não classifica nada', async () => {
    const { service, categorias } = montarServico();

    await service.lancar(BASE);

    expect(categorias.classificar).not.toHaveBeenCalled();
  });

  it('conta sem número do IXC: avisa em vez de etiquetar no escuro', async () => {
    const { service, categorias } = montarServico({ idFnApagarIxc: null });

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' });

    expect(categorias.classificar).not.toHaveBeenCalled();
    expect(r.avisoCategoria).toContain('não recebeu número do IXC');
  });

  it('etiqueta que falha não derruba a conta já criada no IXC', async () => {
    const { service } = montarServico({ erroAoClassificar: 'banco fora' });

    const r = await service.lancar({ ...BASE, categoriaId: 'cat-1' });

    expect(r.conta.idFnApagarIxc).toBe(4242);
    expect(r.avisoCategoria).toContain('banco fora');
  });
});

/**
 * Lançar o que já foi pago: o boleto saiu pelo aplicativo do banco na segunda e
 * só na sexta alguém veio registrar. O que este bloco protege:
 *
 *  - a baixa cai no dia em que o dinheiro saiu, não no dia do lançamento — do
 *    contrário a conciliação do mês não fecha;
 *  - o IXC é avisado de que a saída já aconteceu, para não deixar a conta
 *    esperando o pagamento do banco que nunca vem;
 *  - a baixa falhar não derruba a conta: ela já existe no IXC, e apagá-la para
 *    "desfazer" deixaria o pior dos dois mundos.
 */
/**
 * O fornecedor manda várias notas e cobra tudo junto. O que se protege:
 *
 *  - um título só no IXC, do total — é um pagamento;
 *  - cada nota gravada com a sua categoria e, se tiver, o seu veículo; e a
 *    conta sem veículo próprio, ou a ficha contaria o mesmo dinheiro duas vezes;
 *  - a divisão que não fecha, e a que aponta veículo ou categoria que sumiram,
 *    não chegam ao IXC;
 *  - a foto de cada nota fica guardada aqui, e sobe também para o IXC.
 */
describe('DespesasService.lancar — conta com várias notas', () => {
  const CARRO = '6f1d2a3b-0000-4000-8000-000000000002';
  const PECAS = 'b3a1c2d4-0000-4000-8000-000000000001';
  const ESCRITORIO = 'b3a1c2d4-0000-4000-8000-000000000002';
  const VARIAS: CriarDespesaDto = {
    ...BASE,
    valor: 600,
    observacao: 'Fornecedor — notas de outubro',
    notas: [
      { veiculoId: MOTO, categoriaId: PECAS, valor: 120, descricao: 'troca de óleo' },
      { veiculoId: CARRO, valor: 330, descricao: ' pneu dianteiro ' },
      { categoriaId: ESCRITORIO, valor: 150, descricao: 'manutenção do ar' },
    ],
  };

  it('vira um título só, do total, e grava cada nota com o que ela é', async () => {
    const { service, contasPagar, prisma } = montarServico();

    const r = await service.lancar(VARIAS, 'u1');

    expect(contasPagar.criarDespesa).toHaveBeenCalledTimes(1);
    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ valor: 600, veiculoId: null }),
      'u1',
    );
    expect(prisma.parteDaConta.create.mock.calls.map(([a]) => a.data)).toEqual([
      { contaPagarId: 'conta-1', veiculoId: MOTO, categoriaId: PECAS, valor: 120, descricao: 'troca de óleo' },
      { contaPagarId: 'conta-1', veiculoId: CARRO, categoriaId: null, valor: 330, descricao: 'pneu dianteiro' },
      { contaPagarId: 'conta-1', veiculoId: null, categoriaId: ESCRITORIO, valor: 150, descricao: 'manutenção do ar' },
    ]);
    // Os números voltam na ordem das notas: é por eles que a tela manda as fotos.
    expect(r.partes).toEqual([{ id: 'parte-1' }, { id: 'parte-2' }, { id: 'parte-3' }]);
  });

  /*
   * No IXC o título é um só, e é a observação dele que conta o que se pagou:
   * quem abre por lá lê cada nota sem vir até aqui.
   */
  it('a observação do título detalha cada nota, com o total', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar(VARIAS, 'u1');

    const [{ observacao }] = contasPagar.criarDespesa.mock.calls[0] as unknown as [
      { observacao: string },
    ];
    expect(observacao.split('\n')).toEqual([
      'Fornecedor — notas de outubro',
      '1. Moto — troca de óleo (Peças): R$ 120,00',
      '2. Strada — pneu dianteiro: R$ 330,00',
      '3. manutenção do ar (Escritório): R$ 150,00',
      'Total: R$ 600,00',
    ]);
  });

  it('o veículo da conta é ignorado quando ela tem várias notas', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar({ ...VARIAS, veiculoId: MOTO }, 'u1');

    expect(contasPagar.criarDespesa).toHaveBeenCalledWith(
      expect.objectContaining({ veiculoId: null }),
      'u1',
    );
  });

  it('a tela anterior, que mandava "porVeiculo", continua dividindo', async () => {
    const { service, prisma } = montarServico();

    await service.lancar({
      ...BASE,
      valor: 450,
      porVeiculo: [
        { veiculoId: MOTO, valor: 120 },
        { veiculoId: CARRO, valor: 330 },
      ],
    });

    expect(prisma.parteDaConta.create).toHaveBeenCalledTimes(2);
  });

  it('a divisão que não fecha com o valor não chega ao IXC', async () => {
    const { service, contasPagar } = montarServico();

    await expect(service.lancar({ ...VARIAS, valor: 610 })).rejects.toThrow(
      /somam R\$\s?600,00 e a conta é de R\$\s?610,00/,
    );
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('centavo de arredondamento não recusa a divisão', async () => {
    const { service, contasPagar } = montarServico();

    await service.lancar({
      ...VARIAS,
      valor: 100,
      notas: [
        { veiculoId: MOTO, valor: 33.33 },
        { veiculoId: CARRO, valor: 33.33 },
        { categoriaId: PECAS, valor: 33.34 },
      ],
    });

    expect(contasPagar.criarDespesa).toHaveBeenCalled();
  });

  it('veículo apagado noutra aba não deixa lançar nada', async () => {
    const { service, contasPagar } = montarServico();

    await expect(
      service.lancar({
        ...VARIAS,
        valor: 450,
        notas: [
          { veiculoId: MOTO, valor: 120 },
          { veiculoId: VEICULO_SUMIDO, valor: 330 },
        ],
      }),
    ).rejects.toThrow(/veículos escolhidos não existe mais/);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('categoria apagada noutra aba não deixa lançar nada', async () => {
    const { service, contasPagar } = montarServico();

    await expect(
      service.lancar({
        ...VARIAS,
        valor: 450,
        notas: [
          { categoriaId: PECAS, valor: 120 },
          { categoriaId: CATEGORIA_SUMIDA, valor: 330 },
        ],
      }),
    ).rejects.toThrow(/categorias escolhidas não existe mais/);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('não se parcela: é um pagamento só', async () => {
    const { service, contasPagar } = montarServico();

    await expect(
      service.lancar({
        ...VARIAS,
        parcelas: [
          { valor: 300, dataVencimento: '2026-10-10' },
          { valor: 300, dataVencimento: '2026-11-10' },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(contasPagar.criarDespesa).not.toHaveBeenCalled();
  });

  it('as notas que não gravam não derrubam a conta já criada no IXC', async () => {
    const { service, prisma } = montarServico();
    prisma.$transaction.mockRejectedValueOnce(new Error('banco fora'));

    const r = await service.lancar(VARIAS, 'u1');

    expect(r.conta.idFnApagarIxc).toBe(4242);
    expect(r.avisoCategoria).toMatch(/divisão pelas notas não ficou/);
    expect(r.partes).toEqual([]);
  });
});

/*
 * A foto de cada nota. Com várias no mesmo título, o IXC desta base não as
 * devolve uma por uma — é a cópia daqui que abre.
 */
describe('a foto de uma das notas da conta', () => {
  const FOTO = `data:image/jpeg;base64,${Buffer.from('foto da nota').toString('base64')}`;

  it('fica guardada aqui e sobe para o título no IXC', async () => {
    const { service, prisma, ixc } = montarServico();

    const r = await service.anexarNotaDaParte('parte-1', {
      arquivo: FOTO,
      nome: 'oleo.jpg',
      descricao: 'Strada — troca de óleo',
    });

    expect(prisma.fotoDaNota.create).toHaveBeenCalledWith({
      data: { parteId: 'parte-1', foto: FOTO },
    });
    expect(ixc.upload.mock.calls[0][3]).toEqual({
      id_apagar: '4242',
      descricao: 'Strada — troca de óleo',
    });
    expect(r).toEqual({ guardada: true, aviso: null });
  });

  it('o IXC recusar não perde a foto: ela já está guardada', async () => {
    const { service, prisma, ixc } = montarServico();
    ixc.upload.mockRejectedValueOnce(new Error('webservice fora'));

    const r = await service.anexarNotaDaParte('parte-1', { arquivo: FOTO });

    expect(prisma.fotoDaNota.create).toHaveBeenCalled();
    expect(r.aviso).toMatch(/guardada aqui, mas não subiu para o IXC/);
  });

  it('nota que não existe mais é recusada', async () => {
    const { service } = montarServico();

    await expect(
      service.anexarNotaDaParte('sumida', { arquivo: FOTO }),
    ).rejects.toThrow(/não existe mais/);
  });
});

describe('DespesasService.lancar — conta que já foi paga', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(HOJE);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('não mexe em pagamento nenhum quando não foi pedido', async () => {
    const { service, pagamentos } = montarServico();

    const r = await service.lancar(BASE);

    expect(pagamentos.pagar).not.toHaveBeenCalled();
    expect(r.baixa).toBeNull();
  });

  it('aprova e baixa no dia em que o dinheiro saiu', async () => {
    const { service, pagamentos } = montarServico();

    const r = await service.lancar(
      {
        ...BASE,
        jaPaga: true,
        dataPagamento: '2026-08-10',
        dataVencimento: '2026-08-20',
        contaPagamento: 77,
      },
      'u1',
      'Aurélio',
    );

    expect(pagamentos.pagar).toHaveBeenCalledWith(
      4242,
      expect.objectContaining({
        data: '2026-08-10',
        contaPagamento: 77,
        // Sem isto o IXC deixaria a conta do banco esperando um pagamento que
        // já aconteceu.
        jaSaiu: true,
      }),
      'Aurélio',
    );
    expect(r.baixa).toMatchObject({ pagas: 1, tentadas: 1, data: '2026-08-10' });
    expect(r.baixa?.avisos).toEqual([]);
  });

  /** Sem o dia informado, o vencimento é o palpite melhor que "hoje". */
  it('sem data de pagamento, cai no vencimento', async () => {
    const { service, pagamentos } = montarServico();

    await service.lancar({
      ...BASE,
      jaPaga: true,
      dataVencimento: '2026-08-20',
    });

    expect(pagamentos.pagar).toHaveBeenCalledWith(
      4242,
      expect.objectContaining({ data: '2026-08-20' }),
      undefined,
    );
  });

  it('sem data nenhuma, cai em hoje', async () => {
    const { service, pagamentos } = montarServico();

    const r = await service.lancar({ ...BASE, jaPaga: true });

    expect(pagamentos.pagar).toHaveBeenCalledWith(
      4242,
      expect.objectContaining({ data: '2026-08-15' }),
      undefined,
    );
    expect(r.baixa?.data).toBe('2026-08-15');
  });

  it('baixa que falha não derruba a conta já criada no IXC', async () => {
    const { service } = montarServico({ erroAoPagar: 'IXC fora do ar' });

    const r = await service.lancar({ ...BASE, jaPaga: true });

    expect(r.conta.idFnApagarIxc).toBe(4242);
    expect(r.baixa?.pagas).toBe(0);
    expect(r.baixa?.avisos[0]).toContain('IXC fora do ar');
    expect(r.baixa?.avisos[0]).toContain('Pague-a pela lista');
  });

  /** O IXC aceitou a baixa e mesmo assim a conta continua aberta lá. */
  it('avisa quando o IXC não dá a conta por quitada', async () => {
    const { service } = montarServico({ naoQuita: true });

    const r = await service.lancar({ ...BASE, jaPaga: true });

    expect(r.baixa?.pagas).toBe(0);
    expect(r.baixa?.avisos[0]).toContain('não a deu por paga');
  });

  it('conta sem número do IXC não tem como ser baixada', async () => {
    const { service, pagamentos } = montarServico({ idFnApagarIxc: null });

    const r = await service.lancar({ ...BASE, jaPaga: true });

    expect(pagamentos.pagar).not.toHaveBeenCalled();
    expect(r.baixa?.avisos[0]).toContain('não recebeu número do IXC');
  });
});

/**
 * A nota que vai anexada ao título, no próprio IXC.
 *
 * O papel fica onde a conta está: quem abrir o título por lá acha a nota na aba
 * de arquivos, sem saber que este sistema existe. O que se protege aqui é o
 * nome do arquivo — print colado não tem nenhum, e anexo sem extensão vira um
 * binário que não abre para quem clica.
 */
describe('a nota anexada à conta', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('sobe para o recurso de arquivos do pagar, com o id do título', async () => {
    const { service, ixc } = montarServico();

    await service.anexarNota(4242, { arquivo: PNG, nome: 'cupom.png' });

    const [recurso, campo, arquivo, campos] = ixc.upload.mock.calls[0];
    expect(recurso).toBe('fn_apagar_arquivos');
    expect(campo).toBe('arquivo');
    expect(campos.id_apagar).toBe('4242');
    expect(arquivo.nome).toBe('cupom.png');
    expect(arquivo.tipo).toBe('image/png');
  });

  /* Print colado não tem nome: quem nomeia é a API, com a extensão do tipo. */
  it('inventa nome com extensão quando o print não traz nenhum', async () => {
    const { service, ixc } = montarServico();

    const r = await service.anexarNota(4242, { arquivo: PNG });

    expect(r.nome).toMatch(/^nota-[\d-]+\.png$/);
    expect(ixc.upload.mock.calls[0][2].nome).toBe(r.nome);
  });

  it('põe a extensão no nome que veio sem ela', async () => {
    const { service } = montarServico();

    const r = await service.anexarNota(4242, { arquivo: PNG, nome: 'cupom' });

    expect(r.nome).toBe('cupom.png');
  });

  /* Planilha e documento do Word não são prova de gasto. */
  it('recusa o que não é imagem nem PDF', async () => {
    const { service, ixc } = montarServico();

    await expect(
      service.anexarNota(4242, { arquivo: 'data:text/plain;base64,b2k=' }),
    ).rejects.toThrow(/PDF ou imagem/i);
    expect(ixc.upload).not.toHaveBeenCalled();
  });

  it('a descrição é o que a lista de arquivos do IXC mostra', async () => {
    const { service, ixc } = montarServico();

    await service.anexarNota(4242, { arquivo: PNG, descricao: 'Combustível' });

    expect(ixc.upload.mock.calls[0][3].descricao).toBe('Combustível');
  });
});

/**
 * A nota de volta do IXC — é ela que responde "cadê a foto disso?".
 *
 * O webservice não documenta em que campo o arquivo vem, e a coleção mostra a
 * chamada com o id do título onde o nosso é o id do arquivo. O que se protege
 * aqui é o que já falhou na mão do usuário: o arquivo aninhado, a segunda
 * tentativa e o erro que não dizia nada.
 */
describe('baixar a nota do IXC', () => {
  const ARQUIVO = Buffer.from('a'.repeat(150)).toString('base64');
  const UM_ARQUIVO = [{ id: '9', descricao: 'Manutenção', extensao: '.pdf' }];

  it('acha o arquivo mesmo aninhado na resposta', async () => {
    const { service } = montarServico({
      downloads: [{ type: 'success', registros: [{ arquivo: ARQUIVO }] }],
    });

    const nota = await service.baixarNota(9, 'PDF');

    expect(nota.conteudo.toString('base64')).toBe(ARQUIVO);
    expect(nota.tipo).toBe('application/pdf');
    expect(nota.nome).toBe('nota-9.pdf');
  });

  it('não vindo pelo id do arquivo, tenta pelo título — com uma nota só', async () => {
    const { service, ixc } = montarServico({
      downloads: [{ type: 'error' }, { arquivo: ARQUIVO }],
      arquivosDoTitulo: UM_ARQUIVO,
    });

    const nota = await service.baixarNota(9, 'pdf', 4242);

    expect(nota.conteudo.toString('base64')).toBe(ARQUIVO);
    expect(ixc.baixar.mock.calls.map((c) => c[1])).toEqual([{ id: '9' }, { id: '4242' }]);
  });

  /* Com duas notas no título, a segunda tentativa traria qualquer uma das
     duas — e a nota errada é pior do que a nota que não abriu. */
  it('com mais de uma nota no título, não arrisca a errada', async () => {
    const { service, ixc } = montarServico({
      downloads: [{}, { arquivo: ARQUIVO }],
      arquivosDoTitulo: [...UM_ARQUIVO, { id: '10', descricao: 'Outra', extensao: '.pdf' }],
    });

    await expect(service.baixarNota(9, 'pdf', 4242)).rejects.toThrow(BadRequestException);
    expect(ixc.baixar).toHaveBeenCalledTimes(1);
  });

  it('o erro repete o que o IXC disse', async () => {
    const { service } = montarServico({
      downloads: [{ type: 'error', message: 'Arquivo não localizado' }],
    });

    await expect(service.baixarNota(9, 'pdf')).rejects.toThrow(/Arquivo não localizado/);
  });

  /* A foto anexada com a extensão errada descia como PDF, e o leitor de PDF
     dava erro numa nota que estava inteira no IXC. */
  it('o tipo vem do conteúdo, e não da extensão que o IXC diz', async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(150, 1),
    ]).toString('base64');
    const { service } = montarServico({ downloads: [{ arquivo: jpeg }] });

    const nota = await service.baixarNota(9, 'pdf');

    expect(nota.tipo).toBe('image/jpeg');
    expect(nota.nome).toBe('nota-9.jpg');
  });

  /*
   * A foto tirada pela câmera, anexada ao título: o IXC a lista como "PDF" e
   * a manda crua, sem JSON nenhum em volta. Lida como JSON ela virava texto
   * estragado, e a tela dizia "não achei o arquivo".
   */
  it('o arquivo cru é a nota, e a foto sai como foto mesmo chamada de PDF', async () => {
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
    const { service } = montarServico({ downloads: [foto] });

    const nota = await service.baixarNota(9, 'PDF', 4242);

    expect(nota.conteudo.equals(foto)).toBe(true);
    expect(nota.tipo).toBe('image/jpeg');
    expect(nota.nome).toBe('nota-9.jpg');
  });

  it('o base64 solto, sem JSON, também é a nota', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 1)]);
    const { service } = montarServico({ downloads: [Buffer.from(pdf.toString('base64'))] });

    const nota = await service.baixarNota(9, 'pdf');

    expect(nota.tipo).toBe('application/pdf');
  });

  it('o que não é arquivo nenhum vai descrito no erro', async () => {
    const { service } = montarServico({
      downloads: [Buffer.from('<html><body>Sessão expirada</body></html>')],
    });

    await expect(service.baixarNota(9, 'pdf')).rejects.toThrow(
      /sem o arquivo \(application\/octet-stream, \d+ bytes, começando por "<html>/,
    );
  });

  it('sem extensão e sem conteúdo conhecido, segue o palpite de antes', async () => {
    const { service } = montarServico({ downloads: [{ arquivo: ARQUIVO }] });

    const nota = await service.baixarNota(9, '');

    expect(nota.tipo).toBe('application/pdf');
  });
});
