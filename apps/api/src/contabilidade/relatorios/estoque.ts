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
 * **O valor** é o custo, e o cadastro de produtos desta base não é confiável
 * nisso: `valor_custo` traz R$ 0,01 em muita coisa e `preco_base` vem zerado
 * em outras (conferido em 09/10/2026). A ordem é: o custo médio do IXC; sem
 * ele, o preço da última compra; sem ela, o preço base. Cada linha diz qual
 * foi usado — a contabilidade decide se concorda.
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
  /** Preço da última compra, por produto (só dos que não têm custo médio). */
  ultimaCompra: Map<number, { valor: number; dia: string | null }>;
  /** Nome dos almoxarifados que não aparecem nas linhas de saldo. */
  almoxarifados: Map<number, string>;
  /** Sigla da unidade, por id. */
  unidades: Map<number, string>;
  lidoEm: Date;
}

type OrigemDoCusto = 'Custo médio' | 'Última compra' | 'Preço base' | 'Sem custo';

export interface ProdutoNoDia {
  produtoId: number;
  descricao: string;
  tipo: string;
  unidade: string;
  quantidade: number;
  custo: number;
  origemDoCusto: OrigemDoCusto;
  valor: number;
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

    const custoMedio = numero(cad?.custo_medio);
    const ultima = dados.ultimaCompra.get(produtoId);
    const precoBase = numero(cad?.preco_base);
    let custo = 0;
    let origemDoCusto: OrigemDoCusto = 'Sem custo';
    if (custoMedio > 0) {
      custo = custoMedio;
      origemDoCusto = 'Custo médio';
    } else if (ultima && ultima.valor > 0) {
      custo = ultima.valor;
      origemDoCusto = 'Última compra';
    } else if (precoBase > 0) {
      custo = precoBase;
      origemDoCusto = 'Preço base';
    }

    const item: ProdutoNoDia = {
      produtoId,
      descricao: texto(cad?.descricao) || `Produto ${produtoId}`,
      tipo: TIPOS[tipo] ?? tipo,
      unidade: dados.unidades.get(idDoIxc(cad?.unidade) ?? 0) ?? '',
      quantidade: total,
      custo: Math.round(custo * 10_000) / 10_000,
      origemDoCusto,
      valor: Math.round(total * custo * 100) / 100,
      porAlmox: almoxes,
    };

    // Ausente conta como ativo: o cadastro antigo tem linha sem a coluna.
    const ativo = texto(cad?.ativo).toUpperCase() !== 'N';
    if (!ativo) inativos.push(item);
    else if (total < 0) negativos.push(item);
    else produtos.push(item);
  }

  const porNome = (a: ProdutoNoDia, b: ProdutoNoDia) => a.descricao.localeCompare(b.descricao, 'pt-BR');
  return { produtos: produtos.sort(porNome), inativos: inativos.sort(porNome), negativos: negativos.sort(porNome) };
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
  const { produtos, inativos, negativos } = estoqueNoDia(dados);
  const total = soma(produtos, (p) => p.valor);
  const semCusto = produtos.filter((p) => p.origemDoCusto === 'Sem custo');

  const cabecalho = [
    `Saldo de estoque em ${diaBr(dia)}`,
    `Lido do IXC em ${dados.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    'Quantidade no dia = saldo de hoje menos o que entrou e saiu depois do dia.',
    'Custo: o custo médio do IXC; sem ele, a última compra; sem ela, o preço base do cadastro.',
    'Fora do total: Perdas e Saídas, serviços, produtos inativos e saldos negativos (em abas à parte).',
  ];

  const avisos: string[] = [];
  if (semCusto.length > 0) {
    avisos.push(`${semCusto.length} produtos com saldo não têm custo nenhum no IXC e entraram com valor zero.`);
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
      moeda(`Estoque em ${diaBr(dia)}`, total, true),
      quantidade('Produtos com saldo', produtos.length),
      ...(semCusto.length ? [quantidade('Sem custo no IXC', semCusto.length)] : []),
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
