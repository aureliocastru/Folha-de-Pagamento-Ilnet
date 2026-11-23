import { useEffect, useRef, useState } from 'react';
import { combina, semAcento } from '../lib/busca';
import { PainelDeEscolha } from './PainelDeEscolha';

/** Uma conta de onde o dinheiro sai, como `/contas-abertas/contas-pagamento` a devolve. */
export interface ContaParaEscolher {
  id: number;
  nome: string;
  ativa: boolean;
  /** As que o servidor sabe que costumam pagar (Sicoob, Bradesco, ModoBank, CX - Werick). */
  usual: boolean;
}

/**
 * As contas do dia a dia: as que o servidor marca como usuais e o caixa do
 * Aurélio, que ele também usa para pagar em mãos (pedido do dono, 23/11/2026:
 * "apenas as 3 contas usadas e os 2 caixas, Aurélio e Werick").
 *
 * O caixa do Aurélio é achado pelo nome: o código dele no IXC não está escrito
 * em lugar nenhum daqui, e o nome é o que se vê na lista.
 */
export function contaDoDiaADia(c: ContaParaEscolher): boolean {
  return c.usual || /^caixa\s*-\s*aurelio\b/.test(semAcento(c.nome));
}

const nomeNaLista = (c: ContaParaEscolher) => `${c.nome}${c.ativa ? '' : ' (inativa)'}`;

/**
 * A conta de pagamento, escolhida numa lista curta com busca.
 *
 * O cadastro do IXC tem mais de vinte contas, quase todas de banco e caixa que
 * a empresa não usa mais — e a lista inteira escondia as cinco de sempre. Aqui
 * a lista abre só com elas (mais a conta que já estiver escolhida, para não
 * sumir da vista), e as outras ficam à distância de uma busca: escreve parte
 * do nome e Enter escolhe a primeira.
 *
 * A lista vai pendurada no `body`, como a de veículo e a de categoria: escrita
 * no lugar, a janela que rola a cortaria pela metade.
 */
export function SeletorDeConta({
  contas,
  value,
  onChange,
  padrao,
  carregando = false,
  id,
  incluirInativas = true,
}: {
  contas: ContaParaEscolher[];
  /** O código da conta escolhida; vazio = a linha "padrão". */
  value: string;
  onChange: (id: string) => void;
  /** O que a linha de valor vazio diz: "Padrão — Conta ModoBank PIX", "Do título — …". */
  padrao: string;
  carregando?: boolean;
  id?: string;
  /** Falso onde uma conta inativa não pode receber o pagamento. */
  incluirInativas?: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const oferecidas = incluirInativas ? contas : contas.filter((c) => c.ativa);
  const escolhida = contas.find((c) => String(c.id) === value);

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
        className="campo flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">
          {carregando ? 'Carregando…' : value ? (escolhida?.nome ?? `Conta ${value}`) : padrao}
        </span>
        <SetaDeAbrir />
      </button>

      {aberta && (
        <ListaDeContas
          ancora={botao.current}
          contas={oferecidas}
          value={value}
          padrao={padrao}
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

function ListaDeContas({
  ancora,
  contas,
  value,
  padrao,
  onEscolher,
  onFechar,
}: {
  ancora: HTMLElement | null;
  contas: ContaParaEscolher[];
  value: string;
  padrao: string;
  onEscolher: (id: string) => void;
  onFechar: () => void;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const [busca, setBusca] = useState('');
  /** A linha que o Enter escolhe — as setas do teclado a movem. */
  const [destaque, setDestaque] = useState(0);
  const procurando = busca.trim() !== '';

  const doDia = contas.filter(contaDoDiaADia);
  const atual = contas.find((c) => String(c.id) === value);
  // Sem busca: o padrão e as do dia a dia — e a escolhida, se for outra.
  // Com busca: todas, as do dia a dia na frente.
  const linhas: Array<ContaParaEscolher | null> = procurando
    ? [...doDia, ...contas.filter((c) => !contaDoDiaADia(c))].filter((c) => combina([c.nome], busca))
    : [null, ...doDia, ...(atual && !contaDoDiaADia(atual) ? [atual] : [])];
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
      if (linhas.length > 0) onEscolher(linhas[marcada] ? String(linhas[marcada]!.id) : '');
    }
  }

  return (
    <PainelDeEscolha ancora={ancora} remedir={linhas.length} onFechar={onFechar} onKeyDown={aoTeclar}>
      <div ref={painel} className="contents">
        <div className="shrink-0 border-b border-tinta-200 p-2">
          <input
            autoFocus={!TELA_DE_TOQUE}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setDestaque(0);
            }}
            placeholder="Procurar outra conta…"
            aria-label="Procurar conta de pagamento"
            className="campo"
            autoComplete="off"
          />
        </div>

        <div className="rolagem-fina lista-de-escolha min-h-0 overflow-y-auto">
          {linhas.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-tinta-400">Nenhuma conta com esse nome.</p>
          ) : (
            linhas.map((c, i) => {
              const valor = c ? String(c.id) : '';
              return (
                <button
                  key={c?.id ?? 'padrao'}
                  type="button"
                  role="option"
                  data-linha={i}
                  aria-selected={valor === value}
                  onClick={() => onEscolher(valor)}
                  onMouseEnter={() => setDestaque(i)}
                  className={`flex w-full items-center px-3 py-2 text-left text-sm transition ${
                    valor === value
                      ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                      : i === marcada
                        ? 'bg-tinta-100 text-tinta-800'
                        : 'text-tinta-700'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {c ? nomeNaLista(c) : <span className="text-tinta-500">{padrao}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </PainelDeEscolha>
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
