import { PDFDocument } from 'pdf-lib';

/**
 * A foto do papel virando PDF.
 *
 * O motivo é o pacote que sai daqui. As notas do mês chegam metade em PDF e
 * metade fotografadas, e o zip que vai à contabilidade com os dois formatos
 * misturados obriga quem recebe a abrir cada arquivo num programa diferente.
 * Em PDF ele abre tudo em sequência, no mesmo leitor, e imprime igual.
 *
 * JPEG e PNG, só. São os dois que o `pdf-lib` embute sem depender de um
 * conversor de imagem instalado na máquina — e são o que sai de scanner e de
 * celular. O resto (HEIC, WebP, GIF) é guardado como veio, com aviso: perder o
 * documento porque a conversão não deu seria trocar um incômodo por um buraco.
 */
const CONVERSIVEIS = new Set(['image/jpeg', 'image/png']);

export function ehImagemConversivel(tipo: string): boolean {
  return CONVERSIVEIS.has(tipo);
}

/**
 * O tamanho da página, em pontos PDF — A4 de pé (72 pontos = 1 polegada).
 *
 * A página tem tamanho de papel, e não o da imagem, porque este PDF vai ser
 * impresso: a foto de 4000 por 3000 pixels viraria uma página de metro e meio,
 * e a impressora resolveria isso sozinha encolhendo — ou cortando.
 */
const A4 = { largura: 595.28, altura: 841.89 };

/** Uma margem fina, para a nota não encostar na borda do papel. */
const MARGEM = 28;

/**
 * A imagem numa página de PDF, inteira e sem distorcer.
 *
 * Deitada ou de pé, ela entra na página que couber melhor: a nota fotografada
 * na horizontal, forçada numa página vertical, sobra tão pequena no meio da
 * folha que o número não se lê.
 */
export async function imagemEmPdf(
  conteudo: Buffer,
  tipo: string,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();

  /*
   * O erro do `pdf-lib` é uniformizado aqui, e não onde ele é mostrado.
   *
   * Diante de bytes que não são imagem, ele reage de dois jeitos: o JPEG lança
   * um `Error` ("SOI not found in JPEG") e o PNG lança uma **string** solta,
   * cuja mensagem é `undefined`. Quem chama transforma o motivo em aviso na
   * tela — e "undefined" na frase que explica por que a nota não virou PDF é
   * pior que não avisar nada.
   */
  let imagem;
  try {
    imagem =
      tipo === 'image/png'
        ? await pdf.embedPng(new Uint8Array(conteudo))
        : await pdf.embedJpg(new Uint8Array(conteudo));
  } catch {
    throw new Error('o arquivo não é uma imagem que eu consiga abrir');
  }

  const deitada = imagem.width > imagem.height;
  const largura = deitada ? A4.altura : A4.largura;
  const altura = deitada ? A4.largura : A4.altura;

  const cabe = Math.min(
    (largura - MARGEM * 2) / imagem.width,
    (altura - MARGEM * 2) / imagem.height,
    // Nunca ampliar: a foto pequena esticada até a folha inteira não ganha
    // detalhe nenhum, só borra o que já estava ruim.
    1,
  );
  const w = imagem.width * cabe;
  const h = imagem.height * cabe;

  const pagina = pdf.addPage([largura, altura]);
  pagina.drawImage(imagem, {
    x: (largura - w) / 2,
    y: (altura - h) / 2,
    width: w,
    height: h,
  });

  return Buffer.from(await pdf.save());
}
