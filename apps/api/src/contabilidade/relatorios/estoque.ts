import { ehAlmoxForaDaCasa } from '../../almoxarifado/estoque.mapper';
import { diaBr, diaDoIxc, idDoIxc, numero, texto } from '../ixc-leitura';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * 05 — Saldo de estoque: o que estava nas prateleiras no último dia, e quanto
 * valia.
 *
 * **A quantidade no dia** sai do saldo de hoje desfeito para trás: o
 * `movimento_produtos` é o razão do estoque (entrada em `quantidade`, saída em
 * `qtde_saida`, e só conta o que tem `estoque = S`), então
 *
 *     saldo no dia = saldo hoje − (entrou depois do dia − saiu depois do dia)
 *
 * por produto e por almoxarifado. Um mês depois são mil linhas, contra as
 * novecentas mil do razão inteiro.
 *
 * **O valor** é o custo, e nesta base nenhuma fonte de custo é confiável
 * sozinha (conferido em 09/10/2026): o custo médio do IXC chega a R$ 55
 * milhões por roteador — compras lançadas com o ponto decimal no lugar errado
 * —, há compra de acerto a R$ 0,01, e cabo comprado por caixa e contado em
 * metro. Então o custo só entra no total quando se confirma:
 *
 * - havendo compra até o dia, o preço dela concorda com o custo médio ou com
 *   o preço base (a maior não passa de uma vez e meia a menor);
 * - sem compra, o custo médio e o preço base concordam entre si;
 * - só existe uma fonte, e a linha inteira (quantidade × custo) não passa de
 *   R$ 10.000.
 *
 * A compra manda porque é o que se pagou. Custo médio e preço base iguais e
 * errados acontecem (o access point de R$ 800 mil, os dois copiados da mesma
 * nota digitada errado), e por isso dois deles concordando contra a compra
 * não confirmam nada.
 *
 * O resto vai para a aba "Custo a conferir", fora do total, com a quantidade
 * e as três fontes lado a lado: é a lista do que precisa ser acertado no IXC,
 * e um total com R$ 18 bilhões de estoque é pior que um total com um aviso.
 * Valor abaixo de R$ 0,10 não conta como fonte (é acerto, não compra).
 *
 * Fica fora do total o mesmo que a tela de estoque deixa fora: Perdas e
 * Saídas (não são prateleira), produto inativo (saiu de circulação), serviço
 * e produto que não controla estoque. O inativo com saldo vai numa aba à
 * parte, para não sumir sem explicação.
 */

export interface DadosDoEstoque {
  dia: string;
  /** Todos os produtos do cadastro. */
  produtos: Array<Record<string, unknown>>;
  /** As linhas de saldo de hoje (`estoque_produtos_almox_filial`). */
  saldos: Array<Record<string, unknown>>;
  /** Movimentos com data depois do dia. */
  movimentosDepois: Array<Record<string, unknown>>;
  /** Preço da última compra de verdade até o dia, por produto. */
  ultimaCompra: Map<number, { valor: number; dia: string | null }>;
  /** Nome dos almoxarifados que não aparecem nas linhas de saldo. */
  almoxarifados: Map<number, string>;
  /** Sigla da unidade, por id. */
  unidades: Map<number, string>;
  lidoEm: Date;
}

type OrigemDoCusto = 'Custo médio' | 'Última compra' | 'Preço base' | 'Sem custo';

/** Abaixo disto o valor é acerto de estoque, e não preço. */
export const MENOR_CUSTO_DE_VERDADE = 0.1;
/** Duas fontes concordam quando a maior não passa disto vezes a menor. */
const CONCORDAM = 1.5;
/** Uma fonte sozinha só confirma a linha (quantidade × custo) até isto. */
const TETO_DE_UMA_FONTE = 10_000;

export interface CustoDecidido {
  custo: number;
  origem: OrigemDoCusto;
  confirmado: boolean;
  /** Por que não entrou no total, quando não entrou. */
  motivo: string | null;
}

/**
 * O custo de um produto, e se ele se confirma. Ver o comentário do arquivo.
 *
 * Na ordem de preferência: a última compra (é o que se pagou de fato), o
 * custo médio, o preço base.
 */
export function decidirCusto(
  fontes: { ultimaCompra: number; custoMedio: number; precoBase: number },
  quantidade: number,
): CustoDecidido {
  const tem = (v: number) => v >= MENOR_CUSTO_DE_VERDADE;
  const concordam = (a: number, b: number) => tem(a) && tem(b) && Math.max(a, b) / Math.min(a, b) <= CONCORDAM;
  const { ultimaCompra: compra, custoMedio: medio, precoBase: base } = fontes;

  const sim = (custo: number, origem: OrigemDoCusto): CustoDecidido => ({ custo, origem, confirmado: true, motivo: null });
  const nao = (custo: number, origem: OrigemDoCusto, motivo: string): CustoDecidido => ({ custo, origem, confirmado: false, motivo });
  // Uma fonte sozinha: só se a linha inteira for pequena.
  const sozinha = (custo: number, origem: OrigemDoCusto): CustoDecidido =>
    quantidade * custo <= TETO_DE_UMA_FONTE
      ? sim(custo, origem)
      : nao(custo, origem, `Só há o ${origem.toLowerCase()}, e o valor da linha é alto demais para confiar nele sozinho`);

  if (tem(compra)) {
    if (concordam(compra, medio) || concordam(compra, base)) return sim(compra, 'Última compra');
    if (!tem(medio) && !tem(base)) return sozinha(compra, 'Última compra');
    return nao(compra, 'Última compra', 'A última compra não bate com o custo médio nem com o preço base');
  }
  if (tem(medio) && tem(base)) {
    return concordam(medio, base)
      ? sim(medio, 'Custo médio')
      : nao(medio, 'Custo médio', 'Sem compra, e o custo médio não bate com o preço base');
  }
  if (tem(medio)) return sozinha(medio, 'Custo médio');
  if (tem(base)) return sozinha(base, 'Preço base');
  return nao(0, 'Sem custo', 'Nenhum custo no IXC');
}

export interface ProdutoNoDia {
  produtoId: number;
  descricao: string;
  tipo: string;
  unidade: string;
  quantidade: number;
  custo: number;
  origemDoCusto: OrigemDoCusto;
  valor: number;
  confirmado: boolean;
  motivo: string | null;
  fontes: { ultimaCompra: number; custoMedio: number; precoBase: number };
  porAlmox: Array<{ almoxId: number; almox: string; quantidade: number }>;
}

const TIPOS: Record<string, string> = {
  C: 'Comércio',
  O: 'Consumo',
  F: 'Fabricação',
  M: 'Matéria-prima',
  P: 'Patrimônio',
  S: 'Serviço',
};

function arredondar3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function estoqueNoDia(dados: DadosDoEstoque): {
  produtos: ProdutoNoDia[];
  aConferir: ProdutoNoDia[];
  inativos: ProdutoNoDia[];
  negativos: ProdutoNoDia[];
} {
  const cadastro = new Map<number, Record<string, unknown>>();
  for (const p of dados.produtos) {
    const id = idDoIxc(p.id);
    if (id !== null) cadastro.set(id, p);
  }

  // produto → almox → quantidade, começando pelo saldo de hoje.
  const saldo = new Map<number, Map<number, number>>();
  const nomeDoAlmox = new Map(dados.almoxarifados);
  const somar = (produto: number, almox: number, qtd: number) => {
    const doProduto = saldo.get(produto) ?? new Map<number, number>();
    doProduto.set(almox, (doProduto.get(almox) ?? 0) + qtd);
    saldo.set(produto, doProduto);
  };

  for (const l of dados.saldos) {
    const produto = idDoIxc(l.id_produto);
    const almox = idDoIxc(l.id_almox);
    if (produto === null || almox === null) continue;
    somar(produto, almox, numero(l.saldo));
    const nome = texto(l.almox_descricao);
    if (nome) nomeDoAlmox.set(almox, nome);
  }

  // Desfaz o que aconteceu depois do dia.
  for (const m of dados.movimentosDepois) {
    if (texto(m.estoque).toUpperCase() !== 'S') continue;
    const quando = diaDoIxc(m.data);
    if (!quando || quando <= dados.dia) continue;
    const produto = idDoIxc(m.id_produto);
    const almox = idDoIxc(m.id_almox);
    if (produto === null || almox === null) continue;
    const efeito = numero(m.quantidade) - numero(m.qtde_saida);
    somar(produto, almox, -efeito);
  }

  const produtos: ProdutoNoDia[] = [];
  const aConferir: ProdutoNoDia[] = [];
  const inativos: ProdutoNoDia[] = [];
  const negativos: ProdutoNoDia[] = [];

  for (const [produtoId, porAlmox] of saldo) {
    const cad = cadastro.get(produtoId);
    const tipo = texto(cad?.tipo).toUpperCase();
    if (tipo === 'S') continue;
    if (texto(cad?.controla_estoque).toUpperCase() === 'N') continue;

    const almoxes = [...porAlmox.entries()]
      .map(([almoxId, qtd]) => ({
        almoxId,
        almox: nomeDoAlmox.get(almoxId) ?? `Almoxarifado ${almoxId}`,
        quantidade: arredondar3(qtd),
      }))
      .filter((a) => Math.abs(a.quantidade) > 0.0005 && !ehAlmoxForaDaCasa(a.almox))
      .sort((a, b) => b.quantidade - a.quantidade);
    if (almoxes.length === 0) continue;

    const total = arredondar3(almoxes.reduce((s, a) => s + a.quantidade, 0));
    if (Math.abs(total) < 0.0005) continue;

    const fontes = {
      ultimaCompra: dados.ultimaCompra.get(produtoId)?.valor ?? 0,
      custoMedio: numero(cad?.custo_medio),
      precoBase: numero(cad?.preco_base),
    };
    const decidido = decidirCusto(fontes, total);

    const item: ProdutoNoDia = {
      produtoId,
      descricao: texto(cad?.descricao) || `Produto ${produtoId}`,
      tipo: TIPOS[tipo] ?? tipo,
      unidade: dados.unidades.get(idDoIxc(cad?.unidade) ?? 0) ?? '',
      quantidade: total,
      custo: Math.round(decidido.custo * 10_000) / 10_000,
      origemDoCusto: decidido.origem,
      valor: Math.round(total * decidido.custo * 100) / 100,
      confirmado: decidido.confirmado,
      motivo: decidido.motivo,
      fontes,
      porAlmox: almoxes,
    };

    // Ausente conta como ativo: o cadastro antigo tem linha sem a coluna.
    const ativo = texto(cad?.ativo).toUpperCase() !== 'N';
    if (!ativo) inativos.push(item);
    else if (total < 0) negativos.push(item);
    else if (!item.confirmado) aConferir.push(item);
    else produtos.push(item);
  }

  const porNome = (a: ProdutoNoDia, b: ProdutoNoDia) => a.descricao.localeCompare(b.descricao, 'pt-BR');
  return {
    produtos: produtos.sort(porNome),
    aConferir: aConferir.sort(porNome),
    inativos: inativos.sort(porNome),
    negativos: negativos.sort(porNome),
  };
}

const COLUNAS = [
  { titulo: 'Produto', tipo: 'texto' as const, largura: 44 },
  { titulo: 'Código', tipo: 'inteiro' as const },
  { titulo: 'Tipo', tipo: 'texto' as const, largura: 14 },
  { titulo: 'Unidade', tipo: 'texto' as const, largura: 9 },
  { titulo: 'Quantidade', tipo: 'numero' as const },
  { titulo: 'Custo unitário', tipo: 'moeda' as const },
  { titulo: 'De onde veio o custo', tipo: 'texto' as const, largura: 20 },
  { titulo: 'Valor', tipo: 'moeda' as const },
];

function linha(p: ProdutoNoDia) {
  return [p.descricao, p.produtoId, p.tipo, p.unidade, p.quantidade, p.custo, p.origemDoCusto, p.valor];
}

export function relatorioDeEstoque(dados: DadosDoEstoque): Relatorio {
  const { dia } = dados;
  const { produtos, aConferir, inativos, negativos } = estoqueNoDia(dados);
  const total = soma(produtos, (p) => p.valor);

  const cabecalho = [
    `Saldo de estoque em ${diaBr(dia)}`,
    `Lido do IXC em ${dados.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    'Quantidade no dia = saldo de hoje menos o que entrou e saiu depois do dia.',
    'Custo: a última compra até o dia, quando o custo médio ou o preço base do IXC a confirma.',
    'Fora do total: Perdas e Saídas, serviços, inativos, saldos negativos e custos a conferir (em abas à parte).',
  ];

  const avisos: string[] = [];
  if (aConferir.length > 0) {
    avisos.push(
      `${aConferir.length} produtos com saldo têm custo errado ou nenhum custo no IXC e ficaram fora do total ` +
        '(aba "Custo a conferir").',
    );
  }
  if (negativos.length > 0) {
    avisos.push(`${negativos.length} produtos estavam com saldo negativo no dia (fora do total).`);
  }
  if (inativos.length > 0) {
    avisos.push(
      `${inativos.length} produtos inativos ainda tinham saldo (${reais(soma(inativos, (p) => p.valor))}), fora do total.`,
    );
  }

  const linhasPorAlmox = produtos
    .flatMap((p) =>
      p.porAlmox.map((a) => ({
        almox: a.almox,
        produto: p.descricao,
        produtoId: p.produtoId,
        unidade: p.unidade,
        quantidade: a.quantidade,
        custo: p.custo,
        valor: Math.round(a.quantidade * p.custo * 100) / 100,
      })),
    )
    .sort((a, b) => a.almox.localeCompare(b.almox, 'pt-BR') || a.produto.localeCompare(b.produto, 'pt-BR'));

  return {
    arquivo: `Saldo de estoque ${diaBr(dia).replace(/\//g, '-')}`,
    resumo: [
      moeda(`Estoque em ${diaBr(dia)} (custo confirmado)`, total, true),
      quantidade('Produtos com saldo', produtos.length),
      ...(aConferir.length ? [quantidade('Custo a conferir', aConferir.length)] : []),
    ],
    avisos,
    abas: [
      {
        nome: 'Estoque',
        cabecalho,
        colunas: COLUNAS,
        linhas: produtos.map(linha),
        totais: ['Total', produtos.length, '', '', null, null, '', total],
      },
      {
        nome: 'Por almoxarifado',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Almoxarifado', tipo: 'texto', largura: 30 },
          { titulo: 'Produto', tipo: 'texto', largura: 44 },
          { titulo: 'Código', tipo: 'inteiro' },
          { titulo: 'Unidade', tipo: 'texto', largura: 9 },
          { titulo: 'Quantidade', tipo: 'numero' },
          { titulo: 'Custo unitário', tipo: 'moeda' },
          { titulo: 'Valor', tipo: 'moeda' },
        ],
        linhas: linhasPorAlmox.map((l) => [l.almox, l.produto, l.produtoId, l.unidade, l.quantidade, l.custo, l.valor]),
        totais: ['Total', '', null, '', null, null, soma(linhasPorAlmox, (l) => l.valor)],
      },
      ...(aConferir.length
        ? [
            {
              nome: 'Custo a conferir',
              cabecalho: [
                'Produtos com saldo no dia e custo que não se confirma no IXC — fora do total',
                'As três fontes lado a lado: corrigido o custo no IXC, o produto entra no total na próxima leitura.',
              ],
              colunas: [
                { titulo: 'Produto', tipo: 'texto' as const, largura: 44 },
                { titulo: 'Código', tipo: 'inteiro' as const },
                { titulo: 'Unidade', tipo: 'texto' as const, largura: 9 },
                { titulo: 'Quantidade', tipo: 'numero' as const },
                { titulo: 'Última compra', tipo: 'moeda' as const },
                { titulo: 'Custo médio no IXC', tipo: 'moeda' as const, largura: 18 },
                { titulo: 'Preço base', tipo: 'moeda' as const },
                { titulo: 'Por quê', tipo: 'texto' as const, largura: 34 },
              ],
              linhas: aConferir.map((p) => [
                p.descricao,
                p.produtoId,
                p.unidade,
                p.quantidade,
                p.fontes.ultimaCompra || null,
                p.fontes.custoMedio || null,
                p.fontes.precoBase || null,
                p.motivo,
              ]),
            },
          ]
        : []),
      ...(negativos.length
        ? [
            {
              nome: 'Saldo negativo',
              cabecalho: ['Produtos com saldo negativo no dia — fora do total', 'Saída lançada sem a entrada correspondente.'],
              colunas: COLUNAS,
              linhas: negativos.map(linha),
            },
          ]
        : []),
      ...(inativos.length
        ? [
            {
              nome: 'Inativos com saldo',
              cabecalho: ['Produtos inativos que ainda tinham saldo no dia — fora do total'],
              colunas: COLUNAS,
              linhas: inativos.map(linha),
              totais: ['Total', inativos.length, '', '', null, null, '', soma(inativos, (p) => p.valor)],
            },
          ]
        : []),
    ],
  };
}
