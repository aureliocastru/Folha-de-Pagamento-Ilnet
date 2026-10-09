import { ServiceUnavailableException } from '@nestjs/common';
import type { IxcClient } from '../ixc/ixc.client';
import type { IxcOper } from '../ixc/ixc.types';

/**
 * A leitura do IXC que os relatórios da contabilidade fazem — página por
 * página, até o fim, com a guarda contra o vazio calado.
 *
 * **O IXC responde "zero registros" quando não entende a pergunta.** Coluna
 * que não existe no `sortname`, no `qtype` ou no `grid_param` não dá erro: dá
 * `total: 0` (conferido em 09/10/2026 — a view de recebimentos ordenada pelo
 * próprio nome zerava o mês inteiro). Num relatório isso é o pior defeito que
 * existe: o saldo de clientes sairia R$ 0,00 com cara de verdade. Por isso toda
 * leitura que volta vazia é conferida com a mesma pergunta sem o filtro — se
 * essa também volta vazia, a pergunta está errada, e o relatório para com
 * erro em vez de mentir.
 */

/** Uma condição do `grid_param`, como a documentação do IXC a escreve. */
export interface Condicao {
  TB: string;
  OP: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'L' | 'NL' | 'IN' | 'NI' | 'BE' | 'NBE';
  P: string;
  P2?: string;
}

export interface Pergunta {
  tabela: string;
  qtype: string;
  query: string;
  oper: IxcOper;
  /**
   * Obrigatório, e de propósito: o padrão do cliente é o próprio `qtype`, e
   * a view de recebimentos só aceita `fn_movim_finan.id`. Quem escreve a
   * pergunta escolhe a coluna de ordem olhando a tabela.
   */
  sortname: string;
  grid?: Condicao[];
}

/** Registros por página. Mil é o que o IXC devolve sem passar do tempo. */
const POR_PAGINA = 1000;

/**
 * Teto de registros numa leitura. Um mês de recebimentos são sete mil e
 * quinhentos; o teto existe para um período absurdo (dez anos) não prender o
 * servidor — e, batendo nele, a leitura falha em vez de entregar metade.
 */
const TETO = 200_000;

/** Lê todas as páginas de uma pergunta. */
export async function lerTudo(
  ixc: IxcClient,
  pergunta: Pergunta,
  opcoes: { podeVirVazio?: boolean; teto?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const teto = opcoes.teto ?? TETO;
  const registros: Array<Record<string, unknown>> = [];

  for (let pagina = 1; ; pagina++) {
    const res = await ixc.list<Record<string, unknown>>(pergunta.tabela, {
      qtype: pergunta.qtype,
      query: pergunta.query,
      oper: pergunta.oper,
      sortname: pergunta.sortname,
      sortorder: 'asc',
      page: pagina,
      rp: POR_PAGINA,
      gridParam: pergunta.grid,
    });
    registros.push(...res.registros);

    if (registros.length > teto) {
      throw new ServiceUnavailableException(
        `A leitura de ${pergunta.tabela} passou de ${teto} registros e foi ` +
          'interrompida. Escolha um período menor.',
      );
    }
    if (res.registros.length < POR_PAGINA) break;
    // O total que o IXC declara também encerra: evita uma ida a mais só para
    // receber a página vazia.
    if (res.total > 0 && registros.length >= res.total) break;
  }

  if (registros.length === 0 && !opcoes.podeVirVazio) {
    await sondarVazio(ixc, pergunta);
  }
  return registros;
}

/**
 * A pergunta voltou vazia: é porque não há nada, ou porque o IXC não a
 * entendeu? Pergunta de novo sem o `grid_param` — a tabela inteira, um
 * registro só. Vazia também, a culpa é da pergunta.
 */
export async function sondarVazio(ixc: IxcClient, pergunta: Pergunta): Promise<void> {
  const res = await ixc.list<Record<string, unknown>>(pergunta.tabela, {
    qtype: pergunta.qtype,
    query: pergunta.query,
    oper: pergunta.oper,
    sortname: pergunta.sortname,
    sortorder: 'asc',
    page: 1,
    rp: 1,
  });
  if (res.total === 0 && res.registros.length === 0) {
    throw new ServiceUnavailableException(
      `O IXC devolveu ${pergunta.tabela} vazia até sem filtro de data ` +
        `(${pergunta.qtype} ${pergunta.oper} ${pergunta.query}, ordem ` +
        `${pergunta.sortname}). Isso é sinal de coluna que esta base não ` +
        'conhece — o relatório não foi montado para não sair zerado.',
    );
  }
}

/**
 * Lê registros por uma lista de ids, em blocos — o `IN` do IXC com mil
 * números numa só pergunta passa do tamanho que ele aceita sem reclamar.
 */
export async function lerPorIds(
  ixc: IxcClient,
  tabela: string,
  colunaDoId: string,
  ids: Iterable<number | string>,
  opcoes: { bloco?: number; aoMesmoTempo?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const unicos = [...new Set([...ids].map((id) => String(id)).filter((id) => /^\d+$/.test(id)))];
  if (unicos.length === 0) return [];

  const bloco = opcoes.bloco ?? 400;
  const blocos: string[][] = [];
  for (let i = 0; i < unicos.length; i += bloco) blocos.push(unicos.slice(i, i + bloco));

  const resultado: Array<Record<string, unknown>> = [];
  const aoMesmoTempo = opcoes.aoMesmoTempo ?? 3;
  for (let i = 0; i < blocos.length; i += aoMesmoTempo) {
    const lidos = await Promise.all(
      blocos.slice(i, i + aoMesmoTempo).map((ids) =>
        lerTudo(
          ixc,
          {
            tabela,
            qtype: `${tabela}.id`,
            query: '0',
            oper: '>',
            sortname: `${tabela}.id`,
            grid: [{ TB: colunaDoId, OP: 'IN', P: ids.join(',') }],
          },
          // Id pedido que não existe mais (apagado no IXC) é resposta, não
          // pergunta errada: a sonda aqui só atrasaria.
          { podeVirVazio: true },
        ),
      ),
    );
    for (const l of lidos) resultado.push(...l);
  }
  return resultado;
}

/** O dia de uma data do IXC ("2026-09-30", "2026-09-30 11:00:12", "30/09/2026"). */
export function diaDoIxc(valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  if (!s || s.startsWith('0000') || s.startsWith('00/00')) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

/** Número do IXC: vem como texto, às vezes vazio. */
export function numero(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  const s = String(valor).trim();
  // O IXC devolve com ponto ("1234.56"); a vírgula só aparece em quem digitou.
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
}

/** Id do IXC: número positivo, ou null. */
export function idDoIxc(valor: unknown): number | null {
  const n = Number(String(valor ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function texto(valor: unknown): string {
  return String(valor ?? '').trim();
}

/** Arredonda no centavo, sem o 0,1 + 0,2 do ponto flutuante. */
export function centavos(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** O dia seguinte a "AAAA-MM-DD". */
export function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** "2026-09-30" → "30/09/2026". */
export function diaBr(dia: string | null | undefined): string {
  if (!dia) return '';
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** Dias corridos de `de` até `ate` (ambos "AAAA-MM-DD"). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}
