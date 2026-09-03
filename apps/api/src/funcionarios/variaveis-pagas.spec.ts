import { BadRequestException } from '@nestjs/common';
import { FuncionariosService } from './funcionarios.service';

/**
 * O que este arquivo protege:
 *
 *  - a venda já paga sai da ficha, pela mesma régua do lançamento avulso já
 *    descontado: a lista responde "o que ainda está para acontecer";
 *  - o mês pago não se sobrescreve nem se apaga por engano — sem a linha na
 *    tela, o formulário abre em branco naquele mês, e um "Salvar" apagaria por
 *    cima o registro do que já foi pago.
 *
 * A venda de um mês é paga na folha do mês **seguinte**: o que se lança em
 * 08/2026 sai na competência 09/2026.
 */

const FUNCIONARIO = {
  id: 'f1',
  nome: 'Cleyson',
  adiantamentos: [],
  lancamentos: [],
  variaveisMes: [],
};

function montarServico(opts: {
  variaveis?: Array<{ competencia: string; vendas: number }>;
  lancamentos?: Array<{ id: string; competencia: string | null }>;
  /** Competências de folha de salário que já existem para esta pessoa. */
  folhasGeradas?: string[];
}) {
  const folhas = opts.folhasGeradas ?? [];

  const prisma = {
    funcionario: {
      findUnique: jest.fn().mockResolvedValue({
        ...FUNCIONARIO,
        lancamentos: opts.lancamentos ?? [],
        variaveisMes: (opts.variaveis ?? []).map((v, i) => ({
          id: `v${i}`,
          funcionarioId: 'f1',
          horasExtras: 0,
          valorPorVenda: null,
          observacao: null,
          ...v,
        })),
      }),
    },
    contaPagar: {
      // A pergunta da ficha: quais das competências pedidas já têm folha.
      findMany: jest.fn(async (args: { where: { competencia: { in: string[] } } }) =>
        args.where.competencia.in
          .filter((c) => folhas.includes(c))
          .map((competencia) => ({ competencia })),
      ),
      // A pergunta da trava: esta competência tem folha?
      findFirst: jest.fn(async (args: { where: { competencia: string } }) =>
        folhas.includes(args.where.competencia) ? { id: 'c1' } : null,
      ),
    },
    variavelMes: {
      upsert: jest.fn(async () => ({ id: 'v1' })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };

  return { service: new FuncionariosService(prisma as never), prisma };
}

describe('a venda já paga sai da ficha', () => {
  it('some da lista quando a folha do mês seguinte já saiu', async () => {
    const { service } = montarServico({
      variaveis: [
        { competencia: '2026-08', vendas: 1 },
        { competencia: '2026-07', vendas: 1 },
      ],
      // Julho foi pago na folha de agosto; agosto ainda não.
      folhasGeradas: ['2026-08'],
    });

    const f = await service.buscarPorId('f1');

    expect(f.variaveisMes.map((v) => v.competencia)).toEqual(['2026-08']);
  });

  it('sem folha nenhuma gerada, tudo continua na lista', async () => {
    const { service } = montarServico({
      variaveis: [
        { competencia: '2026-08', vendas: 1 },
        { competencia: '2026-07', vendas: 1 },
      ],
    });

    const f = await service.buscarPorId('f1');

    expect(f.variaveisMes).toHaveLength(2);
  });

  /* A virada do ano é o caso que a soma ingênua de mês erra. */
  it('dezembro é pago na folha de janeiro do ano seguinte', async () => {
    const { service } = montarServico({
      variaveis: [{ competencia: '2026-12', vendas: 3 }],
      folhasGeradas: ['2027-01'],
    });

    const f = await service.buscarPorId('f1');

    expect(f.variaveisMes).toHaveLength(0);
  });

  /*
   * As duas listas saem da mesma consulta, e uma não pode comer a outra: o
   * avulso é consumido pela folha da **própria** competência, a venda pela do
   * mês seguinte. Somar as duas na mesma pergunta sem essa distinção esconderia
   * o avulso de agosto junto com a venda de julho.
   */
  it('avulso e venda seguem cada um a sua competência', async () => {
    const { service } = montarServico({
      variaveis: [{ competencia: '2026-08', vendas: 1 }],
      lancamentos: [
        { id: 'l1', competencia: '2026-08' },
        { id: 'l2', competencia: null },
      ],
      // A folha de agosto saiu: consome o avulso de agosto, mas a venda de
      // agosto só é paga na de setembro.
      folhasGeradas: ['2026-08'],
    });

    const f = await service.buscarPorId('f1');

    expect(f.variaveisMes.map((v) => v.competencia)).toEqual(['2026-08']);
    // O fixo (sem competência) nunca sai; o avulso de agosto, sim.
    expect(f.lancamentos.map((l) => l.id)).toEqual(['l2']);
  });
});

describe('o mês já pago não se mexe', () => {
  it('recusa sobrescrever a venda de um mês cuja folha já saiu', async () => {
    const { service, prisma } = montarServico({ folhasGeradas: ['2026-08'] });

    await expect(
      service.salvarVariaveis('f1', { competencia: '2026-07', vendas: 9 } as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.variavelMes.upsert).not.toHaveBeenCalled();
  });

  it('recusa apagar a venda de um mês cuja folha já saiu', async () => {
    const { service, prisma } = montarServico({ folhasGeradas: ['2026-08'] });

    await expect(service.removerVariaveis('f1', '2026-07')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.variavelMes.deleteMany).not.toHaveBeenCalled();
  });

  it('o mês que ainda não foi pago continua editável', async () => {
    const { service, prisma } = montarServico({ folhasGeradas: ['2026-08'] });

    await service.salvarVariaveis('f1', {
      competencia: '2026-08',
      vendas: 2,
    } as never);

    expect(prisma.variavelMes.upsert).toHaveBeenCalled();
  });
});
