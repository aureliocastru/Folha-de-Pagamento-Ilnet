/**
 * O mapa de serviço: as OS abertas do IXC e a frota em tempo real, no mesmo
 * mapa. Os tipos do que a API manda (`/mapa/*`) e as contas que a tela faz —
 * atraso, distância, ordem da lista —, fora do componente para poderem ser
 * lidas sem o Leaflet no meio.
 */

export type EstadoDoVeiculo = 'movimento' | 'parado' | 'offline';
export type OrigemDaPosicao = 'os' | 'login' | 'contrato' | 'cliente';

export interface OsNoMapa {
  id: number;
  protocolo: string | null;
  tipo: 'C' | 'E';
  status: string;
  statusNome: string;
  prioridade: string | null;
  assuntoId: number | null;
  assunto: string | null;
  tecnicoId: number | null;
  tecnico: string | null;
  clienteId: number | null;
  cliente: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  mensagem: string | null;
  abertura: string | null;
  agenda: string | null;
  agendaFim: string | null;
  prazo: string | null;
  lat: number | null;
  lng: number | null;
  origemPosicao: OrigemDaPosicao | null;
}

export interface VeiculoNoMapa {
  id: string;
  nome: string;
  placa: string | null;
  grupo: string | null;
  lat: number | null;
  lng: number | null;
  velocidade: number;
  curso: number;
  estado: EstadoDoVeiculo;
  ignicao: boolean | null;
  motorista: string | null;
  endereco: string | null;
  tempoParado: string | null;
  horario: string | null;
  tecnicoId: number | null;
  tecnico: string | null;
  equipe: string | null;
  rastro: Array<[number, number]>;
}

export interface ConfigDoMapa {
  centro: [number, number];
  zoom: number;
  intervalos: { frota: number; os: number };
  fontes: { ixc: boolean; rastreio: boolean };
  problemas: string[];
}

/** O dado vem com a hora em que foi lido e o erro da última tentativa. */
interface ComReserva {
  atualizadoEm: string;
  erro: string | null;
  avisos: string[];
}

export interface OrdensDoMapa extends ComReserva {
  ordens: OsNoMapa[];
}

export interface FrotaDoMapa extends ComReserva {
  veiculos: VeiculoNoMapa[];
}

export interface TecnicoDoIxc {
  id: number;
  nome: string;
  ativo: boolean;
}

export interface VinculoNaTela {
  dispositivoId: string;
  nomeDoVeiculo: string | null;
  tecnicoIxcId: number | null;
  tecnicoNome: string | null;
  equipe: string | null;
  atualizadoPor: string | null;
  atualizadoEm: string;
}

export interface RastreadorNaTela {
  dispositivoId: string;
  nome: string;
  placa: string | null;
  grupo: string | null;
  estado: EstadoDoVeiculo;
  horario: string | null;
  vinculo: VinculoNaTela | null;
}

export interface RastreadoresDaTela {
  configurado: boolean;
  problemas: string[];
  erro: string | null;
  atualizadoEm: string | null;
  veiculos: RastreadorNaTela[];
  semAparelho: VinculoNaTela[];
  tecnicos: TecnicoDoIxc[];
  avisos: string[];
}

/** A cor de cada situação da OS no mapa — as do InMap do IXC, de onde a ideia veio. */
export const STATUS_DA_OS: Record<string, { nome: string; cor: string }> = {
  A: { nome: 'Aberta', cor: '#e5484d' },
  AN: { nome: 'Em análise', cor: '#f97316' },
  EN: { nome: 'Encaminhada', cor: '#d4a106' },
  AS: { nome: 'Assumida', cor: '#8b5cf6' },
  AG: { nome: 'Agendada', cor: '#3b82f6' },
  DS: { nome: 'Em deslocamento', cor: '#0891b2' },
  EX: { nome: 'Em execução', cor: '#16a34a' },
  RAG: { nome: 'Aguard. reagendamento', cor: '#db2777' },
};
export const CODIGOS_DE_STATUS = Object.keys(STATUS_DA_OS);
export const COR_DE_STATUS_DESCONHECIDO = '#64748b';

export function corDoStatus(status: string): string {
  return STATUS_DA_OS[status]?.cor ?? COR_DE_STATUS_DESCONHECIDO;
}

export const ESTADOS_DO_VEICULO: Record<EstadoDoVeiculo, { nome: string; cor: string }> = {
  movimento: { nome: 'Em movimento', cor: '#16a34a' },
  parado: { nome: 'Parado', cor: '#f59e0b' },
  offline: { nome: 'Offline', cor: '#6b7280' },
};
export const CODIGOS_DE_ESTADO = Object.keys(ESTADOS_DO_VEICULO) as EstadoDoVeiculo[];

export const ORIGEM_DA_POSICAO: Record<Exclude<OrigemDaPosicao, 'os'>, string> = {
  login: 'login do cliente (onde está a ONU)',
  contrato: 'endereço do contrato',
  cliente: 'cadastro do cliente',
};

/** O valor do filtro de técnico que quer dizer "OS sem técnico". */
export const SEM_TECNICO = 'sem';

function instante(iso: string | null): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
}

/**
 * A OS está atrasada? "agenda" quando o horário marcado já passou, "sla"
 * quando o prazo estourou — e nunca a que já está em execução: o técnico está
 * lá.
 */
export function atrasoDaOs(
  os: Pick<OsNoMapa, 'status' | 'agenda' | 'agendaFim' | 'prazo'>,
  agora = Date.now(),
): 'agenda' | 'sla' | null {
  if (os.status === 'EX') return null;
  const fimDaAgenda = instante(os.agendaFim ?? os.agenda);
  if (fimDaAgenda < agora) return 'agenda';
  const prazo = instante(os.prazo);
  if (prazo < agora) return 'sla';
  return null;
}

/** Distância em linha reta, em km (haversine). */
export function distanciaKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function textoKm(km: number): string {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

/** "há 3 min", "há 2 h" — de quando é a última posição do veículo. */
export function haQuanto(iso: string | null, agora = Date.now()): string {
  const t = instante(iso);
  if (Number.isNaN(t)) return 'sem registro';
  const segundos = Math.max(0, Math.round((agora - t) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const HORA = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});
const HORA_COM_SEGUNDOS = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "10/11 08:30". */
export function dataHoraCurta(iso: string | null): string | null {
  const t = instante(iso);
  return Number.isNaN(t) ? null : DATA_HORA.format(t).replace(',', '');
}

/** "08:30", ou "08:30:15" com segundos. */
export function hora(iso: string | null, comSegundos = false): string | null {
  const t = instante(iso);
  if (Number.isNaN(t)) return null;
  return (comSegundos ? HORA_COM_SEGUNDOS : HORA).format(t);
}

/**
 * O clique num filtro em pílula. Com tudo marcado, o primeiro clique mostra só
 * aquele; depois cada clique soma ou tira. Tirar o último volta a mostrar
 * todos — filtro vazio é mapa vazio, e ninguém quer isso.
 */
export function alternarFiltro<T extends string>(atual: ReadonlySet<T>, todos: readonly T[], chave: T): Set<T> {
  if (atual.size === todos.length) return new Set([chave]);
  const novo = new Set(atual);
  if (novo.has(chave)) {
    novo.delete(chave);
    return novo.size === 0 ? new Set(todos) : novo;
  }
  novo.add(chave);
  return novo;
}

/** A atrasada primeiro; depois a de agenda mais cedo; depois a mais antiga. */
export function ordenarOs(lista: OsNoMapa[], agora = Date.now()): OsNoMapa[] {
  const chave = (iso: string | null) => {
    const t = instante(iso);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return lista
    .map((os) => ({ os, atrasada: atrasoDaOs(os, agora) ? 1 : 0 }))
    .sort(
      (a, b) =>
        b.atrasada - a.atrasada ||
        chave(a.os.agenda) - chave(b.os.agenda) ||
        chave(a.os.abertura) - chave(b.os.abertura),
    )
    .map(({ os }) => os);
}

const ORDEM_DO_ESTADO: Record<EstadoDoVeiculo, number> = { movimento: 0, parado: 1, offline: 2 };

/** Andando, parado, offline; dentro de cada um, pelo nome. */
export function ordenarVeiculos(lista: VeiculoNoMapa[]): VeiculoNoMapa[] {
  return [...lista].sort(
    (a, b) =>
      ORDEM_DO_ESTADO[a.estado] - ORDEM_DO_ESTADO[b.estado] ||
      a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }),
  );
}

/** Os veículos mais perto de um ponto, em linha reta — só os que têm sinal. */
export function veiculosProximos(
  veiculos: VeiculoNoMapa[],
  ponto: [number, number],
  quantos: number,
): Array<{ v: VeiculoNoMapa; km: number }> {
  return veiculos
    .filter((v) => v.lat !== null && v.lng !== null && v.estado !== 'offline')
    .map((v) => ({ v, km: distanciaKm(ponto, [v.lat as number, v.lng as number]) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, quantos);
}
