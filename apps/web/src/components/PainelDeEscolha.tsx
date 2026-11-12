import { useEffect, useRef, type KeyboardEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCelular } from '../lib/celular';
import { useLugarDoPainel } from '../lib/lugar-do-painel';
import { travarRolagem } from '../lib/rolagem';
import { usePedacoVisivel } from '../lib/teclado';

/**
 * A moldura da lista de escolher — a de categoria, a de veículo, a das listas
 * longas com busca. O miolo (a busca, as linhas, o rodapé) é de quem chama.
 *
 * **No computador** é o painel de sempre: flutua junto do campo, sem escurecer
 * a tela (`useLugarDoPainel`).
 *
 * **No celular** é um balão preso no alto da tela (pedido do dono, 12/11/2026:
 * "os teclados abram apenas pra onde tem espaço, pra não mexer na posição da
 * tela"). Junto do campo, a lista nascia onde o campo estivesse — quase sempre
 * na metade de baixo, que é onde o teclado sobe — e pulava de lugar quando se
 * tocava na busca. No alto, a busca nasce onde o teclado nunca chega: ele sobe,
 * a lista encurta pelo pé e nada sai do lugar. De quebra a lista ganha a tela
 * inteira, com linhas da altura do dedo (`.escolha-celular`, no `index.css`).
 */
export function PainelDeEscolha({
  ancora,
  larguraMinima = 260,
  remedir,
  onFechar,
  onKeyDown,
  children,
}: {
  /** O campo que abriu a lista: no computador, ela cai junto dele. */
  ancora: HTMLElement | null;
  larguraMinima?: number;
  /** Mudando, o painel do computador mede o lugar de novo. */
  remedir?: unknown;
  onFechar: () => void;
  onKeyDown?: KeyboardEventHandler;
  children: ReactNode;
}) {
  const celular = useCelular();
  return celular ? (
    <NoCelular onFechar={onFechar} onKeyDown={onKeyDown}>
      {children}
    </NoCelular>
  ) : (
    <Flutuante
      ancora={ancora}
      larguraMinima={larguraMinima}
      remedir={remedir}
      onFechar={onFechar}
      onKeyDown={onKeyDown}
    >
      {children}
    </Flutuante>
  );
}

function Flutuante({
  ancora,
  larguraMinima,
  remedir,
  onFechar,
  onKeyDown,
  children,
}: {
  ancora: HTMLElement | null;
  larguraMinima: number;
  remedir?: unknown;
  onFechar: () => void;
  onKeyDown?: KeyboardEventHandler;
  children: ReactNode;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const lugar = useLugarDoPainel(ancora, painel, { larguraMinima, remedir });

  return createPortal(
    <>
      {/* Clicar fora fecha, sem escurecer: o que se está preenchendo fica à vista. */}
      <div onClick={onFechar} aria-hidden className="fixed inset-0 z-[55]" />
      <div
        ref={painel}
        role="listbox"
        onKeyDown={onKeyDown}
        style={lugar}
        className="fixed z-[56] flex flex-col overflow-hidden rounded-xl border border-tinta-200 bg-papel shadow-2xl"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function NoCelular({
  onFechar,
  onKeyDown,
  children,
}: {
  onFechar: () => void;
  onKeyDown?: KeyboardEventHandler;
  children: ReactNode;
}) {
  const visivel = usePedacoVisivel();
  const teclado = visivel?.teclado ?? false;

  // A página de trás não rola enquanto se escolhe.
  useEffect(() => travarRolagem(), []);

  return createPortal(
    <div
      // Tocar no escuro fecha — é lista de escolher, não formulário: não há o
      // que perder.
      onClick={onFechar}
      // Com o teclado aberto, o retângulo que se vê (como a `Janela`): o topo
      // é o mesmo de antes, só o pé sobe.
      style={
        teclado && visivel
          ? {
              top: visivel.top,
              left: visivel.left,
              width: visivel.width,
              height: visivel.height,
              right: 'auto',
              bottom: 'auto',
            }
          : undefined
      }
      className={`fixed inset-0 z-[56] flex flex-col justify-start bg-black/80 px-3 ${
        teclado
          ? 'py-3'
          : 'pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]'
      }`}
    >
      <div
        role="listbox"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="escolha-celular flex max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-tinta-100 bg-papel shadow-2xl"
      >
        {children}
        <button
          type="button"
          onClick={onFechar}
          className="shrink-0 border-t border-tinta-200 py-3 text-center text-[15px] font-semibold text-tinta-600"
        >
          Fechar
        </button>
      </div>
    </div>,
    document.body,
  );
}
