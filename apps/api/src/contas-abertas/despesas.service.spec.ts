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

function montarServico(
  opts: {
    idFnApagarIxc?: number | null;
    erroAoClassificar?: string;
    /** O IXC recusa a baixa. */
    erroAoPagar?: string;
    /** O IXC aceita a baixa mas não dá a conta por quitada. */
    naoQuita?: boolean;
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

  // O cliente do IXC só é usado para anexar a nota ao título; nenhum caso daqui
  // passa por lá, e um dublê mudo basta para o construtor.
  const ixc = { upload: jest.fn() };

  // Só o veículo é lido do banco aqui: o id "sumido" faz o papel do que foi
  // apagado noutra aba.
  const prisma = {
    veiculo: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === VEICULO_SUMIDO ? null : { id: where.id },
      ),
    },
  };

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
