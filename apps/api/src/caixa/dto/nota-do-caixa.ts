import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * O que entra como nota no fechamento de caixa: a foto, ou o PDF.
 *
 * A foto sai da tela já reduzida e em JPEG (ver `reduzirFoto` no web). O PDF
 * vai como veio: é a nota fiscal que o fornecedor mandou por e-mail, o DANFE
 * baixado do portal, o comprovante salvo do banco — fotografar a tela para
 * virar imagem era o desvio que se fazia antes, e a foto do monitor sai pior
 * que o papel.
 *
 * Os dois viajam do mesmo jeito, data URL dentro do JSON, e são guardados na
 * mesma coluna (`FotoDaNota.foto`). Quem lê de volta sabe o que é pelo começo
 * dela; o pacote da contabilidade já confere pelos primeiros bytes.
 */

/**
 * Teto da foto da nota, em caracteres do data URL.
 *
 * Cinco milhões de caracteres são ~3,7 MB de imagem, o mesmo teto da foto dos
 * pontos e do abastecimento. Era um milhão (~750 KB), de quando a tela reduzia
 * a foto a 1600px; quando ela passou a 2400px para a caneta aparecer, a foto
 * de uma nota cheia de detalhe passou de 750 KB e o caixa a recusava como
 * "grande demais" — tirada pela câmera, pela própria tela. A tela hoje entrega
 * no máximo 1,5 MB. O limite existe para o caso de alguém mandar pela API: uma
 * tabela de fotos cruas enche o disco do servidor, que é o mesmo do banco.
 */
export const TETO_DA_FOTO = 5_000_000;

/**
 * Teto do PDF: 8 MB de arquivo, o mesmo da nota anexada a uma conta a pagar.
 *
 * Maior que o da foto porque o PDF não passa por redução nenhuma — a tela não
 * tem como encolhê-lo sem estragar. Uma DANFE tem centenas de KB; o que chega
 * perto disto é a nota digitalizada em cores. Em caracteres do data URL, que é
 * o que se mede aqui: o base64 engorda um terço.
 */
export const MEGAS_DO_PDF = 8;
export const TETO_DO_PDF =
  Math.ceil((MEGAS_DO_PDF * 1024 * 1024 * 4) / 3) + 'data:application/pdf;base64,'.length;

export const RECADO_DO_TIPO =
  'A nota precisa ser uma foto (PNG, JPEG ou WebP) ou um PDF.';

export const RECADO_DA_FOTO =
  'A foto ficou grande demais. Tire de novo pela tela, que ela reduz sozinha.';

export const RECADO_DO_PDF_GRANDE =
  `O PDF passa de ${MEGAS_DO_PDF} MB. Salve de novo em resolução menor ou em ` +
  'preto e branco, que costuma resolver.';

export const RECADO_DO_PDF_FALSO =
  'Este arquivo diz ser PDF, mas não é. Abra-o no computador e salve como PDF ' +
  'de novo, ou fotografe a nota.';

const FOTO = /^data:image\/(png|jpe?g|webp);base64,/;
const PDF = /^data:application\/pdf;base64,/;

/**
 * Onde a assinatura `%PDF-` pode estar. A especificação deixa lixo antes dela
 * no primeiro KB, e o leitor de PDF de todo mundo aceita: recusar aqui seria
 * recusar um PDF que abre em qualquer lugar.
 */
const INICIO_DO_PDF = 1024;

/**
 * Por que esta nota não entra — ou `null`, se ela entra.
 *
 * O PDF é conferido por dentro, e a foto não: a foto foi desenhada pela própria
 * tela, e o PDF é o arquivo do jeito que estava no computador de quem anexou,
 * com o tipo que o navegador deduziu da extensão. Um ".pdf" que não é PDF
 * seria guardado e depois não abriria em lugar nenhum — nem aqui, nem no
 * pacote da contabilidade.
 */
export function motivoDaNotaRecusada(valor: unknown): string | null {
  if (typeof valor !== 'string') return RECADO_DO_TIPO;

  if (FOTO.test(valor)) {
    return valor.length > TETO_DA_FOTO ? RECADO_DA_FOTO : null;
  }

  const pdf = PDF.exec(valor);
  if (pdf) {
    if (valor.length > TETO_DO_PDF) return RECADO_DO_PDF_GRANDE;
    return pareceUmPdf(valor, pdf[0].length) ? null : RECADO_DO_PDF_FALSO;
  }

  return RECADO_DO_TIPO;
}

/** Só o começo é decodificado: é ali que o PDF diz o que é. */
function pareceUmPdf(dataUrl: string, inicio: number): boolean {
  const pedaco = dataUrl.slice(inicio, inicio + Math.ceil(INICIO_DO_PDF / 3) * 4);
  return Buffer.from(pedaco, 'base64').toString('latin1').includes('%PDF-');
}

/**
 * A nota do caixa, validada: foto ou PDF, cada um com o seu teto.
 *
 * Com `each`, o class-validator passa à mensagem o vetor inteiro, e não o
 * item que falhou — por isso ela procura a primeira nota recusada, para dizer
 * o motivo dela e não um genérico.
 */
export function ENotaDoCaixa(opcoes?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'eNotaDoCaixa',
      validator: {
        validate: (valor: unknown) => motivoDaNotaRecusada(valor) === null,
        defaultMessage: (args) => {
          const valores: unknown[] = Array.isArray(args?.value)
            ? args.value
            : [args?.value];
          for (const v of valores) {
            const motivo = motivoDaNotaRecusada(v);
            if (motivo) return motivo;
          }
          return RECADO_DO_TIPO;
        },
      },
    },
    opcoes,
  );
}
