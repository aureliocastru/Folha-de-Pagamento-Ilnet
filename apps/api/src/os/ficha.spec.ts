import {
  lerContratoDaFicha,
  lerLoginDaFicha,
  montarFicha,
  numerosNoTexto,
  telefonesDoCliente,
} from './ficha';
import type { OsDoIxc } from './os-ixc';

/**
 * A ficha que o técnico lê antes de começar o serviço.
 *
 * O que se prova aqui é o que decide se ele consegue chegar e falar com o
 * cliente: de onde sai cada telefone (e qual número não é telefone), que o
 * endereço não repete a cidade que já está escrito nele, e que a ficha se
 * monta mesmo quando o IXC não devolveu o contrato ou o login.
 *
 * Os campos vieram da base de produção em 29/10/2026 (OS 93634) — o cadastro
 * do cliente, do contrato e do login dele estão nos testes como o IXC os
 * devolveu, abreviados.
 */

const OS: OsDoIxc = {
  id: 93634,
  protocolo: '20261029083609988989',
  status: 'A',
  prioridade: 'N',
  assuntoId: 14,
  clienteId: 5107,
  contratoId: 16366,
  loginId: 4889,
  filialId: 1,
  setorId: 3,
  tecnicoId: 57,
  abertura: '2026-10-29 08:36:15',
  agenda: null,
  fechamento: null,
  mensagem: 'Suporte Técnico - mudar o roteador de cômodo \r\n5599984782642',
  endereco:
    'MA São Mateus do Maranhão 65470-000 Centro - Avenida Antônio Pereira Aragão, SN — Central Sorriso',
  cidadeId: 637,
  referencia: null,
  coordenada: { latitude: -4.0406942, longitude: -44.4649361 },
};

const CLIENTE: Record<string, unknown> = {
  id: '5107',
  razao: 'Natanael Lucena de Sousa',
  fantasia: 'Natanael Lucena de Sousa',
  cnpj_cpf: '056.667.783-07',
  tipo_pessoa: 'F',
  fone: '',
  telefone_celular: '(99) 98478-2642',
  telefone_comercial: '',
  whatsapp: '',
  email: '',
  hotsite_email: 'natanael.lucena@ilnet.net.br',
  contato: '',
  obs: '',
  alerta: 'CONTRATO VAI SER DESATIVADO PORQUE CLIENTE SOLICITOU CANCELAMENTO',
  cep: '65470-000',
  cidade: '637',
  referencia: '',
  senha: '05666778307',
  latitude: '-4.0406942',
  longitude: '-44.4649361',
};

const CONTRATO: Record<string, unknown> = {
  id: '16366',
  status: 'A',
  status_internet: 'A',
  contrato: '825MB_2023',
  descricao_aux_plano_venda: '825MB_2023',
  data_ativacao: '2025-12-18',
  cep: '65470-000',
  obs: '',
  latitude: '',
  longitude: '',
};

const LOGIN: Record<string, unknown> = {
  id: '4889',
  login: 'natanael.lucena@ilnet.net.br',
  senha: '05666778307',
  ativo: 'S',
  online: 'S',
  ip: '100.80.12.82',
  mac: 'A8:C0:92:F8:B1:EB',
  onu_mac: 'FHTT06fa65c8',
  id_caixa_ftth: '45',
  ftth_porta: '8',
  ultima_conexao_inicial: '2026-10-23 08:39:50',
  sinal_ultimo_atendimento: '',
};

const CIDADE = { nome: 'São Mateus do Maranhão', uf: 'MA' };

function ficha(mudancas: Partial<Parameters<typeof montarFicha>[1]> = {}, os: OsDoIxc = OS) {
  return montarFicha(os, {
    assunto: 'Suporte Técnico',
    filial: 'ILNET',
    cliente: CLIENTE,
    contrato: CONTRATO,
    login: LOGIN,
    cidade: CIDADE,
    ...mudancas,
  });
}

describe('telefonesDoCliente', () => {
  it('junta o do cadastro e o que o atendimento digitou na OS, sem repetir', () => {
    expect(telefonesDoCliente(CLIENTE, OS.mensagem)).toEqual([
      { rotulo: 'Celular', numero: '(99) 98478-2642', digitos: '99984782642' },
    ]);
  });

  it('o número só da mensagem entra, dizendo de onde veio', () => {
    expect(telefonesDoCliente({ ...CLIENTE, telefone_celular: '' }, OS.mensagem)).toEqual([
      { rotulo: 'Na mensagem da OS', numero: '5599984782642', digitos: '5599984782642' },
    ]);
  });

  it('o mesmo número com o 55 na frente não aparece duas vezes', () => {
    const telefones = telefonesDoCliente(
      { telefone_celular: '(99) 98478-2642' },
      'contato: 55 99 98478-2642',
    );
    expect(telefones).toHaveLength(1);
  });

  it('cada campo do cadastro vira uma linha, na ordem de quem atende', () => {
    expect(
      telefonesDoCliente(
        {
          fone: '(99) 3222-1000',
          telefone_celular: '(99) 98111-2222',
          whatsapp: '(99) 98333-4444',
          telefone_comercial: '(99) 3222-2000',
        },
        null,
      ).map((t) => t.rotulo),
    ).toEqual(['Celular', 'WhatsApp', 'Telefone', 'Comercial']);
  });

  it('cliente sem telefone nenhum não inventa linha', () => {
    expect(telefonesDoCliente({ fone: '', telefone_celular: '0' }, null)).toEqual([]);
  });
});

describe('numerosNoTexto', () => {
  it('acha o celular escrito solto no meio da mensagem', () => {
    expect(numerosNoTexto('Cliente pede para ligar antes: 99 98478-2642')).toEqual(['99984782642']);
  });

  it('não confunde CPF com telefone', () => {
    expect(numerosNoTexto('Titular CPF 056.667.783-07, confirmar na instalação')).toEqual([]);
  });

  it('não confunde o protocolo com telefone', () => {
    expect(numerosNoTexto('Protocolo 20261029083609988989')).toEqual([]);
  });

  it('aceita o fixo com DDD', () => {
    expect(numerosNoTexto('Recado no comércio: (99) 3222-1000')).toEqual(['9932221000']);
  });
});

describe('montarFicha', () => {
  it('traz a OS, o cliente, o contrato e o login para a tela do técnico', () => {
    const f = ficha();
    expect(f.os).toMatchObject({
      id: 93634,
      statusNome: 'aberta',
      assunto: 'Suporte Técnico',
      filial: 'ILNET',
      mensagem: OS.mensagem,
    });
    expect(f.cliente).toMatchObject({
      nome: 'Natanael Lucena de Sousa',
      documento: '056.667.783-07',
      tipoPessoa: 'F',
      alerta: 'CONTRATO VAI SER DESATIVADO PORQUE CLIENTE SOLICITOU CANCELAMENTO',
    });
    expect(f.contrato).toMatchObject({ plano: '825MB_2023', status: 'A', statusNome: 'ativo' });
    expect(f.login).toMatchObject({
      usuario: 'natanael.lucena@ilnet.net.br',
      online: true,
      caixa: '45',
      porta: '8',
    });
  });

  it('a senha do cliente na central não sai na ficha', () => {
    expect(JSON.stringify(ficha())).not.toContain('05666778307');
  });

  it('o e-mail da central serve quando o campo do e-mail está vazio', () => {
    expect(ficha().cliente?.email).toBe('natanael.lucena@ilnet.net.br');
  });

  it('não repete embaixo a cidade e o CEP que já estão na linha do endereço', () => {
    expect(ficha().endereco).toMatchObject({
      cidade: null,
      uf: null,
      cep: null,
      coordenada: { latitude: -4.0406942, longitude: -44.4649361 },
    });
  });

  it('a cidade aparece quando a linha do endereço não a tem', () => {
    const os = { ...OS, endereco: 'Rua da Serraria, 169 — Serraria' };
    expect(ficha({}, os).endereco).toMatchObject({
      linha: 'Rua da Serraria, 169 — Serraria',
      cidade: 'São Mateus do Maranhão',
      uf: 'MA',
      cep: '65470-000',
    });
  });

  it('sem ponto na OS, o mapa vai no do cliente', () => {
    const os = { ...OS, coordenada: null };
    expect(ficha({}, os).endereco.coordenada).toEqual({
      latitude: -4.0406942,
      longitude: -44.4649361,
    });
  });

  it('sem contrato e sem login no IXC, a ficha ainda vale', () => {
    const f = ficha({ contrato: null, login: null, cidade: null });
    expect(f.cliente?.nome).toBe('Natanael Lucena de Sousa');
    expect(f.contrato).toMatchObject({ id: 16366, plano: null, statusNome: null });
    expect(f.login).toMatchObject({ id: 4889, usuario: null, ativo: false, online: false });
  });

  it('OS sem cliente, sem contrato e sem login não inventa nenhum dos três', () => {
    const os = { ...OS, clienteId: 0, contratoId: 0, loginId: 0 };
    const f = ficha({ cliente: null, contrato: null, login: null }, os);
    expect(f.cliente).toBeNull();
    expect(f.contrato).toBeNull();
    expect(f.login).toBeNull();
  });

  it('cliente que o IXC não devolveu aparece pelo número, para a OS abrir', () => {
    expect(ficha({ cliente: null }).cliente).toMatchObject({
      id: 5107,
      nome: 'Cliente 5107',
      telefones: [{ rotulo: 'Na mensagem da OS', digitos: '5599984782642' }],
    });
  });
});

describe('lerContratoDaFicha e lerLoginDaFicha', () => {
  it('o contrato inativo diz isso em palavras', () => {
    expect(lerContratoDaFicha(1, { status: 'i', contrato: 'Plano X' })).toMatchObject({
      status: 'I',
      statusNome: 'inativo',
    });
  });

  it('o login fora do ar não vira "online"', () => {
    expect(lerLoginDaFicha(9, { login: 'fulano', ativo: 'S', online: 'N' })).toMatchObject({
      ativo: true,
      online: false,
    });
  });
});
