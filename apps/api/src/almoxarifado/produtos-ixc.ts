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
  /** "Controla estoque": sem ele, transferência e entrada não mexem no saldo. */
  controlaEstoque?: boolean;
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
 *
 * O IXC confere os obrigatórios do cadastro inteiro a cada `PUT`, e não só o
 * campo mudado: produto que nasceu lá sem NCM não aceita nem troca de nome.
 * Para esse, vem um `modelo` — um produto parecido — e o fiscal que falta sai
 * dele, como no cadastro de produto novo. Só o que está **vazio** é copiado:
 * o que o produto já tem preenchido não se troca por tabela.
 */
export function montarEdicaoProduto(
  atual: Record<string, unknown>,
  mudancas: EdicaoDoProduto,
  modelo?: Record<string, unknown>,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(atual)) {
    corpo[coluna] = typeof valor === 'string' ? dataParaEscrita(valor) : valor;
  }
  corpo.ultima_atualizacao = '';

  if (modelo) {
    validarModelo(modelo);
    for (const campo of COPIADOS_DO_MODELO) {
      if (vazio(corpo[campo])) corpo[campo] = texto(modelo[campo]);
    }
    for (const [campo, valor] of Object.entries(FIXOS_DO_CADASTRO)) {
      if (vazio(corpo[campo])) corpo[campo] = valor;
    }
  }

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
  if (mudancas.controlaEstoque !== undefined) {
    corpo.controla_estoque = mudancas.controlaEstoque ? 'S' : 'N';
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

/** Os obrigatórios com valor fixo na documentação ("Obrigatório o valor ser P"). */
const FIXOS_DO_CADASTRO = {
  aceita_valor: 'P',
  mostra_valor_ecommerce: 'P',
  tipo_ecommerce: 'P',
  ecommerce_prioridade: '1',
} as const;

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function vazio(v: unknown): boolean {
  const t = texto(v);
  return !t || t === '0';
}

/**
 * O fiscal obrigatório que falta no produto, pelo nome ("o NCM", "o subgrupo"…).
 * Vazio: o cadastro tem tudo o que o IXC confere ao gravar.
 */
export function fiscalQueFalta(produto: Record<string, unknown>): string[] {
  return OBRIGATORIOS_DO_MODELO.filter(([campo]) => vazio(produto[campo])).map(
    ([, nome]) => nome,
  );
}

/**
 * O modelo tem de ter o fiscal completo, e ser produto comum de estoque.
 * Patrimônio e serviço não servem: patrimônio é peça com número de série (anda
 * de outro jeito no estoque) e serviço não tem estoque nenhum.
 */
function validarModelo(modelo: Record<string, unknown>): void {
  const falta = fiscalQueFalta(modelo);
  if (falta.length > 0) {
    throw new BadRequestException(
      `O produto modelo não tem ${falta[0]} preenchido no IXC. Escolha outro modelo — ` +
        'um que já tenha nota fiscal saindo certo.',
    );
  }
  const tipo = texto(modelo.tipo).toUpperCase();
  if (tipo === 'P' || tipo === 'S') {
    throw new BadRequestException(
      tipo === 'P'
        ? 'O modelo é um patrimônio (peça com número de série). Escolha um produto comum de estoque.'
        : 'O modelo é um serviço, que não tem estoque. Escolha um produto de estoque.',
    );
  }
}

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
 */
export function montarNovoProduto(
  dados: NovoProduto,
  modelo: Record<string, unknown>,
): Record<string, unknown> {
  validarModelo(modelo);

  const corpo: Record<string, unknown> = {};
  for (const campo of COPIADOS_DO_MODELO) corpo[campo] = texto(modelo[campo]);

  return {
    ...corpo,
    ativo: 'S',
    controla_estoque: 'S',
    descricao: descricaoValida(dados.descricao),
    unidade: String(idValido(dados.unidadeId, 'a unidade')),
    preco_base: valorParaIxc(precoValido(dados.precoBase)),
    ...FIXOS_DO_CADASTRO,
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

/**
 * `POST /transf_almox_item` ("3. Inserir patrimônio na transferência"): uma
 * peça de patrimônio — a ONU, o roteador — pelo `id_patrimonio` dela.
 * Quantidade 1 e `tipo_produto: "P"`, como no exemplo: patrimônio anda peça
 * por peça, e é o registro dele (com MAC e número) que muda de almoxarifado.
 */
export function montarPatrimonioDaTransferencia(
  transferenciaId: number,
  peca: { patrimonioId: number; produtoId: number; unidadeId: number; unidadeSigla: string },
): Record<string, unknown> {
  return {
    id_patrimonio: String(idValido(peca.patrimonioId, 'o patrimônio')),
    id_produto: String(idValido(peca.produtoId, 'o produto')),
    id_unidade: String(idValido(peca.unidadeId, 'a unidade')),
    unidade_sigla: peca.unidadeSigla,
    qtde: qtdeParaIxc(1),
    fator_conversao: '1.000000000',
    id_transf_almox: String(idValido(transferenciaId, 'a transferência')),
    tipo_produto: 'P',
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
    // Todas as colunas do exemplo, as opcionais vazias. Mandando só as
    // obrigatórias, o IXC respondeu "Ocorreu um erro ao processar" (acerto de
    // negativos, 11/09/2026) — o webservice espera receber a linha inteira.
    ...COLUNAS_DA_ENTRADA,
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

/** As colunas opcionais de "Produtos (inserir)" da compra, vazias como no exemplo. */
const COLUNAS_DO_ITEM_DA_ENTRADA: Record<string, string> = Object.fromEntries(
  [
    'tipo_preenchimento_tributacao',
    'codigo_fornecedor',
    'descricao_fornecedor',
    'descricao',
    'pdesconto',
    'valor_frete',
    'vdesconto',
    'id_itens_pedido',
    'id_pedido_compra',
    'id_pedido_compra_itens',
    'qtde_saida',
    'id_inventario',
    'id_negociacao',
    'tipo_produto',
    'id_transf_almox_item',
    'id_moeda',
    'id_estrutura',
    'imobilizado',
    'eh_importacao_xml',
    'ultima_atualizacao',
    'id_saida',
    'id_class_fiscal',
    'cfop',
    'ncm',
    'valor_icm',
    'valor_ipi',
    'iss_valor',
    'valor_icms_st',
    'valor_fcp_st',
    'valor_outros',
  ].map((c) => [c, '']),
);

/** As colunas opcionais de "Compra (inserir)", vazias como no exemplo da documentação. */
const COLUNAS_DA_ENTRADA: Record<string, string> = Object.fromEntries(
  [
    'arquivo_xml',
    'modelo_nf',
    'serie',
    'id_almox_padrao_tipo_doc',
    'tipo_calculo_tributacao',
    'tipo_entrada_compra',
    'transportadora',
    'vipi_frete',
    'frete_volumes',
    'frete_especie',
    'frete_peso_bruto',
    'frete_peso_liquido',
    'vfrete',
    'icms_bc',
    'icms_valor',
    'icms_bc_st',
    'icms_valor_st',
    'fcp_bc_st',
    'fcp_valor_st',
    'ipi_valor',
    'vpis',
    'vcofins',
    'realizar_rateio_outras_despesas',
    'voutro',
    'nfe_chave',
  ].map((c) => [c, '']),
);

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
    // A linha inteira do exemplo, como na compra (ver `montarEntrada`).
    ...COLUNAS_DO_ITEM_DA_ENTRADA,
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
