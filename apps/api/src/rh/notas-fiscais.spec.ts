import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NotasFiscaisService } from './notas-fiscais.service';

/**
 * A nota fiscal é o papel e o valor dele, e este arquivo protege a costura
 * entre os dois:
 *
 *  - o total do mês é somado em decimal, e não em ponto flutuante — é ele que
 *    se confere com a contabilidade, e um centavo de diferença numa soma de
 *    trinta notas é uma tarde de conferência perdida;
 *  - o documento nasce **sem** competência, porque a chave (pasta, tipo,
 *    competência) existe para o recibo de pagamento e recusaria a segunda nota
 *    do mesmo mês;
 *  - a pasta do mês nasce na primeira nota daquele mês, e a prateleira na
 *    primeira nota de todas: nada de doze pastas vazias criadas por precaução;
 *  - corrigir o mês de uma nota move o papel junto, senão o zip de agosto
 *    continua levando à contabilidade uma nota que é de julho.
 */

const RAIZ = { id: 'raiz' };

/** Uma linha de nota como o banco a devolve, sem o arquivo. */
function linha(extras: Record<string, unknown> = {}) {
  return {
    id: 'n0',
    documentoId: 'd0',
    competencia: '2026-08',
    fornecedor: 'Fulano Materiais',
    numero: '1234',
    valor: new Prisma.Decimal('150.50'),
    createdAt: new Date('2026-09-01'),
    documento: {
      emitidoEm: null,
      arquivoNome: 'nota.pdf',
      arquivoTipo: 'application/pdf',
      arquivoTamanho: 1024,
    },
    ...extras,
  };
}

function montarServico(
  opts: {
    raizExiste?: boolean;
    pastaDoMesExiste?: boolean;
    notas?: Array<{
      id?: string;
      competencia: string;
      valor: string;
      createdAt?: Date;
      pastaId?: string;
    }>;
    nota?: Record<string, unknown> | null;
  } = {},
) {
  const criadas: Array<Record<string, unknown>> = [];

  const pastaRh = {
    findFirst: jest.fn(({ where }: { where: { paiId: string | null } }) =>
      Promise.resolve(
        where.paiId === null
          ? ((opts.raizExiste ?? true) ? RAIZ : null)
          : ((opts.pastaDoMesExiste ?? false) ? { id: 'pasta-mes' } : null),
      ),
    ),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      criadas.push(data);
      return Promise.resolve({ id: `nova-${criadas.length}` });
    }),
  };

  const notaFiscal = {
    findMany: jest.fn(() =>
      Promise.resolve(
        (opts.notas ?? []).map((n, i) => ({
          id: n.id ?? `n${i}`,
          documentoId: `d${i}`,
          competencia: n.competencia,
          fornecedor: 'Fulano Materiais',
          numero: '1234',
          valor: new Prisma.Decimal(n.valor),
          createdAt: n.createdAt ?? new Date('2026-09-01'),
          documento: {
            pastaId: n.pastaId ?? 'pasta-mes',
            emitidoEm: null,
            arquivoNome: 'nota.pdf',
            arquivoTipo: 'application/pdf',
            arquivoTamanho: 1024,
          },
        })),
      ),
    ),
    findUnique: jest.fn(() =>
      Promise.resolve(
        'nota' in opts
          ? (opts.nota && { ...linha(), ...opts.nota })
          : linha(),
      ),
    ),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'n0',
        ...data,
        valor: data.valor as Prisma.Decimal,
      }),
    ),
    update: jest.fn().mockResolvedValue({}),
  };

  const documentoRh = { update: jest.fn().mockResolvedValue({}) };

  const prisma = { pastaRh, notaFiscal, documentoRh };
  const documentos = {
    guardar: jest.fn().mockResolvedValue({ id: 'doc-novo' }),
    apagar: jest.fn().mockResolvedValue({}),
  };

  return {
    service: new NotasFiscaisService(prisma as never, documentos as never),
    prisma,
    documentos,
    criadas,
  };
}

/** Uma nota chegando pela tela, com o arquivo. */
const CHEGANDO = {
  competencia: '2026-09',
  fornecedor: 'Fulano Materiais',
  numero: '1234',
  valor: 150.5,
  arquivoNome: 'nota.pdf',
  arquivo: 'data:application/pdf;base64,QQ==',
};

describe('o total do mês', () => {
  it('soma em decimal, sem o centavo que o ponto flutuante come', async () => {
    const { service } = montarServico({
      notas: [
        { competencia: '2026-09', valor: '0.10' },
        { competencia: '2026-09', valor: '0.20' },
      ],
    });

    const [mes] = await service.meses();

    // 0.1 + 0.2 em ponto flutuante dá 0.30000000000000004.
    expect(mes.total).toBe('0.30');
    expect(mes.qtd).toBe(2);
  });

  it('separa os meses e mostra o mais novo primeiro', async () => {
    const { service } = montarServico({
      notas: [
        { competencia: '2026-07', valor: '100.00' },
        { competencia: '2026-09', valor: '50.00' },
        { competencia: '2026-09', valor: '25.00' },
      ],
    });

    const meses = await service.meses();

    expect(meses.map((m) => m.competencia)).toEqual(['2026-09', '2026-07']);
    expect(meses[0].total).toBe('75.00');
    expect(meses[1].total).toBe('100.00');
  });

  it('sem nota nenhuma, a lista é vazia — e não um mês zerado', async () => {
    const { service } = montarServico({ notas: [] });

    expect(await service.meses()).toEqual([]);
  });
});

describe('guardar uma nota', () => {
  it('manda o documento sem competência, para o mês aceitar a segunda nota', async () => {
    const { service, documentos } = montarServico();

    await service.guardar(CHEGANDO);

    const [dto] = documentos.guardar.mock.calls[0];
    expect(dto.competencia).toBeUndefined();
    expect(dto.tipo).toBe('Nota fiscal');
  });

  it('a nota aparece na estante com número e fornecedor no nome', async () => {
    const { service, documentos } = montarServico();

    await service.guardar(CHEGANDO);

    expect(documentos.guardar.mock.calls[0][0].titulo).toBe(
      'NF 1234 — Fulano Materiais',
    );
  });

  it('sem número, o nome ainda diz de quem é', async () => {
    const { service, documentos } = montarServico();

    await service.guardar({ ...CHEGANDO, numero: undefined });

    expect(documentos.guardar.mock.calls[0][0].titulo).toBe(
      'NF — Fulano Materiais',
    );
  });

  it('abre a pasta do mês na primeira nota dele, com o mês no nome', async () => {
    const { service, criadas } = montarServico({ pastaDoMesExiste: false });

    await service.guardar(CHEGANDO);

    // O nome carrega o assunto porque é ele que vira o zip que sai da casa.
    expect(criadas.map((c) => c.nome)).toContain('Notas fiscais 09-2026');
  });

  it('a segunda nota do mês não abre outra pasta', async () => {
    const { service, prisma } = montarServico({ pastaDoMesExiste: true });

    await service.guardar(CHEGANDO);

    expect(prisma.pastaRh.create).not.toHaveBeenCalled();
  });

  it('a prateleira nasce na primeira nota de todas', async () => {
    const { service, criadas } = montarServico({
      raizExiste: false,
      pastaDoMesExiste: false,
    });

    await service.guardar(CHEGANDO);

    expect(criadas.map((c) => c.nome)).toContain('Notas Fiscais');
  });

  it('recusa a nota sem arquivo: valor sem papel atrás não é nota', async () => {
    const { service, documentos } = montarServico();

    await expect(
      service.guardar({ ...CHEGANDO, arquivo: undefined }),
    ).rejects.toThrow(BadRequestException);
    expect(documentos.guardar).not.toHaveBeenCalled();
  });

  it('recusa um mês que não existe', async () => {
    const { service } = montarServico();

    await expect(
      service.guardar({ ...CHEGANDO, competencia: '2026-13' }),
    ).rejects.toThrow(/13/);
  });
});

describe('corrigir uma nota', () => {
  it('mudar o mês leva o papel para a pasta do mês novo', async () => {
    const { service, prisma } = montarServico({
      nota: { id: 'n0', documentoId: 'd0', competencia: '2026-08' },
      pastaDoMesExiste: true,
    });

    await service.editar('n0', { ...CHEGANDO, competencia: '2026-09' });

    // Sem isto, o zip de agosto continua levando uma nota de setembro.
    expect(prisma.documentoRh.update.mock.calls[0][0].data.pastaId).toBe(
      'pasta-mes',
    );
  });

  it('ficando no mesmo mês, o papel não se mexe de pasta', async () => {
    const { service, prisma } = montarServico({
      nota: { id: 'n0', documentoId: 'd0', competencia: '2026-09' },
    });

    await service.editar('n0', CHEGANDO);

    expect(prisma.documentoRh.update.mock.calls[0][0].data.pastaId).toBeUndefined();
  });

  it('a nota que já não existe não se corrige', async () => {
    const { service } = montarServico({ nota: null });

    await expect(service.editar('sumiu', CHEGANDO)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('apagar uma nota', () => {
  it('leva o papel junto: valor sem nota mentiria no total', async () => {
    const { service, documentos } = montarServico({
      nota: { id: 'n0', documentoId: 'd0', competencia: '2026-09' },
    });

    await service.apagar('n0');

    expect(documentos.apagar).toHaveBeenCalledWith('d0');
  });
});
