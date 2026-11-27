import { numeroDoIxc } from '../almoxarifado/estoque.mapper';

/**
 * Autorizar ONU pela OS (pedido de 27/11/2026) — as regras, sem rede no meio.
 *
 * É o botão "Autorizar ONUs" do IXC (Provedor › Clientes Fibra), refeito para
 * o técnico no poste. O caminho é o que o IXC desta casa faz, lido no
 * `ixc_logs` de uma autorização de verdade (ONU 31035, 27/11/2026):
 *
 *  1. Consultar a OLT: a grade `fh_onu_nao_autorizadas` lista o que está
 *     plugado e ainda não foi autorizado (OLT, chassi, slot, PON, modelo, MAC).
 *  2. Tocar na ONU cria o cadastro dela (`radpop_radio_cliente_fibra`) com o
 *     que a OLT disse; o operador completa o login, o contrato, a caixa, a
 *     porta, o perfil — e o texto do perfil vai, como está, em `comandos` —, a
 *     VLAN e o projeto da caixa, e salva.
 *  3. "Gravar no dispositivo" (`botao_gravar_dispositivo_22408`) manda os
 *     comandos à OLT. O IXC troca as variáveis do perfil (#vlan#, #onu_mac#,
 *     #pppoe_login#…) e devolve o que a OLT respondeu — na Fiberhome, um
 *     "COMPLD … EN=0 ENDESC=No error" por comando.
 *
 * Quando o cadastro já existe (a ONU trocada, ou a mesma ONU mudando de PON),
 * o NOC não cria outro: "Excluir dispositivo" (`botao_excluir_dispositivo_
 * 22434`) tira a velha da OLT, o cadastro é editado e gravado de novo. Aqui é
 * igual.
 */

/**
 * Os modelos de OLT (`radpop_radio.fabricante_modelo`) que o "Autorizar ONUs"
 * consulta. Os transmissores "M" desta base são rádios Mikrotik, e não entram.
 * A lista é a das integrações de OLT do IXC, e não só a da casa (hoje, só
 * Fiberhome): a OLT nova de outra marca não some da tela por omissão.
 */
export const MODELOS_DE_OLT = new Set([
  'FH', 'FBT', 'FB6001', 'HW', 'HW2', 'ZTE', 'ZTEC610', 'DC', 'FK', 'FKG', 'FKC',
  'FKWGL', 'INB', 'INTELBRASG16', 'DIG', 'NK', 'VSOL', 'VSOLGPON', 'RAISE',
  'ZYXEL', 'CIAGPON', 'PK', 'PHYHOME', '2FLEX', 'TPLINK', 'TPLINKP700X',
  'SMARTOLT', 'TH',
]);

export interface Olt {
  id: number;
  nome: string;
  fabricante: string;
  /** `perfil_fibra_padrao` — o perfil que a OLT sugere, quando tem. */
  perfilPadrao: number | null;
}

/** Uma ONU plugada na OLT e ainda não autorizada — uma linha do "Consultar". */
export interface OnuPendente {
  /**
   * O `id` da linha na grade do IXC. É ele que identifica a ONU entre a
   * consulta e a autorização: o servidor consulta a OLT de novo e só autoriza
   * se a mesma linha ainda estiver lá.
   */
  chave: string;
  oltId: number;
  olt: string;
  chassi: number | null;
  slot: number;
  pon: number;
  /** "0-0-11-1" — como o IXC guarda no cadastro. */
  ponid: string;
  /** O serial da etiqueta ("FHTT063217f0"). A Fiberhome autentica por ele. */
  mac: string;
  /** "AN5506-01-A1". */
  modelo: string;
}

/** O cadastro de uma ONU no IXC (`radpop_radio_cliente_fibra`). */
export interface OnuDoIxc {
  id: number;
  oltId: number;
  loginId: number;
  contratoId: number;
  /** O login escrito — é o nome que o IXC dá à ONU. */
  nome: string | null;
  mac: string;
  modelo: string | null;
  ponid: string | null;
  slot: number | null;
  pon: number | null;
  caixaId: number | null;
  porta: number | null;
  perfilId: number | null;
  vlan: string | null;
  sinal: SinalDaOnu;
  /**
   * O cadastro já foi à OLT. O IXC só preenche a porta PON
   * (`id_radpop_radio_porta`) no "Gravar no dispositivo" — e a listagem não
   * devolve o `status_autorizado`, que seria o jeito direto de saber.
   */
  naOlt: boolean;
}

export interface SinalDaOnu {
  /** dBm, como o IXC escreve ("-19.62"). Null: nunca foi lido. */
  rx: string | null;
  tx: string | null;
  /** "AAAA-MM-DD HH:MM:SS" da leitura. */
  em: string | null;
}

/** Um perfil de autorização (`radpop_radio_cliente_fibra_perfil`). */
export interface Perfil {
  id: number;
  nome: string;
  /** Vazio: serve a qualquer OLT. */
  fabricante: string | null;
  /** Os comandos com as variáveis do IXC (#vlan#, #onu_mac#…). */
  comando: string;
}

/** Uma caixa de atendimento da fibra (`rad_caixa_ftth`). */
export interface Caixa {
  id: number;
  /** "R63_CTO10" — o que está escrito na caixa no poste. */
  nome: string;
  oltId: number | null;
  projetoId: number | null;
  /** Quantas portas. Null quando o cadastro não diz. */
  capacidade: number | null;
  ativa: boolean;
}

export interface PortaDaCaixa {
  porta: number;
  /** O login da ONU que está nesta porta, quando há. */
  ocupadaPor: string | null;
  loginId: number | null;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' ? null : t;
}

function idOuNulo(v: unknown): number | null {
  const n = numeroDoIxc(v);
  return n > 0 ? n : null;
}

/** Um número do IXC que pode ser zero de verdade (o chassi, a porta 0 da SGA). */
function inteiroOuNulo(v: unknown): number | null {
  const t = texto(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

/** "0.00" é o vazio do sinal no IXC; "0000-00-00 …", o da data. */
function leitura(v: unknown): string | null {
  const t = texto(v);
  if (!t || /^-?0+(\.0+)?$/.test(t) || t.startsWith('0000')) return null;
  return t;
}

/**
 * O MAC comparável: a Fiberhome escreve o serial com o prefixo em maiúsculas e
 * o resto em minúsculas ("FHTT063217f0"), e quem digita escreve como quiser.
 */
export function mesmoMac(a: string | null | undefined, b: string | null | undefined): boolean {
  const limpo = (m: string | null | undefined) => String(m ?? '').replace(/[\s:.-]/g, '').toUpperCase();
  return limpo(a) !== '' && limpo(a) === limpo(b);
}

export function lerOlt(l: Record<string, unknown>): Olt | null {
  const id = numeroDoIxc(l.id);
  const fabricante = String(l.fabricante_modelo ?? '').trim().toUpperCase();
  if (id <= 0 || String(l.ativo ?? '').trim().toUpperCase() !== 'S') return null;
  if (!MODELOS_DE_OLT.has(fabricante)) return null;
  return {
    id,
    nome: texto(l.descricao) ?? `OLT ${id}`,
    fabricante,
    perfilPadrao: idOuNulo(l.perfil_fibra_padrao),
  };
}

/**
 * O `id` das linhas da grade é um array do PHP serializado em base64:
 * `a:7:{s:2:"ID";s:1:"1";s:6:"CHASSI";i:1;…}`. Lido com uma expressão, sem
 * desserializar de verdade — só se aproveitam pares chave/valor simples.
 */
export function desserializarPhp(base64: string): Record<string, string> {
  let cru: string;
  try {
    cru = Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return {};
  }
  const campos: Record<string, string> = {};
  const par = /s:\d+:"([^"]+)";(?:s:\d+:"([^"]*)"|i:(-?\d+)|d:(-?[\d.]+)|b:([01]));/g;
  for (const m of cru.matchAll(par)) {
    campos[m[1]] = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
  }
  return campos;
}

/**
 * Uma linha do "Consultar" de ONUs não autorizadas.
 *
 * A `cell` é o que a tela do IXC mostra: [OLT, POP, chassi, slot, PON, modelo,
 * MAC] nesta versão, sem o POP nas mais antigas. O `id` decodificado manda
 * quando tem o campo — a `cell` só cobre o que faltar.
 */
export function lerPendente(linha: Record<string, unknown>): OnuPendente | null {
  const chave = texto(linha.id);
  if (!chave) return null;
  const campos = desserializarPhp(chave);
  const cell = Array.isArray(linha.cell) ? linha.cell.map((c) => texto(c)) : [];
  const [olt, , chassi, slot, pon, modelo, mac] =
    cell.length >= 7 ? cell : [cell[0], null, ...cell.slice(1)];

  const oltId = numeroDoIxc(campos.ID);
  const macDaOnu = texto(campos.MAC) ?? mac ?? null;
  const slotNo = inteiroOuNulo(campos.SLOT ?? campos.SLO ?? slot);
  const ponNo = inteiroOuNulo(campos.PON ?? pon);
  if (oltId <= 0 || !macDaOnu || slotNo === null || ponNo === null) return null;

  return {
    chave,
    oltId,
    olt: olt ?? `OLT ${oltId}`,
    chassi: inteiroOuNulo(campos.CHASSI ?? chassi),
    slot: slotNo,
    pon: ponNo,
    ponid: texto(campos.PONID) ?? `0-0-${slotNo}-${ponNo}`,
    mac: macDaOnu,
    modelo: texto(campos.MODELO) ?? modelo ?? '',
  };
}

export function lerOnuDoIxc(l: Record<string, unknown>): OnuDoIxc | null {
  const id = numeroDoIxc(l.id);
  const mac = texto(l.mac);
  if (id <= 0 || !mac) return null;
  return {
    id,
    oltId: numeroDoIxc(l.id_transmissor),
    loginId: numeroDoIxc(l.id_login),
    contratoId: numeroDoIxc(l.id_contrato),
    nome: texto(l.nome),
    mac,
    modelo: texto(l.onu_tipo),
    ponid: texto(l.ponid),
    slot: inteiroOuNulo(l.slotno),
    pon: inteiroOuNulo(l.ponno),
    caixaId: idOuNulo(l.id_caixa_ftth),
    porta: inteiroOuNulo(l.porta_ftth),
    perfilId: idOuNulo(l.id_perfil),
    vlan: vlanValida(l.vlan),
    sinal: { rx: leitura(l.sinal_rx), tx: leitura(l.sinal_tx), em: leitura(l.data_sinal) },
    naOlt: numeroDoIxc(l.id_radpop_radio_porta) > 0,
  };
}

export function lerPerfil(l: Record<string, unknown>): Perfil | null {
  const id = numeroDoIxc(l.id);
  if (id <= 0) return null;
  return {
    id,
    nome: texto(l.nome) ?? `Perfil ${id}`,
    fabricante: texto(l.fabricante_modelo)?.toUpperCase() ?? null,
    comando: String(l.comando ?? l.comandos ?? ''),
  };
}

/**
 * Os perfis que servem a esta OLT: os sem fabricante e os da marca dela — e
 * só os que têm comando, porque é o comando que vai à OLT. Perfil sem comando
 * gravaria um cadastro que não autoriza nada.
 */
export function perfisDaOlt(perfis: Perfil[], olt: Olt): Perfil[] {
  return perfis.filter(
    (p) => p.comando.trim() !== '' && (!p.fabricante || p.fabricante === olt.fabricante),
  );
}

export function lerCaixa(l: Record<string, unknown>): Caixa | null {
  const id = numeroDoIxc(l.id);
  if (id <= 0) return null;
  return {
    id,
    nome: texto(l.descricao) ?? `Caixa ${id}`,
    oltId: idOuNulo(l.id_transmissor),
    projetoId: idOuNulo(l.id_projeto),
    capacidade: idOuNulo(l.capacidade),
    ativa: String(l.status ?? 'A').trim().toUpperCase() !== 'I',
  };
}

/**
 * As portas da caixa, com quem está em cada uma. Da 1 até a capacidade, e
 * mais as que o cadastro usa além dela — caixa com capacidade errada no IXC
 * existe, e a porta ocupada fora da conta tem de aparecer como ocupada.
 */
export function portasDaCaixa(caixa: Caixa, onus: OnuDoIxc[]): PortaDaCaixa[] {
  const ocupadas = new Map<number, OnuDoIxc>();
  for (const o of onus) {
    if (o.caixaId === caixa.id && o.porta !== null && o.porta > 0 && !ocupadas.has(o.porta)) {
      ocupadas.set(o.porta, o);
    }
  }
  const ultima = Math.max(caixa.capacidade ?? 0, ...ocupadas.keys());
  const portas: PortaDaCaixa[] = [];
  for (let porta = 1; porta <= ultima; porta++) {
    const onu = ocupadas.get(porta);
    portas.push({ porta, ocupadaPor: onu ? onu.nome ?? onu.mac : null, loginId: onu?.loginId ?? null });
  }
  return portas;
}

/** A VLAN que dá para gravar: de 1 a 4094. "0" e vazio são o "não tem" do IXC. */
export function vlanValida(v: unknown): string | null {
  const t = texto(v);
  if (!t || !/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 4094 ? String(n) : null;
}

function maisComum<T>(valores: T[]): T | null {
  const contagem = new Map<T, number>();
  for (const v of valores) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  let melhor: T | null = null;
  let vezes = 0;
  for (const [v, n] of contagem) {
    if (n > vezes) {
      melhor = v;
      vezes = n;
    }
  }
  return melhor;
}

/**
 * A VLAN que o formulário já traz: a que as ONUs do mesmo PON usam, e, sem
 * nenhuma ali, a da OLT. É como o NOC preenche — nesta base é uma VLAN por
 * OLT (a OLT 1 é 300, a 103 é 240), com uma ou outra exceção perdida, e a
 * maioria do PON passa por cima das exceções.
 */
export function vlanSugerida(doPon: OnuDoIxc[], daOlt: OnuDoIxc[]): string | null {
  const vlans = (onus: OnuDoIxc[]) => onus.map((o) => o.vlan).filter((v): v is string => !!v);
  return maisComum(vlans(doPon)) ?? maisComum(vlans(daOlt));
}

/**
 * O perfil que o formulário já traz: o que as ONUs do mesmo modelo mais usam
 * (a AN5506-01-A1 é bridge, perfil 13; a AN5506-04-FA é roteador, 14), entre
 * os que servem a esta OLT. Sem histórico do modelo, o padrão da OLT.
 */
export function perfilSugerido(doModelo: OnuDoIxc[], perfis: Perfil[], olt: Olt): number | null {
  const validos = new Set(perfis.map((p) => p.id));
  const usados = doModelo
    .map((o) => o.perfilId)
    .filter((id): id is number => id !== null && validos.has(id));
  const doHistorico = maisComum(usados);
  if (doHistorico !== null) return doHistorico;
  return olt.perfilPadrao !== null && validos.has(olt.perfilPadrao) ? olt.perfilPadrao : null;
}

/** O que a tela escolheu, já conferido contra o IXC. */
export interface DadosDaAutorizacao {
  pendente: OnuPendente;
  loginId: number;
  /** O login escrito ("joao.costa@ilnet.com.br") — vira o nome da ONU. */
  login: string | null;
  contratoId: number;
  caixa: Caixa;
  porta: number;
  perfil: Perfil;
  vlan: string;
}

/**
 * O cadastro da ONU nova, com os campos que a tela do IXC grava entre o
 * "Autorizar" da grade e o "Salvar" do formulário. As VLANs de serviço ficam
 * vazias, como o NOC deixa: o perfil usa só a `vlan`.
 */
export function corpoDaOnuNova(d: DadosDaAutorizacao): Record<string, string> {
  return {
    id_transmissor: String(d.pendente.oltId),
    ponid: d.pendente.ponid,
    slotno: String(d.pendente.slot),
    ponno: String(d.pendente.pon),
    mac: d.pendente.mac,
    onu_tipo: d.pendente.modelo,
    tipo_autenticacao: 'MAC',
    nome: d.login ?? d.pendente.mac,
    id_login: String(d.loginId),
    id_contrato: String(d.contratoId),
    id_caixa_ftth: String(d.caixa.id),
    porta_ftth: String(d.porta),
    id_projeto: d.caixa.projetoId ? String(d.caixa.projetoId) : '',
    id_perfil: String(d.perfil.id),
    comandos: d.perfil.comando,
    vlan: d.vlan,
    vlan_pppoe: '',
    vlan_dhcp: '',
    vlan_iptv: '',
    vlan_tr69: '',
    vlan_voip: '',
    vlan_outros: '',
    gemport: '',
    onu_numero: '',
    versao: '',
    id_hardware: '0',
    radpop_estrutura: 'N',
    endereco_padrao_cliente: 'S',
    onu_rede_neutra: 'N',
  };
}

/**
 * O que é da posição antiga na OLT e não vale para a nova: o número da ONU no
 * PON, a porta PON, a última leitura de sinal. O IXC preenche de novo ao
 * gravar e ao ler o sinal.
 */
const DA_POSICAO_ANTIGA = [
  'id_radpop_radio_porta',
  'service_port',
  'sinal_rx',
  'sinal_tx',
  'temperatura',
  'voltagem',
  'data_sinal',
  'ip_gerencia',
  'causa_ultima_queda',
] as const;

/**
 * O cadastro reaproveitado: a linha que está lá, inteira, com a ONU nova por
 * cima. Inteira porque o `PUT` do IXC reescreve o registro — coluna que não
 * vai é coluna apagada (ver `patrimonios.service.ts`).
 */
export function corpoDaOnuReaproveitada(
  atual: Record<string, unknown>,
  d: DadosDaAutorizacao,
): Record<string, string> {
  const corpo: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(atual)) {
    if (campo === 'id') continue;
    corpo[campo] = valor === null || valor === undefined ? '' : String(valor);
  }
  for (const campo of DA_POSICAO_ANTIGA) corpo[campo] = '';
  return { ...corpo, ...corpoDaOnuNova(d) };
}

export type DesfechoNaOlt = 'AUTORIZADA' | 'RECUSADA' | 'INCERTA';

/**
 * A resposta de um botão do IXC virada texto que se lê. Ela vem às vezes em
 * JSON, às vezes em HTML de painel ("panel-danger"), com as linhas da OLT no
 * meio — o técnico precisa ler as linhas, não o HTML.
 */
export function textoDaResposta(resposta: unknown): string {
  let cru: string;
  if (typeof resposta === 'string') {
    cru = resposta;
  } else if (resposta && typeof resposta === 'object') {
    const r = resposta as Record<string, unknown>;
    const partes = ['message', 'mensagem', 'valor', 'retorno', 'msg']
      .map((c) => r[c])
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    cru = partes.length > 0 ? partes.join('\n') : JSON.stringify(resposta);
  } else {
    cru = '';
  }
  return cru
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .split(/\r?\n/)
    .map((linha) => linha.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

/** Palavras de recusa — fora o "ENDESC=No error" da Fiberhome, que é o sucesso. */
const RECUSA =
  /\b(erro|falha|failed|failure|invalid|inv[aá]lid[oa]|timeout|incomplete|unknown command|deny|denied|n[aã]o est[aá] dispon[ií]vel|sem permiss[aã]o|n[aã]o autorizad[oa])\b/i;

/**
 * Como terminou um "Gravar no dispositivo" (ou um "Excluir dispositivo").
 *
 * A Fiberhome responde uma linha por comando: "COMPLD … EN=0 ENDESC=No error"
 * é o comando que passou; EN diferente de zero, o que não passou. Todos
 * passando é AUTORIZADA; nenhum, RECUSADA. Uma parte só é INCERTA: a ONU pode
 * ter entrado sem a VLAN, e isso alguém confere antes de gravar de novo.
 */
export function lerGravacao(resposta: unknown): { desfecho: DesfechoNaOlt; texto: string } {
  const texto = textoDaResposta(resposta);
  const tipo = resposta && typeof resposta === 'object'
    ? String((resposta as Record<string, unknown>).type ?? '').toLowerCase()
    : '';
  const cru = typeof resposta === 'string' ? resposta : JSON.stringify(resposta ?? '');

  const passaram = (texto.match(/\bEN\s*=\s*0\b/gi) ?? []).length;
  const falharam = (texto.match(/\bEN\s*=\s*(?!0\b)\d+/gi) ?? []).length;
  const semNoError = texto.replace(/ENDESC\s*=\s*No error/gi, '');

  if (passaram > 0 && falharam > 0) return { desfecho: 'INCERTA', texto };
  if (falharam > 0 || tipo === 'error' || /panel-(heading-)?danger/i.test(cru) || RECUSA.test(semNoError)) {
    return { desfecho: 'RECUSADA', texto };
  }
  if (passaram > 0 || tipo === 'success' || /\b(sucesso|success|successfully|executad[oa] com sucesso)\b/i.test(texto)) {
    return { desfecho: 'AUTORIZADA', texto };
  }
  return { desfecho: 'INCERTA', texto };
}

/**
 * A OLT disse que a ONU não está lá — no "Excluir dispositivo" de um cadastro
 * cuja ONU já saiu, é o resultado esperado, e não um erro.
 */
export function naoEstavaNaOlt(texto: string): boolean {
  return /n[aã]o (foi )?(encontrad[oa]|exist)|not (found|exist)|does ?n[o']t exist|inexistente|no such onu/i.test(texto);
}

/**
 * Por que o IXC recusou, com o que fazer quando é permissão: "Recurso X não
 * está disponível!" é como o webservice diz que o token da API não pode usar
 * aquele botão.
 */
export function explicarRecusa(mensagem: string): string {
  if (/n[aã]o est[aá] dispon[ií]vel|sem permiss[aã]o|permission/i.test(mensagem)) {
    return (
      `${mensagem} — o usuário do token da API no IXC não tem permissão para isto. ` +
      'Peça ao administrador do IXC para liberar a ele os Clientes Fibra (ONU) e os botões ' +
      '"Gravar no dispositivo", "Excluir dispositivo" e "Potência".'
    );
  }
  return mensagem;
}

/** A falha foi de rede (o pedido pode ter chegado), e não uma recusa do IXC. */
export function falhaDeRede(mensagem: string): boolean {
  return /N[aã]o foi poss[ií]vel contatar o IXC|timeout|ECONNRESET|ETIMEDOUT|socket hang up/i.test(mensagem);
}
