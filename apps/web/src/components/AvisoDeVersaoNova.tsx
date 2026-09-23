import { useEffect, useState } from 'react';

/** De quanto em quanto tempo se pergunta ao servidor, com o app aberto. */
const INTERVALO_MS = 10 * 60 * 1000;
/** Voltar ao app depois de tanto tempo fora recarrega sem perguntar. */
const FORA_POR_MUITO_TEMPO_MS = 10 * 60 * 1000;
/** Entre duas perguntas, no mínimo isto — voltar ao app dez vezes seguidas não vira dez leituras. */
const ESPERA_MINIMA_MS = 60 * 1000;

/** O pacote com que esta página abriu: `/assets/index-XXXX.js`. */
function pacoteDaPagina(doc: Document): string | null {
  const script = doc.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  return script ? new URL(script.src, location.origin).pathname : null;
}

/**
 * Recarrega buscando a página no servidor, e não na memória do aparelho.
 *
 * `location.reload()` pode devolver o `index.html` guardado — foi o que prendeu
 * o iPhone na versão velha. Um endereço que nunca foi aberto não tem cópia
 * guardada: o `?atualizar=` com a hora obriga a ir ao servidor.
 */
export function recarregarDoServidor(): void {
  location.replace(`/?atualizar=${Date.now()}`);
}

/**
 * Chave da trava contra recarregar em círculo: guarda para qual pacote já se
 * recarregou uma vez nesta aba. Se mesmo assim a página voltar velha, o aviso
 * aparece com o botão, em vez de recarregar de novo para sempre.
 */
const TRAVA = 'versao.recarregouPara';

/** O pacote que o servidor entrega agora, lido do `index.html` de hoje. */
async function pacoteNoServidor(): Promise<string | null> {
  const resposta = await fetch(`/index.html?v=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!resposta.ok) return null;
  const html = await resposta.text();
  return pacoteDaPagina(new DOMParser().parseFromString(html, 'text/html'));
}

/**
 * Avisa quando saiu versão nova do sistema, e recarrega quando dá.
 *
 * O app instalado na tela do celular não recarrega sozinho: tocar no ícone
 * devolve a tela de onde ela parou, com o código de quando foi aberta — às
 * vezes de dias antes. Em 23/09/2026 o pagamento de avulso já tinha mudado no
 * computador e, no celular, continuava abrindo do jeito velho.
 *
 * O `index.html` diz qual pacote é o atual (o nome muda a cada versão). Com o
 * app aberto, ele é conferido de tempos em tempos e sempre que o app volta
 * para a frente. Havendo novo:
 *
 * - ao abrir o app, recarrega sem perguntar: ainda não há nada digitado;
 * - voltando depois de muito tempo fora, recarrega sem perguntar — ninguém
 *   deixou um formulário pela metade por dez minutos esperando encontrá-lo;
 * - fora isso, aparece o aviso com o botão. Recarregar por conta própria no
 *   meio de um pagamento, na volta de copiar a chave PIX no WhatsApp, jogaria
 *   fora o que a pessoa tinha digitado.
 *
 * No servidor de desenvolvimento não há pacote com nome, e nada acontece.
 */
export function AvisoDeVersaoNova() {
  const [haNova, setHaNova] = useState(false);

  useEffect(() => {
    const atual = pacoteDaPagina(document);
    if (!atual) return;

    let ultimaPergunta = 0;
    let saiuEm: number | null = null;

    // Abriu pelo botão de atualizar: tira o `?atualizar=` do endereço.
    if (new URLSearchParams(location.search).has('atualizar')) {
      history.replaceState(history.state, '', location.pathname);
    }

    const conferir = async (podeRecarregar = false) => {
      if (Date.now() - ultimaPergunta < ESPERA_MINIMA_MS && !podeRecarregar)
        return;
      ultimaPergunta = Date.now();
      try {
        const noServidor = await pacoteNoServidor();
        if (!noServidor || noServidor === atual) return;
        if (podeRecarregar) {
          let jaTentou = true;
          try {
            jaTentou = sessionStorage.getItem(TRAVA) === noServidor;
            if (!jaTentou) sessionStorage.setItem(TRAVA, noServidor);
          } catch {
            // Sem armazenamento não há trava: vale o aviso, que não depende dela.
          }
          if (!jaTentou) {
            recarregarDoServidor();
            return;
          }
        }
        setHaNova(true);
      } catch {
        // Sem rede agora: a próxima volta pergunta de novo.
      }
    };

    /*
     * Logo ao abrir. Se a página veio da memória do aparelho e já existe outra,
     * recarrega na hora: ninguém digitou nada ainda.
     */
    void conferir(true);

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') {
        saiuEm = Date.now();
        return;
      }
      const tempoFora = saiuEm === null ? 0 : Date.now() - saiuEm;
      saiuEm = null;
      void conferir(tempoFora >= FORA_POR_MUITO_TEMPO_MS);
    };

    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    // O iPhone às vezes devolve a página da memória sem avisar a visibilidade.
    const aoVoltarDaMemoria = (e: PageTransitionEvent) => {
      if (e.persisted) void conferir(true);
    };
    window.addEventListener('pageshow', aoVoltarDaMemoria);
    const relogio = window.setInterval(() => void conferir(), INTERVALO_MS);

    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      window.removeEventListener('pageshow', aoVoltarDaMemoria);
      window.clearInterval(relogio);
    };
  }, []);

  if (!haNova) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-tinta-200 bg-papel px-4 py-3 shadow-2xl">
        <p className="min-w-0 flex-1 text-sm text-tinta-800">
          Saiu uma versão nova do sistema.
        </p>
        <button
          type="button"
          onClick={recarregarDoServidor}
          className="btn btn-primario shrink-0"
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}
