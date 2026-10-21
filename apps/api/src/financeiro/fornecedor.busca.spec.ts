import { FornecedorService } from './fornecedor.service';

/**
 * "Conferir no IXC" antes de cadastrar um beneficiário.
 *
 * O IXC guarda o CPF/CNPJ **com pontos e hífen** e a busca dele é comparação de
 * texto pura. Quem digita só os dígitos ouvia "nenhum fornecedor com esse
 * documento" para gente que já era fornecedor lá — e criava um cadastro
 * duplicado, sem os dados bancários que estavam no antigo.
 *
 * O que este arquivo protege:
 *  - achar o cadastro esteja o documento digitado com máscara ou sem;
 *  - nunca vincular um fornecedor de outro documento (seria pagar outra pessoa);
 *  - o documento subir mascarado quando o fornecedor é criado daqui, para a
 *    próxima consulta achá-lo.
 */

/** Fornecedor como o IXC devolve: documento em `cpf_cnpj`, com máscara. */
const NO_IXC = {
  id: '3246',
  ativo: 'S',
  tipo_pessoa: 'F',
  razao: 'Marcos Vinicius de Teste',
  fantasia: 'Marcão',
  cpf_cnpj: '111.222.333-44',
  celular: '75999998888',
  cidade: '3',
};

const CFG = {
  cidadePadraoId: 1,
  fornecedorTabelaBanco: '',
};

/** Uma busca que o serviço mandou para o IXC. */
interface Chamada {
  qtype: string;
  query: string;
}

function montarServico(
  opts: {
    /** Como esta base responde cada busca. */
    responder?: (c: Chamada) => Record<string, unknown>[];
    /** Buscas que esta base recusa (coluna inexistente, IXC fora do ar). */
    recusar?: (c: Chamada) => boolean;
    /** Cadastro local do beneficiário, para o caminho de criação. */
    beneficiario?: Record<string, unknown>;
    /** O que `getById` acha lá — o registro que a edição vai reescrever. */
    noIxc?: Record<string, unknown> | null;
  } = {},
) {
  const chamadas: Chamada[] = [];
  const criados: Array<Record<string, unknown>> = [];
  const gravados: Array<{ id: number; body: Record<string, unknown> }> = [];

  const ixc = {
    list: jest.fn(
      async (
        _recurso: string,
        params: { qtype: string; query: string },
      ): Promise<{ total: number; page: number; registros: unknown[] }> => {
        const chamada = { qtype: params.qtype, query: params.query };
        chamadas.push(chamada);
        if (opts.recusar?.(chamada)) {
          throw new Error(`IXC (fornecedor): campo ${params.qtype} inválido`);
        }
        const registros = opts.responder?.(chamada) ?? [];
        return { total: registros.length, page: 1, registros };
      },
    ),
    create: jest.fn(async (_recurso: string, body: Record<string, unknown>) => {
      criados.push(body);
      return { id: 4100, raw: {} };
    }),
    getById: jest.fn(async () => opts.noIxc ?? null),
    update: jest.fn(
      async (_recurso: string, id: number | string, body: Record<string, unknown>) => {
        gravados.push({ id: Number(id), body });
        return {};
      },
    ),
  };

  const prisma = {
    beneficiarioAvulso: {
      findUnique: jest.fn(async () => ({
        id: 'b1',
        nome: 'Marcos Vinicius de Teste',
        cpfCnpj: '11122233344',
        tipoPessoa: 'F',
        email: null,
        telefone: null,
        cidadeIxc: null,
        idFornecedorIxc: null,
        fornecedorNovoNoIxc: false,
        ...opts.beneficiario,
      })),
      update: jest.fn(async () => ({})),
    },
  };

  const config = { obter: jest.fn(async () => CFG) };
  const dadosBancarios = {
    doFornecedor: jest.fn(async () => ({
      banco: '001',
      agencia: '1234',
      conta: '56789-0',
      chavePix: 'marcao@pix',
      tipoChavePix: 'E-mail',
    })),
  };

  const service = new FornecedorService(
    prisma as never,
    ixc as never,
    config as never,
    dadosBancarios as never,
  );
  return { service, chamadas, criados, gravados, ixc };
}

/** Base que só conhece `cpf_cnpj` e só devolve o que está gravado com máscara. */
function baseComMascara(c: Chamada): Record<string, unknown>[] {
  if (c.qtype !== 'fornecedor.cpf_cnpj') return [];
  return c.query === NO_IXC.cpf_cnpj ? [NO_IXC] : [];
}

describe('procurarNoIxcPorCpfCnpj', () => {
  it('acha o cadastro mascarado quando o documento é digitado só com dígitos', async () => {
    const { service, chamadas } = montarServico({ responder: baseComMascara });

    const achado = await service.procurarNoIxcPorCpfCnpj('11122233344');

    expect(achado?.idFornecedor).toBe(3246);
    expect(achado?.nome).toBe('Marcos Vinicius de Teste');
    // Reusar só vale a pena trazendo o que o cadastro antigo já tem.
    expect(achado?.chavePix).toBe('marcao@pix');
    // A primeira tentativa já é o formato que o IXC guarda.
    expect(chamadas[0]).toEqual({
      qtype: 'fornecedor.cpf_cnpj',
      query: '111.222.333-44',
    });
  });

  it('acha também quando a base guardou o documento sem máscara', async () => {
    const semMascara = { ...NO_IXC, cpf_cnpj: '11122233344' };
    const { service } = montarServico({
      responder: (c) =>
        c.qtype === 'fornecedor.cpf_cnpj' && c.query === '11122233344'
          ? [semMascara]
          : [],
    });

    const achado = await service.procurarNoIxcPorCpfCnpj('111.222.333-44');

    expect(achado?.idFornecedor).toBe(3246);
  });

  it('tenta a outra coluna quando esta base não tem a documentada', async () => {
    const { service } = montarServico({
      recusar: (c) => c.qtype === 'fornecedor.cpf_cnpj',
      responder: (c) =>
        c.qtype === 'fornecedor.cnpj_cpf' && c.query === '111.222.333-44'
          ? [{ ...NO_IXC, cpf_cnpj: undefined, cnpj_cpf: '111.222.333-44' }]
          : [],
    });

    const achado = await service.procurarNoIxcPorCpfCnpj('11122233344');

    expect(achado?.idFornecedor).toBe(3246);
  });

  it('descarta registro de outro documento', async () => {
    // Base que ignora o filtro e devolve o primeiro fornecedor da tabela:
    // vincular esse cadastro seria pagar outra pessoa.
    const { service } = montarServico({ responder: () => [NO_IXC] });

    expect(await service.procurarNoIxcPorCpfCnpj('99988877766')).toBeNull();
  });

  it('não gasta chamada quando não há dígito nenhum', async () => {
    const { service, chamadas } = montarServico({ responder: baseComMascara });

    expect(await service.procurarNoIxcPorCpfCnpj('  ')).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it('IXC fora do ar continua sendo IXC fora do ar', async () => {
    const { service } = montarServico({ recusar: () => true });

    await expect(
      service.procurarNoIxcPorCpfCnpj('11122233344'),
    ).rejects.toThrow();
  });
});

describe('garantirParaAvulso', () => {
  it('reusa o fornecedor que já existe, mesmo digitado sem máscara', async () => {
    const { service, ixc } = montarServico({ responder: baseComMascara });

    expect(await service.garantirParaAvulso('b1')).toBe(3246);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('grava o documento com máscara ao criar, como o IXC espera', async () => {
    const { service, criados } = montarServico({ responder: () => [] });

    expect(await service.garantirParaAvulso('b1')).toBe(4100);
    expect(criados[0]).toMatchObject({ cpf_cnpj: '111.222.333-44' });
  });
});

/**
 * A lista de fornecedores por onde os Pagamentos Avulsos abrem.
 *
 * Ela procurava só pela razão social, e quem é conhecido pelo apelido ficava
 * invisível: "Deda pedreiro" está cadastrado como "Antonio Clebes Alves da
 * Silva", e digitar "deda" não trazia ninguém — o caminho seguinte era
 * cadastrar de novo alguém que já estava lá.
 *
 * O webservice não aceita OU no filtro, então são duas consultas somadas aqui.
 */
describe('listarDoIxc', () => {
  const DEDA = {
    id: '3103',
    ativo: 'S',
    razao: 'Antonio Clebes Alves da Silva',
    fantasia: 'Deda pedreiro',
    cpf_cnpj: '038.957.603-40',
  };
  const CEMAR = {
    id: '12',
    ativo: 'S',
    razao: 'Equatorial Maranhão',
    fantasia: 'Cemar',
  };

  /** Base real: cada coluna responde só ao que casa com ela. */
  function porColuna(c: Chamada): Record<string, unknown>[] {
    const termo = c.query.toLowerCase();
    const casa = (f: Record<string, string>, coluna: 'razao' | 'fantasia') =>
      String(f[coluna] ?? '').toLowerCase().includes(termo);

    if (c.qtype === 'fornecedor.razao') {
      return [DEDA, CEMAR].filter((f) => casa(f, 'razao'));
    }
    if (c.qtype === 'fornecedor.fantasia') {
      return [DEDA, CEMAR].filter((f) => casa(f, 'fantasia'));
    }
    return [];
  }

  it('acha pelo apelido quem a razão social não entregava', async () => {
    const { service } = montarServico({ responder: porColuna });

    const pagina = await service.listarDoIxc({ busca: 'deda' });

    expect(pagina.itens.map((f) => f.idFornecedor)).toEqual([3103]);
    expect(pagina.itens[0].nomeFantasia).toBe('Deda pedreiro');
  });

  it('continua achando pela razão social', async () => {
    const { service } = montarServico({ responder: porColuna });

    const pagina = await service.listarDoIxc({ busca: 'equatorial' });

    expect(pagina.itens.map((f) => f.idFornecedor)).toEqual([12]);
  });

  it('procura nas duas colunas', async () => {
    const { service, chamadas } = montarServico({ responder: porColuna });

    await service.listarDoIxc({ busca: 'cemar' });

    expect(chamadas.map((c) => c.qtype)).toEqual([
      'fornecedor.razao',
      'fornecedor.fantasia',
    ]);
  });

  /** Quem casa nas duas colunas é uma pessoa só, não duas linhas na tela. */
  it('não repete quem aparece nas duas consultas', async () => {
    const { service } = montarServico({
      responder: () => [DEDA],
    });

    const pagina = await service.listarDoIxc({ busca: 'deda' });

    expect(pagina.itens).toHaveLength(1);
    expect(pagina.total).toBe(1);
  });

  /** A união é recortada aqui: o total é o que a tela pode de fato percorrer. */
  it('pagina a união das duas consultas', async () => {
    const { service } = montarServico({ responder: porColuna });

    const primeira = await service.listarDoIxc({
      busca: 'a',
      page: 1,
      porPagina: 1,
    });
    const segunda = await service.listarDoIxc({
      busca: 'a',
      page: 2,
      porPagina: 1,
    });

    expect(primeira.total).toBe(2);
    expect(primeira.itens).toHaveLength(1);
    expect(segunda.itens).toHaveLength(1);
    expect(segunda.itens[0].idFornecedor).not.toBe(
      primeira.itens[0].idFornecedor,
    );
  });

  it('fornecedor desativado no IXC fica de fora', async () => {
    const { service } = montarServico({
      responder: () => [{ ...DEDA, ativo: 'N' }],
    });

    expect((await service.listarDoIxc({ busca: 'deda' })).itens).toEqual([]);
  });

  /** Base sem a coluna `fantasia`: a busca por razão social ainda vale. */
  it('coluna que esta base não tem não derruba a busca', async () => {
    const { service } = montarServico({
      recusar: (c) => c.qtype === 'fornecedor.fantasia',
      responder: porColuna,
    });

    const pagina = await service.listarDoIxc({ busca: 'equatorial' });

    expect(pagina.itens.map((f) => f.idFornecedor)).toEqual([12]);
  });

  /**
   * Nenhuma das duas respondeu é o IXC fora do ar. Dizer "ninguém com esse
   * nome" aqui mandaria cadastrar de novo gente que já está lá.
   */
  it('IXC fora do ar continua sendo IXC fora do ar', async () => {
    const { service } = montarServico({ recusar: () => true });

    await expect(service.listarDoIxc({ busca: 'deda' })).rejects.toThrow();
  });

  /** Sem termo digitado é o catálogo: uma consulta só, paginada pelo IXC. */
  it('sem busca, lista os ativos numa consulta só', async () => {
    const { service, chamadas } = montarServico({ responder: () => [CEMAR] });

    await service.listarDoIxc({});

    expect(chamadas).toEqual([{ qtype: 'fornecedor.ativo', query: 'S' }]);
  });
});

/**
 * Gravar o apelido no cadastro do IXC.
 *
 * O `PUT` do webservice reescreve a linha inteira — o que este bloco protege é
 * que o registro seja lido antes e devolvido completo. `montarEdicaoFornecedor`
 * cuida do conteúdo; aqui o que se confere é que ninguém escreva sem ler.
 */
describe('atualizarNoIxc', () => {
  const NO_IXC = {
    id: '196',
    ativo: 'S',
    razao: 'Marco Aurélio Castro',
    fantasia: '',
    cpf_cnpj: '12.345.678/0001-00',
    id_class_iss: '4',
  };

  it('lê o cadastro antes e devolve ele inteiro com o apelido por cima', async () => {
    const { service, gravados } = montarServico({ noIxc: NO_IXC });

    await service.atualizarNoIxc(196, { nomeFantasia: 'Marcão' });

    expect(gravados).toHaveLength(1);
    expect(gravados[0].id).toBe(196);
    expect(gravados[0].body).toMatchObject({
      fantasia: 'Marcão',
      razao: 'Marco Aurélio Castro',
      cpf_cnpj: '12.345.678/0001-00',
      id_class_iss: '4',
    });
  });

  it('devolve o cadastro relido do IXC, não o que este app achou que gravou', async () => {
    const { service, ixc } = montarServico({ noIxc: NO_IXC });

    const depois = await service.atualizarNoIxc(196, { nomeFantasia: 'Marcão' });

    expect(depois.idFornecedor).toBe(196);
    // Duas leituras: a de antes da escrita e a conferência depois.
    expect(ixc.getById).toHaveBeenCalledTimes(2);
  });

  /** Sem cadastro lá não há o que reescrever — e escrever criaria um vazio. */
  it('não escreve quando o fornecedor não existe mais no IXC', async () => {
    const { service, gravados } = montarServico({ noIxc: null });

    await expect(
      service.atualizarNoIxc(196, { nomeFantasia: 'Marcão' }),
    ).rejects.toThrow();
    expect(gravados).toEqual([]);
  });
});
