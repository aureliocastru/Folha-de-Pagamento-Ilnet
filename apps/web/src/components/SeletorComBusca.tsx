import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { semAcento } from '../lib/busca';

export interface OpcaoComBusca {
  /** O que vai para o `onChange`. */
  valor: string;
  rotulo: string;
}

/**
 * Uma lista longa de escolher, com a busca junto.
 *
 * É o `<select>` das listas grandes — o plano de contas do IXC tem umas 165
 * contas, e achar "Serviços Terceiros" rolando era ler a lista inteira. O dono
 * já tinha pedido para os veículos, e repetiu na conta contábil: "isso tem que
 * ter em toda lista grande". A busca abre junto com a lista, procura em qualquer
 * parte do rótulo (o código ou o nome, sem acento) e o Enter escolhe o primeiro.
 *
 * `vazio` é a primeira linha, a que devolve `''` — o "Padrão — …" das contas.
 * A lista vai pendurada no `body`, como a do `SeletorDeVeiculo`: escrita no
 * lugar, a janela que rola a cortaria pela metade.
 */
export function SeletorComBusca({
  opcoes,
  value,
  onChange,
  vazio,
  carregando = false,
  id,
  procurar = 'Procurar…',
}: {
  opcoes: OpcaoComBusca[];
  value: string;
  onChange: (valor: string) => void;
  /** O rótulo da linha que devolve `''`. Sem ele, não há essa linha. */
  vazio?: string;
  carregando?: boolean;
  id?: string;
  /** O que o campo de busca diz antes de digitar. */
  procurar?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const escolhida = opcoes.find((o) => o.valor === value);
  const rotulo = escolhida?.rotulo ?? (value === '' ? vazio : value) ?? '';

  return (
    <div className="min-w-0">
      <button
        ref={botao}
        id={id}
        type="button"
        disabled={carregando}
        onClick={() => setAberta(true)}
        aria-haspopup="listbox"
        aria-expanded={aberta}
        className="campo flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{carregando ? 'Carregando…' : rotulo}</span>
        <SetaDeAbrir />
      </button>

      {aberta && (
        <Lista
          ancora={botao.current}
          opcoes={opcoes}
          value={value}
          vazio={vazio}
          procurar={procurar}
          onEscolher={(v) => {
            setAberta(false);
            onChange(v);
            botao.current?.focus();
          }}
          onFechar={() => {
            setAberta(false);
            botao.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/**
 * Aparelho de toque: o foco na busca levantaria o teclado por cima da lista
 * que acabou de abrir. Lá, quem quer procurar toca no campo.
 */
const TELA_DE_TOQUE =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

function Lista({
  ancora,
  opcoes,
  value,
  vazio,
  procurar,
  onEscolher,
  onFechar,
}: {
  ancora: HTMLElement | null;
  opcoes: OpcaoComBusca[];
  value: string;
  vazio?: string;
  procurar: string;
  onEscolher: (valor: string) => void;
  onFechar: () => void;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState('');
  /** A linha que o Enter escolhe — as setas do teclado a movem. */
  const [destaque, setDestaque] = useState(0);
  const [lugar, setLugar] = useState<{ left: number; top: number; width: number } | null>(null);

  // Onde a lista cai, medido antes da pintura; sem espaço embaixo, ela sobe.
  useLayoutEffect(() => {
    if (!ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const altura = painel.current?.offsetHeight ?? 360;
      const cabeEmbaixo = r.bottom + altura + 8 < window.innerHeight;
      const largura = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
      setLugar({
        left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)),
        top: cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - altura - 4),
        width: largura,
      });
    };
    medir();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [ancora]);

  const termo = semAcento(busca.trim());
  const achadas = termo
    ? opcoes.filter((o) => semAcento(o.rotulo).includes(termo))
    : opcoes;
  // Procurando, a linha do padrão sai: quem digita "energia" quer a conta de
  // energia, e o Enter tem de escolher ela.
  const linhas: OpcaoComBusca[] = [
    ...(termo || vazio === undefined ? [] : [{ valor: '', rotulo: vazio }]),
    ...achadas,
  ];
  const marcada = Math.min(destaque, Math.max(0, linhas.length - 1));

  // A linha em destaque acompanha as setas, sem sair da área visível.
  useEffect(() => {
    painel.current
      ?.querySelector(`[data-linha="${marcada}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [marcada]);

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Só a lista fecha: a `Janela` em volta também ouve o Esc.
      e.stopPropagation();
      onFechar();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDestaque(Math.min(marcada + 1, linhas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestaque(Math.max(marcada - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (linhas[marcada]) onEscolher(linhas[marcada].valor);
    }
  }

  return createPortal(
    <>
      {/* Clicar fora fecha, sem escurecer: o formulário fica à vista. */}
      <div onClick={onFechar} aria-hidden className="fixed inset-0 z-[55]" />

      <div
        ref={painel}
        role="listbox"
        onKeyDown={aoTeclar}
        style={lugar ? { left: lugar.left, top: lugar.top, width: lugar.width } : { left: -9999, top: 0 }}
        className="fixed z-[56] overflow-hidden rounded-xl border border-tinta-200 bg-papel shadow-2xl"
      >
        <div className="border-b border-tinta-200 p-2">
          <input
            autoFocus={!TELA_DE_TOQUE}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setDestaque(0);
            }}
            placeholder={procurar}
            aria-label={procurar}
            className="campo py-1.5 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="rolagem-fina max-h-[19rem] overflow-y-auto">
          {linhas.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-tinta-400">
              Nada com esse nome.
            </p>
          ) : (
            linhas.map((o, i) => (
              <button
                key={o.valor || 'vazio'}
                type="button"
                role="option"
                data-linha={i}
                aria-selected={o.valor === value}
                onClick={() => onEscolher(o.valor)}
                onMouseEnter={() => setDestaque(i)}
                className={`flex w-full items-center px-3 py-2.5 text-left text-sm transition ${
                  o.valor === value
                    ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                    : i === marcada
                      ? 'bg-tinta-100 text-tinta-800'
                      : 'text-tinta-700'
                }`}
              >
                <span className={`min-w-0 flex-1 truncate ${o.valor === '' ? 'text-tinta-500' : ''}`}>
                  {o.rotulo}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function SetaDeAbrir() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-tinta-400"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
