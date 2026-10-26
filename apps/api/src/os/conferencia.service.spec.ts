import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConferenciaService } from './conferencia.service';
import type { OsFechada } from './conferencia';

/**
 * A conferência das OS fechadas, do lado do serviço. O que este arquivo protege:
 *
 *  - a fila é das OS de técnico de campo (com van), e a com problema sobe;
 *  - os avisos da lista do dia não releem o IXC a cada abertura;
 *  - o problema volta só para o técnico da OS, ele responde, e "conferida"
 *    depois disso é problema resolvido — com o motivo guardado para o mês.
 */

type Linha = Record<string, unknown> & { osIxcId: number };

function fechada(id: number, dados: Partial<OsFechada> = {}): OsFechada {
  return {
    id,
    protocolo: null,
    status: 'F',
    prioridade: null,
    assuntoId: 14,
    clienteId: 900 + id,
    contratoId: 2294,
    loginId: 0,
    filialId: 1,
    setorId: 3,
    tecnicoId: 57,
    abertura: '2026-10-23 08:00:00',
    agenda: null,
    fechamento: '2026-10-23 10:00:00',
    mensagem: null,
    endereco: 'Rua das Palmeiras, 42',
    relatorio: 'Troquei o conector.',
    ...dados,
  };
}

function montar() {
  const conferencias: Linha[] = [];
  const os = [
    fechada(1),
    // Instalação sem aparelho: sobe na lista.
    fechada(2, { assuntoId: 1, fechamento: '2026-10-23 11:00:00' }),
    // Técnico sem van (escritório): fica de fora.
    fechada(3, { tecnicoId: 99 }),
    // De outro dia.
    fechada(4, { fechamento: '2026-10-22 09:00:00' }),
  ];
  const combina = (l: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return (v as { in: unknown[] }).in.includes(l[k]);
      if (v && typeof v === 'object' && 'startsWith' in v) {
        return String(l[k]).startsWith((v as { startsWith: string }).startsWith);
      }
      return l[k] === v;
    });

  const prisma = {
    conferenciaDeOs: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => conferencias.filter((l) => combina(l, where)).length),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => conferencias.filter((l) => combina(l, where))),
      findUnique: jest.fn(async ({ where }: { where: { osIxcId: number } }) => conferencias.find((l) => l.osIxcId === where.osIxcId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: { where: { osIxcId: number }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const achada = conferencias.find((l) => l.osIxcId === where.osIxcId);
        if (achada) return Object.assign(achada, update);
        const nova = {
          teveProblema: false,
          motivo: null,
          observacao: null,
          respostaDoTecnico: null,
          respondidaEm: null,
          resolucao: null,
          resolvidaPor: null,
          resolvidaEm: null,
          ...create,
        } as unknown as Linha;
        conferencias.push(nova);
        return nova;
      }),
      update: jest.fn(async ({ where, data }: { where: { osIxcId: number }; data: Record<string, unknown> }) =>
        Object.assign(conferencias.find((l) => l.osIxcId === where.osIxcId)!, data),
      ),
    },
    registroDeOs: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
  };
  const doIxc = {
    fechadasEntre: jest.fn(async (inicio: string, fim: string) =>
      os.filter((o) => o.fechamento!.slice(0, 10) >= inicio && o.fechamento!.slice(0, 10) <= fim),
    ),
    osFechada: jest.fn(async (id: number) => os.find((o) => o.id === id) ?? null),
    nomesDosAssuntos: jest.fn(async () => new Map([[1, 'Inst Fibra'], [14, 'Suporte Técnico']])),
    nomesDosClientes: jest.fn(async (ids: number[]) => new Map(ids.map((id) => [id, `Cliente ${id}`]))),
    assunto: jest.fn(async () => ({ fotosExigidas: 0, assinaturaObrigatoria: false, aparelhosExigidos: 0 })),
    arquivosDaOs: jest.fn(async (id: number) => [{ id: 100 + id, osId: id, descricao: 'Caixa', classificacao: 'P' }]),
    aparelhosDaOs: jest.fn(async () => []),
    mensagensDaOs: jest.fn(async () => []),
    comodatosDoContrato: jest.fn(async () => []),
    materiaisDetalhadosDaOs: jest.fn(async () => []),
  };
  const tecnicos = {
    lista: jest.fn(async () => [
      { ixcId: 57, nome: 'Cleyson', almox: { ok: true } },
      { ixcId: 81, nome: 'Rafael', almox: { ok: true } },
      { ixcId: 99, nome: 'Leticia', almox: { ok: false } },
    ]),
    doLogin: jest.fn(async (usuarioId: string) => ({ ixcId: usuarioId === 'u-rafael' ? 81 : 57 })),
  };
  const service = new ConferenciaService(prisma as never, doIxc as never, tecnicos as never);
  return { service, prisma, doIxc, tecnicos, conferencias };
}

const chefe = { nome: 'Werick' };
const cleyson = { id: 'u-cleyson', nome: 'cleyson' };
const rafael = { id: 'u-rafael', nome: 'rafael' };

describe('ConferenciaService.doDia', () => {
  it('só as OS de técnico de campo, a com problema primeiro', async () => {
    const t = montar();
    const dia = await t.service.doDia('2026-10-23');

    expect(dia.os.map((o) => o.id)).toEqual([2, 1]);
    expect(dia.os[0]).toMatchObject({
      tecnico: 'Cleyson',
      assunto: 'Inst Fibra',
      cliente: 'Cliente 902',
      fotos: 1,
      conferencia: null,
    });
    expect(dia.os[0].sinais.map((s) => s.codigo)).toEqual(['SEM_APARELHO']);
    expect(dia.os[1].sinais).toEqual([]);
  });

  it('os avisos ficam guardados: abrir o dia de novo não relê cada OS no IXC', async () => {
    const t = montar();
    await t.service.doDia('2026-10-23');
    await t.service.doDia('2026-10-23');
    expect(t.doIxc.aparelhosDaOs).toHaveBeenCalledTimes(2);
  });

  it('o dia em outro formato não vale', async () => {
    const t = montar();
    await expect(t.service.doDia('23/10/2026')).rejects.toThrow(BadRequestException);
  });
});

describe('ConferenciaService.fila', () => {
  it('conta por dia e abre no dia mais antigo que falta conferir', async () => {
    const t = montar();
    await t.service.conferir(1, { situacao: 'CONFERIDA' }, chefe);
    const fila = await t.service.fila(new Date('2026-10-23T15:00:00Z'));

    expect(fila.dias[0]).toEqual({ dia: '2026-10-23', total: 2, conferidas: 1, problemas: 0, pendentes: 1 });
    expect(fila.dias[1]).toEqual({ dia: '2026-10-22', total: 1, conferidas: 0, problemas: 0, pendentes: 1 });
    expect(fila.dias).toHaveLength(7);
    expect(fila.primeiroPendente).toBe('2026-10-22');
  });
});

describe('ConferenciaService.conferir', () => {
  it('o problema volta para o técnico da OS, ele responde, e a base resolve', async () => {
    const t = montar();
    await expect(t.service.conferir(2, { situacao: 'PROBLEMA' }, chefe)).rejects.toThrow(/motivo/);

    const problema = await t.service.conferir(
      2,
      { situacao: 'PROBLEMA', motivo: 'APARELHO_FORA_DO_COMODATO', observacao: 'A ONU da foto não está no contrato.' },
      chefe,
    );
    expect(problema).toMatchObject({ situacao: 'PROBLEMA', motivoTexto: /comodato/, conferidaPor: 'Werick' });
    // O retrato do que se viu, para a lista de problemas não reler o IXC.
    expect(t.conferencias[0]).toMatchObject({
      dia: '2026-10-23',
      tecnicoIxcId: 57,
      tecnico: 'Cleyson',
      cliente: 'Cliente 902',
      assunto: 'Inst Fibra',
    });

    expect(await t.service.doTecnico(rafael)).toEqual([]);
    await expect(t.service.responder(rafael, 2, 'Não é minha.')).rejects.toThrow(NotFoundException);
    const doCleyson = await t.service.doTecnico(cleyson);
    expect(doCleyson).toEqual([expect.objectContaining({ osIxcId: 2, observacao: 'A ONU da foto não está no contrato.' })]);

    const respondida = await t.service.responder(cleyson, 2, 'Vinculei a ONU no IXC.');
    expect(respondida.respostaDoTecnico).toBe('Vinculei a ONU no IXC.');
    expect(await t.service.problemas()).toEqual([expect.objectContaining({ osIxcId: 2, respostaDoTecnico: 'Vinculei a ONU no IXC.' })]);

    const resolvida = await t.service.conferir(2, { situacao: 'CONFERIDA', observacao: 'Conferi no IXC.' }, chefe);
    expect(resolvida).toMatchObject({
      situacao: 'RESOLVIDA',
      teveProblema: true,
      // O motivo fica, para o relatório do mês contar.
      motivo: 'APARELHO_FORA_DO_COMODATO',
      resolucao: 'Conferi no IXC.',
      resolvidaPor: 'Werick',
    });
    expect(await t.service.doTecnico(cleyson)).toEqual([]);
    await expect(t.service.responder(cleyson, 2, 'De novo.')).rejects.toThrow(/não está mais com problema/);
  });

  it('a OS que não fechou não se confere', async () => {
    const t = montar();
    t.doIxc.osFechada.mockResolvedValueOnce(fechada(5, { status: 'EX', fechamento: null }));
    await expect(t.service.conferir(5, { situacao: 'CONFERIDA' }, chefe)).rejects.toThrow(/ainda não fechou/);
    expect(t.conferencias).toHaveLength(0);
  });
});

describe('ConferenciaService.relatorio', () => {
  it('conta as conferências do mês, pelo dia em que a OS fechou', async () => {
    const t = montar();
    await t.service.conferir(1, { situacao: 'CONFERIDA' }, chefe);
    await t.service.conferir(2, { situacao: 'PROBLEMA', motivo: 'FALTOU_FOTO' }, chefe);
    const r = await t.service.relatorio('2026-10');
    expect(r).toMatchObject({ conferidas: 2, dePrimeira: 1, comProblema: 1, abertas: 1 });
    expect((await t.service.relatorio('2026-09')).conferidas).toBe(0);
    await expect(t.service.relatorio('10/2026')).rejects.toThrow(BadRequestException);
  });
});
