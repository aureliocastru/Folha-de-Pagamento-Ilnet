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
    cidadeId: 637,
    referencia: null,
    coordenada: null,
    relatorio: 'Troquei o conector.',
    ...dados,
  };
}

function montar() {
  const conferencias: Linha[] = [];
  const comodatos = [linhaDeComodato(501, 31483, 'FHTTBFFA3D50'), linhaDeComodato(502, 37817, 'FHTT058A9F18')];
  const pecas = new Map<number, Record<string, unknown>>([
    [31483, { situacao: '4', id_almoxarifado: '29' }],
    [37817, { situacao: '4', id_almoxarifado: '29' }],
  ]);
  const os = [
    fechada(1),
    // Instalação sem aparelho: sobe na lista.
    fechada(2, { assuntoId: 1, fechamento: '2026-10-23 11:00:00' }),
    // Técnico sem van (escritório): fica de fora.
    fechada(3, { tecnicoId: 99 }),
    // De outro dia.
    fechada(4, { fechamento: '2026-10-22 09:00:00' }),
    // Pós-venda: fica de fora, mesmo de técnico de campo (pedido de 18/11/2026).
    fechada(6, { assuntoId: 118, fechamento: '2026-10-23 12:00:00' }),
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
    nomesDosAssuntos: jest.fn(
      async () => new Map([[1, 'Inst Fibra'], [14, 'Suporte Técnico'], [118, 'PÓS VENDA']]),
    ),
    nomesDosClientes: jest.fn(async (ids: number[]) => new Map(ids.map((id) => [id, `Cliente ${id}`]))),
    assunto: jest.fn(async () => ({ fotosExigidas: 0, assinaturaObrigatoria: false, aparelhosExigidos: 0 })),
    arquivosDaOs: jest.fn(async (id: number) => [{ id: 100 + id, osId: id, descricao: 'Caixa', classificacao: 'P' }]),
    aparelhosDaOs: jest.fn(async () => []),
    mensagensDaOs: jest.fn(async () => []),
    // O contrato 2294 tem a ONU velha (linha 501) e a nova (502), emprestadas.
    comodatosDoContrato: jest.fn(async (contratoId: number) =>
      contratoId === 2294 ? comodatos.filter((c) => c.status === 'E') : [],
    ),
    comodato: jest.fn(async (id: number) => comodatos.find((c) => c.comodatoId === id) ?? null),
    patrimonio: jest.fn(async (id: number) => pecas.get(id) ?? null),
    nomeDaFilial: jest.fn(async () => 'ILNET'),
    materiaisDetalhadosDaOs: jest.fn(async () => []),
  };
  // A baixa do IXC: a linha deixa de estar emprestada e a peça vai para o almoxarifado mandado.
  const ixc = {
    action: jest.fn(async (_endpoint: string, corpo: Record<string, unknown>) => {
      const linha = comodatos.find((c) => c.comodatoId === Number(corpo.id))!;
      linha.status = 'D';
      pecas.set(linha.patrimonioId!, { situacao: '1', id_almoxarifado: String(corpo.id_almox) });
      return { type: 'success' };
    }),
  };
  const produtos = {
    paraMovimentar: jest.fn(async () => [
      [],
      [
        { id: 1, nome: 'Almoxarifado Principal', filialId: 1, ativo: true },
        { id: 4, nome: 'ILNET', filialId: 1, ativo: true },
        { id: 29, nome: 'CLEYSON', filialId: 1, ativo: true },
      ],
    ]),
  };
  const tecnicos = {
    lista: jest.fn(async () => [
      { ixcId: 57, nome: 'Cleyson', almox: { ok: true } },
      { ixcId: 81, nome: 'Rafael', almox: { ok: true } },
      { ixcId: 99, nome: 'Leticia', almox: { ok: false } },
    ]),
    doLogin: jest.fn(async (usuarioId: string) => ({ ixcId: usuarioId === 'u-rafael' ? 81 : 57 })),
  };
  const service = new ConferenciaService(
    prisma as never,
    doIxc as never,
    tecnicos as never,
    ixc as never,
    produtos as never,
  );
  return { service, prisma, doIxc, tecnicos, ixc, produtos, conferencias, comodatos, pecas };
}

function linhaDeComodato(comodatoId: number, patrimonioId: number, numeroSerie: string) {
  return {
    comodatoId,
    produtoId: 12,
    descricao: 'ONU SIMPLES AN5506-01-A',
    quantidade: 1,
    patrimonioId,
    numeroPatrimonial: String(patrimonioId),
    mac: null,
    numeroSerie,
    desde: '2026-01-09',
    status: 'E',
  };
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

  it('a OS de pós-venda fica de fora da lista, mesmo de técnico de campo', async () => {
    const t = montar();
    const dia = await t.service.doDia('2026-10-23');
    expect(dia.os.map((o) => o.id)).not.toContain(6);
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

    // A pós-venda (OS 6) não conta: o "faltam" bate com a lista do dia.
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

describe('ConferenciaService.devolverComodato', () => {
  it('baixa a linha no IXC para o almoxarifado ILNET, e devolve o comodato relido', async () => {
    const t = montar();
    const r = await t.service.devolverComodato(1, 501, chefe);

    expect(t.ixc.action).toHaveBeenCalledTimes(1);
    expect(t.ixc.action).toHaveBeenCalledWith('baixar_comodato_23069', {
      id: '501',
      id_almox: '4',
      id_almox_label: 'ILNET',
      id_filial_baixa: '1',
      id_filial_baixa_label: 'ILNET',
    });
    expect(r.destino).toBe('ILNET');
    expect(r.aviso).toBeNull();
    expect(r.comodatoDoContrato.map((c) => c.comodatoId)).toEqual([502]);
  });

  it('a linha que não está emprestada no contrato da OS não se baixa', async () => {
    const t = montar();
    t.comodatos[0].status = 'D';
    await expect(t.service.devolverComodato(1, 501, chefe)).rejects.toThrow(/já não está emprestado/);
    // Uma linha de outro contrato, com o número de uma OS deste.
    await expect(t.service.devolverComodato(1, 999, chefe)).rejects.toThrow(BadRequestException);
    expect(t.ixc.action).not.toHaveBeenCalled();
  });

  it('sem o almoxarifado ILNET ativo, não baixa', async () => {
    const t = montar();
    t.produtos.paraMovimentar.mockResolvedValueOnce([[], [{ id: 4, nome: 'ILNET', filialId: 1, ativo: false }]]);
    await expect(t.service.devolverComodato(1, 501, chefe)).rejects.toThrow(/"ILNET" ativo/);
    expect(t.ixc.action).not.toHaveBeenCalled();
  });

  it('o IXC respondeu erro mas baixou: vale; não baixou: o erro sobe', async () => {
    const t = montar();
    const baixar = t.ixc.action.getMockImplementation()!;
    t.ixc.action.mockImplementationOnce(async (e, c) => {
      await baixar(e, c);
      throw new Error('tempo esgotado');
    });
    await expect(t.service.devolverComodato(1, 501, chefe)).resolves.toMatchObject({ aviso: null });

    t.ixc.action.mockRejectedValueOnce(new Error('IXC recusou'));
    await expect(t.service.devolverComodato(1, 502, chefe)).rejects.toThrow('IXC recusou');
  });

  it('a peça relida fora do ILNET vira aviso', async () => {
    const t = montar();
    t.ixc.action.mockImplementationOnce(async (_e, corpo) => {
      t.comodatos.find((c) => c.comodatoId === Number(corpo.id))!.status = 'D';
      return { type: 'success' };
    });
    const r = await t.service.devolverComodato(1, 501, chefe);
    expect(r.aviso).toMatch(/almoxarifado #29, e não em "ILNET"/);
  });
});
