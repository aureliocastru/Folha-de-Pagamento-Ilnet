import { BadRequestException } from '@nestjs/common';
import { FaltasService } from './faltas.service';

/**
 * O que este arquivo protege: a falta é descontada do **salário base**, e de
 * mais nada.
 *
 * A folha tem duas bases — o salário base e o "a receber na folha" —, e a
 * segunda vale para quem tem carteira assinada. Se um dia a conta da falta
 * passar a seguir a base da folha, quem tem os dois preenchidos vai receber um
 * desconto que não confere com o que a tela mostrou, e ninguém vai achar por
 * quê. Aqui fica dito qual é.
 */

function montarServico(
  opts: {
    funcionario?: Record<string, unknown> | null;
    faltas?: Array<{ funcionarioId: string; data: Date }>;
  } = {},
) {
  const prisma = {
    funcionario: {
      findUnique: jest.fn().mockResolvedValue(
        opts.funcionario === undefined
          ? {
              id: 'f1',
              nome: 'Eduarda Amaral',
              salarioBase: 1621,
              // Preenchido de propósito: é o valor que NÃO pode ser usado.
              valorAReceberFolha: 1499.43,
              carteiraAssinada: false,
            }
          : opts.funcionario,
      ),
    },
    faltaFuncionario: {
      findMany: jest.fn().mockResolvedValue(opts.faltas ?? []),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'x1',
        ...data,
      })),
      delete: jest.fn(),
    },
  };

  return { service: new FaltasService(prisma as never), prisma };
}

describe('o calendário de faltas', () => {
  it('desconta do salário base, e não do "a receber na folha"', async () => {
    const { service } = montarServico({
      faltas: [{ funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 4)) }],
    });

    const r = await service.doMes('f1', '2026-08');

    // 1621 / 30 = 54,03 — e não 1499,43 / 30, que daria 49,98.
    expect(r.salarioBase).toBe(1621);
    expect(r.desconto.valorDoDia).toBe(54.03);
    // O dia mais o descanso da semana.
    expect(r.desconto.total).toBe(108.06);
  });

  it('a folha desconta pelo mesmo salário base', async () => {
    const { service } = montarServico({
      faltas: [
        { funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 4)) },
        { funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 5)) },
      ],
    });

    const mapa = await service.descontoDaCompetencia('2026-08', [
      { id: 'f1', salarioBase: 1621 },
    ]);

    // Dois dias na mesma semana: 2 × 54,03 + um DSR de 54,03.
    expect(mapa.get('f1')?.total).toBe(162.09);
  });

  it('a folha recebe os dias marcados, em ordem, para mostrar de onde vem o desconto', async () => {
    const { service } = montarServico({
      faltas: [
        { funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 5)) },
        { funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 4)) },
      ],
    });

    const mapa = await service.descontoDaCompetencia('2026-08', [
      { id: 'f1', salarioBase: 1621 },
    ]);

    expect(mapa.get('f1')).toMatchObject({
      datas: ['2026-08-04', '2026-08-05'],
      dias: 2,
      semanasComFalta: 1,
      valorDoDia: 54.03,
      valorDosDias: 108.06,
      valorDoDsr: 54.03,
    });
  });

  it('sem falta no mês, ninguém entra no mapa da folha', async () => {
    const { service } = montarServico({ faltas: [] });

    const mapa = await service.descontoDaCompetencia('2026-08', [
      { id: 'f1', salarioBase: 1621 },
    ]);

    expect(mapa.size).toBe(0);
  });

  /*
   * Com carteira assinada quem desconta falta é a contabilidade, na folha
   * oficial. Marcar aqui tiraria o mesmo dia duas vezes da mesma pessoa.
   */
  it('carteira assinada não marca falta por aqui', async () => {
    const { service } = montarServico({
      funcionario: {
        id: 'f1',
        nome: 'Eduarda Amaral',
        salarioBase: 1621,
        carteiraAssinada: true,
      },
    });

    await expect(service.alternar('f1', '2026-08-04')).rejects.toThrow(
      /contabilidade/i,
    );
  });

  it('a tela sabe que o calendário não se aplica a quem tem carteira', async () => {
    const { service } = montarServico({
      funcionario: {
        id: 'f1',
        nome: 'Eduarda Amaral',
        salarioBase: 1621,
        carteiraAssinada: true,
      },
    });

    expect((await service.doMes('f1', '2026-08')).aplicavel).toBe(false);
  });

  it('o mesmo clique marca e desmarca', async () => {
    const { service, prisma } = montarServico();
    prisma.faltaFuncionario.findUnique.mockResolvedValueOnce({ id: 'x1' });

    expect(await service.alternar('f1', '2026-08-04')).toEqual({
      marcado: false,
    });
    expect(prisma.faltaFuncionario.delete).toHaveBeenCalled();
  });

  /*
   * O dia clicado tem de voltar como o dia clicado.
   *
   * Um `Date` serializado vira "2026-08-03T00:00:00.000Z", e o navegador em
   * Brasília relia isso como 2 de agosto às 21h: clicava-se no 3 e acendia o
   * quadrado do 2. Por isso o dia sai daqui como texto, sem hora e sem fuso.
   */
  it('o dia volta como texto, e é o mesmo que foi marcado', async () => {
    const { service } = montarServico({
      faltas: [{ funcionarioId: 'f1', data: new Date(Date.UTC(2026, 7, 3)) }],
    });

    const r = await service.doMes('f1', '2026-08');

    expect(r.dias[0].dia).toBe('2026-08-03');
  });

  /*
   * Linhas gravadas antes disto nasceram à meia-noite do fuso do servidor. Com
   * o container em UTC dá no mesmo; num servidor a oeste de Greenwich a hora
   * fica em 03:00Z, e o dia continua sendo o 3 — lido em UTC.
   */
  it('linha antiga, gravada com hora, ainda diz o dia certo', async () => {
    const { service } = montarServico({
      faltas: [{ funcionarioId: 'f1', data: new Date('2026-08-03T03:00:00Z') }],
    });

    expect((await service.doMes('f1', '2026-08')).dias[0].dia).toBe(
      '2026-08-03',
    );
  });

  it('marca o dia em UTC, para o fuso do servidor não deslocá-lo', async () => {
    const { service, prisma } = montarServico();

    await service.alternar('f1', '2026-08-03');

    const [{ data }] = prisma.faltaFuncionario.create.mock.calls[0];
    expect((data.data as Date).toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(data.competencia).toBe('2026-08');
  });

  it('recusa dia fora do formato', async () => {
    const { service } = montarServico();

    await expect(service.alternar('f1', '04/08/2026')).rejects.toThrow(
      BadRequestException,
    );
  });
});
