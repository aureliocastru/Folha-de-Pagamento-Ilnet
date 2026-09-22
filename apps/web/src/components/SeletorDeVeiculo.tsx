import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { semAcento } from '../lib/busca';

export interface VeiculoDaLista {
  id: string;
  apelido: string;
  placa: string | null;
}

/** "SNF-6C00", "snf 6c00" → "SNF6C00": a placa como se digita, de qualquer jeito. */
function soLetrasENumeros(texto: string): string {
  return semAcento(texto).replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * A ordem da lista: pela placa, que é como a frota se reconhece na nota e no
 * posto (pedido do dono, em 19/09/2026). O que não tem placa — o galão de
 * diesel, a retroescavadeira — vem depois, pelo nome.
 */
export function ordenarPorPlaca(veiculos: VeiculoDaLista[]): VeiculoDaLista[] {
  return [...veiculos].sort((a, b) => {
    if (a.placa && b.placa) return a.placa.localeCompare(b.placa, 'pt-BR');
    if (a.placa) return -1;
    if (b.placa) return 1;
    return a.apelido.localeCompare(b.apelido, 'pt-BR');
  });
}

/**
 * O veículo da frota de uma conta, escolhido numa lista com busca.
 *
 * Não é um `<select>`: com vinte e tantos veículos, e o nome de cada um
 * começando por "MOBI", "STRADA", "FAN", achar o carro rolando era ler a lista
 * inteira. Aqui a busca abre junto com a lista, e acha pela placa (com ou sem
 * traço) ou pelo nome — "cleyson", "snf6". Enter escolhe o primeiro.
 *
 * A lista vai pendurada no `body`, como a do `SeletorDeCategoria`: escrita no
 * lugar, a janela que rola a cortaria pela metade.
 *
 * Serve também ao "Pra onde foi" do galão, no celular: lá a escolha é
 * obrigatória (sem "Nenhum") e a última linha é a de escrever outro destino.
 */
export function SeletorDeVeiculo({
  veiculos,
  value,
  onChange,
  carregando = false,
  id,
  vazio = 'Nenhum',
  obrigatorio = false,
  extra,
  grande = false,
}: {
  veiculos: VeiculoDaLista[];
  value: string;
  onChange: (id: string) => void;
  carregando?: boolean;
  id?: string;
  /** O que o botão diz antes de escolher. */
  vazio?: string;
  /** Sem a linha "Nenhum": um veículo tem de ser escolhido. */
  obrigatorio?: boolean;
  /** Uma linha a mais, sempre no fim da lista, fora da busca: "Outro destino…". */
  extra?: { id: string; rotulo: string };
  /** Da altura do dedo, para a tela do posto. */
  grande?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const linhaExtra = extra ? { id: extra.id, apelido: extra.rotulo, placa: null } : null;
  const escolhido =
    veiculos.find((v) => v.id === value) ??
    (linhaExtra && value === linhaExtra.id ? linhaExtra : null);

  return (
    <div>
      <button
        ref={botao}
        id={id}
        type="button"
        disabled={carregando}
        onClick={() => setAberta(true)}
        aria-haspopup="listbox"
        aria-expanded={aberta}
        className={`campo flex items-center justify-between gap-2 text-left ${
          grande ? 'h-12 text-base' : ''
        }`}
      >
        <span className={`truncate ${escolhido ? '' : 'text-tinta-400'}`}>
          {carregando ? 'Carregando…' : escolhido ? <Nome v={escolhido} /> : vazio}
        </span>
        <SetaDeAbrir />
      </button>

      {aberta && (
        <ListaDeVeiculos
          ancora={botao.current}
          veiculos={veiculos}
          value={value}
          vazio={obrigatorio ? null : vazio}
          extra={linhaExtra}
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

/** A placa na frente, porque é por ela que a lista está em ordem. */
function Nome({ v }: { v: VeiculoDaLista }) {
  return v.placa ? (
    <>
      <span className="num font-semibold">{v.placa}</span>
      <span className="text-tinta-500"> · </span>
      {v.apelido}
    </>
  ) : (
    <>{v.apelido}</>
  );
}

/**
 * Aparelho de toque: o foco na busca levantaria o teclado por cima da lista
 * que acabou de abrir. Lá, quem quer procurar toca no campo.
 */
const TELA_DE_TOQUE =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;

function ListaDeVeiculos({
  ancora,
  veiculos,
  value,
  vazio,
  extra,
  onEscolher,
  onFechar,
}: {
  ancora: HTMLElement | null;
  veiculos: VeiculoDaLista[];
  value: string;
  /** O rótulo da linha que desmarca. Null = não há essa linha. */
  vazio: string | null;
  extra: VeiculoDaLista | null;
  onEscolher: (id: string) => void;
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
      setLugar({
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        top: cabeEmbaixo ? r.bottom + 4 : Math.max(8, r.top - altura - 4),
        width: Math.max(r.width, 260),
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
  const placaDigitada = soLetrasENumeros(busca);
  const achados = ordenarPorPlaca(veiculos).filter(
    (v) =>
      !termo ||
      semAcento(v.apelido).includes(termo) ||
      (placaDigitada.length > 0 && soLetrasENumeros(v.placa ?? '').includes(placaDigitada)),
  );
  // Sem busca, "Nenhum" é a primeira linha — é a escolha de quem desmarca. O
  // extra fica no fim mesmo sem achado: não achar a roçadeira na frota é
  // justamente a hora de escrever outro destino.
  const linhas: Array<VeiculoDaLista | null> = [
    ...(termo || vazio == null ? [] : [null]),
    ...achados,
    ...(extra ? [extra] : []),
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
      // Só a lista fecha: a `Janela` em volta também ouve o Esc, e fecharia a
      // conta inteira que se está lançando.
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
      if (linhas.length > 0) onEscolher(linhas[marcada]?.id ?? '');
    }
  }

  return createPortal(
    <>
      {/* Clicar fora fecha, sem escurecer: a conta que se lança fica à vista. */}
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
            placeholder="Procurar pela placa ou pelo nome…"
            aria-label="Procurar veículo"
            className="campo py-1.5 text-sm"
            autoComplete="off"
          />
        </div>

        <div className="rolagem-fina max-h-[19rem] overflow-y-auto">
          {linhas.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-tinta-400">
              Nenhum veículo com essa placa ou nome.
            </p>
          ) : (
            linhas.map((v, i) => (
              <button
                key={v?.id ?? 'nenhum'}
                type="button"
                role="option"
                data-linha={i}
                aria-selected={(v?.id ?? '') === value}
                onClick={() => onEscolher(v?.id ?? '')}
                onMouseEnter={() => setDestaque(i)}
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition ${
                  (v?.id ?? '') === value
                    ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                    : i === marcada
                      ? 'bg-tinta-100 text-tinta-800'
                      : 'text-tinta-700'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {!v ? (
                    <span className="text-tinta-500">{vazio}</span>
                  ) : v === extra ? (
                    <span className="font-semibold text-tinta-600">{v.apelido}</span>
                  ) : (
                    <Nome v={v} />
                  )}
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
