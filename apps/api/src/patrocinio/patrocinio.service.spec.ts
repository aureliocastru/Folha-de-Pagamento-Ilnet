import { BadRequestException } from '@nestjs/common';
import { Prisma, TipoDePatrocinio } from '@prisma/client';
import { PatrocinioService } from './patrocinio.service';

/**
 * O que este arquivo protege: todo patrocinado tem por onde receber, um
 * fornecedor paga um patrocinado só — senão "quanto já mandei" de um somaria o
 * dinheiro do outro —, e o que já se mandou vem dos títulos do fornecedor.
 * E o tipo do patrocínio: o desconto na mensalidade não se paga nem "falta", e
 * o avulso não tem combinado por mês.
 */

/** Um título do fornecedor 77 já baixado no IXC. */
const PAGO_SETEMBRO = {
  id: '501',
  id_fornecedor: '77',
  valor: '300.00',
  valor_pago: '300.00',
  valor_aberto: '0.00',
  status: 'F',
  data_vencimento: '2026-09-05',
  data_pagamento: '2026-09-05 10:12:00',
  obs: 'Patrocínio Maria Clara - setembro de 2026',
};

/** O de outubro, lançado e esperando o banco. */
const ABERTO_OUTUBRO = {
  id: '502',
  id_fornecedor: '77',
  valor: '300.00',
  valor_aberto: '300.00',
  status: 'A',
  data_vencimento: '2026-10-05',
  obs: 'Patrocínio Maria Clara - outubro de 2026',
};

function montar(
  opts: {
    dono?: Record<string, unknown> | null;
    patrocinado?: Record<string, unknown> | null;
    ativos?: Array<Record<string, unknown>>;
    titulos?: Array<Record<string, unknown>> | Error;
    criarFalha?: Error;
    notas?: Array<Record<string, unknown>>;
  } = {},
) {
  const prisma = {
    patrocinado: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) =>
        'idFornecedorIxc' in args.where ? (opts.dono ?? null) : (opts.patrocinado ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(opts.ativos ?? []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.criarFalha) throw opts.criarFalha;
        return { id: 'p1', ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data })),
      delete: jest.fn(),
    },
    notaDeRecebimento: {
      findMany: jest.fn().mockResolvedValue(opts.notas ?? []),
    },
  };
  const ixc = {
    listAll: jest.fn(async () => {
      if (opts.titulos instanceof Error) throw opts.titulos;
      return opts.titulos ?? [];
    }),
  };
  const fornecedores = { buscarNoIxcPorNome: jest.fn().mockResolvedValue([]) };
  const service = new PatrocinioService(prisma as never, ixc as never, fornecedores as never);
  return { service, prisma, ixc, fornecedores };
}

describe('PatrocinioService.criar', () => {
  it('liga ao fornecedor escolhido e guarda o nome dele', async () => {
    const { service, prisma } = montar();
    await service.criar(
      {
        nome: 'Futsal Unidos',
        responsavel: 'Carlos',
        valorMensal: 500,
        inicio: '2026-10-01',
        idFornecedorIxc: 77,
        fornecedorNome: ' CARLOS ALBERTO SOUSA ',
      },
      'u1',
    );

    const { data } = prisma.patrocinado.create.mock.calls[0][0];
    expect(data).toMatchObject({
      nome: 'Futsal Unidos',
      idFornecedorIxc: 77,
      fornecedorNome: 'CARLOS ALBERTO SOUSA',
      responsavel: 'Carlos',
      criadoPor: 'u1',
    });
    expect(data.valorMensal).toEqual(new Prisma.Decimal(500));
    expect((data.inicio as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('o desconto na mensalidade entra sem fornecedor, e nem pergunta de quem ele é', async () => {
    const { service, prisma } = montar();
    await service.criar({ nome: 'Ana Ciclista', tipo: TipoDePatrocinio.DESCONTO, valorMensal: 99.9 });

    expect(prisma.patrocinado.findUnique).not.toHaveBeenCalled();
    const { data } = prisma.patrocinado.create.mock.calls[0][0];
    expect(data).toMatchObject({ tipo: 'DESCONTO', idFornecedorIxc: null, fornecedorNome: null });
    expect(data.valorMensal).toEqual(new Prisma.Decimal(99.9));
  });

  it('o avulso não guarda valor por mês, mesmo que a tela mande um', async () => {
    const { service, prisma } = montar();
    await service.criar({
      nome: 'Grupo de Dança',
      tipo: TipoDePatrocinio.AVULSO,
      valorMensal: 200,
      idFornecedorIxc: 91,
      fornecedorNome: 'GRUPO',
    });
    expect(prisma.patrocinado.create.mock.calls[0][0].data).toMatchObject({
      tipo: 'AVULSO',
      valorMensal: null,
      idFornecedorIxc: 91,
    });
  });

  it('fornecedor que já paga outro patrocinado é recusado, com o nome de quem', async () => {
    const { service, prisma } = montar({ dono: { id: 'outro', nome: 'Vôlei da Vila' } });
    await expect(
      service.criar({ nome: 'Maria Clara', idFornecedorIxc: 77, fornecedorNome: 'Maria' }),
    ).rejects.toThrow(/Vôlei da Vila/);
    expect(prisma.patrocinado.create).not.toHaveBeenCalled();
  });

  it('duas telas ligando o mesmo fornecedor ao mesmo tempo: o banco desempata com frase', async () => {
    const unico = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    const { service } = montar({ criarFalha: unico });
    await expect(
      service.criar({ nome: 'Maria Clara', idFornecedorIxc: 77, fornecedorNome: 'Maria' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PatrocinioService.atualizar', () => {
  it('trocar para o próprio fornecedor não é conflito', async () => {
    const { service, prisma } = montar({
      patrocinado: { id: 'p1' },
      dono: { id: 'p1', nome: 'Maria Clara' },
    });
    await service.atualizar('p1', { idFornecedorIxc: 77, fornecedorNome: 'Maria' });
    expect(prisma.patrocinado.update.mock.calls[0][0].data).toMatchObject({
      idFornecedorIxc: 77,
      fornecedorNome: 'Maria',
    });
  });

  it('virar avulso apaga o valor por mês que havia', async () => {
    const { service, prisma } = montar({ patrocinado: { id: 'p1' } });
    await service.atualizar('p1', { tipo: TipoDePatrocinio.AVULSO });
    expect(prisma.patrocinado.update.mock.calls[0][0].data).toMatchObject({
      tipo: 'AVULSO',
      valorMensal: null,
    });
  });

  it('corrigir o telefone não mexe no tipo nem no valor', async () => {
    const { service, prisma } = montar({ patrocinado: { id: 'p1' } });
    await service.atualizar('p1', { telefone: '99 99999-0000' });
    const { data } = prisma.patrocinado.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('tipo');
    expect(data).not.toHaveProperty('valorMensal');
  });

  it('trocar o fornecedor sem dizer o nome dele é recusado', async () => {
    const { service, prisma } = montar({ patrocinado: { id: 'p1' } });
    await expect(service.atualizar('p1', { idFornecedorIxc: 77 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.patrocinado.update).not.toHaveBeenCalled();
  });
});

describe('PatrocinioService.ficha', () => {
  const patrocinado = {
    id: 'p1',
    nome: 'Maria Clara',
    idFornecedorIxc: 77,
    fornecedorNome: 'MARIA CLARA',
    contratos: [],
    arquivos: [],
  };

  it('lê o que se mandou dos títulos do fornecedor, o mais recente primeiro', async () => {
    const { service, ixc } = montar({
      patrocinado,
      titulos: [
        PAGO_SETEMBRO,
        ABERTO_OUTUBRO,
        // Cancelado não é dinheiro que saiu nem que vai sair.
        { ...ABERTO_OUTUBRO, id: '503', status: 'C' },
        // A base que ignora o filtro: título de outra pessoa não entra.
        { ...PAGO_SETEMBRO, id: '504', id_fornecedor: '12' },
      ],
    });

    const f = await service.ficha('p1');
    expect(ixc.listAll.mock.calls[0]).toEqual([
      'fn_apagar',
      expect.objectContaining({ qtype: 'fn_apagar.id_fornecedor', query: '77' }),
      expect.anything(),
    ]);
    expect(f.pagamentos.map((p) => [p.idFnApagar, p.situacao])).toEqual([
      [502, 'EM_ABERTO'],
      [501, 'PAGO'],
    ]);
    expect(f.resumo.totalPago).toBe(300);
    expect(f.resumo.totalEmAberto).toBe(300);
    expect(f.avisoPagamentos).toBeNull();
    expect(f.contrato).toBe('SEM_CONTRATO');
  });

  it('cada pagamento vem com a nota de recebimento dele, quando há', async () => {
    const nota = { id: 'n1', idFnApagar: 501, assinadoEm: new Date(), baixadaEm: null };
    const { service, prisma } = montar({
      patrocinado,
      titulos: [PAGO_SETEMBRO, ABERTO_OUTUBRO],
      notas: [nota],
    });
    const f = await service.ficha('p1');
    expect(prisma.notaDeRecebimento.findMany.mock.calls[0][0].where).toEqual({
      idFnApagar: { in: [502, 501] },
    });
    expect(f.pagamentos.map((p) => [p.idFnApagar, p.nota?.id ?? null])).toEqual([
      [502, null],
      [501, 'n1'],
    ]);
  });

  it('o IXC fora do ar não fecha a ficha: os pagamentos voltam com o motivo', async () => {
    const { service } = montar({ patrocinado, titulos: new Error('tempo esgotado') });
    const f = await service.ficha('p1');
    expect(f.pagamentos).toEqual([]);
    expect(f.avisoPagamentos).toMatch(/tempo esgotado/);
  });

  it('filtro que não pegou (só títulos de outros) vira aviso, e não "nunca recebeu"', async () => {
    const { service } = montar({
      patrocinado,
      titulos: [{ ...PAGO_SETEMBRO, id_fornecedor: '12' }],
    });
    const f = await service.ficha('p1');
    expect(f.avisoPagamentos).toMatch(/outros fornecedores/);
  });

  it('sem fornecedor, nem pergunta ao IXC', async () => {
    const { service, ixc } = montar({ patrocinado: { ...patrocinado, idFornecedorIxc: null } });
    const f = await service.ficha('p1');
    expect(ixc.listAll).not.toHaveBeenCalled();
    expect(f.pagamentos).toEqual([]);
  });
});

describe('PatrocinioService.pagamentosDoMes', () => {
  it('cada ativo com o mês dele, e um fornecedor ilegível não derruba os outros', async () => {
    const { service, ixc } = montar({
      ativos: [
        { id: 'p1', tipo: 'FIXO', nome: 'Maria Clara', valorMensal: new Prisma.Decimal(300), idFornecedorIxc: 77 },
        { id: 'p2', tipo: 'FIXO', nome: 'Futsal Unidos', valorMensal: new Prisma.Decimal(500), idFornecedorIxc: 88 },
        { id: 'p3', tipo: 'FIXO', nome: 'Sem fornecedor', valorMensal: null, idFornecedorIxc: null },
      ],
    });
    ixc.listAll.mockImplementation(async (...args: unknown[]) => {
      const params = args[1] as { query: string };
      if (params.query === '88') throw new Error('IXC fora do ar');
      return [PAGO_SETEMBRO, ABERTO_OUTUBRO];
    });

    const r = await service.pagamentosDoMes('2026-10');
    expect(ixc.listAll).toHaveBeenCalledTimes(2);
    const [maria, futsal, sem] = r.linhas;
    expect(maria.situacao).toBe('EM_ABERTO');
    expect(maria.mes).toMatchObject({ pago: 0, emAberto: 300 });
    expect(maria.resumo.totalPago).toBe(300);
    expect(futsal.erro).toMatch(/IXC fora do ar/);
    expect(futsal.situacao).toBe('FALTA');
    expect(sem.situacao).toBe('SEM_PAGAMENTO');
    expect(r.totais).toEqual({ combinado: 800, pago: 0, emAberto: 300, faltam: 1, desconto: 0 });
  });

  it('o desconto fica à parte, sem ir ao IXC; o avulso nunca falta nem soma no combinado', async () => {
    const { service, ixc } = montar({
      ativos: [
        { id: 'p1', tipo: 'FIXO', nome: 'Maria Clara', valorMensal: new Prisma.Decimal(300), idFornecedorIxc: 77 },
        { id: 'p2', tipo: 'DESCONTO', nome: 'Ana Ciclista', valorMensal: new Prisma.Decimal(99.9), idFornecedorIxc: 66 },
        // Um valor que sobrou de quando era fixo não faz o avulso "faltar".
        { id: 'p3', tipo: 'AVULSO', nome: 'Grupo de Dança', valorMensal: new Prisma.Decimal(200), idFornecedorIxc: 91 },
      ],
    });
    ixc.listAll.mockImplementation(async (...args: unknown[]) => {
      const params = args[1] as { query: string };
      return params.query === '77' ? [ABERTO_OUTUBRO] : [];
    });

    const r = await service.pagamentosDoMes('2026-10');
    const lidos = (ixc.listAll.mock.calls as unknown[][]).map((c) => (c[1] as { query: string }).query);
    expect(lidos).toEqual(['77', '91']);
    expect(r.linhas.map((l) => [l.patrocinado.nome, l.situacao])).toEqual([
      ['Maria Clara', 'EM_ABERTO'],
      ['Grupo de Dança', 'SEM_PAGAMENTO'],
    ]);
    expect(r.descontos.map((d) => d.nome)).toEqual(['Ana Ciclista']);
    expect(r.totais).toEqual({ combinado: 300, pago: 0, emAberto: 300, faltam: 0, desconto: 99.9 });
  });
});

describe('PatrocinioService.remover', () => {
  it('quem tem contrato ou arquivo é desativado, não apagado', async () => {
    const { service, prisma } = montar({
      patrocinado: { id: 'p1', _count: { contratos: 1, arquivos: 0, notas: 0 } },
    });
    await expect(service.remover('p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.patrocinado.delete).not.toHaveBeenCalled();
  });

  it('quem já tem nota de recebimento também não se apaga', async () => {
    const { service, prisma } = montar({
      patrocinado: { id: 'p1', _count: { contratos: 0, arquivos: 0, notas: 1 } },
    });
    await expect(service.remover('p1')).rejects.toThrow(/nota de recebimento/);
    expect(prisma.patrocinado.delete).not.toHaveBeenCalled();
  });
});
