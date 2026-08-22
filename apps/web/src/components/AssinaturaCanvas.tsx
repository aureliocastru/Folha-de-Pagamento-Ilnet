import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * O quadro onde a pessoa assina.
 *
 * Três coisas mandam no desenho aqui: ele é feito com o dedo, num celular, e o
 * que sair vai virar a assinatura de um recibo de quitação. Por isso o traço é
 * grosso e arredondado (dedo não tem a precisão de caneta), a tela acompanha a
 * densidade do aparelho (senão o traço sai serrilhado no retina) e o toque não
 * rola a página junto — `touch-action: none` é o que impede a assinatura de
 * virar um arrastão de scroll no meio da letra.
 *
 * O quadro cresce com a tela porque é assim que se assina: espalhando a mão. É
 * de propósito que ele fique enorme com o celular deitado — deitar o aparelho é
 * o jeito de ter largura, e largura é o que falta para caber um nome inteiro.
 */

export interface AssinaturaCanvasRef {
  /** PNG em data URL, ou null se o quadro está em branco. */
  exportar: () => string | null;
  limpar: () => void;
  /** Escreve o nome no quadro, para quem não assina de próprio punho. */
  gerarDoNome: (nome: string) => void;
}

interface Props {
  controle: RefObject<AssinaturaCanvasRef>;
  /** Avisa a tela quando deixa de estar em branco (para soltar o botão). */
  onMudou?: (temTraco: boolean) => void;
  disabled?: boolean;
}

/**
 * A altura do quadro, tirada da altura da janela.
 *
 * Deitado, o celular tem pouca altura e muita largura: o quadro fica baixo e
 * largo, que é a forma de uma linha de assinatura. Em pé ele cresce, porque
 * sobra tela. Os limites existem para o quadro nunca engolir a tela inteira nem
 * virar uma tarja fina onde não cabe uma letra.
 */
function alturaParaTela(): number {
  const janela = typeof window === 'undefined' ? 800 : window.innerHeight;
  return Math.round(Math.min(380, Math.max(260, janela * 0.5)));
}

/** Como o traço fica: grosso o bastante para o dedo, fino para parecer caneta. */
function prepararContexto(ctx: CanvasRenderingContext2D, escala: number): void {
  ctx.scale(escala, escala);
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0f172a';
}

export function AssinaturaCanvas({ controle, onMudou, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);
  const [altura, setAltura] = useState(alturaParaTela);

  // Guardado numa referência, e não só no estado: `mover` dispara a cada
  // pixel do traço, e sem isto o primeiro rabisco viraria centenas de avisos
  // iguais para a tela de cima.
  const jaTemTraco = useRef(false);
  const marcarTraco = useCallback(() => {
    if (jaTemTraco.current) return;
    jaTemTraco.current = true;
    setTemTraco(true);
    onMudou?.(true);
  }, [onMudou]);

  /**
   * Acerta o quadro ao tamanho que ele tem na tela, sem perder o desenho.
   *
   * Mudar o tamanho de um canvas apaga o conteúdo, e o momento em que isso
   * acontece é justamente o pior possível: a pessoa girou o aparelho para
   * assinar mais à vontade. Então o desenho é fotografado antes e recolocado
   * depois, esticado para o tamanho novo.
   *
   * Sai fora quando o tamanho já está certo. Isso não é economia: é o que
   * impede o laço, já que ajustar a altura muda o elemento, e mudar o elemento
   * chama isto de novo.
   */
  const ajustar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const escala = window.devicePixelRatio || 1;
    const largura = Math.round(canvas.clientWidth * escala);
    const alturaReal = Math.round(canvas.clientHeight * escala);
    if (canvas.width === largura && canvas.height === alturaReal) return;

    const anterior = jaTemTraco.current ? canvas.toDataURL('image/png') : null;
    canvas.width = largura;
    canvas.height = alturaReal;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    prepararContexto(ctx, escala);

    if (anterior) {
      const img = new Image();
      img.onload = () =>
        ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
      img.src = anterior;
    }
  }, []);

  /**
   * O acerto de saída, antes de a tela pintar. É de propósito que ele não
   * dependa de aviso nenhum do navegador: sem isto, um quadro que nunca
   * recebesse o aviso ficaria no tamanho padrão do canvas (300×150) e a
   * assinatura sairia amassada — falha silenciosa e num lugar caro.
   */
  useLayoutEffect(() => {
    ajustar();
  }, [ajustar, altura]);

  /**
   * E os avisos de mudança, os três que existem, porque nenhum deles sozinho
   * cobre tudo: `resize` não chega quando é só o layout que muda de tamanho;
   * `orientationchange` às vezes chega antes de a janela ter as medidas novas;
   * e o observador, que é o mais completo, não existe em navegador antigo.
   * Todos chamam a mesma função, que não faz nada quando não há o que fazer.
   */
  useEffect(() => {
    function aoMudar() {
      setAltura(alturaParaTela());
      ajustar();
    }

    window.addEventListener('resize', aoMudar);
    window.addEventListener('orientationchange', aoMudar);

    const canvas = canvasRef.current;
    const observador =
      typeof ResizeObserver === 'undefined' || !canvas
        ? null
        : new ResizeObserver(aoMudar);
    observador?.observe(canvas!);

    return () => {
      window.removeEventListener('resize', aoMudar);
      window.removeEventListener('orientationchange', aoMudar);
      observador?.disconnect();
    };
  }, [ajustar]);

  useImperativeHandle(controle, () => ({
    exportar: () =>
      temTraco ? (canvasRef.current?.toDataURL('image/png') ?? null) : null,

    limpar: () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      // O clear vai em pixels reais; o resto do desenho trabalha em CSS px.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      jaTemTraco.current = false;
      setTemTraco(false);
      onMudou?.(false);
    },

    gerarDoNome: (nome: string) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const largura = canvas.clientWidth;
      const alturaCss = canvas.clientHeight;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // A fonte de mão vem do próprio aparelho: a página não pode buscar fonte
      // de fora. Qual delas atende varia por celular, e tudo bem — esta
      // assinatura não imita punho nenhum, ela só escreve o nome de forma
      // legível, e o recibo diz que ela foi gerada.
      const limite = largura * 0.86;
      let tamanho = Math.min(alturaCss * 0.42, 76);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';

      // Nome comprido encolhe até caber: cortar o nome de alguém no recibo
      // dele não é opção.
      for (; tamanho > 14; tamanho -= 2) {
        ctx.font = `italic ${tamanho}px "Segoe Script", "Bradley Hand", "Brush Script MT", cursive`;
        if (ctx.measureText(nome).width <= limite) break;
      }
      ctx.fillText(nome, largura / 2, alturaCss / 2, limite);
      marcarTraco();
    },
  }));

  function posicao(e: ReactPointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function comecar(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Segurar o ponteiro faz o traço continuar mesmo se o dedo escapar da
    // borda do quadro no meio da letra.
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    desenhando.current = true;
  }

  function mover(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = posicao(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    marcarTraco();
  }

  function terminar() {
    if (!desenhando.current) return;
    desenhando.current = false;
    // Um toque seco (ponto, sem arrastar) também conta como traço: é assim que
    // se pinga o pingo do "i".
    marcarTraco();
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        onPointerCancel={terminar}
        /*
         * Branco nos dois temas, e não `bg-papel`.
         *
         * O traço é tinta escura porque é isso que vai impresso no recibo e na
         * APR — papel é branco. Seguindo o tema, o quadro escurecia junto e a
         * assinatura virava tinta escura sobre fundo escuro: quem assinava não
         * via a própria letra, e o "Limpar" era clicado no escuro.
         */
        style={{ height: altura, touchAction: 'none', background: '#ffffff' }}
        className={`w-full rounded-2xl border-2 border-dashed ${
          disabled
            ? 'cursor-not-allowed border-tinta-100'
            : 'cursor-crosshair border-tinta-200'
        }`}
      />

      {/* A linha de assinatura fica sob o dedo, como a de um papel. Não
          intercepta o toque — quem manda no ponteiro é o canvas. */}
      <div className="pointer-events-none absolute inset-x-8 bottom-12 border-b border-slate-300" />

      {!temTraco && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-base text-slate-400">
            Assine aqui com o dedo
          </span>
        </div>
      )}
    </div>
  );
}
