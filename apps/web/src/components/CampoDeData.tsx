import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCelular } from '../lib/celular';

/**
 * Uma data, com calendário desta casa.
 *
 * O `input type="date"` do navegador não se pinta: no tema escuro ele abria um
 * calendário cinza do sistema, com os dias das pontas do mês do mesmo tom dos
 * do mês — e a tela inteira em volta era nossa. Aqui o campo continua aceitando
 * digitação ("22/09/2026", ou só "2209" que ele completa com o ano de hoje) e o
 * calendário é desenhado por nós.
 *
 * **Os dias das pontas ficam apagados, mas clicam** (pedido do dono,
 * 22/09/2026): o 30 e o 31 de agosto que aparecem na primeira semana de
 * setembro são justamente os que alguém quer marcar sem trocar de mês.
 *
 * O valor entra e sai em ISO ("2026-09-22"), igual ao `input type="date"` que
 * ele substituiu — quem chama não muda nada por causa disso.
 */
export function CampoDeData({
  valor,
  onChange,
  id,
  className = 'campo',
  min,
  max,
  title,
  disabled = false,
}: {
  /** "AAAA-MM-DD", ou "" quando vazio. */
  valor: string;
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
  /** Limites, como no campo do navegador: dia fora deles não clica. */
  min?: string;
  max?: string;
  title?: string;
  disabled?: boolean;
}) {
  const celular = useCelular();
  const [aberto, setAberto] = useState(false);
  /** O que está escrito enquanto se digita; fora disso, o valor formatado. */
  const [digitado, setDigitado] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  /*
   * Tocar no campo já abre o calendário — é o que se quer dele nove em cada
   * dez vezes.
   *
   * No celular o campo perde o foco junto: senão o teclado sobe por cima do
   * calendário que acabou de abrir, e o dia fica atrás das teclas. Lá se
   * escolhe pelo calendário, como no campo do próprio aparelho. No computador
   * o foco fica, e quem prefere digitar a data digita por cima.
   */
  function abrirCalendario(alvo?: HTMLInputElement) {
    setAberto(true);
    if (celular) alvo?.blur();
  }

  const escrito = digitado ?? paraTela(valor);

  function aoDigitar(bruto: string) {
    const limpo = mascara(bruto);
    setDigitado(limpo);
    const iso = paraIso(limpo);
    // Só avisa quando a data está inteira: a cada tecla iria "0002-09-20".
    if (iso && dentro(iso, min, max)) onChange(iso);
    if (!limpo) onChange('');
  }

  return (
    /* `w-full` como o campo que ele substituiu: dentro de um rótulo em linha,
       quem manda na largura é a classe que veio de fora (no `input`). */
    <div ref={caixa} className="relative w-full">
      <input
        id={id}
        value={escrito}
        onChange={(e) => aoDigitar(e.target.value)}
        onBlur={() => setDigitado(null)}
        onFocus={(e) => {
          e.currentTarget.select();
          abrirCalendario(e.currentTarget);
        }}
        onClick={(e) => abrirCalendario(e.currentTarget)}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        autoComplete="off"
        disabled={disabled}
        title={title}
        className={`${className} num pr-10`}
      />
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        disabled={disabled}
        aria-label="Abrir o calendário"
        aria-expanded={aberto}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-xl text-tinta-400 transition hover:text-tinta-700 disabled:opacity-40"
      >
        <IconeCalendario />
      </button>

      {aberto && (
        <Calendario
          ancora={caixa.current}
          valor={valor}
          min={min}
          max={max}
          onEscolher={(iso) => {
            onChange(iso);
            setDigitado(null);
            setAberto(false);
          }}
          onFechar={() => setAberto(false)}
        />
      )}
    </div>
  );
}

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * O calendário de um mês, com as pontas do mês vizinho.
 *
 * Seis semanas sempre — o calendário não muda de altura ao passar de mês, e
 * nada embaixo dele pula de lugar. Vai pendurado no `body`, como as outras
 * listas que abrem: dentro de uma janela que rola, ele seria cortado.
 */
function Calendario({
  ancora,
  valor,
  min,
  max,
  onEscolher,
  onFechar,
}: {
  ancora: HTMLElement | null;
  valor: string;
  min?: string;
  max?: string;
  onEscolher: (iso: string) => void;
  onFechar: () => void;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const escolhido = deIso(valor);
  const [mes, setMes] = useState(() => {
    const base = escolhido ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [lugar, setLugar] = useState<{ left: number; top: number } | null>(null);

  // Onde ele cai, medido antes da pintura; sem espaço embaixo, sobe.
  useLayoutEffect(() => {
    if (!ancora) return;
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const altura = painel.current?.offsetHeight ?? 340;
      const largura = painel.current?.offsetWidth ?? 300;
      setLugar({
        left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)),
        top:
          r.bottom + altura + 8 < window.innerHeight
            ? r.bottom + 4
            : Math.max(8, r.top - altura - 4),
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

  // Digitando com o calendário aberto, ele acompanha: escrever 07/11 leva o
  // mês para novembro, em vez de deixar setembro à mostra dizendo outra coisa.
  useEffect(() => {
    const dia = deIso(valor);
    if (dia) setMes(new Date(dia.getFullYear(), dia.getMonth(), 1));
  }, [valor]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Só o calendário fecha: a janela em volta também ouve o Esc.
      e.stopPropagation();
      e.preventDefault();
      onFechar();
    };
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  }, [onFechar]);

  const hoje = emIso(new Date());
  const dias = seisSemanas(mes);

  return createPortal(
    <>
      <div onClick={onFechar} aria-hidden className="fixed inset-0 z-[55]" />
      <div
        ref={painel}
        style={lugar ? { left: lugar.left, top: lugar.top } : { left: -9999, top: 0 }}
        className="fixed z-[56] w-[19rem] rounded-2xl border border-tinta-200 bg-papel p-3 shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <SetaDoMes para={-1} onClick={() => setMes(mesVizinho(mes, -1))} />
          <span className="font-display text-sm font-semibold text-tinta-900">
            {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
          <SetaDoMes para={1} onClick={() => setMes(mesVizinho(mes, 1))} />
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1">
          {DIAS_DA_SEMANA.map((d, i) => (
            <span
              key={i}
              className="text-center text-[11px] font-semibold uppercase text-tinta-400"
            >
              {d}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {dias.map((dia) => {
            const iso = emIso(dia);
            const deOutroMes = dia.getMonth() !== mes.getMonth();
            const podeClicar = dentro(iso, min, max);
            const marcado = iso === valor;
            return (
              <button
                key={iso}
                type="button"
                disabled={!podeClicar}
                onClick={() => onEscolher(iso)}
                className={`num h-9 rounded-lg text-sm transition ${
                  marcado
                    ? 'bg-brand-500 font-semibold text-white'
                    : iso === hoje
                      ? 'font-semibold text-brand-700 ring-1 ring-brand-400 dark:text-brand-300'
                      : deOutroMes
                        ? /* Apagados, e ainda assim clicáveis: o 31 de agosto
                             que aparece na semana de setembro é justamente o
                             que se quer marcar sem trocar de mês. */
                          'text-tinta-400/70 hover:bg-tinta-100 hover:text-tinta-700'
                        : 'text-tinta-700 hover:bg-tinta-100'
                } disabled:pointer-events-none disabled:opacity-30`}
              >
                {dia.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => onEscolher('')}
            className="btn btn-sutil btn-p"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={() => onEscolher(hoje)}
            disabled={!dentro(hoje, min, max)}
            className="btn btn-sutil btn-p"
          >
            Hoje
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function SetaDoMes({ para, onClick }: { para: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={para < 0 ? 'Mês anterior' : 'Próximo mês'}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-tinta-500 transition hover:bg-tinta-100 hover:text-tinta-800"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        style={para < 0 ? undefined : { transform: 'rotate(180deg)' }}
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}

function IconeCalendario() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** As seis semanas que o mês ocupa, começando no domingo. */
function seisSemanas(mes: Date): Date[] {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const comeco = new Date(primeiro);
  comeco.setDate(1 - primeiro.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(comeco);
    d.setDate(comeco.getDate() + i);
    return d;
  });
}

const mesVizinho = (mes: Date, passo: number) =>
  new Date(mes.getFullYear(), mes.getMonth() + passo, 1);

/** Data local → "AAAA-MM-DD" (sem UTC: à meia-noite ele volta um dia). */
function emIso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function deIso(iso: string): Date | null {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return null;
  return new Date(a, m - 1, d);
}

/** "2026-09-22" → "22/09/2026". */
function paraTela(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

/** "22/09/2026" → "2026-09-22"; incompleta ou impossível → null. */
function paraIso(escrito: string): string | null {
  const [d, m, a] = escrito.split('/');
  if (!d || !m || !a || a.length < 4) return null;
  const data = new Date(Number(a), Number(m) - 1, Number(d));
  if (
    data.getFullYear() !== Number(a) ||
    data.getMonth() !== Number(m) - 1 ||
    data.getDate() !== Number(d)
  ) {
    return null;
  }
  return emIso(data);
}

/** A máscara de quem digita: só números, com as barras entrando sozinhas. */
function mascara(bruto: string): string {
  const n = bruto.replace(/\D/g, '').slice(0, 8);
  if (n.length <= 2) return n;
  if (n.length <= 4) return `${n.slice(0, 2)}/${n.slice(2)}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}`;
}

function dentro(iso: string, min?: string, max?: string): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}
