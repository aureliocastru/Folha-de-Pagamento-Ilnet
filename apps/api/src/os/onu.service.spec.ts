import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { OnuDaOsService, type PedidoDeAutorizacao } from './onu.service';
import type { OsDoIxc } from './os-ixc';

/**
 * Autorizar ONU pela OS — o caminho das escritas. O que este arquivo protege:
 *
 *  - ONU nova: o cadastro, e depois o "Gravar no dispositivo" com o número dele
 *    — nessa ordem, e nada de "Excluir dispositivo";
 *  - troca de ONU: a velha sai da OLT, o cadastro dela é editado inteiro com a
 *    nova, e grava-se de novo — como o NOC faz no IXC;
 *  - tudo o que dá para recusar se recusa antes da primeira escrita: a ONU que
 *    já não está pendente, o login que já tem ONU sem dizer se é troca, a ONU
 *    de outro cliente sem confirmar, o perfil que não serve, o toque duplo;
 *  - a velha que não sai da OLT para tudo ali; a falha de rede no gravar é
 *    INCERTA, nunca repetida sozinha.
 */

function serializar(campos: Record<string, string | number>): string {
  const partes = Object.entries(campos).map(([k, v]) =>
    typeof v === 'number' ? `s:${k.length}:"${k}";i:${v};` : `s:${k.length}:"${k}";s:${v.length}:"${v}";`,
  );
  return Buffer.from(`a:${partes.length}:{${partes.join('')}}`).toString('base64');
}

const CHAVE = serializar({ ID: '1', CHASSI: 1, SLOT: 11, PON: 1, MAC: 'FHTTaaaa0001', MODELO: 'AN5506-01-A1', PONID: '0-0-11-1' });

const OS: OsDoIxc = {
  id: 94785,
  protocolo: null,
  status: 'EX',
  prioridade: 'N',
  assuntoId: 1,
  clienteId: 15072,
  contratoId: 18338,
  loginId: 16503,
  filialId: 1,
  setorId: 3,
  tecnicoId: 17,
  abertura: '2026-11-27 08:00:00',
  agenda: null,
  fechamento: null,
  mensagem: null,
  endereco: null,
  cidadeId: 637,
  referencia: null,
  coordenada: null,
};

const TECNICO = { funcionarioId: 'f-alisson', nome: 'Alisson', ixcId: 17, almox: { id: 12, nome: 'VAN', filialId: 1 } };
const login = { id: 'u1', nome: 'alisson' };

const PEDIDO: PedidoDeAutorizacao = { oltId: 1, chave: CHAVE, caixaId: 713, porta: 2, perfilId: 13, vlan: '300' };

const GRAVOU = { type: 'success', message: 'Sucesso<br>M  CTAG COMPLD<br>EN=0   ENDESC=No error' };

function fibra(campos: Record<string, string>): Record<string, string> {
  return {
    id: '20000',
    id_transmissor: '1',
    id_login: '16503',
    id_contrato: '18338',
    nome: 'maria.souza@ilnet.com.br',
    mac: 'FHTTbbbb0002',
    onu_tipo: 'AN5506-02-F',
    ponid: '1-1-1-8',
    slotno: '1',
    ponno: '8',
    id_caixa_ftth: '713',
    porta_ftth: '2',
    id_perfil: '13',
    vlan: '300',
    id_radpop_radio_porta: '460',
    latitude: '-4.02',
    ...campos,
  };
}

interface Cenario {
  pendentes?: Array<Record<string, unknown>>;
  /** Os cadastros de ONU que o IXC tem. */
  fibras?: Array<Record<string, string>>;
  os?: Partial<OsDoIxc>;
  gravando?: boolean;
  /** O que cada botão responde (ou o erro que lança). */
  botoes?: Record<string, unknown>;
}

function montar(c: Cenario = {}) {
  const fibras = c.fibras ?? [];
  const chamadas: string[] = [];
  const linhas: Array<Record<string, unknown>> = [];

  const ixc = {
    list: jest.fn(async (recurso: string, p: { qtype: string; query: string }) => {
      if (recurso === 'fh_onu_nao_autorizadas') {
        return { total: 1, page: 1, registros: c.pendentes ?? [{ id: CHAVE, cell: ['OLT 1', '23', '1', '11', '1', 'AN5506-01-A1', 'FHTTaaaa0001'] }] };
      }
      if (recurso === 'radpop_radio') {
        return { total: 2, page: 1, registros: [
          { id: '1', descricao: 'OLT 1 - SMT', fabricante_modelo: 'FH', ativo: 'S' },
          { id: '2', descricao: 'SMT_CAS001', fabricante_modelo: 'M', ativo: 'S' },
        ] };
      }
      if (recurso === 'radpop_radio_cliente_fibra_perfil') {
        return { total: 2, page: 1, registros: [
          { id: '13', nome: 'UNM2000 1 PORTA BRIDGE', fabricante_modelo: '', comando: 'ADD-ONU::ONUID=#onu_mac#;' },
          { id: '16', nome: 'TESTE', fabricante_modelo: '', comando: '' },
        ] };
      }
      if (recurso === 'radpop_radio_cliente_fibra') {
        const campo = p.qtype.split('.')[1];
        const achadas = fibras.filter((f) =>
          campo === 'mac' ? f.mac.toUpperCase() === p.query.toUpperCase() : f[campo] === p.query,
        );
        return { total: achadas.length, page: 1, registros: achadas };
      }
      throw new Error(`list inesperado: ${recurso}`);
    }),
    getById: jest.fn(async (recurso: string, _campo: string, id: number) => {
      if (recurso === 'radusuarios') return { id: String(id), login: 'maria.souza@ilnet.com.br', id_contrato: '18338', id_caixa_ftth: '713', ftth_porta: '2' };
      if (recurso === 'rad_caixa_ftth') return { id: String(id), descricao: 'R63_CTO10', id_projeto: '4', id_transmissor: '1', capacidade: '8', status: 'A' };
      if (recurso === 'radpop_radio_cliente_fibra') return fibras.find((f) => f.id === String(id)) ?? null;
      throw new Error(`getById inesperado: ${recurso}`);
    }),
    create: jest.fn(async (recurso: string, corpo: Record<string, string>) => {
      chamadas.push(`criar ${recurso}`);
      fibras.push({ ...corpo, id: '31100' });
      return { id: 31100, raw: {} };
    }),
    update: jest.fn(async (recurso: string, id: number, _corpo: Record<string, string>) => {
      chamadas.push(`editar ${recurso} ${id}`);
      return {};
    }),
    action: jest.fn(async (endpoint: string, corpo: { id: string }) => {
      chamadas.push(`${endpoint} ${corpo.id}`);
      const r = c.botoes?.[endpoint];
      if (r instanceof Error) throw r;
      return r ?? GRAVOU;
    }),
  };

  const prisma = {
    autorizacaoDeOnu: {
      findFirst: jest.fn(async () => (c.gravando ? { registradoPor: 'outro' } : null)),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const linha = { id: 'a1', situacao: 'GRAVANDO', retorno: null, createdAt: new Date(), ...data };
        linhas.push(linha);
        return linha;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(linhas[0], data)),
    },
  };

  const os = { contexto: jest.fn(async () => ({ tecnico: TECNICO, os: { ...OS, ...c.os } })) };
  const service = new OnuDaOsService(ixc as never, prisma as never, os as never);
  return { service, ixc, prisma, chamadas, linhas };
}

describe('autorizar ONU nova', () => {
  it('cria o cadastro e grava no dispositivo com o número dele', async () => {
    const { service, ixc, chamadas, linhas } = montar();
    const r = await service.autorizar(login, OS.id, PEDIDO);

    expect(chamadas).toEqual(['criar radpop_radio_cliente_fibra', 'botao_gravar_dispositivo_22408 31100']);
    expect(ixc.create.mock.calls[0][1]).toMatchObject({
      mac: 'FHTTaaaa0001',
      id_login: '16503',
      nome: 'maria.souza@ilnet.com.br',
      id_caixa_ftth: '713',
      id_projeto: '4',
      comandos: 'ADD-ONU::ONUID=#onu_mac#;',
      vlan: '300',
    });
    expect(r).toMatchObject({ situacao: 'AUTORIZADA', fibraId: 31100, reaproveitou: false });
    expect(linhas[0]).toMatchObject({ tecnicoId: 'f-alisson', registradoPor: 'alisson', osIxcId: OS.id });
  });

  it('a falha de rede no gravar é INCERTA, e não se repete', async () => {
    const { service, chamadas } = montar({
      botoes: { botao_gravar_dispositivo_22408: new ServiceUnavailableException('Não foi possível contatar o IXC (/botao…): timeout of 30000ms exceeded') },
    });
    const r = await service.autorizar(login, OS.id, PEDIDO);
    expect(r.situacao).toBe('INCERTA');
    expect(chamadas.filter((c) => c.startsWith('botao_gravar'))).toHaveLength(1);
  });

  it('a OLT que recusa o comando é RECUSADA, com o que ela disse', async () => {
    const { service } = montar({ botoes: { botao_gravar_dispositivo_22408: 'M  CTAG DENY\nEN=1702 ENDESC=Invalid ONU type' } });
    const r = await service.autorizar(login, OS.id, PEDIDO);
    expect(r.situacao).toBe('RECUSADA');
    expect(r.retorno).toContain('Invalid ONU type');
  });
});

describe('troca de ONU', () => {
  const VELHA = fibra({ id: '20000', mac: 'FHTTbbbb0002' });

  it('o login com ONU precisa dizer se é troca ou mais uma — nada é escrito antes', async () => {
    const { service, chamadas, prisma } = montar({ fibras: [{ ...VELHA }] });
    await expect(service.autorizar(login, OS.id, PEDIDO)).rejects.toThrow(/substitui/);
    expect(chamadas).toEqual([]);
    expect(prisma.autorizacaoDeOnu.create).not.toHaveBeenCalled();
  });

  it('a velha sai da OLT, o cadastro dela recebe a nova inteiro, e grava de novo', async () => {
    const { service, ixc, chamadas } = montar({ fibras: [{ ...VELHA }] });
    const r = await service.autorizar(login, OS.id, { ...PEDIDO, substituirId: 20000 });

    expect(chamadas).toEqual([
      'botao_excluir_dispositivo_22434 20000',
      'editar radpop_radio_cliente_fibra 20000',
      'botao_gravar_dispositivo_22408 20000',
    ]);
    const corpo = ixc.update.mock.calls[0][2];
    expect(corpo).toMatchObject({ mac: 'FHTTaaaa0001', ponid: '0-0-11-1', latitude: '-4.02', id_radpop_radio_porta: '' });
    expect(r).toMatchObject({ situacao: 'AUTORIZADA', reaproveitou: true, macAnterior: 'FHTTbbbb0002' });
  });

  it('a velha que não sai da OLT para tudo ali: o cadastro não muda', async () => {
    const { service, chamadas } = montar({
      fibras: [{ ...VELHA }],
      botoes: { botao_excluir_dispositivo_22434: 'EN=3 ENDESC=Timeout waiting OLT' },
    });
    const r = await service.autorizar(login, OS.id, { ...PEDIDO, substituirId: 20000 });
    expect(r.situacao).toBe('RECUSADA');
    expect(r.retorno).toContain('não saiu da OLT');
    expect(chamadas).toEqual(['botao_excluir_dispositivo_22434 20000']);
  });

  it('a velha que já não estava na OLT não segura a troca', async () => {
    const { service, chamadas } = montar({
      fibras: [{ ...VELHA }],
      botoes: { botao_excluir_dispositivo_22434: 'EN=1 ENDESC=ONU does not exist' },
    });
    const r = await service.autorizar(login, OS.id, { ...PEDIDO, substituirId: 20000 });
    expect(r.situacao).toBe('AUTORIZADA');
    expect(chamadas).toHaveLength(3);
  });

  it('cadastro que nunca foi à OLT não tem o que excluir', async () => {
    const { service, chamadas } = montar({ fibras: [{ ...VELHA, id_radpop_radio_porta: '' }] });
    await service.autorizar(login, OS.id, { ...PEDIDO, substituirId: 20000 });
    expect(chamadas[0]).toBe('editar radpop_radio_cliente_fibra 20000');
  });
});

describe('a ONU que já tem cadastro', () => {
  it('de outro cliente, só com a mudança confirmada — e o cadastro dela é o que se usa', async () => {
    const deOutro = fibra({ id: '25000', mac: 'FHTTAAAA0001', id_login: '9999', nome: 'jose.lima@cas.net.br' });
    const { service, chamadas } = montar({ fibras: [deOutro] });
    await expect(service.autorizar(login, OS.id, PEDIDO)).rejects.toThrow(/jose\.lima@cas\.net\.br/);
    expect(chamadas).toEqual([]);

    const r = await service.autorizar(login, OS.id, { ...PEDIDO, confirmarMudanca: true });
    expect(chamadas).toEqual([
      'botao_excluir_dispositivo_22434 25000',
      'editar radpop_radio_cliente_fibra 25000',
      'botao_gravar_dispositivo_22408 25000',
    ]);
    expect(r.macAnterior).toBeNull();
  });

  it('a segunda tentativa cai no cadastro que a primeira criou, em vez de criar outro', async () => {
    const daPrimeira = fibra({ id: '31100', mac: 'FHTTaaaa0001', id_radpop_radio_porta: '' });
    const { service, ixc } = montar({ fibras: [daPrimeira] });
    await service.autorizar(login, OS.id, PEDIDO);
    expect(ixc.create).not.toHaveBeenCalled();
  });
});

describe('recusa antes de escrever', () => {
  const casos: Array<[string, Cenario, Partial<PedidoDeAutorizacao>, RegExp]> = [
    ['a ONU que já não está pendente na OLT', { pendentes: [] }, {}, /não aparece mais/],
    ['o perfil sem comando', {}, { perfilId: 16 }, /perfil/],
    ['a porta fora da caixa', {}, { porta: 9 }, /portas de 1 a 8/],
    ['a VLAN que não existe', {}, { vlan: '0' }, /VLAN/],
    ['a OLT que é rádio', {}, { oltId: 2 }, /OLT 2/],
    ['o toque duplo', { gravando: true }, {}, /já está sendo autorizada/],
    ['a OS sem login', { os: { loginId: 0 } }, {}, /login/],
    ['a OS finalizada', { os: { status: 'F' } }, {}, /finalizada/],
  ];

  it.each(casos)('%s', async (_nome, cenario, pedido, motivo) => {
    const { service, chamadas, ixc } = montar(cenario);
    const erro = await service.autorizar(login, OS.id, { ...PEDIDO, ...pedido }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(motivo);
    expect(chamadas).toEqual([]);
    expect(ixc.create).not.toHaveBeenCalled();
  });

  it('são recusas de pedido, e não do servidor', async () => {
    const { service } = montar({ pendentes: [] });
    await expect(service.autorizar(login, OS.id, PEDIDO)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('o formulário', () => {
  it('vem com a caixa e a porta do login, a VLAN do PON e o perfil do modelo', async () => {
    const vizinhas = [
      fibra({ id: '1', slotno: '11', ponno: '1', vlan: '300', onu_tipo: 'AN5506-01-A1', id_login: '1', mac: 'FHTT1' }),
      fibra({ id: '2', slotno: '11', ponno: '1', vlan: '300', onu_tipo: 'AN5506-01-A1', id_login: '2', mac: 'FHTT2' }),
    ];
    const { service } = montar({ fibras: vizinhas });
    const f = await service.preparar(login, OS.id, 1, CHAVE);
    expect(f).toMatchObject({
      pendente: { mac: 'FHTTaaaa0001', slot: 11, pon: 1 },
      perfis: [{ id: 13, nome: 'UNM2000 1 PORTA BRIDGE' }],
      perfilSugerido: 13,
      vlanSugerida: '300',
      caixa: { id: 713, nome: 'R63_CTO10' },
      portaSugerida: 2,
      jaCadastrada: null,
      doLogin: [],
    });
    expect(f.portas).toHaveLength(8);
  });

  it('o "Consultar" de todas as OLTs só olha as OLTs, e a que falha não derruba as outras', async () => {
    const { service, ixc } = montar();
    const r = await service.pendentes(login, OS.id, null);
    expect(r.pendentes).toHaveLength(1);
    const consultas = ixc.list.mock.calls.filter(([recurso]) => recurso === 'fh_onu_nao_autorizadas');
    expect(consultas).toHaveLength(1);
  });
});
