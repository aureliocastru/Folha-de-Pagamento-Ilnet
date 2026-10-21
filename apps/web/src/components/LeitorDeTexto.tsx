import { useEffect, useRef, useState } from 'react';

/** Onde o último texto lido fica enquanto a aba do navegador estiver aberta. */
const CHAVE = 'leitor-de-texto';

/**
 * Abaixo desta largura o print é ampliado antes da leitura.
 *
 * Print de tela tem letra de 12 a 14 pixels, e o reconhecimento erra letra
 * pequena ("rn" vira "m", vírgula some). Dobrado, ela passa dos 25 pixels, que
 * é onde ele acerta.
 */
const LARGURA_BOA = 1800;

function lerGuardado(): string {
  try {
    return sessionStorage.getItem(CHAVE) ?? '';
  } catch {
    return '';
  }
}

function guardar(texto: string) {
  try {
    sessionStorage.setItem(CHAVE, texto);
  } catch {
    // Sem armazenamento (janela anônima): o texto vale só enquanto a aba vive.
  }
}

/** A imagem do que foi colado, se for imagem. */
export function imagemDaColagem(dados: DataTransfer | null): File | null {
  for (const item of Array.from(dados?.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/** O print desenhado maior e em cinza — é assim que as letras saem certas. */
async function prepararImagem(arquivo: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = bitmap.width < LARGURA_BOA ? Math.min(3, LARGURA_BOA / bitmap.width) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Este navegador não consegue abrir a imagem.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  /*
   * Tela escura vira papel claro.
   *
   * O sistema e o WhatsApp vivem no tema escuro, e o reconhecimento foi feito
   * para letra escura em fundo claro: com o fundo preto ele lê pela metade.
   * Se a média da imagem é escura, as cores se invertem antes.
   */
  const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imagem.data;
  let soma = 0;
  for (let i = 0; i < d.length; i += 4) {
    const cinza = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = cinza;
    soma += cinza;
  }
  const escura = soma / (d.length / 4) < 128;
  if (escura) {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    }
  }
  ctx.putImageData(imagem, 0, 0);
  return canvas;
}

/**
 * Ler texto: cola-se um print e sai o que está escrito nele, para copiar.
 *
 * Mora na segunda aba do bloco de notas — no mesmo canto, em todas as telas.
 * A leitura roda no próprio navegador (o mesmo leitor das guias em PDF sem
 * texto, ver `ocr-pdf.ts`): o print não sai do computador. O português vem
 * do CDN na primeira vez e fica guardado para as próximas.
 */
export function LeitorDeTexto({
  imagemInicial,
  aoUsarImagem,
}: {
  /** O print colado no campo de notas, que trouxe a pessoa até aqui. */
  imagemInicial: File | null;
  aoUsarImagem: () => void;
}) {
  const [texto, setTexto] = useState(lerGuardado);
  const [lendo, setLendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [miniatura, setMiniatura] = useState<string | null>(null);
  const escolherRef = useRef<HTMLInputElement>(null);
  /** A leitura em andamento: um print novo no meio dela vence o antigo. */
  const vezRef = useRef(0);

  async function ler(arquivo: File) {
    const vez = ++vezRef.current;
    setErro(null);
    setCopiado(false);
    setMiniatura((antiga) => {
      if (antiga) URL.revokeObjectURL(antiga);
      return URL.createObjectURL(arquivo);
    });
    setLendo('Preparando a leitura…');
    try {
      const canvas = await prepararImagem(arquivo);
      const { createWorker } = await import('tesseract.js');
      const leitor = await createWorker('por', undefined, {
        logger: (m: { status: string; progress: number }) => {
          if (vez !== vezRef.current) return;
          if (m.status === 'recognizing text') {
            setLendo(`Lendo… ${Math.round(m.progress * 100)}%`);
          } else if (m.status.includes('loading')) {
            setLendo('Preparando a leitura (na primeira vez demora um pouco)…');
          }
        },
      });
      try {
        await leitor.setParameters({ preserve_interword_spaces: '1' });
        const { data } = await leitor.recognize(canvas);
        if (vez !== vezRef.current) return;
        const lido = data.text
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        setTexto(lido);
        guardar(lido);
        if (!lido) setErro('Não achei texto nesta imagem.');
      } finally {
        await leitor.terminate();
      }
    } catch (e) {
      if (vez === vezRef.current) {
        setErro(
          e instanceof Error
            ? `Não deu para ler: ${e.message}`
            : 'Não deu para ler esta imagem.',
        );
      }
    } finally {
      if (vez === vezRef.current) setLendo(null);
    }
  }

  // O print que veio colado no campo de notas é lido assim que a aba abre.
  const lerRef = useRef(ler);
  lerRef.current = ler;
  useEffect(() => {
    if (!imagemInicial) return;
    aoUsarImagem();
    void lerRef.current(imagemInicial);
  }, [imagemInicial, aoUsarImagem]);

  // Ctrl+V em qualquer lugar com a aba aberta: é o gesto do print.
  useEffect(() => {
    function aoColar(e: ClipboardEvent) {
      const imagem = imagemDaColagem(e.clipboardData);
      if (!imagem) return;
      e.preventDefault();
      void lerRef.current(imagem);
    }
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, []);

  useEffect(
    () => () => {
      if (miniatura) URL.revokeObjectURL(miniatura);
    },
    [miniatura],
  );

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      setErro('O navegador não deixou copiar — selecione o texto e use Ctrl+C.');
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const arquivo = Array.from(e.dataTransfer.files).find((f) =>
            f.type.startsWith('image/'),
          );
          if (arquivo) void ler(arquivo);
        }}
        className="flex items-center gap-3 border-b-2 border-dashed border-amber-300 bg-amber-50 px-4 py-2.5"
      >
        {miniatura && (
          <img
            src={miniatura}
            alt="O print lido"
            className="h-10 w-14 shrink-0 rounded border border-amber-300 object-cover"
          />
        )}
        <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-amber-900">
          {lendo ?? 'Cole o print aqui (Ctrl+V) ou arraste a imagem.'}
        </p>
        <button
          type="button"
          onClick={() => escolherRef.current?.click()}
          disabled={!!lendo}
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-2.5 py-1.5 text-[12px] font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          Escolher
        </button>
        <input
          ref={escolherRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = '';
            if (arquivo) void ler(arquivo);
          }}
        />
      </div>

      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setCopiado(false);
          guardar(e.target.value);
        }}
        spellCheck={false}
        placeholder="O texto do print aparece aqui, para corrigir e copiar."
        className="rolagem-fina min-h-0 w-full flex-1 resize-none bg-white px-4 py-3 text-sm leading-relaxed text-slate-800 placeholder:font-semibold placeholder:text-amber-700/45 focus:outline-none"
      />

      {erro && (
        <p className="border-t border-rose-200 bg-rose-50 px-4 py-1.5 text-[12px] font-semibold text-rose-700">
          {erro}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t-2 border-amber-400 bg-amber-100 px-4 py-2 text-[11px] font-semibold text-amber-800">
        <span>Confira os números antes de usar.</span>
        <button
          type="button"
          onClick={() => void copiar()}
          disabled={!texto.trim()}
          className="rounded-lg bg-amber-400 px-3 py-1 text-[12px] font-bold text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}
