import { colunaDoTombo, PatrimoniosService } from './patrimonios.service';

/**
 * O número de patrimônio. O que este arquivo protege:
 *
 *  - o primeiro número é 37871 (até 37870 a casa já usou), e cada peça leva o seguinte;
 *  - o número vai para a coluna onde o IXC pôs o código sorteado, com a linha inteira;
 *  - número que não colou no IXC volta para a fila — não fica um buraco nem um falso.
 */

function montar(pecas: Record<number, Record<string, unknown>>, opcoes: { recusa?: boolean } = {}) {
  const dados: Array<{ numero: number; idPatrimonioIxc: number }> = [];
  const prisma = {
    numeroDePatrimonio: {
      aggregate: jest.fn(async () => ({ _max: { numero: dados.length ? Math.max(...dados.map((d) => d.numero)) : null } })),
      findUnique: jest.fn(async ({ where }: { where: { idPatrimonioIxc: number } }) =>
        dados.find((d) => d.idPatrimonioIxc === where.idPatrimonioIxc) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: { numero: number; idPatrimonioIxc: number } }) => {
        dados.push(data);
        return data;
      }),
      delete: jest.fn(async ({ where }: { where: { numero: number } }) => {
        dados.splice(dados.findIndex((d) => d.numero === where.numero), 1);
        return {};
      }),
    },
  };
  const ixc = {
    update: jest.fn(async (_t: string, id: number, corpo: Record<string, unknown>) => {
      if (opcoes.recusa) throw new Error('Ocorreu um erro ao processar');
      pecas[id] = { ...corpo };
      return {};
    }),
    getById: jest.fn(async (t: string, _c: string, id: number) =>
      t === 'cliente_contrato'
        ? { id: String(id), id_cliente: '77', contrato: 'FIBRA 300', status: 'A', endereco: 'Rua A', numero: '12', bairro: 'Centro' }
        : t === 'cliente'
          ? { id: '77', razao: 'FULANO DE TAL' }
          : (pecas[id] ?? null),
    ),
    listAll: jest.fn(async (t: string) =>
      t === 'movimento_produtos'
        ? [
            { id: '1', id_patrimonio: '10', tipo: 'E', id_entrada: '3553', data: '2026-11-10', id_almox: '4' },
            { id: '2', id_patrimonio: '10', tipo: 'S', id_contrato: '2294', status_comodato: 'E', data: '2026-11-15', id_almox: '4' },
            { id: '3', id_patrimonio: '99', tipo: 'S', id_entrada: '1' },
          ]
        : Object.values(pecas),
    ),
  };
  const produtos = {
    paraMovimentar: jest.fn(async () => [[], [{ id: 4, nome: 'ILNET' }]]),
    cadastrosPorId: jest.fn(async () => new Map([[1392, { descricao: 'ONU SIMPLES AN5506-01-A' }]])),
  };
  return { service: new PatrimoniosService(prisma as never, ixc as never, produtos as never), ixc, dados };
}

describe('o número de patrimônio', () => {
  it('começa em 37871 e segue em sequência, na coluna do código sorteado', async () => {
    const pecas: Record<number, Record<string, unknown>> = {
      32068: { id: '32068', id_produto: '1392', serial: 'M53I1', serial_fornecedor: '', situacao: '1' },
      32069: { id: '32069', id_produto: '1392', serial: 'N5FN1', serial_fornecedor: '', situacao: '1' },
    };
    const { service, ixc, dados } = montar(pecas);
    const feitas = await service.numerar(Object.values(pecas), { produto: 'ONU', entradaId: 3600 }, { nome: 'A' });
    expect(feitas).toEqual([
      { patrimonioId: 32068, numero: 37871 },
      { patrimonioId: 32069, numero: 37872 },
    ]);
    expect(pecas[32068].serial).toBe('37871');
    // A linha inteira volta: o webservice reescreve o registro.
    expect(ixc.update.mock.calls[0][2]).toMatchObject({ id: '32068', id_produto: '1392', situacao: '1', serial: '37871' });
    expect(dados.map((d) => d.numero)).toEqual([37871, 37872]);
    expect(await service.proximoNumero()).toBe(37873);
  });

  it('peça que já tem número não ganha outro', async () => {
    const pecas = { 1: { id: '1', id_produto: '5', serial: 'ABCDE' } };
    const { service, ixc } = montar(pecas);
    await service.numerar([pecas[1]], { produto: 'P' }, { nome: 'A' });
    const [segunda] = await service.numerar([pecas[1]], { produto: 'P' }, { nome: 'A' });
    expect(segunda).toEqual({ patrimonioId: 1, numero: 37871 });
    expect(ixc.update).toHaveBeenCalledTimes(1);
  });

  it('o IXC recusou: o número volta para a fila', async () => {
    const pecas = { 1: { id: '1', id_produto: '5', serial: 'ABCDE' } };
    const { service, dados } = montar(pecas, { recusa: true });
    const [feita] = await service.numerar([pecas[1]], { produto: 'P' }, { nome: 'A' });
    expect(feita).toMatchObject({ patrimonioId: 1, numero: null });
    expect(feita.erro).toContain('erro ao processar');
    expect(dados).toHaveLength(0);
    expect(await service.proximoNumero()).toBe(37871);
  });

  it('a coluna do tombo é a que o IXC preencheu', () => {
    expect(colunaDoTombo({ serial: 'ABCDE' })).toBe('serial');
    expect(colunaDoTombo({ serial: '', nro_patrimonio: 'XY12Z' })).toBe('nro_patrimonio');
    expect(colunaDoTombo({ id: '1' })).toBe('serial');
  });

  it('a consulta traz as numeradas do IXC, da mais nova para a mais velha, e acha por série ou produto', async () => {
    const pecas: Record<number, Record<string, unknown>> = {
      10: { id: '10', id_produto: '1392', id_almoxarifado: '4', serial: '37850', serial_fornecedor: 'FHTT0734BBF8', situacao: '1' },
      11: { id: '11', id_produto: '1392', id_almoxarifado: '4', serial: '37870', serial_fornecedor: '', situacao: '4' },
      12: { id: '12', id_produto: '1392', id_almoxarifado: '4', serial: 'M53I1', serial_fornecedor: '', situacao: '1' },
    };
    const { service } = montar(pecas);
    const r = await service.consultar({});
    expect(r.pecas.map((p) => p.tombo)).toEqual(['37870', '37850']);
    expect(r.pecas[0]).toMatchObject({ produto: 'ONU SIMPLES AN5506-01-A', almoxarifado: 'ILNET', situacao: 'em comodato' });
    expect(r.semSerie).toBe(1);
    expect((await service.consultar({ busca: 'bbf8' })).pecas.map((p) => p.tombo)).toEqual(['37850']);
    expect((await service.consultar({ busca: 'onu simples' })).total).toBe(2);
    expect((await service.consultar({ todas: true })).total).toBe(3);
  });

  it('o detalhe diz com qual cliente a peça está, e por onde ela passou', async () => {
    const pecas = { 10: { id: '10', id_produto: '1392', id_almoxarifado: '4', serial: '36800', situacao: '4' } };
    const { service } = montar(pecas as Record<number, Record<string, unknown>>);
    const d = await service.detalhar(10);
    expect(d.comodato).toMatchObject({ contratoId: 2294, cliente: 'FULANO DE TAL', plano: 'FIBRA 300', endereco: 'Rua A, 12 — Centro', desde: '2026-11-15' });
    expect(d.movimentos.map((m) => m.oque)).toEqual(['Comodato no contrato #2294', 'Compra #3553']);
    expect(d.peca).toMatchObject({ tombo: '36800', situacao: 'em comodato', almoxarifado: 'ILNET' });
  });
});
