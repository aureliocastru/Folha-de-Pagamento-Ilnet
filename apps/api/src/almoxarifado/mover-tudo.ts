/**
 * Mover tudo o que um almoxarifado tem para outro — a parte que decide, sem
 * cliente HTTP nenhum, para poder ser conferida.
 *
 * O caminho no IXC é o mesmo da transferência de um produto só
 * (`transf_almox_top` e um `transf_almox_item` por produto, ver
 * `produtos-ixc.ts`). O que muda é a triagem: nem tudo que tem saldo pode ir
 * numa transferência de produto.
 */

import { numeroDoIxc } from './estoque.mapper';

/** Um produto com saldo no almoxarifado de origem. */
export interface ItemDoAlmoxarifado {
  produtoId: number;
  descricao: string;
  saldo: number;
  unidade: string | null;
}

/** Vai na transferência — com o que o item dela pede. */
export interface ItemMovivel extends ItemDoAlmoxarifado {
  unidadeId: number;
  unidadeSigla: string;
  tipoProduto: string;
}

/** Fica — e o porquê, que a tela mostra. */
export interface ItemDeFora extends ItemDoAlmoxarifado {
  motivo: string;
}

/**
 * Separa o que vai do que fica:
 *
 *  - saldo zero ou negativo não é "ter" nada — nem entra na conta;
 *  - patrimônio fica: anda com número de série, e a transferência de produto
 *    manda `id_patrimonio` vazio — é peça a peça, pelo IXC;
 *  - serviço fica: não tem estoque;
 *  - produto sem unidade no cadastro fica: o item da transferência exige a
 *    unidade, e mandar uma inventada moveria a quantidade errada.
 */
export function separarMoviveis(
  itens: ItemDoAlmoxarifado[],
  produtos: Map<number, Record<string, unknown>>,
  unidades: Array<{ id: number; sigla: string }>,
): { moviveis: ItemMovivel[]; deFora: ItemDeFora[] } {
  const moviveis: ItemMovivel[] = [];
  const deFora: ItemDeFora[] = [];

  for (const item of itens) {
    if (!(item.saldo > 0)) continue;
    const bruto = produtos.get(item.produtoId);
    if (!bruto) {
      deFora.push({ ...item, motivo: 'o cadastro do produto não foi achado no IXC' });
      continue;
    }
    const tipo = String(bruto.tipo ?? '').trim().toUpperCase();
    if (tipo === 'P') {
      deFora.push({ ...item, motivo: 'patrimônio — vai com número de série, mova pelo IXC' });
      continue;
    }
    if (tipo === 'S') {
      deFora.push({ ...item, motivo: 'serviço não tem estoque' });
      continue;
    }
    const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade));
    if (!unidade) {
      deFora.push({ ...item, motivo: 'sem unidade no cadastro — acerte na edição do produto' });
      continue;
    }
    moviveis.push({
      ...item,
      unidadeId: unidade.id,
      unidadeSigla: unidade.sigla,
      tipoProduto: String(bruto.tipo ?? ''),
    });
  }

  const porNome = (a: ItemDoAlmoxarifado, b: ItemDoAlmoxarifado) =>
    a.descricao.localeCompare(b.descricao, 'pt-BR');
  return { moviveis: moviveis.sort(porNome), deFora: deFora.sort(porNome) };
}

/**
 * Faz `tarefa` para cada item, no máximo `quantas` ao mesmo tempo. O IXC
 * aguenta algumas inserções em paralelo; centenas de uma vez, não — e uma a
 * uma, um almoxarifado grande levaria minutos.
 */
export async function emParalelo<T>(
  itens: T[],
  quantas: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const item = itens[proximo];
      proximo += 1;
      await tarefa(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quantas, itens.length) }, trabalhador));
}
