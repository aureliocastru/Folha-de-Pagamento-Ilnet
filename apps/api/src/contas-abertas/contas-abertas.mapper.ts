/**
 * Leitura das contas a pagar em aberto do IXC (`fn_apagar`).
 *
 * Aqui não se cria nem se altera nada: é a empresa vista de fora, do jeito que
 * o IXC a guarda. O que a folha lançou está no meio — é dinheiro que a empresa
 * deve igual ao resto —, e sai marcado para quem olha saber de onde veio.
 *
 * O nome das colunas do `fn_apagar` muda de uma versão do IXC para outra, e a
 * documentação do webservice não fecha a lista. Por isso cada campo é procurado
 * por vários nomes conhecidos em vez de um só: errar o nome de uma coluna aqui
 * significaria mostrar uma conta sem vencimento, ou pior, sem valor.
 */

import { parseIxcDate, parseIxcDecimal, parseIxcId } from '../ixc/ixc.parse';
import { lerStatusAuditoria, type StatusAuditoriaIxc } from '../ixc/ixc.financeiro';

/** "29 de 36" escrito num título — a numeração que veio pronta do IXC. */
export interface MarcacaoDeParcela {
  posicao: number;
  total: number;
  fonte: 'nota' | 'observacao';
}

/**
 * O teto do total de parcelas que uma marcação pode declarar.
 *
 * Serve para não ler como parcela o que não é: "123/2024" num campo de número
 * de nota é nota com série, não parcela 123 de 2024. Trezentos e sessenta são
 * trinta anos de parcela mensal — acima disso é outra coisa.
 */
const TETO_DE_PARCELAS_MARCADAS = 360;

/**
 * A numeração escrita no título, se houver alguma.
 *
 * Dois lugares, nesta ordem:
 *
 * 1. **Número da nota** (`numero_nota`), onde o financiamento e o consórcio
 *    já vinham numerados de antes deste app existir — é lá que está o "29/36"
 *    da parcela da Hilux;
 * 2. **observação**, no "(3/6)" que esta casa escreve ao lançar uma nota
 *    parcelada.
 *
 * O que está escrito ganha do que se deduz, sempre: a dedução compara
 * fornecedor e valor porque não tem nada melhor, e aqui tem.
 */
export function marcacaoDeParcela(
  raw: Record<string, unknown>,
): MarcacaoDeParcela | null {
  const nota = lerNumeroDeParcela(String(raw.numero_nota ?? ''), /^(\d{1,4})\s*\/\s*(\d{1,4})$/);
  if (nota) return { ...nota, fonte: 'nota' };

  // Na observação a marca vem entre parênteses e no fim do texto ("Cabo UTP
  // (3/6)"): sem os parênteses, um "1/2" solto no meio de uma descrição de
  // material viraria parcela.
  const obs = String(raw.obs ?? raw.observacao ?? '');
  const emParenteses = /\((\d{1,4})\s*\/\s*(\d{1,4})\)/g;
  let ultima: { posicao: number; total: number } | null = null;
  for (const achado of obs.matchAll(emParenteses)) {
    const lido = lerNumeroDeParcela(`${achado[1]}/${achado[2]}`, /^(\d{1,4})\/(\d{1,4})$/);
    if (lido) ultima = lido;
  }
  return ultima ? { ...ultima, fonte: 'observacao' } : null;
}

function lerNumeroDeParcela(
  texto: string,
  formato: RegExp,
): { posicao: number; total: number } | null {
  const m = formato.exec(texto.trim());
  if (!m) return null;

  const posicao = Number(m[1]);
  const total = Number(m[2]);
  // "0/6" e "7/6" não são parcela de nada; "1/1" é compra à vista escrita de
  // um jeito esquisito, e não uma sequência.
  if (posicao < 1 || total < 2 || posicao > total) return null;
  if (total > TETO_DE_PARCELAS_MARCADAS) return null;
  return { posicao, total };
}

/** Uma conta a pagar em aberto, como esta casa a lê. */
export interface ContaAberta {
  idFnApagar: number;
  /** Número do documento/nota, quando existe */
  documento: string | null;
  fornecedor: { id: number | null; nome: string };
  /** Valor do título */
  valor: number;
  /** O que falta pagar dele (pagamento parcial deixa os dois diferentes) */
  valorAberto: number;
  emissao: Date | null;
  vencimento: Date | null;
  /**
   * Dias até vencer. Negativo = venceu há tantos dias; null = a conta não tem
   * vencimento no IXC, e aí não há como dizer se está atrasada.
   */
  diasParaVencer: number | null;
  vencida: boolean;
  observacao: string | null;
  /**
   * A parcela que este título é, quando ela está escrita nele: "29/36" no
   * número da nota, ou "(3/6)" na observação.
   *
   * Sai do próprio título, e não da contagem por fornecedor e valor: aqui não
   * há palpite nenhum — é o que alguém escreveu ao lançar. É também o único
   * caminho que funciona para quem tem muitos títulos: no banco da empresa a
   * contagem por fornecedor lê os primeiros seiscentos e não alcança os do ano
   * que vem, e era por isso que a parcela do financiamento não aparecia em
   * lugar nenhum.
   *
   * Null quando não há nada escrito — aí quem responde de que compra o título
   * faz parte é a contagem por fornecedor e valor.
   */
  parcela: MarcacaoDeParcela | null;
  statusAuditoria: StatusAuditoriaIxc | null;
  /**
   * A conta de despesa do IXC — terreno, veículo, equipamento, energia. É o
   * que responde "com o que a empresa está devendo", e não só "para quem".
   * O nome pode vir vazio quando o registro só traz o código.
   */
  categoria: { id: number | null; nome: string | null };
  /**
   * A que se refere o débito, na classificação desta casa — "mão de obra",
   * "compra de veículos". É o eixo dos relatórios, e é etiqueta nossa: o IXC
   * não tem onde guardar isso. Null = ninguém classificou ainda.
   *
   * `grupo` é a categoria de cima, quando a etiqueta é uma subcategoria: o
   * dashboard soma por ele ("Veículos") e destrincha pela etiqueta ("Compra",
   * "Manutenção"). Null quando a categoria não está dentro de nenhuma.
   */
  classificacao: {
    id: string;
    nome: string;
    grupo: { id: string; nome: string } | null;
  } | null;
  /** Preenchido depois, cruzando com o que a folha lançou */
  origem: OrigemNaFolha | null;
}

/** De onde a conta veio, quando quem a criou foi esta aplicação. */
export interface OrigemNaFolha {
  /** SALARIO, ADIANTAMENTO, BONUS, DIARIA, AVULSO… */
  tipo: string;
  /** Id da conta na tabela daqui, para poder abrir a tela dela */
  contaId: string;
  /** Nome de quem recebe, como está no cadastro daqui */
  beneficiario: string | null;
}

/** O apanhado da lista: é o que responde "quanto a empresa deve". */
export interface ResumoContasAbertas {
  quantidade: number;
  total: number;
  vencidas: FatiaDoResumo;
  venceEmSeteDias: FatiaDoResumo;
  demais: FatiaDoResumo;
  /** Contas sem data de vencimento no IXC — ficam de fora das três fatias */
  semVencimento: FatiaDoResumo;
}

export interface FatiaDoResumo {
  quantidade: number;
  total: number;
}

/**
 * O que ainda é dívida.
 *
 * `fn_apagar.status` diz A = aberto, P = pago, C = cancelado — mas ele sozinho
 * não basta, e isso custou caro: a primeira versão desta tela mostrava quatro
 * títulos de 2023 como vencidos que a própria tela do IXC não listava. Eles
 * têm `status = A` e mesmo assim não são devidos.
 *
 * Então são três perguntas, não uma:
 *
 * 1. o status diz que acabou (pago ou cancelado)?
 * 2. sobrou alguma coisa para pagar? Título baixado por inteiro está quitado,
 *    mesmo com o status parado em "A" — e a baixa pode estar em `valor_baixado`
 *    em vez de `valor_pago`, que era o único que se olhava antes;
 * 3. há marca de cancelamento no registro? O IXC guarda o cancelamento em
 *    campo próprio (é o que o botão "Estornar cancelamento" desfaz), e uma
 *    conta cancelada não é dívida ainda que continue com saldo em aberto.
 *
 * O filtro também é pedido ao IXC, mas é conferido de novo aqui: base que
 * ignore um `qtype` que não conhece devolve a tabela inteira, e uma tela de
 * contas em aberto cheia de conta paga mente sobre quanto a empresa deve.
 */
export function estaEmAberto(raw: Record<string, unknown>): boolean {
  return motivoDeNaoEstarAberto(raw) === null;
}

/** Por que um título não entra na lista — e por qual campo se soube disso. */
export interface MotivoDeExclusao {
  motivo: 'pago' | 'cancelado' | 'quitado' | 'nao-liberado';
  /** A coluna do IXC que decidiu. Serve para explicar a exclusão na tela. */
  campo: string;
}

/**
 * As colunas que marcam uma conta cancelada.
 *
 * A lista é fechada de propósito, e isso custou uma quebra para aprender: a
 * primeira versão aceitava **qualquer** coluna com "cancel" no nome, e o
 * `fn_apagar` tem colunas de configuração que falam de cancelamento sem
 * cancelar nada. O resultado foi a lista despencar de 532 títulos para 65 —
 * quatrocentas e tantas dívidas de verdade sumiram da tela de uma vez.
 *
 * Nome novo só entra aqui depois de alguém ver o registro cru e confirmar que
 * aquela coluna significa mesmo "esta conta foi cancelada".
 */
const CAMPOS_DE_CANCELAMENTO = [
  'data_cancelamento',
  'data_hora_cancelamento',
  'dt_cancelamento',
  'cancelado',
  'cancelada',
  'status_cancelamento',
] as const;

/**
 * A resposta detalhada do `estaEmAberto`: `null` quando a conta é devida, e o
 * motivo com o nome do campo quando não é. O campo não é curiosidade — é o que
 * deixa a tela dizer "467 títulos ficaram de fora pela coluna tal", que é como
 * um filtro errado se denuncia em vez de sumir com a dívida em silêncio.
 */
export function motivoDeNaoEstarAberto(
  raw: Record<string, unknown>,
): MotivoDeExclusao | null {
  const status = String(raw.status ?? '').trim().toUpperCase();
  if (status === 'P') return { motivo: 'pago', campo: 'status' };
  if (status === 'C') return { motivo: 'cancelado', campo: 'status' };

  const cancelamento = campoDeCancelamento(raw);
  if (cancelamento) return { motivo: 'cancelado', campo: cancelamento };

  /*
   * Título que existe mas nunca foi liberado.
   *
   * É o caso dos quatro que apareciam vencidos desde 2023 sem estar na tela do
   * IXC. O registro deles conta a história: `liberado = N`, `id_entrada`
   * apontando para uma nota de entrada, `id_conta` e `id_contas` em zero — ou
   * seja, sem conta contábil e sem conta de pagamento. São os títulos que a
   * entrada da nota criou e que ninguém liberou; a compra foi refeita e os
   * títulos bons, esses sim pagos, ficaram com outro código.
   *
   * Pelos campos de dinheiro eles estão abertos mesmo (valor_aberto cheio,
   * nada pago), e é por isso que as tentativas anteriores não os pegavam: não
   * é uma questão de pagamento, é de o título nunca ter entrado no fluxo.
   *
   * Só o "N" explícito exclui. Coluna ausente ou vazia não vira exclusão —
   * base que não tenha esse controle não pode perder as contas dela por causa
   * de um campo que não existe lá.
   */
  if (String(raw.liberado ?? '').trim().toUpperCase() === 'N') {
    return { motivo: 'nao-liberado', campo: 'liberado' };
  }

  /*
   * `previsao = S` **não** exclui, e isto aqui é para não ser tentado de novo.
   *
   * A tela de contas a pagar do IXC não mostra esses títulos, e por um dia
   * pareceu que a lista daqui estava inflada por eles: gasto planejado, não
   * dívida. Estava errado — nesta empresa a marca de previsão está em contas
   * com boleto que vence e precisa ser paga. Elas são a fila de pagamento
   * mesmo, e filtrá-las escondeu contas devidas.
   *
   * A pergunta "está aqui e não está lá" continua valendo; a resposta é olhar,
   * pela ficha, e não presumir pela coluna. Ver `explicarFiltro`, que mostra
   * `previsao` com o que veio do IXC.
   */
  /*
   * O saldo declarado pelo IXC manda em tudo que vem depois.
   *
   * Título com saldo é devido, ponto — inclusive o de pagamento parcial, que
   * o IXC lista como "Parcial vencido" e que tem data de baixa mesmo estando
   * em aberto. Por isso a data de baixa só é olhada quando não há saldo: se
   * fosse olhada antes, todo pagamento parcial sumiria da lista.
   */
  if (parseIxcDecimal(raw.valor_aberto) > 0.001) return null;

  /*
   * Sem saldo declarado, quem responde é a baixa.
   *
   * Foi isto que deixou passar os títulos que apareciam vencidos desde 2023:
   * eles estão pagos no IXC — com "Valor baixado", "Data/hora baixa" e "Data
   * pagamento" preenchidos —, mas o `status` deles nunca saiu de "A", então
   * a consulta por status os trazia. E a conferência por valor não os pegava
   * porque a listagem do webservice não devolve as colunas de valor pago: sem
   * elas, "valor menos o que já foi pago" dava o título inteiro em aberto.
   *
   * A data de baixa é o que o próprio IXC usa para chamar esses títulos de
   * "Pago em dia" na tela dele. Ela existe ou não existe — não depende de
   * coluna de valor nenhuma.
   */
  const baixa = campoDeBaixa(raw);
  if (baixa) return { motivo: 'pago', campo: baixa };

  // Sem saldo, sem baixa: sobra a conta de valor menos o que já saiu.
  if (valorEmAberto(raw) <= 0.001) {
    return { motivo: 'quitado', campo: 'valor' };
  }
  return null;
}

/**
 * Os valores de `fn_apagar.status` que significam "esta conta foi paga".
 *
 * "F" vem primeiro porque é o desta base: são 34 mil títulos com ele, e "P" não
 * aparece em nenhum — foi procurar só por "P" que fazia o painel dizer "R$ 0,00
 * pago neste mês" com o mês inteiro já pago. "P" fica na lista porque é o código
 * documentado e outras instalações do IXC o usam.
 *
 * Um título não tem dois status, então consultar os dois nunca conta duas vezes.
 */
export const STATUS_DE_PAGO = ['F', 'P'] as const;

/** Se o `status` cru do IXC é um dos que dizem "pago". */
export function statusDizPago(raw: Record<string, unknown>): boolean {
  const status = String(raw.status ?? '').trim().toUpperCase();
  return (STATUS_DE_PAGO as readonly string[]).includes(status);
}

/**
 * As colunas que marcam um título como baixado (quitado) no IXC.
 *
 * Lista fechada pelo mesmo motivo da de cancelamento: uma regra larga demais
 * já apagou quatrocentos títulos de dívida real da tela de uma vez.
 */
export const CAMPOS_DE_BAIXA = [
  'data_pagamento',
  'data_baixa',
  'data_hora_baixa',
  'dt_baixa',
] as const;

/** A coluna que diz que este título já foi baixado, se houver. */
export function campoDeBaixa(raw: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_DE_BAIXA) {
    if (temValorDeVerdade(raw[campo])) return campo;
  }
  return null;
}

/**
 * A conta explicada: o que a regra olhou, o que encontrou em cada campo, e a
 * que conclusão chegou.
 *
 * Serve à pergunta que ninguém conseguia responder olhando a tela — "por que
 * esta conta aparece aqui?". Sem isto, discordar do filtro é palavra contra
 * palavra; com isto, é só ler os valores e ver qual campo está sendo lido
 * diferente do que o IXC entende.
 */
export interface AvaliacaoDoFiltro {
  aberta: boolean;
  motivo: MotivoDeExclusao | null;
  /** Os campos que decidem, com o valor que veio do IXC. */
  olhou: Array<{ campo: string; valor: string; nota: string }>;
}

export function explicarFiltro(
  raw: Record<string, unknown>,
): AvaliacaoDoFiltro {
  const motivo = motivoDeNaoEstarAberto(raw);
  const texto = (campo: string) => String(raw[campo] ?? '').trim();

  const olhou = [
    {
      campo: 'status',
      valor: texto('status') || '(vazio)',
      // "F" vem escrito porque é o código de pago desta base — quem lê a ficha
      // precisa reconhecer o que está vendo no campo, e "P = pago" sozinho fazia
      // um título pago parecer estar num status desconhecido.
      nota: 'A = aberto · F ou P = pago · C = cancelado',
    },
    {
      campo: 'liberado',
      valor: texto('liberado') || '(vazio)',
      nota: 'N = título nunca liberado; não é conta a pagar de verdade',
    },
    /*
     * Os três campos abaixo não decidem nada nesta lista — decidem se o título
     * aparece na tela do IXC. É a pergunta que este painel não sabia responder:
     * "está aqui, e no IXC não está; por quê?". Sem eles, a conversa vira
     * palavra contra palavra, com o registro na frente dos dois.
     */
    {
      campo: 'previsao',
      valor: texto('previsao') || '(vazio)',
      nota:
        'S = é previsão, não conta a pagar de verdade; o IXC não a mostra ' +
        'junto com as contas a pagar. As lançadas daqui nascem com N.',
    },
    {
      campo: 'status_auditoria',
      valor: texto('status_auditoria') || '(vazio)',
      nota:
        'A = aprovada · R = reprovada · vazio = ainda não passou pela ' +
        'auditoria, e o IXC não a oferece para pagar enquanto não passar',
    },
    {
      campo: 'filial_id',
      valor: texto('filial_id') || '(vazio)',
      nota:
        'a filial dona do título; esta tela lê todas, a tela do IXC mostra a ' +
        'da sessão de quem está olhando',
    },
    {
      campo: 'id_entrada',
      valor: texto('id_entrada') || '(vazio)',
      nota: 'preenchido = o título nasceu da entrada de uma nota fiscal',
    },
    {
      campo: 'valor',
      valor: texto('valor') || '(vazio)',
      nota: 'valor do título',
    },
    {
      campo: 'valor_aberto',
      valor: texto('valor_aberto') || '(vazio)',
      nota: 'o que o IXC diz que falta pagar',
    },
    {
      campo: 'valor_baixado',
      valor: texto('valor_baixado') || '(vazio)',
      nota: 'quanto já foi baixado (quitado)',
    },
    {
      campo: 'valor_total_pago',
      valor: texto('valor_total_pago') || '(vazio)',
      nota: 'quanto já foi pago',
    },
    ...CAMPOS_DE_BAIXA.map((campo) => ({
      campo,
      valor: texto(campo) || '(vazio)',
      nota: 'preenchida = título já baixado (pago)',
    })),
    ...CAMPOS_DE_CANCELAMENTO.map((campo) => ({
      campo,
      valor: texto(campo) || '(vazio)',
      nota: 'marca de conta cancelada',
    })),
    // As datas não decidem se a conta entra na lista, mas decidem em que
    // linha do tempo ela aparece — e é por elas que se procura o título no
    // IXC. Se a data mostrada aqui sair de uma coluna diferente da que o IXC
    // chama de "Vencimento", procurar por ela lá não acha nada, e o título
    // parece não existir quando na verdade só está em outro dia.
    ...CAMPOS_DE_DATA.map((campo) => ({
      campo,
      valor: texto(campo) || '(vazio)',
      nota: 'data como veio do IXC, sem interpretação',
    })),
    {
      campo: 'id_fornecedor',
      valor: texto('id_fornecedor') || '(vazio)',
      nota: 'código de quem recebe, para procurar no cadastro do IXC',
    },
  ];

  return { aberta: motivo === null, motivo, olhou };
}

/**
 * Toda coluna de data conhecida do `fn_apagar`, mostrada crua. Não é a lista
 * que o mapeador usa para escolher o vencimento — é maior de propósito: serve
 * para comparar o que a tela mostra com o que existe no registro.
 */
const CAMPOS_DE_DATA = [
  'data_vencimento',
  'data_venc',
  'vencimento',
  'data_vencimento_original',
  'data_emissao',
  'data',
  'data_pagamento',
  'data_baixa',
  'data_hora_baixa',
] as const;

/**
 * A coluna que diz que esta conta foi cancelada, se houver.
 *
 * Coluna vazia, `N`, zero e data zerada são o estado normal de quem nunca
 * cancelou nada — só valor de verdade conta.
 */
export function campoDeCancelamento(raw: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_DE_CANCELAMENTO) {
    if (temValorDeVerdade(raw[campo])) return campo;
  }
  return null;
}

/**
 * Se a coluna tem conteúdo que significa alguma coisa. Vazio, `N`, zero, nulo
 * e data zerada são o estado normal de quem nunca cancelou nem baixou nada —
 * o IXC preenche essas colunas assim quando o evento não aconteceu.
 */
export function temValorDeVerdade(valor: unknown): boolean {
  const s = String(valor ?? '').trim().toUpperCase();
  if (!s || s === 'N' || s === '0' || s === 'NULL') return false;
  if (/^0000-00-00/.test(s) || /^00\/00\/0000/.test(s)) return false;
  return true;
}

/** Um registro cru do `fn_apagar` na forma que as telas usam. */
export function mapContaAberta(
  raw: Record<string, unknown>,
  hoje = new Date(),
): ContaAberta | null {
  const idFnApagar = parseIxcId(raw.id);
  if (idFnApagar === null) return null;

  const vencimento = primeiraData(raw, [
    'data_vencimento',
    'data_venc',
    'vencimento',
    'data_vencimento_original',
  ]);

  const dias = vencimento === null ? null : diasEntre(hoje, vencimento);

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
    valor: parseIxcDecimal(raw.valor ?? raw.valor_documento),
    valorAberto: valorEmAberto(raw),
    emissao: primeiraData(raw, ['data_emissao', 'data', 'emissao']),
    vencimento,
    diasParaVencer: dias,
    // Vence hoje ainda não está vencida: o dia de pagar é hoje.
    vencida: dias !== null && dias < 0,
    observacao: primeiroTexto(raw, ['obs', 'observacao', 'historico']),
    parcela: marcacaoDeParcela(raw),
    statusAuditoria: lerStatusAuditoria(raw),
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
  };
}

/**
 * Quanto ainda falta pagar.
 *
 * `valor_aberto` é a resposta direta onde a base a tem. Onde não tem, o que
 * falta é o título menos o que já saiu — e "o que já saiu" mora em mais de uma
 * coluna: o IXC chama de **baixa** o ato de quitar o título, e a tela dele
 * mostra "Valor baixado" ao lado de "Valor aberto". Olhar só `valor_pago`
 * fazia um título já baixado aparecer devendo o valor inteiro.
 */
function valorEmAberto(raw: Record<string, unknown>): number {
  const aberto = parseIxcDecimal(raw.valor_aberto);
  if (aberto > 0) return aberto;

  const valor = parseIxcDecimal(raw.valor ?? raw.valor_documento);
  const pago = Math.max(
    parseIxcDecimal(raw.valor_total_pago),
    parseIxcDecimal(raw.valor_pago),
    parseIxcDecimal(raw.valor_baixado),
  );
  return Math.max(0, arredondar(valor - pago));
}

/** As contas somadas por urgência — a leitura que decide o que pagar antes. */
export function resumirContasAbertas(
  contas: ContaAberta[],
): ResumoContasAbertas {
  const vazio = (): FatiaDoResumo => ({ quantidade: 0, total: 0 });
  const resumo: ResumoContasAbertas = {
    quantidade: contas.length,
    total: 0,
    vencidas: vazio(),
    venceEmSeteDias: vazio(),
    demais: vazio(),
    semVencimento: vazio(),
  };

  for (const c of contas) {
    resumo.total = arredondar(resumo.total + c.valorAberto);
    const fatia =
      c.diasParaVencer === null
        ? resumo.semVencimento
        : c.diasParaVencer < 0
          ? resumo.vencidas
          : c.diasParaVencer <= 7
            ? resumo.venceEmSeteDias
            : resumo.demais;

    fatia.quantidade += 1;
    fatia.total = arredondar(fatia.total + c.valorAberto);
  }

  return resumo;
}

/**
 * A ordem em que se paga: o que já venceu primeiro, o mais atrasado no topo.
 * Conta sem vencimento vai para o fim — ela não entra em nenhuma urgência.
 */
export function ordenarPorUrgencia(contas: ContaAberta[]): ContaAberta[] {
  return [...contas].sort((a, b) => {
    if (a.diasParaVencer === null) return b.diasParaVencer === null ? 0 : 1;
    if (b.diasParaVencer === null) return -1;
    if (a.diasParaVencer !== b.diasParaVencer) {
      return a.diasParaVencer - b.diasParaVencer;
    }
    // Empatou o dia: o valor maior aparece antes, que é o que pesa no caixa.
    return b.valorAberto - a.valorAberto;
  });
}

/**
 * Dias inteiros entre hoje e o vencimento, contados por dia civil.
 *
 * A conta é feita sobre a data zerada nos dois lados de propósito: comparando
 * o instante, uma conta que vence hoje às 00:00 apareceria como vencida desde
 * a hora do almoço.
 */
function diasEntre(hoje: Date, vencimento: Date): number {
  const a = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const b = Date.UTC(
    vencimento.getUTCFullYear(),
    vencimento.getUTCMonth(),
    vencimento.getUTCDate(),
  );
  return Math.round((b - a) / 86_400_000);
}

/** O primeiro dos nomes conhecidos que tiver texto de verdade. */
export function primeiroTexto(
  raw: Record<string, unknown>,
  campos: string[],
): string | null {
  for (const campo of campos) {
    const s = String(raw[campo] ?? '').trim();
    if (s && s !== '0') return s;
  }
  return null;
}

/** O primeiro dos nomes conhecidos que tiver data válida. */
export function primeiraData(
  raw: Record<string, unknown>,
  campos: string[],
): Date | null {
  for (const campo of campos) {
    const d = parseIxcDate(raw[campo]);
    if (d) return d;
  }
  return null;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
