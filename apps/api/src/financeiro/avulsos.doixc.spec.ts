import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AvulsosService } from './avulsos.service';

/**
 * A tela de pagamentos avulsos do módulo Contas a Pagar abre pelo cadastro de
 * fornecedores do IXC. O que este arquivo protege:
 *
 *  - pagar duas vezes a mesma pessoa não cria dois cadastros daqui (e, por
 *    tabela, não abre um segundo fornecedor no IXC com o mesmo CPF);
 *  - o que o IXC já sabe — nome, documento, chave PIX — vem junto, senão quem
 *    paga teria de redigitar o que já existe;
 *  - a lista diz quem já recebeu por aqui, que é o que separa o cadastro novo
 *    do conhecido;
 *  - a categoria padrão do fornecedor é lida sem criar cadastro, e gravada no
 *    cadastro daqui (criado na hora, se faltar).
 */

const DO_IXC = {
  idFornecedor: 88,
  nome: 'Marco Antonio Castro',
  nomeFantasia: 'Marco',
  cpfCnpj: '405.424.083-68',
  tipoPessoa: 'F',
  email: null,
  telefone: null,
  cidadeIxc: 637,
  ativo: true,
  banco: null,
  agencia: null,
  conta: null,
  chavePix: 'produmar.ma@hotmail.com',
  tipoChavePix: 'E-mail',
};

function montarServico(
  opts: {
    /** Cadastro daqui que já existe para aquele fornecedor. */
    existente?: unknown;
    /** null = o fornecedor não existe (mais) no IXC. */
    doIxc?: unknown;
    pagina?: { itens: unknown[]; total: number; page: number; porPagina: number };
    conhecidos?: unknown[];
    /** Categorias que existem, pelo id. */
    categorias?: string[];
  } = {},
) {
  const prisma = {
    beneficiarioAvulso: {
      findFirst: jest.fn().mockResolvedValue(opts.existente ?? null),
      findMany: jest.fn().mockResolvedValue(opts.conhecidos ?? []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'novo-1',
        ...data,
      })),
      update: jest.fn().mockResolvedValue({}),
    },
    categoriaDespesa: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        (opts.categorias ?? []).includes(where.id) ? { id: where.id } : null,
      ),
    },
  };

  const fornecedores = {
    listarDoIxc: jest.fn().mockResolvedValue(
      opts.pagina ?? { itens: [], total: 0, page: 1, porPagina: 25 },
    ),
    buscarNoIxcPorId: jest
      .fn()
      .mockResolvedValue('doIxc' in opts ? opts.doIxc : DO_IXC),
  };

  const service = new AvulsosService(
    prisma as never,
    {} as never,
    {} as never,
    fornecedores as never,
    {} as never,
  );
  return { service, prisma, fornecedores };
}

describe('AvulsosService.garantirBeneficiarioDoIxc', () => {
  it('cria o cadastro daqui com o que o IXC já sabe', async () => {
    const { service, prisma } = montarServico();

    const b = await service.garantirBeneficiarioDoIxc(88);

    expect(prisma.beneficiarioAvulso.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nome: 'Marco Antonio Castro',
        cpfCnpj: '405.424.083-68',
        chavePix: 'produmar.ma@hotmail.com',
        tipoChavePix: 'E-mail',
        // Sem o vínculo, o pagamento abriria um segundo fornecedor no IXC com
        // o mesmo CPF — e o dinheiro sairia para um cadastro sem dados
        // bancários.
        idFornecedorIxc: 88,
      }),
    });
    expect(b.id).toBe('novo-1');
  });

  it('quem já tem cadastro daqui não ganha um segundo', async () => {
    const { service, prisma, fornecedores } = montarServico({
      existente: { id: 'b-1', nome: 'Marco Antonio Castro' },
    });

    const b = await service.garantirBeneficiarioDoIxc(88);

    expect(b.id).toBe('b-1');
    expect(prisma.beneficiarioAvulso.create).not.toHaveBeenCalled();
    // Nem vai ao IXC: o que interessa já está aqui.
    expect(fornecedores.buscarNoIxcPorId).not.toHaveBeenCalled();
  });

  it('estrangeiro do IXC entra como pessoa física', async () => {
    const { service, prisma } = montarServico({
      doIxc: { ...DO_IXC, tipoPessoa: 'E' },
    });

    await service.garantirBeneficiarioDoIxc(88);

    const { data } = prisma.beneficiarioAvulso.create.mock.calls[0][0] as {
      data: { tipoPessoa: string };
    };
    expect(data.tipoPessoa).toBe('F');
  });

  it('fornecedor que sumiu do IXC não vira cadastro em branco', async () => {
    const { service, prisma } = montarServico({ doIxc: null });

    await expect(
      service.garantirBeneficiarioDoIxc(999),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.beneficiarioAvulso.create).not.toHaveBeenCalled();
  });
});

describe('AvulsosService.listarFornecedoresDoIxc', () => {
  const PAGINA = {
    itens: [
      { idFornecedor: 88, nome: 'Marco Antonio Castro' },
      { idFornecedor: 90, nome: 'Outro Fornecedor' },
    ],
    total: 3238,
    page: 1,
    porPagina: 25,
  };

  it('marca quem já recebeu por aqui e deixa o resto sem marca', async () => {
    const { service } = montarServico({
      pagina: PAGINA,
      conhecidos: [
        {
          id: 'b-1',
          idFornecedorIxc: 88,
          categoriaId: 'cat-combustivel',
          categoria: { nome: 'Combustível' },
          pagamentos: [
            { data: new Date('2026-07-01') },
            { data: new Date('2026-08-10') },
          ],
        },
      ],
    });

    const r = await service.listarFornecedoresDoIxc({ page: 1 });

    expect(r.total).toBe(3238);
    expect(r.itens[0]).toMatchObject({
      idFornecedor: 88,
      beneficiarioId: 'b-1',
      quantidadePagamentos: 2,
      ultimoPagamento: new Date('2026-08-10'),
      categoriaId: 'cat-combustivel',
      categoriaNome: 'Combustível',
    });
    expect(r.itens[1]).toMatchObject({
      idFornecedor: 90,
      beneficiarioId: null,
      quantidadePagamentos: 0,
      ultimoPagamento: null,
      categoriaId: null,
      categoriaNome: null,
    });
  });

  it('página vazia não vai ao banco atrás de cadastro nenhum', async () => {
    const { service, prisma } = montarServico();

    const r = await service.listarFornecedoresDoIxc({ page: 9 });

    expect(r.itens).toEqual([]);
    expect(prisma.beneficiarioAvulso.findMany).not.toHaveBeenCalled();
  });
});

describe('AvulsosService — categoria padrão do fornecedor', () => {
  it('lê a do cadastro daqui', async () => {
    const { service } = montarServico({
      existente: { categoriaId: 'cat-combustivel' },
    });

    expect(await service.categoriaPadraoDoFornecedor(88)).toEqual({
      categoriaId: 'cat-combustivel',
    });
  });

  it('fornecedor sem cadastro daqui não tem padrão, e ler não cria cadastro', async () => {
    const { service, prisma } = montarServico();

    expect(await service.categoriaPadraoDoFornecedor(88)).toEqual({
      categoriaId: null,
    });
    expect(prisma.beneficiarioAvulso.create).not.toHaveBeenCalled();
  });

  it('grava no cadastro que já existe', async () => {
    const { service, prisma } = montarServico({
      existente: { id: 'b-1' },
      categorias: ['cat-combustivel'],
    });

    await service.definirCategoriaPadraoDoFornecedor(88, 'cat-combustivel');

    expect(prisma.beneficiarioAvulso.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { categoriaId: 'cat-combustivel' },
    });
    expect(prisma.beneficiarioAvulso.create).not.toHaveBeenCalled();
  });

  it('fornecedor que nunca passou por aqui ganha o cadastro na hora', async () => {
    const { service, prisma } = montarServico({ categorias: ['cat-combustivel'] });

    await service.definirCategoriaPadraoDoFornecedor(88, 'cat-combustivel');

    expect(prisma.beneficiarioAvulso.create).toHaveBeenCalled();
    expect(prisma.beneficiarioAvulso.update).toHaveBeenCalledWith({
      where: { id: 'novo-1' },
      data: { categoriaId: 'cat-combustivel' },
    });
  });

  it('vazio limpa o padrão', async () => {
    const { service, prisma } = montarServico({ existente: { id: 'b-1' } });

    await service.definirCategoriaPadraoDoFornecedor(88, null);

    expect(prisma.beneficiarioAvulso.update).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { categoriaId: null },
    });
  });

  it('categoria que não existe mais é recusada antes de mexer no cadastro', async () => {
    const { service, prisma } = montarServico({ existente: { id: 'b-1' } });

    await expect(
      service.definirCategoriaPadraoDoFornecedor(88, 'cat-apagada'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.beneficiarioAvulso.update).not.toHaveBeenCalled();
  });
});
