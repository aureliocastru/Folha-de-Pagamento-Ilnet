import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { GravidadeApr, Prisma, StatusApr, UserRole } from '@prisma/client';
import { AprService, type AutorApr } from './apr.service';

/**
 * A APR que vem com a OS (pedido de 24/11/2026). O que este arquivo protege:
 *
 *  - o técnico não abre APR solta: só pela OS, e a OS tem de ser dele, estar
 *    aberta e ter assunto que pede APR;
 *  - uma APR valendo por OS — a segunda é recusada; o rascunho de quem tinha
 *    a OS antes sai cancelado, dizendo por quê;
 *  - ao liberar, o PDF vai à aba "Arquivos" da OS no IXC, uma vez, com a
 *    descrição que a reconhece;
 *  - o IXC que falha não derruba a liberação: o motivo fica anotado, e a
 *    tentativa seguinte procura na OS antes de mandar de novo.
 */

const TECNICO: AutorApr = { id: 'u1', nome: 'Cleyson', role: UserRole.TECNICO };

const OS = { id: 3788, status: 'EX', assuntoId: 4, tecnicoId: 17 };

/** Uma APR do banco, com o que o PDF e a tela leem. */
function aprDoBanco(campos: Record<string, unknown> = {}) {
  return {
    id: 'apr1',
    numero: 31,
    modeloId: 'm1',
    modelo: { id: 'm1', nome: 'Trabalho em altura' },
    status: StatusApr.LIBERADA,
    empresaNome: 'ILNET',
    empresaCnpj: null,
    titulo: 'Análise Preliminar de Risco',
    tipoTrabalho: 'Trabalho em altura',
    local: 'Maria da Silva — Rua das Palmeiras, 42',
    coordenador: 'Cleyson',
    previsaoInicio: null,
    previsaoFim: null,
    inicioEm: new Date('2026-11-24T12:00:00Z'),
    fimEm: null,
    prorrogacoes: 0,
    motivoProrrogacao: null,
    descricaoEtapas: 'Subir no poste e trocar o drop.',
    gravidade: GravidadeApr.ALTA,
    orientacoes: 'Use o cinto.',
    planoResgate: 'Ligue 192.',
    telefonesEmergencia: '',
    criadoPorId: 'u1',
    criadoPorNome: 'Cleyson',
    supervisorNome: null,
    supervisorAssinatura: null,
    supervisorEm: null,
    motivoCancelamento: null,
    canceladaEm: null,
    visualizouPdfEm: new Date(),
    documentoRhId: null,
    osIxcId: OS.id,
    arquivoNaOsIxcId: null,
    arquivoNaOsEm: null,
    arquivoNaOsErro: null,
    respostas: [],
    executantes: [],
    ...campos,
  };
}

function montar(
  opcoes: {
    assunto?: string;
    atual?: Record<string, unknown> | null;
    apr?: ReturnType<typeof aprDoBanco>;
    criar?: (pedido: { data: Record<string, unknown> }) => Promise<unknown>;
    arquivosDaOs?: Array<{ id: number; descricao: string }>;
    upload?: () => Promise<unknown>;
  } = {},
) {
  let apr = opcoes.apr ?? aprDoBanco();
  const prisma = {
    $queryRaw: jest.fn(async () => [{ nextval: BigInt(32) }]),
    apr: {
      findFirst: jest.fn(async () => opcoes.atual ?? null),
      findUnique: jest.fn(async () => apr),
      create: jest.fn(
        opcoes.criar ??
          (async ({ data }: { data: Record<string, unknown> }) =>
            aprDoBanco({ osIxcId: data.osIxcId, id: 'apr2', status: StatusApr.RASCUNHO })),
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        apr = { ...apr, ...data } as typeof apr;
        return apr;
      }),
    },
    itemApr: { findMany: jest.fn(async () => []) },
  };
  const catalogo = {
    formulario: jest.fn(async () => ({
      modelo: {
        id: 'm1',
        titulo: 'Análise Preliminar de Risco',
        tipoTrabalho: 'Trabalho em altura',
        orientacoes: 'Use o cinto.',
        planoResgate: 'Ligue 192.',
        telefonesEmergencia: '',
      },
    })),
  };
  const config = { obter: jest.fn(async () => ({ empresaNome: 'ILNET', empresaCnpj: '' })) };
  const ixc = {
    upload: jest.fn(opcoes.upload ?? (async () => ({ type: 'success', id: '4401' }))),
  };
  const os = {
    contexto: jest.fn(async () => ({ tecnico: {}, os: OS })),
  };
  const doIxc = {
    nomesDosAssuntos: jest.fn(async () => new Map([[4, opcoes.assunto ?? 'Inst Fibra']])),
    arquivosDaOs: jest.fn(async () => opcoes.arquivosDaOs ?? []),
  };

  const service = new AprService(
    prisma as never,
    catalogo as never,
    config as never,
    {} as never,
    ixc as never,
    os as never,
    doIxc as never,
  );
  // Os avisos de "não consegui" são esperados aqui, e só sujariam a saída.
  (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger = {
    log: jest.fn(),
    warn: jest.fn(),
  };
  const anexar = () =>
    (service as unknown as { anexarNaOs(id: string): Promise<void> }).anexarNaOs('apr1');
  return { service, prisma, ixc, os, doIxc, anexar, atual: () => apr };
}

const NOVA = { local: 'Maria da Silva — Rua das Palmeiras, 42', coordenador: 'Cleyson' };

describe('a APR nova do técnico', () => {
  it('sem OS, o técnico não abre', async () => {
    const t = montar();
    await expect(t.service.criar(NOVA, TECNICO)).rejects.toThrow(ForbiddenException);
    expect(t.prisma.apr.create).not.toHaveBeenCalled();
  });

  it('a Segurança do Trabalho ainda abre a avulsa', async () => {
    const t = montar();
    await t.service.criar(NOVA, { id: 'rh1', nome: 'Ana', role: UserRole.RH });
    expect(t.prisma.apr.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ osIxcId: null }) }),
    );
  });

  it('pela OS, confere que ela é do técnico e liga a APR a ela', async () => {
    const t = montar();
    await t.service.criar({ ...NOVA, osIxcId: OS.id }, TECNICO);
    expect(t.os.contexto).toHaveBeenCalledWith({ id: 'u1', nome: 'Cleyson' }, OS.id);
    expect(t.prisma.apr.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ osIxcId: OS.id }) }),
    );
  });

  it('a OS de escritório não pede APR', async () => {
    const t = montar({ assunto: 'Conferencia de contrato e Gerar financeiro' });
    await expect(t.service.criar({ ...NOVA, osIxcId: OS.id }, TECNICO)).rejects.toThrow(
      /não pede análise de risco/,
    );
  });

  it('a OS que já tem APR valendo não ganha outra', async () => {
    const t = montar({
      atual: { id: 'apr1', numero: 31, status: StatusApr.LIBERADA, criadoPorId: 'u9', criadoPorNome: 'Outro' },
    });
    await expect(t.service.criar({ ...NOVA, osIxcId: OS.id }, TECNICO)).rejects.toThrow(/já tem a APR nº 31/);
    expect(t.prisma.apr.create).not.toHaveBeenCalled();
  });

  it('o rascunho de quem tinha a OS sai cancelado, dizendo por quê', async () => {
    const t = montar({
      atual: { id: 'apr0', numero: 30, status: StatusApr.RASCUNHO, criadoPorId: 'u9', criadoPorNome: 'Outro' },
    });
    await t.service.criar({ ...NOVA, osIxcId: OS.id }, TECNICO);
    expect(t.prisma.apr.update).toHaveBeenCalledWith({
      where: { id: 'apr0' },
      data: expect.objectContaining({
        status: StatusApr.CANCELADA,
        motivoCancelamento: expect.stringMatching(/OS 3788 passou para Cleyson/),
      }),
    });
    expect(t.prisma.apr.create).toHaveBeenCalled();
  });

  it('o segundo toque, barrado pelo índice, vira recado e não erro do banco', async () => {
    const t = montar({
      criar: async () => {
        throw new Prisma.PrismaClientKnownRequestError('único', { code: 'P2002', clientVersion: 'x' });
      },
    });
    await expect(t.service.criar({ ...NOVA, osIxcId: OS.id }, TECNICO)).rejects.toThrow(BadRequestException);
  });
});

describe('o PDF da APR liberada na OS do IXC', () => {
  it('vai para a aba "Arquivos" da OS, com a descrição que a reconhece', async () => {
    const t = montar();
    await t.anexar();
    expect(t.ixc.upload).toHaveBeenCalledWith(
      'su_oss_chamado_arquivos',
      'local_arquivo',
      expect.objectContaining({ nome: 'APR-0031-2026-11-24.pdf', tipo: 'application/pdf' }),
      { id_oss_chamado: '3788', descricao: 'Análise de Risco (APR) nº 31', classificacao_arquivo: 'P' },
    );
    expect(t.atual()).toMatchObject({ arquivoNaOsIxcId: 4401, arquivoNaOsErro: null });
  });

  it('a que já foi não vai de novo, e a APR sem OS nem a rascunho não vão', async () => {
    for (const apr of [
      aprDoBanco({ arquivoNaOsIxcId: 4401 }),
      aprDoBanco({ osIxcId: null }),
      aprDoBanco({ status: StatusApr.RASCUNHO }),
    ]) {
      const t = montar({ apr });
      await t.anexar();
      expect(t.ixc.upload).not.toHaveBeenCalled();
    }
  });

  it('o IXC que falha não derruba quem chamou: o motivo fica anotado', async () => {
    const t = montar({
      upload: async () => {
        throw new ServiceUnavailableException('IXC fora do ar');
      },
    });
    await expect(t.anexar()).resolves.toBeUndefined();
    expect(t.atual()).toMatchObject({ arquivoNaOsIxcId: null, arquivoNaOsErro: 'IXC fora do ar' });
  });

  it('depois de um erro, procura na OS antes de mandar de novo', async () => {
    const t = montar({
      apr: aprDoBanco({ arquivoNaOsErro: 'tempo esgotado' }),
      arquivosDaOs: [{ id: 4402, descricao: 'Analise de Risco (APR) nº 31' }],
    });
    await t.anexar();
    expect(t.ixc.upload).not.toHaveBeenCalled();
    expect(t.atual()).toMatchObject({ arquivoNaOsIxcId: 4402, arquivoNaOsErro: null });
  });

  it('o IXC que responde sem o número do arquivo conta como não foi', async () => {
    const t = montar({ upload: async () => ({ type: 'success' }) });
    await t.anexar();
    expect(t.atual()).toMatchObject({
      arquivoNaOsIxcId: null,
      arquivoNaOsErro: expect.stringMatching(/sem o número do arquivo/),
    });
  });

  it('mandar de novo pela tela só vale para a APR liberada de uma OS', async () => {
    const semOs = montar({ apr: aprDoBanco({ osIxcId: null }) });
    await expect(semOs.service.reenviarParaAOs('apr1', TECNICO)).rejects.toThrow(/não é de uma ordem de serviço/);
    const rascunho = montar({ apr: aprDoBanco({ status: StatusApr.RASCUNHO }) });
    await expect(rascunho.service.reenviarParaAOs('apr1', TECNICO)).rejects.toThrow(/quando é liberada/);
  });
});
