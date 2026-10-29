/**
 * A ficha da OS: o que o técnico lê antes de começar o serviço — o mesmo que
 * o IXC põe no papel do "matricial modelo 1", mais o telefone para ligar e o
 * ponto no mapa para chegar.
 *
 * Montada aqui, campo a campo, sem cliente HTTP nenhum, como o resto do que
 * se lê do IXC nesta pasta. Quatro cadastros de lá entram nela, pelos números
 * que a própria OS guarda:
 *
 *  - `cliente` (`id_cliente`) — nome, documento, os telefones, o aviso que o
 *    atendimento deixou no cadastro, e o endereço quando a OS não tem o seu;
 *  - `cliente_contrato` (`id_contrato_kit`) — o plano e a situação dele;
 *  - `radusuarios` (`id_login`) — o login do cliente, se está no ar, a caixa
 *    e a porta onde a fibra dele termina;
 *  - `cidade` (`id_cidade`) com a `uf` — o nome da cidade e a sigla.
 *
 * **Nada daqui se escreve.** A ficha é leitura: o que o técnico faz na OS
 * continua passando por `OsService`.
 *
 * O que ficou de fora, e por quê:
 *
 *  - **o setor da OS** — o IXC não publica `su_oss_setor` ("Recurso não está
 *    disponível", conferido em 29/10/2026), e o número cru não diz nada a
 *    quem está no portão do cliente;
 *  - **o melhor horário do agendamento** — nas 400 OS mais recentes desta
 *    base, todas estão em "Q" (conferido em 29/10/2026): o campo não separa
 *    nada aqui;
 *  - **a senha do cliente na central** (`cliente.senha`) — não é dado de
 *    serviço, e ninguém precisa dela no portão.
 */

import {
  coordenada,
  STATUS_DA_OS,
  type Coordenada,
  type OsDoIxc,
  type PrioridadeDaOs,
} from './os-ixc';

/** A situação do contrato no IXC, em palavras. */
export const STATUS_DO_CONTRATO: Record<string, string> = {
  A: 'ativo',
  I: 'inativo',
  D: 'desistiu',
  N: 'negativado',
  P: 'pré-contrato',
};

/**
 * Um telefone do cliente, pronto para a tela virar um botão de ligar ou de
 * WhatsApp. O `numero` sai como está no cadastro — é o que a pessoa lê e
 * confere —, e os `digitos` são para o link.
 */
export interface TelefoneDoCliente {
  /** De onde ele veio: "Celular", "WhatsApp", "Na mensagem da OS"… */
  rotulo: string;
  numero: string;
  digitos: string;
}

/** O cliente da OS, no que a ficha mostra dele. */
export interface ClienteDaFicha {
  id: number;
  nome: string;
  /** F pessoa física, J jurídica. */
  tipoPessoa: string | null;
  documento: string | null;
  telefones: TelefoneDoCliente[];
  email: string | null;
  /** O nome de quem atende, quando o cadastro diz. */
  contato: string | null;
  /** O aviso que pisca no IXC ao abrir o cliente — o técnico tem de saber. */
  alerta: string | null;
  observacao: string | null;
}

/** O endereço do serviço, como a ficha o mostra. */
export interface EnderecoDaFicha {
  /** A linha que a lista do técnico já mostra: rua, número, bairro, referência. */
  linha: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  referencia: string | null;
  coordenada: Coordenada | null;
}

export interface ContratoDaFicha {
  id: number;
  /** O nome do plano ("825MB_2023"). */
  plano: string | null;
  status: string | null;
  statusNome: string | null;
  /** "AAAA-MM-DD". */
  ativacao: string | null;
  observacao: string | null;
}

export interface LoginDaFicha {
  id: number;
  usuario: string | null;
  ativo: boolean;
  online: boolean;
  ip: string | null;
  mac: string | null;
  /** O MAC da ONU, quando é fibra. */
  onu: string | null;
  /** A caixa de atendimento e a porta onde a fibra do cliente termina. */
  caixa: string | null;
  porta: string | null;
  /** Quando o login subiu pela última vez. */
  ultimaConexao: string | null;
  /** O sinal anotado no último atendimento, quando houve. */
  sinal: string | null;
}

/** A ficha inteira, como a tela do técnico a recebe. */
export interface FichaDaOs {
  os: {
    id: number;
    protocolo: string | null;
    status: string;
    statusNome: string;
    prioridade: PrioridadeDaOs | null;
    assunto: string | null;
    abertura: string | null;
    agenda: string | null;
    /** O que o atendimento escreveu ao abrir — a queixa do cliente. */
    mensagem: string | null;
    filial: string | null;
  };
  cliente: ClienteDaFicha | null;
  endereco: EnderecoDaFicha;
  contrato: ContratoDaFicha | null;
  login: LoginDaFicha | null;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '0' ? null : t;
}

/** "0000-00-00" é o vazio das datas do IXC. */
function data(v: unknown): string | null {
  const t = texto(v);
  return !t || t.startsWith('0000') ? null : t;
}

function ehSim(v: unknown): boolean {
  return String(v ?? '').trim().toUpperCase() === 'S';
}

/** Os dígitos de um telefone brasileiro, ou null se não houver telefone ali. */
function digitosDoTelefone(v: unknown): string | null {
  const digitos = String(v ?? '').replace(/\D/g, '');
  // 10 é fixo com DDD, 11 é celular com DDD, 13 é o celular já com o 55.
  if (digitos.length < 10 || digitos.length > 13) return null;
  return digitos;
}

/** Os telefones do cadastro do cliente, na ordem em que se tenta ligar. */
const CAMPOS_DE_TELEFONE: Array<[campo: string, rotulo: string]> = [
  ['telefone_celular', 'Celular'],
  ['whatsapp', 'WhatsApp'],
  ['fone', 'Telefone'],
  ['telefone_comercial', 'Comercial'],
];

/**
 * Os números por onde dá para chamar o cliente: os do cadastro e os que o
 * atendimento digitou no texto da OS.
 *
 * O texto entra porque é onde o número novo aparece primeiro — o atendimento
 * escreve "Suporte Técnico - mudar o roteador \n 5599984782642" sem mexer no
 * cadastro, e é esse o telefone que atende. Repetido não entra duas vezes: a
 * comparação é pelos dígitos, e o mesmo número de outro campo só muda o
 * rótulo.
 */
export function telefonesDoCliente(
  cliente: Record<string, unknown> | null,
  mensagemDaOs: string | null,
): TelefoneDoCliente[] {
  const telefones: TelefoneDoCliente[] = [];
  const juntar = (rotulo: string, bruto: unknown) => {
    const numero = texto(bruto);
    const digitos = digitosDoTelefone(numero);
    if (!numero || !digitos) return;
    if (telefones.some((t) => mesmoNumero(t.digitos, digitos))) return;
    telefones.push({ rotulo, numero, digitos });
  };

  for (const [campo, rotulo] of CAMPOS_DE_TELEFONE) juntar(rotulo, cliente?.[campo]);
  for (const achado of numerosNoTexto(mensagemDaOs)) juntar('Na mensagem da OS', achado);
  return telefones;
}

/**
 * Dois números são o mesmo? Compara pelo fim: o atendimento às vezes escreve
 * com o 55 do Brasil na frente e o cadastro não.
 */
function mesmoNumero(a: string, b: string): boolean {
  const fim = Math.min(a.length, b.length, 11);
  return a.slice(-fim) === b.slice(-fim);
}

/**
 * Tem cara de telefone brasileiro? DDD de 11 a 99, e depois dele o 9 do
 * celular (onze dígitos) ou o 2 a 5 do fixo (dez). O 55 do país na frente
 * conta como se não estivesse.
 *
 * A regra é apertada de propósito: ela decide o que entra na ficha como
 * telefone a partir de um texto solto, e um CPF escrito no meio da mensagem
 * ("056.667.783-07") também tem onze dígitos. Esse cai aqui — o DDD "05" não
 * existe, e o terceiro dígito não é 9.
 */
function ehTelefoneBr(digitos: string): boolean {
  const semPais =
    (digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')
      ? digitos.slice(2)
      : digitos;
  if (semPais.length !== 10 && semPais.length !== 11) return false;
  const ddd = Number(semPais.slice(0, 2));
  if (ddd < 11) return false;
  return semPais.length === 11 ? semPais[2] === '9' : /[2-5]/.test(semPais[2]);
}

/** Os telefones escritos no meio de um texto, na ordem em que aparecem. */
export function numerosNoTexto(mensagem: string | null): string[] {
  if (!mensagem) return [];
  const achados: string[] = [];
  for (const pedaco of mensagem.match(/\+?\d[\d\s().-]{8,19}\d/g) ?? []) {
    const digitos = pedaco.replace(/\D/g, '');
    if (ehTelefoneBr(digitos) && !achados.includes(digitos)) achados.push(digitos);
  }
  return achados;
}

/** O cliente da OS, do cadastro cru do IXC. Null quando a OS não tem cliente. */
export function lerClienteDaFicha(
  clienteId: number,
  bruto: Record<string, unknown> | null,
  mensagemDaOs: string | null,
): ClienteDaFicha | null {
  if (clienteId <= 0) return null;
  return {
    id: clienteId,
    nome: texto(bruto?.razao) ?? texto(bruto?.fantasia) ?? `Cliente ${clienteId}`,
    tipoPessoa: texto(bruto?.tipo_pessoa)?.toUpperCase() ?? null,
    documento: texto(bruto?.cnpj_cpf),
    telefones: telefonesDoCliente(bruto, mensagemDaOs),
    // `hotsite_email` é o e-mail de acesso à central, e nesta base é onde o
    // e-mail do cliente costuma estar quando o campo próprio ficou vazio.
    email: texto(bruto?.email) ?? texto(bruto?.hotsite_email),
    contato: texto(bruto?.contato),
    alerta: texto(bruto?.alerta),
    observacao: texto(bruto?.obs),
  };
}

export function lerContratoDaFicha(
  contratoId: number,
  bruto: Record<string, unknown> | null,
): ContratoDaFicha | null {
  if (contratoId <= 0) return null;
  const status = texto(bruto?.status)?.toUpperCase() ?? null;
  return {
    id: contratoId,
    plano: texto(bruto?.contrato) ?? texto(bruto?.descricao_aux_plano_venda),
    status,
    statusNome: status ? (STATUS_DO_CONTRATO[status] ?? null) : null,
    ativacao: data(bruto?.data_ativacao),
    observacao: texto(bruto?.obs),
  };
}

export function lerLoginDaFicha(
  loginId: number,
  bruto: Record<string, unknown> | null,
): LoginDaFicha | null {
  if (loginId <= 0) return null;
  return {
    id: loginId,
    usuario: texto(bruto?.login),
    ativo: ehSim(bruto?.ativo),
    online: ehSim(bruto?.online),
    ip: texto(bruto?.ip),
    mac: texto(bruto?.mac),
    onu: texto(bruto?.onu_mac),
    caixa: texto(bruto?.id_caixa_ftth),
    porta: texto(bruto?.ftth_porta),
    ultimaConexao: data(bruto?.ultima_conexao_inicial),
    sinal: texto(bruto?.sinal_ultimo_atendimento),
  };
}

/**
 * A cidade e o CEP não se repetem na ficha quando já estão escritos na linha
 * do endereço: nesta base o `endereco` da OS às vezes vem montado com UF,
 * cidade e CEP dentro ("MA São Mateus do Maranhão 65470-000 Centro - Avenida
 * …"), e repetir embaixo é poluir a ficha de quem a lê no celular.
 */
function soSeNovo(linha: string | null, pedaco: string | null): string | null {
  if (!pedaco) return null;
  return linha && linha.toLowerCase().includes(pedaco.toLowerCase()) ? null : pedaco;
}

/**
 * A ficha, juntando a OS com os cadastros do IXC.
 *
 * O endereço é o do serviço: a linha já montada pela OS (a mesma da lista do
 * técnico), e os pedaços que faltam nela — cidade, CEP, referência — tirados
 * da OS primeiro e do cliente depois, que é de onde o IXC os copia ao abrir.
 * O ponto do mapa segue a mesma ordem: o da OS, o do cliente, o do contrato.
 */
export function montarFicha(
  os: OsDoIxc,
  dados: {
    assunto: string | null;
    filial: string | null;
    cliente: Record<string, unknown> | null;
    contrato: Record<string, unknown> | null;
    login: Record<string, unknown> | null;
    cidade: { nome: string; uf: string | null } | null;
  },
): FichaDaOs {
  const { cliente, contrato, login, cidade } = dados;
  const linha = os.endereco;
  return {
    os: {
      id: os.id,
      protocolo: os.protocolo,
      status: os.status,
      statusNome: STATUS_DA_OS[os.status] ?? os.status,
      prioridade: os.prioridade,
      assunto: dados.assunto,
      abertura: os.abertura,
      agenda: os.agenda,
      mensagem: os.mensagem,
      filial: dados.filial,
    },
    cliente: lerClienteDaFicha(os.clienteId, cliente, os.mensagem),
    endereco: {
      linha,
      cidade: soSeNovo(linha, cidade?.nome ?? null),
      uf: soSeNovo(linha, cidade?.uf ?? null),
      cep: soSeNovo(linha, texto(cliente?.cep) ?? texto(contrato?.cep)),
      referencia: soSeNovo(linha, os.referencia ?? texto(cliente?.referencia)),
      coordenada: os.coordenada ?? pontoDe(cliente) ?? pontoDe(contrato) ?? pontoDe(login),
    },
    contrato: lerContratoDaFicha(os.contratoId, contrato),
    login: lerLoginDaFicha(os.loginId, login),
  };
}

/** O ponto no mapa de um cadastro do IXC, quando ele tem um. */
function pontoDe(bruto: Record<string, unknown> | null): Coordenada | null {
  return bruto ? coordenada(bruto.latitude, bruto.longitude) : null;
}
