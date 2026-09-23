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
 * - **`data-passo-acao`** marca o que só aparece na revisão: a prévia, os
 *   avisos do fim. A linha do botão principal (`.btn-primario`) fora dos
 *   campos já é tratada assim sem marca — é o "Salvar" de todo formulário.
 * - **Um campo só não vira passo a passo**: seria uma tela a mais para a
 *   mesma pergunta.
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

/**
 * Um passo: os pedaços da página que formam um campo. Quase sempre um só — o
 * bloco com o rótulo dentro. Quando o rótulo está solto no meio de outros
 * campos (a "Foto da nota", um `<p className="rotulo">` seguido do componente
 * da foto), o passo é o rótulo e o que vem depois dele, até o próximo rótulo.
 */
type PedacosDoPasso = HTMLElement[];

const ROTULO = '.rotulo';

/** Os passos, na ordem da página. */
function acharPassos(caixa: HTMLElement): PedacosDoPasso[] {
  const passos: PedacosDoPasso[] = [];
  caixa.querySelectorAll<HTMLElement>('[data-passo]').forEach((el) => passos.push([el]));
  caixa.querySelectorAll<HTMLElement>(ROTULO).forEach((rotulo) => {
    if (rotulo.closest('[data-passo-acao], [data-passo], [data-passo-ui]')) return;
    const pai = rotulo.parentElement;
    if (!pai) return;
    if (pai !== caixa && pai.querySelectorAll(ROTULO).length === 1) {
      passos.push([pai]);
      return;
    }
    // Rótulo solto entre outros campos: ele e os vizinhos seguintes.
    const pedacos: HTMLElement[] = [rotulo];
    for (let v = rotulo.nextElementSibling; v; v = v.nextElementSibling) {
      if (v.matches(ROTULO) || v.querySelector(ROTULO)) break;
      if (v.matches('[data-passo-acao], [data-passo]') || v.querySelector('.btn-primario')) break;
      pedacos.push(v as HTMLElement);
    }
    passos.push(pedacos);
  });
  const todos = passos.flat();
  const lista = passos.filter(
    (p) =>
      // Um bloco dentro de outro passo anda com ele.
      !p.every((el) => todos.some((outro) => outro !== el && !p.includes(outro) && outro.contains(el))),
  );
  return lista.sort((a, b) =>
    a[0].compareDocumentPosition(b[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/** O elemento que dá nome ao passo. */
function tituloDoPasso(p: PedacosDoPasso): HTMLElement | null {
  for (const el of p) {
    if (el.matches(ROTULO)) return el;
    const r = el.querySelector<HTMLElement>(ROTULO);
    if (r) return r;
  }
  return null;
}

function nomeCru(p: PedacosDoPasso): string {
  return p[0].dataset.passo || tituloDoPasso(p)?.textContent || 'Informação';
}

function rotuloDoPasso(p: PedacosDoPasso): string {
  return nomeCru(p).replace(/\*|\(opcional\)/gi, '').replace(/\s+/g, ' ').trim();
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
function valorDoPasso(p: PedacosDoPasso): string {
  return p.map(valorDoPedaco).filter(Boolean).join(' · ');
}

function valorDoPedaco(el: HTMLElement): string {
  const partes: string[] = [];
  let temCaixinha = false;
  const fotos = el.querySelectorAll('img').length;
  if (fotos > 0) partes.push(fotos === 1 ? '1 foto' : `${fotos} fotos`);
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
  if (partes.length === 0 && !el.matches(ROTULO)) {
    const copia = el.cloneNode(true) as HTMLElement;
    copia.querySelectorAll('.rotulo, button, .ajuda').forEach((n) => n.remove());
    const t = textoVisivel(copia);
    if (t) partes.push(t);
  }
  return partes.join(' · ');
}

/**
 * Deixa à vista só o caminho até os elementos pedidos — e eles inteiros.
 *
 * Esconder só os outros campos não bastava: a seção "Vendas" de um pagamento,
 * a explicação no pé do formulário, a caixa de prévia continuavam na tela a
 * cada passo, vazias ou fora de hora. Aqui, de cada nível entre o campo e a
 * caixa, o que não leva ao campo sai. `null` mostra tudo (fora do celular, ou
 * formulário de um campo só).
 */
function mostrarSo(caixa: HTMLElement, manter: HTMLElement[] | null): void {
  if (!manter) {
    caixa.querySelectorAll('[data-passo-oculto]').forEach((n) => n.removeAttribute('data-passo-oculto'));
    return;
  }
  const noCaminho = new Set<Element>();
  for (const m of manter) {
    for (let x: Element | null = m; x && x !== caixa; x = x.parentElement) noCaminho.add(x);
    m.querySelectorAll('[data-passo-oculto]').forEach((n) => n.removeAttribute('data-passo-oculto'));
  }
  const visitar = (pai: Element) => {
    for (const filho of Array.from(pai.children)) {
      if (filho.hasAttribute('data-passo-ui')) continue;
      const fica = noCaminho.has(filho);
      filho.toggleAttribute('data-passo-oculto', !fica);
      if (fica && !manter.includes(filho as HTMLElement)) visitar(filho);
    }
  };
  visitar(caixa);
}

function faltaNoPasso(p: PedacosDoPasso): string | null {
  const marcada = p.find((el) => el.dataset.passoFalta)?.dataset.passoFalta;
  if (marcada) return marcada;
  const vazio = p.some((el) =>
    [...el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input[required], select[required], textarea[required]',
    )].some((c) => !c.value.trim()),
  );
  return vazio ? `Preencha ${rotuloDoPasso(p).toLowerCase()} para continuar.` : null;
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
    const valendo = agora.length >= 2 ? agora : [];
    setPassos((antes) =>
      JSON.stringify(antes) === JSON.stringify(valendo) ? antes : valendo,
    );

    const ativo = blocos.length >= 2;
    const atual = Math.min(posicao, blocos.length);
    const revisao = ativo && atual >= blocos.length;
    // O nome do campo já está no alto, como título do passo.
    el.querySelectorAll('[data-passo-titulo]').forEach((t) => t.removeAttribute('data-passo-titulo'));
    if (ativo && !revisao) tituloDoPasso(blocos[atual])?.setAttribute('data-passo-titulo', '');
    // O que fica para a revisão: o marcado, e a linha do botão principal.
    const doFim: HTMLElement[] = [...el.querySelectorAll<HTMLElement>('[data-passo-acao]')];
    el.querySelectorAll<HTMLElement>('.btn-primario').forEach((b) => {
      if (b.closest('[data-passo-ui]')) return;
      if (blocos.some((p) => p.some((bl) => bl.contains(b)))) return;
      if (b.parentElement && b.parentElement !== el) doFim.push(b.parentElement);
    });
    // O aviso de erro (o IXC recusou, faltou algo) aparece sempre.
    const avisos = [...el.querySelectorAll<HTMLElement>('[data-aviso]')];
    mostrarSo(
      el,
      !ativo
        ? null
        : revisao
          ? [...doFim, ...avisos]
          : [...blocos[atual], ...avisos],
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
        <div className="mb-3 flex items-start gap-2" data-passo-ui>
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
        <div className="lista-dividida mb-4 mt-1 rounded-xl border border-tinta-200" data-passo-ui>
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
        <div className="mt-4 space-y-2" data-passo-ui>
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
