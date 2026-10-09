/**
 * O extrato OFX que o banco entrega.
 *
 * Dois dialetos no mesmo formato: o OFX 1 (SGML — a etiqueta de valor não
 * fecha, `<TRNAMT>-12.50` e a linha acaba) e o OFX 2 (XML, tudo fechado). Os
 * bancos brasileiros mandam os dois, e às vezes uma mistura. A leitura aqui
 * não depende de nenhum: cada valor é o texto depois da etiqueta até o próximo
 * `<` — o que funciona nos dois.
 */

export interface LancamentoDoBanco {
  /** O identificador do banco para o lançamento (FITID), quando vem. */
  id: string;
  /** "AAAA-MM-DD" */
  dia: string;
  /** Positivo = entrou; negativo = saiu. */
  valor: number;
  descricao: string;
  tipo: string;
}

export interface ExtratoOfx {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  /** O período que o banco diz que o arquivo cobre. */
  inicio: string | null;
  fim: string | null;
  /** O saldo do fim do extrato, e de que dia ele é. */
  saldoFinal: number | null;
  saldoEm: string | null;
  lancamentos: LancamentoDoBanco[];
}

/**
 * O texto do arquivo, na codificação que o cabeçalho declara.
 *
 * OFX 1 vem quase sempre em `CHARSET:1252` (o Windows dos anos 90 que o
 * formato herdou); lido como UTF-8, "PAGTO TARIFA" passa, mas "TRANSFERÊNCIA"
 * vira lixo.
 */
export function textoDoOfx(conteudo: Buffer): string {
  const cabeca = conteudo.subarray(0, 600).toString('latin1');
  const utf8 = /ENCODING\s*:\s*UTF-?8|encoding="utf-?8"/i.test(cabeca);
  // O BOM do UTF-8, quando vem, não é parte do texto.
  return conteudo.toString(utf8 ? 'utf8' : 'latin1').replace(new RegExp('^\\uFEFF'), '');
}

/** O valor de uma etiqueta dentro de um trecho do arquivo. */
function valorDe(trecho: string, etiqueta: string): string | null {
  const m = new RegExp(`<${etiqueta}>([^<\\r\\n]*)`, 'i').exec(trecho);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** "20260930120000[-3:BRT]" → "2026-09-30". */
export function diaDoOfx(valor: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(valor ?? '');
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * "-1234.56", "-1234,56", "1.234,56", "1,234.56" → número.
 *
 * O padrão é o ponto decimal, mas há banco que escreve à brasileira. Com os
 * dois separadores, o último é o decimal.
 */
export function valorDoOfx(valor: string | null): number | null {
  if (!valor) return null;
  let s = valor.trim().replace(/\s/g, '');
  const ponto = s.lastIndexOf('.');
  const virgula = s.lastIndexOf(',');
  if (ponto >= 0 && virgula >= 0) {
    s = virgula > ponto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (virgula >= 0) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function lerOfx(conteudo: Buffer): ExtratoOfx {
  const texto = textoDoOfx(conteudo);
  if (!/<OFX>/i.test(texto) || !/<STMTTRN>|<BANKTRANLIST>/i.test(texto)) {
    throw new Error('Este arquivo não é um extrato OFX (não achei a lista de lançamentos).');
  }

  const lancamentos: LancamentoDoBanco[] = [];
  // Cada lançamento vai de <STMTTRN> até o </STMTTRN> — ou, no SGML que não
  // fecha, até o próximo <STMTTRN> ou o fim da lista.
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  for (const cru of blocos) {
    const bloco = cru.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const dia = diaDoOfx(valorDe(bloco, 'DTPOSTED'));
    const valor = valorDoOfx(valorDe(bloco, 'TRNAMT'));
    if (!dia || valor === null) continue;
    const memo = valorDe(bloco, 'MEMO');
    const nome = valorDe(bloco, 'NAME');
    lancamentos.push({
      id: valorDe(bloco, 'FITID') ?? '',
      dia,
      valor,
      descricao: [nome, memo].filter((x, i, a) => x && a.indexOf(x) === i).join(' — '),
      tipo: valorDe(bloco, 'TRNTYPE') ?? '',
    });
  }

  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i.exec(texto)?.[1] ?? '';
  return {
    banco: valorDe(texto, 'BANKID'),
    agencia: valorDe(texto, 'BRANCHID'),
    conta: valorDe(texto, 'ACCTID'),
    inicio: diaDoOfx(valorDe(texto, 'DTSTART')),
    fim: diaDoOfx(valorDe(texto, 'DTEND')),
    saldoFinal: valorDoOfx(valorDe(ledger, 'BALAMT')),
    saldoEm: diaDoOfx(valorDe(ledger, 'DTASOF')),
    lancamentos: lancamentos.sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}
