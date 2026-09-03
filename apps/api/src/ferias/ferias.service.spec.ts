import { FeriasService } from './ferias.service';

/**
 * O que este arquivo protege:
 *
 *  - quem está de férias hoje não aparece na fila como disponível, nem quando
 *    o relatório novo da contabilidade já o virou de período aquisitivo;
 *  - férias que já acabaram não seguram ninguém: o período novo é fila nova.
 */

const HOJE = new Date(Date.UTC(2026, 8, 3));

/** Um dia em UTC, que é como toda data de férias é guardada. */
const dia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));

/**
 * Uma linha do relatório. Os valores que não interessam ao caso vêm prontos:
 * o que cada teste quer dizer é o período e o código, e enterrá-los em campos
 * obrigatórios só faria o caso custar mais para ler.
 */
const item = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'i1',
  ordem: 1,
  codigo: '000065',
  nome: 'WERICK DA CRUZ COSTA',
  cargo: null,
  funcionarioId: null,
  admissao: null,
  periodoInicio: dia(2025, 8, 23),
  periodoFim: dia(2026, 8, 22),
  dataLimite: dia(2027, 7, 23),
  diasDireito: 30,
  diasAcumulados: null,
  diasRestantes: null,
  ...over,
});

/** Um "mandado para férias" já gravado. */
const marca = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'm1',
  codigo: '000065',
  nome: 'WERICK DA CRUZ COSTA',
  funcionarioId: null,
  inicio: dia(2026, 8, 31),
  fim: dia(2026, 9, 29),
  dias: 30,
  periodoInicio: dia(2024, 8, 23),
  periodoFim: dia(2025, 8, 22),
  observacao: null,
  ...over,
});

function montarServico(opts: {
  itens?: ReturnType<typeof item>[];
  marcadas?: ReturnType<typeof marca>[];
}) {
  const prisma = {
    previsaoFerias: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'p1',
        dataRelatorio: dia(2026, 9, 3),
        empresa: 'M A CASTRO',
        arquivoNome: 'Ferias Previstas.pdf',
        itens: opts.itens ?? [item()],
      }),
    },
    feriasMarcada: {
      findMany: jest.fn().mockResolvedValue(opts.marcadas ?? []),
    },
  };
  return { service: new FeriasService(prisma as never), prisma };
}

describe('a fila de férias', () => {
  /*
   * O defeito: a contabilidade manda o relatório todo mês, e quem saiu de
   * férias aparece nele já rolado para o período aquisitivo seguinte. A marca
   * se prende ao período, então a chave deixava de bater e ela sumia da tela:
   * a pessoa voltava para a fila como disponível estando de férias naquele
   * mesmo dia — e a fila é o que responde "quem é o próximo".
   */
  it('quem está de férias continua marcado depois do relatório novo', async () => {
    const { service } = montarServico({
      // O relatório novo já virou o Werick para 2025/2026...
      itens: [item({ periodoFim: dia(2026, 8, 22) })],
      // ...mas ele foi mandado pelo período anterior, e ainda não voltou.
      marcadas: [marca({ periodoFim: dia(2025, 8, 22) })],
    });

    const r = await service.fila(HOJE);

    expect(r.fila).toHaveLength(0);
    expect(r.marcadas).toHaveLength(1);
    expect(r.marcadas[0].nome).toBe('WERICK DA CRUZ COSTA');
    expect(r.marcadas[0].ferias?.emCurso).toBe(true);
  });

  /*
   * O outro lado: férias que acabaram não seguram ninguém. Se segurassem, a
   * pessoa nunca mais entraria na fila e o período novo dela ficaria invisível
   * — que é o erro contrário, e igualmente caro.
   */
  it('férias já terminadas devolvem a pessoa para a fila', async () => {
    const { service } = montarServico({
      itens: [item({ periodoFim: dia(2026, 8, 22) })],
      marcadas: [
        marca({
          periodoFim: dia(2025, 8, 22),
          inicio: dia(2026, 6, 1),
          fim: dia(2026, 6, 30),
        }),
      ],
    });

    const r = await service.fila(HOJE);

    expect(r.fila).toHaveLength(1);
    expect(r.marcadas).toHaveLength(0);
  });

  /* A marca do próprio período continua valendo como sempre valeu: é ela que
     impede mandar a mesma pessoa duas vezes pelo mesmo período. */
  it('a marca do período de agora segue sendo a que manda', async () => {
    const { service } = montarServico({
      itens: [item({ periodoFim: dia(2026, 8, 22) })],
      marcadas: [
        marca({
          id: 'deste-periodo',
          periodoFim: dia(2026, 8, 22),
          inicio: dia(2026, 10, 1),
          fim: dia(2026, 10, 30),
        }),
      ],
    });

    const r = await service.fila(HOJE);

    expect(r.marcadas).toHaveLength(1);
    expect(r.marcadas[0].ferias?.id).toBe('deste-periodo');
    // Ainda não começaram: está marcado, mas não está fora.
    expect(r.marcadas[0].ferias?.emCurso).toBe(false);
  });

  it('sem marca nenhuma, todo mundo fica na fila', async () => {
    const { service } = montarServico({
      itens: [item({ id: 'a', codigo: '1' }), item({ id: 'b', codigo: '2' })],
    });

    const r = await service.fila(HOJE);

    expect(r.fila).toHaveLength(2);
    expect(r.marcadas).toHaveLength(0);
  });
});
