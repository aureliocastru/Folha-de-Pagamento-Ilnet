import { NotFoundException } from '@nestjs/common';
import {
  GravidadeApr,
  ModoAssinatura,
  StatusApr,
  UserRole,
} from '@prisma/client';
import { AprService, SUBPASTA_DA_SEGURANCA } from './apr.service';

/**
 * A APR liberada é a prova de que aquela pessoa foi orientada antes de subir no
 * poste — e essa prova se procura na pasta dela, não na do serviço. O que este
 * arquivo protege:
 *
 *  - cada executante do cadastro recebe a folha em "Segurança do Trabalho",
 *    dentro da pasta dele, além da cópia do arquivo geral da empresa;
 *  - rearquivar (a supervisão que assina depois, a prorrogação, o
 *    cancelamento) troca a cópia de cada um em vez de empilhar folhas
 *    repetidas na mesma gaveta;
 *  - o terceirizado que apareceu no serviço não tem pasta e não impede a de
 *    ninguém;
 *  - uma pasta que dá erro custa a cópia dela e mais nada — nem as outras
 *    cópias, nem a liberação, que já deixou a equipe subir.
 */

/** Um PNG 1×1, do tamanho de uma assinatura para o desenho do papel. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface ExecutanteDeTeste {
  id: string;
  funcionarioId: string | null;
  nome: string;
  cpf: string | null;
  assinaturaPng: string | null;
  assinadoEm: Date | null;
  modo: ModoAssinatura;
  documentoRhId: string | null;
}

function executante(
  extra: Partial<ExecutanteDeTeste> & { id: string; nome: string },
): ExecutanteDeTeste {
  return {
    funcionarioId: null,
    cpf: null,
    assinaturaPng: PNG,
    assinadoEm: new Date('2026-08-21T10:40:00.000Z'),
    modo: ModoAssinatura.DESENHADA,
    documentoRhId: null,
    ...extra,
  };
}

const WERICK = executante({
  id: 'ex-1',
  funcionarioId: 'f-werick',
  nome: 'Werick da Cruz Costa',
  cpf: '111.111.111-11',
});

const LUAN = executante({
  id: 'ex-2',
  funcionarioId: 'f-luan',
  nome: 'Luan Gomes Martins de Lima',
  cpf: '222.222.222-22',
});

/** Apareceu no dia e não está no cadastro: não tem pasta na estante. */
const TERCEIRO = executante({ id: 'ex-3', nome: 'Zé do guincho' });

/** Onde a cópia do arquivo geral cai: mês a mês, dentro da pasta da empresa. */
const NA_EMPRESA = 'pasta-empresa/Análises de Risco (APR)/2026-08';

/** A pasta de cada funcionário na estante, como `pastaDaPessoa` a acha. */
const PASTAS: Record<string, string> = {
  'f-werick': 'pasta-werick',
  'f-luan': 'pasta-luan',
};

function montarServico(
  opts: {
    executantes?: ExecutanteDeTeste[];
    documentoRhId?: string | null;
    /** Devolve a mensagem do erro quando aquela pasta tem de falhar. */
    erroAoGuardar?: (pastaId: string) => string | undefined;
  } = {},
) {
  const executantes = opts.executantes ?? [WERICK, LUAN];

  const apr = {
    id: 'apr-1',
    numero: 42,
    modeloId: 'modelo-1',
    modelo: { id: 'modelo-1', nome: 'Trabalho em altura' },
    status: StatusApr.LIBERADA,
    empresaNome: 'M A CASTRO SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA LTDA',
    empresaCnpj: '86.876.109/0001-02',
    titulo: 'ANÁLISE DE RISCO PARA TRABALHO EM ALTURA (NR-35/NR-10)',
    tipoTrabalho: 'Trabalho em altura',
    local: 'Rua das Palmeiras, poste 42 — Imperatriz/MA',
    coordenador: 'Werick Castro',
    previsaoInicio: new Date('2026-08-21T00:00:00.000Z'),
    previsaoFim: new Date('2026-08-21T00:00:00.000Z'),
    inicioEm: new Date('2026-08-21T11:00:00.000Z'),
    fimEm: null,
    prorrogacoes: 0,
    motivoProrrogacao: null,
    descricaoEtapas: 'Isolar a área, amarrar a escada, subir e emendar a CTO.',
    gravidade: GravidadeApr.ALTA,
    orientacoes: 'Verificar a OS emitida pelo setor de suporte.',
    planoResgate: 'SAMU 192. Isolar a área e afastar curiosos.',
    telefonesEmergencia: 'SAMU 192 · Bombeiros 193',
    criadoPorId: 'u-1',
    criadoPorNome: 'João da Silva',
    supervisorNome: null,
    supervisorAssinatura: null,
    supervisorEm: null,
    motivoCancelamento: null,
    canceladaEm: null,
    documentoRhId: opts.documentoRhId ?? null,
    respostas: [],
    executantes,
  };

  const guardados: Array<{ pastaId: string; titulo: string; tipo: string }> = [];
  const apagados: string[] = [];
  let sequencia = 0;

  const prisma = {
    apr: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(apr),
      update: jest.fn().mockResolvedValue(apr),
    },
    executanteApr: { update: jest.fn().mockResolvedValue({}) },
    pastaRh: {
      findFirst: jest.fn().mockResolvedValue({ id: 'pasta-empresa' }),
      create: jest.fn(),
    },
  };

  const documentos = {
    pastaDaPessoa: jest.fn(
      async (p: { funcionarioId?: string | null }) =>
        (p.funcionarioId ? PASTAS[p.funcionarioId] : null) ?? null,
    ),
    garantirSubpasta: jest.fn(
      async (paiId: string, nome: string) => `${paiId}/${nome}`,
    ),
    guardar: jest.fn(
      async (dto: { pastaId: string; titulo: string; tipo: string }) => {
        const erro = opts.erroAoGuardar?.(dto.pastaId);
        if (erro) throw new Error(erro);
        guardados.push(dto);
        sequencia += 1;
        return { id: `doc-${sequencia}` };
      },
    ),
    apagar: jest.fn(async (id: string) => {
      apagados.push(id);
      return { apagado: true };
    }),
  };

  const service = new AprService(
    prisma as never,
    {} as never,
    {} as never,
    documentos as never,
    {} as never,
    {} as never,
    {} as never,
  );

  /** Privado de propósito: quem arquiva é o próprio fluxo da APR. */
  const arquivar = () =>
    (
      service as unknown as { arquivarNoRh(id: string): Promise<void> }
    ).arquivarNoRh('apr-1');

  return { arquivar, prisma, documentos, guardados, apagados };
}

describe('a APR arquivada no RH', () => {
  it('guarda a folha na pasta da empresa e na de cada executante', async () => {
    const { arquivar, documentos, guardados, prisma } = montarServico();
    await arquivar();

    expect(guardados.map((g) => g.pastaId)).toEqual([
      NA_EMPRESA,
      `pasta-werick/${SUBPASTA_DA_SEGURANCA}`,
      `pasta-luan/${SUBPASTA_DA_SEGURANCA}`,
    ]);

    // A divisória nasce dentro da pasta da pessoa, e é sempre a mesma.
    expect(documentos.garantirSubpasta).toHaveBeenCalledWith(
      'pasta-werick',
      SUBPASTA_DA_SEGURANCA,
    );

    // É a mesma folha em todas: mesmo título, mesmo tipo.
    expect(new Set(guardados.map((g) => g.titulo)).size).toBe(1);
    expect(guardados[0].titulo).toContain('APR nº 42');

    // Cada cópia fica amarrada a quem ela prova ter sido orientado.
    expect(prisma.executanteApr.update).toHaveBeenCalledWith({
      where: { id: 'ex-1' },
      data: { documentoRhId: 'doc-2' },
    });
    expect(prisma.executanteApr.update).toHaveBeenCalledWith({
      where: { id: 'ex-2' },
      data: { documentoRhId: 'doc-3' },
    });
  });

  it('troca a cópia velha em vez de empilhar folhas repetidas', async () => {
    const { arquivar, apagados } = montarServico({
      documentoRhId: 'doc-empresa-velho',
      executantes: [
        { ...WERICK, documentoRhId: 'doc-werick-velho' },
        { ...LUAN, documentoRhId: null },
      ],
    });
    await arquivar();

    expect(apagados).toEqual(['doc-empresa-velho', 'doc-werick-velho']);
  });

  it('quem não tem pasta fica só na cópia da empresa', async () => {
    const { arquivar, guardados, prisma } = montarServico({
      executantes: [WERICK, TERCEIRO],
    });
    await arquivar();

    expect(guardados.map((g) => g.pastaId)).toEqual([
      NA_EMPRESA,
      `pasta-werick/${SUBPASTA_DA_SEGURANCA}`,
    ]);
    expect(prisma.executanteApr.update).toHaveBeenCalledTimes(1);
  });

  it('a pasta que dá erro custa só a cópia dela', async () => {
    const { arquivar, guardados, prisma } = montarServico({
      erroAoGuardar: (pastaId) =>
        pastaId.startsWith('pasta-werick') ? 'disco cheio' : undefined,
    });

    // Não lança: a equipe já subiu no poste, e a estante não desfaz isso.
    await expect(arquivar()).resolves.toBeUndefined();

    expect(guardados.map((g) => g.pastaId)).toEqual([
      NA_EMPRESA,
      `pasta-luan/${SUBPASTA_DA_SEGURANCA}`,
    ]);
    expect(prisma.executanteApr.update).toHaveBeenCalledWith({
      where: { id: 'ex-2' },
      data: { documentoRhId: 'doc-2' },
    });
  });
});

/**
 * Apagar a APR é a única porta do módulo que não deixa rastro. O que se protege
 * aqui é que ela não deixe rastro pela metade: uma APR apagada cuja folha
 * continua na pasta de três pessoas vira um documento sem origem, que ninguém
 * sabe mais de onde veio.
 */
describe('a APR apagada pelo admin', () => {
  const ADMIN = { id: 'u-1', nome: 'Henrico', role: UserRole.ADMIN };

  function montar(copias: {
    daEmpresa: string | null;
    dosExecutantes: (string | null)[];
  }) {
    const apagados: string[][] = [];

    const tx = {
      documentoRh: {
        deleteMany: jest.fn(
          async ({ where }: { where: { id: { in: string[] } } }) => {
            apagados.push(where.id.in);
            return { count: where.id.in.length };
          },
        ),
      },
      apr: { delete: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      apr: {
        findUnique: jest.fn().mockResolvedValue({
          numero: 42,
          local: 'Rua das Palmeiras, poste 42',
          status: StatusApr.CANCELADA,
          documentoRhId: copias.daEmpresa,
          executantes: copias.dosExecutantes.map((documentoRhId) => ({
            documentoRhId,
          })),
        }),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const service = new AprService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, tx, apagados };
  }

  it('leva junto as cópias do RH: a da empresa e a de cada executante', async () => {
    const { service, tx, apagados } = montar({
      daEmpresa: 'doc-empresa',
      // O do meio é o terceirizado, que nunca teve pasta.
      dosExecutantes: ['doc-werick', null, 'doc-luan'],
    });

    const resultado = await service.excluir('apr-1', ADMIN);

    expect(apagados).toEqual([['doc-empresa', 'doc-werick', 'doc-luan']]);
    expect(tx.apr.delete).toHaveBeenCalledWith({ where: { id: 'apr-1' } });
    expect(resultado).toEqual({
      apagada: true,
      numero: 42,
      copiasRemovidas: 3,
    });
  });

  it('não mexe na estante quando a APR nunca chegou a ser arquivada', async () => {
    const { service, tx } = montar({ daEmpresa: null, dosExecutantes: [null] });

    await service.excluir('apr-1', ADMIN);

    expect(tx.documentoRh.deleteMany).not.toHaveBeenCalled();
    expect(tx.apr.delete).toHaveBeenCalled();
  });

  it('avisa quando a APR já não existe, em vez de apagar o nada', async () => {
    const { service, prisma, tx } = montar({
      daEmpresa: null,
      dosExecutantes: [],
    });
    prisma.apr.findUnique.mockResolvedValue(null);

    await expect(service.excluir('apr-1', ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.apr.delete).not.toHaveBeenCalled();
  });
});
