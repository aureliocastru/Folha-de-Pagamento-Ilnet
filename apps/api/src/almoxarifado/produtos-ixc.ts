/**
 * O que se escreve no IXC para mexer num produto do estoque — montado aqui, sem
 * cliente HTTP nenhum, para poder ser conferido campo a campo.
 *
 * Cada corpo segue o exemplo da coleção oficial da API do IXC (a do Postman,
 * "API - IXC Provedor"), e o comentário de cada um diz de que requisição ele
 * saiu. É a regra desta parte: **nada que não esteja documentado**. Onde a
 * documentação não diz — o ajuste de saldo, por exemplo, que não existe lá —,
 * o caminho escolhido é o que ela documenta (a entrada de compra), e não um
 * endpoint adivinhado.
 *
 * Os números vão como texto e com ponto: é como o IXC os devolve
 * (`"saldo": "4.000000000"`) e como os exemplos os mandam (`"qtde": "1.00000"`).
 */

import { BadRequestException } from '@nestjs/common';

/** "1.00000" — a quantidade com as cinco casas dos exemplos de transferência. */
export function qtdeParaIxc(n: number): string {
  return n.toFixed(5);
}

/** "12.50" — dinheiro com duas casas e ponto. */
export function valorParaIxc(n: number): string {
  return n.toFixed(2);
}

/**
 * Hoje, "DD/MM/AAAA", no fuso de Brasília — é o formato de data que o IXC
 * aceita na escrita, e é a data do dia de quem está na tela. O servidor roda
 * em UTC: às 22h daqui ele já está no dia seguinte.
 */
export function hojeParaIxc(agora = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(agora);
}

/**
 * "AAAA-MM-DD" (como o IXC devolve na leitura) → "DD/MM/AAAA" (como ele aceita
 * na escrita), com a hora junto quando houver. Data zerada passa intocada.
 * É a mesma conversão da edição de fornecedor (`ixc.fornecedor.ts`).
 */
function dataParaEscrita(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(valor);
  if (!m || m[2] === '00' || m[3] === '00') return valor;
  return `${m[3]}/${m[2]}/${m[1]}${m[4]}`;
}

// ---------------------------------------------------------------------------
// Produto: editar
// ---------------------------------------------------------------------------

/** O que se pode mudar num produto a partir daqui. */
export interface EdicaoDoProduto {
  descricao?: string;
  precoBase?: number;
  ativo?: boolean;
  /** `unidades.id` — a unidade padrão do produto. */
  unidadeId?: number;
}

/**
 * O corpo do `PUT /produtos/:id` ("Produtos (editar)"): o registro que está
 * lá, **inteiro**, com as mudanças por cima.
 *
 * O exemplo da documentação manda o cadastro completo para alterar um campo
 * só ("descricao": "Produto 02", //Alterando esse campo) — o `PUT` do
 * webservice reescreve a linha. Mandar só `{ descricao }` apagaria NCM,
 * classificação fiscal e subgrupo do produto de uma vez, e o estrago
 * apareceria na primeira nota fiscal. Por isso se copia tudo o que veio,
 * inclusive as colunas que este app não conhece.
 *
 * `ultima_atualizacao` vai vazia, como no exemplo: quem a preenche é o IXC.
 */
export function montarEdicaoProduto(
  atual: Record<string, unknown>,
  mudancas: EdicaoDoProduto,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(atual)) {
    corpo[coluna] = typeof valor === 'string' ? dataParaEscrita(valor) : valor;
  }
  corpo.ultima_atualizacao = '';

  if (mudancas.descricao !== undefined) {
    corpo.descricao = descricaoValida(mudancas.descricao);
  }
  if (mudancas.precoBase !== undefined) {
    corpo.preco_base = valorParaIxc(precoValido(mudancas.precoBase));
  }
  if (mudancas.ativo !== undefined) {
    // "S"/"N": é como a tabela de saldos do IXC documenta `produto_ativo`,
    // que é esta mesma coluna vista de lá.
    corpo.ativo = mudancas.ativo ? 'S' : 'N';
  }
  if (mudancas.unidadeId !== undefined) {
    corpo.unidade = String(idValido(mudancas.unidadeId, 'a unidade'));
  }
  return corpo;
}

// ---------------------------------------------------------------------------
// Produto: cadastrar
// ---------------------------------------------------------------------------

/** O produto novo, como a tela o descreve. */
export interface NovoProduto {
  descricao: string;
  precoBase: number;
  unidadeId: number;
}

/**
 * O que se copia do produto modelo: o que diz **o que o produto é** para o
 * fisco e para a contabilidade. São os obrigatórios que ninguém sabe de
 * cabeça (NCM, classificação fiscal, tributação) e as contas contábeis — e
 * errar qualquer um deles é nota fiscal recusada ou lançamento na conta
 * errada. Um produto parecido já tem tudo isso certo.
 */
const COPIADOS_DO_MODELO = [
  'id_sub_grupo',
  'subgrupo_tipo',
  'tipo',
  'movimentacao',
  'icms_issqn',
  'id_class_fiscal',
  'id_class_fiscal_entrada',
  'ncm',
  'id_produtos_ncm_cest',
  'cod_servico',
  'id_conta_estoque',
  'id_conta_despesa',
  'id_conta_receita',
  'id_conta_comodato',
  'id_classe_financeira',
  'id_fr_faturamento_classificacoes',
  'margem_lucro',
  'pcomissao',
] as const;

/** Os obrigatórios do "Produtos (inserir)" que têm de vir preenchidos do modelo. */
const OBRIGATORIOS_DO_MODELO: Array<[string, string]> = [
  ['id_sub_grupo', 'o subgrupo'],
  ['tipo', 'o tipo'],
  ['movimentacao', 'a movimentação'],
  ['icms_issqn', 'a tributação (ICMS/ISSQN)'],
  ['id_class_fiscal', 'a classificação fiscal'],
  ['ncm', 'o NCM'],
];

/**
 * O corpo do `POST /produtos` ("Produtos (inserir)").
 *
 * Os obrigatórios da documentação, um por um:
 *
 *  - `ativo: "S"`, `controla_estoque: "S"` — é um item de estoque, e ativo;
 *  - `descricao`, `unidade`, `preco_base` — o que a tela pergunta;
 *  - `id_sub_grupo`, `tipo`, `movimentacao`, `icms_issqn`, `id_class_fiscal`,
 *    `ncm` — do produto modelo;
 *  - `aceita_valor: "P"`, `mostra_valor_ecommerce: "P"`, `tipo_ecommerce: "P"`,
 *    `ecommerce_prioridade: "1"` — fixos: a documentação diz "Obrigatório o
 *    valor ser P" e "Obrigatório o valor ser 1".
 *
 * Patrimônio e serviço não servem de modelo: patrimônio é peça com número de
 * série (anda de outro jeito no estoque) e serviço não tem estoque nenhum.
 */
export function montarNovoProduto(
  dados: NovoProduto,
  modelo: Record<string, unknown>,
): Record<string, unknown> {
  const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

  for (const [campo, nome] of OBRIGATORIOS_DO_MODELO) {
    const valor = texto(modelo[campo]);
    if (!valor || valor === '0') {
      throw new BadRequestException(
        `O produto modelo não tem ${nome} preenchido no IXC. Escolha outro modelo — ` +
          'um que já tenha nota fiscal saindo certo.',
      );
    }
  }
  const tipo = texto(modelo.tipo).toUpperCase();
  if (tipo === 'P' || tipo === 'S') {
    throw new BadRequestException(
      tipo === 'P'
        ? 'O modelo é um patrimônio (peça com número de série). Escolha um produto comum de estoque.'
        : 'O modelo é um serviço, que não tem estoque. Escolha um produto de estoque.',
    );
  }

  const corpo: Record<string, unknown> = {};
  for (const campo of COPIADOS_DO_MODELO) corpo[campo] = texto(modelo[campo]);

  return {
    ...corpo,
    ativo: 'S',
    controla_estoque: 'S',
    descricao: descricaoValida(dados.descricao),
    unidade: String(idValido(dados.unidadeId, 'a unidade')),
    preco_base: valorParaIxc(precoValido(dados.precoBase)),
    aceita_valor: 'P',
    mostra_valor_ecommerce: 'P',
    tipo_ecommerce: 'P',
    ecommerce_prioridade: '1',
    ultima_atualizacao: '',
  };
}

// ---------------------------------------------------------------------------
// Transferência entre almoxarifados
// ---------------------------------------------------------------------------

export interface Transferencia {
  almoxSaida: number;
  filialSaida: number;
  almoxEntrada: number;
  filialEntrada: number;
  /** "DD/MM/AAAA" */
  data: string;
  observacao: string;
}

/**
 * `POST /transf_almox_top` ("Transferência entre Almoxarifados / 1. Nova
 * transferência"). `operador` é o "ID Técnico da Operação" e vai vazio, como
 * no exemplo: quem transfere daqui não é técnico do IXC.
 */
export function montarTransferencia(t: Transferencia): Record<string, unknown> {
  if (t.almoxSaida === t.almoxEntrada) {
    throw new BadRequestException('A origem e o destino são o mesmo almoxarifado.');
  }
  return {
    id_almox_saida: String(idValido(t.almoxSaida, 'o almoxarifado de origem')),
    id_filial: String(idValido(t.filialSaida, 'a filial de origem')),
    id_almox_entrada: String(idValido(t.almoxEntrada, 'o almoxarifado de destino')),
    id_filial_entrada: String(idValido(t.filialEntrada, 'a filial de destino')),
    data: t.data,
    operador: '',
    obs: t.observacao.slice(0, 250),
  };
}

export interface ItemMovimentado {
  produtoId: number;
  /** `unidades.id` — a unidade padrão do produto. */
  unidadeId: number;
  unidadeSigla: string;
  quantidade: number;
  /** `produtos.tipo`: C, O, F, M… */
  tipoProduto: string;
}

/**
 * `POST /transf_almox_item` ("2. Inserir produto na transferência"). A
 * documentação diz: "Após cadastrar, já é feito a transferência" — é este
 * item que move o saldo. `id_patrimonio` vazio: é produto, não patrimônio.
 * `fator_conversao` 1: a quantidade já vai na unidade padrão do produto.
 */
export function montarItemDaTransferencia(
  transferenciaId: number,
  item: ItemMovimentado,
): Record<string, unknown> {
  return {
    id_patrimonio: '',
    id_produto: String(idValido(item.produtoId, 'o produto')),
    id_unidade: String(idValido(item.unidadeId, 'a unidade')),
    unidade_sigla: item.unidadeSigla,
    qtde: qtdeParaIxc(quantidadeValida(item.quantidade)),
    fator_conversao: '1.000000000',
    id_transf_almox: String(idValido(transferenciaId, 'a transferência')),
    tipo_produto: item.tipoProduto,
  };
}

// ---------------------------------------------------------------------------
// Entrada de compra — o jeito documentado de o saldo subir
// ---------------------------------------------------------------------------

export interface EntradaDeCompra {
  tipoDocumentoId: number;
  fornecedorId: number;
  condicaoPagamentoId: number;
  filialId: number;
  /** "DD/MM/AAAA" */
  data: string;
  /** O número da nota, quando há uma. */
  numeroNota: string;
  valorTotal: number;
}

/**
 * `POST /entrada` ("Compras / Compra (inserir)"). Os obrigatórios do exemplo:
 * `tipo_documento`, `id_fornecedor`, `condicoes_pagamento`, `filial_id`,
 * `data_emissao`, `data_entrada`, `gera_estoque: "N"`, `status: "A"`,
 * `nfe_emitida: "N"`, `tipo_frete: "9"` (sem frete).
 *
 * A compra nasce **aberta**, como no exemplo. A documentação da API não tem o
 * botão de finalizar compra — é na finalização que o IXC gera o financeiro
 * pela condição de pagamento, e é por isso que ela fica para quem está no
 * IXC: esta tela lança o estoque, e não uma conta a pagar.
 */
export function montarEntrada(e: EntradaDeCompra): Record<string, unknown> {
  return {
    tipo_documento: String(idValido(e.tipoDocumentoId, 'o tipo de documento')),
    id_fornecedor: String(idValido(e.fornecedorId, 'o fornecedor')),
    condicoes_pagamento: String(idValido(e.condicaoPagamentoId, 'a condição de pagamento')),
    filial_id: String(idValido(e.filialId, 'a filial')),
    data_emissao: e.data,
    data_entrada: e.data,
    documento: e.numeroNota.slice(0, 40),
    numero_nf: e.numeroNota.slice(0, 40),
    valor_total: valorParaIxc(e.valorTotal),
    gera_estoque: 'N',
    status: 'A',
    nfe_emitida: 'N',
    tipo_frete: '9',
  };
}

export interface ItemDaEntrada extends Omit<ItemMovimentado, 'tipoProduto'> {
  almoxId: number;
  filialId: number;
  valorUnitario: number;
  /** "DD/MM/AAAA" */
  data: string;
}

/**
 * `POST /movimento_produtos` ("Compras / Produtos (inserir)"). Obrigatórios do
 * exemplo: `id_produto`, `id_unidade`, `id_almox`, `quantidade`,
 * `valor_unitario`, `valor_total`, `estoque: "S"`, `id_entrada`, `tipo: "E"`
 * (entrada), `unidade_sigla`.
 */
export function montarItemDaEntrada(
  entradaId: number,
  item: ItemDaEntrada,
): Record<string, unknown> {
  const quantidade = quantidadeValida(item.quantidade);
  const unitario = precoValido(item.valorUnitario);
  return {
    id_produto: String(idValido(item.produtoId, 'o produto')),
    id_unidade: String(idValido(item.unidadeId, 'a unidade')),
    id_almox: String(idValido(item.almoxId, 'o almoxarifado')),
    quantidade: qtdeParaIxc(quantidade),
    valor_unitario: valorParaIxc(unitario),
    valor_total: valorParaIxc(Math.round(quantidade * unitario * 100) / 100),
    estoque: 'S',
    id_entrada: String(idValido(entradaId, 'a compra')),
    tipo: 'E',
    unidade_sigla: item.unidadeSigla,
    filial_id: String(idValido(item.filialId, 'a filial')),
    fator_conversao: '1.000000000',
    data: item.data,
  };
}

// ---------------------------------------------------------------------------

function descricaoValida(descricao: string): string {
  const d = String(descricao ?? '').trim().replace(/\s+/g, ' ');
  if (d.length < 2) throw new BadRequestException('O nome do produto é curto demais.');
  if (d.length > 100) {
    throw new BadRequestException('O nome do produto passa de 100 letras. Encurte.');
  }
  return d;
}

function precoValido(preco: number): number {
  const n = Number(preco);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('O preço precisa ser um número, zero ou mais.');
  }
  return Math.round(n * 100) / 100;
}

function quantidadeValida(quantidade: number): number {
  const n = Number(quantidade);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException('A quantidade precisa ser maior que zero.');
  }
  return Math.round(n * 100000) / 100000;
}

function idValido(id: number, oQue: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequestException(`Falta ${oQue}.`);
  }
  return n;
}
