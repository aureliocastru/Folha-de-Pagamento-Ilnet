/**
 * A guia lida da imagem — o PDF "impresso em PDF", que não tem texto.
 *
 * Quem lê a imagem é o navegador (OCR, e o código de barras e o QR Code
 * decodificados da página). Aqui o que chega é conferido e arrumado para o
 * mesmo leitor das guias de sempre, `lerGuia`.
 *
 * A regra que manda em tudo: **código de pagamento não sai do OCR**. Uma letra
 * trocada numa linha digitável ou num PIX é pagamento que não chega, e o OCR
 * troca letra. Do texto reconhecido, toda linha com cara de código é jogada
 * fora; o código que fica é o decodificado da imagem, e só se os dígitos
 * verificadores dele fecharem.
 */

/** Primeira linha do texto guardado: quem abrir a guia depois sabe de onde ela veio. */
export const MARCA_DO_OCR = '(texto lido da imagem do PDF)';

/**
 * O texto que vai para o leitor e fica guardado com a guia: o do OCR, limpo,
 * com os códigos conferidos no fim.
 */
export function textoDaImagem(ocr: string, codigos: string[] = []): string {
  const linhas = ocr
    .split(/\r?\n/)
    .map(limparLinha)
    .filter((l) => l && !pareceCodigoDePagamento(l));

  const conferidos: string[] = [];
  for (const bruto of codigos) {
    const codigo = String(bruto ?? '').trim();
    const linha = linhaDigitavelDoCodigoDeBarras(codigo);
    if (linha) conferidos.push(`Código de barras lido da imagem: ${linha}`);
    else if (pixConferido(codigo)) conferidos.push(codigo);
  }

  return [MARCA_DO_OCR, ...linhas, ...conferidos].join('\n');
}

/**
 * O que o OCR põe onde não há nada: travessão no lugar de um traço de tabela,
 * barra vertical e colchete na borda de um quadro, parêntese solto colado no
 * CNPJ ("…/0001-02) ([M A CASTRO"). Tirados, os rótulos voltam a encostar nos
 * valores ("Número: 07.16…", "CNPJ razão social").
 */
function limparLinha(linha: string): string {
  return linha
    .replace(/[—–|[\]]/g, ' ')
    .replace(/(\d)\)/g, '$1 ')
    .replace(/\((?![^()]*\))/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Linha digitável ou PIX lidos por OCR: sequência comprida de dígitos, ou o
 * começo de um "copia e cola". Nenhuma delas sobrevive — a certa vem da imagem.
 */
function pareceCodigoDePagamento(linha: string): boolean {
  if (/br\.gov\.bcb\.pix|^0002\d{2}/i.test(linha)) return true;
  // Com uma letra no meio ("85860000042 O 178…") a sequência se parte; a
  // contagem total pega o que a sequência deixaria passar. Nenhuma linha de
  // valores da guia chega a quarenta dígitos.
  if ((linha.match(/\d/g) ?? []).length >= 40) return true;
  return /\d{30,}/.test(linha.replace(/[\s.\-/]/g, ''));
}

/**
 * A linha digitável (48 dígitos, em quatro blocos com o dígito de cada um) a
 * partir do código de barras de arrecadação (44 dígitos).
 *
 * Só sai se o código for de arrecadação (começa com 8) e o dígito verificador
 * geral — a quarta posição — fechar. O leitor de barras não tem conferência
 * própria: é esta conta que separa uma leitura certa de uma barra pulada.
 */
export function linhaDigitavelDoCodigoDeBarras(codigo: string): string | null {
  if (!/^8\d{43}$/.test(codigo)) return null;
  const calcular = modulo(codigo[2]);
  if (!calcular) return null;

  const semGeral = codigo.slice(0, 3) + codigo.slice(4);
  if (calcular(semGeral) !== Number(codigo[3])) return null;

  const blocos = [0, 11, 22, 33].map((i) => codigo.slice(i, i + 11));
  return blocos.map((b) => `${b} ${calcular(b)}`).join(' ');
}

/**
 * O valor impresso no código de barras, em reais — quando o terceiro dígito
 * diz que é valor em reais (6 ou 8). É uma segunda fonte do total da guia,
 * independente do OCR.
 */
export function valorDoCodigoDeBarras(linhaDigitavel: string): number | null {
  const digitos = linhaDigitavel.replace(/\D/g, '');
  if (digitos.length !== 48) return null;
  // Tira o dígito de cada bloco: sobram os 44 do código de barras.
  const codigo = [0, 12, 24, 36].map((i) => digitos.slice(i, i + 11)).join('');
  if (codigo[2] !== '6' && codigo[2] !== '8') return null;
  return Number(codigo.slice(4, 15)) / 100;
}

/**
 * O terceiro dígito do código de arrecadação escolhe a conta do dígito
 * verificador: 6 e 7 usam módulo 10; 8 e 9, módulo 11 (FEBRABAN).
 */
function modulo(identificador: string): ((digitos: string) => number) | null {
  if (identificador === '6' || identificador === '7') return modulo10;
  if (identificador === '8' || identificador === '9') return modulo11;
  return null;
}

/** Pesos 2 e 1 da direita para a esquerda, somando os algarismos de cada produto. */
function modulo10(digitos: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    const produto = Number(digitos[i]) * peso;
    soma += Math.floor(produto / 10) + (produto % 10);
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Pesos de 2 a 9 da direita para a esquerda; resto 0 ou 1 dá zero. */
function modulo11(digitos: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    soma += Number(digitos[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto <= 1 ? 0 : 11 - resto;
}

/**
 * O "copia e cola" do PIX com o CRC conferido: os quatro últimos caracteres
 * são o CRC16 (CCITT, 0x1021, começando em 0xFFFF) de tudo o que vem antes,
 * "6304" incluído. É o que o banco confere antes de aceitar.
 */
export function pixConferido(payload: string): boolean {
  const m = /^(000201.*6304)([0-9A-Fa-f]{4})$/.exec(payload);
  if (!m) return false;
  return crc16(m[1]) === m[2].toUpperCase();
}

function crc16(texto: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
