import { useEffect, useRef, useState } from 'react';

/**
 * Lê o código de barras do boleto ou o QR Code do PIX pela câmera.
 *
 * Dois motores, e a escolha é do aparelho:
 *
 * - **`BarcodeDetector`**, o leitor do próprio navegador, quando existe. É o
 *   caso do Chrome no Android: roda nativo, não baixa nada e é o mais rápido.
 * - **ZXing**, uma biblioteca de leitura, quando não existe — o Safari do
 *   iPhone é o caso. Ela só é baixada quando alguém abre a câmera, e não no
 *   carregamento do app: são algumas centenas de kB que a maioria das telas
 *   nunca vai precisar.
 *
 * O boleto é impresso em ITF (2 de 5 intercalado) e algumas contas de consumo
 * em Code 128; o PIX é QR.
 */

/** O `BarcodeDetector` ainda não está na tipagem padrão do DOM. */
interface CodigoLido {
  rawValue: string;
}
interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<CodigoLido[]>;
}
type ConstrutorDoDetector = new (opcoes?: {
  formats?: string[];
}) => DetectorDeCodigo;

function detectorNativo(): ConstrutorDoDetector | null {
  const janela = window as unknown as { BarcodeDetector?: ConstrutorDoDetector };
  return janela.BarcodeDetector ?? null;
}

/**
 * Dá para ler por aqui? Basta ter câmera: onde falta o leitor nativo, a
 * biblioteca assume.
 */
export function leitorDeCodigoSuportado(): boolean {
  return (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  );
}

/** Tamanhos válidos: 44 do código de barras, 47 da cobrança, 48 das concessionárias. */
function pareceBoleto(digitos: string): boolean {
  return [44, 47, 48].includes(digitos.length);
}

/**
 * O QR do PIX é o próprio "copia e cola": um texto no padrão EMV que começa em
 * "0002" e traz o domínio do Banco Central no meio. Guardar essa string é o
 * mesmo que apertar "copiar código" no aplicativo do banco — e é ela que paga.
 */
function pareceCopiaECola(texto: string): boolean {
  const limpo = texto.trim();
  return limpo.startsWith('0002') && /BR\.GOV\.BCB\.PIX/i.test(limpo);
}

/** O que se está lendo: muda o formato aceito, a mira e o texto da tela. */
export type AlvoDaLeitura = 'boleto' | 'pix' | 'etiqueta';

const ALVOS = {
  boleto: {
    titulo: 'Aponte para o código de barras do boleto',
    ajuda:
      'Encaixe o código na faixa. Assim que ele for lido, o campo é preenchido sozinho.',
    formatosNativos: ['itf', 'code_128'],
    formatosZxing: ['ITF', 'CODE_128'],
    // O boleto vira só dígitos; o PIX vai inteiro, do jeito que veio.
    aceitar: (bruto: string) => {
      const digitos = bruto.replace(/\D/g, '');
      return pareceBoleto(digitos) ? digitos : null;
    },
  },
  pix: {
    titulo: 'Aponte para o QR Code do PIX',
    ajuda:
      'O código copia e cola do QR é gravado no campo — é ele que o banco usa para pagar.',
    formatosNativos: ['qr_code'],
    formatosZxing: ['QR_CODE'],
    aceitar: (bruto: string) => (pareceCopiaECola(bruto) ? bruto.trim() : null),
  },
  /*
   * A etiqueta do aparelho (ONU, roteador): o MAC e a série vêm em Code 128 —
   * às vezes Code 39 —, e os fabricantes mais novos põem um QR ou um
   * DataMatrix do lado. Qualquer texto que pareça código serve: quem decide se
   * é MAC, série ou número da casa é a busca do IXC.
   */
  etiqueta: {
    titulo: 'Aponte para a etiqueta do aparelho',
    ajuda: 'O MAC ou a série da etiqueta. Assim que for lido, o aparelho é procurado no IXC.',
    formatosNativos: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13'],
    formatosZxing: ['CODE_128', 'CODE_39', 'QR_CODE', 'DATA_MATRIX', 'EAN_13'],
    aceitar: (bruto: string) => {
      const limpo = bruto.trim();
      return limpo.length >= 3 && limpo.length <= 80 ? limpo : null;
    },
  },
} as const;

export function LeitorDeCodigo({
  alvo = 'boleto',
  onLido,
  onFechar,
}: {
  alvo?: AlvoDaLeitura;
  onLido: (codigo: string) => void;
  onFechar: () => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(true);
  const [lendo, setLendo] = useState(true);

  /*
   * O que fazer com o código lido fica numa caixa, e não na lista do efeito.
   *
   * As telas passam uma função escrita ali mesmo (`onLido={(c) => …}`), que é
   * outra a cada render do formulário — e o formulário renderiza a cada tecla
   * digitada. Com ela na lista de dependências, a câmera era desligada e
   * religada sem parar, e a leitura nunca durava tempo suficiente para achar
   * o código. Era esse o motivo de "não lê nada".
   */
  const aoLer = useRef(onLido);
  useEffect(() => {
    aoLer.current = onLido;
  }, [onLido]);

  useEffect(() => {
    const modo = ALVOS[alvo];
    let parado = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let pararZxing: (() => void) | undefined;

    /** Aceita o que foi lido, se servir; devolve se pode parar a leitura. */
    function aproveitar(bruto: string): boolean {
      const aceito = modo.aceitar(bruto);
      if (!aceito) return false;
      setLendo(false);
      aoLer.current(aceito);
      return true;
    }

    async function comLeitorNativo(Detector: ConstrutorDoDetector) {
      stream = await navigator.mediaDevices.getUserMedia({
        // A câmera de trás é a que enxerga o papel na mesa.
        video: { facingMode: { ideal: 'environment' } },
      });
      if (parado) return stream.getTracks().forEach((t) => t.stop());
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      setPreparando(false);

      const detector = new Detector({ formats: [...modo.formatosNativos] });
      const procurar = async () => {
        if (parado || !video.current) return;
        try {
          for (const achado of await detector.detect(video.current)) {
            if (aproveitar(achado.rawValue)) return;
          }
        } catch {
          // Quadro que não deu para analisar: tenta o próximo.
        }
        // Umas seis leituras por segundo dão conta e não fritam a bateria.
        timer = window.setTimeout(() => void procurar(), 160);
      };
      void procurar();
    }

    async function comZxing() {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
        await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      if (parado) return;

      const hints = new Map();
      hints.set(
        DecodeHintType.POSSIBLE_FORMATS,
        modo.formatosZxing.map(
          (f) => BarcodeFormat[f as keyof typeof BarcodeFormat],
        ),
      );
      const leitor = new BrowserMultiFormatReader(hints);

      const controles = await leitor.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video.current!,
        (resultado) => {
          if (parado || !resultado) return;
          if (aproveitar(resultado.getText())) controles.stop();
        },
      );
      pararZxing = () => controles.stop();
      setPreparando(false);
    }

    async function comecar() {
      try {
        const Detector = detectorNativo();
        if (Detector) await comLeitorNativo(Detector);
        else await comZxing();
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        setErro(
          /denied|permission|NotAllowed/i.test(motivo)
            ? 'A câmera foi bloqueada. Libere o acesso a este site nas permissões do navegador e tente de novo.'
            : /secure|https/i.test(motivo)
              ? 'A câmera só funciona em endereço https.'
              : `Não deu para abrir a câmera: ${motivo}`,
        );
        setPreparando(false);
      }
    }

    void comecar();

    return () => {
      parado = true;
      if (timer) clearTimeout(timer);
      pararZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // Só o alvo reinicia a câmera. O que fazer com o resultado vem da caixa
    // acima, que não derruba a leitura quando a tela redesenha.
  }, [alvo]);

  const modo = ALVOS[alvo];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-barra/95 p-4">
      <div className="flex items-center justify-between gap-3 pb-3">
        <span className="text-sm font-semibold text-white">{modo.titulo}</span>
        <button
          onClick={onFechar}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Fechar
        </button>
      </div>

      {erro ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-sm text-rose-200">{erro}</p>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden rounded-2xl bg-black">
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />
          {/* A mira acompanha o formato: o código de barras é largo e baixo, o
              QR é quadrado. Mirar no formato certo acelera muito a leitura. */}
          <div
            className={
              alvo === 'pix'
                ? 'pointer-events-none absolute left-1/2 top-1/2 aspect-square w-56 max-w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/70'
                : 'pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/70'
            }
          />
        </div>
      )}

      <p className="pt-3 text-center text-xs text-white/60">
        {erro ? '' : preparando ? 'Abrindo a câmera…' : lendo ? modo.ajuda : 'Código lido.'}
      </p>
    </div>
  );
}
