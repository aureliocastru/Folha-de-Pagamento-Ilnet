/**
 * Leitura das guias que a contabilidade manda todo mês.
 *
 * São quatro documentos de origens diferentes — DARF previdenciário e DAS do
 * Simples (ambos do SENDA, da Receita), a guia do FGTS Digital (da Caixa) e o
 * DARE do ICMS (SEFAZ estadual). O texto extraído do PDF vem com as colunas
 * fora de ordem, então nada aqui depende de posição: tudo é ancorado no rótulo
 * impresso ("Total da Guia:", "Pagar até:"), que é o que não muda entre uma
 * competência e outra.
 *
 * O que sai daqui é uma **leitura**, não um lançamento: quem confere é a
 * pessoa na tela, antes de gravar.
 */

/** Documento reconhecido pelo leitor. */
export type TipoGuia = 'DARF_INSS' | 'FGTS' | 'DAS_SIMPLES' | 'DARE_ICMS';

/**
 * O que aquele item representa no bolso da empresa.
 *
 * A separação existe porque somar tudo mente: o INSS descontado do trabalhador
 * passa pela conta da empresa mas é dinheiro dele, e IRPJ/COFINS/ICMS são
 * imposto sobre faturamento, não sobre gente.
 */
export type ClasseTributo =
  /** Custo da empresa com pessoal: FGTS e a parte patronal do INSS. */
  | 'FOLHA_PATRONAL'
  /** Retido de quem trabalha e apenas repassado: INSS do segurado, consignado. */
  | 'FOLHA_RETIDO'
  /** Tributo sobre faturamento: IRPJ, CSLL, COFINS, PIS, ICMS. */
  | 'FATURAMENTO';

export interface ItemGuiaLido {
  /** Código de receita, quando o documento traz (o FGTS não traz). */
  codigo: string | null;
  denominacao: string;
  valor: number;
  classe: ClasseTributo;
  /**
   * O leitor não conhecia este código e chutou pela denominação. A tela
   * destaca para a pessoa conferir antes de gravar.
   */
  classeIncerta: boolean;
}

export interface GuiaLida {
  tipo: TipoGuia;
  /** Período de apuração, "AAAA-MM" — o mês a que o imposto se refere. */
  competencia: string;
  /** Vencimento, "AAAA-MM-DD". */
  vencimento: string;
  valorTotal: number;
  numeroDocumento: string | null;
  cnpj: string | null;
  razaoSocial: string | null;
  /** Quantos trabalhadores a guia do FGTS declarou; null nas demais. */
  trabalhadores: number | null;
  itens: ItemGuiaLido[];
  /** Como esta guia se paga. Null = o PDF não trouxe nem código nem PIX. */
  pagamento: PagamentoDaGuia | null;
}

/**
 * Como a guia se paga — e é isso que separa uma conta a pagar de verdade de um
 * lembrete de que se deve.
 *
 * Sem o código, a conta chega ao IXC e fica parada esperando alguém abrir o PDF
 * e digitar. E os documentos se dividem em dois: DARF, DAS e DARE trazem a
 * linha digitável de arrecadação; a guia do FGTS Digital não traz código
 * nenhum — traz o "copia e cola" do PIX, que é como a Caixa quer receber.
 */
export type PagamentoDaGuia =
  /** Linha digitável de arrecadação: 48 dígitos, começa com 8. */
  | { forma: 'BOLETO'; codigoBarras: string }
  /** O payload EMV do QR Code, que o IXC guarda como chave "copia e cola". */
  | { forma: 'PIX'; copiaECola: string };

/** Erro de leitura com texto que serve para mostrar na tela. */
export class GuiaIlegivelError extends Error {}

/**
 * Códigos de receita conhecidos. Vale mais que a denominação porque o texto
 * do rótulo muda de um ano para o outro; o código, não.
 */
const CLASSE_POR_CODIGO: Record<string, ClasseTributo> = {
  1001: 'FATURAMENTO', // IRPJ
  1002: 'FATURAMENTO', // CSLL
  1004: 'FATURAMENTO', // COFINS
  1005: 'FATURAMENTO', // PIS
  1006: 'FOLHA_PATRONAL', // CPP — a parte patronal do INSS dentro do Simples
  1007: 'FATURAMENTO', // ICMS
  1082: 'FOLHA_RETIDO', // CP descontada do empregado
  1099: 'FOLHA_RETIDO', // CP descontada do contribuinte individual
};

/**
 * Receitas estaduais conhecidas do DARE. Só o nome depende disto — a classe é
 * sempre a mesma: receita de estado não é folha de pagamento.
 */
const RECEITA_ESTADUAL: Record<string, string> = {
  101: 'ICMS',
};

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * Lê o texto de um PDF de guia. Descobre sozinho de qual documento se trata —
 * a pessoa joga o arquivo sem ter de dizer o que é.
 */
export function lerGuia(texto: string): GuiaLida {
  // A forma de pagamento é lida à parte de propósito: ela não muda de um
  // documento para o outro, mora sempre no rodapé, e assim cada leitor continua
  // cuidando só do que é seu — a composição do imposto.
  return { ...escolherLeitor(texto), pagamento: lerPagamento(texto) };
}

function escolherLeitor(texto: string): Omit<GuiaLida, 'pagamento'> {
  // O título do FGTS mora ao lado do logotipo, e o OCR às vezes o perde; o
  // rótulo da composição é só dele e sai sempre.
  if (
    /GFD\s*-\s*Guia do FGTS Digital/i.test(texto) ||
    /Informa\S* de recolhimentos do FGTS/i.test(texto)
  ) {
    return lerFgts(texto);
  }
  if (/Composição do Documento de Arrecadação/i.test(texto)) return lerSenda(texto);
  if (/ARRECADAÇÃO DE RECEITAS ESTADUAIS/i.test(texto)) return lerDare(texto);
  throw new GuiaIlegivelError(
    'Não reconheci este PDF. O leitor entende DARF, DAS do Simples Nacional, ' +
      'guia do FGTS Digital e DARE do ICMS.',
  );
}

/**
 * A linha digitável de arrecadação, no formato em que ela é impressa: quatro
 * blocos de onze dígitos, cada um seguido do seu dígito verificador.
 *
 * O formato é o filtro, e é ele que evita o engano caro: na mesma página existe
 * uma linha que começa igual e termina no CNPJ da empresa
 * ("... 32071626219 7 86.876.109/0001-02"). Tirar os dígitos de qualquer linha
 * comprida daria um código com cara de válido e destino nenhum — o bloco final
 * tem de ser onze dígitos seguidos, e o CNPJ não é.
 */
const LINHA_DIGITAVEL =
  /(\d{11})[-. ]?(\d)\s+(\d{11})[-. ]?(\d)\s+(\d{11})[-. ]?(\d)\s+(\d{11})[-. ]?(\d)(?!\d)/;

/**
 * Como pagar esta guia, lido do próprio documento.
 *
 * Fica exportada porque é usada duas vezes: ao ler o PDF, e depois, ao gerar a
 * conta a pagar a partir do texto guardado — a guia lançada mês passado também
 * merece virar conta sem que ninguém precise achar o arquivo de novo.
 */
export function lerPagamento(texto: string): PagamentoDaGuia | null {
  for (const linha of texto.split(/\r?\n/)) {
    const m = LINHA_DIGITAVEL.exec(linha);
    if (!m) continue;
    const digitos = m.slice(1).join('');
    // Arrecadação (tributo, consumo) começa com 8; cobrança bancária, não. O
    // que não começa com 8 aqui é coincidência de números, não código.
    if (digitos.length === 48 && digitos.startsWith('8')) {
      return { forma: 'BOLETO', codigoBarras: digitos };
    }
  }

  /*
   * O PIX vem como o payload inteiro do QR Code, numa linha só: começa em
   * "000201" e termina no CRC ("6304" + quatro caracteres). Logo abaixo dele o
   * PDF do FGTS imprime "PIX Copia e Cola:" seguido de uma URL — que **não** é
   * o copia e cola, é só o endereço do QR. Pegar o rótulo em vez do payload
   * daria uma chave que nenhum banco paga.
   */
  for (const bruto of texto.split(/\r?\n/)) {
    const linha = bruto.trim();
    if (linha.startsWith('000201') && /6304[0-9A-Fa-f]{4}$/.test(linha)) {
      return { forma: 'PIX', copiaECola: linha };
    }
  }

  return null;
}

/**
 * DARF e DAS: mesma diagramação do SENDA, muda só o título e os códigos. A
 * composição vem em linhas "código denominação valor valor", onde o último
 * número é o total do item (principal + multa + juros).
 */
function lerSenda(texto: string): Omit<GuiaLida, 'pagamento'> {
  const linhas = texto.split('\n').map((l) => l.trim());
  const ehSimples = /do Simples Nacional/i.test(texto);

  const itens: ItemGuiaLido[] = [];
  for (const linha of linhas) {
    const m = /^(\d{4})\s+(.*?)((?:\s+[\d.]+,\d{2})+)$/.exec(linha);
    if (!m) continue;
    const valores = m[3].trim().split(/\s+/);
    const denominacao = m[2].trim();
    if (!denominacao) continue;
    itens.push({
      codigo: m[1],
      denominacao,
      // O último número da linha é o total do item; os anteriores são o
      // principal e, quando há, multa e juros.
      valor: parseValor(valores[valores.length - 1]),
      ...classificar(m[1], denominacao),
    });
  }

  const valorTotal =
    valorDepoisDe(texto, /Valor:\s*/) ??
    valorDepoisDe(texto, /Totais\s+/) ??
    somaDosItens(itens);

  return {
    tipo: ehSimples ? 'DAS_SIMPLES' : 'DARF_INSS',
    competencia: competenciaPorExtenso(texto),
    vencimento: vencimento(texto),
    valorTotal,
    numeroDocumento: /Número:\s*([\d.-]+)/.exec(texto)?.[1] ?? null,
    cnpj: /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(texto)?.[1] ?? null,
    razaoSocial: razaoSocialSenda(texto),
    trabalhadores: null,
    itens,
  };
}

/**
 * FGTS Digital. Não tem código de receita e as colunas saem embaralhadas, então
 * os dois valores que interessam vêm dos totais rotulados: o FGTS do mês (custo
 * da empresa) e o consignado, que é desconto do trabalhador sendo repassado.
 */
function lerFgts(texto: string): Omit<GuiaLida, 'pagamento'> {
  const fgts = valorDepoisDe(texto, /Total FGTS:\s*/);
  const consignado = valorDepoisDe(texto, /Total Consignado:\s*/);

  const itens: ItemGuiaLido[] = [];
  if (fgts !== null && fgts > 0) {
    itens.push({
      codigo: null,
      denominacao: 'FGTS mensal',
      valor: fgts,
      classe: 'FOLHA_PATRONAL',
      classeIncerta: false,
    });
  }
  if (consignado !== null && consignado > 0) {
    itens.push({
      codigo: null,
      denominacao: 'Consignado retido do trabalhador',
      valor: consignado,
      classe: 'FOLHA_RETIDO',
      classeIncerta: false,
    });
  }

  const valorTotal =
    valorDepoisDe(texto, /Total da Guia:\s*/) ??
    valorDepoisDe(texto, /Valor a recolher\s*/) ??
    somaDosItens(itens);

  // A linha "Tag" resume a guia: CNPJ base, competência e modalidade. Lida da
  // imagem, a linha que sobra é a da composição — "08/2026 24 3.924,89 …",
  // competência, trabalhadores e o FGTS do mês.
  const tag = /^\s*(\d{8})\s+(\d{2})\/(\d{4})\s+\w+/m.exec(texto);
  const composicao = /^\s*(\d{2})\/(\d{4})\s+(\d+)\s+[\d.]+,\d{2}/m.exec(texto);
  const competencia = tag
    ? `${tag[3]}-${tag[2]}`
    : composicao
      ? `${composicao[2]}-${composicao[1]}`
      : null;
  if (!competencia) {
    throw new GuiaIlegivelError(
      'Guia do FGTS sem a linha de competência — o arquivo pode estar incompleto.',
    );
  }

  return {
    tipo: 'FGTS',
    competencia,
    vencimento: vencimento(texto),
    valorTotal,
    numeroDocumento: depoisDoRotulo(texto, 'Identificador'),
    cnpj: /(\d{2}\.\d{3}\.\d{3})/.exec(texto)?.[1] ?? null,
    razaoSocial: depoisDoRotulo(texto, 'Nome/Razão Social do Empregador'),
    // Na linha da composição, a quantidade vem logo depois da competência.
    trabalhadores:
      numeroDepoisDe(texto, /\d{2}\/\d{4}\s+(\d+)\s*$/m) ??
      (composicao ? Number(composicao[3]) : null),
    itens,
  };
}

/**
 * DARE estadual (SEFAZ) — é por onde o ICMS é pago.
 *
 * Da "Relação de Pagamentos" só saem daqui o período e o código da receita. O
 * gerador do documento entrega as colunas daquela tabela fora de ordem e
 * coladas umas nas outras ("0,0024,2506/20263059"): as quatro colunas de
 * dinheiro — principal, juros, multa e total — chegam embaralhadas e não dá
 * para dizer qual número é qual. Chutar ali é errar o valor do imposto.
 *
 * Os totais, esses, vêm rotulados em linha própria ("Valor Principal", "Total
 * Juros", "Total Multa") e são lidos como no resto do arquivo. O total é
 * conferido contra a linha digitável, que carrega o valor em centavos e é
 * montada por outro caminho do documento: quando as duas contas não batem, a
 * tela avisa antes de gravar.
 */
function lerDare(texto: string): Omit<GuiaLida, 'pagamento'> {
  const { competencias, codigos, vencimento } = lerRelacaoDare(texto);
  if (competencias.length === 0) {
    throw new GuiaIlegivelError(
      'Não achei a relação de pagamentos do DARE — o arquivo pode estar incompleto.',
    );
  }

  const principal =
    valorDepoisDoRotulo(texto, 'Valor Principal') ??
    valorDepoisDoRotulo(texto, 'Total Principal');
  if (principal === null || principal <= 0) {
    throw new GuiaIlegivelError(
      'Não achei o valor principal do DARE — confira se o PDF veio inteiro.',
    );
  }
  // Só os rótulos do quadro de totais servem: no canhoto o número vem *antes*
  // do rótulo ("0,00 / Juros"), e ler o de baixo daria a multa no lugar do juro
  // e o total no lugar da multa. Faltando o quadro, juro e multa ficam em zero
  // — e é a linha digitável, abaixo, que denuncia a diferença.
  const juros = valorDepoisDoRotulo(texto, 'Total Juros') ?? 0;
  const multa = valorDepoisDoRotulo(texto, 'Total Multa') ?? 0;

  const conhecidas = codigos.every((c) => c in RECEITA_ESTADUAL);
  const itens: ItemGuiaLido[] = [
    {
      codigo: codigos.join('/') || null,
      denominacao: `${codigos
        .map((c) => RECEITA_ESTADUAL[c] ?? `receita ${c}`)
        .join(' + ')} — DARE estadual`,
      valor: principal,
      // Receita de estado nunca é custo de pessoal; o que o código muda é só o
      // nome. Código novo sai marcado do mesmo jeito, para alguém conferir.
      classe: 'FATURAMENTO',
      classeIncerta: !conhecidas,
    },
  ];
  if (juros + multa > 0) {
    itens.push({
      codigo: null,
      denominacao: 'Juros e multa',
      valor: arredondar(juros + multa),
      classe: 'FATURAMENTO',
      classeIncerta: false,
    });
  }

  return {
    tipo: 'DARE_ICMS',
    // Pagando dois meses no mesmo documento, a guia é do mais antigo — é a
    // apuração que ela quita primeiro.
    competencia: competencias[0],
    vencimento,
    valorTotal: valorDaLinhaDigitavel(texto) ?? somaDosItens(itens),
    numeroDocumento: depoisDoRotulo(texto, 'Nosso Número'),
    cnpj: /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(texto)?.[1] ?? null,
    razaoSocial: razaoSocialDare(texto),
    trabalhadores: null,
    itens,
  };
}

/**
 * As linhas da "Relação de Pagamentos". Cada uma termina no par que o
 * embaralhamento das colunas não alcança: a data de vencimento seguida do
 * código da receita. O período de apuração é o outro `MM/AAAA` da linha.
 */
function lerRelacaoDare(texto: string): {
  competencias: string[];
  codigos: string[];
  vencimento: string;
} {
  const competencias = new Set<string>();
  const codigos = new Set<string>();
  let vencimento = '';

  for (const linha of texto.split('\n').map((l) => l.trim())) {
    const fim = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,4})$/.exec(linha);
    if (!fim) continue;
    const referencia = /(\d{2})\/(\d{4})/.exec(linha.slice(0, fim.index));
    if (!referencia) continue;

    competencias.add(`${referencia[2]}-${referencia[1]}`);
    codigos.add(fim[4]);
    if (!vencimento) vencimento = `${fim[3]}-${fim[2]}-${fim[1]}`;
  }

  return {
    competencias: [...competencias].sort(),
    codigos: [...codigos].sort(),
    vencimento,
  };
}

/**
 * O valor na linha digitável do documento de arrecadação: onze dígitos em
 * centavos logo depois do prefixo de quatro. Vale como conferência porque é
 * gerado longe dos totais impressos — e é o que o banco vai cobrar.
 */
function valorDaLinhaDigitavel(texto: string): number | null {
  const m = /Linha digit[áa]vel:\s*([\d ]+)/.exec(texto);
  if (!m) return null;

  // Quatro blocos de onze dígitos, cada um seguido do seu dígito verificador —
  // que não faz parte do código de barras.
  const codigo = m[1]
    .trim()
    .split(/\s+/)
    .filter((bloco) => bloco.length === 11)
    .join('');
  if (codigo.length !== 44) return null;

  const centavos = Number(codigo.slice(4, 15));
  return centavos > 0 ? arredondar(centavos / 100) : null;
}

/** Rótulos do cabeçalho do DARE, que vêm em bloco antes dos valores. */
const ROTULOS_DARE =
  /Inscrição Estadual|Endereço|Válido Até|CPF\/CNPJ|Telefone|CEP|Município/i;

/**
 * Razão social: no DARE os rótulos do cabeçalho saem em bloco e os valores
 * logo depois, então é a primeira linha após "Nome/ Razão Social" que não seja
 * outro rótulo.
 */
function razaoSocialDare(texto: string): string | null {
  const linhas = texto.split('\n').map((l) => l.trim());
  const i = linhas.findIndex((l) => /^Nome\/\s*Raz[ãa]o Social/i.test(l));
  if (i < 0) return null;
  return (
    linhas.slice(i + 1, i + 5).find((l) => l && !ROTULOS_DARE.test(l)) ?? null
  );
}

/** Classe do item: pelo código quando conhecido, pela denominação quando não. */
function classificar(
  codigo: string | null,
  denominacao: string,
): { classe: ClasseTributo; classeIncerta: boolean } {
  const conhecido = codigo ? CLASSE_POR_CODIGO[codigo] : undefined;
  if (conhecido) return { classe: conhecido, classeIncerta: false };

  // Código novo: o palpite vale para não travar o lançamento, mas a tela
  // avisa. Errar aqui é somar imposto de faturamento no custo de pessoal.
  if (/descontad|segurado|retid|consignad/i.test(denominacao)) {
    return { classe: 'FOLHA_RETIDO', classeIncerta: true };
  }
  if (/fgts|patronal|previdenciári|cpp/i.test(denominacao)) {
    return { classe: 'FOLHA_PATRONAL', classeIncerta: true };
  }
  return { classe: 'FATURAMENTO', classeIncerta: true };
}

/** "Julho/2026" → "2026-07". */
function competenciaPorExtenso(texto: string): string {
  const m = new RegExp(`(${MESES.join('|')})\\s*/\\s*(\\d{4})`, 'i').exec(texto);
  if (m) {
    const mes = MESES.indexOf(m[1].toLowerCase()) + 1;
    return `${m[2]}-${String(mes).padStart(2, '0')}`;
  }
  // Alguns documentos só trazem "PA:07/2026" na composição.
  const pa = /PA:\s*(\d{2})\/(\d{4})/.exec(texto);
  if (pa) return `${pa[2]}-${pa[1]}`;
  throw new GuiaIlegivelError(
    'Não achei o período de apuração no documento.',
  );
}

function vencimento(texto: string): string {
  const m =
    /Pagar até:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(texto) ??
    /Pagar este documento até\s*\n?\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(texto) ??
    // Lida da imagem, a data do quadro vem na linha de baixo, depois dos
    // rótulos dos quadros vizinhos ("CPF/CNPJ do Empregador … 18/09/2026").
    /Pagar este documento até[^\n]*\n[^\n]*?(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);
  if (!m) {
    throw new GuiaIlegivelError('Não achei a data de vencimento no documento.');
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Razão social: vem na mesma linha do CNPJ, logo depois dele. */
function razaoSocialSenda(texto: string): string | null {
  const m = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s+(.+)$/m.exec(texto);
  return m ? m[1].trim() : null;
}

/** Primeiro valor monetário depois de um rótulo (pode estar na linha seguinte). */
function valorDepoisDe(texto: string, rotulo: RegExp): number | null {
  const re = new RegExp(rotulo.source + '\\s*([\\d.]+,\\d{2})');
  const m = re.exec(texto);
  return m ? parseValor(m[1]) : null;
}

function numeroDepoisDe(texto: string, re: RegExp): number | null {
  const m = re.exec(texto);
  return m ? Number(m[1]) : null;
}

/** Conteúdo da linha seguinte a um rótulo isolado. */
function depoisDoRotulo(texto: string, rotulo: string): string | null {
  const linhas = texto.split('\n').map((l) => l.trim());
  const i = linhas.findIndex((l) => l === rotulo);
  return i >= 0 && linhas[i + 1] ? linhas[i + 1] : null;
}

/** Valor monetário na linha logo abaixo de um rótulo isolado. */
function valorDepoisDoRotulo(texto: string, rotulo: string): number | null {
  const linha = depoisDoRotulo(texto, rotulo);
  return linha && /^[\d.]+,\d{2}$/.test(linha) ? parseValor(linha) : null;
}

function somaDosItens(itens: ItemGuiaLido[]): number {
  return arredondar(itens.reduce((s, i) => s + i.valor, 0));
}

/** "4.310,76" → 4310.76 */
export function parseValor(bruto: string): number {
  return arredondar(Number(bruto.replace(/\./g, '').replace(',', '.')));
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Confere se a soma dos itens bate com o total impresso. Diferença aqui quer
 * dizer que o leitor perdeu (ou inventou) uma linha — e é melhor a pessoa saber
 * disso antes de gravar do que o gráfico mentir depois.
 */
export function conferir(guia: GuiaLida): string | null {
  if (guia.itens.length === 0) return 'Não achei nenhum item na composição.';
  const soma = somaDosItens(guia.itens);
  if (Math.abs(soma - guia.valorTotal) < 0.01) return null;
  return `A soma dos itens (${soma.toFixed(2)}) não bate com o total do documento (${guia.valorTotal.toFixed(2)}).`;
}
