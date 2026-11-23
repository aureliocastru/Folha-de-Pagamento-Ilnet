import { api } from './api';
import { lerBoleto, lerPix } from './codigo-de-pagamento';
import { vencimentoPagavel } from './dias-uteis';
import { formatBRL } from './format';

/** O que um código de pagamento — boleto ou Pix — diz, pronto para ir ao título. */
export interface CodigoLido {
  forma: 'BOLETO' | 'PIX';
  /** O que se guarda no título: os dígitos do boleto, ou o copia e cola do Pix. */
  codigo: string;
  /** Em reais. Null = o código não traz valor (o de valor livre). */
  valor: number | null;
  /** "AAAA-MM-DD", já num dia em que o banco abre. Null = o código não traz. */
  vencimento: string | null;
  /** Quem recebe, quando o código ou o banco dizem. */
  favorecido: string | null;
  /** "Boleto lido · R$ 952,59 · vence 25/11/2026", para a tela. */
  recado: string;
}

const soDigitos = (s: string) => s.replace(/\D/g, '');

/**
 * Lê o texto de um código — o que a câmera, o Ctrl+V ou o leitor de imagem
 * devolveram — e diz o que ele traz. O mesmo caminho da tela de lançar conta:
 * "0002…" é Pix copia e cola; 44, 47 ou 48 dígitos é boleto.
 *
 * No Pix dinâmico (o QR das guias) o valor e o dia não estão no código: quem
 * os busca é o banco. Se ele não responder, volta o que o código tinha e o
 * recado avisa para conferir.
 *
 * Devolve `{ erro }` quando o texto não é nenhum dos dois.
 */
export async function lerCodigoDePagamento(
  bruto: string,
): Promise<CodigoLido | { erro: string }> {
  const texto = bruto.trim();
  if (!texto) return { erro: 'Não veio nada para ler.' };

  if (/^0002/.test(texto)) return lerPixCopiaECola(texto);

  const soNumeros = /^[+\d\s()./-]+$/.test(texto);
  const n = soDigitos(texto).length;
  if (soNumeros && [44, 47, 48].includes(n)) return lerBoletoPeloCodigo(soDigitos(texto));
  if (soNumeros) {
    return { erro: `${n} dígitos. O código de barras tem 44, 47 ou 48 — confira se copiou inteiro.` };
  }
  return { erro: 'Isso não é um código de barras nem um Pix copia e cola.' };
}

/** O texto parece ser um dos dois códigos? É o que decide se um Ctrl+V solto vale ler. */
export function pareceCodigoDePagamento(texto: string): boolean {
  const t = texto.trim();
  if (/^0002/.test(t)) return true;
  return /^[+\d\s()./-]+$/.test(t) && [44, 47, 48].includes(soDigitos(t).length);
}

function lerBoletoPeloCodigo(digitos: string): CodigoLido {
  const b = lerBoleto(digitos);
  const venc = b?.vencimento ? vencimentoPagavel(b.vencimento, 'depois') : null;
  return {
    forma: 'BOLETO',
    codigo: digitos,
    valor: b?.valor ?? null,
    vencimento: venc?.dia ?? null,
    favorecido: null,
    recado: ['Boleto lido', b?.valor ? formatBRL(b.valor) : null, venc?.recado]
      .filter(Boolean)
      .join(' · '),
  };
}

async function lerPixCopiaECola(texto: string): Promise<CodigoLido> {
  const p = lerPix(texto);
  const dizer = (
    valor: number | null,
    nome: string | null,
    ...resto: Array<string | null | undefined>
  ) =>
    ['Pix lido', valor ? formatBRL(valor) : null, nome ? `para ${nome}` : null, ...resto]
      .filter(Boolean)
      .join(' · ');

  // O estático com valor já disse tudo o que tem: não há dia para buscar.
  if (p?.valor && !p.dinamico) {
    return {
      forma: 'PIX',
      codigo: texto,
      valor: p.valor,
      vencimento: null,
      favorecido: p.nome,
      recado: dizer(p.valor, p.nome),
    };
  }

  try {
    const { data } = await api.post<{
      valor: number | null;
      favorecido: string | null;
      vencimento: string | null;
    }>('/contas-abertas/banco/ler-qr', { codigo: texto });
    const valor = data.valor ?? p?.valor ?? null;
    const venc = data.vencimento ? vencimentoPagavel(data.vencimento, 'antes') : null;
    const nome = data.favorecido ?? p?.nome ?? null;
    return {
      forma: 'PIX',
      codigo: texto,
      valor,
      vencimento: venc?.dia ?? null,
      favorecido: nome,
      recado: dizer(valor, nome, venc?.recado, valor ? null : 'sem valor no QR'),
    };
  } catch {
    return {
      forma: 'PIX',
      codigo: texto,
      valor: p?.valor ?? null,
      vencimento: null,
      favorecido: p?.nome ?? null,
      recado: dizer(p?.valor ?? null, p?.nome ?? null, 'o banco não disse o valor nem o dia — confira'),
    };
  }
}

/**
 * De tudo o que um arquivo trouxe (código de barras e QR), o que serve para
 * pagar. A guia de arrecadação (começa com 8) traz os dois e só o Pix o banco
 * paga; fora isso, o boleto vem primeiro, como na regra do servidor.
 */
export function escolherCodigoDoArquivo(achados: string[]): string | null {
  const pix = achados.find((c) => /^0002/.test(c.trim()));
  const barras = achados.find((c) => [44, 47, 48].includes(soDigitos(c).length) && !/^0002/.test(c.trim()));
  if (barras && pix && soDigitos(barras).startsWith('8')) return pix;
  return barras ?? pix ?? null;
}
