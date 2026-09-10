/**
 * Lê um PDF sem texto: desenha cada página e reconhece as letras (OCR).
 *
 * Existe por causa do "Microsoft Print To PDF". Quando alguém abre a guia e
 * manda imprimir como PDF em vez de salvar o arquivo do site, as letras viram
 * desenho — traços vetoriais, sem texto nenhum por trás — e o leitor da API não
 * tem o que ler. A página continua nítida, então o OCR a lê bem.
 *
 * Roda no navegador, e não na API, porque desenhar a página pede um canvas: no
 * navegador ele já existe, e no servidor seria um binário nativo a mais no
 * container (o mesmo que já derrubou a API uma vez — ver `apps/api/src/pdf`).
 *
 * O código de pagamento **não** sai do OCR. Uma letra trocada numa linha
 * digitável ou num PIX é pagamento que não chega; ele sai do código de barras e
 * do QR Code da própria página, decodificados como um leitor de banco faria, e
 * a API ainda confere os dígitos verificadores antes de aceitar.
 *
 * As bibliotecas são pesadas e só se carregam aqui, na primeira guia sem
 * texto; o idioma (português) vem do CDN do tesseract e fica guardado no
 * navegador para a próxima vez.
 */

import type { Line, Word, Worker } from 'tesseract.js';

/**
 * Largura, em pixels, em que a página é desenhada para o OCR.
 *
 * O texto miúdo da guia (a composição, em fonte de 7pt) precisa de uns 30px de
 * altura de letra para sair sem troca de dígito; 2.400px numa folha A4 dá isso,
 * e ainda cabe na memória de um celular.
 */
const LARGURA_DO_OCR = 2400;

/**
 * Larguras em que se procura o código de barras e o QR Code.
 *
 * Nenhuma serve para tudo: nas guias de teste o QR do DARF só saiu em 1.600px,
 * o do FGTS em 2.400px, e as barras do DARF — finas e coladas — só em 3.000px.
 */
const LARGURAS_DOS_CODIGOS = [LARGURA_DO_OCR, 3000, 1600, 3600];

/** Abaixo disto, um número lido é relido com calma (ver `relerNumeros`). */
const CONFIANCA_MINIMA = 70;

export interface LeituraPorImagem {
  /** O texto reconhecido, página por página. */
  texto: string;
  /**
   * O que saiu do código de barras e do QR Code, sem nenhuma conferência —
   * quem confere é a API.
   */
  codigos: string[];
}

/** O que está sendo feito agora, para a tela não parecer travada. */
export type ProgressoDoOcr = (etapa: string) => void;

export async function lerPdfPorImagem(
  arquivo: File,
  aoAvancar: ProgressoDoOcr = () => {},
): Promise<LeituraPorImagem> {
  aoAvancar('Abrindo o PDF…');
  const pdfjs = await import('pdfjs-dist');
  // O worker vem empacotado pelo Vite (`?worker`), e não pela URL do `.mjs`
  // do pacote: o nginx do front serve `.mjs` como octet-stream, e o navegador
  // se recusa a rodar módulo com esse tipo — a leitura quebraria só em
  // produção. Empacotado, ele sai `.js`.
  const { default: WorkerDoPdf } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
  const worker = new WorkerDoPdf();
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const documento = await pdfjs.getDocument({ data: await arquivo.arrayBuffer() }).promise;

  aoAvancar('Preparando a leitura da imagem…');
  const { createWorker, PSM } = await import('tesseract.js');
  const leitor = await createWorker('por');

  try {
    const paginas: string[] = [];
    const codigos = new Set<string>();

    for (let n = 1; n <= documento.numPages; n++) {
      const deQual = documento.numPages > 1 ? ` da página ${n} de ${documento.numPages}` : '';
      const pagina = await documento.getPage(n);
      const largura = pagina.getViewport({ scale: 1 }).width;

      const desenhar = async (larguraEmPixels: number) => {
        const viewport = pagina.getViewport({ scale: larguraEmPixels / largura });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Este navegador não desenha a página do PDF.');
        // Fundo branco: sem ele a página transparente vira preta.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // "print": o desenho normal do pdfjs anda de quadro em quadro
        // (requestAnimationFrame), e o navegador para os quadros da aba que
        // não está à vista — trocar de aba no meio da leitura a deixaria parada.
        await pagina.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
        return canvas;
      };

      aoAvancar(`Procurando o código de barras e o QR Code${deQual}…`);
      const principal = await desenhar(LARGURA_DO_OCR);
      for (const c of await lerCodigos(principal, desenhar)) codigos.add(c);

      aoAvancar(`Lendo as letras${deQual} (uns 15 segundos)…`);
      prepararParaOcr(principal);
      await leitor.setParameters({
        // Um bloco só, lido em linhas de ponta a ponta: é assim que o rótulo e
        // o valor ("Pagar até: 18/09/2026") ficam na mesma linha, como o leitor
        // das guias espera. No modo automático as colunas saem separadas.
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: '',
      });
      const { data } = await leitor.recognize(principal, {}, { blocks: true, text: true });
      const linhas = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));

      aoAvancar(`Conferindo os números${deQual}…`);
      paginas.push(await relerNumeros(leitor, principal, linhas, PSM.SINGLE_LINE));
      pagina.cleanup();
    }

    return { texto: paginas.join('\n'), codigos: [...codigos] };
  } finally {
    await leitor.terminate();
    await documento.destroy();
    pdfjs.GlobalWorkerOptions.workerPort = null;
    worker.terminate();
  }
}

/**
 * O código de barras (ITF, o das guias de arrecadação) e o QR Code (PIX) da
 * página. Tenta cada largura até achar os dois, ou até acabarem as larguras.
 */
async function lerCodigos(
  primeira: HTMLCanvasElement,
  desenhar: (largura: number) => Promise<HTMLCanvasElement>,
): Promise<string[]> {
  const Z = await import('@zxing/library');
  const achados: { barras?: string; qr?: string } = {};

  for (const largura of LARGURAS_DOS_CODIGOS) {
    const canvas = largura === LARGURA_DO_OCR ? primeira : await desenhar(largura);
    const imagem = imagemEmCinza(canvas);
    const bitmap = () =>
      new Z.BinaryBitmap(
        new Z.HybridBinarizer(new Z.RGBLuminanceSource(imagem, canvas.width, canvas.height)),
      );

    if (!achados.barras) {
      try {
        // 44 dígitos: o tamanho do código de barras de arrecadação. Aceitar
        // qualquer tamanho faria o leitor "achar" código em fileira de texto.
        const dicas = new Map<number, unknown>([
          [Z.DecodeHintType.TRY_HARDER, true],
          [Z.DecodeHintType.ALLOWED_LENGTHS, Int32Array.from([44])],
        ]);
        achados.barras = new Z.ITFReader().decode(bitmap(), dicas as never).getText();
      } catch {
        // Não achou nesta largura.
      }
    }
    if (!achados.qr) {
      try {
        const dicas = new Map<number, unknown>([[Z.DecodeHintType.TRY_HARDER, true]]);
        achados.qr = new Z.QRCodeReader().decode(bitmap(), dicas as never).getText();
      } catch {
        // Não achou nesta largura.
      }
    }
    if (achados.barras && achados.qr) break;
  }

  return [achados.barras, achados.qr].filter((c): c is string => !!c);
}

function imagemEmCinza(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Este navegador não lê a imagem da página.');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cinza = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < cinza.length; i++) {
    cinza[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  }
  return cinza;
}

/**
 * A página em cinza pelo canal mais escuro de cada ponto, e não pela
 * luminância.
 *
 * Os quadros coloridos das guias (o verde do DARF, com o total e o vencimento
 * em branco) têm luminância no meio do caminho — nem tinta nem papel —, e o OCR
 * se perde neles. No canal mais escuro o verde fica escuro de verdade, e a
 * letra branca por cima dele sai limpa.
 */
function prepararParaOcr(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imagem.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = Math.min(d[i], d[i + 1], d[i + 2]);
  }
  ctx.putImageData(imagem, 0, 0);
}

/** Palavra que é número, ou que o OCR confundiu com número ("O" por 0, "I" por 1). */
const PARECE_NUMERO = /^[\d/.,:\-OoIl|]+$/;

/**
 * Remonta o texto da página, relendo os números em que o OCR hesitou.
 *
 * Na leitura da página inteira o OCR tenta palavras, e às vezes faz "OI" de um
 * 09. Relido sozinho, com a lista de caracteres fechada em dígitos e pontuação,
 * o mesmo pedaço sai certo — e a própria nota de confiança do OCR diz quais
 * pedaços merecem a segunda olhada.
 */
async function relerNumeros(
  leitor: Worker,
  canvas: HTMLCanvasElement,
  linhas: Line[],
  umaLinha: string,
): Promise<string> {
  const saida: string[] = [];

  for (const linha of linhas) {
    const palavras = linha.words;
    const partes: string[] = [];
    let i = 0;
    while (i < palavras.length) {
      if (!PARECE_NUMERO.test(palavras[i].text)) {
        partes.push(palavras[i].text);
        i++;
        continue;
      }
      // A sequência de palavras-número vizinhas: "1 8 / OI / 2026".
      let j = i + 1;
      while (
        j < palavras.length &&
        PARECE_NUMERO.test(palavras[j].text) &&
        perto(palavras[j - 1], palavras[j])
      ) {
        j++;
      }
      const trecho = palavras.slice(i, j);
      // Duas caras de erro: letra no meio do número ("OI" por 09), ou um
      // número partido em pedaços em que o OCR hesitou ("1 8 / OI / 2026",
      // "4 842 14"). Um número inteiro e bem escrito fica como veio, mesmo com
      // nota baixa — relê-lo já trocou "4.842,14" por "4,842,14".
      const duvidoso =
        trecho.some((p) => /\d/.test(p.text)) &&
        (trecho.some((p) => /[OoIl|]/.test(p.text)) ||
          (trecho.length > 1 && trecho.some((p) => p.confidence < CONFIANCA_MINIMA)));
      const relido = duvidoso ? await relerTrecho(leitor, canvas, trecho, umaLinha) : null;
      partes.push(relido ?? trecho.map((p) => p.text).join(' '));
      i = j;
    }
    saida.push(partes.join(' '));
  }

  // A lista de caracteres volta a ser livre para a próxima página.
  await leitor.setParameters({ tessedit_char_whitelist: '' });
  return saida.join('\n');
}

/** Duas palavras da mesma coluna: o vão entre elas é menor que duas letras. */
function perto(a: Word, b: Word): boolean {
  const altura = Math.max(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0);
  return b.bbox.x0 - a.bbox.x1 < altura * 2;
}

async function relerTrecho(
  leitor: Worker,
  canvas: HTMLCanvasElement,
  trecho: Word[],
  umaLinha: string,
): Promise<string | null> {
  const margem = 8;
  const x0 = Math.max(0, Math.min(...trecho.map((p) => p.bbox.x0)) - margem);
  const y0 = Math.max(0, Math.min(...trecho.map((p) => p.bbox.y0)) - margem);
  const x1 = Math.min(canvas.width, Math.max(...trecho.map((p) => p.bbox.x1)) + margem);
  const y1 = Math.min(canvas.height, Math.max(...trecho.map((p) => p.bbox.y1)) + margem);

  // O recorte em dobro: letra maior, menos dígito trocado.
  const recorte = document.createElement('canvas');
  recorte.width = (x1 - x0) * 2;
  recorte.height = (y1 - y0) * 2;
  const ctx = recorte.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, recorte.width, recorte.height);

  // Letra branca em quadro escuro — o vencimento e o total do FGTS, em branco
  // sobre azul-marinho: o recorte é invertido para virar tinta sobre papel,
  // que é o que o OCR sabe ler. Na página inteira isso não dá para fazer: o
  // quadro divide a linha com rótulos pretos.
  const imagem = ctx.getImageData(0, 0, recorte.width, recorte.height);
  const d = imagem.data;
  let soma = 0;
  for (let i = 0; i < d.length; i += 4) soma += d[i];
  if (soma / (d.length / 4) < 128) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    ctx.putImageData(imagem, 0, 0);
  }

  await leitor.setParameters({
    tessedit_pageseg_mode: umaLinha as never,
    tessedit_char_whitelist: '0123456789/.,-:',
  });
  const { data } = await leitor.recognize(recorte);
  const texto = data.text.trim().replace(/\s+/g, ' ');
  if (!texto || data.confidence < CONFIANCA_MINIMA) return null;
  return texto.split(' ').every(bemEscrito) ? texto : null;
}

/**
 * Um pedaço relido só entra se tiver forma de número de papel: data, mês,
 * dinheiro com vírgula no lugar, ou um número de documento. "4,842,14" não
 * tem — e aí fica o que a primeira leitura viu.
 */
function bemEscrito(pedaco: string): boolean {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(pedaco)) return true;
  if (/^\d{2}\/\d{4}$/.test(pedaco)) return true;
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(pedaco)) return true;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(pedaco)) return true;
  return /^[\d./-]+$/.test(pedaco) && /\d/.test(pedaco) && !pedaco.includes(',');
}
