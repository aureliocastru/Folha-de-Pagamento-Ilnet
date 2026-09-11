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
 * O valor de cada unidade na compra de acerto: o preço base do cadastro, ou um
 * centavo quando se quer só a quantidade. Nunca zero — o IXC pede valor
 * unitário na entrada.
 */
export function valorUnitarioDoAcerto(item: NegativoParaAcertar, valor: ValorDoAcerto): number {
  if (valor === 'centavo') return 0.01;
  return item.precoBase > 0 ? Math.round(item.precoBase * 100) / 100 : 0.01;
}
