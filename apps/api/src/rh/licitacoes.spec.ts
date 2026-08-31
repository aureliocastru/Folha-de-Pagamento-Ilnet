import { BadRequestException } from '@nestjs/common';
import { LicitacoesService } from './licitacoes.service';

/**
 * A pasta de uma licitação é a fotografia do que foi entregue. O que este
 * arquivo protege é justamente isso:
 *
 *  - o documento entra por **cópia**, com o arquivo e as datas que ele tinha —
 *    se entrasse por atalho, renovar a certidão no mês seguinte reescreveria o
 *    que já foi mandado, e a pasta deixaria de responder à única pergunta que
 *    ela existe para responder;
 *  - marcar a lista inteira de novo não duplica o que já está lá, porque é
 *    exatamente isso que quem volta para acrescentar um papel faz;
 *  - só pasta de licitação recebe cópia, e a prateleira não nasce por
 *    precaução — quem nunca abriu licitação nenhuma não ganha pasta vazia.
 */

const RAIZ = { id: 'raiz', nome: 'Licitações' };

function montarServico(opts: {
  raiz?: { id: string } | null;
  licitacoes?: Array<{ id: string; nome: string; createdAt: Date }>;
  jaLa?: Array<{ titulo: string }>;
  origem?: Array<Record<string, unknown>>;
  alvo?: { id: string; nome: string; paiId: string | null } | null;
} = {}) {
  const licitacoes = opts.licitacoes ?? [];

  const pastaRh = {
    findFirst: jest.fn(({ where }: { where: { paiId: string | null } }) =>
      Promise.resolve(
        // `paiId: null` é a procura da prateleira; com pai, é a irmã de mesmo
        // nome — as duas passam por aqui, e é o pai que as separa.
        where.paiId === null
          ? ('raiz' in opts ? opts.raiz : RAIZ)
          : (licitacoes.find((l) => l.nome === 'Repetida') ?? null),
      ),
    ),
    findMany: jest.fn().mockResolvedValue(licitacoes),
    findUnique: jest.fn(() =>
      Promise.resolve(
        'alvo' in opts
          ? opts.alvo
          : { id: 'lic-1', nome: 'Pregão 12/2026', paiId: 'raiz' },
      ),
    ),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'nova', createdAt: new Date('2026-08-25'), ...data }),
    ),
  };

  const documentoRh = {
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.id ? (opts.origem ?? []) : (opts.jaLa ?? [])),
    ),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  };

  const prisma = { pastaRh, documentoRh };
  return { service: new LicitacoesService(prisma as never), prisma };
}

/** Um documento como ele sai do banco, com arquivo e tudo. */
function documento(titulo: string, extras: Record<string, unknown> = {}) {
  return {
    id: `d-${titulo}`,
    pastaId: 'empresa',
    titulo,
    tipo: 'Certidão',
    descricao: null,
    competencia: null,
    emitidoEm: new Date('2026-06-01'),
    valeAte: new Date('2026-09-24'),
    arquivoNome: `${titulo}.pdf`,
    arquivoTipo: 'application/pdf',
    arquivoTamanho: 1234,
    arquivo: new Uint8Array([1, 2, 3]),
    ...extras,
  };
}

describe('LicitacoesService', () => {
  it('sem prateleira, a lista é vazia e nada é criado', async () => {
    const { service, prisma } = montarServico({ raiz: null });

    expect(await service.listar()).toEqual([]);
    // Abrir a tela não pode deixar uma pasta vazia na estante de quem só passou
    // por ali.
    expect(prisma.pastaRh.create).not.toHaveBeenCalled();
  });

  it('a licitação nova nasce dentro da prateleira', async () => {
    const { service, prisma } = montarServico();

    const l = await service.criar('  Pregão 12/2026  ', 'u1');

    expect(prisma.pastaRh.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nome: 'Pregão 12/2026', paiId: 'raiz', criadoPor: 'u1' },
      }),
    );
    expect(l.qtd).toBe(0);
  });

  it('recusa duas licitações com o mesmo nome', async () => {
    const { service } = montarServico({
      licitacoes: [
        { id: 'lic-1', nome: 'Repetida', createdAt: new Date('2026-08-01') },
      ],
    });

    await expect(service.criar('Repetida')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('copia o arquivo e as datas, e não um atalho', async () => {
    const { service, prisma } = montarServico({
      origem: [documento('CND Estadual')],
    });

    const r = await service.copiar('lic-1', ['d-CND Estadual'], 'u1');

    expect(r).toEqual({ copiados: 1, repetidos: 0 });
    const { data } = prisma.documentoRh.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      pastaId: 'lic-1',
      titulo: 'CND Estadual',
      arquivoNome: 'CND Estadual.pdf',
      valeAte: new Date('2026-09-24'),
      criadoPor: 'u1',
    });
    // É o conteúdo que vai junto: sem ele a pasta guardaria o nome de um papel
    // que não está lá.
    expect(data[0].arquivo).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('o que já está na pasta não entra de novo', async () => {
    const { service, prisma } = montarServico({
      jaLa: [{ titulo: 'CND Estadual' }],
      origem: [documento('CND Estadual'), documento('CNDT')],
    });

    const r = await service.copiar('lic-1', ['d-CND Estadual', 'd-CNDT']);

    expect(r).toEqual({ copiados: 1, repetidos: 1 });
    const { data } = prisma.documentoRh.createMany.mock.calls[0][0] as {
      data: Array<{ titulo: string }>;
    };
    expect(data.map((d) => d.titulo)).toEqual(['CNDT']);
  });

  it('id repetido na marcação conta uma vez só', async () => {
    const { service } = montarServico({ origem: [documento('CNDT')] });

    const r = await service.copiar('lic-1', ['d-CNDT', 'd-CNDT']);

    expect(r.copiados).toBe(1);
  });

  it('pasta que não é licitação não recebe cópia', async () => {
    const { service } = montarServico({
      alvo: { id: 'empresa', nome: 'M A CASTRO', paiId: null },
    });

    // Sem esta recusa, um id trocado despejaria catorze cópias dentro da pasta
    // da empresa, ao lado dos originais e com os mesmos títulos.
    await expect(
      service.copiar('empresa', ['d-CNDT']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa uma leva maior que o teto', async () => {
    const { service } = montarServico();
    const ids = Array.from({ length: 61 }, (_, i) => `d-${i}`);

    await expect(service.copiar('lic-1', ids)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a lista conta o que está vencido em cada licitação', async () => {
    const ontem = new Date(Date.now() - 86_400_000);
    const { service, prisma } = montarServico({
      licitacoes: [
        { id: 'lic-1', nome: 'Pregão 12/2026', createdAt: new Date('2026-08-01') },
      ],
    });
    prisma.documentoRh.findMany.mockResolvedValueOnce([
      { pastaId: 'lic-1', valeAte: ontem },
      { pastaId: 'lic-1', valeAte: null },
    ]);

    const [l] = await service.listar();

    expect(l).toMatchObject({ qtd: 2, vencidos: 1, aVencer: 0 });
  });
});
