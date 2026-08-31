/**
 * Leitura do que a empresa **já pagou** (`fn_apagar` baixado no IXC).
 *
 * É a outra metade da tela de contas em aberto, e sai da mesma tabela: no IXC
 * um título não muda de lugar quando é pago, ele ganha a baixa. Por isso o que
 * decide "isto é um pagamento" são as mesmas colunas que decidem "isto não é
 * mais dívida" — a lista vem importada de `contas-abertas.mapper`, não copiada.
 * É o que garante que um título esteja sempre em exatamente uma das duas telas:
 * com listas separadas, uma conta baixada por coluna conhecida só de um lado
 * sumiria das duas, e ninguém procura o que não aparece em lugar nenhum.
 *
 * Aqui a pergunta é diferente da outra tela, e isso muda o que se mostra. Lá se
 * pergunta "quanto falta pagar"; aqui, "isto saiu mesmo, no dia certo, pelo
 * valor certo?" — então o que importa é a data da baixa, quanto saiu do caixa
 * (com juros e multa, que a dívida não previa), de que conta saiu, e se o
 * registro do IXC fecha ou tem algo torto.
 */

import {
  lerStatusAuditoria,
  type StatusAuditoriaIxc,
} from '../ixc/ixc.financeiro';
import { parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import type { BaixaNoIxc } from './baixas-do-ixc.mapper';
import {
  campoDeBaixa,
  campoDeCancelamento,
  primeiraData,
  primeiroTexto,
  statusDizPago,
  temValorDeVerdade,
  type OrigemNaFolha,
} from './contas-abertas.mapper';

/** Um pagamento já feito, como esta casa o lê. */
export interface PagamentoFeito {
  idFnApagar: number;
  documento: string | null;
  fornecedor: { id: number | null; nome: string };
  /** Valor do título, como ele foi lançado */
  valor: number;
  /** Quanto saiu do caixa — com juros e multa, pode passar do valor do título */
  valorPago: number;
  /** O que ainda falta deste título: acima de zero = pagamento parcial */
  valorAberto: number;
  /** Pagou parte e o título continua devendo o resto */
  parcial: boolean;
  juros: number;
  multa: number;
  desconto: number;
  emissao: Date | null;
  vencimento: Date | null;
  /**
   * O dia em que o dinheiro saiu.
   *
   * Vem da baixa quando ela pôde ser lida — é o dia que alguém informou ao
   * baixar o título, o mesmo que a aba "Pagamentos" do IXC mostra. Sem ela,
   * sobra o dia do título, que é o do registro da baixa. Ver `fonteDaData`.
   */
  pagoEm: Date;
  /**
   * O dia em que a baixa foi registrada no IXC (a coluna `campoDaBaixa` do
   * título). Ele é igual ao de cima quando se paga e se lança no mesmo dia, e
   * mais tarde quando se lança depois — que é o caso de quem paga pelo banco e
   * só então vem registrar.
   */
  registradoEm: Date;
  /**
   * De onde `pagoEm` saiu:
   *
   * - `debito` = a coluna do próprio título com o dia do débito, que é o dia
   *   informado na baixa (a tela do IXC a mostra como "Data pagamento");
   * - `baixa` = o dia informado na linha de baixa, quando ela pôde ser lida;
   * - `titulo` = o dia em que a baixa foi **registrada**, porque nenhum dos
   *   dois estava disponível. Só neste caso o dia é uma aproximação.
   *
   * A diferença é o que separa "pagou atrasado" de "lançou atrasado", e a tela
   * precisa poder dizer qual das duas está mostrando.
   */
  fonteDaData: 'debito' | 'baixa' | 'titulo';
  /**
   * A coluna do título de onde `pagoEm` saiu, quando saiu do título. Null
   * quando veio da linha de baixa — ali quem identifica é o `baixaNoIxc`.
   *
   * Está na ficha do pagamento de propósito: é assim que quem discorda do que
   * a tela mostra abre o título no IXC e compara coluna por coluna.
   */
  campoDoDia: string | null;
  /** O número da linha de baixa no IXC, quando ela foi lida */
  baixaNoIxc: number | null;
  /**
   * A coluna do IXC de onde a data da baixa saiu. Não é curiosidade técnica: é
   * por ela que se procura o título na tela do IXC, e é o que permite discordar
   * do que esta tela mostra sem ser palavra contra palavra.
   */
  campoDaBaixa: string;
  /**
   * Dias entre o vencimento e o pagamento. 0 = pagou no dia, positivo = pagou
   * atrasado, negativo = pagou adiantado. Null = o título não tem vencimento no
   * IXC, e aí não há como dizer se foi em dia.
   */
  diasDeAtraso: number | null;
  /** Como foi pago, no texto do IXC: Pix, Dinheiro, Boleto… */
  formaPagamento: string | null;
  /** A conta/caixa de onde o dinheiro saiu. O nome é completado depois. */
  caixa: { id: number | null; nome: string | null };
  /** Quem deu a baixa, quando a base guarda isso em texto */
  baixadoPor: string | null;
  observacao: string | null;
  statusAuditoria: StatusAuditoriaIxc | null;
  /** O `status` cru do título: "A" com baixa é o caso do status que ficou parado */
  statusNoIxc: string | null;
  /**
   * Se esse status é um dos que significam "pago" nesta base. Vem calculado da
   * API de propósito: qual código significa pago varia por instalação do IXC —
   * aqui é "F", não o "P" da documentação —, e uma segunda lista disso na tela
   * escreveria "baixado mesmo assim" em todo pagamento normal do IXC.
   */
  statusEhDePago: boolean;
  /** A conta de despesa do IXC. O nome é completado depois. */
  categoria: { id: number | null; nome: string | null };
  /**
   * A classificação desta casa — etiqueta nossa, o IXC não tem onde guardá-la.
   * `grupo` é a categoria de cima, quando ela é uma subcategoria.
   */
  classificacao: {
    id: string;
    nome: string;
    grupo: { id: string; nome: string } | null;
  } | null;
  /** Preenchido depois, cruzando com o que a folha lançou */
  origem: OrigemNaFolha | null;
  /** O que o registro do IXC confirma — e o que nele não fecha */
  conferencia: ConferenciaDoPagamento;
}

/**
 * A conferência do pagamento: o registro do IXC fecha, ou tem algo torto?
 *
 * É o motivo de a tela existir. "Já pagou" é fácil de mostrar e fácil de
 * acreditar; o que dá trabalho conferir é justamente o que não bate — o título
 * que foi baixado sem o valor, o que foi pago pela metade, o que saiu mesmo com
 * a auditoria reprovada. Sem isto, a lista de pagos convida a confiar em
 * duzentas linhas de uma vez sem que nada peça atenção.
 */
export interface ConferenciaDoPagamento {
  /** Nada a apontar: o IXC confirma o pagamento por inteiro e coerente. */
  fecha: boolean;
  /** O que chamou atenção, em português, para quem confere ler direto. */
  ressalvas: string[];
}

/** O apanhado do período — é o que responde "quanto saiu do caixa". */
export interface ResumoPagamentos {
  quantidade: number;
  /** Soma do que saiu do caixa */
  total: number;
  /** Pagos até o vencimento */
  emDia: FatiaDePagamentos;
  /** Pagos depois do vencimento */
  emAtraso: FatiaDePagamentos;
  /** Títulos sem vencimento no IXC: não entram em dia nem em atraso */
  semVencimento: FatiaDePagamentos;
  /** Pagamentos que não quitaram o título */
  parciais: FatiaDePagamentos;
  /** Com ressalva na conferência — é a fila de quem confere */
  comRessalva: FatiaDePagamentos;
  /** Juros e multa pagos: o preço do atraso, em dinheiro */
  jurosEMulta: number;
  /** Descontos obtidos */
  desconto: number;
}

export interface FatiaDePagamentos {
  quantidade: number;
  total: number;
}

/** Por que um título não conta como pagamento — e por qual campo se soube. */
export interface MotivoDeNaoSerPagamento {
  motivo: 'cancelado' | 'nao-pago' | 'sem-data';
  /** A coluna do IXC que decidiu. Serve para explicar a exclusão na tela. */
  campo: string;
}

/**
 * Se este registro é um pagamento feito — e, quando não é, por quê.
 *
 * Três perguntas, na ordem em que importam:
 *
 * 1. **foi cancelado?** Cancelamento vem antes de tudo, inclusive de uma baixa
 *    existente: título baixado e depois cancelado (o "Estornar" da tela do IXC)
 *    não é dinheiro que saiu, e contá-lo aqui inventaria uma despesa. Contar um
 *    pagamento que não houve é o único erro que esta tela não pode cometer.
 * 2. **tem baixa?** A data da baixa é o que o próprio IXC usa para chamar o
 *    título de "Pago em dia" na tela dele. Ela manda mais que o `status`, que
 *    nesta base fica parado em "A" mesmo em título já pago — foi esse status
 *    preso que fez quatro títulos de 2023 aparecerem como vencidos.
 * 3. **dá para dizer quando?** Status de pago sem data de baixa nenhuma é
 *    pagamento sem dia. Ele não pode ser posto numa linha do tempo, então fica
 *    de fora do período — mas sai contado num aviso, nunca engolido em silêncio:
 *    some da lista de abertas por estar pago e sumiria daqui por não ter data.
 */
export function motivoDeNaoSerPagamento(
  raw: Record<string, unknown>,
): MotivoDeNaoSerPagamento | null {
  const status = String(raw.status ?? '').trim().toUpperCase();

  if (status === 'C') return { motivo: 'cancelado', campo: 'status' };
  const cancelamento = campoDeCancelamento(raw);
  if (cancelamento) return { motivo: 'cancelado', campo: cancelamento };

  const baixa = campoDeBaixa(raw);
  if (baixa) return null;

  if (statusDizPago(raw)) return { motivo: 'sem-data', campo: 'status' };
  return { motivo: 'nao-pago', campo: 'status' };
}

/**
 * Um registro cru do `fn_apagar` já baixado, na forma que a tela usa.
 *
 * Devolve null para o que não é pagamento — quem chama já sabe o motivo pelo
 * `motivoDeNaoSerPagamento` e o conta no lugar certo.
 */
export function mapPagamento(
  raw: Record<string, unknown>,
): PagamentoFeito | null {
  const idFnApagar = parseIxcId(raw.id);
  if (idFnApagar === null) return null;
  if (motivoDeNaoSerPagamento(raw) !== null) return null;

  const campoDaBaixa = campoDeBaixa(raw)!;
  const registradoEm = primeiraData(raw, [campoDaBaixa]);
  // A coluna tem conteúdo (foi ela que decidiu que há baixa), mas num formato
  // que não é data — "pago" gravado no lugar do dia, por exemplo. Sem dia não
  // dá para pôr o pagamento numa linha do tempo.
  if (!registradoEm) return null;

  /*
   * O dia em que o dinheiro saiu está no próprio título.
   *
   * `data_pagamento` guarda o dia em que a **baixa foi registrada** — a tela do
   * IXC a mostra como "Data/hora baixa", com hora e tudo. O dia que alguém
   * informou ao baixar fica em `debito_data`, que é o que aquela tela mostra na
   * coluna "Data pagamento". No título 37037 desta base: baixa registrada em
   * 18/08/2026 15:48, débito em 10/08/2026 — e era o 18 que chegava aqui,
   * fazendo a tela dizer "pago 8 dias depois" de uma conta paga no vencimento.
   *
   * Vindo do título, não custa consulta nenhuma e não depende de achar a linha
   * de baixa (que nem toda base devolve pelo webservice).
   */
  const campoDoDebito = campoDoDiaDoDebito(raw);
  const doDebito = campoDoDebito ? primeiraData(raw, [campoDoDebito]) : null;
  const pagoEm = doDebito ?? registradoEm;

  const vencimento = primeiraData(raw, [
    'data_vencimento',
    'data_venc',
    'vencimento',
    'data_vencimento_original',
  ]);

  const valor = parseIxcDecimal(raw.valor ?? raw.valor_documento);
  const valorAberto = parseIxcDecimal(raw.valor_aberto);
  const valorPago = quantoSaiu(raw, valor, valorAberto);
  const juros = primeiroValor(raw, ['valor_juros', 'juros']);
  const multa = primeiroValor(raw, ['valor_multa', 'multa']);
  const desconto = descontoDoTitulo(raw);
  const status = String(raw.status ?? '').trim().toUpperCase() || null;
  const parcial = valorAberto > 0.005;

  return {
    idFnApagar,
    documento: primeiroTexto(raw, [
      'documento',
      'num_documento',
      'numero_documento',
      'nosso_numero',
    ]),
    fornecedor: {
      id: parseIxcId(raw.id_fornecedor ?? raw.fornecedor_id),
      nome:
        primeiroTexto(raw, [
          'fornecedor',
          'razao',
          'nome_fornecedor',
          'fornecedor_razao',
          'razao_social',
        ]) ?? '',
    },
    valor,
    valorPago,
    valorAberto,
    parcial,
    juros,
    multa,
    desconto,
    emissao: primeiraData(raw, ['data_emissao', 'data', 'emissao']),
    vencimento,
    // Sem o dia do débito, o que o título sabe é quando a baixa foi registrada.
    // Enquanto a linha de baixa não corrigir isto (`aplicarBaixa`), o dia do
    // pagamento é esse — e a tela diz de onde ele veio, em vez de deixar
    // parecer que é o dia do dinheiro.
    pagoEm,
    registradoEm,
    fonteDaData: doDebito ? 'debito' : 'titulo',
    baixaNoIxc: null,
    campoDaBaixa,
    // A coluna que deu o dia, e não a que foi consultada: `debito_data` com
    // conteúdo ilegível não pode aparecer na ficha como se tivesse respondido.
    campoDoDia: doDebito ? campoDoDebito : campoDaBaixa,
    diasDeAtraso: vencimento === null ? null : diasEntre(vencimento, pagoEm),
    formaPagamento: primeiroTexto(raw, [
      'tipo_pagamento',
      'forma_pagamento',
      'tipo_documento',
    ]),
    caixa: {
      id: parseIxcId(raw.id_contas ?? raw.id_conta_pagamento ?? raw.id_caixa),
      nome: nomeDeVerdade(raw, ['conta_pagamento', 'nome_conta_pagamento']),
    },
    baixadoPor: nomeDeQuemBaixou(raw),
    observacao: primeiroTexto(raw, ['obs', 'observacao', 'historico']),
    statusAuditoria: lerStatusAuditoria(raw),
    statusNoIxc: status,
    statusEhDePago: statusDizPago(raw),
    categoria: {
      id: parseIxcId(raw.id_conta ?? raw.id_conta_despesa ?? raw.conta_despesa),
      nome: primeiroTexto(raw, [
        'conta_despesa_nome',
        'descricao_conta',
        'nome_conta',
        'plano_conta',
        'classificacao',
      ]),
    },
    classificacao: null,
    origem: null,
    conferencia: conferir({
      status,
      statusDizPago: statusDizPago(raw),
      valor,
      valorPago,
      valorAberto,
      juros,
      multa,
      desconto,
      parcial,
      statusAuditoria: lerStatusAuditoria(raw),
      campoDaBaixa,
    }),
  };
}

/**
 * O nome da conta, quando a coluna traz nome — e não o código de novo.
 *
 * `fn_apagar.conta_pagamento` não é o rótulo que o nome promete: nesta base ela
 * repete o código da conta ("14"), e só vem preenchida nos títulos lançados pela
 * tela do IXC. Lida como nome, ela fazia a lista de pagos mostrar "14" numa
 * linha e "Conta Sicoob" na de baixo — a mesma conta com dois rostos, e o do
 * código escondendo o defeito de quem procurava por nome.
 *
 * Texto que é só dígito, então, não é nome: fica para o índice de contas
 * preencher, que é quem tem o nome de verdade.
 */
function nomeDeVerdade(
  raw: Record<string, unknown>,
  campos: string[],
): string | null {
  const texto = primeiroTexto(raw, campos);
  return texto && /\D/.test(texto) ? texto : null;
}

/**
 * As colunas do título com o dia do débito — o dia em que o dinheiro saiu.
 *
 * Lista fechada, como as de baixa e cancelamento: aqui um campo escolhido de
 * mais poria no pagamento uma data que não é a dele, e data errada num
 * pagamento que existe é o defeito mais caro desta tela.
 */
const CAMPOS_DO_DIA_DO_DEBITO = ['debito_data'] as const;

/** A coluna que traz o dia do débito, se alguma delas vier preenchida. */
function campoDoDiaDoDebito(raw: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_DO_DIA_DO_DEBITO) {
    if (temValorDeVerdade(raw[campo])) return campo;
  }
  return null;
}

/**
 * Põe no pagamento o dia que a baixa informa — o dia em que o dinheiro saiu.
 *
 * É a correção que dá nome a esta tela. O título guarda o dia em que a baixa foi
 * registrada, e quem paga o boleto pelo aplicativo do banco e só depois vem
 * lançar registra sempre depois: a conta paga no vencimento aparecia com um, com
 * cinco, com treze dias de atraso, conforme a demora do lançamento. O atraso que
 * interessa é o do pagamento, e quem sabe dele é a baixa.
 *
 * O atraso é recontado aqui de propósito, e não deixado para a tela: ele existe
 * em três lugares (o selo, o resumo do período e a exportação), e três contas da
 * mesma coisa é como duas delas passam a discordar.
 */
export function aplicarBaixa(
  pagamento: PagamentoFeito,
  baixa: BaixaNoIxc,
): void {
  pagamento.pagoEm = baixa.data;
  pagamento.fonteDaData = 'baixa';
  pagamento.baixaNoIxc = baixa.id;
  pagamento.campoDoDia = null;
  pagamento.diasDeAtraso =
    pagamento.vencimento === null
      ? null
      : diasEntre(pagamento.vencimento, baixa.data);
}

/**
 * Quanto saiu do caixa.
 *
 * A coluna explícita manda, quando existe — o IXC guarda o pago em mais de um
 * nome, e "baixado" é o nome que a tela dele usa. Sem nenhuma delas, o que se
 * sabe é aritmética: o título menos o que ainda falta. Sem nem isso, o título
 * inteiro, que é o caso normal do pagamento integral numa listagem que não
 * devolve as colunas de valor pago.
 */
function quantoSaiu(
  raw: Record<string, unknown>,
  valor: number,
  valorAberto: number,
): number {
  const declarado = Math.max(
    parseIxcDecimal(raw.valor_total_pago),
    parseIxcDecimal(raw.valor_pago),
    parseIxcDecimal(raw.valor_baixado),
  );
  if (declarado > 0) return declarado;
  if (valorAberto > 0.005) return arredondar(Math.max(0, valor - valorAberto));
  return valor;
}

/**
 * A conferência propriamente dita: o que o registro do IXC deixa em pé e o que
 * nele pede uma olhada na tela do IXC. Cada ressalva aponta o campo de onde
 * saiu — quem confere precisa saber onde ir olhar, não só que algo está torto.
 */
function conferir(p: {
  status: string | null;
  statusDizPago: boolean;
  valor: number;
  valorPago: number;
  valorAberto: number;
  juros: number;
  multa: number;
  desconto: number;
  parcial: boolean;
  statusAuditoria: StatusAuditoriaIxc | null;
  campoDaBaixa: string;
}): ConferenciaDoPagamento {
  const ressalvas: string[] = [];

  /*
   * O status é comparado com a lista de status de pago desta base, não com o
   * "P" da documentação. Não é detalhe: aqui o pago é "F", e comparar com "P"
   * poria esta ressalva em **todos** os 34 mil títulos pagos — uma tela de
   * conferência que reclama de tudo não faz ninguém conferir nada.
   */
  if (!p.statusDizPago) {
    ressalvas.push(
      `O IXC baixou o título (${p.campoDaBaixa}) mas deixou o status em ` +
        `"${p.status ?? 'vazio'}", que não é um status de conta paga. Na tela ` +
        'do IXC ele aparece como pago; é o status que ficou parado, não o ' +
        'pagamento que falta.',
    );
  }

  if (p.parcial) {
    ressalvas.push(
      `Pagamento parcial: saiu ${moeda(p.valorPago)} e o título continua ` +
        `devendo ${moeda(p.valorAberto)} — ele segue na lista de contas em aberto.`,
    );
  }

  if (p.valorPago <= 0.005) {
    ressalvas.push(
      'O IXC não informa quanto saiu neste título — só a data da baixa. O ' +
        'valor mostrado aqui é o do título, não uma confirmação do que foi pago.',
    );
  }

  // Juros e multa explicam pagar mais que o título; desconto, pagar menos.
  const esperadoMaximo = arredondar(p.valor + p.juros + p.multa);
  if (p.valorPago > esperadoMaximo + 0.005) {
    ressalvas.push(
      `Saiu ${moeda(p.valorPago)} para um título de ${moeda(p.valor)}` +
        (p.juros + p.multa > 0
          ? ` mais ${moeda(p.juros + p.multa)} de juros e multa`
          : ' sem juros nem multa registrados') +
        ' — a diferença não está explicada no registro.',
    );
  }

  if (p.statusAuditoria === 'R') {
    ressalvas.push(
      'A auditoria deste título está como reprovada no IXC, e mesmo assim ele ' +
        'foi baixado.',
    );
  }

  return { fecha: ressalvas.length === 0, ressalvas };
}

/**
 * Quem deu a baixa, quando a base guarda isso em texto.
 *
 * Código de operador sozinho não entra: "baixado por 42" não confirma nada a
 * quem confere, e a tabela de operadores do IXC não está na documentação do
 * webservice. Sem nome, o campo fica vazio e a ficha do pagamento mostra o
 * registro cru para quem quiser cavar.
 */
function nomeDeQuemBaixou(raw: Record<string, unknown>): string | null {
  const candidatos = [
    'operador_baixa',
    'usuario_baixa',
    'login_baixa',
    'operador',
    'usuario',
  ];
  for (const campo of candidatos) {
    const s = String(raw[campo] ?? '').trim();
    if (!s || !temValorDeVerdade(s)) continue;
    if (/^\d+$/.test(s)) continue;
    return s;
  }
  return null;
}

/** O apanhado do período, na leitura de quem confere pagamento. */
export function resumirPagamentos(
  pagamentos: PagamentoFeito[],
): ResumoPagamentos {
  const vazio = (): FatiaDePagamentos => ({ quantidade: 0, total: 0 });
  const resumo: ResumoPagamentos = {
    quantidade: pagamentos.length,
    total: 0,
    emDia: vazio(),
    emAtraso: vazio(),
    semVencimento: vazio(),
    parciais: vazio(),
    comRessalva: vazio(),
    jurosEMulta: 0,
    desconto: 0,
  };

  for (const p of pagamentos) {
    resumo.total = arredondar(resumo.total + p.valorPago);
    resumo.jurosEMulta = arredondar(resumo.jurosEMulta + p.juros + p.multa);
    resumo.desconto = arredondar(resumo.desconto + p.desconto);

    const fatia =
      p.diasDeAtraso === null
        ? resumo.semVencimento
        : p.diasDeAtraso > 0
          ? resumo.emAtraso
          : resumo.emDia;
    somar(fatia, p.valorPago);

    if (p.parcial) somar(resumo.parciais, p.valorPago);
    if (!p.conferencia.fecha) somar(resumo.comRessalva, p.valorPago);
  }

  return resumo;
}

function somar(fatia: FatiaDePagamentos, valor: number): void {
  fatia.quantidade += 1;
  fatia.total = arredondar(fatia.total + valor);
}

/**
 * A ordem do histórico: o pagamento mais recente no topo.
 *
 * É o contrário da lista de contas em aberto, e de propósito — lá a ordem serve
 * para decidir o que pagar antes; aqui, para achar o que acabou de sair. Quem
 * abre esta tela quase sempre quer conferir o pagamento de hoje.
 */
export function ordenarPorPagamento(
  pagamentos: PagamentoFeito[],
): PagamentoFeito[] {
  return [...pagamentos].sort((a, b) => {
    const dia = b.pagoEm.getTime() - a.pagoEm.getTime();
    if (dia !== 0) return dia;
    // Mesmo dia: o valor maior primeiro, que é o que pesa no caixa.
    return b.valorPago - a.valorPago;
  });
}

/**
 * Dias inteiros entre duas datas, contados por dia civil. Zerado nos dois lados
 * de propósito: pelo instante, um título pago no dia do vencimento apareceria
 * como pago em atraso a partir da hora do almoço.
 */
function diasEntre(de: Date, ate: Date): number {
  const a = Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate());
  const b = Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

/** O primeiro dos nomes conhecidos que tiver valor. */
/**
 * O desconto que o título registra — o abatimento de quem pagou adiantado.
 *
 * Mora aqui, e não solto em cada tela, porque duas leituras diferentes dele
 * fariam a economia do painel discordar da economia do histórico, que saem da
 * mesma coluna do mesmo título. O nome da coluna varia entre instalações do
 * IXC; a lista é a mesma de sempre, fechada, para não sair somando qualquer
 * campo com "desconto" no nome.
 */
export function descontoDoTitulo(raw: Record<string, unknown>): number {
  return primeiroValor(raw, ['valor_desconto', 'desconto']);
}

function primeiroValor(raw: Record<string, unknown>, campos: string[]): number {
  for (const campo of campos) {
    const n = parseIxcDecimal(raw[campo]);
    if (n !== 0) return n;
  }
  return 0;
}

function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
