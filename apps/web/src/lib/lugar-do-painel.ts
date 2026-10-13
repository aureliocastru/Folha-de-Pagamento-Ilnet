import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Onde pôr um painel que abre junto de um campo — a lista de um seletor, as
 * sugestões de quem digita, o calendário — sem ele ir parar atrás do teclado.
 *
 * Cada painel media a própria posição contra `window.innerHeight`, e no
 * celular essa conta mente: o teclado não encolhe a página, ele a cobre (e no
 * iPhone ainda a empurra para cima). As sugestões abriam embaixo do campo, que
 * é exatamente debaixo das teclas; a lista do seletor, aberta antes de se
 * tocar na busca, ficava solta na tela quando o teclado subia, longe do campo.
 *
 * A conta aqui é contra o pedaço que se vê de verdade (`visualViewport`, o
 * mesmo da `Janela`): o painel cai embaixo do campo se couber, em cima se
 * houver mais espaço lá, e nunca sai do retângulo visível — encolhe
 * (`maxHeight`) em vez de passar por baixo das teclas. Remede quando o
 * teclado sobe ou desce, quando a página rola e quando `remedir` muda (a lista
 * filtrada que encolheu).
 */
export function useLugarDoPainel(
  ancora: HTMLElement | null,
  painel: RefObject<HTMLElement | null>,
  {
    larguraMinima = 0,
    larguraDoPainel = false,
    alturaMaxima = Infinity,
    remedir,
  }: {
    /** O painel não fica mais estreito que isto, mesmo com o campo estreito. */
    larguraMinima?: number;
    /** O teto de altura do painel que rola por inteiro (as sugestões). */
    alturaMaxima?: number;
    /** O painel tem largura própria (o calendário): não acompanha a do campo. */
    larguraDoPainel?: boolean;
    /** Mudando, mede de novo — o número de linhas da lista, por exemplo. */
    remedir?: unknown;
  } = {},
): CSSProperties {
  const [lugar, setLugar] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!ancora) return;
    const vv = window.visualViewport;
    const medir = () => {
      const vis = vv
        ? { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height }
        : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      const r = ancora.getBoundingClientRect();
      const el = painel.current;
      // A altura inteira do conteúdo, e não a de agora — que já pode estar
      // encolhida pelo `maxHeight` da medida anterior.
      const altura = el?.scrollHeight ?? 320;
      const largura = larguraDoPainel
        ? Math.min(el?.offsetWidth ?? 300, vis.width - 16)
        : Math.min(Math.max(r.width, larguraMinima), vis.width - 16);

      const embaixo = vis.top + vis.height - r.bottom - 12;
      const emCima = r.top - vis.top - 12;
      const desce = altura <= embaixo || embaixo >= emCima;
      const espaco = Math.max(
        120,
        Math.min(desce ? embaixo : emCima, vis.height - 16, alturaMaxima),
      );
      const mostrada = Math.min(altura, espaco);
      const topoDesejado = desce ? r.bottom + 4 : r.top - 4 - mostrada;
      // Campo fora do pedaço visível (rolou para trás do teclado): o painel
      // fica dentro dele assim mesmo, por cima do que for preciso.
      const top = limitar(topoDesejado, vis.top + 8, vis.top + vis.height - mostrada - 8);
      const left = limitar(r.left, vis.left + 8, vis.left + vis.width - largura - 8);

      const novo: CSSProperties = {
        left: Math.round(left),
        top: Math.round(top),
        maxHeight: Math.round(espaco),
        ...(larguraDoPainel ? {} : { width: Math.round(largura) }),
      };
      setLugar((antes) => (igual(antes, novo) ? antes : novo));
    };
    medir();
    window.addEventListener('resize', medir);
    // `true` para pegar a rolagem de qualquer container, e não só a da página.
    window.addEventListener('scroll', medir, true);
    vv?.addEventListener('resize', medir);
    vv?.addEventListener('scroll', medir);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
      vv?.removeEventListener('resize', medir);
      vv?.removeEventListener('scroll', medir);
    };
  }, [ancora, painel, larguraMinima, larguraDoPainel, alturaMaxima, remedir]);

  // Antes da primeira medida, fora da tela: nada de piscar no canto.
  return lugar ?? { left: -9999, top: 0 };
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.max(minimo, Math.min(valor, Math.max(minimo, maximo)));
}

function igual(a: CSSProperties | null, b: CSSProperties): boolean {
  return (
    !!a &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}
