import { parseIxcDate, parseIxcDecimal } from './ixc.parse';

/** Formata Date como "DD/MM/AAAA" (formato aceito pelo IXC). */
export function formatDataIxc(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/** Formata valor monetário como string com ponto decimal ("1234.56"). */
export function formatValorIxc(valor: number): string {
  return (Math.round(valor * 100) / 100).toFixed(2);
}

export interface FornecedorInput {
  nome: string;
  cpfCnpj?: string | null;
  tipoPessoa?: string; // "F" | "J"
  cidadeId: number;
  email?: string | null;
  celular?: string | null;
  obs?: string;
}

/** Monta o corpo do POST /fornecedor. */
export function buildFornecedorPayload(
  input: FornecedorInput,
): Record<string, unknown> {
  const tipoPessoa = input.tipoPessoa === 'J' ? 'J' : 'F';
  return {
    ativo: 'S',
    tipo_pessoa: tipoPessoa,
    razao: input.nome.trim(),
    fantasia: input.nome.trim(),
    cpf_cnpj: input.cpfCnpj ?? '',
    data: formatDataIxc(new Date()),
    cidade: String(input.cidadeId),
    email: input.email ?? '',
    celular: input.celular ?? '',
    obs: input.obs ?? '',
  };
}

export interface ContaPagarInput {
  idFornecedor: number;
  valor: number;
  contaPagamentoId: number; // id_contas
  contaContabilId: number; // id_conta (planejamento analítico)
  filialId: number;
  dataEmissao: Date;
  dataVencimento: Date;
  observacao: string;
  tipoPagamento?: string; // default "Dinheiro"
  chavePix?: string | null;
  /**
   * Tipo de PIX preferencial do cadastro (aba "Dados bancários" do
   * fornecedor). Vazio = deduz pelo formato da chave.
   */
  tipoChavePix?: TipoChavePix | null;
  /**
   * Como esta base guarda o rádio "Tipo da chave Pix". Vazio = manda o rótulo
   * da tela na coluna `tipo_chave_pix`.
   */
  mapaTipoChave?: MapaTipoChavePix | null;

  /** Linha digitável do boleto, só dígitos. É o que o IXC usa para pagá-lo. */
  codigoBarras?: string | null;
  /** Número do documento (`fn_apagar.documento`). */
  documento?: string | null;
  /** Número da nota fiscal, quando a despesa tem uma. */
  numeroNota?: string | null;
}

/**
 * Só os dígitos da linha digitável, que é como o IXC guarda o código de barras.
 *
 * Quem copia um boleto traz pontos, espaços e a máscara do banco junto; mandar
 * isso ao IXC é mandar um código que o banco não reconhece.
 */
export function somenteDigitosDoBoleto(valor?: string | null): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Um código de boleto plausível: 44 dígitos (código de barras), 47 (linha
 * digitável de cobrança) ou 48 (contas de consumo e tributos).
 *
 * A conferência é de tamanho, não de dígito verificador: rejeitar um boleto
 * bom por causa de um cálculo que varia entre convênios seria pior do que
 * deixar o IXC recusar um ruim.
 */
export function pareceCodigoDeBoleto(digitos: string): boolean {
  return [44, 47, 48].includes(digitos.length);
}

/** Tipos da chave PIX, como aparecem na tela de contas a pagar do IXC. */
export const TIPOS_CHAVE_PIX = [
  'CPF/CNPJ',
  'Celular',
  'E-mail',
  'Aleatória',
  'Código copia e cola',
] as const;

export type TipoChavePix = (typeof TIPOS_CHAVE_PIX)[number];

/**
 * Traduz o "tipo de PIX preferencial" do cadastro para o rótulo que a tela de
 * contas a pagar do IXC usa. Entende o rótulo por extenso e o nome da coluna
 * ("pix_celular"), que é como o IXC separa as chaves.
 *
 * Código de uma letra fica de fora de propósito: "C" tanto pode ser celular
 * quanto CPF, e chutar aqui é mandar o pagamento com o tipo errado. Sem
 * tradução, quem decide é a coluna que tem chave preenchida.
 */
export function normalizarTipoChavePix(valor: unknown): TipoChavePix | null {
  const s = String(valor ?? '').trim().toLowerCase();
  if (s.length < 2) return null;
  if (/cel|fone|tel|whats/.test(s)) return 'Celular';
  if (/mail/.test(s)) return 'E-mail';
  if (/cpf|cnpj|documento/.test(s)) return 'CPF/CNPJ';
  if (/aleat|random/.test(s)) return 'Aleatória';
  if (/copia|cola|emv|brcode/.test(s)) return 'Código copia e cola';
  return null;
}

/**
 * Deduz o tipo da chave PIX pelo formato, para marcar o rádio "Tipo da chave
 * Pix" junto do pagamento. Celular e CPF têm 11 dígitos: o desempate é o DDD
 * válido seguido do 9 do celular (CPF não começa com DDD + 9).
 */
export function inferirTipoChavePix(chave?: string | null): TipoChavePix | null {
  const s = String(chave ?? '').trim();
  if (!s) return null;
  if (s.includes('@')) return 'E-mail';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return 'Aleatória';
  }

  const digitos = s.replace(/\D/g, '');
  if (digitos.length === 13 && digitos.startsWith('55')) return 'Celular';
  if (digitos.length === 11 && /^[1-9]{2}9/.test(digitos)) return 'Celular';
  if (digitos.length === 11 || digitos.length === 14) return 'CPF/CNPJ';
  if (s.length > 40) return 'Código copia e cola';
  return null;
}

/**
 * Como esta base do IXC guarda o rádio "Tipo da chave Pix" do fn_apagar.
 *
 * O nome da coluna e o código de cada tipo não estão documentados e variam por
 * instalação — e mandar errado deixa o rádio em branco, o que **trava o
 * pagamento**: o banco recusa PIX sem o tipo da chave. Por isso isto é
 * aprendido das contas que já existem no IXC, não chutado.
 */
export interface MapaTipoChavePix {
  /** Coluna do fn_apagar que guarda o tipo. */
  campo: string;
  /** Rótulo da tela → código cru usado nesta base. */
  codigos: Partial<Record<TipoChavePix, string>>;
}

/** Coluna candidata a guardar o tipo: fala de PIX **e** de tipo. */
function ehColunaTipoPix(coluna: string): boolean {
  return /pix/i.test(coluna) && /tipo/i.test(coluna);
}

/**
 * Descobre, a partir de contas a pagar já existentes no IXC, qual coluna guarda
 * o tipo da chave PIX e que código ela usa para cada tipo.
 *
 * A ideia: numa conta feita na tela do IXC, a chave e o tipo estão coerentes.
 * Então o formato da própria chave (`+55…` = celular, `@` = e-mail) diz qual
 * tipo aquele código representa. Uma coluna que se contradiz — o mesmo tipo com
 * dois códigos diferentes — é descartada, porque não é a coluna do tipo.
 */
export function aprenderTipoChavePix(
  registros: Array<Record<string, unknown>>,
): MapaTipoChavePix | null {
  const porColuna = new Map<string, Map<TipoChavePix, Set<string>>>();

  for (const raw of registros) {
    const tipo = inferirTipoChavePix(String(raw.chave_pix ?? ''));
    if (!tipo) continue;

    for (const [coluna, valor] of Object.entries(raw)) {
      if (!ehColunaTipoPix(coluna)) continue;
      const codigo = String(valor ?? '').trim();
      if (!codigo) continue;

      const porTipo = porColuna.get(coluna) ?? new Map();
      porColuna.set(coluna, porTipo);
      const codigos = porTipo.get(tipo) ?? new Set<string>();
      porTipo.set(tipo, codigos);
      codigos.add(codigo);
    }
  }

  let melhor: MapaTipoChavePix | null = null;
  for (const [campo, porTipo] of porColuna) {
    // Um tipo com dois códigos distintos: esta coluna não é a do tipo.
    if ([...porTipo.values()].some((c) => c.size !== 1)) continue;

    const codigos: Partial<Record<TipoChavePix, string>> = {};
    for (const [tipo, valores] of porTipo) codigos[tipo] = [...valores][0];

    const quantidade = Object.keys(codigos).length;
    if (!melhor || quantidade > Object.keys(melhor.codigos).length) {
      melhor = { campo, codigos };
    }
  }
  return melhor;
}

/**
 * Lê o mapeamento informado à mão em Configurações
 * ("Celular=C, E-mail=E"), para quando não há conta antiga com PIX no IXC
 * de onde aprender.
 */
export function parseCodigosTipoChavePix(
  config?: string | null,
): Partial<Record<TipoChavePix, string>> {
  const codigos: Partial<Record<TipoChavePix, string>> = {};
  for (const par of String(config ?? '').split(/[,;]+/)) {
    const [rotulo, codigo] = par.split('=');
    if (!codigo?.trim()) continue;
    const tipo = normalizarTipoChavePix(rotulo);
    if (tipo) codigos[tipo] = codigo.trim();
  }
  return codigos;
}

/**
 * Escreve os códigos no mesmo formato que `parseCodigosTipoChavePix` lê, para
 * guardar no banco o que foi aprendido do IXC.
 */
export function serializarCodigosTipoChavePix(
  codigos: Partial<Record<TipoChavePix, string>>,
): string {
  return TIPOS_CHAVE_PIX.filter((tipo) => codigos[tipo])
    .map((tipo) => `${tipo}=${codigos[tipo]}`)
    .join(',');
}

/**
 * O jeito conhecido do IXC guardar o rádio "Tipo da chave Pix": coluna
 * `tipo_pix`, com o tipo escrito por extenso e em maiúsculas.
 *
 * Serve de chute inicial para quem ainda não aprendeu nada da própria base. O
 * chute antigo era a coluna `tipo_chave_pix`, que não existe nas instalações
 * que se viu até aqui — o IXC ignorava o campo em silêncio, a conta nascia com
 * a chave preenchida e o tipo em branco, e o banco não pagava.
 */
const MAPA_TIPO_PIX_CONHECIDO: MapaTipoChavePix = {
  campo: 'tipo_pix',
  codigos: {
    'CPF/CNPJ': 'CPF_CNPJ',
    Celular: 'CELULAR',
    'E-mail': 'EMAIL',
    Aleatória: 'ALEATORIA',
    'Código copia e cola': 'COPIA_E_COLA',
  },
};

/**
 * Coluna e valor do rádio "Tipo da chave Pix". O que foi aprendido da própria
 * base manda; sem isso, vale o jeito conhecido do IXC.
 */
export function codificarTipoChavePix(
  tipo: TipoChavePix | null,
  mapa?: MapaTipoChavePix | null,
): { campo: string; valor: string } {
  const campo = mapa?.campo || MAPA_TIPO_PIX_CONHECIDO.campo;
  if (!tipo) return { campo, valor: '' };

  const aprendido = mapa?.codigos[tipo];
  if (aprendido) return { campo, valor: aprendido };

  /*
   * O tipo que o aprendizado não alcançou.
   *
   * Ele existe: aprende-se um tipo de cada conta que já está no IXC, e uma base
   * onde ninguém nunca pagou por chave aleatória não tem de onde ensinar essa.
   * Foi o que travou um lançamento de 18/08/2026 — o mapa desta base sabia
   * CPF/CNPJ, celular, e-mail e copia-e-cola, e a conta ia com chave aleatória.
   * Sem código, mandava-se o rótulo da tela, com acento e tudo, e o IXC
   * respondia "Tipo da chave Pix inválido!".
   *
   * Estando o aprendizado na mesma coluna que o jeito conhecido do IXC, o
   * código conhecido é o melhor palpite para o que faltou: é a mesma convenção,
   * só que num tipo de que ainda não houve exemplo. Coluna diferente é outra
   * convenção, e aí código conhecido não significa nada — só resta o rótulo.
   */
  if (campo === MAPA_TIPO_PIX_CONHECIDO.campo) {
    return { campo, valor: MAPA_TIPO_PIX_CONHECIDO.codigos[tipo] ?? tipo };
  }

  return { campo, valor: tipo };
}

/** Monta o corpo do POST /fn_apagar (conta a pagar). */
export function buildContaPagarPayload(
  input: ContaPagarInput,
): Record<string, unknown> {
  const chave = (input.chavePix ?? '').trim();
  // O tipo preferencial do cadastro manda: é o que o IXC mostra marcado na aba
  // "Dados bancários" do fornecedor, e a conta a pagar tem que repetir. Só
  // quando o cadastro não diz é que se deduz pelo formato da chave.
  const tipoChave = input.tipoChavePix ?? inferirTipoChavePix(chave);
  const radio = codificarTipoChavePix(tipoChave, input.mapaTipoChave);

  return {
    id_fornecedor: String(input.idFornecedor),
    data_emissao: formatDataIxc(input.dataEmissao),
    data_vencimento: formatDataIxc(input.dataVencimento),
    valor: formatValorIxc(input.valor),
    id_contas: String(input.contaPagamentoId), // conta de pagamento (18)
    tipo_pagamento: input.tipoPagamento ?? 'Pix',
    id_conta: String(input.contaContabilId), // conta contábil (2420/2662/13916)
    filial_id: String(input.filialId),
    // A chave vai exata como está no cadastro: o fn_apagar recusa ("Chave Pix
    // inválida!") o celular reescrito em +55DDD9XXXXXXXX, mesmo o IXC guardando
    // a chave com máscara na aba de dados bancários do fornecedor.
    chave_pix: chave,
    // Rádio "Tipo da chave Pix" da tela de contas a pagar.
    [radio.campo]: radio.valor,
    // O boleto só é pagável no IXC com o código; sem ele a conta chega lá e
    // fica parada esperando alguém digitar à mão.
    codigo_barras: somenteDigitosDoBoleto(input.codigoBarras),
    documento: input.documento ?? '',
    numero_nota: input.numeroNota ?? '',
    /*
     * Regime contábil do título — "Regime contábil (Previsão)" na tela do IXC:
     * `S` = Caixa (Previsão sim), `N` = Competência (Previsão não).
     *
     * Ia `N` porque é o que o exemplo da coleção traz, marcado como
     * obrigatório. Mas o exemplo é um exemplo: nesta base, dos títulos pagos
     * pela conta do banco, 4.449 estão em `S` e 483 em `N` — e os `N` são os
     * que este app criou. A tela grava `S`, e é dela que a empresa vive.
     *
     * Não é o que segurava a conciliação (um título nosso já em `S` continuou
     * fora dela) — quem segurava é o `comunicado`, logo abaixo. Fica em `S`
     * porque é o regime da empresa, não porque conserta alguma coisa.
     */
    previsao: 'S',
    /*
     * "Comunicado com a Modobank" — se este título já foi passado ao banco que
     * paga por integração.
     *
     * **É ele que decide se o pagamento aparece para conciliar.** A tela do IXC
     * grava `N` em todo título que nasce nela; o app não mandava nada, e o
     * campo ficava vazio. Vazio não é `N`: a conciliação procura os títulos
     * marcados como não comunicados, e o que está em branco não é achado por
     * essa procura. O pagamento constava pago, o movimento existia em
     * `fn_movim_finan`, e a tela de conciliação não o listava — sem erro em
     * lugar nenhum.
     *
     * Conferido nos títulos: os que aparecem para conciliar têm `N` (31832,
     * 31833, 36890); os nossos tinham vazio. `S` é o que o próprio ModoBank
     * escreve quando comunica o pagamento — não é para sair daqui.
     */
    comunicado: 'N',
    /*
     * "Despesa veículo". Mesma história do `comunicado`: a tela grava `N`,
     * nós deixávamos vazio. Nenhum sintoma conhecido, mas um campo de sim/não
     * em branco é um campo que nenhuma consulta acha.
     */
    eh_despesa_veiculo: 'N',
    liberado: 'S',
    obs: input.observacao,
  };
}

/** Uma baixa manual de conta a pagar — o "paguei" registrado no IXC. */
export interface BaixaContaPagarInput {
  /** `fn_apagar.id` do título que está sendo pago. */
  idFnApagar: number;
  /** Conta de onde o dinheiro saiu (`id_contas` — o caixa, o banco). */
  contaPagamentoId: number;
  /**
   * A conta do **razão** daquela conta de pagamento — o `id_planejamento` do
   * cadastro dela em `contas` (12833 para a Conta ModoBank PIX).
   *
   * É ela que vai no `id_conta` da baixa, e é o que decide se o pagamento
   * aparece para conciliar. Ver `buildBaixaContaPagarPayload`.
   */
  contaPlanejamentoId: number;
  filialId: number;
  /** Quanto o título deve. Igual ao saldo em aberto quando se quita de uma vez. */
  valor: number;
  /**
   * Desconto obtido nesta baixa — o abatimento de quem paga adiantado.
   *
   * Ele não muda o que o título vale: o título continua devendo `valor`, e o
   * que sai do caixa é `valor - desconto`. Os dois números vão para o IXC em
   * campos diferentes de propósito (`vdesconto` e `valor_total_pago`), porque
   * são perguntas diferentes — quanto se devia e quanto se pagou —, e é a
   * segunda que a conciliação procura no extrato.
   */
  desconto?: number;
  data: Date;
  /** Vai para o histórico do lançamento no IXC. */
  historico: string;
  /** Número do documento, quando o título tem um. */
  documento?: string | null;
  /**
   * Como se pagou, no código do IXC: "D" dinheiro, "T" transferência, "X" pix.
   *
   * **Não deixe cair no padrão sem pensar.** É este campo que diz ao IXC que
   * natureza tem o lançamento que a baixa cria na movimentação financeira, e
   * dinheiro numa conta de banco não é movimento de banco — não aparece para
   * conciliar. Ver `codigoTipoPagamentoBaixa`.
   */
  tipoPagamento?: string;
  /**
   * Nome da conta de onde o dinheiro saiu ("CX - Werick", "Conta ModoBank
   * PIX"). A tela do IXC manda o rótulo junto do id em todo campo de seleção, e
   * a baixa feita à mão por lá vai com ele.
   */
  contaPagamentoNome?: string | null;
  /** Nome da filial, pelo mesmo motivo do `contaPagamentoNome`. */
  filialNome?: string | null;
}

/**
 * O histórico de uma baixa, no formato em que o IXC a escreve quando o
 * pagamento é feito pela tela dele: `Pag. <quem recebeu> - doc.: <documento>`.
 *
 * É o mesmo formato do exemplo oficial da coleção ("Pag. Salários à pagar -
 * doc.: 1") e o que aparece na aba "Pagamentos" de um título pago à mão. Uma
 * baixa feita daqui tem de ser indistinguível de uma feita lá: quem abre o
 * título depois não deveria conseguir dizer por onde ela entrou.
 *
 * Sai sem acento de propósito. O IXC lê o que mandamos como Latin-1 e grava o
 * estrago: "lançamento" virou "lanÃ§amento" e o travessão virou "?" na tela
 * dele. Enquanto a codificação não for acertada na origem, texto sem acento é
 * o que se lê igual dos dois lados.
 */
export function montarHistoricoBaixa(input: {
  beneficiario?: string | null;
  documento?: string | null;
}): string {
  const nome = semAcento((input.beneficiario ?? '').trim());
  const doc = (input.documento ?? '').trim();
  const quem = nome ? `Pag. ${nome}` : 'Pag.';
  return (doc ? `${quem} - doc.: ${doc}` : quem).slice(0, 200);
}

/** Tira acento e o que o Latin-1 não escreve — ver `montarHistoricoBaixa`. */
export function semAcento(texto: string): string {
  return texto
    // NFD separa a letra do acento; \p{M} varre os acentos que sobraram.
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // O que não é ASCII imprimível (travessão, aspa curva) vira espaço: é o
    // que o IXC escreveria como "?".
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A forma de pagamento da baixa, no código que o IXC usa: "D" dinheiro, "T"
 * transferência, "X" pix.
 *
 * O título guarda a forma como **rótulo** ("Pix", "Dinheiro"); a baixa quer o
 * código. Sem traduzir, toda baixa feita daqui ia como dinheiro — inclusive um
 * PIX saindo da conta do banco, que passava a constar como saída de espécie.
 *
 * Sem rótulo reconhecível, decide de onde o dinheiro saiu: do caixa é dinheiro,
 * de qualquer conta bancária é transferência. Errar para "transferência" deixa
 * o movimento na conciliação, onde alguém o vê e corrige; errar para "dinheiro"
 * o esconde.
 */
export function codigoTipoPagamentoBaixa(
  rotulo: string | null | undefined,
  ehCaixa: boolean,
): string {
  const t = semAcento(String(rotulo ?? '')).toLowerCase();
  if (/pix/.test(t)) return 'X';
  if (/dinheiro|especie|maos/.test(t)) return 'D';
  if (/transfer|ted|doc|deposito|boleto|debito|cartao/.test(t)) return 'T';
  return ehCaixa ? 'D' : 'T';
}

/**
 * Monta o corpo do POST /fn_apagar_pagamentos_baixas — o pagamento feito à mão,
 * fora do fluxo do banco.
 *
 * Os valores vão com vírgula decimal, ao contrário do resto do webservice: é o
 * que a tela de baixa do IXC envia, e é o que ela aceita de volta. Mandar
 * "1234.56" aqui faz o IXC gravar um valor errado sem reclamar, o que é o pior
 * dos resultados numa baixa — a conta consta paga por outro valor.
 */
export function buildBaixaContaPagarPayload(
  input: BaixaContaPagarInput,
): Record<string, unknown> {
  const desconto = Math.round(Math.max(0, input.desconto ?? 0) * 100) / 100;
  const pago = Math.round((input.valor - desconto) * 100) / 100;
  const valor = formatValorBaixaIxc(input.valor);
  return {
    id_pagar: input.idFnApagar,
    id_pagar_label: String(input.idFnApagar),
    filial: input.filialId,
    filial_id: input.filialId,
    filial_label: input.filialNome ?? '',
    /*
     * `conta_` é a conta de onde o dinheiro sai (18, 23); `id_conta` é a conta
     * do **razão** dela — o `id_planejamento` do cadastro em `contas`.
     *
     * Aqui estava o que fazia o pagamento sumir da conciliação. A baixa cria um
     * par de linhas em `fn_movim_finan`: uma `M`, que é o dinheiro saindo da
     * conta bancária, e uma `P`, que é a despesa. A conciliação lê a `M`, e ela
     * só existe na conta do banco — 12833 na Conta ModoBank PIX, onde moram os
     * 135 mil movimentos que a tela de conciliação lista.
     *
     * O app mandava aqui a conta contábil do título (324, a da despesa). O IXC
     * escrevia as duas linhas nessa conta, e nada era lançado no razão do
     * banco: o título constava pago, o par de linhas existia, e não havia
     * movimento nenhum na conta que a conciliação lê. Comparado com um título
     * pago pela tela: `M` em 12833 e `P` em 2468, contas diferentes; nos
     * nossos, as duas na mesma.
     *
     * A conta da despesa não se perde — o IXC a lê do próprio título para a
     * linha `P`, e é por isso que ela não precisa vir no corpo.
     */
    conta_: input.contaPagamentoId,
    conta__label: input.contaPagamentoNome ?? '',
    id_conta: input.contaPlanejamentoId,
    tipo_pagamento: input.tipoPagamento ?? 'D',
    chave_pix: '',
    cheque_banco: '',
    cheque_numero: '',
    cheque_nome: '',
    cheque_predatado: '',
    id_conta_class_finan_a: '',
    id_conta_class_finan_a_label: '',
    data: formatDataIxc(input.data),
    documento: input.documento ?? '',
    /*
     * O desconto vai em valor, nunca em percentual.
     *
     * Quem paga adiantado combina "tira cinquenta reais", não "tira 0,608%":
     * o percentual sairia de uma divisão que arredonda, e o IXC recalcularia
     * dele um desconto de centavos diferentes do que foi combinado. Com
     * `vdesconto` preenchido e `pdesconto` vazio, o valor é o que manda.
     */
    pdesconto: '',
    vdesconto: desconto > 0 ? formatValorBaixaIxc(desconto) : '',
    pacrescimo: '',
    vacrescimo: '',
    /*
     * As duas primeiras são o que o título deve; a terceira é o que saiu do
     * caixa. Sem desconto as três dizem a mesma coisa, e era por isso que uma
     * só bastava.
     *
     * `valor_total_pago` é o número que vira a linha da movimentação
     * financeira — a perna do dinheiro saindo do banco, que a conciliação
     * casa com o extrato. Mandar nele o valor cheio de um pagamento com
     * desconto poria no IXC uma saída que o extrato não tem, e a conta não
     * conciliaria nunca. `debito` continua o valor cheio porque é o que o
     * título devia: é a diferença entre os dois que o IXC entende como
     * desconto e usa para dar o título por quitado.
     */
    valor_parcela: valor,
    debito: valor,
    valor_total_pago: formatValorBaixaIxc(pago),
    historico: input.historico,
    tipo_p: 'T',
    tipo_lanc: 'P',
    id_operador: '',
  };
}

/** Valor como a baixa do IXC espera: vírgula decimal, sem separador de milhar. */
export function formatValorBaixaIxc(valor: number): string {
  return (Math.round(valor * 100) / 100).toFixed(2).replace('.', ',');
}

export type StatusAuditoriaIxc = 'A' | 'R' | 'C';

/** Monta o corpo do POST /fn_apagar_auditoria (aprovar/reprovar). */
export function buildAuditoriaPayload(input: {
  idFnApagar: number;
  status: StatusAuditoriaIxc;
  motivo: string;
  operador?: string;
}): Record<string, unknown> {
  return {
    status: input.status,
    id_fn_apagar: String(input.idFnApagar),
    tipo: 'E', // Externo (via API)
    motivo: input.motivo,
    operador: input.operador ?? '',
    data_hora: '',
  };
}

/** Situação lida de um registro fn_apagar do IXC. */
export interface SituacaoContaPagarIxc {
  pago: boolean;
  /** `fn_apagar.status = C`: cancelada na tela do IXC. */
  cancelada: boolean;
  statusAuditoria: StatusAuditoriaIxc | null;
  valorPago: number;
  valorAberto: number;
  dataPagamento: Date | null;
}

/**
 * Status da auditoria dentro de um registro cru. O nome da coluna varia entre
 * versões do IXC, então procura os nomes conhecidos e, por fim, qualquer campo
 * com "audit" no nome. Null = o registro não fala de auditoria (aí quem sabe é
 * a tabela `fn_apagar_auditoria`).
 */
export function lerStatusAuditoria(
  raw: Record<string, unknown>,
): StatusAuditoriaIxc | null {
  const candidatos = ['status_auditoria', 'auditoria', 'status_aud'];
  for (const campo of candidatos) {
    const v = normalizarStatusAuditoria(raw[campo]);
    if (v) return v;
  }
  for (const [chave, valor] of Object.entries(raw)) {
    if (!/audit/i.test(chave)) continue;
    const v = normalizarStatusAuditoria(valor);
    if (v) return v;
  }
  return null;
}

function normalizarStatusAuditoria(valor: unknown): StatusAuditoriaIxc | null {
  const s = String(valor ?? '').trim().toUpperCase();
  if (s === 'A' || s === 'R' || s === 'C') return s;
  // Algumas telas devolvem o rótulo em vez do código.
  if (s.startsWith('APROV')) return 'A';
  if (s.startsWith('REPROV')) return 'R';
  if (s.startsWith('CANCEL')) return 'C';
  return null;
}

/**
 * Interpreta um registro cru de fn_apagar para descobrir se já foi pago
 * (retorno do banco), se foi cancelado e o status da auditoria. Defensivo
 * quanto a formatos.
 */
export function lerSituacaoContaPagar(
  raw: Record<string, unknown>,
): SituacaoContaPagarIxc {
  const valorPago = parseIxcDecimal(raw.valor_total_pago ?? raw.valor_pago);
  const valorAberto = parseIxcDecimal(raw.valor_aberto ?? raw.valor);
  const dataPagamento = parseIxcDate(raw.data_pagamento);
  // fn_apagar.status: A = aberto, P = pago, C = cancelado.
  const status = String(raw.status ?? '').trim().toUpperCase();

  const pago =
    status === 'P' ||
    dataPagamento !== null ||
    (valorPago > 0 && valorAberto <= 0.001);

  return {
    pago,
    cancelada: status === 'C',
    statusAuditoria: lerStatusAuditoria(raw),
    valorPago,
    valorAberto,
    dataPagamento,
  };
}
