/**
 * O extrato da conta da ModoBank, montado pela API do banco.
 *
 * Pedido de 04/11/2026: "já que tá integrado com o banco", o PDF, o Excel e o
 * OFX da conta não precisam ser baixados do portal e enviados à mão — o
 * sistema os monta com os lançamentos que a API devolve.
 *
 * A documentação do extrato é magra (cita só Pix e boleto, e não diz onde vem
 * o nome de quem pagou), então cada campo aqui aceita mais de um nome. A
 * garantia de que nada faltou não vem da documentação: vem da conferência com
 * o saldo que o próprio banco informa (`conferirComOBanco`) — saldo inicial
 * mais o que entrou menos o que saiu tem de dar o saldo final, ao centavo.
 */

import PDFDocument from 'pdfkit';
import type { Aba } from './planilha';

/** Um lançamento do extrato, já com sinal e no dia de Brasília. */
export interface LancamentoDoExtrato {
  id: string;
  /** "AAAA-MM-DD", em Brasília. */
  dia: string;
  /** "HH:MM", em Brasília. */
  hora: string;
  /** Positivo = entrou; negativo = saiu. Em reais, arredondado ao centavo. */
  valor: number;
  /** "Pix", "Boleto", "TED"… */
  tipo: string;
  /** "Pix recebido", "Boleto pago"… */
  descricao: string;
  /** Quem pagou (na entrada) ou quem recebeu (na saída), quando o banco diz. */
  contraparte: string | null;
  documento: string | null;
  situacao: string;
  endToEndId: string | null;
}

/** As situações que não são dinheiro que andou: ficam fora do extrato. */
const FORA_DO_EXTRATO = new Set([
  'CANCELED',
  'CANCELLED',
  'PROCESSING',
  'ON_QUEUE',
  'WAITING_APPROVAL',
  'WAITING_CONFIRMATION',
  'REJECTED',
  'PENDING',
  'FAILED',
]);

export function entraNoExtrato(situacao: string): boolean {
  return !FORA_DO_EXTRATO.has(situacao.toUpperCase());
}

const TIPOS: Record<string, string> = {
  PIX: 'Pix',
  BILLET: 'Boleto',
  BOLETO: 'Boleto',
  TED: 'TED',
  INTERNAL_TRANSFER: 'Transferência interna',
  P2P: 'Transferência interna',
  FEE: 'Tarifa',
  TARIFF: 'Tarifa',
  // Os R$ 0,22 que a própria ModoBank (MODO PAGAMENTOS S.A.) debita a cada
  // Pix recebido: um por entrada, milhares no mês.
  AUTHORIZED_DEBIT: 'Débito autorizado',
};

/** O tipo que não tem "recebido/enviado": o nome dele já diz o que é. */
const DESCRICAO_DO_TIPO: Record<string, string> = {
  'Débito autorizado': 'Débito autorizado',
  Tarifa: 'Tarifa',
};

/**
 * A saída que o banco desfez: o detalhe mostra que ela voltou (devolução no
 * `refunds`) ou que não se completou. Em out/2026 a lista trouxe Pix enviados
 * como LIQUIDATED — R$ 5.000,00 em 05/10, R$ 21.083,84 em 23/10 — que o saldo
 * da conta não registra, e sem nenhuma volta na lista: só o detalhe diz.
 */
export function saidaDesfeita(l: LancamentoDoExtrato, detalhe: Record<string, unknown> | null): boolean {
  if (l.valor >= 0 || !detalhe) return false;
  const situacao = String(detalhe.status ?? '').toUpperCase();
  if (situacao && (situacao === 'REFUNDED' || !entraNoExtrato(situacao))) return true;
  const devolucoes = Array.isArray(detalhe.refunds) ? detalhe.refunds : [];
  let devolvido = 0;
  for (const d of devolucoes) {
    const o = objeto(d);
    if (!o) continue;
    const st = String(o.status ?? '').toUpperCase();
    if (st && !entraNoExtrato(st)) continue;
    const valor =
      numeroDoBanco(objeto(o.pixRefundAmount)?.amount) ?? numeroDoBanco(objeto(o.amount)?.amount) ?? numeroDoBanco(o.amount);
    devolvido += centavos(Math.abs(valor ?? 0));
  }
  return devolvido > 0 && devolvido >= centavos(-l.valor);
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function textoDe(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Número que o banco manda como número ou como texto ("1234.56"). */
export function numeroDoBanco(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const centavos = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;

/**
 * O dia e a hora em Brasília de um instante ISO. O banco manda em UTC ou com
 * fuso; o extrato é lido aqui, e o Pix das 22h do dia 31 é do dia 31.
 */
export function diaEHoraEmBrasilia(iso: string): { dia: string; hora: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // Sem horário de verão desde 2019: Brasília é UTC−3 o ano todo.
  const local = new Date(t - 3 * 3600_000).toISOString();
  return { dia: local.slice(0, 10), hora: local.slice(11, 16) };
}

/** Quem está do outro lado: na entrada, quem pagou; na saída, quem recebeu. */
export function contraparteDe(
  d: Record<string, unknown>,
  entrada: boolean,
): { nome: string | null; documento: string | null } {
  const lados = entrada
    ? [d.debtorAccount, d.debtor, d.payer, d.counterpart, d.counterparty]
    : [d.creditorAccount, d.creditor, d.receiver, d.payee, d.counterpart, d.counterparty];
  for (const lado of lados) {
    const o = objeto(lado);
    const nome = textoDe(o?.name) ?? textoDe(o?.nome);
    if (nome) return { nome, documento: textoDe(o?.document) ?? textoDe(o?.taxId) ?? null };
  }
  return { nome: null, documento: null };
}

/**
 * Um lançamento cru da API vira linha do extrato. Null = sem valor ou sem
 * data legível (não dá para pôr no papel; a conferência dos saldos acusa).
 */
export function lerTransacao(b: Record<string, unknown>): LancamentoDoExtrato | null {
  const instante = textoDe(b.eventDate) ?? textoDe(b.bookingDate) ?? textoDe(b.createdAt);
  const quando = instante ? diaEHoraEmBrasilia(instante) : null;
  const montante = objeto(b.transactionAmount) ?? objeto(b.payment) ?? objeto(b.amount);
  const bruto =
    numeroDoBanco(montante?.available) ??
    numeroDoBanco(montante?.amount) ??
    numeroDoBanco(montante?.value) ??
    numeroDoBanco(b.amount) ??
    numeroDoBanco(b.value);
  if (!quando || bruto === null) return null;

  const lado = String(b.creditDebitType ?? b.type ?? '').toUpperCase();
  const entrada = lado === 'CREDIT' ? true : lado === 'DEBIT' ? false : bruto >= 0;
  const valor = reais(centavos(Math.abs(bruto))) * (entrada ? 1 : -1);

  const tipoCru = String(b.transactionType ?? '').toUpperCase();
  const tipo = TIPOS[tipoCru] ?? (tipoCru ? tipoCru.charAt(0) + tipoCru.slice(1).toLowerCase() : 'Lançamento');
  const descricao =
    textoDe(b.description) ??
    textoDe(b.descricao) ??
    DESCRICAO_DO_TIPO[tipo] ??
    (tipo === 'Boleto'
      ? entrada
        ? 'Boleto recebido'
        : 'Boleto pago'
      : `${tipo} ${entrada ? 'recebido' : 'enviado'}`);
  const outro = contraparteDe(b, entrada);

  return {
    id: textoDe(b.id) ?? textoDe(b.endToEndId) ?? `${quando.dia}-${quando.hora}-${valor}`,
    dia: quando.dia,
    hora: quando.hora,
    valor,
    tipo,
    descricao,
    contraparte: outro.nome,
    documento: outro.documento,
    situacao: String(b.status ?? '').toUpperCase(),
    endToEndId: textoDe(b.endToEndId),
  };
}

/** O extrato inteiro, pronto para virar papel. */
export interface ExtratoDoBanco {
  conta: { nome: string; banco: string; agencia: string; numero: string };
  de: string;
  ate: string;
  geradoEm: Date;
  lancamentos: LancamentoDoExtrato[];
  /** Do resumo do banco. Null = o banco não informou (período em aberto). */
  saldoInicial: number | null;
  saldoFinal: number | null;
  /** A conferência com o banco, numa frase — vai no papel também. */
  conferencia: string;
}

/** O resumo do banco (consolidado) para o período. */
export interface ResumoDoBanco {
  saldoInicial: number | null;
  saldoFinal: number | null;
  entradas: number | null;
  saidas: number | null;
  movimentos: number | null;
  /** O que o banco diz de cada dia (só no resumo por dia), em centavos. */
  dias: Array<{ dia: string; entradas: number; saidas: number }>;
}

/**
 * Junta os períodos do consolidado (um por dia ou por mês) num resumo só: o
 * saldo inicial é o do primeiro, o final é o do último.
 */
export function resumoDoConsolidado(periodos: Array<Record<string, unknown>>): ResumoDoBanco {
  const ordenados = [...periodos].sort((a, b) =>
    String(a.periodDate ?? '').localeCompare(String(b.periodDate ?? '')),
  );
  if (ordenados.length === 0) {
    return { saldoInicial: null, saldoFinal: null, entradas: null, saidas: null, movimentos: null, dias: [] };
  }
  let entradas = 0;
  let saidas = 0;
  let movimentos = 0;
  const dias: ResumoDoBanco['dias'] = [];
  for (const p of ordenados) {
    const e = centavos(Math.abs(numeroDoBanco(p.creditAmount) ?? 0));
    const s = centavos(Math.abs(numeroDoBanco(p.debitAmount) ?? 0));
    entradas += e;
    saidas += s;
    movimentos += numeroDoBanco(p.movementCount) ?? 0;
    const dia = String(p.periodDate ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) dias.push({ dia, entradas: e, saidas: s });
  }
  return {
    saldoInicial: numeroDoBanco(ordenados[0].initialBalance),
    saldoFinal: numeroDoBanco(ordenados[ordenados.length - 1].finalBalance),
    entradas: reais(entradas),
    saidas: reais(saidas),
    movimentos,
    dias,
  };
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

/** Entradas e saídas de uma lista, em centavos. */
function totais(ls: LancamentoDoExtrato[]): { entradas: number; saidas: number } {
  let entradas = 0;
  let saidas = 0;
  for (const l of ls) {
    if (l.valor > 0) entradas += centavos(l.valor);
    else saidas -= centavos(l.valor);
  }
  return { entradas, saidas };
}

/** O que separar as situações e os dias encontrou. */
export interface FechamentoComOBanco {
  /** Os lançamentos que ficam no extrato. */
  lancamentos: LancamentoDoExtrato[];
  /** Situação → quantos, e quanto entrou e saiu (em reais), de tudo o que veio. */
  porSituacao: Record<string, { n: number; entradas: number; saidas: number }>;
  /** As situações deixadas de fora porque o banco não as conta (achadas pela soma). */
  tiradasPelaSoma: string[];
  /** Os dias em que o extrato montado não bate com o banco (até 10). */
  diasQueNaoBatem: Array<{ dia: string; entradas: number; saidas: number; bancoEntradas: number; bancoSaidas: number }>;
}

/**
 * Escolhe o que entra no extrato de modo que ele feche com o banco.
 *
 * A lista fixa de situações (`entraNoExtrato`) é o ponto de partida, mas a
 * documentação não diz todas: o primeiro extrato de verdade (out/2026) trouxe
 * R$ 26 mil de saídas a mais que o banco, com as entradas certas ao centavo.
 * Então, não fechando, as situações além de `LIQUIDATED` são testadas fora e
 * dentro: a combinação que faz entradas **e** saídas baterem ao centavo com o
 * banco é a certa — coincidência nesse grau não acontece. Achando mais de uma
 * do mesmo tamanho, nenhuma é escolhida.
 *
 * Não fechando de jeito nenhum, devolve os dias em que o extrato e o banco
 * discordam: é por eles que alguém confere à mão.
 */
export function fecharComOBanco(
  todos: LancamentoDoExtrato[],
  resumo: ResumoDoBanco | null,
): FechamentoComOBanco {
  const porSituacao: FechamentoComOBanco['porSituacao'] = {};
  for (const l of todos) {
    const s = (porSituacao[l.situacao || '(sem)'] ??= { n: 0, entradas: 0, saidas: 0 });
    s.n++;
    if (l.valor > 0) s.entradas = reais(centavos(s.entradas) + centavos(l.valor));
    else s.saidas = reais(centavos(s.saidas) - centavos(l.valor));
  }
  const base = todos.filter((l) => entraNoExtrato(l.situacao));
  const semBanco = { lancamentos: base, porSituacao, tiradasPelaSoma: [], diasQueNaoBatem: [] };
  if (!resumo || resumo.entradas === null || resumo.saidas === null) return semBanco;

  const alvo = { entradas: centavos(resumo.entradas), saidas: centavos(resumo.saidas) };
  const bate = (ls: LancamentoDoExtrato[]) => {
    const t = totais(ls);
    return t.entradas === alvo.entradas && t.saidas === alvo.saidas;
  };
  if (bate(base)) return semBanco;

  const duvidosas = [...new Set(todos.map((l) => l.situacao))].filter((s) => s !== 'LIQUIDATED').sort();
  if (duvidosas.length <= 12) {
    const combinacoes = Array.from({ length: 1 << duvidosas.length }, (_, m) => m).sort(
      (a, b) => bits(a) - bits(b) || a - b,
    );
    let achada: number | null = null;
    let tamanho = -1;
    let empate = false;
    for (const m of combinacoes) {
      if (achada !== null && bits(m) > tamanho) break;
      const fora = new Set(duvidosas.filter((_, i) => m & (1 << i)));
      if (bate(todos.filter((l) => !fora.has(l.situacao)))) {
        if (achada === null) {
          achada = m;
          tamanho = bits(m);
        } else empate = true;
      }
    }
    if (achada !== null && !empate) {
      const fora = new Set(duvidosas.filter((_, i) => achada! & (1 << i)));
      return {
        lancamentos: todos.filter((l) => !fora.has(l.situacao)),
        porSituacao,
        tiradasPelaSoma: [...fora].filter((s) => entraNoExtrato(s)),
        diasQueNaoBatem: [],
      };
    }
  }

  const diasQueNaoBatem: FechamentoComOBanco['diasQueNaoBatem'] = [];
  for (const d of resumo.dias) {
    const t = totais(base.filter((l) => l.dia === d.dia));
    if (t.entradas !== d.entradas || t.saidas !== d.saidas) {
      diasQueNaoBatem.push({
        dia: d.dia,
        entradas: reais(t.entradas),
        saidas: reais(t.saidas),
        bancoEntradas: reais(d.entradas),
        bancoSaidas: reais(d.saidas),
      });
    }
  }
  return { lancamentos: base, porSituacao, tiradasPelaSoma: [], diasQueNaoBatem: diasQueNaoBatem.slice(0, 10) };
}

function bits(m: number): number {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
}

/** O aviso de quando não fecha: por situação e por dia, para conferir à mão. */
export function detalheDoQueNaoFecha(f: FechamentoComOBanco): string {
  const situacoes = Object.entries(f.porSituacao)
    .map(([s, v]) => `${s} ${v.n} (entradas ${brl(v.entradas)}, saídas ${brl(v.saidas)})`)
    .join('; ');
  const dias = f.diasQueNaoBatem
    .map(
      (d) =>
        `${diaBr(d.dia)}: saídas ${brl(d.saidas)} × banco ${brl(d.bancoSaidas)}` +
        (d.entradas !== d.bancoEntradas ? `, entradas ${brl(d.entradas)} × banco ${brl(d.bancoEntradas)}` : ''),
    )
    .join('; ');
  return [`Por situação: ${situacoes}.`, dias && `Dias que não batem: ${dias}.`].filter(Boolean).join(' ');
}

/**
 * Os lançamentos fecham com o banco? Devolve a frase da conferência e, quando
 * não fecham, o aviso para a tela.
 */
export function conferirComOBanco(
  lancamentos: LancamentoDoExtrato[],
  resumo: ResumoDoBanco | null,
): { frase: string; aviso: string | null } {
  const entradas = lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + centavos(l.valor), 0);
  const saidas = lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - centavos(l.valor), 0);
  if (!resumo || resumo.saldoInicial === null || resumo.saldoFinal === null) {
    return {
      frase: 'Sem o saldo do banco para conferir (período ainda em aberto).',
      aviso: null,
    };
  }
  const esperado = centavos(resumo.saldoFinal) - centavos(resumo.saldoInicial);
  const diferenca = entradas - saidas - esperado;
  if (diferenca === 0) {
    return {
      frase:
        `Conferido com o banco: saldo inicial ${brl(resumo.saldoInicial)}, ` +
        `mais ${brl(reais(entradas))} de entradas, menos ${brl(reais(saidas))} de saídas, ` +
        `dá o saldo final ${brl(resumo.saldoFinal)}.`,
      aviso: null,
    };
  }
  const texto =
    `Os lançamentos não fecham com o saldo do banco: diferença de ${brl(reais(diferenca))} ` +
    `(saldo ${brl(resumo.saldoInicial)} → ${brl(resumo.saldoFinal)}; ` +
    `entradas ${brl(reais(entradas))}, saídas ${brl(reais(saidas))}` +
    (resumo.entradas !== null && resumo.saidas !== null
      ? `; o banco diz ${brl(resumo.entradas)} e ${brl(resumo.saidas)}`
      : '') +
    ').';
  return { frase: texto, aviso: `ModoBank: ${texto} Confira antes de mandar à contabilidade.` };
}

// ---------------------------------------------------------------------------
// OFX
// ---------------------------------------------------------------------------

/** "2026-10-31" + "23:59" → "20261031235900[-3:BRT]". */
function quandoNoOfx(dia: string, hora = '00:00', segundos = '00'): string {
  return `${dia.replace(/-/g, '')}${hora.replace(':', '')}${segundos}[-3:BRT]`;
}

/** Texto que cabe numa etiqueta do OFX 1: sem `<`, `>` nem quebra de linha. */
function textoDoOfx(v: string, max: number): string {
  return v
    .replace(/[<>\r\n]+/g, ' ')
    .replace(/&/g, 'e')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * O OFX 1.02 (SGML) — o dialeto que os sistemas de contabilidade importam sem
 * reclamar —, em Windows-1252, como os bancos brasileiros mandam.
 */
export function ofxDoExtrato(e: ExtratoDoBanco): Buffer {
  const agora = diaEHoraEmBrasilia(e.geradoEm.toISOString())!;
  const linhas = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    `<DTSERVER>${quandoNoOfx(agora.dia, agora.hora)}`,
    '<LANGUAGE>POR',
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<TRNUID>1',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<STMTRS>',
    '<CURDEF>BRL',
    '<BANKACCTFROM>',
    `<BANKID>${textoDoOfx(e.conta.banco || '000', 9)}`,
    `<BRANCHID>${textoDoOfx(e.conta.agencia || '0', 22)}`,
    `<ACCTID>${textoDoOfx(e.conta.numero || '0', 22)}`,
    '<ACCTTYPE>CHECKING',
    '</BANKACCTFROM>',
    '<BANKTRANLIST>',
    `<DTSTART>${quandoNoOfx(e.de)}`,
    `<DTEND>${quandoNoOfx(e.ate, '23:59', '59')}`,
  ];
  for (const l of e.lancamentos) {
    linhas.push(
      '<STMTTRN>',
      `<TRNTYPE>${l.valor >= 0 ? 'CREDIT' : 'DEBIT'}`,
      `<DTPOSTED>${quandoNoOfx(l.dia, l.hora)}`,
      `<TRNAMT>${l.valor.toFixed(2)}`,
      `<FITID>${textoDoOfx(l.id, 255)}`,
    );
    if (l.contraparte) linhas.push(`<NAME>${textoDoOfx(l.contraparte, 32)}`);
    linhas.push(`<MEMO>${textoDoOfx([l.descricao, l.contraparte].filter(Boolean).join(' - '), 255)}`, '</STMTTRN>');
  }
  linhas.push('</BANKTRANLIST>');
  if (e.saldoFinal !== null) {
    linhas.push(
      '<LEDGERBAL>',
      `<BALAMT>${e.saldoFinal.toFixed(2)}`,
      `<DTASOF>${quandoNoOfx(e.ate, '23:59', '59')}`,
      '</LEDGERBAL>',
    );
  }
  linhas.push('</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>', '</OFX>', '');
  // 1252 e latin1 coincidem nas letras do português; o que não couber vira "?".
  return Buffer.from(
    linhas.join('\r\n').replace(/[^\t\n\r -ÿ]/g, '?'),
    'latin1',
  );
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export const diaBr = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

function nomeDaConta(e: ExtratoDoBanco): string {
  const partes = [e.conta.agencia && `ag. ${e.conta.agencia}`, e.conta.numero && `c/c ${e.conta.numero}`].filter(Boolean);
  return [e.conta.nome, ...partes].join(' · ');
}

/** O saldo depois de cada lançamento, quando o inicial é conhecido. */
function saldosCorridos(e: ExtratoDoBanco): Array<number | null> {
  if (e.saldoInicial === null) return e.lancamentos.map(() => null);
  let saldo = centavos(e.saldoInicial);
  return e.lancamentos.map((l) => {
    saldo += centavos(l.valor);
    return reais(saldo);
  });
}

export function abaDoExtrato(e: ExtratoDoBanco): Aba {
  const saldos = saldosCorridos(e);
  const entradas = e.lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + centavos(l.valor), 0);
  const saidas = e.lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - centavos(l.valor), 0);
  return {
    nome: 'Extrato',
    cabecalho: [
      `Extrato — ${nomeDaConta(e)}`,
      `Período: ${diaBr(e.de)} a ${diaBr(e.ate)}`,
      e.saldoInicial !== null ? `Saldo inicial: ${brl(e.saldoInicial)}` : 'Saldo inicial: não informado pelo banco',
      e.conferencia,
      `Montado pela API do banco em ${e.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    ],
    colunas: [
      { titulo: 'Data', tipo: 'data' },
      { titulo: 'Hora', tipo: 'texto', largura: 7 },
      { titulo: 'Tipo', tipo: 'texto', largura: 12 },
      { titulo: 'Descrição', tipo: 'texto', largura: 22 },
      { titulo: 'Quem pagou / recebeu', tipo: 'texto', largura: 36 },
      { titulo: 'CPF/CNPJ', tipo: 'texto', largura: 18 },
      { titulo: 'Entrada', tipo: 'moeda' },
      { titulo: 'Saída', tipo: 'moeda' },
      { titulo: 'Saldo', tipo: 'moeda' },
      { titulo: 'Situação no banco', tipo: 'texto', largura: 16 },
      { titulo: 'Identificador', tipo: 'texto', largura: 38 },
    ],
    linhas: e.lancamentos.map((l, i) => [
      l.dia,
      l.hora,
      l.tipo,
      l.descricao,
      l.contraparte ?? '',
      l.documento ?? '',
      l.valor > 0 ? l.valor : null,
      l.valor < 0 ? -l.valor : null,
      saldos[i],
      l.situacao,
      l.endToEndId ?? l.id,
    ]),
    totais: ['Total', '', '', '', '', '', reais(entradas), reais(saidas), e.saldoFinal, '', ''],
  };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const MARGEM = 36;
const TINTA = '#16181c';
const TINTA_FRACA = '#6b7280';
const FIO = '#d1d5db';

/** O extrato em PDF: cabeçalho, resumo, a lista e a conferência com o banco. */
export function pdfDoExtrato(e: ExtratoDoBanco): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
  const pronto = new Promise<Buffer>((resolve, reject) => {
    const pedacos: Buffer[] = [];
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  const largura = doc.page.width - 2 * MARGEM;
  // Data | Hora | Descrição | Valor | Saldo
  const col = { data: 0, hora: 58, desc: 92, valor: largura - 150, saldo: largura - 70 };
  const largDesc = col.valor - col.desc - 8;

  doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA).text('Extrato da conta', MARGEM, MARGEM);
  doc.font('Helvetica').fontSize(10).fillColor(TINTA).text(nomeDaConta(e));
  doc
    .fillColor(TINTA_FRACA)
    .fontSize(9)
    .text(
      `Período: ${diaBr(e.de)} a ${diaBr(e.ate)} · montado pela API do banco em ` +
        e.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    );
  doc.moveDown(0.6);

  const entradas = e.lancamentos.filter((l) => l.valor > 0).reduce((s, l) => s + centavos(l.valor), 0);
  const saidas = e.lancamentos.filter((l) => l.valor < 0).reduce((s, l) => s - centavos(l.valor), 0);
  const quadro: Array<[string, string]> = [
    ['Saldo inicial', e.saldoInicial !== null ? brl(e.saldoInicial) : '—'],
    ['Entradas', brl(reais(entradas))],
    ['Saídas', brl(reais(saidas))],
    ['Saldo final', e.saldoFinal !== null ? brl(e.saldoFinal) : '—'],
  ];
  const yQuadro = doc.y;
  const largCaixa = largura / 4;
  quadro.forEach(([rotulo, valor], i) => {
    const x = MARGEM + i * largCaixa;
    doc.font('Helvetica').fontSize(8).fillColor(TINTA_FRACA).text(rotulo, x, yQuadro, { width: largCaixa - 8 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text(valor, x, yQuadro + 11, { width: largCaixa - 8 });
  });
  doc.y = yQuadro + 32;
  doc.font('Helvetica').fontSize(8).fillColor(TINTA_FRACA).text(e.conferencia, MARGEM, doc.y, { width: largura });
  doc.moveDown(0.8);

  const cabecalhoDaTabela = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TINTA_FRACA);
    doc.text('DATA', MARGEM + col.data, y);
    doc.text('HORA', MARGEM + col.hora, y);
    doc.text('DESCRIÇÃO', MARGEM + col.desc, y);
    doc.text('VALOR', MARGEM + col.valor, y, { width: 72, align: 'right' });
    doc.text('SALDO', MARGEM + col.saldo, y, { width: 70, align: 'right' });
    doc.moveTo(MARGEM, y + 11).lineTo(MARGEM + largura, y + 11).strokeColor(FIO).lineWidth(0.6).stroke();
    doc.y = y + 15;
  };
  cabecalhoDaTabela();

  const saldos = saldosCorridos(e);
  const fundo = doc.page.height - MARGEM - 14;
  e.lancamentos.forEach((l, i) => {
    const descricao = [l.descricao, l.contraparte].filter(Boolean).join(' — ') + (l.documento ? ` (${l.documento})` : '');
    doc.font('Helvetica').fontSize(8);
    const altura = Math.max(10, doc.heightOfString(descricao, { width: largDesc }));
    if (doc.y + altura > fundo) {
      doc.addPage();
      doc.y = MARGEM;
      cabecalhoDaTabela();
    }
    const y = doc.y;
    doc.fillColor(TINTA).text(diaBr(l.dia), MARGEM + col.data, y);
    doc.fillColor(TINTA_FRACA).text(l.hora, MARGEM + col.hora, y);
    doc.fillColor(TINTA).text(descricao, MARGEM + col.desc, y, { width: largDesc });
    doc
      .fillColor(l.valor < 0 ? '#b91c1c' : '#047857')
      .text(brl(l.valor), MARGEM + col.valor, y, { width: 72, align: 'right' });
    doc.fillColor(TINTA).text(saldos[i] !== null ? brl(saldos[i]!) : '', MARGEM + col.saldo, y, { width: 70, align: 'right' });
    doc.y = y + altura + 3;
  });
  if (e.lancamentos.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(TINTA_FRACA).text('Nenhum lançamento no período.', MARGEM, doc.y);
  }

  // O número de cada página, no pé.
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    // O pé fica abaixo da margem: sem zerá-la, o pdfkit abriria outra página.
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(TINTA_FRACA)
      .text(`${e.conta.nome} · ${diaBr(e.de)} a ${diaBr(e.ate)} · página ${i + 1} de ${paginas.count}`,
        MARGEM, doc.page.height - MARGEM + 6, { width: largura, align: 'center', lineBreak: false });
  }
  doc.end();
  return pronto;
}
