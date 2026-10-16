import { useCallback, useEffect, useState } from 'react';

/**
 * Claro, escuro, ou o que o sistema disser.
 *
 * "Sistema" é o padrão porque a maioria já configurou isso uma vez no
 * aparelho; escolher aqui é para quem quer o contrário do sistema nesta tela —
 * e essa escolha fica gravada.
 */
export type Tema = 'claro' | 'escuro' | 'sistema';

const CHAVE = 'ilnet:tema';

/** O tema escolhido, ou "sistema" quando ninguém escolheu (ou o storage falhou). */
export function lerTema(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'claro' || salvo === 'escuro') return salvo;
  } catch {
    // Navegador com storage bloqueado: segue o sistema.
  }
  return 'sistema';
}

function sistemaPedeEscuro(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Liga ou desliga a classe que o Tailwind lê para o tema escuro. Devolve o que
 * ficou valendo, já resolvido o "sistema".
 */
function pintar(tema: Tema): boolean {
  const escuro = tema === 'escuro' || (tema === 'sistema' && sistemaPedeEscuro());
  document.documentElement.classList.toggle('dark', escuro);
  // A barra do navegador no celular acompanha o fundo da página.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', escuro ? '#0E0F11' : '#1E1F23');
  return escuro;
}

export interface ControleDoTema {
  /** O que foi escolhido — inclusive "sistema", que é o padrão. */
  tema: Tema;
  /** O que está valendo na tela agora, já resolvido o "sistema". */
  escuro: boolean;
  trocar: (tema: Tema) => void;
}

/**
 * O tema atual e como trocá-lo. A troca vale na hora, para todas as telas, e
 * sobrevive ao recarregamento — o mesmo valor que o script do `index.html` lê
 * antes da primeira pintura.
 */
export function useTema(): ControleDoTema {
  const [tema, setTema] = useState<Tema>(lerTema);
  const [escuro, setEscuro] = useState(() =>
    typeof document === 'undefined'
      ? false
      : document.documentElement.classList.contains('dark'),
  );

  const trocar = useCallback((novo: Tema) => {
    setTema(novo);
    try {
      if (novo === 'sistema') localStorage.removeItem(CHAVE);
      else localStorage.setItem(CHAVE, novo);
    } catch {
      // Sem storage a escolha vale só nesta sessão — melhor que não valer.
    }
    setEscuro(pintar(novo));
  }, []);

  // Quem está em "sistema" acompanha o aparelho enquanto a tela está aberta:
  // o computador que escurece sozinho às seis da tarde leva o app junto.
  useEffect(() => {
    if (tema !== 'sistema') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const aoMudar = () => setEscuro(pintar('sistema'));
    media.addEventListener('change', aoMudar);
    return () => media.removeEventListener('change', aoMudar);
  }, [tema]);

  return { tema, escuro, trocar };
}
