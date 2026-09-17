/**
 * Reduz a foto da nota antes de mandar.
 *
 * A foto de um celular moderno tem 3 a 6 MB, e ela vai para uma coluna de
 * texto no Postgres — o mesmo disco do servidor, que não é grande. Mas uma
 * nota fiscal precisa ser **lida**: quem confere tem de achar, no meio do
 * papel amassado, um valor escrito a caneta, e foi por não conseguir ler esse
 * valor que 1600px a 70% ficaram para trás. A 2400px e 85% a caneta aparece,
 * e o arquivo fica entre 500 KB e 1,5 MB — longe do teto de 3 MB do servidor.
 *
 * Também é aqui que o HEIC do iPhone e o PNG viram JPEG: o navegador decodifica
 * o que sabe abrir e o canvas devolve sempre o mesmo formato.
 */
const LADO_MAIOR = 2400;
const QUALIDADE = 0.85;

export async function reduzirFoto(arquivo: File): Promise<string> {
  const bitmap = await carregar(arquivo);

  const escala = Math.min(1, LADO_MAIOR / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não deu para preparar a imagem neste navegador.');
  // Fundo branco: JPEG não tem transparência, e um PNG transparente viraria
  // preto — a nota fotografada em papel branco ficaria ilegível.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  return canvas.toDataURL('image/jpeg', QUALIDADE);
}

async function carregar(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(arquivo);
    } catch {
      // Formato que o createImageBitmap desta versão não abre: cai no <img>,
      // que aceita o que o navegador sabe desenhar.
    }
  }

  const url = URL.createObjectURL(arquivo);
  try {
    return await new Promise<HTMLImageElement>((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () =>
        erro(new Error('Não consegui abrir esta imagem. Tente outra foto.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
