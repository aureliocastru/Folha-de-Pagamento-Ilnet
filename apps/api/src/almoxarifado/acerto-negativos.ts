/**
 * O acerto dos saldos negativos — sem cliente HTTP nenhum, para poder ser
 * conferido.
 *
 * Negativo é o IXC registrando saída do que nunca entrou naquele
 * almoxarifado: material que chegou e não foi lançado, e depois saiu por OS,
 * transferência ou comodato. O acerto é a entrada que faltou, na quantidade
 * exata que zera o saldo — uma compra de acerto no IXC, com um item por
 * produto × almoxarifado.
 *
 * Serviço fica de fora: o IXC não soma entrada de serviço (visto em produção
 * em 11/09/2026 — entrada finalizada da "Ativação", e o -1 ficou), então o
 * negativo dele não é falta de material nenhum.
 */

import type { ItemDeEstoque } from './estoque.mapper';
import { numeroDoIxc } from './estoque.mapper';

/** Um negativo que o acerto zera. */
export interface NegativoParaAcertar {
  /** "produtoId:almoxId" — o que a tela marca e manda de volta. */
  chave: string;
  produtoId: number;
  descricao: string;
  /** `produtos.tipo`: C, O, P… */
  tipoProduto: string;
  almoxId: number;
  almoxarifado: string;
  almoxAtivo: boolean;
  filialId: number;
  /** O saldo de agora, negativo. */
  saldo: number;
  /** O que entra: o bastante para zerar. */
  quantidade: number;
  unidadeId: number;
  unidadeSigla: string;
  precoBase: number;
}

/** Um negativo que o acerto não mexe — e o porquê, que a tela mostra. */
export interface NegativoDeFora {
  chave: string;
  produtoId: number;
  descricao: string;
  almoxarifado: string;
  saldo: number;
  motivo: string;
}

/** Quanto vale cada unidade na compra de acerto. */
export type ValorDoAcerto = 'preco' | 'centavo';

export function chaveDoNegativo(produtoId: number, almoxId: number): string {
  return `${produtoId}:${almoxId}`;
}

function arredondar(n: number, casas = 5): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

/**
 * Cada saldo negativo do estoque, separado em o que o acerto zera e o que
 * fica: serviço (não é estoque), produto sem cadastro ou sem unidade (a
 * entrada exige a unidade) e almoxarifado que o sistema não enxerga.
 */
export function negativosParaAcertar(
  itens: ItemDeEstoque[],
  cadastros: Map<number, Record<string, unknown>>,
  unidades: Array<{ id: number; sigla: string }>,
  almoxarifados: Array<{ id: number; nome: string; filialId: number; ativo: boolean }>,
): { itens: NegativoParaAcertar[]; deFora: NegativoDeFora[] } {
  const acertar: NegativoParaAcertar[] = [];
  const deFora: NegativoDeFora[] = [];

  for (const item of itens) {
    for (const s of item.saldos) {
      if (!(s.saldo < 0)) continue;
      const base = {
        chave: chaveDoNegativo(item.produtoId, s.almoxId),
        produtoId: item.produtoId,
        descricao: item.descricao,
        almoxarifado: s.almoxarifado,
        saldo: s.saldo,
      };
      const fica = (motivo: string) => deFora.push({ ...base, motivo });

      const bruto = cadastros.get(item.produtoId);
      if (!bruto) {
        fica('o cadastro do produto não foi achado no IXC');
        continue;
      }
      const tipo = String(bruto.tipo ?? '').trim().toUpperCase();
      if (tipo === 'S') {
        fica('serviço — o IXC não soma entrada de serviço, e esse negativo não é falta de material');
        continue;
      }
      if (naoControlaEstoque(bruto)) {
        fica(`${NAO_CONTROLA} — a entrada seria gravada sem mudar o saldo. ${SAIDA_DO_NAO_CONTROLA}`);
        continue;
      }
      const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade));
      if (!unidade) {
        fica('produto sem unidade no cadastro — acerte na edição do produto');
        continue;
      }
      const almox = almoxarifados.find((a) => a.id === s.almoxId);
      if (!almox) {
        fica('o sistema não enxerga este almoxarifado no IXC — libere na aba Almoxarifados');
        continue;
      }
      acertar.push({
        ...base,
        tipoProduto: tipo,
        almoxId: almox.id,
        almoxarifado: almox.nome,
        almoxAtivo: almox.ativo,
        filialId: almox.filialId,
        quantidade: arredondar(-s.saldo),
        unidadeId: unidade.id,
        unidadeSigla: unidade.sigla,
        precoBase: numeroDoIxc(bruto.preco_base),
      });
    }
  }

  const ordem = (a: { almoxarifado: string; descricao: string }, b: typeof a) =>
    a.almoxarifado.localeCompare(b.almoxarifado, 'pt-BR') ||
    a.descricao.localeCompare(b.descricao, 'pt-BR');
  return { itens: acertar.sort(ordem), deFora: deFora.sort(ordem) };
}

/**
 * "Controla estoque: Não" no cadastro. Visto em produção (11/09/2026): o
 * switch do Principal "não transferia" — o IXC gravava cada transferência,
 * mas com `estoque = N` no movimento, sem mexer no saldo, que ficou parado
 * desde 2018.
 */
export function naoControlaEstoque(bruto: Record<string, unknown>): boolean {
  return String(bruto.controla_estoque ?? 'S').trim().toUpperCase() === 'N';
}

export const NAO_CONTROLA = 'o produto está com "Controla estoque: Não" no IXC';

/**
 * O que fazer com ele. Religar não dá: o IXC recusa ("Não é possível alterar
 * o controle de estoque do produto! Existem movimentações relacionadas a
 * ele!", 11/09/2026) em qualquer produto que já teve movimento.
 */
export const SAIDA_DO_NAO_CONTROLA =
  'O IXC não deixa religar o controle em produto que já teve movimento: cadastre um produto ' +
  'novo (Estoque › Novo produto), dê entrada do que existe de verdade e desative este';

// ---------------------------------------------------------------------------
// Rastreio: em qual movimento o saldo ficou negativo
// ---------------------------------------------------------------------------

/** Um movimento, dito para gente ler, com o saldo que ficou depois dele. */
export interface MovimentoNoRastreio {
  id: number;
  data: string | null;
  /** "saída #159097", "transferência #2887", "compra #3403"… */
  referencia: string;
  /** Positivo entrou, negativo saiu. */
  quantidade: number;
  saldoDepois: number;
}

export interface RastreioDoNegativo {
  /** A soma dos movimentos que valem para o saldo — confere com o saldo do IXC. */
  saldoPelosMovimentos: number;
  /** Quantos movimentos valem para o saldo (`estoque = S`). */
  movimentos: number;
  /** Quantos foram gravados sem efeito no saldo (`estoque = N`). */
  semEfeito: number;
  /**
   * O movimento que levou o saldo de zero ou mais para negativo — a última
   * vez que isso aconteceu, que é a que começou o negativo de agora. Null se
   * o saldo pelos movimentos não está negativo.
   */
  ficouNegativoEm: MovimentoNoRastreio | null;
  /** As saídas desde então, as mais recentes por último (até dez). */
  saidasDesde: MovimentoNoRastreio[];
  /** A leitura bateu no teto de linhas — o começo pode não ter vindo. */
  incompleto: boolean;
}

function dataDoMovimento(v: unknown): string | null {
  const t = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m || m[1] === '0000') return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Percorre os movimentos do produto no almoxarifado (os de `movimento_produtos`,
 * com os itens de `transf_almox_item` para dar o número da transferência) e
 * diz onde o saldo ficou negativo.
 *
 * Só conta o movimento com `estoque = S` — é o que o IXC soma no saldo, e a
 * soma confere com a tabela de saldos (conferido em produção em 114 de 115
 * negativos; o que não bateu tinha mais linhas que a leitura traz).
 */
export function rastrearNegativo(
  movimentos: Array<Record<string, unknown>>,
  transferencias: Array<Record<string, unknown>>,
  teto = Infinity,
): RastreioDoNegativo {
  const transferenciaDoItem = new Map(
    transferencias.map((t) => [numeroDoIxc(t.id), numeroDoIxc(t.id_transf_almox)]),
  );
  const valem = movimentos
    .filter((m) => String(m.estoque ?? '').toUpperCase() === 'S')
    .sort(
      (a, b) =>
        String(a.data ?? '').localeCompare(String(b.data ?? '')) ||
        numeroDoIxc(a.id) - numeroDoIxc(b.id),
    );

  let saldo = 0;
  let ficouNegativoEm: MovimentoNoRastreio | null = null;
  let saidasDesde: MovimentoNoRastreio[] = [];
  for (const m of valem) {
    const quantidade = arredondar(numeroDoIxc(m.quantidade) - numeroDoIxc(m.qtde_saida), 3);
    const antes = saldo;
    saldo = arredondar(saldo + quantidade, 3);
    const mov: MovimentoNoRastreio = {
      id: numeroDoIxc(m.id),
      data: dataDoMovimento(m.data),
      referencia: referenciaDoMovimento(m, transferenciaDoItem),
      quantidade,
      saldoDepois: saldo,
    };
    if (antes >= 0 && saldo < 0) {
      ficouNegativoEm = mov;
      saidasDesde = [mov];
    } else if (saldo < 0 && quantidade < 0 && ficouNegativoEm) {
      saidasDesde.push(mov);
    }
  }

  return {
    saldoPelosMovimentos: saldo,
    movimentos: valem.length,
    semEfeito: movimentos.length - valem.length,
    ficouNegativoEm: saldo < 0 ? ficouNegativoEm : null,
    saidasDesde: saldo < 0 ? saidasDesde.slice(-10) : [],
    incompleto: movimentos.length >= teto,
  };
}

function referenciaDoMovimento(
  m: Record<string, unknown>,
  transferenciaDoItem: Map<number, number>,
): string {
  if (numeroDoIxc(m.id_entrada) > 0) return `compra #${numeroDoIxc(m.id_entrada)}`;
  if (numeroDoIxc(m.id_saida) > 0) return `saída #${numeroDoIxc(m.id_saida)}`;
  const item = numeroDoIxc(m.id_transf_almox_item);
  if (item > 0) {
    const transferencia = transferenciaDoItem.get(item);
    return transferencia ? `transferência #${transferencia}` : `transferência (item ${item})`;
  }
  if (numeroDoIxc(m.id_inventario) > 0) return `inventário #${numeroDoIxc(m.id_inventario)}`;
  // A API não traz a coluna da OS nem a do contrato neste recurso: sem
  // número de compra, venda ou transferência, é OS ou comodato.
  return `OS ou comodato (movimento #${numeroDoIxc(m.id)} no IXC)`;
}

/**
 * O valor de cada unidade na compra de acerto: o preço base do cadastro, ou um
 * centavo quando se quer só a quantidade. Nunca zero — o IXC pede valor
 * unitário na entrada.
 */
export function valorUnitarioDoAcerto(item: NegativoParaAcertar, valor: ValorDoAcerto): number {
  if (valor === 'centavo') return 0.01;
  return item.precoBase > 0 ? Math.round(item.precoBase * 100) / 100 : 0.01;
}
