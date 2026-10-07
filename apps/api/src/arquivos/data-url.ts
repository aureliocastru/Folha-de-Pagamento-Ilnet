import { BadRequestException } from '@nestjs/common';

/**
 * O arquivo que chega do navegador, e o que se confere nele.
 *
 * Tudo nesta casa sobe do mesmo jeito: como data URL dentro do JSON — a foto da
 * nota, a assinatura do recibo, o documento do RH, o print colado numa conta a
 * pagar. É o caminho que o navegador dá de graça (`FileReader`, o `blob` da
 * área de transferência) e que atravessa o proxy sem multipart.
 *
 * O preço é um terço a mais de tamanho no caminho, e por isso o teto de corpo
 * do `main.ts` e o `client_max_body_size` do nginx têm de acompanhar o maior
 * arquivo que se aceita aqui.
 */
export interface ArquivoRecebido {
  conteudo: Buffer;
  /** O tipo declarado no próprio arquivo, e não a extensão do nome. */
  tipo: string;
}

/**
 * O conteúdo e o tipo de uma data URL.
 *
 * O tipo sai daqui, e não do nome do arquivo: extensão é o que quem manda diz
 * ter mandado, e é ela que erra quando um PDF chega chamado ".jpg".
 */
export function lerDataUrl(url: string): ArquivoRecebido {
  const m = /^data:([-\w.+]+\/[-\w.+]+);base64,(.*)$/s.exec(url);
  if (!m) {
    throw new BadRequestException(
      'O arquivo não chegou num formato que eu saiba ler.',
    );
  }
  const conteudo = Buffer.from(m[2], 'base64');
  if (conteudo.length === 0) {
    throw new BadRequestException('O arquivo chegou vazio.');
  }
  return { conteudo, tipo: m[1].toLowerCase() };
}

/** Recusa o que não está na lista, e o que passa do teto. */
export function conferirArquivo(
  arquivo: ArquivoRecebido,
  aceitos: ReadonlySet<string>,
  limiteBytes: number,
  oQueEntra: string,
): void {
  if (!aceitos.has(arquivo.tipo)) {
    throw new BadRequestException(
      `Não guardo arquivo do tipo "${arquivo.tipo}". ${oQueEntra}`,
    );
  }
  if (arquivo.conteudo.length > limiteBytes) {
    throw new BadRequestException(
      `O arquivo tem ${emMegabytes(arquivo.conteudo.length)} e o limite é de ` +
        `${emMegabytes(limiteBytes)}. Digitalize em preto e branco ou em ` +
        'resolução menor, que costuma resolver.',
    );
  }
}

/**
 * O tipo pelos primeiros bytes do arquivo, quando eles dizem.
 *
 * É o que manda quando o nome mente: a nota anexada no IXC com a extensão
 * errada, ou sem extensão nenhuma, descia como PDF e abria no leitor de PDF
 * uma foto que ele não sabe desenhar — "erro ao abrir", numa nota que estava
 * inteira lá.
 */
export function tipoPeloConteudo(conteudo: Buffer): string | null {
  const inicio = (bytes: number[]) =>
    bytes.every((b, i) => conteudo[i] === b);
  if (inicio([0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (inicio([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (inicio([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (inicio([0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8
  if (
    inicio([0x52, 0x49, 0x46, 0x46]) &&
    conteudo.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF: caixa "ftyp" no byte 4, com a marca do formato logo depois.
  if (conteudo.subarray(4, 8).toString('latin1') === 'ftyp') {
    const marca = conteudo.subarray(8, 12).toString('latin1');
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(marca)) return 'image/heic';
  }
  return null;
}

/** A extensão que combina com o tipo — o IXC guarda o arquivo pelo nome. */
export function extensaoDoTipo(tipo: string): string {
  const conhecidas: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
  };
  return conhecidas[tipo] ?? 'bin';
}

export function emMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
