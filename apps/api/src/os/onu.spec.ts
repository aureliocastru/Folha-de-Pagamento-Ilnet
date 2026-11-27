import {
  corpoDaOnuNova,
  corpoDaOnuReaproveitada,
  desserializarPhp,
  explicarRecusa,
  lerCaixa,
  lerGravacao,
  lerOlt,
  lerOnuDoIxc,
  lerPendente,
  lerPerfil,
  mesmoMac,
  naoEstavaNaOlt,
  perfilSugerido,
  perfisDaOlt,
  portasDaCaixa,
  textoDaResposta,
  vlanSugerida,
  vlanValida,
  type DadosDaAutorizacao,
  type OnuDoIxc,
} from './onu';

/**
 * Autorizar ONU pela OS — as regras. Os formatos são os do IXC desta casa,
 * lidos em 27/11/2026 (a grade de ONUs não autorizadas da OLT 1, o cadastro
 * de uma ONU autorizada naquela manhã, o retorno da Fiberhome no "Gravar no
 * dispositivo"); os valores são inventados.
 */

/** Um array do PHP serializado, como o `id` das linhas da grade. */
function serializar(campos: Record<string, string | number>): string {
  const partes = Object.entries(campos).map(([k, v]) =>
    typeof v === 'number' ? `s:${k.length}:"${k}";i:${v};` : `s:${k.length}:"${k}";s:${v.length}:"${v}";`,
  );
  return Buffer.from(`a:${partes.length}:{${partes.join('')}}`).toString('base64');
}

const CHAVE = serializar({
  ID: '1',
  CHASSI: 1,
  SLOT: 11,
  PON: 1,
  MAC: 'FHTT0a0b0c0d',
  MODELO: 'AN5506-01-A1',
  PONID: '0-0-11-1',
});

const LINHA_PENDENTE = {
  id: CHAVE,
  cell: ['OLT 1 - SMT - AN5116-06B', '23', '1', '11', '1', 'AN5506-01-A1', 'FHTT0a0b0c0d'],
};

const OLT = lerOlt({
  id: '1',
  descricao: 'OLT 1 - SMT - AN5116-06B',
  fabricante_modelo: 'FH',
  ativo: 'S',
  perfil_fibra_padrao: '0',
})!;

/** O cadastro de uma ONU autorizada, como a listagem do IXC devolve. */
function fibra(campos: Record<string, string> = {}): Record<string, string> {
  return {
    id: '31035',
    id_transmissor: '1',
    id_login: '16503',
    id_contrato: '18338',
    nome: 'maria.souza@ilnet.com.br',
    mac: 'FHTT0a0b0c0d',
    onu_tipo: 'AN5506-01-A1',
    ponid: '1-1-11-1',
    slotno: '11',
    ponno: '1',
    id_caixa_ftth: '713',
    porta_ftth: '2',
    id_perfil: '13',
    vlan: '300',
    sinal_rx: '-19.62',
    sinal_tx: '2.86',
    data_sinal: '2026-11-27 09:12:55',
    id_radpop_radio_porta: '496',
    comandos: 'ADD-ONU::…',
    onu_numero: '89',
    id_projeto: '4',
    latitude: '-4.02',
    ...campos,
  };
}

function onu(campos: Record<string, string> = {}): OnuDoIxc {
  return lerOnuDoIxc(fibra(campos))!;
}

describe('a grade de ONUs não autorizadas', () => {
  it('decodifica o array do PHP do id', () => {
    expect(desserializarPhp(CHAVE)).toEqual({
      ID: '1',
      CHASSI: '1',
      SLOT: '11',
      PON: '1',
      MAC: 'FHTT0a0b0c0d',
      MODELO: 'AN5506-01-A1',
      PONID: '0-0-11-1',
    });
  });

  it('lê a linha com o que a OLT disse, e guarda o id como a chave', () => {
    expect(lerPendente(LINHA_PENDENTE)).toEqual({
      chave: CHAVE,
      oltId: 1,
      olt: 'OLT 1 - SMT - AN5116-06B',
      chassi: 1,
      slot: 11,
      pon: 1,
      ponid: '0-0-11-1',
      mac: 'FHTT0a0b0c0d',
      modelo: 'AN5506-01-A1',
    });
  });

  it('sem um campo no id, completa pela célula — com ou sem a coluna do POP', () => {
    const semMac = serializar({ ID: '91', SLOT: 3, PON: 12, PONID: '0-0-3-12' });
    const comPop = lerPendente({ id: semMac, cell: ['OLT 2', '23', '1', '3', '12', 'AN5506-02-F', 'FHTT11112222'] });
    const semPop = lerPendente({ id: semMac, cell: ['OLT 2', '1', '3', '12', 'AN5506-02-F', 'FHTT11112222'] });
    for (const p of [comPop, semPop]) {
      expect(p).toMatchObject({ oltId: 91, slot: 3, pon: 12, mac: 'FHTT11112222', modelo: 'AN5506-02-F' });
    }
  });

  it('a linha sem OLT, sem serial ou sem PON não vira ONU', () => {
    expect(lerPendente({ id: serializar({ SLOT: 1, PON: 1, MAC: 'FHTT1' }) })).toBeNull();
    expect(lerPendente({ id: serializar({ ID: '1', SLOT: 1, PON: 1 }) })).toBeNull();
    expect(lerPendente({ id: serializar({ ID: '1', MAC: 'FHTT1' }) })).toBeNull();
    expect(lerPendente({})).toBeNull();
  });
});

describe('as OLTs', () => {
  it('só as OLTs ativas — os rádios Mikrotik ("M") não são OLT', () => {
    expect(OLT).toEqual({ id: 1, nome: 'OLT 1 - SMT - AN5116-06B', fabricante: 'FH', perfilPadrao: null });
    expect(lerOlt({ id: '2', descricao: 'SMT_CAS001', fabricante_modelo: 'M', ativo: 'S' })).toBeNull();
    expect(lerOlt({ id: '9', descricao: 'OLT velha', fabricante_modelo: 'FH', ativo: 'N' })).toBeNull();
  });
});

describe('o cadastro da ONU no IXC', () => {
  it('lê o cadastro, com o sinal e se ele já foi à OLT', () => {
    expect(onu()).toMatchObject({
      id: 31035,
      oltId: 1,
      loginId: 16503,
      mac: 'FHTT0a0b0c0d',
      caixaId: 713,
      porta: 2,
      perfilId: 13,
      vlan: '300',
      sinal: { rx: '-19.62', tx: '2.86', em: '2026-11-27 09:12:55' },
      naOlt: true,
    });
  });

  it('o zero do IXC é vazio: sinal nunca lido, cadastro que não foi à OLT', () => {
    const nova = onu({ sinal_rx: '0.00', sinal_tx: '', data_sinal: '0000-00-00 00:00:00', id_radpop_radio_porta: '' });
    expect(nova.sinal).toEqual({ rx: null, tx: null, em: null });
    expect(nova.naOlt).toBe(false);
  });

  it('o mesmo serial, escrito de outro jeito, é a mesma ONU', () => {
    expect(mesmoMac('FHTT0a0b0c0d', 'fhtt0A0B0C0D')).toBe(true);
    expect(mesmoMac('AA:BB:CC:DD:EE:FF', 'aabbccddeeff')).toBe(true);
    expect(mesmoMac('FHTT0a0b0c0d', 'FHTT0a0b0c0e')).toBe(false);
    expect(mesmoMac('', '')).toBe(false);
  });
});

describe('os perfis', () => {
  const perfis = [
    lerPerfil({ id: '13', nome: 'UNM2000 1 PORTA BRIDGE', fabricante_modelo: '', comando: 'ADD-ONU::OLTID=#olt_ip#;' })!,
    lerPerfil({ id: '14', nome: 'ROUTER 4 PORTAS', fabricante_modelo: '', comando: 'ADD-ONU::…#pppoe_login#;' })!,
    lerPerfil({ id: '16', nome: 'TESTE - 2022', fabricante_modelo: '', comando: '' })!,
    lerPerfil({ id: '20', nome: 'Huawei', fabricante_modelo: 'HW', comando: 'ont add …' })!,
  ];

  it('servem à OLT os sem fabricante e os da marca dela, e só com comando', () => {
    expect(perfisDaOlt(perfis, OLT).map((p) => p.id)).toEqual([13, 14]);
  });

  it('a sugestão é o perfil que o modelo mais usa, entre os que servem', () => {
    const validos = perfisDaOlt(perfis, OLT);
    const doModelo = [onu({ id_perfil: '13' }), onu({ id_perfil: '13' }), onu({ id_perfil: '14' }), onu({ id_perfil: '20' }), onu({ id_perfil: '20' }), onu({ id_perfil: '20' })];
    expect(perfilSugerido(doModelo, validos, OLT)).toBe(13);
  });

  it('sem histórico do modelo, o padrão da OLT — se ele servir', () => {
    const validos = perfisDaOlt(perfis, OLT);
    expect(perfilSugerido([], validos, { ...OLT, perfilPadrao: 14 })).toBe(14);
    expect(perfilSugerido([], validos, { ...OLT, perfilPadrao: 99 })).toBeNull();
  });
});

describe('a VLAN', () => {
  it('vale de 1 a 4094; o "0" e o vazio do IXC não são VLAN', () => {
    expect(vlanValida('300')).toBe('300');
    expect(vlanValida(' 0240 ')).toBe('240');
    expect(vlanValida('0')).toBeNull();
    expect(vlanValida('')).toBeNull();
    expect(vlanValida('4095')).toBeNull();
    expect(vlanValida('30a')).toBeNull();
  });

  it('é a que o PON mais usa, passando por cima da exceção perdida', () => {
    const doPon = [onu({ vlan: '300' }), onu({ vlan: '300' }), onu({ vlan: '360' }), onu({ vlan: '' })];
    expect(vlanSugerida(doPon, [onu({ vlan: '240' })])).toBe('300');
  });

  it('PON sem ONU nenhuma usa a da OLT', () => {
    expect(vlanSugerida([], [onu({ vlan: '240' }), onu({ vlan: '240' }), onu({ vlan: '0' })])).toBe('240');
    expect(vlanSugerida([], [])).toBeNull();
  });
});

describe('a caixa e as portas', () => {
  const caixa = lerCaixa({ id: '713', descricao: 'R63_CTO10', id_projeto: '4', id_transmissor: '1', capacidade: '8', status: 'A' })!;

  it('lê a caixa com o projeto e a OLT', () => {
    expect(caixa).toEqual({ id: 713, nome: 'R63_CTO10', oltId: 1, projetoId: 4, capacidade: 8, ativa: true });
  });

  it('as portas da 1 à capacidade, com quem está em cada uma', () => {
    const portas = portasDaCaixa(caixa, [
      onu({ porta_ftth: '2', nome: 'maria.souza@ilnet.com.br', id_login: '16503' }),
      onu({ porta_ftth: '5', nome: 'jose.lima@cas.net.br', id_login: '13373' }),
      onu({ porta_ftth: '3', id_caixa_ftth: '714', nome: 'de.outra.caixa' }),
    ]);
    expect(portas).toHaveLength(8);
    expect(portas[1]).toEqual({ porta: 2, ocupadaPor: 'maria.souza@ilnet.com.br', loginId: 16503 });
    expect(portas[2]).toEqual({ porta: 3, ocupadaPor: null, loginId: null });
    expect(portas[4].ocupadaPor).toBe('jose.lima@cas.net.br');
  });

  it('a porta ocupada além da capacidade do cadastro aparece', () => {
    expect(portasDaCaixa(caixa, [onu({ porta_ftth: '10' })])).toHaveLength(10);
  });
});

describe('o corpo do cadastro', () => {
  const dados: DadosDaAutorizacao = {
    pendente: lerPendente(LINHA_PENDENTE)!,
    loginId: 16503,
    login: 'maria.souza@ilnet.com.br',
    contratoId: 18338,
    caixa: lerCaixa({ id: '713', descricao: 'R63_CTO10', id_projeto: '4', capacidade: '8' })!,
    porta: 2,
    perfil: lerPerfil({ id: '13', nome: 'UNM2000 1 PORTA BRIDGE', comando: 'ADD-ONU::OLTID=#olt_ip#;\r\nCFG-LANPORTVLAN::CVLAN=#vlan#;' })!,
    vlan: '300',
  };

  it('a ONU nova leva o que a tela do IXC grava: OLT, PON, login, caixa, perfil com o comando, VLAN', () => {
    expect(corpoDaOnuNova(dados)).toMatchObject({
      id_transmissor: '1',
      ponid: '0-0-11-1',
      slotno: '11',
      ponno: '1',
      mac: 'FHTT0a0b0c0d',
      onu_tipo: 'AN5506-01-A1',
      tipo_autenticacao: 'MAC',
      nome: 'maria.souza@ilnet.com.br',
      id_login: '16503',
      id_contrato: '18338',
      id_caixa_ftth: '713',
      porta_ftth: '2',
      id_projeto: '4',
      id_perfil: '13',
      // O texto do perfil, como está: quem troca as variáveis é o IXC, ao gravar.
      comandos: 'ADD-ONU::OLTID=#olt_ip#;\r\nCFG-LANPORTVLAN::CVLAN=#vlan#;',
      vlan: '300',
      radpop_estrutura: 'N',
      onu_rede_neutra: 'N',
    });
  });

  it('o reaproveitado vai inteiro, com a ONU nova por cima e a posição antiga apagada', () => {
    const atual = fibra({ mac: 'FHTT99998888', onu_tipo: 'AN5506-02-F', ponid: '1-1-1-8', vlan: '300' });
    const corpo = corpoDaOnuReaproveitada(atual, dados);
    expect(corpo).not.toHaveProperty('id');
    expect(corpo).toMatchObject({
      mac: 'FHTT0a0b0c0d',
      onu_tipo: 'AN5506-01-A1',
      ponid: '0-0-11-1',
      // O que é do cadastro e não da ONU fica.
      latitude: '-4.02',
      // O que é da posição velha sai — o IXC preenche de novo.
      id_radpop_radio_porta: '',
      sinal_rx: '',
      data_sinal: '',
      onu_numero: '',
    });
  });
});

describe('a resposta da OLT', () => {
  const COMPLD = (en: number, desc: string) =>
    `\n\n   FH_192.168.11.202 2026-11-27 10:55:25\nM  CTAG COMPLD\n   EN=${en}   ENDESC=${desc}\n;`;

  it('todos os comandos com EN=0 é ONU autorizada', () => {
    const r = lerGravacao({ operacao: 'Sucesso', 'retorno 1': COMPLD(0, 'No error'), 'retorno 2': COMPLD(0, 'No error') });
    expect(r.desfecho).toBe('AUTORIZADA');
  });

  it('o texto chega sem o HTML do painel', () => {
    const html = `<div class="panel panel-success"><div class="panel-body">Sucesso<br>M  CTAG COMPLD<br>EN=0&nbsp;&nbsp;ENDESC=No error</div></div>`;
    expect(textoDaResposta({ type: 'success', message: html })).toBe('Sucesso\nM CTAG COMPLD\nEN=0 ENDESC=No error');
    expect(lerGravacao({ type: 'success', message: html }).desfecho).toBe('AUTORIZADA');
  });

  it('nenhum comando passou é recusada', () => {
    expect(lerGravacao(`M  CTAG DENY\n   EN=1702   ENDESC=ONU is already authorized`).desfecho).toBe('RECUSADA');
    expect(lerGravacao({ type: 'error', message: 'Falha ao conectar na OLT' }).desfecho).toBe('RECUSADA');
    expect(lerGravacao('<div class="panel panel-danger">Não foi possível</div>').desfecho).toBe('RECUSADA');
  });

  it('uma parte passou e outra não é incerta — a ONU pode ter entrado sem a VLAN', () => {
    expect(lerGravacao(COMPLD(0, 'No error') + COMPLD(17, 'Invalid VLAN')).desfecho).toBe('INCERTA');
  });

  it('o que não dá para ler é incerto, e não sucesso', () => {
    expect(lerGravacao({}).desfecho).toBe('INCERTA');
    expect(lerGravacao('').desfecho).toBe('INCERTA');
  });

  it('no "Excluir dispositivo", a ONU que já não estava na OLT não é erro', () => {
    expect(naoEstavaNaOlt('EN=1 ENDESC=ONU does not exist')).toBe(true);
    expect(naoEstavaNaOlt('Registro não encontrado')).toBe(true);
    expect(naoEstavaNaOlt('EN=3 ENDESC=Timeout')).toBe(false);
  });

  it('a recusa por permissão diz o que liberar no IXC', () => {
    expect(explicarRecusa('IXC (/botao_gravar_dispositivo_22408): Recurso botao_gravar_dispositivo_22408 não está disponível!'))
      .toContain('Gravar no dispositivo');
    expect(explicarRecusa('Falha ao conectar')).toBe('Falha ao conectar');
  });
});
