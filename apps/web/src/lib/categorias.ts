import type { CategoriaDespesa } from './types';

/** Uma categoria de cima com as subcategorias que moram nela. */
export interface GrupoDeCategorias {
  mae: CategoriaDespesa;
  filhas: CategoriaDespesa[];
}

/** O cadastro visto em dois níveis, que é como as telas o mostram. */
export interface CategoriasEmArvore {
  grupos: GrupoDeCategorias[];
  /** As que não estão dentro de nenhuma nem agrupam ninguém. */
  soltas: CategoriaDespesa[];
}

/**
 * Arruma a lista plana da API em categoria → subcategorias.
 *
 * A API devolve tudo no mesmo nível, com cada linha dizendo quem é a mãe dela.
 * Montar a árvore aqui, e não lá, é o que deixa a mesma resposta servir ao
 * seletor (que vira `optgroup`), ao cadastro (que vira tabela com recuo) e ao
 * dashboard (que soma por mãe) sem três formatos diferentes no meio do
 * caminho.
 *
 * Ordem alfabética, e não a de criação: com trinta e poucos nomes, procurar um
 * deles numa lista ordenada por quando foi cadastrado é ler a lista inteira.
 */
export function emArvore(
  categorias: CategoriaDespesa[] | undefined,
): CategoriasEmArvore {
  const lista = categorias ?? [];
  const porId = new Map(lista.map((c) => [c.id, c]));
  const filhasPorMae = new Map<string, CategoriaDespesa[]>();
  const soltas: CategoriaDespesa[] = [];

  for (const c of lista) {
    if (!c.pai) {
      if (!c.temFilhas) soltas.push(c);
      continue;
    }
    const irmas = filhasPorMae.get(c.pai.id);
    if (irmas) irmas.push(c);
    else filhasPorMae.set(c.pai.id, [c]);
  }

  const grupos: GrupoDeCategorias[] = [];
  for (const [maeId, filhas] of filhasPorMae) {
    /*
     * A mãe pode não estar na lista: a listagem de todo dia traz só as ativas,
     * e desativar a mãe não desativa as filhas. Sem este remendo o grupo
     * sumiria e as filhas apareceriam soltas, cada uma no seu canto — o
     * contrário do que o cadastro diz. O nome vem da própria filha, que já o
     * carrega.
     */
    const mae = porId.get(maeId) ?? {
      ...filhas[0].pai!,
      ativa: false,
      ordem: 0,
      emUso: 0,
      pai: null,
      temFilhas: true,
    };
    grupos.push({ mae, filhas: filhas.sort(porNome) });
  }

  return {
    grupos: grupos.sort((a, b) => porNome(a.mae, b.mae)),
    soltas: soltas.sort(porNome),
  };
}

function porNome(a: { nome: string }, b: { nome: string }): number {
  return a.nome.localeCompare(b.nome, 'pt-BR');
}
