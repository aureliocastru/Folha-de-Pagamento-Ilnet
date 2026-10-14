import { BadRequestException } from '@nestjs/common';
import { FormaPagamento, Prisma, StatusContaPagar } from '@prisma/client';
import { PatrocinioService } from './patrocinio.service';

/**
 * O que este arquivo protege: todo patrocinado tem por onde receber, e um
 * cadastro de diarista paga um patrocinado só — senão "quanto já mandei" de um
 * somaria o dinheiro do outro.
 */

function montar(
  opts: {
    diarista?: Record<string, unknown> | null;
    patrocinado?: Record<string, unknown> | null;
    diarias?: Array<Record<string, unknown>>;
    criarFalha?: Error;
  } = {},
) {
  const prisma = {
    diarista: {
      findUnique: jest.fn().mockResolvedValue(
        opts.diarista === undefined ? { id: 'd1', nome: 'João', patrocinado: null } : opts.diarista,
      ),
    },
    patrocinado: {
      findUnique: jest.fn().mockResolvedValue(opts.patrocinado ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.criarFalha) throw opts.criarFalha;
        return { id: 'p1', ...data };
      }),
      delete: jest.fn(),
    },
    diaria: { findMany: jest.fn().mockResolvedValue(opts.diarias ?? []) },
  };
  const diaristas = {
    criar: jest.fn().mockResolvedValue({
      diarista: { id: 'd-novo' },
      ixc: { erro: 'IXC fora do ar' },
    }),
  };
  const service = new PatrocinioService(prisma as never, diaristas as never);
  return { service, prisma, diaristas };
}

describe('PatrocinioService.criar', () => {
  it('sem diarista e sem quem recebe, recusa: patrocinado tem de ter por onde receber', async () => {
    const { service, prisma } = montar();
    await expect(service.criar({ nome: 'Maria Clara' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.patrocinado.create).not.toHaveBeenCalled();
  });

  it('cria o diarista de quem recebe pelo caminho da aba Diaristas, e devolve o aviso do IXC', async () => {
    const { service, prisma, diaristas } = montar();
    const r = await service.criar(
      {
        nome: 'Futsal Unidos',
        responsavel: 'Carlos',
        valorMensal: 500,
        inicio: '2026-10-01',
        recebedor: { nome: ' Carlos Alberto ', chavePix: 'carlos@pix', formaPagamento: FormaPagamento.EM_MAOS },
      },
      'u1',
    );

    expect(diaristas.criar).toHaveBeenCalledWith(
      expect.objectContaining({
        nome: 'Carlos Alberto',
        chavePix: 'carlos@pix',
        formaPagamento: FormaPagamento.EM_MAOS,
      }),
    );
    const { data } = prisma.patrocinado.create.mock.calls[0][0];
    expect(data).toMatchObject({ nome: 'Futsal Unidos', diaristaId: 'd-novo', responsavel: 'Carlos', criadoPor: 'u1' });
    expect(data.valorMensal).toEqual(new Prisma.Decimal(500));
    expect((data.inicio as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.avisoIxc).toBe('IXC fora do ar');
  });

  it('liga a um diarista que já existe, sem criar outro', async () => {
    const { service, prisma, diaristas } = montar();
    await service.criar({ nome: 'Maria Clara', diaristaId: 'd1' });
    expect(diaristas.criar).not.toHaveBeenCalled();
    expect(prisma.patrocinado.create.mock.calls[0][0].data.diaristaId).toBe('d1');
  });

  it('diarista que já paga outro patrocinado é recusado, com o nome de quem', async () => {
    const { service } = montar({
      diarista: { id: 'd1', nome: 'João', patrocinado: { id: 'outro', nome: 'Vôlei da Vila' } },
    });
    await expect(service.criar({ nome: 'Maria Clara', diaristaId: 'd1' })).rejects.toThrow(/Vôlei da Vila/);
  });

  it('duas telas ligando o mesmo diarista ao mesmo tempo: o banco desempata com frase', async () => {
    const unico = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    const { service } = montar({ criarFalha: unico });
    await expect(service.criar({ nome: 'Maria Clara', diaristaId: 'd1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PatrocinioService.ficha', () => {
  it('lê o que se mandou das diárias do diarista ligado', async () => {
    const { service } = montar({
      patrocinado: {
        id: 'p1',
        nome: 'Maria Clara',
        diaristaId: 'd1',
        diarista: { id: 'd1', nome: 'Maria Clara' },
        contratos: [],
        arquivos: [],
      },
      diarias: [
        {
          id: 'x1',
          data: new Date('2026-09-05T00:00:00Z'),
          valor: new Prisma.Decimal(300),
          descricao: 'Patrocínio de setembro',
          forma: FormaPagamento.IXC,
          contaPagar: { status: StatusContaPagar.PAGO },
          assinatura: null,
        },
        {
          id: 'x2',
          data: new Date('2026-10-05T00:00:00Z'),
          valor: new Prisma.Decimal(300),
          descricao: 'Patrocínio de outubro',
          forma: FormaPagamento.IXC,
          contaPagar: { status: StatusContaPagar.AGUARDANDO_APROVACAO },
          assinatura: null,
        },
      ],
    });

    const f = await service.ficha('p1');
    expect(f.pagamentos.map((p) => p.situacao)).toEqual(['PAGO', 'AGUARDANDO']);
    expect(f.resumo.totalPago).toBe(300);
    expect(f.resumo.totalAguardando).toBe(300);
    expect(f.contrato).toBe('SEM_CONTRATO');
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
