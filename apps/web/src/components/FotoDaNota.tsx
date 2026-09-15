import { useState, type ChangeEvent } from 'react';
import { reduzirFoto } from '../lib/foto';

/**
 * A foto de uma nota: tirar na hora ou anexar a que já está no aparelho.
 *
 * Os dois caminhos ficam sempre à vista — no celular a câmera abre direto no
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
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    // Limpo sempre: sem isso, escolher a mesma foto de novo não dispara nada.
    e.target.value = '';
    if (!arquivo) return;
    setErro(null);
    setPreparando(true);
    try {
      onFoto(await reduzirFoto(arquivo));
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparando(false);
    }
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
          <button type="button" onClick={() => onFoto(null)} className="btn btn-sutil btn-p text-rose-600">
            Trocar a foto
          </button>
        </div>
      ) : (
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
      )}
      {erro && <p className="mt-1.5 text-xs text-rose-600">{erro}</p>}
    </div>
  );
}
