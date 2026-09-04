import { BadRequestException } from '@nestjs/common';
import { NotasFiscaisService, nomeDoMes } from './notas-fiscais.service';

/**
 * A área de notas fiscais é uma gaveta: o mês é uma pasta, e o que cai dentro
 * dela é documento da estante. O que este arquivo protege:
 *
 *  - a prateleira não nasce por precaução — quem nunca abriu mês nenhum não
 *    ganha pasta vazia na estante;
 *  - abrir o mesmo mês duas vezes é recusado, porque duas pastas do mesmo mês
 *    é como metade dos arquivos some: eles ficam na outra;
 *  - o nome da pasta carrega o assunto, porque é ele que vira o nome do zip
 *    que chega na contabilidade;
 *  - mês aberto e vazio aparece na lista: é justamente onde os arquivos vão
 *    cair.
 */

const RAIZ = { id: 'raiz' };

function montarServico(
  opts: {
    raizExiste?: boolean;
    mesJaAberto?: boolean;
    pastas?: Array<{ id: string; nome: string }>;
    documentos?: Array<{ pastaId: string; createdAt: Date }>;
  } = {},
) {
  const criadas: Array<Record<string, unknown>> = [];

  const pastaRh = {
    findFirst: jest.fn(({ where }: { where: { paiId: string | null } }) =>
      Promise.resolve(
        where.paiId === null
          ? ((opts.raizExiste ?? true) ? RAIZ : null)
          : ((opts.mesJaAberto ?? false) ? { id: 'ja-existe' } : null),
      ),
    ),
    findMany: jest.fn().mockResolvedValue(opts.pastas ?? []),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      criadas.push(data);
      return Promise.resolve({ id: `nova-${criadas.length}` });
    }),
  };

  const documentoRh = {
    findMany: jest.fn().mockResolvedValue(opts.documentos ?? []),
  };

  const prisma = { pastaRh, documentoRh };
  return {
    service: new NotasFiscaisService(prisma as never),
    prisma,
    criadas,
  };
}

describe('abrir um mês', () => {
  it('cria a pasta com o mês no nome, para o zip dizer do que é', async () => {
    const { service, criadas } = montarServico();

    const mes = await service.abrirMes('2026-09', 'u1');

    expect(criadas.map((c) => c.nome)).toContain('Notas fiscais 09-2026');
    expect(mes.competencia).toBe('2026-09');
    // Vazio é o estado normal de um mês recém-aberto.
    expect(mes.qtd).toBe(0);
    expect(mes.ultimoEm).toBeNull();
  });

  it('a prateleira nasce no primeiro mês aberto', async () => {
    const { service, criadas } = montarServico({ raizExiste: false });

    await service.abrirMes('2026-09', 'u1');

    expect(criadas.map((c) => c.nome)).toContain('Notas Fiscais');
  });

  it('recusa abrir duas vezes o mesmo mês', async () => {
    const { service, prisma } = montarServico({ mesJaAberto: true });

    await expect(service.abrirMes('2026-09', 'u1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.pastaRh.create).not.toHaveBeenCalled();
  });

  it('recusa um mês que não existe', async () => {
    const { service } = montarServico();

    await expect(service.abrirMes('2026-13', 'u1')).rejects.toThrow(/13/);
    await expect(service.abrirMes('setembro', 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('a lista de meses', () => {
  it('sem prateleira, é vazia — e não cria pasta nenhuma', async () => {
    const { service, prisma } = montarServico({ raizExiste: false });

    expect(await service.meses()).toEqual([]);
    expect(prisma.pastaRh.create).not.toHaveBeenCalled();
  });

  it('conta o que há em cada mês e mostra o mais novo primeiro', async () => {
    const { service } = montarServico({
      pastas: [
        { id: 'p-ago', nome: 'Notas fiscais 08-2026' },
        { id: 'p-set', nome: 'Notas fiscais 09-2026' },
      ],
      documentos: [
        { pastaId: 'p-set', createdAt: new Date('2026-09-03') },
        { pastaId: 'p-set', createdAt: new Date('2026-09-11') },
        { pastaId: 'p-ago', createdAt: new Date('2026-08-20') },
      ],
    });

    const meses = await service.meses();

    expect(meses.map((m) => m.competencia)).toEqual(['2026-09', '2026-08']);
    expect(meses[0].qtd).toBe(2);
    expect(meses[0].ultimoEm).toEqual(new Date('2026-09-11'));
  });

  it('o mês aberto e ainda vazio continua na lista', async () => {
    const { service } = montarServico({
      pastas: [{ id: 'p-out', nome: 'Notas fiscais 10-2026' }],
      documentos: [],
    });

    const [mes] = await service.meses();

    // É onde os arquivos vão cair: escondê-lo esconderia o alvo do arrasto.
    expect(mes.qtd).toBe(0);
    expect(mes.ultimoEm).toBeNull();
  });

  /* A virada do ano é o caso que a ordenação por texto erra se o nome guiar. */
  it('dezembro vem antes de janeiro do ano seguinte', async () => {
    const { service } = montarServico({
      pastas: [
        { id: 'a', nome: 'Notas fiscais 12-2026' },
        { id: 'b', nome: 'Notas fiscais 01-2027' },
      ],
    });

    expect((await service.meses()).map((m) => m.competencia)).toEqual([
      '2027-01',
      '2026-12',
    ]);
  });

  it('pasta renomeada à mão não some da lista', async () => {
    const { service } = montarServico({
      pastas: [{ id: 'x', nome: 'Notas do contador' }],
    });

    const [mes] = await service.meses();

    // O nome que sobrou é a resposta: sumir seria pior que aparecer torto.
    expect(mes.competencia).toBe('Notas do contador');
  });
});

describe('o nome da pasta', () => {
  it('leva o assunto e o mês, porque vira o nome do zip', () => {
    expect(nomeDoMes('2026-09')).toBe('Notas fiscais 09-2026');
  });
});
