import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { IxcClient } from '../ixc/ixc.client';
import type { OsDoIxcService } from '../os/os-do-ixc.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MapaService } from './mapa.service';
import type { RastreamentoClient } from './rastreamento.client';

/** "AAAA-MM-DD HH:MM:SS" de `dias` atrás, como o IXC escreve. */
function haDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

const OS = [
  { id: '10', tipo: 'C', status: 'A', id_cliente: '50', id_tecnico: '7', id_assunto: '1', id_cidade: '9', latitude: '-2.5', longitude: '-44.3', data_abertura: haDias(1) },
  // Sem coordenada própria: é a única que faz ler login e contrato.
  { id: '11', tipo: 'C', status: 'EN', id_cliente: '51', id_login: '600', id_contrato_kit: '700', id_cidade: '9', latitude: '', longitude: '', data_abertura: haDias(2) },
  { id: '12', tipo: 'C', status: 'F', id_cliente: '52', data_abertura: haDias(1) },
  { id: '13', tipo: 'C', status: 'A', id_cliente: '53', data_abertura: haDias(400) },
  { id: '14', tipo: 'X', status: 'A', id_cliente: '54', data_abertura: haDias(1) },
  // A auditoria técnica não entra no mapa (pedido de 10/11/2026).
  { id: '15', tipo: 'C', status: 'A', id_cliente: '55', id_assunto: '117', latitude: '-2.5', longitude: '-44.3', data_abertura: haDias(1) },
];

const FUNCIONARIOS = [
  { id: '7', funcionario: 'Pedro Henrique', ativo: 'S' },
  { id: '8', funcionario: 'Ana Demitida', ativo: 'N' },
  { id: '9', funcionario: 'Bruno', ativo: 'S' },
];

function montar(opcoes: { clientesFalham?: boolean; vinculos?: unknown[] } = {}) {
  const ixc = {
    listAll: jest.fn(async (tabela: string) => {
      if (tabela === 'su_oss_chamado') return OS;
      if (tabela === 'funcionarios') return FUNCIONARIOS;
      return [];
    }),
    // `lerPorIds` pergunta pelo `IN` do grid; aqui se responde pelo que foi pedido.
    list: jest.fn(async (tabela: string, params: { gridParam?: Array<{ P: string }> }) => {
      if (tabela === 'cliente' && opcoes.clientesFalham) throw new Error('IXC lento');
      const ids = (params.gridParam?.[0]?.P ?? '').split(',').filter(Boolean);
      const registros = ids.map((id) =>
        tabela === 'cliente'
          ? { id, razao: `Cliente ${id}`, cidade: '9' }
          : tabela === 'radusuarios'
            ? { id, latitude: '-2.6', longitude: '-44.2' }
            : { id, latitude: '', longitude: '' },
      );
      return { total: registros.length, page: 1, registros };
    }),
  };
  const osDoIxc = {
    nomesDosAssuntos: jest.fn(async () => new Map([[1, 'Sem conexão'], [117, 'AUDITORIA TÉCNICA']])),
    cidade: jest.fn(async () => ({ nome: 'São Luís', uf: 'MA' })),
  };
  const rastreio = {
    problemas: jest.fn(() => []),
    configurado: true,
    grupos: jest.fn(async () => [
      { title: 'Técnicos', items: [{ id: 1024, name: 'Strada 01', online: 'online', speed: 0, lat: -2.5, lng: -44.3 }] },
    ]),
  };
  const prisma = {
    rastreadorDoTecnico: {
      findMany: jest.fn(async () => opcoes.vinculos ?? []),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
        updatedAt: new Date('2026-11-10T12:00:00Z'),
      })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const config = {
    getOrThrow: (chave: string) =>
      chave === 'mapa'
        ? { osDias: 90, osTipos: ['C', 'E'], intervalos: { frota: 15, os: 60 }, centro: [-2.5, -44.3], zoom: 12 }
        : { host: 'ixc.exemplo', token: '1:abc' },
  } as unknown as ConfigService;

  const mapa = new MapaService(
    ixc as unknown as IxcClient,
    osDoIxc as unknown as OsDoIxcService,
    rastreio as unknown as RastreamentoClient,
    prisma as unknown as PrismaService,
    config,
  );
  return { mapa, ixc, osDoIxc, rastreio, prisma };
}

describe('as OS do mapa', () => {
  it('só as abertas, dos tipos escolhidos, recentes e fora da auditoria técnica, com tudo resolvido', async () => {
    const { mapa } = montar();
    const { ordens, avisos, erro } = await mapa.ordens();
    expect(ordens.map((o) => o.id)).toEqual([10, 11]);
    expect(ordens[0]).toMatchObject({
      cliente: 'Cliente 50',
      tecnico: 'Pedro Henrique',
      assunto: 'Sem conexão',
      cidade: 'São Luís/MA',
      origemPosicao: 'os',
    });
    // A sem coordenada própria cai no login, que vem antes do contrato.
    expect(ordens[1]).toMatchObject({ lat: -2.6, lng: -44.2, origemPosicao: 'login' });
    expect(avisos).toEqual([]);
    expect(erro).toBeNull();
  });

  it('a OS que fica de fora não tem o cliente lido', async () => {
    const { mapa, ixc } = montar();
    await mapa.ordens();
    const clientes = ixc.list.mock.calls
      .filter(([tabela]) => tabela === 'cliente')
      .map(([, p]) => (p as { gridParam: Array<{ P: string }> }).gridParam[0].P);
    expect(clientes).toEqual(['50,51']);
  });

  it('login e contrato só se leem para a OS sem coordenada própria', async () => {
    const { mapa, ixc } = montar();
    await mapa.ordens();
    const pedidos = ixc.list.mock.calls.map(([tabela, p]) => [tabela, (p as { gridParam: Array<{ P: string }> }).gridParam[0].P]);
    expect(pedidos).toEqual(
      expect.arrayContaining([
        ['cliente', '50,51'],
        ['cliente_contrato', '700'],
        ['radusuarios', '600'],
      ]),
    );
  });

  /* Dez telas abertas: uma leitura só do IXC. */
  it('as telas abertas ao mesmo tempo dividem a leitura', async () => {
    const { mapa, ixc } = montar();
    await Promise.all([mapa.ordens(), mapa.ordens(), mapa.ordens()]);
    expect(ixc.listAll.mock.calls.filter(([t]) => t === 'su_oss_chamado')).toHaveLength(1);
  });

  it('um cadastro que falha vira aviso, e a OS aparece com o que se tem', async () => {
    const { mapa } = montar({ clientesFalham: true });
    const { ordens, avisos } = await mapa.ordens();
    expect(ordens).toHaveLength(2);
    expect(ordens[0].cliente).toBeNull();
    expect(avisos[0]).toMatch(/^Clientes: IXC lento/);
  });
});

describe('a frota do mapa', () => {
  it('cada veículo com o técnico da ligação feita aqui', async () => {
    const { mapa } = montar({
      vinculos: [{ dispositivoId: '1024', tecnicoIxcId: 7, tecnicoNome: 'Pedro', equipe: 'Norte' }],
    });
    const { veiculos } = await mapa.frota();
    expect(veiculos[0]).toMatchObject({ id: '1024', estado: 'parado', tecnicoId: 7, tecnico: 'Pedro Henrique', equipe: 'Norte' });
  });
});

describe('ligar o rastreador ao técnico', () => {
  it('guarda o nome do técnico do IXC e a próxima leitura já sai com ele', async () => {
    const { mapa, prisma, rastreio } = montar();
    await mapa.frota();
    const salvo = await mapa.vincular('1024', { tecnicoIxcId: 9, equipe: ' Sul ', nomeDoVeiculo: 'Strada 01' }, 'Henrico');
    expect(prisma.rastreadorDoTecnico.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { dispositivoId: '1024' },
        create: expect.objectContaining({ tecnicoIxcId: 9, tecnicoNome: 'Bruno', equipe: 'Sul', atualizadoPor: 'Henrico' }),
      }),
    );
    expect(salvo).toMatchObject({ dispositivoId: '1024', tecnicoNome: 'Bruno' });
    await mapa.frota();
    expect(rastreio.grupos).toHaveBeenCalledTimes(2);
  });

  it('técnico que o IXC não conhece é recusado', async () => {
    const { mapa, prisma } = montar();
    await expect(mapa.vincular('1024', { tecnicoIxcId: 999 }, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.rastreadorDoTecnico.upsert).not.toHaveBeenCalled();
  });

  it('técnico e equipe vazios desfazem a ligação', async () => {
    const { mapa, prisma } = montar();
    expect(await mapa.vincular('1024', { tecnicoIxcId: null, equipe: '  ' }, null)).toBeNull();
    expect(prisma.rastreadorDoTecnico.deleteMany).toHaveBeenCalledWith({ where: { dispositivoId: '1024' } });
  });
});

describe('a tela de rastreadores', () => {
  it('separa a ligação de aparelho que saiu da conta, e põe os ativos primeiro', async () => {
    const guardada = (dispositivoId: string) => ({
      dispositivoId,
      nomeDoVeiculo: 'Velho',
      tecnicoIxcId: 7,
      tecnicoNome: 'Pedro',
      equipe: null,
      atualizadoPor: null,
      updatedAt: new Date('2026-11-01T12:00:00Z'),
    });
    const { mapa } = montar({ vinculos: [guardada('1024'), guardada('5555')] });
    const tela = await mapa.rastreadores();
    expect(tela.veiculos).toHaveLength(1);
    expect(tela.veiculos[0].vinculo?.tecnicoIxcId).toBe(7);
    expect(tela.semAparelho.map((v) => v.dispositivoId)).toEqual(['5555']);
    expect(tela.tecnicos.map((t) => t.nome)).toEqual(['Bruno', 'Pedro Henrique', 'Ana Demitida']);
  });
});
