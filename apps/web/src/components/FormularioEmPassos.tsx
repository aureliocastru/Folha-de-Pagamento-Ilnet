import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCelular } from '../lib/celular';

/**
 * Qualquer formulário de cadastro, no celular, um campo por vez.
 *
 * Regra do dono (22/09/2026, cobrada de novo em 23/09): "passo por passo na
 * hora de cadastrar algo novo, todas as telas de todos os módulos devem
 * funcionar assim". No computador nada muda — este componente devolve o
 * formulário como ele é.
 *
 * O `useAssistente` já fazia isso, mas cada formulário precisava listar os
 * passos e embrulhar cada campo; com vinte e tantas telas de cadastro, era a
 * receita de sempre haver uma esquecida. Este acha os passos sozinho:
 *
 * - **Cada campo é um passo.** Campo é o bloco que tem um `label.rotulo` — o
 *   desenho de todos os formulários da casa. O nome do passo é o do rótulo.
 *   Um bloco pode se declarar passo com `data-passo="Nome"` (quando não tem
 *   rótulo, ou quando dois campos devem andar juntos).
 * - **O que não se aplica some sozinho.** Campo que o formulário não desenha
 *   (o boleto numa conta em dinheiro) não existe na página, e não vira passo.
 * - **A revisão lê o que foi preenchido** direto dos campos: o texto digitado,
 *   a opção escolhida, o que o botão de escolher mostra.
 * - **`data-passo-acao`** marca o que só aparece na revisão: os botões de
 *   salvar, a prévia, os avisos do fim.
 * - **`data-passo-falta="…"`** num passo segura o "Continuar" e diz o porquê.
 *   Campo com `required` vazio também segura.
 */
export function FormularioEmPassos({ children }: { children: ReactNode }) {
  const celular = useCelular();
  if (!celular) return <>{children}</>;
  return <EmPassos>{children}</EmPassos>;
}

interface Passo {
  rotulo: string;
  opcional: boolean;
  falta: string | null;
}

/** Os blocos que são passos, na ordem da página. */
function acharPassos(caixa: HTMLElement): HTMLElement[] {
  const candidatos = new Set<HTMLElement>();
  caixa.querySelectorAll<HTMLElement>('[data-passo]').forEach((el) => candidatos.add(el));
  caixa.querySelectorAll<HTMLElement>('label.rotulo').forEach((label) => {
    if (label.closest('[data-passo-acao]')) return;
    if (label.closest('[data-passo]')) return;
    const bloco = label.parentElement;
    if (bloco && bloco !== caixa) candidatos.add(bloco);
  });
  const lista = [...candidatos].filter(
    (el) =>
      // Um bloco dentro de outro passo anda com ele.
      ![...candidatos].some((outro) => outro !== el && outro.contains(el)),
  );
  return lista.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

function nomeCru(el: HTMLElement): string {
  return el.dataset.passo || el.querySelector('label.rotulo')?.textContent || 'Informação';
}

function rotuloDoPasso(el: HTMLElement): string {
  return nomeCru(el).replace(/\*|\(opcional\)/gi, '').replace(/\s+/g, ' ').trim();
}

/** O texto que se vê num pedaço da tela, com espaço entre um pedaço e outro. */
function textoVisivel(el: Node): string {
  const pedacos: string[] = [];
  const andar = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const t = n.textContent?.trim();
    if (t) pedacos.push(t);
  }
  return pedacos.join(' ').replace(/\s+/g, ' ').trim();
}

/** O que foi preenchido num passo, escrito como se lê. */
function valorDoPasso(el: HTMLElement): string {
  const partes: string[] = [];
  let temCaixinha = false;
  el.querySelectorAll<HTMLElement>('input, select, textarea, button[aria-haspopup]').forEach(
    (c) => {
      if (c instanceof HTMLSelectElement) {
        const t = c.selectedOptions[0]?.textContent?.trim();
        if (t) partes.push(t);
      } else if (c instanceof HTMLInputElement) {
        if (c.type === 'hidden' || c.type === 'file') return;
        if (c.type === 'checkbox' || c.type === 'radio') {
          temCaixinha = true;
          if (c.checked) {
            // A caixinha que é o próprio passo responde sim; uma entre
            // várias diz qual foi marcada.
            const label = c.closest('label');
            partes.push(!label || label === el ? 'Sim' : textoVisivel(label) || 'Sim');
          }
          return;
        }
        if (c.value.trim()) partes.push(c.value.trim());
      } else if (c instanceof HTMLTextAreaElement) {
        if (c.value.trim()) partes.push(c.value.trim());
      } else {
        const t = textoVisivel(c);
        if (t) partes.push(t);
      }
    },
  );
  if (partes.length === 0 && temCaixinha) return 'Não';
  // Sem campo nenhum (um nome já escolhido, mostrado como texto): o que se vê.
  if (partes.length === 0) {
    const copia = el.cloneNode(true) as HTMLElement;
    copia.querySelectorAll('label.rotulo, button, .ajuda').forEach((n) => n.remove());
    const t = textoVisivel(copia);
    if (t) partes.push(t);
  }
  return partes.join(' · ');
}

function faltaNoPasso(el: HTMLElement): string | null {
  if (el.dataset.passoFalta) return el.dataset.passoFalta;
  const vazio = [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input[required], select[required], textarea[required]',
  )].some((c) => !c.value.trim());
  return vazio ? `Preencha ${rotuloDoPasso(el).toLowerCase()} para continuar.` : null;
}

function EmPassos({ children }: { children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState(0);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [valores, setValores] = useState<string[]>([]);
  /** Muda a cada mudança da página, para a leitura acima correr de novo. */
  const [versao, setVersao] = useState(0);

  const total = passos.length;
  const onde = Math.min(posicao, total);
  const naRevisao = total > 0 && onde >= total;

  // Depois de cada desenho: quais são os passos, qual aparece, o que foi preenchido.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const blocos = acharPassos(el);
    const agora = blocos.map((b) => ({
      rotulo: rotuloDoPasso(b),
      opcional: /\(opcional\)/i.test(nomeCru(b)),
      falta: faltaNoPasso(b),
    }));
    setPassos((antes) =>
      JSON.stringify(antes) === JSON.stringify(agora) ? antes : agora,
    );

    const atual = Math.min(posicao, blocos.length);
    const revisao = blocos.length > 0 && atual >= blocos.length;
    blocos.forEach((b, i) => {
      b.toggleAttribute('data-passo-oculto', revisao || i !== atual);
      // O nome do campo já está no alto, como título do passo.
      b.toggleAttribute('data-passo-atual', !revisao && i === atual);
    });
    el.querySelectorAll<HTMLElement>('[data-passo-acao]').forEach((a) =>
      a.toggleAttribute('data-passo-oculto', !revisao),
    );

    if (revisao) {
      const lidos = blocos.map(valorDoPasso);
      setValores((antes) =>
        antes.join('\u0000') === lidos.join('\u0000') ? antes : lidos,
      );
    }
    // `children` muda a cada desenho do formulário; `versao`, a cada mudança
    // que ele faz sem se redesenhar daqui.
  }, [posicao, versao, children]);

  // O que o formulário desenha ou tira por conta própria (um campo que só
  // aparece depois de uma escolha) também muda a lista de passos.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const observador = new MutationObserver(() => setVersao((v) => v + 1));
    observador.observe(el, { childList: true, subtree: true });
    // Digitar muda o que falta, e o "Continuar" tem de acompanhar.
    const aoDigitar = () => setVersao((v) => v + 1);
    el.addEventListener('input', aoDigitar);
    el.addEventListener('change', aoDigitar);
    return () => {
      observador.disconnect();
      el.removeEventListener('input', aoDigitar);
      el.removeEventListener('change', aoDigitar);
    };
  }, []);

  function ir(para: number) {
    setPosicao(para);
    // O passo novo começa no alto da janela, e não onde o anterior terminou.
    requestAnimationFrame(() =>
      caixa.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }

  const atual = naRevisao ? null : passos[onde];

  return (
    <div
      ref={caixa}
      data-em-passos
      onKeyDown={(e) => {
        // O "Ir" do teclado do celular avança, em vez de mandar o formulário.
        const alvo = e.target as HTMLElement;
        if (
          e.key === 'Enter' &&
          alvo instanceof HTMLInputElement &&
          !naRevisao &&
          atual &&
          !atual.falta
        ) {
          e.preventDefault();
          alvo.blur();
          ir(onde + 1);
        }
      }}
    >
      {total > 0 && (
        <div className="mb-3 flex items-start gap-2">
          {onde > 0 && (
            <button
              type="button"
              onClick={() => ir(onde - 1)}
              aria-label="Voltar ao passo anterior"
              className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-tinta-600 transition active:bg-tinta-100"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <p className="eyebrow">
              {naRevisao ? 'Confira antes de finalizar' : `Passo ${onde + 1} de ${total}`}
            </p>
            {atual && (
              <h3 className="font-display text-base font-semibold text-tinta-900">
                {atual.rotulo}
                {atual.opcional && (
                  <span className="ml-1.5 text-sm font-normal text-tinta-400">(opcional)</span>
                )}
              </h3>
            )}
          </div>
        </div>
      )}

      {naRevisao && (
        <div className="lista-dividida mb-4 mt-1 rounded-xl border border-tinta-200">
          {passos.map((p, i) => (
            <button
              key={`${p.rotulo}-${i}`}
              type="button"
              onClick={() => ir(i)}
              className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-tinta-400">
                  {p.rotulo}
                </span>
                <span className="block break-words text-sm text-tinta-800">
                  {valores[i] || <span className="text-tinta-400">em branco</span>}
                </span>
              </span>
              <span aria-hidden className="shrink-0 pt-1 text-xs text-brand-600 dark:text-brand-300">
                mudar
              </span>
            </button>
          ))}
        </div>
      )}

      {children}


      {total > 0 && !naRevisao && (
        <div className="mt-4 space-y-2">
          {atual?.falta && (
            <p className="text-[13px] text-amber-700 dark:text-amber-300">{atual.falta}</p>
          )}
          <div className="flex gap-2">
            {onde > 0 && (
              <button
                type="button"
                onClick={() => ir(onde - 1)}
                className="btn btn-neutro h-12 flex-1 text-base"
              >
                Voltar
              </button>
            )}
            <button
              type="button"
              onClick={() => ir(onde + 1)}
              disabled={!!atual?.falta}
              className="btn btn-primario h-12 flex-1 text-base"
            >
              {onde === total - 1 ? 'Conferir' : 'Continuar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
