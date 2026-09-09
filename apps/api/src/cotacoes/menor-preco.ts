/**
 * A conta que este módulo inteiro existe para fazer: dado um produto e tudo o
 * que já se pagou por ele, onde ele está mais barato **agora**.
 *
 * Fica fora do serviço, e sem Prisma nenhum, porque é a única parte disto que
 * pode dar errado em silêncio. Um cadastro errado alguém vê na tela; uma
 * comparação errada não se vê — ela só aparece na nota fiscal do mês seguinte,
 * quando já se comprou do mais caro achando que era o mais barato.
 */

export type Unidade =
  | 'UN'
  | 'M'
  | 'KM'
  | 'CX'
  | 'ROLO'
  | 'PCT'
  | 'KG'
  | 'L'
  | 'PAR';

export interface FornecedorResumo {
  id: string;
  nome: string;
  /** Fornecedor desativado continua aparecendo com o preço que ele deu — o que
      ele cobrava não deixa de ser verdade porque paramos de comprar dele. */
  ativo: boolean;
}

/** Uma cotação, como ela sai do banco para esta conta. */
export interface CotacaoCrua {
  id: string;
  produtoId: string;
  fornecedor: FornecedorResumo;
  valor: number;
  /** O dia da cotação, "AAAA-MM-DD". */
  data: string;
  /** Desempate quando duas cotações do mesmo fornecedor são do mesmo dia. */
  criadoEm: string;
  quantidadeMinima: number | null;
  observacao: string | null;
  registradoPor: string | null;
}

/** O preço que vale hoje, de um fornecedor. */
export interface PrecoDoFornecedor {
  id: string;
  fornecedor: FornecedorResumo;
  valor: number;
  data: string;
  quantidadeMinima: number | null;
  observacao: string | null;
  registradoPor: string | null;
  /**
   * Quanto este preço é mais caro que o mais barato da lista, em reais por
   * unidade. Zero no próprio mais barato.
   *
   * Vem calculado daqui, e não da tela: é o número que decide a compra, e ele
   * não pode depender de qual tela está olhando.
   */
  aMaisQueOMenor: number;
}

export interface ProdutoParaComparar {
  id: string;
  nome: string;
  codigo: string | null;
  unidade: Unidade;
  observacao: string | null;
  ativo: boolean;
}

export interface ProdutoComparado extends ProdutoParaComparar {
  /** Um por fornecedor — o preço mais recente dele —, do mais barato ao mais caro. */
  precos: PrecoDoFornecedor[];
  /** O primeiro de `precos`. Null = ninguém cotou este produto ainda. */
  maisBarato: PrecoDoFornecedor | null;
  /**
   * O que se deixa de gastar por unidade comprando do mais barato em vez do
   * mais caro. Null quando há um fornecedor só — não há escolha a fazer, e
   * mostrar "0%" ali sugeriria que os preços empataram.
   */
  economia: { valor: number; percentual: number } | null;
  /** Quantas cotações existem no histórico, e não só as que valem hoje. */
  cotacoes: number;
}

/**
 * O preço que vale de cada fornecedor: o mais recente que ele deu.
 *
 * O banco guarda uma linha por cotação, e não um preço que se sobrescreve —
 * é o que permite ver que o drop subiu 40% desde março. O custo desse acerto
 * é este: "o preço da Fibratec" não está numa coluna, é o primeiro de uma
 * pilha, e alguém tem de escolhê-lo. É aqui.
 *
 * Empate de data resolve pela ordem de digitação: quem corrigiu a cotação de
 * hoje depois de já a ter lançado quis dizer que o valor é o segundo.
 */
export function precosQueValem(cotacoes: CotacaoCrua[]): PrecoDoFornecedor[] {
  const maisRecenteDoFornecedor = new Map<string, CotacaoCrua>();

  for (const c of cotacoes) {
    const atual = maisRecenteDoFornecedor.get(c.fornecedor.id);
    if (!atual || maisNova(c, atual)) {
      maisRecenteDoFornecedor.set(c.fornecedor.id, c);
    }
  }

  const escolhidas = [...maisRecenteDoFornecedor.values()].sort(
    // Do mais barato ao mais caro. Empate de preço decide pelo nome, para a
    // lista não trocar de ordem entre duas leituras iguais.
    (a, b) => a.valor - b.valor || a.fornecedor.nome.localeCompare(b.fornecedor.nome, 'pt-BR'),
  );

  const menor = escolhidas[0]?.valor ?? 0;

  return escolhidas.map((c) => ({
    id: c.id,
    fornecedor: c.fornecedor,
    valor: c.valor,
    data: c.data,
    quantidadeMinima: c.quantidadeMinima,
    observacao: c.observacao,
    registradoPor: c.registradoPor,
    // Arredonda no centésimo de centavo: a subtração de dois decimais em ponto
    // flutuante devolve 0.30000000000000004, e isso vazaria para a tela.
    aMaisQueOMenor: arredondar(c.valor - menor, 4),
  }));
}

/** É mais nova que a outra? Data primeiro; empate, a que foi digitada depois. */
function maisNova(a: CotacaoCrua, b: CotacaoCrua): boolean {
  if (a.data !== b.data) return a.data > b.data;
  return a.criadoEm > b.criadoEm;
}

/**
 * O produto com a comparação pronta: quem vale quanto, quem é o mais barato e
 * quanto se ganha escolhendo.
 */
export function compararProduto(
  produto: ProdutoParaComparar,
  cotacoes: CotacaoCrua[],
): ProdutoComparado {
  const precos = precosQueValem(cotacoes);
  const maisBarato = precos[0] ?? null;
  const maisCaro = precos.length > 1 ? precos[precos.length - 1] : null;

  return {
    ...produto,
    precos,
    maisBarato,
    economia:
      maisBarato && maisCaro
        ? {
            valor: arredondar(maisCaro.valor - maisBarato.valor, 4),
            // Sobre o mais caro: é o quanto da conta some ao trocar de
            // fornecedor. Sobre o mais barato daria um número maior e que não
            // corresponde a nada que se economize.
            percentual: arredondar(
              ((maisCaro.valor - maisBarato.valor) / maisCaro.valor) * 100,
              1,
            ),
          }
        : null,
    cotacoes: cotacoes.length,
  };
}

/**
 * Junta produtos e cotações numa lista comparada só.
 *
 * As cotações vêm todas de uma vez e são espalhadas aqui, em vez de uma
 * consulta por produto: um catálogo de duzentos itens custaria duzentas idas
 * ao banco para responder a uma tela.
 */
export function compararCatalogo(
  produtos: ProdutoParaComparar[],
  cotacoes: CotacaoCrua[],
): ProdutoComparado[] {
  const porProduto = new Map<string, CotacaoCrua[]>();
  for (const c of cotacoes) {
    const lista = porProduto.get(c.produtoId);
    if (lista) lista.push(c);
    else porProduto.set(c.produtoId, [c]);
  }

  return produtos.map((p) => compararProduto(p, porProduto.get(p.id) ?? []));
}

function arredondar(n: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}
