import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Quanto tempo cada coisa leva, medido no uso de verdade.
 *
 * "O sistema está lento" não diz onde. Aqui fica anotado, por rota da API e
 * por recurso do IXC, quantas vezes foi chamado, a média, o pior caso e
 * quantas vezes passou do aceitável — o bastante para saber se a demora é
 * daqui, do banco ou do IXC, e por onde começar. O administrador lê em
 * `/api/health/tempos`.
 *
 * Mora na memória e zera quando a API reinicia: é um termômetro, não um
 * histórico. A chave é o desenho da rota (`/api/funcionarios/:id`) e o nome do
 * recurso do IXC — nunca o endereço com o que foi pedido, que traria nome de
 * gente e número de documento para dentro do log.
 */

/** A partir daqui a pessoa percebe a espera. */
export const LENTO_MS = 1_500;
/** A partir daqui vai para o log, com o nome de quem demorou. */
const AVISAR_MS = 8_000;
/** Teto de chaves, para um endereço inventado por fora não crescer a memória. */
const TETO_DE_CHAVES = 600;

export type Grupo = 'rota' | 'ixc';

interface Conta {
  vezes: number;
  totalMs: number;
  piorMs: number;
  lentas: number;
}

export interface LinhaDeTempo {
  onde: string;
  vezes: number;
  mediaMs: number;
  piorMs: number;
  lentas: number;
  /** Tempo somado — é o que diz onde o sistema gasta o dia. */
  totalS: number;
}

export class Medidor {
  private readonly logger = new Logger('Tempos');
  private readonly contas: Record<Grupo, Map<string, Conta>> = {
    rota: new Map(),
    ixc: new Map(),
  };
  private readonly desde = new Date();

  anotar(grupo: Grupo, onde: string, ms: number): void {
    const mapa = this.contas[grupo];
    let conta = mapa.get(onde);
    if (!conta) {
      if (mapa.size >= TETO_DE_CHAVES) return;
      conta = { vezes: 0, totalMs: 0, piorMs: 0, lentas: 0 };
      mapa.set(onde, conta);
    }
    conta.vezes += 1;
    conta.totalMs += ms;
    if (ms > conta.piorMs) conta.piorMs = ms;
    if (ms >= LENTO_MS) conta.lentas += 1;
    if (ms >= AVISAR_MS) {
      this.logger.warn(`${grupo} ${onde} levou ${(ms / 1000).toFixed(1)}s`);
    }
  }

  /** As que mais pesam primeiro: pelo tempo somado. */
  resumo(grupo: Grupo, quantas = 40): LinhaDeTempo[] {
    return [...this.contas[grupo].entries()]
      .map(([onde, c]) => ({
        onde,
        vezes: c.vezes,
        mediaMs: Math.round(c.totalMs / c.vezes),
        piorMs: Math.round(c.piorMs),
        lentas: c.lentas,
        totalS: Math.round(c.totalMs / 1000),
      }))
      .sort((a, b) => b.totalS - a.totalS || b.piorMs - a.piorMs)
      .slice(0, quantas);
  }

  get medindoDesde(): Date {
    return this.desde;
  }
}

/** Um só para a API inteira: o IXC e as rotas anotam no mesmo lugar. */
export const medidor = new Medidor();

/**
 * Mede cada pedido à API, do primeiro byte recebido ao fim da resposta.
 *
 * É um middleware, e não um interceptor do Nest: assim entram também o que os
 * guardas recusam e o que sai como arquivo.
 */
export function medirPedidos(req: Request, res: Response, next: NextFunction): void {
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    // Sem rota casada é endereço que não existe (404): não interessa aqui.
    const rota = (req.route as { path?: unknown } | undefined)?.path;
    if (typeof rota !== 'string') return;
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    medidor.anotar('rota', `${req.method} ${rota}`, ms);
  });
  next();
}
