/**
 * O estoque do IXC, arrumado para a tela.
 *
 * Fica fora do serviço e sem cliente HTTP nenhum porque é a parte que erra
 * calado. O IXC devolve tudo como texto — `"saldo": "4.000000000"` — e uma
 * linha por **produto × almoxarifado**: o mesmo conector aparece três vezes se
 * ele existe em três almoxarifados. Somar errado aqui não dá erro em lugar
 * nenhum; dá um número na tela que ninguém confere contra nada.
 */

/** Uma linha crua de `estoque_produtos_almox_filial`. */
export interface LinhaDeEstoqueIxc {
  id?: string;
  id_produto?: string;
  produto_descricao?: string;
  produto_unidade?: string;
  produto_ativo?: string;
  produto_controla_estoque?: string;
  produto_preco_base?: string;
  id_almox?: string;
  almox_descricao?: string;
  almox_ativo?: string;
  id_filial?: string;
  saldo?: string;
}

/** Uma linha crua de `estoque_min_max_almox`. */
export interface LinhaDeMinimoIxc {
  id_produto?: string;
  id_almox?: string;
  qtd_min?: string;
  qtd_max?: string;
}

/** Quanto há deste produto num almoxarifado. */
export interface SaldoNoAlmoxarifado {
  almoxId: number;
  almoxarifado: string;
  saldo: number;
  /** Do cadastro de mínimo/máximo do IXC. Null = ninguém definiu. */
  minimo: number | null;
  maximo: number | null;
  /** Tem menos que o mínimo definido para este almoxarifado. */
  abaixoDoMinimo: boolean;
}

/** Um item do estoque, com o saldo de cada almoxarifado. */
export interface ItemDeEstoque {
  produtoId: number;
  descricao: string;
  /** A sigla da unidade ("UN", "M"), quando o cadastro de unidades a traz. */
  unidade: string | null;
  precoBase: number | null;
  ativo: boolean;
  /** Um por almoxarifado, do maior saldo para o menor. */
  saldos: SaldoNoAlmoxarifado[];
  /** A soma de todos os almoxarifados. É o "quanto a casa tem". */
  total: number;
  /** Está abaixo do mínimo em pelo menos um almoxarifado. */
  abaixoDoMinimo: boolean;
  /** Zerado em toda parte. */
  semNenhum: boolean;
}

/** O resumo que o alto da tela mostra. */
export interface ResumoDoEstoque {
  itens: number;
  abaixoDoMinimo: number;
  semNenhum: number;
  /** Quanto vale o que está guardado, pelo preço base do cadastro. */
  valorEmEstoque: number;
}

/**
 * Número do IXC → número daqui.
 *
 * Tudo lá é texto, e o saldo vem com nove casas (`"4.000000000"`). Vazio,
 * ausente ou impossível de ler vira zero — e não `NaN`, que se espalharia por
 * toda soma que o encostasse e chegaria à tela como "R$ NaN".
 */
export function numeroDoIxc(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Arredonda no milésimo: saldo de cabo vem com três casas de verdade. */
function arredondar(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Junta as linhas do IXC num item por produto.
 *
 * O IXC devolve produto × almoxarifado, e a tela pergunta por produto: "temos
 * conector?" tem uma resposta só, ainda que ele esteja em três lugares. Os três
 * lugares continuam à vista dentro do item, porque a segunda pergunta de quem
 * vai buscar é justamente "em qual?".
 */
export function montarEstoque(
  linhas: LinhaDeEstoqueIxc[],
  minimos: LinhaDeMinimoIxc[] = [],
  unidades: Map<number, string> = new Map(),
): ItemDeEstoque[] {
  /** produtoId → almoxId → mínimo/máximo */
  const limites = new Map<string, { minimo: number | null; maximo: number | null }>();
  for (const m of minimos) {
    const chave = `${numeroDoIxc(m.id_produto)}:${numeroDoIxc(m.id_almox)}`;
    limites.set(chave, {
      minimo: m.qtd_min == null || m.qtd_min === '' ? null : numeroDoIxc(m.qtd_min),
      maximo: m.qtd_max == null || m.qtd_max === '' ? null : numeroDoIxc(m.qtd_max),
    });
  }

  const porProduto = new Map<number, ItemDeEstoque>();

  for (const l of linhas) {
    const produtoId = numeroDoIxc(l.id_produto);
    // Linha sem produto não é item: é lixo de uma consulta que voltou torta, e
    // agrupá-la sob o id 0 criaria um "produto" que soma tudo o que sobrou.
    if (produtoId === 0) continue;

    const item =
      porProduto.get(produtoId) ??
      ({
        produtoId,
        descricao: (l.produto_descricao ?? '').trim() || `Produto ${produtoId}`,
        unidade: unidades.get(numeroDoIxc(l.produto_unidade)) ?? null,
        precoBase: l.produto_preco_base ? numeroDoIxc(l.produto_preco_base) : null,
        // "S" é o ativo do IXC. Ausente conta como ativo: o cadastro antigo de
        // lá tem linha sem a coluna, e escondê-las seria esconder estoque.
        ativo: (l.produto_ativo ?? 'S') !== 'N',
        saldos: [],
        total: 0,
        abaixoDoMinimo: false,
        semNenhum: true,
      } satisfies ItemDeEstoque);
    porProduto.set(produtoId, item);

    const almoxId = numeroDoIxc(l.id_almox);
    const saldo = arredondar(numeroDoIxc(l.saldo));
    const limite = limites.get(`${produtoId}:${almoxId}`);
    const minimo = limite?.minimo ?? null;

    item.saldos.push({
      almoxId,
      almoxarifado:
        (l.almox_descricao ?? '').trim() || `Almoxarifado ${almoxId}`,
      saldo,
      minimo,
      maximo: limite?.maximo ?? null,
      // Só é "abaixo do mínimo" quando alguém definiu um mínimo. Sem cadastro,
      // zero é só zero — e marcar tudo de vermelho apagaria o alerta de quem
      // de fato se preocupou em definir o dele.
      abaixoDoMinimo: minimo !== null && saldo < minimo,
    });
  }

  for (const item of porProduto.values()) {
    item.saldos.sort(
      (a, b) =>
        b.saldo - a.saldo ||
        a.almoxarifado.localeCompare(b.almoxarifado, 'pt-BR'),
    );
    item.total = arredondar(item.saldos.reduce((s, x) => s + x.saldo, 0));
    item.abaixoDoMinimo = item.saldos.some((x) => x.abaixoDoMinimo);
    item.semNenhum = item.total <= 0;
  }

  return [...porProduto.values()].sort((a, b) =>
    a.descricao.localeCompare(b.descricao, 'pt-BR'),
  );
}

export function resumirEstoque(itens: ItemDeEstoque[]): ResumoDoEstoque {
  return {
    itens: itens.length,
    abaixoDoMinimo: itens.filter((i) => i.abaixoDoMinimo).length,
    semNenhum: itens.filter((i) => i.semNenhum).length,
    valorEmEstoque:
      Math.round(
        itens.reduce((s, i) => s + i.total * (i.precoBase ?? 0), 0) * 100,
      ) / 100,
  };
}

/**
 * Filtra pelo que foi digitado — descrição ou código do produto.
 *
 * Feito aqui, e não numa consulta ao IXC por termo: a lista inteira já veio
 * (é ela que a tela mostra), e mandar o IXC procurar de novo a cada letra
 * digitada seria uma rajada de consultas para responder o que já está na mão.
 */
export function filtrarEstoque(
  itens: ItemDeEstoque[],
  busca: string,
): ItemDeEstoque[] {
  const termo = busca.trim().toLowerCase();
  if (!termo) return itens;
  return itens.filter(
    (i) =>
      i.descricao.toLowerCase().includes(termo) ||
      String(i.produtoId) === termo,
  );
}
