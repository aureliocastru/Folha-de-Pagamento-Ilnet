import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { FormaPagamento } from '@prisma/client';
import { AssinaturasService } from './assinaturas.service';

/**
 * O que este arquivo protege: um recibo assinado é papel de quitação. Ele não
 * pode mudar depois de assinado, não pode ser assinado duas vezes, não pode
 * existir para pagamento que já tem comprovante de banco, e o link que leva a
 * ele não pode viver para sempre.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const DIARISTA = {
  id: 'd1',
  nome: 'João da Silva',
  cpfCnpj: '123.456.789-00',
};

const DIARIA = {
  id: 'dia1',
  diaristaId: 'd1',
  data: new Date('2026-08-10T00:00:00Z'),
  quantidade: 2,
  valorDiaria: 120,
  vendas: 0,
  valorPorVenda: 0,
  valorExtra: 50,
  descricaoExtra: 'material',
  valor: 290,
  descricao: 'Roçada do terreno',
  forma: FormaPagamento.EM_MAOS,
  diarista: DIARISTA,
  assinatura: null as Record<string, unknown> | null,
};

const CFG = { empresaNome: 'ILNET', empresaCnpj: '12.345.678/0001-99' };

function montarServico(
  opts: {
    diaria?: Record<string, unknown> | null;
    assinatura?: Record<string, unknown> | null;
  } = {},
) {
  const guardado: Record<string, unknown>[] = [];

  const prisma = {
    diaria: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.diaria === undefined ? DIARIA : opts.diaria),
    },
    assinaturaDiaria: {
      findUnique: jest.fn().mockResolvedValue(opts.assinatura ?? null),
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          // Reabrindo uma diária que já tem assinatura, é o `update` que vale.
          const usado = opts.diaria &&
            (opts.diaria as { assinatura?: { assinadoEm?: Date } }).assinatura
              ?.assinadoEm
            ? update
            : create;
          guardado.push(usado);
          return { ...usado, id: 'a1' };
        },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        guardado.push(data);
        return { ...(opts.assinatura ?? {}), ...data };
      }),
    },
  };

  const config = { obter: jest.fn().mockResolvedValue(CFG) };

  const service = new AssinaturasService(
    prisma as never,
    config as never,
  );
  return { service, prisma, guardado };
}

/** Uma assinatura já gravada, do jeito que o banco a devolve. */
function assinaturaGravada(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    diariaId: 'dia1',
    token: 'tok',
    expiraEm: new Date(Date.now() + 60_000),
    assinaturaPng: null,
    assinadoEm: null,
    nomeAssinante: null,
    cpfAssinante: DIARISTA.cpfCnpj,
    valor: 290,
    descricao: 'Roçada do terreno',
    dataDiaria: DIARIA.data,
    detalhamento: '2 diárias de R$ 120,00 · extra R$ 50,00: material',
    empresaNome: 'ILNET',
    empresaCnpj: '12.345.678/0001-99',
    ip: null,
    userAgent: null,
    diaria: { ...DIARIA, diarista: DIARISTA },
    ...over,
  };
}

describe('gerar o link', () => {
  it('congela valor, serviço e quem paga no momento em que o recibo nasce', async () => {
    const { service, guardado } = montarServico();

    await service.gerarLink('dia1', 'u1');

    expect(guardado[0]).toMatchObject({
      valor: 290,
      descricao: 'Roçada do terreno',
      empresaNome: 'ILNET',
      empresaCnpj: '12.345.678/0001-99',
      cpfAssinante: '123.456.789-00',
      criadoPor: 'u1',
    });
    // A composição vai junto: o recibo diz de onde saiu o total.
    expect(guardado[0].detalhamento).toContain('2 diárias de R$ 120,00');
    expect(guardado[0].detalhamento).toContain('extra R$ 50,00: material');
  });

  it('sorteia um token diferente a cada link', async () => {
    const { service, guardado } = montarServico();

    await service.gerarLink('dia1');
    await service.gerarLink('dia1');

    expect(guardado[0].token).not.toBe(guardado[1].token);
    expect(String(guardado[0].token).length).toBeGreaterThan(30);
  });

  it('dá uma semana de prazo', async () => {
    const { service, guardado } = montarServico();

    await service.gerarLink('dia1');

    const prazo = Number(guardado[0].expiraEm) - Date.now();
    expect(prazo).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(prazo).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });

  it('recusa diária paga pelo IXC — o comprovante dela é o do banco', async () => {
    const { service } = montarServico({
      diaria: { ...DIARIA, forma: FormaPagamento.IXC },
    });

    await expect(service.gerarLink('dia1')).rejects.toThrow(BadRequestException);
  });

  it('não reabre o que já foi assinado', async () => {
    const { service } = montarServico({
      diaria: { ...DIARIA, assinatura: { assinadoEm: new Date() } },
    });

    await expect(service.gerarLink('dia1')).rejects.toThrow(BadRequestException);
  });

  it('reclama de diária que não existe', async () => {
    const { service } = montarServico({ diaria: null });

    await expect(service.gerarLink('sumiu')).rejects.toThrow(NotFoundException);
  });
});

describe('abrir o link', () => {
  it('mostra o recibo congelado, não o cadastro de hoje', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({
        // O cadastro mudou depois que o link foi gerado…
        diaria: { ...DIARIA, valor: 999, diarista: { ...DIARISTA, nome: 'Outro Nome' } },
      }),
    });

    const recibo = await service.abrirPorToken('tok');

    // …e o recibo continua dizendo o que dizia.
    expect(recibo.valor).toBe('290');
    expect(recibo.quemRecebe.nome).toBe('Outro Nome');
    expect(recibo.quemPaga).toEqual({
      nome: 'ILNET',
      cnpj: '12.345.678/0001-99',
    });
    expect(recibo.assinado).toBe(false);
  });

  it('recusa link vencido', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({ expiraEm: new Date(Date.now() - 1000) }),
    });

    await expect(service.abrirPorToken('tok')).rejects.toThrow(GoneException);
  });

  /**
   * Depois de assinado o prazo não conta mais: o link vira o comprovante, e
   * quem abrir semanas depois tem de ver o que assinou.
   */
  it('ainda mostra o recibo assinado com o prazo vencido', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({
        expiraEm: new Date(Date.now() - 1000),
        assinadoEm: new Date('2026-08-11T13:00:00Z'),
        assinaturaPng: PNG,
        nomeAssinante: 'João da Silva',
      }),
    });

    const recibo = await service.abrirPorToken('tok');

    expect(recibo.assinado).toBe(true);
    expect(recibo.assinaturaPng).toBe(PNG);
  });

  it('reclama de token desconhecido', async () => {
    const { service } = montarServico({ assinatura: null });

    await expect(service.abrirPorToken('chute')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('assinar', () => {
  it('guarda o desenho, o nome, o IP e o aparelho', async () => {
    const { service, guardado, prisma } = montarServico({
      assinatura: assinaturaGravada(),
    });
    prisma.assinaturaDiaria.findUnique
      .mockResolvedValueOnce(assinaturaGravada())
      .mockResolvedValueOnce(
        assinaturaGravada({ assinadoEm: new Date(), assinaturaPng: PNG }),
      );

    await service.assinar(
      'tok',
      { assinatura: PNG, nome: 'João da Silva' },
      { ip: '189.1.2.3', userAgent: 'Mozilla/5.0 (Android)' },
    );

    expect(guardado[0]).toMatchObject({
      assinaturaPng: PNG,
      nomeAssinante: 'João da Silva',
      ip: '189.1.2.3',
      userAgent: 'Mozilla/5.0 (Android)',
    });
    expect(guardado[0].assinadoEm).toBeInstanceOf(Date);
  });

  it('cai no nome do cadastro quando a pessoa não digita outro', async () => {
    const { service, guardado, prisma } = montarServico({
      assinatura: assinaturaGravada(),
    });
    prisma.assinaturaDiaria.findUnique
      .mockResolvedValueOnce(assinaturaGravada())
      .mockResolvedValueOnce(assinaturaGravada({ assinadoEm: new Date() }));

    await service.assinar('tok', { assinatura: PNG }, {});

    expect(guardado[0].nomeAssinante).toBe('João da Silva');
  });

  it('não deixa assinar duas vezes', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({ assinadoEm: new Date() }),
    });

    await expect(
      service.assinar('tok', { assinatura: PNG }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('não deixa assinar com o link vencido', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({ expiraEm: new Date(Date.now() - 1000) }),
    });

    await expect(
      service.assinar('tok', { assinatura: PNG }, {}),
    ).rejects.toThrow(GoneException);
  });
});

describe('recibo para imprimir', () => {
  it('recusa imprimir o que ninguém assinou', async () => {
    const { service } = montarServico({ assinatura: assinaturaGravada() });

    await expect(service.paraRecibo('dia1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reclama de diária sem recibo nenhum', async () => {
    const { service } = montarServico({ assinatura: null });

    await expect(service.paraRecibo('dia1')).rejects.toThrow(NotFoundException);
  });
});

/**
 * Quem não escreve o próprio nome não pode ficar sem receber — mas o recibo
 * dele também não pode fingir um punho que não houve. O modo é o que separa as
 * duas coisas, e é por isso que ele é gravado em vez de deduzido depois.
 */
describe('modo da assinatura', () => {
  it('nasce como desenhada quando a tela não diz nada', async () => {
    const { service, guardado, prisma } = montarServico({
      assinatura: assinaturaGravada(),
    });
    prisma.assinaturaDiaria.findUnique
      .mockResolvedValueOnce(assinaturaGravada())
      .mockResolvedValueOnce(assinaturaGravada({ assinadoEm: new Date() }));

    await service.assinar('tok', { assinatura: PNG }, {});

    expect(guardado[0].modo).toBe('DESENHADA');
  });

  it('guarda que a assinatura foi gerada a partir do nome', async () => {
    const { service, guardado, prisma } = montarServico({
      assinatura: assinaturaGravada(),
    });
    prisma.assinaturaDiaria.findUnique
      .mockResolvedValueOnce(assinaturaGravada())
      .mockResolvedValueOnce(
        assinaturaGravada({ assinadoEm: new Date(), modo: 'DIGITADA' }),
      );

    await service.assinar(
      'tok',
      { assinatura: PNG, nome: 'Antonio Clebes Alves', modo: 'DIGITADA' },
      {},
    );

    expect(guardado[0]).toMatchObject({
      modo: 'DIGITADA',
      nomeAssinante: 'Antonio Clebes Alves',
    });
  });

  it('o modo acompanha o recibo aberto pelo link', async () => {
    const { service } = montarServico({
      assinatura: assinaturaGravada({
        assinadoEm: new Date(),
        assinaturaPng: PNG,
        modo: 'DIGITADA',
      }),
    });

    const recibo = await service.abrirPorToken('tok');

    expect(recibo.modo).toBe('DIGITADA');
  });
});

/*
 * Assinado era o fim, e na prática há motivo para refazer: assinou no lugar
 * errado, o traço saiu ilegível, quem segurava o celular era outra pessoa. Sem
 * caminho, a saída era apagar a diária e lançar de novo — mexer no caixa para
 * consertar um rabisco.
 */
describe('coletar a assinatura de novo', () => {
  const assinada = {
    ...DIARIA,
    assinatura: { id: 'a1', assinadoEm: new Date('2026-08-11T10:00:00Z') },
  };

  it('sem confirmar, a diária já assinada é recusada', async () => {
    const { service } = montarServico({ diaria: assinada });

    await expect(service.gerarLink('dia1')).rejects.toThrow(
      /substituir a assinatura atual/i,
    );
  });

  it('confirmando, sai link novo e fica marcado que se espera outra', async () => {
    const { service, guardado } = montarServico({ diaria: assinada });

    const a = await service.gerarLink('dia1', 'u1', true);

    expect(a.token).toEqual(expect.any(String));
    const gravado = guardado[0];
    expect(gravado.recoletandoDesde).toBeInstanceOf(Date);
    expect(gravado.recoletadoPor).toBe('u1');
    /*
     * A antiga não é limpa aqui: o recibo dela pode já ser a nota de um
     * lançamento do caixa, e apagá-la ao reabrir deixaria essa nota sem
     * documento até alguém assinar de novo.
     */
    expect(gravado.assinaturaPng).toBeUndefined();
    expect(gravado.assinadoEm).toBeUndefined();
  });

  /*
   * O buraco entre "reabri o link" e "consigo assinar".
   *
   * Durante a recoleta a assinatura antiga fica de propósito — o recibo dela
   * pode já ser a nota de um lançamento do caixa —, então `assinado` continua
   * verdadeiro. A tela pública lia só esse campo e mostrava o comprovante da
   * assinatura que se queria justamente trocar: o "coletar de novo" gerava link
   * e não levava a lugar nenhum. É `recoletando` que desempata.
   */
  it('recibo em recoleta abre dizendo que espera outra assinatura', async () => {
    const { service } = montarServico({
      assinatura: {
        id: 'a1',
        diariaId: 'dia1',
        token: 'tk',
        expiraEm: new Date('2099-01-01'),
        assinadoEm: new Date('2026-08-11T10:00:00Z'),
        recoletandoDesde: new Date('2026-08-12T09:00:00Z'),
        recoletas: 0,
        diaria: DIARIA,
        valor: 290,
        descricao: 'Roçada do terreno',
        dataDiaria: DIARIA.data,
        empresaNome: 'ILNET',
      },
    });

    const recibo = await service.abrirPorToken('tk');

    expect(recibo.assinado).toBe(true);
    expect(recibo.recoletando).toBe(true);
  });

  it('recibo assinado, sem recoleta, abre como comprovante', async () => {
    const { service } = montarServico({
      assinatura: {
        id: 'a1',
        diariaId: 'dia1',
        token: 'tk',
        expiraEm: new Date('2099-01-01'),
        assinadoEm: new Date('2026-08-11T10:00:00Z'),
        recoletandoDesde: null,
        recoletas: 0,
        diaria: DIARIA,
        valor: 290,
        descricao: 'Roçada do terreno',
        dataDiaria: DIARIA.data,
        empresaNome: 'ILNET',
      },
    });

    const recibo = await service.abrirPorToken('tk');

    expect(recibo.assinado).toBe(true);
    expect(recibo.recoletando).toBe(false);
  });

  it('a nova assinatura substitui a antiga e conta a recoleta', async () => {
    const { service, guardado } = montarServico({
      assinatura: {
        id: 'a1',
        diariaId: 'dia1',
        token: 'tk',
        expiraEm: new Date('2099-01-01'),
        assinadoEm: new Date('2026-08-11T10:00:00Z'),
        recoletandoDesde: new Date('2026-08-12T09:00:00Z'),
        recoletas: 0,
        diaria: DIARIA,
        valor: 290,
        descricao: 'Roçada do terreno',
        dataDiaria: DIARIA.data,
        empresaNome: 'ILNET',
      },
    });

    await service.assinar('tk', { assinatura: PNG }, {});

    const gravado = guardado[0];
    expect(gravado.assinaturaPng).toBe(PNG);
    expect(gravado.recoletandoDesde).toBeNull();
    expect(gravado.recoletas).toEqual({ increment: 1 });
  });

  /* Sem recoleta pedida, o link de uma assinada continua morto. */
  it('link de recibo assinado, sem recoleta, continua recusando', async () => {
    const { service } = montarServico({
      assinatura: {
        id: 'a1',
        diariaId: 'dia1',
        token: 'tk',
        expiraEm: new Date('2099-01-01'),
        assinadoEm: new Date('2026-08-11T10:00:00Z'),
        recoletandoDesde: null,
        recoletas: 0,
        diaria: DIARIA,
      },
    });

    await expect(
      service.assinar('tk', { assinatura: PNG }, {}),
    ).rejects.toThrow(/já foi assinado/i);
  });
});
