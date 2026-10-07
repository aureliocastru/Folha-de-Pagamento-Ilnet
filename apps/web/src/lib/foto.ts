/**
 * Reduz a foto da nota antes de mandar.
 *
 * A foto de um celular moderno tem 3 a 6 MB, e ela vai para uma coluna de
 * texto no Postgres — o mesmo disco do servidor, que não é grande. Mas uma
 * nota fiscal precisa ser **lida**: quem confere tem de achar, no meio do
 * papel amassado, um valor escrito a caneta, e foi por não conseguir ler esse
 * valor que 1600px a 70% ficaram para trás. A 2400px e 85% a caneta aparece,
 * e o arquivo fica entre 500 KB e 1,5 MB.
 *
 * O "entre" era o defeito: a foto cheia de detalhe passava de 1,5 MB, e o caixa
 * a recusava como "grande demais" mesmo tirada pela tela, que é justamente a
 * que diz reduzir sozinha. Agora o tamanho tem teto: passando dele, a qualidade
 * desce um degrau de cada vez e, se ainda não couber, a foto encolhe.
 *
 * Também é aqui que o HEIC do iPhone e o PNG viram JPEG: o navegador decodifica
 * o que sabe abrir e o canvas devolve sempre o mesmo formato.
 */
const LADO_MAIOR = 2400;
const QUALIDADE = 0.85;

/**
 * O maior tamanho de uma foto que sai daqui.
 *
 * Abaixo de todos os tetos do servidor (o do caixa, o dos pontos e o do
 * abastecimento), e com folga para dez fotos de uma nota caberem num envio só.
 */
export const TETO_DA_FOTO = 1.5 * 1024 * 1024;

export async function reduzirFoto(arquivo: File): Promise<string> {
  const bitmap = await carregar(arquivo);
  return codificar(
    (canvas, escala) => {
      const largura = Math.round(bitmap.width * escala);
      const altura = Math.round(bitmap.height * escala);
      canvas.width = largura;
      canvas.height = altura;
      return (ctx) => ctx.drawImage(bitmap, 0, 0, largura, altura);
    },
    Math.min(1, LADO_MAIOR / Math.max(bitmap.width, bitmap.height)),
    TETO_DA_FOTO,
  );
}

/** Quantas fotos cabem numa nota: o papel e o visor da bomba, por exemplo. */
export const FOTOS_POR_NOTA = 2;

/**
 * As fotos da nota numa imagem só, lado a lado e da mesma altura.
 *
 * O servidor guarda uma imagem por nota, e quem confere quer ver as duas de
 * uma vez — o valor escrito a caneta ao lado do visor da bomba. Juntas elas
 * passam da largura de uma foto só: duas em pé ficam com a altura inteira de
 * uma, e a caneta continua legível. O teto é o de 3 MB do servidor, com folga.
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

  return codificar(
    (canvas, escala) => {
      const altura = Math.round(altura0 * escala);
      const larguras = larguras0.map((l) => Math.round(l * escala));
      canvas.width = larguras.reduce((a, b) => a + b, 0) + VAO * (imagens.length - 1);
      canvas.height = altura;
      return (ctx) => {
        let x = 0;
        imagens.forEach((img, i) => {
          ctx.drawImage(img, x, 0, larguras[i], altura);
          x += larguras[i] + VAO;
        });
      };
    },
    Math.min(1, JUNTAS_LARGURA / soma0),
    JUNTAS_TETO,
  );
}

/**
 * Prepara um arquivo que vai como documento: a nota de uma conta a pagar, o
 * papel da pasta do RH.
 *
 * PDF e o resto vão como vieram. Imagem passa pela redução quando precisa —
 * quando é grande demais para subir, ou quando é um formato que o navegador do
 * computador não mostra (o HEIC do iPhone): guardada assim, ela subia e depois
 * não abria em lugar nenhum. A imagem pequena e comum vai intacta, que o print
 * de tela fica mais nítido sem passar pelo JPEG.
 *
 * Se o navegador não conseguir abrir a imagem para reduzir, ela vai como veio:
 * anexar torto é melhor do que não conseguir anexar.
 */
const DOCUMENTO_SEM_REDUZIR = 4 * 1024 * 1024;

export async function prepararArquivo(
  arquivo: File,
): Promise<{ nome: string; dados: string }> {
  if (!ehImagem(arquivo)) {
    return { nome: arquivo.name, dados: await lerComoDataUrl(arquivo) };
  }

  const tipo = arquivo.type.toLowerCase();
  const comum = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(tipo);
  if (comum && arquivo.size <= DOCUMENTO_SEM_REDUZIR) {
    return { nome: arquivo.name, dados: await lerComoDataUrl(arquivo) };
  }

  try {
    const dados = await reduzirFoto(arquivo);
    const base = arquivo.name.replace(/\.[^.]+$/, '') || 'foto';
    return { nome: `${base}.jpg`, dados };
  } catch {
    return { nome: arquivo.name, dados: await lerComoDataUrl(arquivo) };
  }
}

/** Imagem pelo tipo, ou pela extensão quando o navegador não diz o tipo. */
export function ehImagem(arquivo: File): boolean {
  if (arquivo.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(arquivo.name);
}

/** O arquivo como data URL — é assim que ele chega à API. */
export function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () =>
      reject(new Error('Não consegui ler este arquivo do aparelho.'));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Desenha e codifica em JPEG até caber no teto.
 *
 * `montar` acerta o tamanho do canvas para a escala pedida e devolve quem
 * desenha nele. Primeiro desce a qualidade — que a letra aguenta melhor do que
 * perder pixel —, depois a escala, um quarto de cada vez.
 */
function codificar(
  montar: (
    canvas: HTMLCanvasElement,
    escala: number,
  ) => (ctx: CanvasRenderingContext2D) => void,
  escalaInicial: number,
  teto: number,
): string {
  const canvas = document.createElement('canvas');
  let escala = escalaInicial;
  let dataUrl = '';

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const desenhar = montar(canvas, escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não deu para preparar a imagem neste navegador.');
    // Fundo branco: JPEG não tem transparência, e um PNG transparente viraria
    // preto — a nota fotografada em papel branco ficaria ilegível.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    desenhar(ctx);

    for (const qualidade of [QUALIDADE, 0.75, 0.65]) {
      dataUrl = canvas.toDataURL('image/jpeg', qualidade);
      if (bytesDaDataUrl(dataUrl) <= teto) return dataUrl;
    }
    escala *= 0.75;
  }
  return dataUrl;
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
      img.onerror = () => erro(new Error(motivoDeNaoAbrir(arquivo)));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Por que esta imagem não abriu — e o que fazer.
 *
 * O caso de sempre é o HEIC do iPhone num computador com Windows: o navegador
 * dali não sabe desenhá-lo. No próprio iPhone ele abre, e o print da foto já
 * sai em formato comum.
 */
function motivoDeNaoAbrir(arquivo: File): string {
  if (/hei[cf]$/i.test(arquivo.type) || /\.hei[cf]$/i.test(arquivo.name)) {
    return (
      'Esta foto está em HEIC, o formato do iPhone, e este navegador não o ' +
      'abre. Anexe pelo próprio iPhone, ou tire um print da foto e anexe o print.'
    );
  }
  return 'Não consegui abrir esta imagem. Tente outra foto.';
}
