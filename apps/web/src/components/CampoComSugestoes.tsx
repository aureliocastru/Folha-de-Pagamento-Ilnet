import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { semAcento } from '../lib/busca';

interface Props {
  value: string;
  onChange: (valor: string) => void;
  sugestoes: readonly string[];
  id?: string;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

/**
 * Campo de texto livre com a lista de sugestões à mão.
 *
 * Era um `<input list>` com `<datalist>`, e o navegador filtra essa lista pelo
 * que já está escrito: com "Pix" no campo, tocar nele mostrava só "Pix", e as
 * outras formas de pagamento pareciam não existir. Para trocar, a pessoa tinha
 * de apagar o campo inteiro antes — coisa que ninguém adivinha.
 *
 * Aqui a lista abre inteira ao tocar, e só passa a filtrar quando a pessoa
 * começa a digitar. Continua aceitando o que não está na lista.
 */
export function CampoComSugestoes({
  value,
  onChange,
  sugestoes,
  id,
  className = 'campo',
  placeholder,
  autoFocus,
  'aria-label': ariaLabel,
}: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const [aberta, setAberta] = useState(false);
  /** Digitou desde que abriu: só então a lista filtra. */
  const [digitou, setDigitou] = useState(false);
  const [marcada, setMarcada] = useState(-1);

  const unicas = [...new Set(sugestoes.filter((s) => s.trim()))];
  const termo = semAcento(value.trim());
  const opcoes =
    digitou && termo
      ? unicas.filter((s) => semAcento(s).includes(termo))
      : unicas;

  function abrir() {
    setAberta(true);
    setDigitou(false);
    setMarcada(-1);
  }

  function fechar() {
    setAberta(false);
    setMarcada(-1);
  }

  function escolher(s: string) {
    onChange(s);
    fechar();
  }

  return (
    <>
      <input
        ref={campo}
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDigitou(true);
          setAberta(true);
          setMarcada(-1);
        }}
        onFocus={abrir}
        onClick={() => {
          if (!aberta) abrir();
        }}
        onBlur={fechar}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && aberta) {
            e.stopPropagation();
            fechar();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!aberta) abrir();
            setMarcada((m) => Math.min(m + 1, opcoes.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setMarcada((m) => Math.max(m - 1, 0));
          } else if (e.key === 'Enter' && aberta && opcoes[marcada]) {
            e.preventDefault();
            escolher(opcoes[marcada]);
          }
        }}
        className={className}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={aberta && opcoes.length > 0}
        autoComplete="off"
      />
      {aberta && opcoes.length > 0 && (
        <ListaDeSugestoes
          ancora={campo.current}
          opcoes={opcoes}
          atual={value}
          marcada={marcada}
          onEscolher={escolher}
        />
      )}
    </>
  );
}

/**
 * A lista aberta, pendurada no `body` e posicionada a partir do campo — escrita
 * no lugar, a janela de um pagamento a cortaria pela metade. Não cabendo
 * embaixo, sobe.
 */
function ListaDeSugestoes({
  ancora,
  opcoes,
  atual,
  marcada,
  onEscolher,
}: {
  ancora: HTMLElement | null;
  opcoes: string[];
  atual: string;
  marcada: number;
  onEscolher: (s: string) => void;
}) {
  const painel = useRef<HTMLUListElement>(null);
  const [lugar, setLugar] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const altura = painel.current?.offsetHeight ?? 240;
      const cabeEmbaixo = r.bottom + altura + 8 < window.innerHeight;
      setLugar({
        left: r.left,
        top: cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - altura - 4),
        width: r.width,
      });
    };
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [ancora, opcoes.length]);

  return createPortal(
    <ul
      ref={painel}
      role="listbox"
      style={
        lugar
          ? { left: lugar.left, top: lugar.top, width: lugar.width }
          : { left: -9999, top: 0 }
      }
      className="rolagem-fina fixed z-[70] max-h-60 overflow-y-auto rounded-xl border border-tinta-200 bg-papel py-1 shadow-2xl"
    >
      {opcoes.map((s, i) => (
        <li
          key={s}
          role="option"
          aria-selected={s === atual}
          // Antes do blur do campo, senão a lista fecha antes do clique chegar.
          onMouseDown={(e) => {
            e.preventDefault();
            onEscolher(s);
          }}
          className={`cursor-pointer px-3 py-2.5 text-sm ${
            i === marcada ? 'bg-tinta-100' : 'hover:bg-tinta-100'
          } ${s === atual ? 'font-semibold' : ''}`}
        >
          {s}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
