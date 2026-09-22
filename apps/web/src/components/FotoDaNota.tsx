import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useCelular } from '../lib/celular';
import { FOTOS_POR_NOTA, reduzirFoto } from '../lib/foto';

/**
 * A foto de uma nota: tirar na hora, anexar a que já está no aparelho, ou —
 * no computador — colar o print com Ctrl+V.
 *
 * Cabem duas: a nota de papel e o visor da bomba, que é onde estão os litros
 * e o valor quando a caneta falha. Na hora de mandar, quem chama as junta
 * lado a lado numa imagem só (ver `juntarFotos`).
 *
 * Os dois botões ficam sempre à vista — no celular a câmera abre direto no
 * "Tirar foto"; no computador ele cai no seletor de arquivo, e dá no mesmo. A
 * foto sai reduzida (ver `reduzirFoto`), em data URL.
 */
export function FotoDaNota({
  fotos,
  onFotos,
  grande = false,
}: {
  fotos: string[];
  onFotos: (fotos: string[]) => void;
  /** Botões da altura do dedo, para a tela do posto. */
  grande?: boolean;
}) {
  const celular = useCelular();
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cheia = fotos.length >= FOTOS_POR_NOTA;
  // O Ctrl+V é ouvido na janela inteira; as fotos e o `onFotos` de agora vêm
  // por aqui, sem trocar o ouvinte a cada vez que a tela desenha.
  const atual = useRef({ fotos, onFotos });
  atual.current = { fotos, onFotos };

  async function usar(arquivos: File[]) {
    const cabem = FOTOS_POR_NOTA - atual.current.fotos.length;
    if (cabem <= 0 || arquivos.length === 0) return;
    setErro(null);
    setPreparando(true);
    try {
      const novas = await Promise.all(arquivos.slice(0, cabem).map(reduzirFoto));
      // Lido de novo depois da espera: uma foto pode ter saído enquanto isso.
      const { fotos: agora, onFotos: avisar } = atual.current;
      avisar([...agora, ...novas].slice(0, FOTOS_POR_NOTA));
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
   * outro campo (o km, o valor), e roubá-lo quebraria a digitação. Com as
   * duas fotos já postas, o Ctrl+V volta a ser dos campos.
   */
  useEffect(() => {
    function aoColar(e: ClipboardEvent) {
      if (atual.current.fotos.length >= FOTOS_POR_NOTA) return;
      const arquivo = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!arquivo) return;
      e.preventDefault();
      void usarAgora.current([arquivo]);
    }
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, []);

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivos = [...(e.target.files ?? [])];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    await usar(arquivos);
  }

  const botao = `btn btn-neutro cursor-pointer ${grande ? 'h-12 text-base' : ''}`;
  const segunda = fotos.length > 0;

  return (
    <div className="space-y-2">
      {segunda && (
        <div className="flex flex-wrap gap-3">
          {fotos.map((foto, i) => (
            <div key={i} className="flex flex-col items-start gap-1">
              <img
                src={foto}
                alt={`Foto ${i + 1} da nota`}
                className="h-28 w-28 rounded-xl border border-tinta-200 object-cover"
              />
              <button
                type="button"
                onClick={() => onFotos(fotos.filter((_, j) => j !== i))}
                className="btn btn-sutil btn-p text-rose-600"
              >
                Tirar esta
              </button>
            </div>
          ))}
        </div>
      )}
      {!cheia && (
        <div className="grid grid-cols-2 gap-2">
          <label className={botao}>
            {preparando ? 'Preparando…' : segunda ? 'Tirar a 2ª foto' : 'Tirar foto'}
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
            {segunda ? 'Anexar a 2ª' : 'Anexar'}
            {/* Da galeria dá para marcar as duas de uma vez. */}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={aoEscolher}
              disabled={preparando}
            />
          </label>
        </div>
      )}
      <p className="ajuda">
        {cheia
          ? 'As duas vão juntas, lado a lado, numa imagem só.'
          : segunda
            ? `Se precisar, uma 2ª: o visor da bomba, o verso da nota.${
                celular ? '' : ' Ou cole o print (Ctrl+V).'
              }`
            : `Cabem duas fotos: a nota e o visor da bomba.${
                celular ? '' : ' Tem o print? É só colar aqui (Ctrl+V).'
              }`}
      </p>
      {erro && <p className="text-xs text-rose-600">{erro}</p>}
    </div>
  );
}
