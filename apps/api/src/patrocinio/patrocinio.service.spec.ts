import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PatrocinioService } from './patrocinio.service';

/**
 * O que este arquivo protege: todo patrocinado tem por onde receber, um
 * fornecedor paga um patrocinado só — senão "quanto já mandei" de um somaria o
 * dinheiro do outro —, e o que já se mandou vem dos títulos do fornecedor.
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
        { id: 'p1', nome: 'Maria Clara', valorMensal: new Prisma.Decimal(300), idFornecedorIxc: 77 },
        { id: 'p2', nome: 'Futsal Unidos', valorMensal: new Prisma.Decimal(500), idFornecedorIxc: 88 },
        { id: 'p3', nome: 'Sem fornecedor', valorMensal: null, idFornecedorIxc: null },
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
    expect(r.totais).toEqual({ combinado: 800, pago: 0, emAberto: 300, faltam: 1 });
  });
});

describe('PatrocinioService.remover', () => {
  it('quem tem contrato ou arquivo é desativado, não apagado', async () => {
    const { service, prisma } = montar({
      patrocinado: { id: 'p1', _count: { contratos: 1, arquivos: 0 } },
    });
    await expect(service.remover('p1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.patrocinado.delete).not.toHaveBeenCalled();
  });
});
