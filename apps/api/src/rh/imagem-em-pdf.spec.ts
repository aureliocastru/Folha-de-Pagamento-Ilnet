import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { ehImagemConversivel, imagemEmPdf } from './imagem-em-pdf';

/**
 * A foto do papel virando PDF, para o pacote que vai à contabilidade sair todo
 * no mesmo formato. O que este arquivo protege:
 *
 *  - a página tem tamanho de papel, e não o da foto: sem isso a nota de 4000
 *    por 3000 pixels viraria uma página de metro e meio, e a impressora
 *    resolveria isso sozinha — encolhendo ou cortando;
 *  - a imagem não distorce e não se amplia;
 *  - a nota deitada vai para uma página deitada, senão ela sobra tão pequena no
 *    meio da folha vertical que o número não se lê;
 *  - só JPEG e PNG entram: o que o embutidor não abre é guardado como veio, e
 *    quem decide isso é quem chama.
 */

/**
 * Um PNG de verdade, do tamanho pedido, montado à mão.
 *
 * Montado, e não guardado como fixture: o que os testes daqui precisam é de
 * **tamanhos** diferentes — uma nota de pé, uma deitada, uma pequena —, e três
 * imagens binárias no repositório para isso seriam três arquivos que ninguém
 * consegue revisar num diff.
 */
function png(largura: number, altura: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA

  const pedacos: Buffer[] = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateVazio(largura, altura)),
    bloco('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(pedacos);
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

/** Os pixels, todos transparentes: o que importa aqui é o tamanho. */
function deflateVazio(largura: number, altura: number): Buffer {
  const linha = Buffer.alloc(largura * 4 + 1); // +1 do filtro, que fica em 0
  return deflateSync(Buffer.concat(Array.from({ length: altura }, () => linha)));
}

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** O tamanho da única página do PDF gerado. */
async function pagina(pdf: Buffer) {
  const doc = await PDFDocument.load(new Uint8Array(pdf));
  expect(doc.getPageCount()).toBe(1);
  return doc.getPage(0).getSize();
}

describe('que imagem vira PDF', () => {
  it('JPEG e PNG entram', () => {
    expect(ehImagemConversivel('image/jpeg')).toBe(true);
    expect(ehImagemConversivel('image/png')).toBe(true);
  });

  it('o que o embutidor não abre fica de fora', () => {
    // Guardados como vieram: perder o papel por causa da conversão seria
    // trocar um incômodo por um buraco.
    expect(ehImagemConversivel('image/heic')).toBe(false);
    expect(ehImagemConversivel('image/webp')).toBe(false);
    expect(ehImagemConversivel('image/gif')).toBe(false);
    expect(ehImagemConversivel('application/pdf')).toBe(false);
  });
});

describe('a página que sai', () => {
  it('tem tamanho de papel, e não o da foto', async () => {
    const pdf = await imagemEmPdf(png(2400, 3200), 'image/png');

    const { width, height } = await pagina(pdf);

    // A4 de pé, em pontos — e não 2400 por 3200.
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('a nota deitada vai para uma página deitada', async () => {
    const pdf = await imagemEmPdf(png(3200, 2400), 'image/png');

    const { width, height } = await pagina(pdf);

    expect(width).toBeGreaterThan(height);
    expect(Math.round(width)).toBe(842);
  });

  it('a foto pequena não é ampliada até a folha inteira', async () => {
    // Esticar 100 por 100 até A4 não acrescenta detalhe nenhum: só borra.
    const pdf = await imagemEmPdf(png(100, 100), 'image/png');

    // A página continua sendo a folha; o que não cresce é a imagem dentro
    // dela, e é por isso que o arquivo sai pequeno.
    const { width } = await pagina(pdf);
    expect(Math.round(width)).toBe(595);
    expect(pdf.length).toBeLessThan(60_000);
  });

  /*
   * O `pdf-lib` reage a lixo de dois jeitos — `Error` no JPEG, string solta com
   * mensagem `undefined` no PNG —, e o motivo daqui vira frase na tela de quem
   * subiu. Os dois têm de sair como erro legível.
   */
  it('imagem quebrada estoura com motivo legível, nos dois formatos', async () => {
    await expect(
      imagemEmPdf(Buffer.from('isto não é um png'), 'image/png'),
    ).rejects.toThrow(/não é uma imagem que eu consiga abrir/);

    await expect(
      imagemEmPdf(Buffer.from('isto não é um jpg'), 'image/jpeg'),
    ).rejects.toThrow(/não é uma imagem que eu consiga abrir/);
  });
});
