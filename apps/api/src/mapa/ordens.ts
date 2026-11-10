/**
 * As OS do mapa de serviço, lidas do IXC e montadas para a tela — sem cliente
 * HTTP nenhum, para a regra poder ser provada.
 *
 * Veio do ILNET Service Map, o painel à parte que mostrava as OS e a frota no
 * mesmo mapa. A leitura da linha de `su_oss_chamado` é a mesma das ordens de
 * serviço (`lerOs`); o que é só do mapa mora aqui: de onde sai a posição da
 * OS, o prazo, e o que entra ou não no mapa.
 */

import { coordenada, lerOs, STATUS_DA_OS, type Coordenada } from '../os/os-ixc';

/** De onde a posição da OS saiu — da própria OS, ou do que ela aponta. */
export type OrigemDaPosicao = 'os' | 'login' | 'contrato' | 'cliente';

/** Uma OS como o mapa a mostra. */
export interface OsNoMapa {
  id: number;
  protocolo: string | null;
  /** C = de cliente, E = de estrutura (poste, caixa, rede). */
  tipo: 'C' | 'E';
  /** A, AN, EN, AS, AG, DS, EX, RAG. */
  status: string;
  statusNome: string;
  /** "Alta", "Crítica"… — null quando a OS não diz. */
  prioridade: string | null;
  assuntoId: number | null;
  assunto: string | null;
  /** `funcionarios.id` do IXC. */
  tecnicoId: number | null;
  tecnico: string | null;
  clienteId: number | null;
  cliente: string | null;
  endereco: string | null;
  bairro: string | null;
  /** "Cidade/UF". */
  cidade: string | null;
  /** O que o atendimento escreveu, sem o HTML que o IXC guarda junto. */
  mensagem: string | null;
  /** ISO com o fuso de Brasília ("2026-11-10T08:30:00-03:00"). */
  abertura: string | null;
  agenda: string | null;
  agendaFim: string | null;
  /** O prazo do SLA (`data_prazo_limite`). */
  prazo: string | null;
  lat: number | null;
  lng: number | null;
  origemPosicao: OrigemDaPosicao | null;
}

/** Os cadastros que a OS aponta, já lidos — o mapa de cada um por id. */
export interface ContextoDasOrdens {
  clientes: Map<number, Record<string, unknown>>;
  contratos: Map<number, Record<string, unknown>>;
  logins: Map<number, Record<string, unknown>>;
  assuntos: Map<number, string>;
  tecnicos: Map<number, string>;
  cidades: Map<number, { nome: string; uf: string | null }>;
}

const PRIORIDADES: Record<string, string> = { B: 'Baixa', N: 'Normal', A: 'Alta', C: 'Crítica' };

/** O número de um id do IXC, ou null quando vazio ou zero. */
export function idDoIxc(v: unknown): number | null {
  const n = Number(String(v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '-' || t === '0' ? null : t;
}

/**
 * Uma data do IXC ("2026-11-10 08:30:00", "10/11/2026 08:30") em ISO, com o
 * fuso de Brasília dito.
 *
 * O IXC grava a hora daqui sem dizer o fuso, e o servidor roda em UTC. Sem o
 * "-03:00" no fim, o navegador de quem estivesse noutro fuso — ou o próprio
 * servidor — leria a OS três horas fora, e a "atrasada" mudaria de lado.
 */
export function isoDeBrasilia(valor: unknown): string | null {
  const t = String(valor ?? '').trim();
  if (!t || t.startsWith('0000') || t.startsWith('00/00')) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`;
  return null;
}

/** O texto da mensagem sem as marcas de HTML, cortado em `limite` letras. */
export function textoLimpo(valor: unknown, limite: number): string | null {
  const t = String(valor ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) return null;
  return t.length > limite ? `${t.slice(0, limite)}…` : t;
}

/**
 * Onde a OS fica no mapa: a coordenada da própria OS; senão a do login (é onde
 * está a ONU); senão a do contrato; senão a do cadastro do cliente.
 *
 * A que não tem coordenada em lugar nenhum fica de fora do mapa e vai para a
 * lista "Sem localização", para a equipe corrigir no IXC. Endereço não vira
 * coordenada por serviço de fora: seria mandar o endereço do cliente a
 * terceiros (LGPD).
 */
export function posicaoDaOs(
  linha: Record<string, unknown>,
  ctx: Pick<ContextoDasOrdens, 'clientes' | 'contratos' | 'logins'>,
): { posicao: Coordenada | null; origem: OrigemDaPosicao | null } {
  const doId = (mapa: Map<number, Record<string, unknown>>, v: unknown) => {
    const id = idDoIxc(v);
    return id ? mapa.get(id) : undefined;
  };
  const candidatos: Array<[OrigemDaPosicao, Record<string, unknown> | undefined]> = [
    ['os', linha],
    ['login', doId(ctx.logins, linha.id_login)],
    ['contrato', doId(ctx.contratos, linha.id_contrato_kit)],
    ['cliente', doId(ctx.clientes, linha.id_cliente)],
  ];
  for (const [origem, registro] of candidatos) {
    if (!registro) continue;
    const posicao = coordenada(registro.latitude, registro.longitude);
    if (posicao) return { posicao, origem };
  }
  return { posicao: null, origem: null };
}

/** A OS precisa de login e contrato lidos só quando não tem coordenada própria. */
export function temPosicaoPropria(linha: Record<string, unknown>): boolean {
  return coordenada(linha.latitude, linha.longitude) !== null;
}

/**
 * A OS entra no mapa? Não finalizada, de um dos tipos escolhidos, e aberta (ou
 * agendada) depois de `limite` — a OS esquecida há dois anos só suja o mapa.
 * Sem data nenhuma ela entra: não dá para dizer que é velha.
 */
export function entraNoMapa(
  linha: Record<string, unknown>,
  regra: { tipos: string[]; limite: number | null },
): boolean {
  const status = String(linha.status ?? '').trim().toUpperCase();
  if (!status || status === 'F') return false;
  const tipo = String(linha.tipo ?? '').trim().toUpperCase();
  if (regra.tipos.length > 0 && !regra.tipos.includes(tipo)) return false;
  if (regra.limite === null) return true;
  const datas = [isoDeBrasilia(linha.data_abertura), isoDeBrasilia(linha.data_agenda)]
    .filter((d): d is string => d !== null)
    .map((d) => Date.parse(d));
  return datas.length === 0 || datas.some((d) => d >= (regra.limite as number));
}

function nomeDaCidade(cidade: { nome: string; uf: string | null } | undefined): string | null {
  if (!cidade?.nome) return null;
  return cidade.uf ? `${cidade.nome}/${cidade.uf}` : cidade.nome;
}

/** O endereço do cadastro do cliente, para a OS que não tem o seu. */
function enderecoDoCliente(c: Record<string, unknown> | undefined): string | null {
  if (!c) return null;
  const rua = [texto(c.endereco), texto(c.numero)].filter(Boolean).join(', ');
  return [rua, texto(c.complemento), texto(c.bairro)].filter(Boolean).join(' — ') || null;
}

/** A primeira letra em maiúscula: "em análise" → "Em análise". */
function comMaiuscula(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Uma linha de `su_oss_chamado` como o mapa a mostra. Null quando não tem id. */
export function osNoMapa(linha: Record<string, unknown>, ctx: ContextoDasOrdens): OsNoMapa | null {
  const os = lerOs(linha);
  if (!os) return null;

  const clienteId = os.clienteId > 0 ? os.clienteId : null;
  const cliente = clienteId ? ctx.clientes.get(clienteId) : undefined;
  const { posicao, origem } = posicaoDaOs(linha, ctx);
  const cidade =
    ctx.cidades.get(os.cidadeId) ?? ctx.cidades.get(idDoIxc(cliente?.cidade) ?? 0);
  const assuntoId = os.assuntoId > 0 ? os.assuntoId : null;
  const tecnicoId = os.tecnicoId > 0 ? os.tecnicoId : null;

  return {
    id: os.id,
    protocolo: os.protocolo,
    tipo: String(linha.tipo ?? '').trim().toUpperCase() === 'E' ? 'E' : 'C',
    status: os.status,
    statusNome: comMaiuscula(STATUS_DA_OS[os.status] ?? os.status),
    prioridade: os.prioridade ? PRIORIDADES[os.prioridade] : null,
    assuntoId,
    assunto: assuntoId ? (ctx.assuntos.get(assuntoId) ?? `Assunto ${assuntoId}`) : null,
    tecnicoId,
    tecnico: tecnicoId ? (ctx.tecnicos.get(tecnicoId) ?? null) : null,
    clienteId,
    cliente: cliente ? (texto(cliente.razao) ?? texto(cliente.fantasia)) : null,
    endereco: os.endereco ?? enderecoDoCliente(cliente),
    bairro: texto(linha.bairro) ?? texto(cliente?.bairro),
    cidade: nomeDaCidade(cidade),
    mensagem: textoLimpo(linha.mensagem, 600),
    abertura: isoDeBrasilia(linha.data_abertura),
    agenda: isoDeBrasilia(linha.data_agenda),
    agendaFim: isoDeBrasilia(linha.data_agenda_final),
    prazo: isoDeBrasilia(linha.data_prazo_limite),
    lat: posicao?.latitude ?? null,
    lng: posicao?.longitude ?? null,
    origemPosicao: origem,
  };
}
