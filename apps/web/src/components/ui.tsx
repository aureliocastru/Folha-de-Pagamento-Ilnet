import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useCelular } from '../lib/celular';
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
  placeholder,
  id,
  casas = 2,
}: {
  /** Valor canônico: "2107.03" ou "" quando vazio. */
  valor: string;
  onChange: (valor: string) => void;
  className?: string;
  placeholder?: string;
  /** Para o `htmlFor` do rótulo: sem ele, clicar no rótulo não faz nada. */
  id?: string;
  /**
   * Quantas casas decimais a máscara monta. Duas por padrão — é o dinheiro que
   * sai do caixa, e é o que o resto da casa usa.
   *
   * Quatro serve ao preço unitário das cotações: drop se compra a R$ 0,4750 o
   * metro, e arredondar para R$ 0,48 erra R$ 25,00 num rolo de dez mil metros.
   */
  casas?: number;
}) {
  const fator = 10 ** casas;
  /** O que está escrito, guardado como os dígitos que o compõem. */
  const [digitos, setDigitos] = useState(() => digitosDoValor(valor, casas));
  const emitido = useRef(valor);
  const campo = useRef<HTMLInputElement>(null);

  // Valor que não saiu daqui veio de fora (recarregou o cadastro, recalculou a
  // folha): aí sim reescreve o campo.
  useEffect(() => {
    if (valor === emitido.current) return;
    emitido.current = valor;
    setDigitos(digitosDoValor(valor, casas));
  }, [valor, casas]);

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

    // Canônico com as casas pedidas, que é o que a API espera. Vazio continua
    // vazio: campo em branco não é zero, é "não preenchido".
    const canonico = novos ? (Number(novos) / fator).toFixed(casas) : '';
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
      value={digitos ? formatNumeroBR(Number(digitos) / fator, casas) : ''}
      placeholder={placeholder ?? (0).toFixed(casas).replace('.', ',')}
      className={className}
      onChange={(e) => aoDigitar(e.target.value)}
      onFocus={(e) =>
        e.target.setSelectionRange(e.target.value.length, e.target.value.length)
      }
      autoComplete="off"
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
function digitosDoValor(valor: string, casas = 2): string {
  const n = Number(valor);
  if (!valor || !Number.isFinite(n)) return '';
  // Arredondar antes é obrigatório: 2107.03 * 100 dá 210702.99999… em ponto
  // flutuante, e truncar isso comeria um centavo.
  return somenteDigitosSignificativos(
    String(Math.round(Math.abs(n) * 10 ** casas)),
  );
}

export function Pagina({ children }: { children: ReactNode }) {
  return (
    /*
     * Não há mais `pt-20`.
     *
     * Ele existia por um motivo só: no celular o menu era um botão flutuante
     * pousado sobre o canto superior esquerdo do conteúdo, e cada página tinha
     * de reservar cinco centímetros vazios no alto para não ser coberta por
     * ele. Isso valia em **toda** tela do sistema, inclusive nas que já cabiam
     * mal numa tela de bolso. A casca do celular agora tem cabeçalho próprio e
     * a navegação mora numa gaveta que a logo abre (ver o `LayoutCelular`),
     * então esse alto voltou a ser do conteúdo.
     *
     * A folga lateral também encolheu: `px-4` numa tela de 360px eram 32px de
     * margem, quase um décimo da largura, gastos em nada.
     */
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-8 pt-4 sm:px-6 md:pt-6 lg:px-7">
      {children}
    </div>
  );
}

export function CabecalhoPagina({
  secao,
  titulo,
  voltar,
  acoes,
}: {
  /** Onde a pessoa está — a mesma palavra da barra lateral. */
  secao: string;
  titulo: string;
  /**
   * O que a seta de voltar faz — e ela só aparece quando isto é dito.
   *
   * Era automática em toda tela, voltando no histórico. Deixou de ser em
   * 22/09/2026: com o menu do módulo a um toque (a gaveta da logo no celular,
   * a barra lateral no computador), a seta repetia o que o menu já faz e
   * gastava uma quina do cabeçalho em todas as telas.
   *
   * Continua onde ela **sobe um nível dentro da própria tela**: o mês de notas
   * fiscais que volta para a lista de meses, a pasta que volta para a estante,
   * o almoxarifado aberto que volta para todos. Isso o menu não faz.
   *
   * Ela mora encostada no título, e não numa linha própria acima dele: solta
   * lá em cima ela vira um link de rodapé no lugar errado — do tamanho de uma
   * legenda, longe do que nomeia a tela, e ninguém a vê.
   */
  voltar?: () => void;
  acoes?: ReactNode;
}) {
  return (
    <header className="surgir mb-4 flex flex-wrap items-end justify-between gap-3 md:mb-5">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
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
          {/*
            Sem a linha de explicação embaixo do título (pedido do dono,
            22/09/2026). Ela dizia para que serve a tela — coisa que se lê uma
            vez e depois ocupa três linhas de um celular todo santo dia. O que
            é dado, e não explicação, fica no corpo da página: o CNPJ da
            empresa nas Contas Contrato, por exemplo.
          */}
          <p className="eyebrow mb-1">{secao}</p>
          <h1 className="titulo-pagina">{titulo}</h1>
        </div>
      </div>
      {/*
        No celular as ações ocupam a linha inteira, e não a sobra à direita do
        título. Elas costumam ser dois ou três botões de 44px — espremidos
        numa quina eles empurravam um ao outro para fora da tela, e o último
        ficava debaixo do primeiro. Numa linha só, todos são alcançáveis.
      */}
      {acoes && (
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {acoes}
        </div>
      )}
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
        <div className="faixa-titulo flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 md:flex-nowrap md:gap-3 md:px-5 md:py-3">
          {/* Quebra linha no celular: título comprido e dois botões ao lado
              empurravam o último para fora do cartão. */}
          <h2 className="titulo-bloco min-w-0">{titulo}</h2>
          {acao}
        </div>
      )}
      <div
        className={`${esticado ? 'flex min-h-0 flex-1 flex-col' : ''} ${
          // O topo já não vem de graça: a faixa do título agora tem borda
          // própria, e sem esta folga o conteúdo encostaria nela.
          //
          // No celular a folga cai para 14px: o cartão já vai de borda a borda
          // da tela, e cada ponto de recheio sai da largura do que se lê
          // dentro dele.
          semPadding ? '' : 'px-3.5 pb-3.5 pt-3.5 md:px-5 md:pb-5 md:pt-5'
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Onde está, agora, o pedaço da tela que se vê — e se o teclado está aberto.
 *
 * `100vh` não encolhe quando o teclado sobe, e no iPhone `position: fixed`
 * continua medindo a tela inteira **e** a página ainda escorrega para cima:
 * encurtar a janela pelo pé (`bottom`) não bastou — o campo continuava atrás
 * das teclas. O que funciona é prender a janela ao retângulo visível, dito
 * pela `visualViewport`: topo, esquerda, largura e altura, atualizados a cada
 * mexida dela.
 *
 * Abaixo de 120px de diferença não é teclado: é a barra do navegador que
 * aparece e some ao rolar, e mexer na janela a cada uma dessas seria um tremor
 * sem motivo.
 */
interface PedacoVisivel {
  top: number;
  left: number;
  width: number;
  height: number;
  /** O teclado está cobrindo a tela. */
  teclado: boolean;
}

function usePedacoVisivel(): PedacoVisivel | null {
  const [pedaco, setPedaco] = useState<PedacoVisivel | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => {
      const coberto = window.innerHeight - vv.height - vv.offsetTop;
      setPedaco({
        top: Math.round(vv.offsetTop),
        left: Math.round(vv.offsetLeft),
        width: Math.round(vv.width),
        height: Math.round(vv.height),
        teclado: coberto > 120,
      });
    };
    medir();
    vv.addEventListener('resize', medir);
    vv.addEventListener('scroll', medir);
    return () => {
      vv.removeEventListener('resize', medir);
      vv.removeEventListener('scroll', medir);
    };
  }, []);

  return pedaco;
}

/**
 * O campo que acabou de receber o foco vai para o meio da janela.
 *
 * Mesmo com a janela no lugar certo, o campo pode estar no fim de um
 * formulário que rola por dentro — e o teclado sobe justamente por cima dele.
 * O atraso é o da animação do teclado: medir antes dela é medir a tela de
 * antes.
 */
function useCampoNoMeio(area: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (!alvo || !el.contains(alvo)) return;
      setTimeout(() => alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
    };
    el.addEventListener('focusin', aoFocar);
    return () => el.removeEventListener('focusin', aoFocar);
  }, [area]);
}

/**
 * Janela por cima da tela, para o que precisa de resposta agora — pagar alguém,
 * por exemplo. Um bloco no rodapé da página resolveria o mesmo, mas nasce fora
 * da área visível: quem clica em "Pagar" no meio de uma tabela longa não vê
 * nada acontecer e conclui que o botão está quebrado.
 *
 * **Como toda janela desta casa se fecha** (padrão de 22/09/2026, para as
 * telas pararem de se comportar cada uma de um jeito):
 *
 * - o **X** sai na hora — é o gesto de quem quer sair;
 * - o **Esc** sai também, mas pergunta antes quando já se digitou alguma coisa
 *   ali dentro;
 * - **tocar no fundo não fecha.** Chegou a fechar por um dia; no celular a
 *   folha ocupa meia tela e o dedo encosta fora dela o tempo todo — "se não
 *   vai clicar toda hora fora sem querer" (pedido do dono).
 *
 * Quem sabe se houve trabalho é a própria janela: qualquer digitação ou
 * escolha lá dentro sobe por aqui (os eventos do React borbulham) e levanta a
 * bandeira. Janela de olhar — um detalhe, uma foto — nunca pergunta nada.
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
  const celular = useCelular();
  const visivel = usePedacoVisivel();
  const teclado = visivel?.teclado ?? false;
  /** A área que rola dentro da folha: é nela que o campo em foco se centraliza. */
  const miolo = useRef<HTMLDivElement>(null);
  useCampoNoMeio(miolo);
  /** Alguém mexeu em algum campo daqui de dentro? */
  const mexido = useRef(false);

  /** A saída dos gestos soltos: pergunta quando há o que perder. */
  const fecharComCuidado = useCallback(() => {
    if (
      mexido.current &&
      !window.confirm('Você preencheu alguma coisa nesta janela. Fechar assim mesmo?')
    ) {
      return;
    }
    onFechar();
  }, [onFechar]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharComCuidado();
    };
    window.addEventListener('keydown', aoTeclar);
    // Rolar a página atrás da janela tira do lugar o que se está lendo nela.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [fecharComCuidado]);

  const marcarMexido = () => {
    mexido.current = true;
  };


  /*
   * No celular ela não é janela: é uma folha que sobe do pé da tela.
   *
   * A janela centralizada não cabe aqui, e por uma razão que só aparece com o
   * teclado aberto: ela nascia no meio da tela, o teclado subia e tomava
   * metade dela, e o campo que se estava preenchendo ficava atrás do teclado —
   * com o título e o botão de fechar empurrados para fora por cima. Presa no
   * rodapé, ela cresce para cima: o campo em foco fica logo acima do teclado,
   * que é onde ele precisa estar.
   *
   * O cabeçalho fica grudado no alto e só o miolo rola, então "Fechar" está
   * sempre à mão — num formulário de despesa com doze campos, a saída não pode
   * depender de rolar até o começo.
   */
  /*
   * Pendurada no `body`, e não onde foi escrita.
   *
   * `position: fixed` mede a partir da tela — menos quando algum ancestral tem
   * `transform`, e os cartões desta casa entram com a animação `surgir`, que
   * deixa lá uma matriz. Escrita no lugar, a janela passava a medir pelo
   * cartão: no iPhone, com o teclado aberto, era o bastante para ela ir parar
   * atrás das teclas. É o mesmo cuidado da `FotoAmpliada`.
   */
  if (celular) {
    return createPortal(
      <div
        /*
          Com o teclado aberto, a janela é o retângulo que se vê — nem um pixel
          a mais. No iPhone não basta encurtá-la pelo pé: a página escorrega
          para cima e a janela fixa vai junto, levando o campo para trás das
          teclas. Presa ao `visualViewport`, ela fica onde os olhos estão, e o
          que sobra dela é centrado — folha encostada nas teclas põe o campo
          na beirada, que é onde o dedo já está digitando.
        */
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
        className={`fixed inset-0 z-50 flex flex-col bg-barra/70 backdrop-blur-sm ${
          teclado ? 'justify-center px-3' : 'justify-end'
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          onInput={marcarMexido}
          onChange={marcarMexido}
          className={`surgir flex flex-col border-tinta-100 bg-papel shadow-2xl ${
            teclado ? 'max-h-full rounded-2xl border' : 'max-h-[92vh] rounded-t-2xl border-t'
          }`}
        >
          <div className="faixa-titulo flex shrink-0 items-center justify-between gap-3 rounded-t-2xl py-2 pl-4 pr-2">
            <h2 className="titulo-bloco min-w-0 truncate">{titulo}</h2>
            <BotaoFechar onFechar={onFechar} />
          </div>
          {/* A folga de baixo respeita a faixa do gesto do sistema: sem ela o
              último botão do formulário fica debaixo da barrinha do iPhone. */}
          {/* `overflow-x-clip`: a janela não anda para o lado, como a página
              (ver o `overflow-x: clip` do body). O que é largo de verdade — uma
              tabela — rola dentro da própria moldura. */}
          <div
            ref={miolo}
            className="rolagem-fina min-h-0 flex-1 overflow-y-auto overflow-x-clip px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {children}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="rolagem-fina fixed inset-0 z-50 flex justify-center overflow-y-auto overflow-x-clip bg-barra/70 p-4 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onInput={marcarMexido}
        onChange={marcarMexido}
        className="surgir my-auto h-fit w-full max-w-5xl rounded-2xl border border-tinta-100 bg-papel shadow-2xl"
      >
        <div className="faixa-titulo flex items-center justify-between gap-3 py-2.5 pl-5 pr-3 sm:pl-6">
          <h2 className="titulo-bloco">{titulo}</h2>
          <BotaoFechar onFechar={onFechar} />
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * O X da janela.
 *
 * Era um "×" de texto num quadrado de 36px sem fundo: no celular ele se lia
 * como enfeite, e não como botão, e o dedo errava a quina. Agora é um botão
 * de 44px com fundo e borda — o mínimo que um dedo acerta —, com o X desenhado
 * no meio, e continua sendo a única saída além do Esc.
 */
function BotaoFechar({ onFechar }: { onFechar: () => void }) {
  return (
    <button
      type="button"
      onClick={onFechar}
      aria-label="Fechar"
      title="Fechar"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-tinta-200 bg-papel text-tinta-600 transition hover:border-tinta-300 hover:bg-tinta-100 hover:text-tinta-900 active:bg-tinta-100 md:h-10 md:w-10"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
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
 * Aqui a imagem não vai a lugar nenhum: ela cresce dentro da página. A roda do
 * mouse aproxima e afasta no ponto onde está o ponteiro — que é como se lê um
 * valor escrito torto no canto do papel —, e com a foto ampliada arrastar com
 * o mouse a move. Clicar alterna entre caber na tela e o tamanho de verdade:
 * foto de celular tem mais pixels que o monitor, e é dessa sobra que sai a
 * letra miúda.
 *
 * No celular é a **pinça** que aproxima, entre os dois dedos, como em qualquer
 * foto do aparelho; um dedo só arrasta a foto ampliada. O zoom da página está
 * desligado neste app (ver o `viewport`), então a pinça do navegador não faria
 * nada aqui — quem a atende é esta tela.
 */

/** Oito vezes o que cabe na tela: passa disso e a nota vira borrão de pixel. */
const ZOOM_MAXIMO = 8;

const limitarZoom = (n: number) => Math.min(ZOOM_MAXIMO, Math.max(1, n));

export function FotoAmpliada({
  src,
  titulo,
  acao,
  onFechar,
  onAnterior,
  onProxima,
}: {
  src: string;
  titulo: string;
  /**
   * O que se faz com esta foto à vista — na conferência, o valor da nota e o
   * botão de salvar. Fica num rodapé, embaixo da imagem: quem está lendo um
   * número torto no papel não pode ter de fechar a foto para digitá-lo.
   */
  acao?: ReactNode;
  onFechar: () => void;
  /**
   * As vizinhas, quando a saída tem mais de uma nota. Ausente é ponta da
   * sequência: a seta some, e o "Nota 3 de 3" no alto diz por quê.
   */
  onAnterior?: () => void;
  onProxima?: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  const imagem = useRef<HTMLImageElement>(null);
  const [escala, setEscala] = useState(1);

  /**
   * De onde o zoom cresce: o ponto da tela que tem de continuar onde está.
   *
   * Guardado no gesto e usado depois que o React já pintou o novo tamanho —
   * é aí, e só aí, que a rolagem pode ser acertada.
   */
  const ancora = useRef<{
    x: number;
    y: number;
    de: number;
    sl: number;
    st: number;
  } | null>(null);

  /** Aproxima ou afasta, deixando quieto o ponto (x, y) da caixa. */
  const aproximar = (fator: number, ponto?: { x: number; y: number }) => {
    const el = caixa.current;
    if (!el) return;
    setEscala((atual) => {
      const nova = limitarZoom(atual * fator);
      if (nova === atual) return atual;
      ancora.current = {
        x: ponto?.x ?? el.clientWidth / 2,
        y: ponto?.y ?? el.clientHeight / 2,
        de: atual,
        sl: el.scrollLeft,
        st: el.scrollTop,
      };
      return nova;
    });
  };

  /*
   * Cada nota começa cabendo na tela.
   *
   * Quem está passando pelas fotos de uma saída quer ver o papel inteiro
   * primeiro; herdar o zoom da anterior abriria a próxima num pedaço do
   * meio, e a mesma foto pareceria outra coisa.
   */
  useEffect(() => {
    setEscala(1);
    setPuxada(0);
  }, [src]);

  /*
   * A roda do mouse aproxima, em vez de rolar.
   *
   * O ouvinte é pendurado à mão porque o React registra a roda como passiva,
   * e ouvinte passivo não pode chamar `preventDefault` — sem ele o navegador
   * rolaria a foto ao mesmo tempo em que ela cresce, e a nota fugiria da tela.
   */
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // O Firefox manda a roda em linhas; o resto, em pixels.
      const passo = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      aproximar(Math.exp(-passo * 0.0022), {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    };
    el.addEventListener('wheel', aoRolar, { passive: false });
    return () => el.removeEventListener('wheel', aoRolar);
  }, []);

  /* Crescida a foto, a rolagem vai para onde o ponto de origem ficou. */
  useLayoutEffect(() => {
    const el = caixa.current;
    const a = ancora.current;
    if (!el || !a) return;
    ancora.current = null;
    const k = escala / a.de;
    el.scrollLeft = (a.sl + a.x) * k - a.x;
    el.scrollTop = (a.st + a.y) * k - a.y;
  }, [escala]);

  /** O tamanho em que um pixel da foto é um pixel da tela. */
  const tamanhoReal = () => {
    const el = caixa.current;
    const im = imagem.current;
    if (!el || !im?.naturalWidth) return 2.5;
    const cabe = Math.min(
      el.clientWidth / im.naturalWidth,
      el.clientHeight / im.naturalHeight,
    );
    return cabe > 0 ? limitarZoom(1 / cabe) : 2.5;
  };

  const alternar = () => {
    if (escala > 1) {
      setEscala(1);
      return;
    }
    aproximar(tamanhoReal());
  };

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
      // Quem não tem roda — o notebook sem mouse — aproxima pelo teclado.
      if (e.key === '+' || e.key === '=') aproximar(1.4);
      if (e.key === '-' || e.key === '_') aproximar(1 / 1.4);
      if (e.key === '0') setEscala(1);
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
   * Com a foto ampliada, arrastar a move — e o clique que a arrastou não
   * alterna o zoom, senão todo empurrão terminaria com a nota de volta ao
   * tamanho de selo.
   */
  const arrasto = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const arrastou = useRef(false);

  /*
   * Os dedos que estão na tela agora, para a pinça saber o quanto eles se
   * afastaram. `dedos` guarda onde cada um está; `pinca`, a distância entre
   * os dois na última medida — é a razão entre as duas que vira o zoom.
   */
  const dedos = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<number | null>(null);

  /*
   * Arrastar a foto para fora fecha — o gesto do celular.
   *
   * Só com a foto inteira na tela (`escala === 1`): ampliada, arrastar é o
   * jeito de andar por ela. `puxada` é o quanto o dedo já levou, e a foto vai
   * junto: um gesto que não mostra o que está fazendo parece travamento.
   * Soltando antes do limite, ela volta para o lugar.
   */
  const puxar = useRef<{ x: number; y: number } | null>(null);
  const [puxada, setPuxada] = useState(0);
  const LIMITE_DA_PUXADA = 90;

  const distanciaEntreOsDedos = () => {
    const [a, b] = [...dedos.current.values()];
    if (!a || !b) return null;
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const aoPegar = (e: PointerEvent<HTMLDivElement>) => {
    const el = caixa.current;
    if (!el) return;
    dedos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // O segundo dedo vira pinça: o arrasto para, para os dois gestos não
    // disputarem a mesma foto.
    if (dedos.current.size === 2) {
      arrasto.current = null;
      arrastou.current = true;
      pinca.current = distanciaEntreOsDedos()?.d ?? null;
      return;
    }
    if (escala === 1) {
      puxar.current = { x: e.clientX, y: e.clientY };
      return;
    }
    arrasto.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    arrastou.current = false;
  };

  const aoMover = (e: PointerEvent<HTMLDivElement>) => {
    const el = caixa.current;
    if (!el) return;
    if (dedos.current.has(e.pointerId)) {
      dedos.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (dedos.current.size >= 2) {
      const agora = distanciaEntreOsDedos();
      if (!agora || !pinca.current || agora.d <= 0) return;
      const r = el.getBoundingClientRect();
      aproximar(agora.d / pinca.current, { x: agora.x - r.left, y: agora.y - r.top });
      pinca.current = agora.d;
      return;
    }

    const p = puxar.current;
    if (p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      // Só o gesto que é mais vertical que horizontal: de lado é passar de
      // uma nota para a outra, e não sair.
      if (Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > 4) arrastou.current = true;
        setPuxada(dy);
      }
      return;
    }

    const a = arrasto.current;
    if (!a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) arrastou.current = true;
    el.scrollLeft = a.sl - dx;
    el.scrollTop = a.st - dy;
  };

  const aoSoltar = (e: PointerEvent<HTMLDivElement>) => {
    dedos.current.delete(e.pointerId);
    if (dedos.current.size < 2) pinca.current = null;
    arrasto.current = null;

    if (puxar.current) {
      puxar.current = null;
      if (Math.abs(puxada) > LIMITE_DA_PUXADA) {
        onFechar();
        return;
      }
      setPuxada(0);
    }
  };

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
      {/*
        No celular o título fica na sua própria linha: espremido ao lado dos
        botões ele virava "N…", e o "Fechar" ia para fora da tela — a saída da
        foto sumia justo no aparelho em que ela mais se abre.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 sm:gap-3">
        <span className="w-full min-w-0 truncate text-sm font-semibold text-white sm:w-auto sm:flex-1">
          {titulo}
        </span>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {/* No celular e no tablet não há roda: o zoom é por estes dois. */}
          <span className="flex items-center overflow-hidden rounded-xl border border-white/20 md:rounded-lg">
            <button
              type="button"
              onClick={() => aproximar(1 / 1.4)}
              disabled={escala <= 1}
              aria-label="Afastar"
              title="Afastar"
              className="min-h-[44px] px-3.5 text-lg font-semibold leading-none text-white/80 transition hover:bg-white/10 disabled:opacity-30 md:min-h-[36px] md:text-base"
            >
              −
            </button>
            <span className="num min-w-[3.5rem] border-x border-white/20 px-1 text-center text-xs text-white/70">
              {Math.round(escala * 100)}%
            </span>
            <button
              type="button"
              onClick={() => aproximar(1.4)}
              disabled={escala >= ZOOM_MAXIMO}
              aria-label="Aproximar"
              title="Aproximar — a roda do mouse, ou a pinça de dois dedos, fazem o mesmo"
              className="min-h-[44px] px-3.5 text-lg font-semibold leading-none text-white/80 transition hover:bg-white/10 disabled:opacity-30 md:min-h-[36px] md:text-base"
            >
              +
            </button>
          </span>
          <button
            type="button"
            onClick={alternar}
            className="min-h-[44px] rounded-xl border border-white/20 px-3.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 md:min-h-[36px] md:rounded-lg md:text-xs"
          >
            {escala > 1 ? 'Caber na tela' : 'Tamanho real'}
          </button>
          <button
            type="button"
            onClick={onFechar}
            className="min-h-[44px] rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 md:min-h-[36px] md:rounded-lg md:text-xs"
          >
            Fechar
          </button>
        </div>
      </div>

      {/*
        Clicar no fundo fecha — ao contrário da `Janela`, aqui não há trabalho
        a perder: é uma foto sendo olhada, e quem abriu para ler sai pelo
        mesmo gesto com que entrou. Com a foto ampliada, não: ali o fundo é
        por onde ela se arrasta.
      */}
      <div
        ref={caixa}
        onClick={(e) => {
          if (e.target === e.currentTarget && escala === 1) onFechar();
        }}
        onPointerDown={aoPegar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onPointerLeave={aoSoltar}
        /*
          `touch-none`: sem isto o navegador trata o gesto como rolagem — a
          foto andaria duas vezes (a dele e a nossa), e a pinça viraria um
          arrasto. Quem move a foto ampliada é o arrasto daqui.
        */
        className={`flex-1 touch-none rounded-2xl bg-black/40 p-2 ${
          escala > 1 ? 'overflow-auto rolagem-fina' : 'overflow-hidden'
        }`}
      >
        {/*
          A moldura é o tamanho da caixa vezes o zoom, e a foto cabe dentro
          dela: assim um número só comanda o tamanho, e quem rola é a caixa —
          sem `transform`, que borraria a letra a lápis.
        */}
        <div
          style={{
            width: `${escala * 100}%`,
            height: `${escala * 100}%`,
            transform: puxada ? `translateY(${puxada}px)` : undefined,
            // Some aos poucos enquanto sai: diz que o gesto está fechando, e
            // não arrastando a foto para um canto.
            opacity: puxada ? Math.max(0.35, 1 - Math.abs(puxada) / 420) : undefined,
            transition: puxada ? 'none' : 'transform .18s, opacity .18s',
          }}
          className="flex items-center justify-center"
        >
          <img
            ref={imagem}
            src={src}
            alt={titulo}
            draggable={false}
            onClick={() => {
              if (arrastou.current) return;
              alternar();
            }}
            className={`max-h-full max-w-full select-none rounded-lg object-contain ${
              escala > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'
            }`}
          />
        </div>
      </div>

      {acao && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
          {acao}
        </div>
      )}

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
      {/* No celular estes cartões vão dois por linha, e o número desce de 25px
          para 20px: em 25px "R$ 128.450,00" partia no meio numa coluna de
          170px, e um valor quebrado em duas linhas não se confere de relance —
          que é a única coisa que um indicador serve para fazer. */}
      <p className="eyebrow">{rotulo}</p>
      <p className="num mt-1.5 font-display text-[20px] font-semibold leading-none tracking-tight text-tinta-900 md:text-[25px]">
        {valor}
      </p>
      {detalhe && (
        <p className="mt-1.5 text-[11px] leading-snug text-tinta-400 md:text-xs">
          {detalhe}
        </p>
      )}
      {alerta && (
        <p className="mt-1 text-[11px] font-semibold text-rose-600 md:text-xs">
          {alerta}
        </p>
      )}
      {onClick && (
        <span
          className={`mt-2.5 flex items-center gap-1 text-[11px] font-semibold transition md:mt-3 md:text-xs ${
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

  const estilo = `card relative overflow-hidden p-3 md:p-4 ${
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

/**
 * O ponto âmbar do menu: ali dentro tem coisa esperando alguém.
 *
 * Âmbar, e não vermelho: é fila de trabalho parada, não erro. O número vai no
 * `title` e no texto para o leitor de tela — o ponto sozinho diz "tem algo", e
 * quantos é o que a tela mostra quando se abre.
 */
export function PontoDeAviso({
  quantos,
  oQue,
  className = '',
}: {
  quantos: number;
  /** "abastecimento esperando conferência" — o que a fila é, no singular. */
  oQue: string;
  className?: string;
}) {
  if (quantos <= 0) return null;
  const texto = `${quantos} ${oQue}${quantos > 1 ? 's' : ''}`;
  return (
    <span
      title={texto}
      className={`inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-400 ring-2 ring-amber-400/30 ${className}`}
    >
      <span className="sr-only">{texto}</span>
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
      data-aviso
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
    <div className="px-5 py-10 text-center md:px-6 md:py-14">
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
    <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-tinta-400 md:px-6 md:py-14">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-tinta-200 border-t-brand-500" />
      {texto}
    </div>
  );
}
