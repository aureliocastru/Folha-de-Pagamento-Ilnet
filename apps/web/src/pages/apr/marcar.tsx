import type { ItemApr } from '../../lib/types';

/**
 * As peças de marcar do formulário — os quadradinhos que o papel tinha.
 *
 * Ficam fora da tela que as usa porque servem a cinco blocos diferentes
 * (normas, atividade, riscos, ferramentas, proteções) e porque a regra de
 * desenho delas é uma só: alvo grande, texto inteiro, nada cortado.
 */

/** O que a tela guarda de cada item marcável. */
export interface Marcacao {
  marcado: boolean;
  detalhe: string;
}

export type DefinirMarcacoes = React.Dispatch<
  React.SetStateAction<Record<string, Marcacao>>
>;



/** Um bloco com título e a grade de itens embaixo. */
export function BlocoDeMarcar({
  titulo,
  itens,
  marcacoes,
  setMarcacoes,
}: {
  titulo: string;
  itens: ItemApr[];
  marcacoes: Record<string, Marcacao>;
  setMarcacoes: React.Dispatch<React.SetStateAction<Record<string, Marcacao>>>;
}) {
  if (itens.length === 0) return null;

  return (
    <section className="mb-7">
      <h2 className="mb-3 font-display text-[15px] font-semibold leading-snug text-tinta-900">
        {titulo}
      </h2>
      <Grade itens={itens} marcacoes={marcacoes} setMarcacoes={setMarcacoes} />
    </section>
  );
}

/** O mesmo, em versão curta: título pequeno e itens em linha. */
export function MarcarEmLinha({
  titulo,
  itens,
  marcacoes,
  setMarcacoes,
}: {
  titulo: string;
  itens: ItemApr[];
  marcacoes: Record<string, Marcacao>;
  setMarcacoes: React.Dispatch<React.SetStateAction<Record<string, Marcacao>>>;
}) {
  if (itens.length === 0) return null;

  return (
    <div>
      <span className="rotulo">{titulo}</span>
      <Grade itens={itens} marcacoes={marcacoes} setMarcacoes={setMarcacoes} />
    </div>
  );
}

/**
 * Os itens marcáveis, em duas colunas no celular.
 *
 * Alvo grande e texto inteiro: a lista tem "Cones de segurança p/ sinalização
 * de área" ao lado de "Frio", e cortar o comprido faria dois itens diferentes
 * parecerem o mesmo. Por isso a altura é livre e o texto quebra.
 */
export function Grade({
  itens,
  marcacoes,
  setMarcacoes,
}: {
  itens: ItemApr[];
  marcacoes: Record<string, Marcacao>;
  setMarcacoes: React.Dispatch<React.SetStateAction<Record<string, Marcacao>>>;
}) {
  function alternar(item: ItemApr) {
    setMarcacoes((atual) => {
      const marcado = !atual[item.id]?.marcado;
      return {
        ...atual,
        [item.id]: { marcado, detalhe: marcado ? (atual[item.id]?.detalhe ?? '') : '' },
      };
    });
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {itens.map((item) => {
        const marcado = marcacoes[item.id]?.marcado ?? false;
        return (
          <div
            key={item.id}
            className={item.pedeDetalhe && marcado ? 'col-span-2 sm:col-span-3' : ''}
          >
            <button
              type="button"
              onClick={() => alternar(item)}
              aria-pressed={marcado}
              className={`flex w-full items-start gap-2 break-words rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition ${
                marcado
                  ? 'border-brand-500 bg-brand-500/10 font-semibold text-brand-800 dark:text-brand-200'
                  : 'border-tinta-200 bg-papel text-tinta-700 hover:border-tinta-300'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                  marcado
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-tinta-300'
                }`}
              >
                {marcado && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m4 12 5.5 5.5L20 7" />
                  </svg>
                )}
              </span>
              {item.texto}
            </button>

            {item.pedeDetalhe && marcado && (
              <input
                className="campo mt-2"
                value={marcacoes[item.id]?.detalhe ?? ''}
                onChange={(e) =>
                  setMarcacoes((atual) => ({
                    ...atual,
                    [item.id]: { marcado: true, detalhe: e.target.value },
                  }))
                }
                placeholder="Escreva quais"
                aria-label={`Detalhe de ${item.texto}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

