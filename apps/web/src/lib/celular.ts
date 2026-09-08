import { useEffect, useState } from 'react';

/**
 * A largura em que o app troca de casca.
 *
 * 768px é a divisa do `md` do Tailwind, e é ela — e não o `lg` de antes — que
 * decide onde a barra lateral aparece. Os dois números precisam ser o mesmo, ou
 * sobra uma faixa de larguras órfã: entre 768 e 1023 o app não teria nem a
 * barra lateral (que só entrava no `lg`) nem a barra de baixo (que sairia no
 * `md`), e o menu simplesmente não existiria.
 */
export const LARGURA_CELULAR = 768;

const CONSULTA = `(max-width: ${LARGURA_CELULAR - 1}px)`;

/**
 * Estamos num celular?
 *
 * É a largura da janela que responde, e não o aparelho: quem estreita a janela
 * no computador recebe a mesma casca, e é assim que se confere o trabalho sem
 * pegar o telefone. A resposta acompanha o giro da tela enquanto a página está
 * aberta — retrato e paisagem de um celular grande caem em lados diferentes
 * desta linha.
 *
 * A primeira resposta já vem certa, antes da primeira pintura: começar em
 * `false` e corrigir no efeito faria a barra lateral piscar em cada
 * carregamento no celular.
 */
export function useCelular(): boolean {
  const [celular, setCelular] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(CONSULTA).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(CONSULTA);
    const aoMudar = (e: MediaQueryListEvent) => setCelular(e.matches);
    // O valor pode ter mudado entre a primeira pintura e este efeito — no
    // StrictMode o componente monta duas vezes, e girar a tela no meio disso
    // deixaria a casca errada até o próximo redimensionamento.
    setCelular(media.matches);
    media.addEventListener('change', aoMudar);
    return () => media.removeEventListener('change', aoMudar);
  }, []);

  return celular;
}
