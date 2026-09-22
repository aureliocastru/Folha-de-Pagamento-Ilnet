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

/** Quantas fotos cabem numa nota: o papel e o visor da bomba, por exemplo. */
export const FOTOS_POR_NOTA = 2;

/**
 * As fotos da nota numa imagem só, lado a lado e da mesma altura.
 *
 * O servidor guarda uma imagem por nota, e quem confere quer ver as duas de
 * uma vez — o valor escrito a caneta ao lado do visor da bomba. Juntas elas
 * passam da largura de uma foto só: duas em pé ficam com a altura inteira de
 * uma, e a caneta continua legível. A qualidade desce um degrau se for
 * preciso para caber no teto de 3 MB do servidor.
 */
const JUNTAS_LARGURA = 4000;
const JUNTAS_TETO = 2.8 * 1024 * 1024;
const VAO = 12;

export async function juntarFotos(fotos: readonly string[]): Promise<string> {
  if (fotos.length < 2) return fotos[0] ?? '';

  const imagens = await Promise.all(fotos.map(abrirDataUrl));
  const altura0 = Math.min(LADO_MAIOR, ...imagens.map((i) => i.height));
  const larguras0 = imagens.map((i) => (i.width * altura0) / i.height);
  const soma0 = larguras0.reduce((a, b) => a + b, 0) + VAO * (imagens.length - 1);
  const escala = Math.min(1, JUNTAS_LARGURA / soma0);
  const altura = Math.round(altura0 * escala);
  const larguras = larguras0.map((l) => Math.round(l * escala));

  const canvas = document.createElement('canvas');
  canvas.width = larguras.reduce((a, b) => a + b, 0) + VAO * (imagens.length - 1);
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não deu para preparar a imagem neste navegador.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 0;
  imagens.forEach((img, i) => {
    ctx.drawImage(img, x, 0, larguras[i], altura);
    x += larguras[i] + VAO;
  });

  let juntas = canvas.toDataURL('image/jpeg', QUALIDADE);
  for (const qualidade of [0.75, 0.65, 0.55]) {
    if (bytesDaDataUrl(juntas) <= JUNTAS_TETO) break;
    juntas = canvas.toDataURL('image/jpeg', qualidade);
  }
  return juntas;
}

function bytesDaDataUrl(dataUrl: string): number {
  return Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);
}

function abrirDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => erro(new Error('Não consegui juntar as fotos. Tire as duas de novo.'));
    img.src = dataUrl;
  });
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
