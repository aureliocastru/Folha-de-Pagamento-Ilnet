import { BadRequestException } from '@nestjs/common';
import {
  CategoriaItemApr,
  GravidadeApr,
  ModoAssinatura,
  RespostaRelato,
  StatusApr,
  UserRole,
} from '@prisma/client';
import { AprService } from './apr.service';

/**
 * O que a assinatura vale, e o que se pode fazer com a APR depois do serviço.
 *
 *  - quem assinou declarou conhecer os riscos marcados: mudar a análise depois
 *    disso desfaz as assinaturas, e todos assinam de novo o papel como ficou;
 *  - salvar sem mudar nada, ou só acrescentar gente à equipe, não desfaz nada
 *    — é o que acontece a cada "Continuar" e a cada executante que entra;
 *  - a APR encerrada registra um serviço que aconteceu: não se prorroga, não
 *    se cancela e não se encerra de novo;
 *  - a prorrogação estica a previsão de término, e não o fim de verdade.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TECNICO = { id: 'u-1', nome: 'João da Silva', role: UserRole.TECNICO };

/** O catálogo do modelo: um risco e uma pergunta do relato bastam. */
const ITENS = [
  {
    id: 'i-risco',
    modeloId: 'modelo-1',
    categoria: CategoriaItemApr.RISCO,
    texto: 'Quedas de altura',
    ordem: 10,
    pedeDetalhe: false,
    exigeProvidencia: false,
    marcadoPorPadrao: true,
    ativo: true,
  },
  {
    id: 'i-clima',
    modeloId: 'modelo-1',
    categoria: CategoriaItemApr.RELATO,
    texto: 'As condições atmosféricas são favoráveis?',
    ordem: 10,
    pedeDetalhe: false,
    exigeProvidencia: true,
    marcadoPorPadrao: false,
    ativo: true,
  },
];

function executante(id: string, nome: string, assinado: boolean) {
  return {
    id,
    aprId: 'apr-1',
    funcionarioId: null,
    nome,
    cpf: null,
    assinaturaPng: assinado ? PNG : null,
    assinadoEm: assinado ? new Date('2026-08-21T10:40:00.000Z') : null,
    modo: ModoAssinatura.DESENHADA,
    ip: null,
    userAgent: null,
    documentoRhId: null,
  };
}

function montar(
  opts: {
    status?: StatusApr;
    fimEm?: Date | null;
    executantes?: ReturnType<typeof executante>[];
  } = {},
) {
  const apr = {
    id: 'apr-1',
    numero: 42,
    modeloId: 'modelo-1',
    modelo: { id: 'modelo-1', nome: 'Trabalho em altura' },
    status: opts.status ?? StatusApr.RASCUNHO,
    local: 'Rua das Palmeiras, poste 42',
    coordenador: 'Werick Castro',
    descricaoEtapas: 'Isolar a área, amarrar a escada, subir e emendar a CTO.',
    gravidade: GravidadeApr.ALTA,
    inicioEm: new Date('2026-08-21T10:00:00.000Z'),
    fimEm: opts.fimEm ?? null,
    previsaoInicio: null,
    previsaoFim: new Date('2026-08-21T00:00:00.000Z'),
    prorrogacoes: 0,
    motivoProrrogacao: null,
    criadoPorId: 'u-1',
    criadoPorNome: 'João da Silva',
    visualizouPdfEm: new Date('2026-08-21T10:30:00.000Z'),
    documentoRhId: null,
    respostas: [
      {
        id: 'r-1',
        aprId: 'apr-1',
        itemId: 'i-risco',
        categoria: CategoriaItemApr.RISCO,
        texto: 'Quedas de altura',
        ordem: 10,
        marcado: true,
        resposta: null,
        detalhe: null,
      },
      {
        id: 'r-2',
        aprId: 'apr-1',
        itemId: 'i-clima',
        categoria: CategoriaItemApr.RELATO,
        texto: 'As condições atmosféricas são favoráveis?',
        ordem: 10,
        marcado: false,
        resposta: RespostaRelato.SIM,
        detalhe: null,
      },
    ],
    executantes: opts.executantes ?? [executante('ex-1', 'João da Silva', true)],
  };

  const tx = {
    respostaApr: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    executanteApr: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    documentoRh: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    apr: { update: jest.fn().mockResolvedValue(apr) },
  };

  const prisma = {
    apr: {
      findUnique: jest.fn().mockResolvedValue(apr),
      // A estante do RH não é assunto aqui: arquivar falha calado, como
      // falharia em produção sem derrubar quem o chamou.
      findUniqueOrThrow: jest.fn().mockRejectedValue(new Error('fora do teste')),
      update: jest.fn().mockResolvedValue(apr),
    },
    itemApr: { findMany: jest.fn().mockResolvedValue(ITENS) },
    funcionario: { findMany: jest.fn().mockResolvedValue([]) },
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
  // O aviso de "não consegui arquivar" é esperado aqui, e só sujaria a saída.
  (service as unknown as { logger: { log: jest.Mock; warn: jest.Mock } }).logger =
    { log: jest.fn(), warn: jest.fn() };

  return { service, prisma, tx, apr };
}

/** O que a tela manda a cada "Continuar": o formulário inteiro. */
function corpo(extra: Record<string, unknown> = {}) {
  return {
    local: 'Rua das Palmeiras, poste 42',
    coordenador: 'Werick Castro',
    descricaoEtapas: 'Isolar a área, amarrar a escada, subir e emendar a CTO.',
    gravidade: GravidadeApr.ALTA,
    respostas: [
      { itemId: 'i-risco', marcado: true },
      { itemId: 'i-clima', resposta: RespostaRelato.SIM },
    ],
    executantes: [{ nome: 'João da Silva' }],
    ...extra,
  };
}

describe('a assinatura cobre o papel que estava na frente', () => {
  it('desmarcar um risco depois de assinado desfaz as assinaturas', async () => {
    const { service, tx } = montar();

    const resultado = await service.atualizar(
      'apr-1',
      corpo({
        respostas: [
          { itemId: 'i-risco', marcado: false },
          { itemId: 'i-clima', resposta: RespostaRelato.SIM },
        ],
      }) as never,
      TECNICO,
    );

    expect(tx.executanteApr.updateMany).toHaveBeenCalledWith({
      where: { aprId: 'apr-1', assinadoEm: { not: null } },
      data: {
        assinaturaPng: null,
        assinadoEm: null,
        modo: ModoAssinatura.DESENHADA,
        ip: null,
        userAgent: null,
      },
    });
    expect(resultado.assinaturasDesfeitas).toBe(1);
  });

  it('trocar a resposta do relato também desfaz', async () => {
    const { service, tx } = montar();

    await service.atualizar(
      'apr-1',
      corpo({
        respostas: [
          { itemId: 'i-risco', marcado: true },
          {
            itemId: 'i-clima',
            resposta: RespostaRelato.NAO,
            detalhe: 'Esperamos a chuva passar',
          },
        ],
      }) as never,
      TECNICO,
    );

    expect(tx.executanteApr.updateMany).toHaveBeenCalled();
  });

  it('salvar de novo sem mudar nada não toca nas assinaturas', async () => {
    const { service, tx } = montar();

    const resultado = await service.atualizar('apr-1', corpo() as never, TECNICO);

    expect(tx.executanteApr.updateMany).not.toHaveBeenCalled();
    expect(resultado.assinaturasDesfeitas).toBe(0);
  });

  it('acrescentar alguém à equipe não desfaz a assinatura de quem já assinou', async () => {
    const { service, tx } = montar();

    await service.atualizar(
      'apr-1',
      corpo({
        executantes: [{ nome: 'João da Silva' }, { nome: 'Maria Souza' }],
      }) as never,
      TECNICO,
    );

    expect(tx.executanteApr.updateMany).not.toHaveBeenCalled();
    expect(tx.executanteApr.createMany).toHaveBeenCalledWith({
      data: [
        { funcionarioId: null, nome: 'Maria Souza', cpf: null, aprId: 'apr-1' },
      ],
    });
  });

  it('sem ninguém assinado, mudar a análise não mexe em assinatura', async () => {
    const { service, tx } = montar({
      executantes: [executante('ex-1', 'João da Silva', false)],
    });

    const resultado = await service.atualizar(
      'apr-1',
      corpo({ gravidade: GravidadeApr.MEDIA }) as never,
      TECNICO,
    );

    expect(tx.executanteApr.updateMany).not.toHaveBeenCalled();
    expect(resultado.assinaturasDesfeitas).toBe(0);
  });
});

describe('a APR depois do serviço', () => {
  const ENCERRADA = {
    status: StatusApr.LIBERADA,
    fimEm: new Date('2026-08-21T17:00:00.000Z'),
  };

  it('a encerrada não se prorroga', async () => {
    const { service, prisma } = montar(ENCERRADA);

    await expect(
      service.prorrogar('apr-1', { motivo: 'Faltou terminar' } as never, TECNICO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.apr.update).not.toHaveBeenCalled();
  });

  it('a encerrada não se cancela', async () => {
    const { service, prisma } = montar(ENCERRADA);

    await expect(
      service.cancelar('apr-1', { motivo: 'Aberta por engano' } as never, TECNICO),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.apr.update).not.toHaveBeenCalled();
  });

  it('a encerrada não se encerra de novo', async () => {
    const { service, prisma } = montar(ENCERRADA);

    await expect(service.encerrar('apr-1', TECNICO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.apr.update).not.toHaveBeenCalled();
  });

  it('encerrar com uma data que não é data é recusado, e não um erro 500', async () => {
    const { service, prisma } = montar({ status: StatusApr.LIBERADA });

    await expect(
      service.encerrar('apr-1', TECNICO, 'ontem à tarde'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.apr.update).not.toHaveBeenCalled();
  });

  it('a prorrogação estica a previsão, e não encerra o serviço', async () => {
    const { service, prisma } = montar({ status: StatusApr.LIBERADA });

    await service.prorrogar(
      'apr-1',
      { motivo: 'Chuva parou o serviço', previsaoFim: '2026-08-23' } as never,
      TECNICO,
    );

    const { data } = prisma.apr.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data).toEqual({
      prorrogacoes: 1,
      motivoProrrogacao: '1ª: Chuva parou o serviço',
      previsaoFim: new Date('2026-08-23T00:00:00.000Z'),
    });
    expect(data).not.toHaveProperty('fimEm');
  });
});
