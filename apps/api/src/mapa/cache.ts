import { Logger } from '@nestjs/common';

const logger = new Logger('MapaCache');

/** O que a tela recebe: o dado, de quando ele é, e o erro da última tentativa. */
export type ComReserva<T> = T & {
  /** ISO — quando este dado foi lido da fonte. */
  atualizadoEm: string;
  /** A última tentativa falhou e isto é o dado anterior; null quando está em dia. */
  erro: string | null;
};

export interface CacheComReserva<T> {
  (): Promise<ComReserva<T>>;
  /** Esquece o prazo: a próxima chamada vai à fonte (o dado guardado fica de reserva). */
  invalidar(): void;
}

/**
 * Guarda o resultado de `buscar` por `ttlMs`, para o mapa aberto em dez telas
 * ser uma consulta só ao IXC e ao rastreador, e não dez.
 *
 * Duas coisas a mais que um cache simples:
 *
 * - chamadas ao mesmo tempo dividem a mesma busca, em vez de cada uma disparar
 *   a sua enquanto a primeira não volta;
 * - se a busca falha e já existe um dado anterior, é ele que volta, marcado
 *   com `erro`: o mapa continua de pé com o último dado bom, e diz de quando é.
 *   Sem dado anterior, a falha sobe. A tentativa seguinte vem logo, mas não a
 *   cada pedido — no máximo a cada 10 s.
 */
export function cacheComReserva<T extends object>(
  ttlMs: number,
  buscar: () => Promise<T>,
  agora: () => number = Date.now,
): CacheComReserva<T> {
  let ultimo: ComReserva<T> | null = null;
  let expiraEm = 0;
  let emAndamento: Promise<ComReserva<T>> | null = null;

  const obter = (() => {
    if (ultimo && agora() < expiraEm) return Promise.resolve(ultimo);
    if (emAndamento) return emAndamento;

    emAndamento = (async () => {
      try {
        const dados = await buscar();
        ultimo = { ...dados, atualizadoEm: new Date(agora()).toISOString(), erro: null };
        expiraEm = agora() + ttlMs;
        return ultimo;
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        logger.warn(motivo);
        if (!ultimo) throw e;
        expiraEm = agora() + Math.min(ttlMs, 10_000);
        ultimo = { ...ultimo, erro: motivo };
        return ultimo;
      } finally {
        emAndamento = null;
      }
    })();
    return emAndamento;
  }) as CacheComReserva<T>;

  obter.invalidar = () => {
    expiraEm = 0;
  };
  return obter;
}

/**
 * Cadastros por id — cliente, contrato, login —, guardados por `ttlMs`. Só
 * vai à fonte o id que ainda não está guardado ou que venceu: a lista de OS
 * muda pouco de uma leitura para a outra, e os mesmos duzentos clientes não
 * precisam ser relidos a cada minuto.
 *
 * O id que a fonte não devolveu também fica guardado (como "não existe"), para
 * não ser pedido de novo a cada leitura.
 */
export class CachePorId<T> {
  private readonly itens = new Map<number, { valor: T | null; expiraEm: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly buscarIds: (ids: number[]) => Promise<Map<number, T>>,
    private readonly agora: () => number = Date.now,
  ) {}

  async obter(ids: Iterable<number>): Promise<Map<number, T>> {
    const instante = this.agora();
    const unicos = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    const faltando = unicos.filter((id) => !((this.itens.get(id)?.expiraEm ?? 0) > instante));
    if (faltando.length > 0) {
      const achados = await this.buscarIds(faltando);
      for (const id of faltando) {
        this.itens.set(id, { valor: achados.get(id) ?? null, expiraEm: instante + this.ttlMs });
      }
    }
    const resultado = new Map<number, T>();
    for (const id of unicos) {
      const valor = this.itens.get(id)?.valor;
      if (valor !== null && valor !== undefined) resultado.set(id, valor);
    }
    return resultado;
  }
}
