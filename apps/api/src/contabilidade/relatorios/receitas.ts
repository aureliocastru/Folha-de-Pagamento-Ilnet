import { centavos, diaBr, diaDoIxc, diasEntre, idDoIxc, numero, texto } from '../ixc-leitura';
import type { Coluna, Valor } from '../planilha';
import { moeda, quantidade, reais, soma, type Relatorio } from './relatorio';

/**
 * O lado de quem recebe: o faturamento do período (07), os juros cobrados de
 * quem pagou atrasado (19) e o que entrou pela maquininha (16).
 *
 * Os três saem das mesmas duas leituras do IXC — os títulos a receber e os
 * recebimentos —, e por isso moram juntos: a mesma regra de "o que é um
 * recebimento" vale para os três, e um número não discorda do outro.
 *
 * Recebimento é a linha da view `fn_areceber_baixas` com título
 * (`id_receber > 0`). Nela, conferido contra a base em 09/10/2026:
 *
 * - `credito` é o valor do título que foi quitado, sem juros;
 * - `vacrescimo` são os juros e a multa; `vdesconto`, o desconto dado;
 * - `valor_liquido_recebido` = credito + acréscimo − desconto: o dinheiro;
 * - `conta_` é a conta do IXC onde o dinheiro caiu (18 = ModoBank PIX).
 *
 * Setembro de 2026 fechou assim: 775.570,78 + 12.737,05 − 37.371,21 =
 * 750.936,62, linha por linha.
 */

export interface Recebimento {
  id: number;
  dia: string;
  tituloId: number;
  contaId: number | null;
  /** O valor do título que foi quitado. */
  credito: number;
  /** Juros e multa. */
  acrescimo: number;
  desconto: number;
  /** O dinheiro que entrou. */
  liquido: number;
  historico: string;
}

export function lerRecebimento(raw: Record<string, unknown>): Recebimento | null {
  const id = idDoIxc(raw.id);
  const tituloId = idDoIxc(raw.id_receber);
  const dia = diaDoIxc(raw.data);
  if (id === null || tituloId === null || !dia) return null;
  return {
    id,
    dia,
    tituloId,
    contaId: idDoIxc(raw.conta_),
    credito: centavos(numero(raw.credito)),
    acrescimo: centavos(numero(raw.vacrescimo)),
    desconto: centavos(numero(raw.vdesconto) + numero(raw.descontos_adicionais)),
    liquido: centavos(numero(raw.valor_liquido_recebido)),
    historico: texto(raw.historico),
  };
}

export interface Cadastros {
  clientes: Map<number, { nome: string; documento: string }>;
  contas: Map<number, string>;
}

function nomeDoCliente(cad: Cadastros, id: number | null): string {
  if (id === null) return 'Sem cliente';
  return cad.clientes.get(id)?.nome || `Cliente ${id}`;
}

function documentoDoCliente(cad: Cadastros, id: number | null): string {
  return id === null ? '' : (cad.clientes.get(id)?.documento ?? '');
}

function nomeDaConta(cad: Cadastros, id: number | null): string {
  if (id === null) return '';
  return cad.contas.get(id) ?? `Conta ${id}`;
}

function cabecalhoDoPeriodo(titulo: string, de: string, ate: string, lidoEm: Date): string[] {
  return [
    `${titulo} — ${diaBr(de)} a ${diaBr(ate)}`,
    `Lido do IXC em ${lidoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
  ];
}

// ---------------------------------------------------------------------------
// 07 — Faturamento real
// ---------------------------------------------------------------------------

export interface DadosDoFaturamento {
  de: string;
  ate: string;
  /** Títulos com o período de serviço começando no período. */
  titulosDoServico: Array<Record<string, unknown>>;
  /** Títulos emitidos no período (os sem período de serviço saem daqui). */
  titulosEmitidos: Array<Record<string, unknown>>;
  /** `vd_saida` emitidas no período. */
  vendas: Array<Record<string, unknown>>;
  recebimentos: Recebimento[];
  cadastros: Cadastros;
  lidoEm: Date;
}

/** Acordo de renegociação: substitui títulos antigos, não é venda nova. */
export function ehRenegociacao(raw: Record<string, unknown>): boolean {
  return texto(raw.id_renegociacao_novo) !== '' || /^RN\d/i.test(texto(raw.documento));
}

/** Os modelos de nota fiscal, como o IXC os numera. */
const MODELOS: Record<string, string> = {
  '62': 'NFCom (modelo 62)',
  '21': 'Nota de comunicação (modelo 21)',
  '22': 'Nota de telecomunicação (modelo 22)',
  '55': 'NF-e (modelo 55)',
  '65': 'NFC-e (modelo 65)',
  '13': 'Modelo 13',
};

const SITUACAO_DA_VENDA: Record<string, string> = {
  F: 'Emitida',
  C: 'Cancelada',
  A: 'Em aberto',
  D: 'Denegada',
  AP: 'Aguardando processamento',
  PE: 'Processada com erro',
};

const COLUNAS_DO_TITULO_A_RECEBER: Coluna[] = [
  { titulo: 'Cliente', tipo: 'texto', largura: 38 },
  { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
  { titulo: 'Título', tipo: 'inteiro' },
  { titulo: 'Emissão', tipo: 'data' },
  { titulo: 'Vencimento', tipo: 'data' },
  { titulo: 'Serviço de', tipo: 'data' },
  { titulo: 'Serviço até', tipo: 'data' },
  { titulo: 'Valor', tipo: 'moeda' },
  { titulo: 'Situação hoje', tipo: 'texto', largura: 16 },
  { titulo: 'Observação', tipo: 'texto', largura: 36 },
];

const SITUACAO_DO_TITULO: Record<string, string> = {
  A: 'Em aberto',
  P: 'Recebido em parte',
  R: 'Recebido',
  C: 'Cancelado',
};

function linhaDoTituloAReceber(raw: Record<string, unknown>, cad: Cadastros): Valor[] {
  const cliente = idDoIxc(raw.id_cliente);
  return [
    nomeDoCliente(cad, cliente),
    documentoDoCliente(cad, cliente),
    idDoIxc(raw.id),
    diaDoIxc(raw.data_emissao),
    diaDoIxc(raw.data_vencimento),
    diaDoIxc(raw.data_inicial),
    diaDoIxc(raw.data_final),
    centavos(numero(raw.valor)),
    SITUACAO_DO_TITULO[texto(raw.status).toUpperCase()] ?? texto(raw.status),
    texto(raw.obs),
  ];
}

function ordenarPorCliente(lista: Array<Record<string, unknown>>, cad: Cadastros) {
  return [...lista].sort(
    (a, b) =>
      nomeDoCliente(cad, idDoIxc(a.id_cliente)).localeCompare(
        nomeDoCliente(cad, idDoIxc(b.id_cliente)),
        'pt-BR',
      ) || (idDoIxc(a.id) ?? 0) - (idDoIxc(b.id) ?? 0),
  );
}

export function relatorioDeFaturamento(dados: DadosDoFaturamento): Relatorio {
  const { de, ate, cadastros: cad } = dados;
  const noPeriodo = (dia: string | null) => !!dia && dia >= de && dia <= ate;
  const cancelado = (raw: Record<string, unknown>) => texto(raw.status).toUpperCase() === 'C';

  // As mensalidades: o serviço começou no período. Uma vez só por título.
  const vistos = new Set<number>();
  const doServico = dados.titulosDoServico.filter((raw) => {
    const id = idDoIxc(raw.id);
    if (id === null || vistos.has(id) || !noPeriodo(diaDoIxc(raw.data_inicial))) return false;
    vistos.add(id);
    return true;
  });

  // O que não tem período de serviço conta pela emissão.
  const semPeriodo = dados.titulosEmitidos.filter((raw) => {
    const id = idDoIxc(raw.id);
    if (id === null || vistos.has(id)) return false;
    if (texto(raw.data_inicial) && diaDoIxc(raw.data_inicial)) return false;
    if (!noPeriodo(diaDoIxc(raw.data_emissao))) return false;
    vistos.add(id);
    return true;
  });

  const mensalidades = doServico.filter((r) => !cancelado(r));
  const avulsas = semPeriodo.filter((r) => !cancelado(r) && !ehRenegociacao(r));
  const renegociacoes = semPeriodo.filter((r) => !cancelado(r) && ehRenegociacao(r));
  const cancelados = [...doServico, ...semPeriodo].filter(cancelado);

  const valorDe = (r: Record<string, unknown>) => numero(r.valor);
  const totalMensalidades = soma(mensalidades, valorDe);
  const totalAvulsas = soma(avulsas, valorDe);
  const faturamento = centavos(totalMensalidades + totalAvulsas);

  // Notas: a venda com modelo de nota fiscal.
  const notas = dados.vendas.filter((v) => texto(v.modelo_nf) !== '');
  const notasEmitidas = notas.filter((v) => texto(v.status).toUpperCase() === 'F');
  const notasComProblema = notas.filter((v) =>
    ['PE', 'AP', 'A', 'D'].includes(texto(v.status).toUpperCase()),
  );
  const notasCanceladas = notas.filter((v) => texto(v.status).toUpperCase() === 'C');

  const porModelo = new Map<string, { quantidade: number; valor: number }>();
  for (const v of notasEmitidas) {
    const m = texto(v.modelo_nf);
    const atual = porModelo.get(m) ?? { quantidade: 0, valor: 0 };
    atual.quantidade += 1;
    atual.valor += numero(v.valor_total);
    porModelo.set(m, atual);
  }

  // O recebido no período, por conta.
  const porConta = new Map<number | null, { credito: number; acrescimo: number; desconto: number; liquido: number; quantidade: number }>();
  for (const r of dados.recebimentos) {
    const atual = porConta.get(r.contaId) ?? { credito: 0, acrescimo: 0, desconto: 0, liquido: 0, quantidade: 0 };
    atual.credito += r.credito;
    atual.acrescimo += r.acrescimo;
    atual.desconto += r.desconto;
    atual.liquido += r.liquido;
    atual.quantidade += 1;
    porConta.set(r.contaId, atual);
  }
  const recebidoLiquido = soma(dados.recebimentos, (r) => r.liquido);

  const avisos: string[] = [];
  if (notasComProblema.length > 0) {
    avisos.push(
      `${notasComProblema.length} notas fiscais do período não foram autorizadas ` +
        `(com erro ou pendentes no IXC) — ${reais(soma(notasComProblema, (v) => numero(v.valor_total)))}.`,
    );
  }

  const cabecalho = cabecalhoDoPeriodo('Faturamento', de, ate, dados.lidoEm);
  const linhasDoResumo: Valor[][] = [
    ['Mensalidades com o serviço começando no período', mensalidades.length, totalMensalidades],
    ['Cobranças avulsas emitidas no período (taxas, vendas, parcelas)', avulsas.length, totalAvulsas],
    ['Faturamento do período', mensalidades.length + avulsas.length, faturamento],
    [],
    ['Acordos de renegociação emitidos (não somam: substituem títulos antigos)', renegociacoes.length, soma(renegociacoes, valorDe)],
    ['Títulos cancelados (não somam)', cancelados.length, soma(cancelados, valorDe)],
    [],
    ...[...porModelo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, v]): Valor[] => [`Notas emitidas — ${MODELOS[m] ?? `modelo ${m}`}`, v.quantidade, centavos(v.valor)]),
    ['Notas emitidas — total', notasEmitidas.length, soma(notasEmitidas, (v) => numero(v.valor_total))],
    ['Notas com erro ou pendentes', notasComProblema.length, soma(notasComProblema, (v) => numero(v.valor_total))],
    ['Notas canceladas', notasCanceladas.length, soma(notasCanceladas, (v) => numero(v.valor_total))],
    [],
    ['Recebido no período (dinheiro que entrou)', dados.recebimentos.length, recebidoLiquido],
  ];

  return {
    arquivo: `Faturamento ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Faturamento do período', faturamento, true),
      moeda('Mensalidades', totalMensalidades),
      moeda('Cobranças avulsas', totalAvulsas),
      moeda('Notas fiscais emitidas', soma(notasEmitidas, (v) => numero(v.valor_total))),
      quantidade('Notas emitidas', notasEmitidas.length),
      moeda('Recebido no período', recebidoLiquido),
    ],
    avisos,
    abas: [
      {
        nome: 'Resumo',
        cabecalho: [
          ...cabecalho,
          'Mensalidade conta no mês em que o serviço começa; cobrança sem período de serviço, no mês da emissão.',
        ],
        colunas: [
          { titulo: 'O quê', tipo: 'texto', largura: 70 },
          { titulo: 'Quantidade', tipo: 'inteiro', largura: 12 },
          { titulo: 'Valor', tipo: 'moeda', largura: 18 },
        ],
        linhas: linhasDoResumo,
      },
      {
        nome: 'Mensalidades',
        cabecalho: [cabecalho[0]],
        colunas: COLUNAS_DO_TITULO_A_RECEBER,
        linhas: ordenarPorCliente(mensalidades, cad).map((r) => linhaDoTituloAReceber(r, cad)),
        totais: ['Total', '', mensalidades.length, null, null, null, null, totalMensalidades, '', ''],
      },
      {
        nome: 'Cobranças avulsas',
        cabecalho: [cabecalho[0]],
        colunas: COLUNAS_DO_TITULO_A_RECEBER,
        linhas: ordenarPorCliente(avulsas, cad).map((r) => linhaDoTituloAReceber(r, cad)),
        totais: ['Total', '', avulsas.length, null, null, null, null, totalAvulsas, '', ''],
      },
      {
        nome: 'Renegociações',
        cabecalho: [cabecalho[0], 'Acordos que substituem títulos antigos — fora do faturamento.'],
        colunas: COLUNAS_DO_TITULO_A_RECEBER,
        linhas: ordenarPorCliente(renegociacoes, cad).map((r) => linhaDoTituloAReceber(r, cad)),
        totais: ['Total', '', renegociacoes.length, null, null, null, null, soma(renegociacoes, valorDe), '', ''],
      },
      {
        nome: 'Cancelados',
        cabecalho: [cabecalho[0], 'Títulos do período que foram cancelados — fora do faturamento.'],
        colunas: COLUNAS_DO_TITULO_A_RECEBER,
        linhas: ordenarPorCliente(cancelados, cad).map((r) => linhaDoTituloAReceber(r, cad)),
        totais: ['Total', '', cancelados.length, null, null, null, null, soma(cancelados, valorDe), '', ''],
      },
      {
        nome: 'Notas fiscais',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Número', tipo: 'texto', largura: 10 },
          { titulo: 'Série', tipo: 'texto', largura: 7 },
          { titulo: 'Modelo', tipo: 'texto', largura: 26 },
          { titulo: 'Emissão', tipo: 'data' },
          { titulo: 'Cliente', tipo: 'texto', largura: 38 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Valor', tipo: 'moeda' },
          { titulo: 'Situação', tipo: 'texto', largura: 24 },
          { titulo: 'Observação', tipo: 'texto', largura: 32 },
        ],
        linhas: [...notas]
          .sort((a, b) => (idDoIxc(a.id) ?? 0) - (idDoIxc(b.id) ?? 0))
          .map((v) => {
            const cliente = idDoIxc(v.id_cliente);
            return [
              texto(v.numero_nf),
              texto(v.serie),
              MODELOS[texto(v.modelo_nf)] ?? `Modelo ${texto(v.modelo_nf)}`,
              diaDoIxc(v.data_emissao),
              nomeDoCliente(cad, cliente),
              documentoDoCliente(cad, cliente),
              centavos(numero(v.valor_total)),
              SITUACAO_DA_VENDA[texto(v.status).toUpperCase()] ?? texto(v.status),
              texto(v.obs),
            ];
          }),
        totais: ['Emitidas', '', '', null, '', '', soma(notasEmitidas, (v) => numero(v.valor_total)), '', ''],
      },
      {
        nome: 'Recebido por conta',
        cabecalho: [cabecalho[0]],
        colunas: [
          { titulo: 'Conta', tipo: 'texto', largura: 30 },
          { titulo: 'Recebimentos', tipo: 'inteiro', largura: 13 },
          { titulo: 'Valor dos títulos', tipo: 'moeda', largura: 17 },
          { titulo: 'Juros e multa', tipo: 'moeda' },
          { titulo: 'Descontos', tipo: 'moeda' },
          { titulo: 'Recebido', tipo: 'moeda' },
        ],
        linhas: [...porConta.entries()]
          .sort(([, a], [, b]) => b.liquido - a.liquido)
          .map(([conta, v]) => [
            nomeDaConta(cad, conta),
            v.quantidade,
            centavos(v.credito),
            centavos(v.acrescimo),
            centavos(v.desconto),
            centavos(v.liquido),
          ]),
        totais: [
          'Total',
          dados.recebimentos.length,
          soma(dados.recebimentos, (r) => r.credito),
          soma(dados.recebimentos, (r) => r.acrescimo),
          soma(dados.recebimentos, (r) => r.desconto),
          recebidoLiquido,
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 19 — Juros cobrados de clientes
// ---------------------------------------------------------------------------

export interface DadosDosJuros {
  de: string;
  ate: string;
  recebimentos: Recebimento[];
  /** Os títulos dos recebimentos com acréscimo. */
  titulos: Map<number, Record<string, unknown>>;
  cadastros: Cadastros;
  lidoEm: Date;
}

export function relatorioDeJuros(dados: DadosDosJuros): Relatorio {
  const { de, ate, cadastros: cad } = dados;
  const comJuros = dados.recebimentos
    .filter((r) => r.acrescimo > 0.004)
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.id - b.id);
  const total = soma(comJuros, (r) => r.acrescimo);

  return {
    arquivo: `Juros e multa recebidos ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Juros e multa recebidos', total, true),
      quantidade('Recebimentos com juros', comJuros.length),
    ],
    avisos: [],
    abas: [
      {
        nome: 'Juros e multa',
        cabecalho: [
          ...cabecalhoDoPeriodo('Juros e multa cobrados de clientes que pagaram atrasado', de, ate, dados.lidoEm),
          'É o acréscimo de cada recebimento no IXC: juros e multa juntos, como o IXC os guarda.',
        ],
        colunas: [
          { titulo: 'Recebido em', tipo: 'data' },
          { titulo: 'Cliente', tipo: 'texto', largura: 38 },
          { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 20 },
          { titulo: 'Título', tipo: 'inteiro' },
          { titulo: 'Vencimento', tipo: 'data' },
          { titulo: 'Dias de atraso', tipo: 'inteiro', largura: 13 },
          { titulo: 'Valor do título', tipo: 'moeda' },
          { titulo: 'Juros e multa', tipo: 'moeda' },
          { titulo: 'Desconto', tipo: 'moeda' },
          { titulo: 'Recebido', tipo: 'moeda' },
          { titulo: 'Conta', tipo: 'texto', largura: 26 },
        ],
        linhas: comJuros.map((r) => {
          const titulo = dados.titulos.get(r.tituloId);
          const cliente = titulo ? idDoIxc(titulo.id_cliente) : null;
          const vencimento = titulo ? diaDoIxc(titulo.data_vencimento) : null;
          return [
            r.dia,
            nomeDoCliente(cad, cliente),
            documentoDoCliente(cad, cliente),
            r.tituloId,
            vencimento,
            vencimento ? Math.max(0, diasEntre(vencimento, r.dia)) : null,
            r.credito,
            r.acrescimo,
            r.desconto,
            r.liquido,
            nomeDaConta(cad, r.contaId),
          ];
        }),
        totais: [
          'Total',
          '',
          '',
          comJuros.length,
          null,
          null,
          soma(comJuros, (r) => r.credito),
          total,
          soma(comJuros, (r) => r.desconto),
          soma(comJuros, (r) => r.liquido),
          '',
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 16 — O que entrou pela maquininha
// ---------------------------------------------------------------------------

export interface DadosDasVendasNoCartao {
  de: string;
  ate: string;
  /** As contas da maquininha (PagSeguro…), pelo papel escolhido. */
  contas: number[];
  recebimentos: Recebimento[];
  titulos: Map<number, Record<string, unknown>>;
  cadastros: Cadastros;
  lidoEm: Date;
}

export function relatorioDeVendasNoCartao(dados: DadosDasVendasNoCartao): Relatorio {
  const { de, ate, cadastros: cad } = dados;
  const daMaquininha = dados.recebimentos
    .filter((r) => r.contaId !== null && dados.contas.includes(r.contaId))
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.id - b.id);

  return {
    arquivo: `Recebido por cartao no IXC ${diaBr(de).replace(/\//g, '-')} a ${diaBr(ate).replace(/\//g, '-')}`,
    resumo: [
      moeda('Recebido por cartão (IXC)', soma(daMaquininha, (r) => r.liquido), true),
      quantidade('Recebimentos', daMaquininha.length),
    ],
    avisos: [],
    abas: [
      {
        nome: 'Recebido por cartão',
        cabecalho: [
          ...cabecalhoDoPeriodo('Recebimentos lançados nas contas de cartão do IXC', de, ate, dados.lidoEm),
          'As taxas e o valor a receber de cada venda estão no relatório da operadora, junto desta planilha.',
        ],
        colunas: [
          { titulo: 'Data', tipo: 'data' },
          { titulo: 'Conta', tipo: 'texto', largura: 22 },
          { titulo: 'Cliente', tipo: 'texto', largura: 38 },
          { titulo: 'Título', tipo: 'inteiro' },
          { titulo: 'Valor do título', tipo: 'moeda' },
          { titulo: 'Juros e multa', tipo: 'moeda' },
          { titulo: 'Desconto', tipo: 'moeda' },
          { titulo: 'Recebido', tipo: 'moeda' },
        ],
        linhas: daMaquininha.map((r) => {
          const titulo = dados.titulos.get(r.tituloId);
          return [
            r.dia,
            nomeDaConta(cad, r.contaId),
            nomeDoCliente(cad, titulo ? idDoIxc(titulo.id_cliente) : null),
            r.tituloId,
            r.credito,
            r.acrescimo,
            r.desconto,
            r.liquido,
          ];
        }),
        totais: [
          'Total',
          '',
          '',
          daMaquininha.length,
          soma(daMaquininha, (r) => r.credito),
          soma(daMaquininha, (r) => r.acrescimo),
          soma(daMaquininha, (r) => r.desconto),
          soma(daMaquininha, (r) => r.liquido),
        ],
      },
    ],
  };
}
