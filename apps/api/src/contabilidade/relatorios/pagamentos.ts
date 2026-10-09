import { estaEmAberto } from '../../contas-abertas/contas-abertas.mapper';
import { centavos, diaBr, diaDoIxc, diasEntre, idDoIxc, numero, texto } from '../ixc-leitura';
import type { Coluna, Valor } from '../planilha';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * O lado de quem paga: o que saiu no período (08, e os recortes dele — 13
 * lucros, 14 link, 18 doações, 20 descontos) e o que a empresa ainda devia no
 * último dia (12).
 *
 * **O dia do pagamento é o `debito_data`** — o dia em que o dinheiro saiu, que
 * a tela do IXC chama de "Data pagamento". Não o `data_pagamento`, que é
 * quando a baixa foi registrada: em setembro de 2026 quatro pagamentos feitos
 * no mês só foram registrados em outubro, e quem lê pelo registro os perde.
 *
 * O `fn_apagar` não tem coluna de juros nem de desconto. O que há é
 * `valor_pago` (quanto do título foi quitado) e `valor_total_pago` (quanto
 * dinheiro saiu): a diferença é o acréscimo, quando positiva, ou o desconto
 * obtido, quando negativa.
 */

export interface Pagamento {
  idFnApagar: number;
  /** O dia em que o dinheiro saiu. */
  dia: string;
  fornecedorId: number | null;
  fornecedor: string;
  fornecedorDocumento: string;
  /** "Número da nota" do título. */
  notaFiscal: string;
  documento: string;
  /** O valor do título. */
  valor: number;
  /** Quanto dinheiro saiu. */
  pago: number;
  desconto: number;
  acrescimo: number;
  contaId: number | null;
  conta: string;
  forma: string;
  /** O plano de contas do IXC. */
  planoDeContasId: number | null;
  planoDeContas: string;
  /** As categorias desta casa (a classificação e as das notas da conta). */
  categorias: Array<{ id: string; nome: string }>;
  /**
   * Os ids das categorias e das mães delas: é por eles que os recortes
   * (lucros, doações, link) escolhem — quem marca "Mensalidades" quer as
   * filhas junto.
   */
  categoriaIds: string[];
  observacao: string;
  /** O lançamento do dinheiro no razão da conta (`fn_movim_finan` M). */
  idMovimento: number | null;
}

export interface CadastrosDoPagar {
  fornecedores: Map<number, { nome: string; documento: string }>;
  contas: Map<number, string>;
  planoDeContas: Map<number, string>;
}

/** Um título pago no período, lido do registro cru do `fn_apagar`. */
export function lerPagamento(
  raw: Record<string, unknown>,
  cad: CadastrosDoPagar,
): Pagamento | null {
  const idFnApagar = idDoIxc(raw.id);
  const dia = diaDoIxc(raw.debito_data);
  if (idFnApagar === null || !dia) return null;

  const valor = centavos(numero(raw.valor));
  const quitado = centavos(numero(raw.valor_pago)) || valor;
  // Sem `valor_total_pago` preenchido, saiu o que foi quitado.
  const pago = centavos(numero(raw.valor_total_pago)) || quitado;
  const fornecedorId = idDoIxc(raw.id_fornecedor);
  const fornecedor = fornecedorId !== null ? cad.fornecedores.get(fornecedorId) : undefined;
  const contaId = idDoIxc(raw.id_contas);
  const planoDeContasId = idDoIxc(raw.id_conta);

  return {
    idFnApagar,
    dia,
    fornecedorId,
    fornecedor: fornecedor?.nome || (fornecedorId !== null ? `Fornecedor ${fornecedorId}` : ''),
    fornecedorDocumento: fornecedor?.documento ?? '',
    notaFiscal: texto(raw.numero_nota),
    documento: texto(raw.documento),
    valor,
    pago,
    desconto: centavos(Math.max(0, quitado - pago)),
    acrescimo: centavos(Math.max(0, pago - quitado)),
    contaId,
    conta: contaId !== null ? (cad.contas.get(contaId) ?? `Conta ${contaId}`) : '',
    forma: texto(raw.tipo_pagamento),
    planoDeContasId,
    planoDeContas:
      planoDeContasId !== null ? (cad.planoDeContas.get(planoDeContasId) ?? `Conta ${planoDeContasId}`) : '',
    categorias: [],
    categoriaIds: [],
    observacao: texto(raw.obs),
    idMovimento: null,
  };
}

/**
 * Pago no período: o título baixado com o dinheiro saindo no período. O
 * cancelado fica de fora — a baixa dele foi estornada ou ele nunca valeu.
 */
export function foiPagoNoPeriodo(raw: Record<string, unknown>, de: string, ate: string): boolean {
  if (texto(raw.status).toUpperCase() === 'C') return false;
  const dia = diaDoIxc(raw.debito_data);
  return !!dia && dia >= de && dia <= ate;
}

// ---------------------------------------------------------------------------
// O comprovante de cada pagamento
// ---------------------------------------------------------------------------

/** Um papel que comprova um pagamento, venha de onde vier. */
export interface Comprovante {
  /** De onde: anexado no título do IXC, foto da conferência do caixa, nota
   * guardada na conta, recibo assinado da diária, recibo da folha guardado no
   * RH, ou enviado no pacote. */
  origem: 'ixc' | 'caixa' | 'conta' | 'recibo' | 'rh' | 'pacote';
  id: string;
  nome: string;
}

export interface SituacaoDoComprovante {
  comprovantes: Comprovante[];
  /** Marcado como "não tem", com o motivo. */
  semComprovante: string | null;
}

export function textoDoComprovante(s: SituacaoDoComprovante | undefined): string {
  if (s && s.comprovantes.length > 0) {
    return s.comprovantes.length === 1 ? 'Sim' : `Sim (${s.comprovantes.length})`;
  }
  if (s?.semComprovante) return `Não tem: ${s.semComprovante}`;
  return 'FALTA';
}

const COLUNAS_DO_PAGAMENTO: Coluna[] = [
  { titulo: 'Pago em', tipo: 'data' },
  { titulo: 'Fornecedor', tipo: 'texto', largura: 36 },
  { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
  { titulo: 'Título', tipo: 'inteiro' },
  { titulo: 'Nota fiscal', tipo: 'texto', largura: 12 },
  { titulo: 'Valor do título', tipo: 'moeda' },
  { titulo: 'Valor pago', tipo: 'moeda' },
  { titulo: 'Conta', tipo: 'texto', largura: 24 },
  { titulo: 'Forma', tipo: 'texto', largura: 12 },
  { titulo: 'Plano de contas (IXC)', tipo: 'texto', largura: 30 },
  { titulo: 'Categoria', tipo: 'texto', largura: 28 },
  { titulo: 'Comprovante', tipo: 'texto', largura: 22 },
  { titulo: 'Observação', tipo: 'texto', largura: 40 },
];

function linhaDoPagamento(p: Pagamento, comprovante: SituacaoDoComprovante | undefined): Valor[] {
  return [
    p.dia,
    p.fornecedor,
    p.fornecedorDocumento,
    p.idFnApagar,
    p.notaFiscal,
    p.valor,
    p.pago,
    p.conta,
    p.forma,
    p.planoDeContas,
    p.categorias.map((c) => c.nome).join(', '),
    textoDoComprovante(comprovante),
    p.observacao,
  ];
}

export function ordenarPagamentos(lista: Pagamento[]): Pagamento[] {
  return [...lista].sort(
    (a, b) => a.dia.localeCompare(b.dia) || a.fornecedor.localeCompare(b.fornecedor, 'pt-BR') || a.idFnApagar - b.idFnApagar,
  );
}

/**
 * A planilha de uma lista de pagamentos — a de todas as saídas (08) e a dos
 * recortes (13, 14, 18). Montada na hora do zip, e não na leitura: o
 * comprovante é o que muda depois que o IXC foi lido.
 */
export function planilhaDePagamentos(opcoes: {
  titulo: string;
  de: string;
  ate: string;
  lidoEm: Date;
  pagamentos: Pagamento[];
  comprovantes: Map<number, SituacaoDoComprovante>;
  explicacao?: string;
}): Relatorio['abas'] {
  const lista = ordenarPagamentos(opcoes.pagamentos);
  const faltam = lista.filter((p) => textoDoComprovante(opcoes.comprovantes.get(p.idFnApagar)) === 'FALTA');
  const cabecalho = [
    `${opcoes.titulo} — ${diaBr(opcoes.de)} a ${diaBr(opcoes.ate)}`,
    `Lido do IXC em ${opcoes.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    ...(opcoes.explicacao ? [opcoes.explicacao] : []),
    'Os comprovantes estão na pasta "Comprovantes", com o número do título no nome do arquivo.',
  ];
  return [
    {
      nome: 'Pagamentos',
      cabecalho,
      colunas: COLUNAS_DO_PAGAMENTO,
      linhas: lista.map((p) => linhaDoPagamento(p, opcoes.comprovantes.get(p.idFnApagar))),
      totais: ['Total', '', '', lista.length, '', soma(lista, (p) => p.valor), soma(lista, (p) => p.pago), '', '', '', '', faltam.length ? `${faltam.length} sem` : '', ''],
    },
    ...porFornecedor(lista, cabecalho[0]),
  ];
}

function porFornecedor(lista: Pagamento[], titulo: string): Relatorio['abas'] {
  if (lista.length === 0) return [];
  const mapa = new Map<string, { nome: string; documento: string; quantidade: number; pago: number }>();
  for (const p of lista) {
    const chave = p.fornecedorId !== null ? String(p.fornecedorId) : p.fornecedor;
    const atual = mapa.get(chave) ?? { nome: p.fornecedor, documento: p.fornecedorDocumento, quantidade: 0, pago: 0 };
    atual.quantidade += 1;
    atual.pago += p.pago;
    mapa.set(chave, atual);
  }
  return [
    {
      nome: 'Por fornecedor',
      cabecalho: [titulo],
      colunas: [
        { titulo: 'Fornecedor', tipo: 'texto', largura: 40 },
        { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
        { titulo: 'Pagamentos', tipo: 'inteiro', largura: 12 },
        { titulo: 'Total pago', tipo: 'moeda', largura: 16 },
      ],
      linhas: [...mapa.values()]
        .sort((a, b) => b.pago - a.pago)
        .map((f) => [f.nome, f.documento, f.quantidade, centavos(f.pago)]),
      totais: ['Total', '', lista.length, soma(lista, (p) => p.pago)],
    },
  ];
}

/** O resumo da tela de uma lista de pagamentos. */
export function resumoDePagamentos(lista: Pagamento[], rotulo: string): Relatorio['resumo'] {
  return [moeda(rotulo, soma(lista, (p) => p.pago), true), quantidade('Pagamentos', lista.length)];
}

// ---------------------------------------------------------------------------
// 20 — Descontos obtidos
// ---------------------------------------------------------------------------

export function relatorioDeDescontos(opcoes: {
  de: string;
  ate: string;
  lidoEm: Date;
  pagamentos: Pagamento[];
}): Relatorio {
  const { de, ate } = opcoes;
  const comDesconto = ordenarPagamentos(opcoes.pagamentos.filter((p) => p.desconto > 0.004));
  const total = soma(comDesconto, (p) => p.desconto);
  return {
    arquivo: `Descontos obtidos ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [moeda('Descontos obtidos', total, true), quantidade('Pagamentos com desconto', comDesconto.length)],
    avisos: [],
    abas: [
      {
        nome: 'Descontos obtidos',
        cabecalho: [
          `Descontos obtidos — ${diaBr(de)} a ${diaBr(ate)}`,
          `Lido do IXC em ${opcoes.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
          'Desconto = o que foi quitado do título menos o dinheiro que saiu.',
        ],
        colunas: [
          { titulo: 'Pago em', tipo: 'data' },
          { titulo: 'Fornecedor', tipo: 'texto', largura: 36 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Título', tipo: 'inteiro' },
          { titulo: 'Nota fiscal', tipo: 'texto', largura: 12 },
          { titulo: 'Valor do título', tipo: 'moeda' },
          { titulo: 'Desconto', tipo: 'moeda' },
          { titulo: 'Valor pago', tipo: 'moeda' },
          { titulo: 'Conta', tipo: 'texto', largura: 24 },
          { titulo: 'Motivo (observação do título)', tipo: 'texto', largura: 44 },
        ],
        linhas: comDesconto.map((p) => [
          p.dia,
          p.fornecedor,
          p.fornecedorDocumento,
          p.idFnApagar,
          p.notaFiscal,
          p.valor,
          p.desconto,
          p.pago,
          p.conta,
          p.observacao,
        ]),
        totais: ['Total', '', '', comDesconto.length, '', soma(comDesconto, (p) => p.valor), total, soma(comDesconto, (p) => p.pago), '', ''],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 12 — Saldo de fornecedores
// ---------------------------------------------------------------------------

export interface DadosDoSaldoDeFornecedores {
  dia: string;
  /** Títulos com status em aberto hoje (A e P). */
  abertosHoje: Array<Record<string, unknown>>;
  /** Títulos com o dinheiro saindo depois do dia. */
  pagosDepois: Array<Record<string, unknown>>;
  /** Títulos cancelados depois do dia. */
  canceladosDepois: Array<Record<string, unknown>>;
  cadastros: CadastrosDoPagar;
  lidoEm: Date;
}

export interface DividaNoDia {
  idFnApagar: number;
  fornecedor: string;
  fornecedorDocumento: string;
  notaFiscal: string;
  documento: string;
  emissao: string;
  vencimento: string | null;
  valor: number;
  abertoNoDia: number;
  situacaoHoje: string;
  planoDeContas: string;
  observacao: string;
}

/**
 * O que a empresa devia no dia, reconstruído a partir de hoje como no saldo
 * de clientes: em aberto hoje + o que foi pago ou cancelado depois do dia, só
 * para os títulos emitidos até o dia.
 *
 * Em aberto "hoje" segue a regra da tela de contas em aberto (`estaEmAberto`):
 * título com status parado em "A" mas já baixado não é dívida, e título não
 * liberado também não — é a regra que custou caro aprender lá.
 */
export function dividasNoDia(dados: DadosDoSaldoDeFornecedores): DividaNoDia[] {
  const { dia, cadastros: cad } = dados;

  const porId = new Map<number, Record<string, unknown>>();
  for (const lista of [dados.canceladosDepois, dados.pagosDepois, dados.abertosHoje]) {
    for (const raw of lista) {
      const id = idDoIxc(raw.id);
      if (id !== null) porId.set(id, raw);
    }
  }

  const dividas: DividaNoDia[] = [];
  for (const [id, raw] of porId) {
    const emissao = diaDoIxc(raw.data_emissao);
    if (!emissao || emissao > dia) continue;
    if (texto(raw.liberado).toUpperCase() === 'N') continue;

    const status = texto(raw.status).toUpperCase();
    const debito = diaDoIxc(raw.debito_data);
    const cancelamento = diaDoIxc(raw.data_cancelamento);
    const valor = centavos(numero(raw.valor));
    const quitado = centavos(numero(raw.valor_pago));

    let aberto = 0;
    let situacaoHoje = 'Em aberto';
    if (status === 'C') {
      if (!cancelamento || cancelamento <= dia) continue;
      aberto = centavos(numero(raw.valor_cancelado)) || valor;
      situacaoHoje = `Cancelado em ${diaBr(cancelamento)}`;
    } else if (estaEmAberto(raw)) {
      aberto = centavos(numero(raw.valor_aberto)) || centavos(valor - quitado);
      // Pago em parte depois do dia: a parte paga ainda era devida no dia.
      if (debito && debito > dia) aberto = centavos(aberto + quitado);
    } else if (debito && debito > dia) {
      aberto = quitado || valor;
      situacaoHoje = `Pago em ${diaBr(debito)}`;
    } else {
      continue;
    }
    if (aberto <= 0.004) continue;

    const fornecedorId = idDoIxc(raw.id_fornecedor);
    const fornecedor = fornecedorId !== null ? cad.fornecedores.get(fornecedorId) : undefined;
    const plano = idDoIxc(raw.id_conta);

    dividas.push({
      idFnApagar: id,
      fornecedor: fornecedor?.nome || (fornecedorId !== null ? `Fornecedor ${fornecedorId}` : ''),
      fornecedorDocumento: fornecedor?.documento ?? '',
      notaFiscal: texto(raw.numero_nota),
      documento: texto(raw.documento),
      emissao,
      vencimento: diaDoIxc(raw.data_vencimento),
      valor,
      abertoNoDia: aberto,
      situacaoHoje,
      planoDeContas: plano !== null ? (cad.planoDeContas.get(plano) ?? `Conta ${plano}`) : '',
      observacao: texto(raw.obs),
    });
  }

  return dividas.sort(
    (a, b) =>
      a.fornecedor.localeCompare(b.fornecedor, 'pt-BR') ||
      (a.vencimento ?? '').localeCompare(b.vencimento ?? '') ||
      a.idFnApagar - b.idFnApagar,
  );
}

export function relatorioDeFornecedores(dados: DadosDoSaldoDeFornecedores): Relatorio {
  const { dia } = dados;
  const dividas = dividasNoDia(dados);
  const vencidas = dividas.filter((d) => d.vencimento !== null && d.vencimento <= dia);
  const aVencer = dividas.filter((d) => !(d.vencimento !== null && d.vencimento <= dia));
  const total = soma(dividas, (d) => d.abertoNoDia);

  const porFornecedor = new Map<string, { nome: string; documento: string; titulos: number; vencido: number; aVencer: number }>();
  for (const d of dividas) {
    const atual = porFornecedor.get(d.fornecedor) ?? { nome: d.fornecedor, documento: d.fornecedorDocumento, titulos: 0, vencido: 0, aVencer: 0 };
    atual.titulos += 1;
    if (d.vencimento !== null && d.vencimento <= dia) atual.vencido += d.abertoNoDia;
    else atual.aVencer += d.abertoNoDia;
    porFornecedor.set(d.fornecedor, atual);
  }

  const cabecalho = [
    `Saldo de fornecedores em ${diaBr(dia)}`,
    `Lido do IXC em ${dados.lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    'Em aberto no dia = em aberto hoje + o que foi pago ou cancelado depois do dia, dos títulos emitidos até o dia.',
  ];

  const avisos: string[] = [];
  const antigas = vencidas.filter((d) => d.vencimento && diasEntre(d.vencimento, dia) > 180);
  if (antigas.length > 0) {
    avisos.push(
      `${antigas.length} contas vencidas há mais de 6 meses continuam em aberto no IXC ` +
        `(${reais(soma(antigas, (d) => d.abertoNoDia))}). Confira se não foram pagas sem baixa.`,
    );
  }

  return {
    arquivo: `Saldo de fornecedores ${diaBr(dia).replace(/\//g, '-')}`,
    resumo: [
      moeda(`A pagar em ${diaBr(dia)}`, total, true),
      moeda('Vencido', soma(vencidas, (d) => d.abertoNoDia)),
      moeda('A vencer', soma(aVencer, (d) => d.abertoNoDia)),
      quantidade('Fornecedores', porFornecedor.size),
      quantidade('Títulos', dividas.length),
    ],
    avisos,
    abas: [
      {
        nome: 'Títulos a pagar',
        cabecalho,
        colunas: [
          { titulo: 'Fornecedor', tipo: 'texto', largura: 36 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Título', tipo: 'inteiro' },
          { titulo: 'Nota fiscal', tipo: 'texto', largura: 12 },
          { titulo: 'Emissão', tipo: 'data' },
          { titulo: 'Vencimento', tipo: 'data' },
          { titulo: 'Valor do título', tipo: 'moeda' },
          { titulo: 'Em aberto no dia', tipo: 'moeda', largura: 17 },
          { titulo: 'Situação hoje', tipo: 'texto', largura: 22 },
          { titulo: 'Plano de contas (IXC)', tipo: 'texto', largura: 30 },
          { titulo: 'Observação', tipo: 'texto', largura: 40 },
        ],
        linhas: dividas.map((d) => [
          d.fornecedor,
          d.fornecedorDocumento,
          d.idFnApagar,
          d.notaFiscal,
          d.emissao,
          d.vencimento,
          d.valor,
          d.abertoNoDia,
          d.situacaoHoje,
          d.planoDeContas,
          d.observacao,
        ]),
        totais: ['Total', '', dividas.length, '', null, null, soma(dividas, (d) => d.valor), total, '', '', ''],
      },
      {
        nome: 'Por fornecedor',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Fornecedor', tipo: 'texto', largura: 40 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Títulos', tipo: 'inteiro' },
          { titulo: 'Vencido', tipo: 'moeda' },
          { titulo: 'A vencer', tipo: 'moeda' },
          { titulo: 'Total', tipo: 'moeda' },
        ],
        linhas: [...porFornecedor.values()]
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          .map((f) => [f.nome, f.documento, f.titulos, centavos(f.vencido), centavos(f.aVencer), centavos(f.vencido + f.aVencer)]),
        totais: ['Total', '', dividas.length, soma(vencidas, (d) => d.abertoNoDia), soma(aVencer, (d) => d.abertoNoDia), total],
      },
    ],
  };
}
