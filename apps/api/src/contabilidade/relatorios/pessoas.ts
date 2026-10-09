import { diaBr } from '../ixc-leitura';
import { moeda, quantidade, soma, type Relatorio } from './relatorio';

/**
 * 17 — Vales e adiantamentos a funcionários, e 15 — a fatura do cartão.
 *
 * Os dois saem do que este sistema guarda (e, no caso do vale, também do
 * adiantamento de salário lançado no IXC), e os dois são listas que a
 * contabilidade confere uma a uma.
 */

// ---------------------------------------------------------------------------
// 17 — Vales a funcionários
// ---------------------------------------------------------------------------

export interface AdiantamentoAoFuncionario {
  /** De onde: o adiantamento lançado no IXC, o vale daqui, ou o adiantamento
   * do dia 25 de quem não tem carteira assinada. */
  origem: string;
  funcionario: string;
  cpf: string;
  carteiraAssinada: boolean | null;
  dia: string;
  descricao: string;
  valor: number;
  /** Como saiu: Pix, dinheiro, a conta do IXC… */
  forma: string;
  /** Desconta no salário (vale), ou é acerto por fora. */
  descontaNaFolha: string;
}

export function relatorioDeVales(opcoes: {
  de: string;
  ate: string;
  adiantamentos: AdiantamentoAoFuncionario[];
}): Relatorio {
  const { de, ate } = opcoes;
  const lista = [...opcoes.adiantamentos].sort(
    (a, b) => a.dia.localeCompare(b.dia) || a.funcionario.localeCompare(b.funcionario, 'pt-BR'),
  );

  const porOrigem = new Map<string, { quantidade: number; valor: number }>();
  for (const a of lista) {
    const atual = porOrigem.get(a.origem) ?? { quantidade: 0, valor: 0 };
    atual.quantidade += 1;
    atual.valor += a.valor;
    porOrigem.set(a.origem, atual);
  }

  return {
    arquivo: `Vales a funcionarios ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Vales e adiantamentos', soma(lista, (a) => a.valor), true),
      quantidade('Lançamentos', lista.length),
    ],
    avisos: [],
    abas: [
      {
        nome: 'Vales e adiantamentos',
        cabecalho: [
          `Vales e adiantamentos a funcionários — ${diaBr(de)} a ${diaBr(ate)}`,
          'Cada linha diz de onde veio: o adiantamento de salário lançado no IXC, o vale lançado ' +
            'neste sistema, ou o adiantamento do dia 25 de quem não tem carteira assinada.',
        ],
        colunas: [
          { titulo: 'Data', tipo: 'data' },
          { titulo: 'Funcionário', tipo: 'texto', largura: 34 },
          { titulo: 'CPF', tipo: 'texto', largura: 16 },
          { titulo: 'Carteira assinada', tipo: 'texto', largura: 10 },
          { titulo: 'Descrição', tipo: 'texto', largura: 36 },
          { titulo: 'Valor', tipo: 'moeda' },
          { titulo: 'Como saiu', tipo: 'texto', largura: 24 },
          { titulo: 'Desconta na folha', tipo: 'texto', largura: 14 },
          { titulo: 'Origem', tipo: 'texto', largura: 34 },
        ],
        linhas: lista.map((a) => [
          a.dia,
          a.funcionario,
          a.cpf,
          a.carteiraAssinada === null ? '' : a.carteiraAssinada ? 'Sim' : 'Não',
          a.descricao,
          a.valor,
          a.forma,
          a.descontaNaFolha,
          a.origem,
        ]),
        totais: ['Total', '', '', '', '', soma(lista, (a) => a.valor), '', '', ''],
      },
      {
        nome: 'Por origem',
        cabecalho: ['Totais por origem — cada origem é um registro diferente, sem repetição entre elas'],
        colunas: [
          { titulo: 'Origem', tipo: 'texto', largura: 44 },
          { titulo: 'Lançamentos', tipo: 'inteiro', largura: 12 },
          { titulo: 'Valor', tipo: 'moeda', largura: 16 },
        ],
        linhas: [...porOrigem.entries()].map(([origem, v]) => [origem, v.quantidade, Math.round(v.valor * 100) / 100]),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 15 — Fatura do cartão de crédito
// ---------------------------------------------------------------------------

export interface FaturaDoPeriodo {
  cartaoId: string;
  cartao: string;
  /** "AAAA-MM": o mês do vencimento da fatura. */
  competencia: string;
  vencimento: string | null;
  total: number;
  situacao: string;
  compras: Array<{
    descricao: string;
    parcela: string;
    valor: number;
    categoria: string;
  }>;
}

export function relatorioDeCartoes(opcoes: { de: string; ate: string; faturas: FaturaDoPeriodo[] }): Relatorio {
  const { de, ate, faturas } = opcoes;
  return {
    arquivo: `Faturas de cartao ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Faturas do período', soma(faturas, (f) => f.total), true),
      quantidade('Faturas', faturas.length),
      quantidade('Compras', faturas.reduce((s, f) => s + f.compras.length, 0)),
    ],
    avisos: [],
    abas: [
      {
        nome: 'Compras nas faturas',
        cabecalho: [
          `Faturas de cartão de crédito com vencimento entre ${diaBr(de)} e ${diaBr(ate)}`,
          'Cada compra da fatura, com a categoria de despesa marcada no sistema.',
        ],
        colunas: [
          { titulo: 'Cartão', tipo: 'texto', largura: 24 },
          { titulo: 'Fatura (mês)', tipo: 'texto', largura: 12 },
          { titulo: 'Vencimento', tipo: 'data' },
          { titulo: 'Compra', tipo: 'texto', largura: 40 },
          { titulo: 'Parcela', tipo: 'texto', largura: 10 },
          { titulo: 'Valor', tipo: 'moeda' },
          { titulo: 'Categoria', tipo: 'texto', largura: 28 },
          { titulo: 'Situação da fatura', tipo: 'texto', largura: 22 },
        ],
        linhas: faturas.flatMap((f) =>
          f.compras.map((c) => [
            f.cartao,
            `${f.competencia.slice(5)}/${f.competencia.slice(0, 4)}`,
            f.vencimento,
            c.descricao,
            c.parcela,
            c.valor,
            c.categoria,
            f.situacao,
          ]),
        ),
        totais: ['Total', '', null, '', '', soma(faturas, (f) => f.total), '', ''],
      },
    ],
  };
}
