import { useEffect, useState } from 'react';

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
export interface PedacoVisivel {
  top: number;
  left: number;
  width: number;
  height: number;
  /** O teclado está cobrindo a tela. */
  teclado: boolean;
}

export function usePedacoVisivel(): PedacoVisivel | null {
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
 * O teclado do celular está aberto?
 *
 * Para o que fica preso no pé da tela — a barra de "Voltar / Avançar" da APR,
 * o "Enviar ao IXC" da OS. Com o teclado aberto, ela ou fica atrás das teclas
 * ou, no iPhone, solta no meio da tela por cima do campo que se está
 * preenchendo. Quem digita não precisa dela; fecha o teclado e ela volta.
 */
export function useTecladoAberto(): boolean {
  return usePedacoVisivel()?.teclado ?? false;
}
