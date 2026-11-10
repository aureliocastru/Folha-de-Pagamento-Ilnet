/**
 * Os veículos da frota como o mapa os mostra, a partir do `get_devices` da
 * plataforma de rastreamento (GPSMOBILE / Waysis) — sem cliente HTTP, para a
 * regra poder ser provada.
 */

import { coordenada } from '../os/os-ixc';
import { isoDeBrasilia } from './ordens';

/** Sem comunicação, andando, ou ligado e parado. */
export type EstadoDoVeiculo = 'movimento' | 'parado' | 'offline';

export interface VeiculoNoMapa {
  /** O id do aparelho no rastreador — é por ele que se liga ao técnico. */
  id: string;
  nome: string;
  placa: string | null;
  /** O grupo da conta no rastreador; o "Ungrouped" de lá fica null. */
  grupo: string | null;
  lat: number | null;
  lng: number | null;
  /** km/h. */
  velocidade: number;
  /** Para onde aponta, em graus. */
  curso: number;
  estado: EstadoDoVeiculo;
  ignicao: boolean | null;
  motorista: string | null;
  endereco: string | null;
  /** "25min", como o rastreador escreve. */
  tempoParado: string | null;
  /** ISO — a última posição que o rastreador recebeu. */
  horario: string | null;
  /** `funcionarios.id` do IXC, pela tela de Rastreadores. */
  tecnicoId: number | null;
  tecnico: string | null;
  equipe: string | null;
  /** Os últimos pontos por onde passou, do mais velho ao mais novo. */
  rastro: Array<[number, number]>;
}

/** A ligação de um aparelho, como está guardada. */
export interface VinculoDoRastreador {
  tecnicoIxcId: number | null;
  tecnicoNome: string | null;
  equipe: string | null;
}

/** Um grupo do `get_devices`: o título e os aparelhos dele. */
export interface GrupoDoRastreador {
  title?: unknown;
  items?: unknown;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '-' || t === '0' ? null : t;
}

/**
 * Uma lista que chega como array ou como texto JSON — o rastro (`tail`) vem
 * de um jeito ou do outro conforme o endpoint.
 */
function lista(valor: unknown): unknown[] {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') {
    try {
      const convertido: unknown = JSON.parse(valor);
      return Array.isArray(convertido) ? convertido : [];
    } catch {
      return [];
    }
  }
  return [];
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/**
 * O estado do veículo. "offline" (ou vazio) é sem comunicação; com ela, anda
 * quem está na velocidade mínima de movimento da própria configuração do
 * aparelho (`min_moving_speed`) ou acima — 1 km/h quando ela não vem.
 */
export function estadoDoVeiculo(dispositivo: Record<string, unknown>): EstadoDoVeiculo {
  const online = String(dispositivo.online ?? '').trim().toLowerCase();
  if (!online || online === 'offline') return 'offline';
  const minima = Number(objeto(dispositivo.device_data).min_moving_speed) || 1;
  return Number(dispositivo.speed) >= minima ? 'movimento' : 'parado';
}

/** Um aparelho do rastreador como o mapa o mostra. Null quando não tem id. */
export function veiculoNoMapa(
  bruto: unknown,
  grupo: unknown,
  vinculos: Map<string, VinculoDoRastreador>,
  tecnicos: Map<number, string>,
): VeiculoNoMapa | null {
  const d = objeto(bruto);
  const id = texto(d.id);
  if (!id) return null;

  const dados = objeto(d.device_data);
  const vinculo = vinculos.get(id);
  const posicao = coordenada(d.lat, d.lng);
  const timestamp = Number(d.timestamp);
  const nomeDoGrupo = texto(grupo);
  const tecnicoId = vinculo?.tecnicoIxcId ?? null;

  return {
    id,
    nome: texto(d.name) ?? texto(dados.name) ?? `Veículo ${id}`,
    placa: texto(dados.plate_number),
    grupo: nomeDoGrupo && nomeDoGrupo !== 'Ungrouped' ? nomeDoGrupo : null,
    lat: posicao?.latitude ?? null,
    lng: posicao?.longitude ?? null,
    velocidade: Math.round(Number(d.speed) || 0),
    curso: Number(d.course) || 0,
    estado: estadoDoVeiculo(d),
    ignicao: typeof d.engine_status === 'boolean' ? d.engine_status : null,
    motorista: texto(d.driver),
    endereco: texto(d.address),
    tempoParado: texto(d.stop_duration),
    horario: timestamp > 0 ? new Date(timestamp * 1000).toISOString() : isoDeBrasilia(d.time),
    tecnicoId,
    // O nome do IXC, que é o de hoje; sem ele, o de quando a ligação foi feita.
    tecnico: tecnicoId ? (tecnicos.get(tecnicoId) ?? vinculo?.tecnicoNome ?? null) : null,
    equipe: vinculo?.equipe ?? null,
    rastro: lista(d.tail)
      .map((p) => {
        const ponto = objeto(p);
        const c = coordenada(ponto.lat, ponto.lng);
        return c ? ([c.latitude, c.longitude] as [number, number]) : null;
      })
      .filter((p): p is [number, number] => p !== null),
  };
}

/** Todos os aparelhos de todos os grupos do `get_devices`. */
export function veiculosDosGrupos(
  grupos: GrupoDoRastreador[],
  vinculos: Map<string, VinculoDoRastreador>,
  tecnicos: Map<number, string>,
): VeiculoNoMapa[] {
  const porId = new Map<string, VeiculoNoMapa>();
  for (const grupo of grupos) {
    for (const item of lista(grupo.items)) {
      const v = veiculoNoMapa(item, grupo.title, vinculos, tecnicos);
      // O mesmo aparelho em dois grupos aparece uma vez só no mapa.
      if (v && !porId.has(v.id)) porId.set(v.id, v);
    }
  }
  return [...porId.values()];
}
