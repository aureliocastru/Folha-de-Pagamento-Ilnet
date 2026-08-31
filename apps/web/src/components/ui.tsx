import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatNumeroBR } from '../lib/format';
import { IconeVoltar } from './icones';

/**
 * Peças compartilhadas da interface. A regra da casa: o número é o herói —
 * tudo em volta (rótulo, moldura, cor) existe para deixá-lo conferível.
 */

/**
 * Quantos dígitos o campo aceita: até R$ 99.999.999.999,99. Bem acima de
 * qualquer conta desta casa, e longe do ponto em que o JavaScript começa a
 * perder centavo em número inteiro.
 */
const MAX_DIGITOS = 13;

/**
 * Campo de dinheiro, com a máscara se montando enquanto se digita: os dígitos
 * entram pela direita e o ponto de milhar e a vírgula aparecem sozinhos —
 * 5 vira "0,05", 500 vira "5,00", 5000100 vira "50.001,00".
 *
 * Antes o campo só se formatava ao perder o foco, e no meio da digitação
 * mostrava "50001" cru. Num sistema de pagamento é justamente aí que o erro
 * mora: "50001" tanto pode ser cinquenta mil e um reais quanto quinhentos
 * reais e um centavo, e quem confere um lote de contas não tem como saber
 * qual dos dois vai sair — o número só se revelava depois de sair do campo.
 * Com a máscara, o que está escrito é sempre o que vai ser pago.
 *
 * É `text` de propósito: `input type="number"` não aceita ponto de milhar nem
 * vírgula, e o navegador devolvia string vazia — o valor sumia sem avisar
 * ninguém.
 *
 * O que se cola continua funcionando, e pelo mesmo caminho: de "R$ 2.107,03",
 * "2.107,03" ou "2107.03" sobram os dígitos "210703", que é exatamente o que
 * alguém teclaria. Valor vindo do IXC sempre traz as duas casas, então colar e
 * digitar dão o mesmo resultado.
 */
export function CampoDinheiro({
  valor,
  onChange,
  className = 'campo',
  placeholder = '0,00',
  id,
}: {
  /** Valor canônico: "2107.03" ou "" quando vazio. */
  valor: string;
  onChange: (valor: string) => void;
  className?: string;
  placeholder?: string;
  /** Para o `htmlFor` do rótulo: sem ele, clicar no rótulo não faz nada. */
  id?: string;
}) {
  /** O que está escrito, guardado como os dígitos que o compõem. */
  const [digitos, setDigitos] = useState(() => digitosDoValor(valor));
  const emitido = useRef(valor);
  const campo = useRef<HTMLInputElement>(null);

  // Valor que não saiu daqui veio de fora (recarregou o cadastro, recalculou a
  // folha): aí sim reescreve o campo.
  useEffect(() => {
    if (valor === emitido.current) return;
    emitido.current = valor;
    setDigitos(digitosDoValor(valor));
  }, [valor]);

  /*
   * O cursor fica sempre no fim.
   *
   * Numa máscara que se monta pela direita, cada tecla empurra tudo uma casa —
   * o "1" digitado com o cursor no meio de "50.001,00" não entra onde o cursor
   * está, entra nos centavos. Deixar o cursor onde ele caiu daria a impressão
   * de que dá para editar no meio, e o valor sairia diferente do que a pessoa
   * pensou ter escrito.
   */
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el || document.activeElement !== el) return;
    el.setSelectionRange(el.value.length, el.value.length);
  }, [digitos]);

  function aoDigitar(bruto: string) {
    const novos = somenteDigitosSignificativos(bruto);
    setDigitos(novos);

    // Canônico com as duas casas, que é o que a API espera. Vazio continua
    // vazio: campo em branco não é zero, é "não preenchido".
    const canonico = novos ? (Number(novos) / 100).toFixed(2) : '';
    emitido.current = canonico;
    onChange(canonico);
  }

  return (
    <input
      ref={campo}
      id={id}
      type="text"
      // Só dígitos são teclados aqui, então o celular abre o teclado numérico
      // em vez do de decimais com vírgula que ninguém precisa mais usar.
      inputMode="numeric"
      value={digitos ? formatNumeroBR(Number(digitos) / 100) : ''}
      placeholder={placeholder}
      className={className}
      onChange={(e) => aoDigitar(e.target.value)}
      onFocus={(e) =>
        e.target.setSelectionRange(e.target.value.length, e.target.value.length)
      }
    />
  );
}

/**
 * Os dígitos que importam do que foi digitado ou colado.
 *
 * Os zeros da frente saem para o campo poder ser esvaziado: apagando "0,05"
 * até o fim sobra "00", e sem essa limpeza ele empacaria em "0,00" para
 * sempre, sem deixar voltar ao branco.
 */
function somenteDigitosSignificativos(bruto: string): string {
  return bruto.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITOS);
}

/** Canônico ("2107.03") → os dígitos que o escrevem ("210703"). */
function digitosDoValor(valor: string): string {
  const n = Number(valor);
  if (!valor || !Number.isFinite(n)) return '';
  // Arredondar antes é obrigatório: 2107.03 * 100 dá 210702.99999… em ponto
  // flutuante, e truncar isso comeria um centavo.
  return somenteDigitosSignificativos(String(Math.round(Math.abs(n) * 100)));
}

export function Pagina({ children }: { children: ReactNode }) {
  return (
    // pt-20 no celular: o conteúdo passa por baixo do botão do menu.
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-20 sm:px-6 lg:px-7 lg:pt-6">
      {children}
    </div>
  );
}

export function CabecalhoPagina({
  secao,
  titulo,
  descricao,
  voltar,
  acoes,
}: {
  /** Onde a pessoa está — a mesma palavra da barra lateral. */
  secao: string;
  titulo: string;
  descricao?: ReactNode;
  /**
   * Para onde volta a seta, quando a tela tem de onde voltar.
   *
   * Ela mora aqui, encostada no título, e não numa linha própria acima dele:
   * solta lá em cima ela vira um link de rodapé no lugar errado — do tamanho
   * de uma legenda, longe do que nomeia a tela, e ninguém a vê.
   */
  voltar?: () => void;
  acoes?: ReactNode;
}) {
  return (
    <header className="surgir mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {voltar && (
          <button
            type="button"
            onClick={voltar}
            aria-label="Voltar"
            title="Voltar para a tela anterior"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-tinta-200 bg-papel text-tinta-600 transition hover:border-brand-300 hover:bg-brand-500/5 hover:text-brand-700"
          >
            <IconeVoltar className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <p className="eyebrow mb-1">{secao}</p>
          <h1 className="titulo-pagina">{titulo}</h1>
          {descricao && (
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-tinta-500">
              {descricao}
            </p>
          )}
        </div>
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </header>
  );
}

export function Bloco({
  titulo,
  acao,
  className = '',
  semPadding = false,
  esticado = false,
  children,
}: {
  titulo?: string;
  acao?: ReactNode;
  className?: string;
  /** Para tabelas, que sangram até a borda do cartão. */
  semPadding?: boolean;
  /**
   * O conteúdo cresce até o pé do cartão. Serve a quem está lado a lado com um
   * bloco mais alto: sem isto, um gráfico de altura fixa deixa meio cartão
   * vazio só porque o vizinho tem muitas linhas.
   */
  esticado?: boolean;
  children: ReactNode;
}) {
    return (
    <section className={`card ${esticado ? 'flex h-full flex-col' : ''} ${className}`}>
      {titulo && (
        <div className="faixa-titulo flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <h2 className="titulo-bloco">{titulo}</h2>
          {acao}
        </div>
      )}
      <div
        className={`${esticado ? 'flex min-h-0 flex-1 flex-col' : ''} ${
          // O topo já não vem de graça: a faixa do título agora tem borda
          // própria, e sem esta folga o conteúdo encostaria nela.
          semPadding ? '' : 'px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5'
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Janela por cima da tela, para o que precisa de resposta agora — pagar alguém,
 * por exemplo. Um bloco no rodapé da página resolveria o mesmo, mas nasce fora
 * da área visível: quem clica em "Pagar" no meio de uma tabela longa não vê
 * nada acontecer e conclui que o botão está quebrado.
 */
export function Janela({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    // Rolar a página atrás da janela tira do lugar o que se está lendo nela.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar]);

  return (
    /*
     * O clique no fundo não fecha: estas janelas carregam trabalho — um
     * pagamento conferido, uma edição de meia dúzia de campos — e um clique
     * fora de mira jogava tudo fora sem perguntar. Sai pelo X ou pelo Esc,
     * que são gestos de quem quer sair.
     */
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto rolagem-fina bg-barra/70 p-4 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="surgir my-auto h-fit w-full max-w-5xl rounded-2xl border border-tinta-100 bg-papel shadow-2xl"
      >
        <div className="faixa-titulo flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
          <h2 className="titulo-bloco">{titulo}</h2>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none text-tinta-400 transition hover:bg-tinta-100 hover:text-tinta-700"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

/**
 * A foto de uma nota, do tamanho da tela.
 *
 * A miniatura não serve para o que ela é: um recibo escrito à mão, com valor
 * e assinatura, que alguém precisa **ler** para dar a saída por conferida.
 * Antes o caminho para vê-la inteira era um link para a própria imagem — e a
 * imagem é um `data:` de meio megabyte, endereço que o Chrome recusa abrir na
 * barra desde 2018. A aba abria em branco, com o base64 no lugar do endereço,
 * e a nota continuava do tamanho de um selo.
 *
 * Aqui a imagem não vai a lugar nenhum: ela cresce dentro da página. Clicar
 * alterna entre caber na tela e o tamanho de verdade — foto de celular tem
 * mais pixels que o monitor, e é dessa sobra que sai a letra miúda do papel.
 */
export function FotoAmpliada({
  src,
  titulo,
  onFechar,
  onAnterior,
  onProxima,
}: {
  src: string;
  titulo: string;
  onFechar: () => void;
  /**
   * As vizinhas, quando a saída tem mais de uma nota. Ausente é ponta da
   * sequência: a seta some, e o "Nota 3 de 3" no alto diz por quê.
   */
  onAnterior?: () => void;
  onProxima?: () => void;
}) {
  const [inteira, setInteira] = useState(false);

  /*
   * Cada nota começa cabendo na tela.
   *
   * Quem está passando pelas fotos de uma saída quer ver o papel inteiro
   * primeiro; herdar o zoom da anterior abriria a próxima num pedaço do
   * meio, e a mesma foto pareceria outra coisa.
   */
  useEffect(() => setInteira(false), [src]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
      // Sem o `preventDefault`, a seta ainda rola a foto ampliada por baixo.
      if (e.key === 'ArrowLeft' && onAnterior) {
        e.preventDefault();
        onAnterior();
      }
      if (e.key === 'ArrowRight' && onProxima) {
        e.preventDefault();
        onProxima();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    // Rolar a página atrás tira do lugar a lista que se estava conferindo.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar, onAnterior, onProxima]);

  /*
   * Vai pendurada no `body`, e não onde foi escrita.
   *
   * `position: fixed` mede a partir da tela — menos quando algum ancestral
   * tem `transform`, que é o caso: o cartão da conferência entra com a
   * animação `surgir`, e ela deixa lá uma matriz. Escrita no lugar, a tela
   * cheia ficava do tamanho do cartão (974 x 535 numa tela de 1280 x 720) —
   * a foto crescia um pouco e continuava ilegível.
   */
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-barra/95 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-3 pb-3">
        <span className="text-sm font-semibold text-white">{titulo}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInteira((v) => !v)}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            {inteira ? 'Caber na tela' : 'Tamanho real'}
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            Fechar
          </button>
        </div>
      </div>

      {/*
        Clicar no fundo fecha — ao contrário da `Janela`, aqui não há trabalho
        a perder: é uma foto sendo olhada, e quem abriu para ler sai pelo
        mesmo gesto com que entrou.
      */}
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onFechar();
        }}
        className={`flex-1 rounded-2xl bg-black/40 ${
          inteira
            ? 'overflow-auto rolagem-fina p-2'
            : 'flex items-center justify-center overflow-hidden p-2'
        }`}
      >
        <img
          src={src}
          alt={titulo}
          onClick={() => setInteira((v) => !v)}
          className={
            inteira
              ? 'max-w-none cursor-zoom-out rounded-lg'
              : 'max-h-full max-w-full cursor-zoom-in rounded-lg object-contain'
          }
        />
      </div>

      {/*
        As setas ficam por cima da foto, e não na barra de cima: passar de uma
        nota para a outra é o gesto que mais se repete quando a saída tem três
        recibos, e ele fica mais curto na beirada da tela, onde o dedo e o
        ponteiro já estão. Fora do container que rola, para não irem embora
        junto com a foto em tamanho real.
      */}
      {onAnterior && (
        <SetaDaFoto para="anterior" onClick={onAnterior} />
      )}
      {onProxima && <SetaDaFoto para="próxima" onClick={onProxima} />}
    </div>,
    document.body,
  );
}

/** A seta que passa para a nota vizinha, colada na beirada da tela. */
function SetaDaFoto({
  para,
  onClick,
}: {
  para: 'anterior' | 'próxima';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={para === 'anterior' ? 'Nota anterior' : 'Próxima nota'}
      title={para === 'anterior' ? 'Nota anterior' : 'Próxima nota'}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/20 bg-barra/80 px-4 py-3 text-xl leading-none text-white/80 shadow-lg backdrop-blur-sm transition hover:bg-white/15 hover:text-white ${
        para === 'anterior' ? 'left-3 sm:left-5' : 'right-3 sm:right-5'
      }`}
    >
      {para === 'anterior' ? '‹' : '›'}
    </button>
  );
}

/** Indicador de topo: rótulo pequeno, número grande, contexto embaixo. */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  alerta,
  acento = false,
  onClick,
  aberto = false,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  /** Texto em vermelho: algo aqui precisa de você. */
  alerta?: string;
  /** Destaca o indicador principal da tela. */
  acento?: boolean;
  /**
   * Abre o detalhamento deste número. Com ele o cartão vira botão: o valor
   * fica limpo e o que explica sai da letra miúda para um painel legível.
   */
  onClick?: () => void;
  /** Este é o cartão cujo detalhe está aberto. */
  aberto?: boolean;
}) {
  const conteudo = (
    <>
      {acento && (
        <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-500 to-brand-300" />
      )}
      <p className="eyebrow">{rotulo}</p>
      <p className="mt-1.5 font-display text-[25px] font-semibold leading-none tracking-tight text-tinta-900 num">
        {valor}
      </p>
      {detalhe && (
        <p className="mt-1.5 text-xs leading-snug text-tinta-400">{detalhe}</p>
      )}
      {alerta && (
        <p className="mt-1 text-xs font-semibold text-rose-600">{alerta}</p>
      )}
      {onClick && (
        <span
          className={`mt-3 flex items-center gap-1 text-xs font-semibold transition ${
            aberto ? 'text-brand-700' : 'text-tinta-400'
          }`}
        >
          {aberto ? 'Fechar' : 'Ver detalhe'}
          <span className={`transition-transform ${aberto ? 'rotate-90' : ''}`}>
            ▸
          </span>
        </span>
      )}
    </>
  );

  const estilo = `card relative overflow-hidden p-4 ${
    acento ? 'ring-1 ring-brand-200' : ''
  } ${aberto ? 'ring-2 ring-brand-400' : ''}`;

  if (!onClick) {
    return <div className={`${estilo} card-hover`}>{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={aberto}
      className={`${estilo} card-hover w-full cursor-pointer text-left`}
    >
      {conteudo}
    </button>
  );
}

/**
 * As cores de estado não vêm da escala `tinta`, então não viram do avesso
 * sozinhas: no tema escuro um `bg-emerald-50` seria uma etiqueta quase branca
 * acesa no meio da tabela. A versão escura troca o fundo sólido por um véu da
 * própria cor e clareia o texto — a etiqueta continua verde, só que legível.
 */
const TONS = {
  neutro: 'bg-tinta-100 text-tinta-600',
  marca: 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300',
  pago: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  atencao: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  erro: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
} as const;

export type Tom = keyof typeof TONS;

export function Selo({
  tom = 'neutro',
  ponto = false,
  titulo,
  pequeno = false,
  children,
}: {
  tom?: Tom;
  /** Bolinha antes do texto, para status que mudam sozinhos. */
  ponto?: boolean;
  titulo?: string;
  pequeno?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      title={titulo}
      className={`${pequeno ? 'selo-p' : 'selo'} ${TONS[tom]}`}
    >
      {ponto && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {children}
    </span>
  );
}

export function Aviso({
  tom = 'info',
  children,
  acao,
}: {
  tom?: Tom;
  children: ReactNode;
  acao?: ReactNode;
}) {
  const cores: Record<Tom, string> = {
    neutro: 'border-tinta-200 bg-papel text-tinta-600',
    marca:
      'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200',
    pago: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
    atencao:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
    erro: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200',
  };
  return (
    <div
      className={`surgir mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${cores[tom]}`}
    >
      <span>{children}</span>
      {acao}
    </div>
  );
}

/** Tela vazia é convite para agir, não beco sem saída. */
export function Vazio({
  titulo,
  children,
}: {
  titulo: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-display text-sm font-semibold text-tinta-500">
        {titulo}
      </p>
      {children && (
        <p className="mx-auto mt-1.5 max-w-md text-sm text-tinta-400">
          {children}
        </p>
      )}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-tinta-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-tinta-200 border-t-brand-500" />
      {texto}
    </div>
  );
}
