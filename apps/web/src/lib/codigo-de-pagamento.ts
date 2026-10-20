/**
 * O que está escrito dentro do código de um pagamento.
 *
 * O boleto traz o valor e o vencimento nos próprios números, e o QR do Pix
 * traz o valor e o nome de quem recebe. Ler isso é o que deixa o "Ler código"
 * preencher a conta sozinho, em vez de só copiar o código para um campo.
 */

/** "2026-10-20" de uma data em UTC. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somarDias(base: string, dias: number): Date {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/**
 * O vencimento pelo fator do boleto.
 *
 * O fator conta dias desde 07/10/1997 e chegou a 9999 em 21/02/2025; daí
 * recomeçou em 1000, em 22/02/2025 (regra da Febraban). O mesmo número serve
 * aos dois ciclos: vale o mais perto de hoje.
 */
function vencimentoDoFator(fator: number, hoje = new Date()): string | null {
  if (fator < 1000) return null;
  const antigo = somarDias('1997-10-07', fator);
  const novo = somarDias('2025-02-22', fator - 1000);
  const longe = (d: Date) => Math.abs(d.getTime() - hoje.getTime());
  return iso(longe(novo) <= longe(antigo) ? novo : antigo);
}

/** A linha digitável de 47 números do boleto bancário, como código de barras. */
function barrasDaLinhaBancaria(l: string): string {
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

/** A linha de 48 da concessionária (4 blocos de 11 + dígito), como código de barras. */
function barrasDaLinhaDeArrecadacao(l: string): string {
  return l.slice(0, 11) + l.slice(12, 23) + l.slice(24, 35) + l.slice(36, 47);
}

export interface DadosDoBoleto {
  /** Em reais. Null = o boleto não traz valor (o de valor livre). */
  valor: number | null;
  /** "AAAA-MM-DD". Null = sem vencimento escrito (conta de consumo, quase sempre). */
  vencimento: string | null;
}

/**
 * Valor e vencimento de um boleto: código de barras (44) ou linha digitável
 * (47 do bancário, 48 da conta de consumo).
 */
export function lerBoleto(codigo: string, hoje = new Date()): DadosDoBoleto | null {
  const d = codigo.replace(/\D/g, '');
  let barras: string;
  if (d.length === 44) barras = d;
  else if (d.length === 47) barras = barrasDaLinhaBancaria(d);
  else if (d.length === 48) barras = barrasDaLinhaDeArrecadacao(d);
  else return null;

  if (barras[0] === '8') {
    // Conta de consumo: o 3º dígito diz se o valor é o de verdade (6 e 8) ou
    // só uma referência (7 e 9). O vencimento não tem lugar fixo.
    const efetivo = barras[2] === '6' || barras[2] === '8';
    const valor = Number(barras.slice(4, 15)) / 100;
    return { valor: efetivo && valor > 0 ? valor : null, vencimento: null };
  }

  const valor = Number(barras.slice(9, 19)) / 100;
  return {
    valor: valor > 0 ? valor : null,
    vencimento: vencimentoDoFator(Number(barras.slice(5, 9)), hoje),
  };
}

/** Os campos de um texto EMV (o do Pix): dois de nome, dois de tamanho, o conteúdo. */
function camposEmv(texto: string): Map<string, string> {
  const campos = new Map<string, string>();
  let i = 0;
  while (i + 4 <= texto.length) {
    const id = texto.slice(i, i + 2);
    const tamanho = Number(texto.slice(i + 2, i + 4));
    if (!Number.isInteger(tamanho)) break;
    campos.set(id, texto.slice(i + 4, i + 4 + tamanho));
    i += 4 + tamanho;
  }
  return campos;
}

export interface DadosDoPix {
  /** Em reais. Null = o QR deixa o valor para quem paga, ou o busca no banco. */
  valor: number | null;
  /** Quem recebe, como o QR escreve — em maiúsculas e cortado, às vezes. */
  nome: string | null;
}

/** Valor e nome de quem recebe, do "copia e cola" de um QR do Pix. */
export function lerPix(copiaECola: string): DadosDoPix | null {
  const texto = copiaECola.trim();
  if (!texto.startsWith('0002')) return null;
  const campos = camposEmv(texto);
  const valor = Number(campos.get('54'));
  const nome = campos.get('59')?.trim() || null;
  return { valor: Number.isFinite(valor) && valor > 0 ? valor : null, nome };
}
