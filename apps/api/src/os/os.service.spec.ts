import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OsService } from './os.service';
import type { OsDoIxc } from './os-ixc';

/**
 * A OS no celular do técnico, de anotar a gravar no IXC. O que este arquivo
 * protege:
 *
 *  - a OS de outro técnico não se mexe;
 *  - o mesmo material duas vezes vira uma linha só, e o anotado e não enviado
 *    conta contra o saldo da van;
 *  - gravar vai na ordem (instalado, retirado, material), com o almoxarifado
 *    do técnico em cada escrita;
 *  - o IXC que responde erro e grava vira "gravado com aviso", o que não
 *    gravou vira "falhou", e o que não dá para saber vira "conferir" — nunca
 *    uma segunda escrita às cegas;
 *  - o item que outro pedido já pegou não é escrito duas vezes;
 *  - o IXC que aceita e não faz (a peça continua na van) deixa aviso.
 */

// ---------------------------------------------------------------------------
// Um banco de mentira, só com o que o serviço usa
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown> & { id: string };

function bancoFalso() {
  const registros: Linha[] = [];
  const itens: Linha[] = [];
  const materiais: Linha[] = [];
  let seq = 0;

  const combina = (linha: Linha, where: Record<string, unknown> = {}): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'registro') {
        const r = registros.find((x) => x.id === linha.registroId);
        return !!r && combina(r, cond as Record<string, unknown>);
      }
      const valor = linha[campo];
      if (cond && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof Prisma.Decimal)) {
        const c = cond as Record<string, unknown>;
        if ('in' in c) return (c.in as unknown[]).includes(valor);
        if ('not' in c) return valor !== c.not;
        if ('lt' in c) return (valor as Date).getTime() < (c.lt as Date).getTime();
      }
      return valor === cond;
    });

  const aplicar = (linha: Linha, data: Record<string, unknown>) => {
    for (const [campo, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as object)) {
        const inc = (v as { increment: unknown }).increment;
        linha[campo] =
          linha[campo] instanceof Prisma.Decimal
            ? (linha[campo] as Prisma.Decimal).plus(inc as Prisma.Decimal)
            : Number(linha[campo] ?? 0) + Number(inc);
      } else {
        linha[campo] = v;
      }
    }
    linha.updatedAt = new Date();
  };

  const comTecnico = (i: Linha) => ({
    ...i,
    tecnico: { nome: 'Cleyson Souza', apelido: 'Cleyson' },
    registro: registros.find((r) => r.id === i.registroId),
  });

  const prisma = {
    registroDeOs: {
      findUnique: jest.fn(async ({ where, include }: { where: Record<string, unknown>; include?: { itens?: { where?: Record<string, unknown> } } }) => {
        const r = registros.find((x) => combina(x, where));
        if (!r) return null;
        if (!include?.itens) return r;
        return {
          ...r,
          itens: itens
            .filter((i) => i.registroId === r.id && combina(i, include.itens?.where))
            .map(comTecnico),
        };
      }),
      upsert: jest.fn(async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const r = registros.find((x) => combina(x, where));
        if (r) {
          aplicar(r, update);
          return r;
        }
        const novo = { id: `r${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
        registros.push(novo);
        return novo;
      }),
      findMany: jest.fn(async () => []),
    },
    itemDeOs: {
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        itens.filter((i) => combina(i, where)).map(comTecnico),
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const i = itens.find((x) => x.id === where.id);
        return i ? comTecnico(i) : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) =>
        comTecnico(itens.find((x) => x.id === where.id)!),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const novo: Linha = {
          id: `i${++seq}`,
          situacao: 'PENDENTE',
          tentativas: 0,
          erro: null,
          aviso: null,
          gravadoEm: null,
          recebidoEm: null,
          comodatoIxcId: null,
          movimentoIxcId: null,
          patrimonioId: null,
          createdAt: new Date(Date.now() + seq),
          updatedAt: new Date(),
          ...data,
        };
        itens.push(novo);
        return comTecnico(novo);
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const i = itens.find((x) => x.id === where.id)!;
        aplicar(i, data);
        return comTecnico(i);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const achados = itens.filter((i) => combina(i, where));
        achados.forEach((i) => aplicar(i, data));
        return { count: achados.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = itens.length;
        for (let k = itens.length - 1; k >= 0; k--) if (combina(itens[k], where)) itens.splice(k, 1);
        return { count: antes - itens.length };
      }),
    },
    materialDeOs: {
      findUnique: jest.fn(async ({ where }: { where: { produtoId: number } }) =>
        materiais.find((m) => m.produtoId === where.produtoId) ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) =>
        materiais.filter((m) => combina(m, where)),
      ),
    },
  };
  return { prisma, registros, itens, materiais };
}

// ---------------------------------------------------------------------------
// O IXC de mentira, e o serviço montado
// ---------------------------------------------------------------------------

const TECNICO = {
  funcionarioId: 'f-cleyson',
  nome: 'Cleyson',
  ixcId: 17,
  almox: { id: 12, nome: 'VAN CLEYSON', filialId: 1 },
};

const OS: OsDoIxc = {
  id: 3788,
  protocolo: '2026092400123',
  status: 'EX',
  assuntoId: 4,
  clienteId: 900,
  contratoId: 2294,
  loginId: 51,
  filialId: 1,
  tecnicoId: 17,
  abertura: '2026-09-23 08:00:00',
  agenda: null,
  fechamento: null,
  mensagem: null,
  endereco: 'Rua das Palmeiras, 42',
};

const PRODUTO = (id: number, tipo = 'C') => ({
  id,
  unidadeId: 1,
  unidadeSigla: 'UN',
  tipo,
  controlaEstoque: true,
  classificacaoFiscal: 7,
  valorUnitario: 2,
  descricao: `Produto ${id}`,
});

function montar() {
  const banco = bancoFalso();
  /** Toda escrita no IXC, na ordem em que aconteceu. */
  const escritas: Array<{ recurso: string; corpo: Record<string, unknown> }> = [];
  const ixc = {
    create: jest.fn(async (recurso: string, corpo: Record<string, unknown>) => {
      escritas.push({ recurso, corpo });
      return { id: recurso === 'su_oss_mov_comodato_wiz' ? 7001 : 8001, raw: {} };
    }),
    action: jest.fn(async (recurso: string, corpo: Record<string, unknown>) => {
      escritas.push({ recurso, corpo });
      return { type: 'success' } as Record<string, unknown>;
    }),
  };
  /** O que o IXC "tem": a van, o comodato do contrato, as peças e os saldos. */
  const mundo = {
    naVan: new Set<number>([9]),
    comodatosAtivos: new Map<number, number>([[59195, 5]]), // comodato → patrimônio
    situacao: new Map<number, string>([[9, '1'], [5, '4']]),
    almoxDaPeca: new Map<number, number>([[9, 12], [5, 0]]),
    saldo: new Map<number, number>([[36, 10]]),
    materiaisDaOs: [] as Array<{ id: number; produtoId: number; quantidade: number }>,
  };
  const doIxc = {
    os: jest.fn(async () => OS),
    nomesDosAssuntos: jest.fn(async () => new Map([[4, 'Troca de equipamento']])),
    nomesDosClientes: jest.fn(async () => new Map([[900, 'Maria']])),
    nomeDaFilial: jest.fn(async () => 'F1'),
    comodatosDoContrato: jest.fn(async () =>
      [...mundo.comodatosAtivos.entries()].map(([comodatoId, patrimonioId]) => ({
        comodatoId,
        produtoId: 34,
        descricao: null,
        quantidade: 1,
        patrimonioId,
        numeroPatrimonial: null,
        mac: 'AA:BB',
        numeroSerie: null,
        desde: null,
        status: 'E',
      })),
    ),
    comodato: jest.fn(async (id: number) => ({
      comodatoId: id,
      status: mundo.comodatosAtivos.has(id) ? 'E' : 'D',
    })),
    comodatosDaOs: jest.fn(async () => [{ id: 7001, patrimonioId: 9 }]),
    materiaisDaOs: jest.fn(async () => mundo.materiaisDaOs),
    aparelhosNoAlmox: jest.fn(async () =>
      [...mundo.naVan].map((patrimonioId) => ({
        patrimonioId,
        produtoId: 34,
        descricao: 'ONU',
        numeroPatrimonial: null,
        mac: null,
        numeroSerie: null,
        situacao: '7',
      })),
    ),
    patrimonio: jest.fn(async (id: number) => ({
      id: String(id),
      situacao: mundo.situacao.get(id),
      id_almoxarifado: String(mundo.almoxDaPeca.get(id) ?? 0),
    })),
    saldosNoAlmox: jest.fn(async () => new Map(mundo.saldo)),
    produtoParaOs: jest.fn(async (id: number) => PRODUTO(id, id === 34 ? 'P' : 'C')),
  };
  const tecnicos = { doLogin: jest.fn(async () => TECNICO) };
  const transferencias = { acharPeca: jest.fn() };
  const produtos = {
    paraMovimentar: jest.fn(async () => [[], [{ id: 12, nome: 'VAN CLEYSON', filialId: 1, ativo: true }]]),
    cadastrosPorId: jest.fn(async () => new Map([[34, { descricao: 'ONU HUAWEI' }]])),
  };
  const service = new OsService(
    banco.prisma as never,
    ixc as never,
    doIxc as never,
    tecnicos as never,
    transferencias as never,
    produtos as never,
    { esquecer: jest.fn() } as never,
    { esquecer: jest.fn() } as never,
  );
  return { service, banco, ixc, doIxc, mundo, transferencias, escritas };
}

const login = { id: 'u1', nome: 'Cleyson' };

/** Um item já anotado, direto no banco. */
async function anotado(
  banco: ReturnType<typeof bancoFalso>,
  dados: Record<string, unknown>,
): Promise<Linha> {
  const registro = await banco.prisma.registroDeOs.upsert({
    where: { osIxcId: OS.id },
    create: { osIxcId: OS.id, filialId: 1 },
    update: {},
  });
  return (await banco.prisma.itemDeOs.create({
    data: {
      registroId: registro.id,
      tecnicoId: TECNICO.funcionarioId,
      almoxId: 12,
      almoxarifado: 'VAN CLEYSON',
      registradoPor: 'Cleyson',
      descricao: 'x',
      quantidade: new Prisma.Decimal(1),
      ...dados,
    },
  })) as unknown as Linha;
}

// ---------------------------------------------------------------------------

describe('OsService — anotar', () => {
  it('a OS de outro técnico não se mexe', async () => {
    const { service, doIxc } = montar();
    doIxc.os.mockResolvedValueOnce({ ...OS, tecnicoId: 99 });
    await expect(service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 1 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('o mesmo material duas vezes vira uma linha só, somada', async () => {
    const { service, banco } = montar();
    banco.materiais.push({ id: 'm1', produtoId: 36, descricao: 'CONECTOR', unidade: 'UN', ativo: true, aparelho: false, maximoPorOs: null });

    await service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 2 });
    const segundo = await service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 1 });

    expect(banco.itens.filter((i) => i.tipo === 'MATERIAL')).toHaveLength(1);
    expect(segundo.quantidade).toBe(3);
  });

  it('o anotado e não enviado conta contra o saldo da van', async () => {
    const { service, banco, mundo } = montar();
    banco.materiais.push({ id: 'm1', produtoId: 36, descricao: 'CONECTOR', unidade: 'UN', ativo: true, aparelho: false, maximoPorOs: null });
    mundo.saldo.set(36, 4);

    await service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 3 });
    await expect(
      service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 2 }),
    ).rejects.toThrow(/Você tem 1 UN/);
  });

  it('retirada pede como o aparelho voltou, e só do comodato deste contrato', async () => {
    const { service } = montar();
    await expect(service.anotar(login, OS.id, { tipo: 'RETIRADO', comodatoId: 59195 })).rejects.toThrow(
      /como o aparelho voltou/,
    );
    await expect(
      service.anotar(login, OS.id, { tipo: 'RETIRADO', comodatoId: 1, condicao: 'DEFEITO' }),
    ).rejects.toThrow(/não está em comodato no contrato/);
    const ok = await service.anotar(login, OS.id, {
      tipo: 'RETIRADO',
      comodatoId: 59195,
      condicao: 'DEFEITO',
    });
    expect(ok).toMatchObject({ tipo: 'RETIRADO', comodatoIxcId: 59195, patrimonioId: 5, condicao: 'DEFEITO' });
  });

  it('instalar confere a peça bipada contra a van do técnico', async () => {
    const { service, transferencias, banco } = montar();
    banco.materiais.push({ id: 'a1', produtoId: 34, descricao: 'ONU', unidade: 'UN', ativo: true, aparelho: true, maximoPorOs: null });
    transferencias.acharPeca.mockResolvedValue({
      patrimonioId: 9,
      produtoId: 34,
      descricao: 'ONU',
      numeroPatrimonial: null,
      mac: 'AA',
      numeroSerie: null,
      almoxId: 1,
      almoxarifado: 'Almoxarifado Principal',
      situacao: 'disponível',
      podeMover: true,
      impedimento: null,
    });
    await expect(
      service.anotar(login, OS.id, { tipo: 'INSTALADO', codigo: 'AA' }),
    ).rejects.toThrow(/Almoxarifado Principal/);
  });

  it('ferramenta da van não se instala: só o que está na lista de aparelhos', async () => {
    const { service, transferencias, banco } = montar();
    banco.materiais.push({ id: 'a1', produtoId: 34, descricao: 'ONU', unidade: 'UN', ativo: true, aparelho: true, maximoPorOs: null });
    transferencias.acharPeca.mockResolvedValue({
      patrimonioId: 14239, produtoId: 900, descricao: 'CANETA DE LIMPEZA FIBRA OPTICA', numeroPatrimonial: null,
      mac: null, numeroSerie: 'J3KP', almoxId: 12, almoxarifado: 'VAN CLEYSON', situacao: 'disponível com o técnico',
      podeMover: true, impedimento: null,
    });
    await expect(service.anotar(login, OS.id, { tipo: 'INSTALADO', codigo: 'J3KP' })).rejects.toThrow(
      /CANETA DE LIMPEZA.*não está na lista de aparelhos/,
    );
  });

  it('aparelho não entra como material', async () => {
    const { service, banco } = montar();
    banco.materiais.push({ id: 'a1', produtoId: 36, descricao: 'ONU', unidade: 'UN', ativo: true, aparelho: true, maximoPorOs: null });
    await expect(service.anotar(login, OS.id, { tipo: 'MATERIAL', produtoId: 36, quantidade: 1 })).rejects.toThrow(
      /lista de materiais/,
    );
  });
});

describe('OsService — gravar no IXC', () => {
  it('grava na ordem, cada um no seu recurso, com a van do técnico', async () => {
    const { service, banco, ixc, mundo, escritas } = montar();
    await anotado(banco, { tipo: 'MATERIAL', produtoId: 36, quantidade: new Prisma.Decimal(3) });
    await anotado(banco, { tipo: 'RETIRADO', produtoId: 34, patrimonioId: 5, comodatoIxcId: 59195 });
    await anotado(banco, { tipo: 'INSTALADO', produtoId: 34, patrimonioId: 9 });

    // O IXC faz o que se pediu: a peça nova vai a comodato, a velha volta à van, o saldo baixa.
    ixc.create.mockImplementation(async (recurso: string, corpo: Record<string, unknown>) => {
      escritas.push({ recurso, corpo });
      if (recurso === 'su_oss_mov_comodato_wiz') mundo.situacao.set(9, '4');
      if (recurso === 'su_oss_mov_produto') mundo.saldo.set(36, 7);
      return { id: recurso === 'su_oss_mov_comodato_wiz' ? 7001 : 8001, raw: {} };
    });
    ixc.action.mockImplementation(async (recurso: string, corpo: Record<string, unknown>) => {
      escritas.push({ recurso, corpo });
      mundo.situacao.set(5, '1');
      mundo.almoxDaPeca.set(5, 12);
      return { type: 'success' };
    });

    const r = await service.gravar(login, OS.id);

    expect(r).toEqual({ gravados: 3, falharam: 0, conferir: 0, avisos: 0 });
    const ordem = escritas;
    expect(ordem.map((o) => o.recurso)).toEqual([
      'su_oss_mov_comodato_wiz',
      'baixar_comodato_23069',
      'su_oss_mov_produto',
    ]);
    expect(ordem[0].corpo).toMatchObject({
      id_oss_chamado: '3788',
      id_almox: '12',
      id_patrimonio: '9',
      id_contrato: '2294',
      tipo: 'S',
      // A situação que a peça tinha na van, relida antes de escrever.
      ultima_situacao_patrimonio: '7',
    });
    expect(ordem[1].corpo).toMatchObject({ id: '59195', id_almox: '12', id_almox_label: 'VAN CLEYSON' });
    expect(ordem[2].corpo).toMatchObject({ id_oss_chamado: '3788', id_almox: '12', qtde_saida: '3.00000' });

    const porTipo = Object.fromEntries(banco.itens.map((i) => [i.tipo, i]));
    expect(porTipo.INSTALADO).toMatchObject({ situacao: 'GRAVADO', comodatoIxcId: 7001, aviso: null });
    expect(porTipo.RETIRADO).toMatchObject({ situacao: 'GRAVADO', aviso: null });
    expect(porTipo.MATERIAL).toMatchObject({ situacao: 'GRAVADO', movimentoIxcId: 8001, aviso: null });
  });

  it('o IXC respondeu erro mas gravou: gravado, com aviso — e não escreve de novo', async () => {
    const { service, banco, ixc, mundo } = montar();
    await anotado(banco, { tipo: 'MATERIAL', produtoId: 36, quantidade: new Prisma.Decimal(2) });
    ixc.create.mockImplementation(async () => {
      mundo.materiaisDaOs.push({ id: 8500, produtoId: 36, quantidade: 2 });
      mundo.saldo.set(36, 8);
      throw new ServiceUnavailableException('IXC (/su_oss_mov_produto): Erro inesperado, tente novamente!');
    });

    const r = await service.gravar(login, OS.id);

    expect(r.gravados).toBe(1);
    expect(banco.itens[0]).toMatchObject({ situacao: 'GRAVADO', movimentoIxcId: 8500 });
    expect(String(banco.itens[0].aviso)).toMatch(/respondeu erro.*estava lá/);
    expect(ixc.create).toHaveBeenCalledTimes(1);
  });

  it('o IXC recusou e, relido, não gravou: falhou — e a próxima gravação tenta de novo', async () => {
    const { service, banco, ixc } = montar();
    await anotado(banco, { tipo: 'RETIRADO', produtoId: 34, patrimonioId: 5, comodatoIxcId: 59195 });
    ixc.action.mockRejectedValueOnce(new ServiceUnavailableException('IXC: recusado'));

    expect(await service.gravar(login, OS.id)).toMatchObject({ gravados: 0, falharam: 1 });
    expect(banco.itens[0]).toMatchObject({ situacao: 'FALHOU', erro: 'IXC: recusado' });

    expect(await service.gravar(login, OS.id)).toMatchObject({ gravados: 1, falharam: 0 });
    expect(banco.itens[0]).toMatchObject({ situacao: 'GRAVADO', tentativas: 2 });
  });

  it('o IXC deu erro e não dá para reler: conferir, sem repetir', async () => {
    const { service, banco, ixc, doIxc } = montar();
    await anotado(banco, { tipo: 'INSTALADO', produtoId: 34, patrimonioId: 9 });
    ixc.create.mockRejectedValueOnce(new ServiceUnavailableException('IXC: tempo esgotado'));
    doIxc.patrimonio.mockResolvedValueOnce(null as never);

    expect(await service.gravar(login, OS.id)).toMatchObject({ conferir: 1 });
    expect(banco.itens[0].situacao).toBe('CONFERIR');
    // "Conferir" não volta à fila de gravar sozinho.
    await service.gravar(login, OS.id);
    expect(ixc.create).toHaveBeenCalledTimes(1);
  });

  it('o item que outro pedido já pegou não é escrito aqui', async () => {
    const { service, banco, ixc } = montar();
    await anotado(banco, { tipo: 'MATERIAL', produtoId: 36, situacao: 'GRAVANDO' });
    expect(await service.gravar(login, OS.id)).toEqual({ gravados: 0, falharam: 0, conferir: 0, avisos: 0 });
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('o aparelho saiu da van entre anotar e gravar: falha antes de ir ao IXC', async () => {
    const { service, banco, ixc, mundo } = montar();
    await anotado(banco, { tipo: 'INSTALADO', produtoId: 34, patrimonioId: 9 });
    mundo.naVan.clear();
    expect(await service.gravar(login, OS.id)).toMatchObject({ falharam: 1 });
    expect(String(banco.itens[0].erro)).toMatch(/já não está disponível/);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('o comodato já foi baixado por outro caminho: conferir, sem baixar de novo', async () => {
    const { service, banco, ixc, mundo } = montar();
    await anotado(banco, { tipo: 'RETIRADO', produtoId: 34, patrimonioId: 5, comodatoIxcId: 59195 });
    mundo.comodatosAtivos.clear();
    expect(await service.gravar(login, OS.id)).toMatchObject({ conferir: 1 });
    expect(ixc.action).not.toHaveBeenCalled();
  });

  it('o IXC aceitou o comodato mas a peça continua na van: gravado com aviso', async () => {
    const { service, banco } = montar();
    await anotado(banco, { tipo: 'INSTALADO', produtoId: 34, patrimonioId: 9 });
    expect(await service.gravar(login, OS.id)).toMatchObject({ gravados: 1, avisos: 1 });
    expect(String(banco.itens[0].aviso)).toMatch(/finalizar a OS/);
  });
});
