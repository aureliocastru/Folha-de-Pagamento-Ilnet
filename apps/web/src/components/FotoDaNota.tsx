import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useCelular } from '../lib/celular';
import { reduzirFoto } from '../lib/foto';

/**
 * A foto de uma nota: tirar na hora, anexar a que já está no aparelho, ou —
 * no computador — colar o print com Ctrl+V.
 *
 * Os dois botões ficam sempre à vista — no celular a câmera abre direto no
 * "Tirar foto"; no computador ele cai no seletor de arquivo, e dá no mesmo. A
 * foto sai reduzida (ver `reduzirFoto`), em data URL.
 */
export function FotoDaNota({
  foto,
  onFoto,
  grande = false,
}: {
  foto: string | null;
  onFoto: (foto: string | null) => void;
  /** Botões da altura do dedo, para a tela do posto. */
  grande?: boolean;
}) {
  const celular = useCelular();
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O Ctrl+V é ouvido na janela inteira; o `onFoto` de agora vem por aqui,
  // sem trocar o ouvinte a cada vez que a tela desenha.
  const aoTerFoto = useRef(onFoto);
  aoTerFoto.current = onFoto;

  async function usar(arquivo: File) {
    setErro(null);
    setPreparando(true);
    try {
      aoTerFoto.current(await reduzirFoto(arquivo));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparando(false);
    }
  }
  const usarAgora = useRef(usar);
  usarAgora.current = usar;

  /*
   * Colar o print da nota — o que chegou pelo WhatsApp Web, o recorte da tela
   * —, como na nota da Nova Despesa. Na janela inteira, e não num quadrado
   * onde clicar antes: quem copiou quer colar. Só imagem: texto colado é de
   * outro campo (o km, o valor), e roubá-lo quebraria a digitação.
   */
  useEffect(() => {
    function aoColar(e: ClipboardEvent) {
      const arquivo = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!arquivo) return;
      e.preventDefault();
      void usarAgora.current(arquivo);
    }
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, []);

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    if (!arquivo) return;
    await usar(arquivo);
  }

  const botao = `btn btn-neutro cursor-pointer ${grande ? 'h-12 text-base' : ''}`;

  return (
    <div>
      {foto ? (
        <div className="flex items-start gap-3">
          <img
            src={foto}
            alt="Foto da nota"
            className="h-28 w-28 rounded-xl border border-tinta-200 object-cover"
          />
          <div>
            <button type="button" onClick={() => onFoto(null)} className="btn btn-sutil btn-p text-rose-600">
              Trocar a foto
            </button>
            {!celular && <p className="ajuda">Ou cole outro print aqui (Ctrl+V).</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className={botao}>
              {preparando ? 'Preparando…' : 'Tirar foto'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={aoEscolher}
                disabled={preparando}
              />
            </label>
            <label className={botao}>
              Anexar
              <input type="file" accept="image/*" className="hidden" onChange={aoEscolher} disabled={preparando} />
            </label>
          </div>
          {!celular && (
            <p className="ajuda">Tem o print da nota? É só colar aqui (Ctrl+V).</p>
          )}
        </>
      )}
      {erro && <p className="mt-1.5 text-xs text-rose-600">{erro}</p>}
    </div>
  );
}
