import { useState, type ReactNode } from 'react';
import { useCelular } from '../lib/celular';

/** Um passo do assistente: o que ele pergunta, e o que já foi respondido. */
export interface PassoDoAssistente {
  /** O nome do passo, no alto da tela e na linha da revisão. */
  rotulo: string;
  /** O que foi preenchido, escrito. Vazio = "em branco" na revisão. */
  resumo?: ReactNode;
  /** Falta algo obrigatório: o "Continuar" espera, dizendo o quê. */
  falta?: string;
  /** Passo que não se aplica agora — o boleto numa conta paga por PIX. */
  pular?: boolean;
}

/**
 * O formulário longo, no celular, virando uma pergunta por vez.
 *
 * Pedido do dono em 22/09/2026: "no celular, quando eu for criar algo, ele
 * abre a tela e pede um item por vez — depois mostra o que foi preenchido e o
 * finalizar como já funciona". Um formulário de quinze campos numa tela de
 * bolso é uma parede: rola-se para cima e para baixo procurando o que falta, e
 * o botão de lançar fica a seis rolagens de distância.
 *
 * **No computador não muda nada.** Lá a tela é larga, os campos cabem lado a
 * lado e ver tudo de uma vez é a vantagem — `mostrar` devolve sempre `true`, e
 * o formulário desenha como sempre desenhou.
 *
 * Quem usa mantém os campos onde estão; só diz de que passo cada um é:
 *
 * ```tsx
 * const a = useAssistente([{ rotulo: 'Fornecedor', falta: … }, …]);
 * …
 * {a.cabecalho}
 * {a.mostrar(0) && <div>…o campo do fornecedor…</div>}
 * {a.mostrar(1) && <div>…o valor…</div>}
 * {a.resumo}
 * {a.mostrarAcao && <div>…os botões de sempre…</div>}
 * {a.barra}
 * ```
 *
 * O estado dos campos continua sendo do formulário: o assistente só esconde e
 * mostra. Assim nada se perde ao andar para trás, e o que já estava preenchido
 * (a conta aberta de dentro de um veículo, por exemplo) continua preenchido.
 */
export function useAssistente(passos: PassoDoAssistente[]) {
  const celular = useCelular();
  const [posicao, setPosicao] = useState(0);

  /** A fila de verdade: o que não se aplica agora nem entra na contagem. */
  const fila = passos
    .map((passo, indice) => ({ passo, indice }))
    .filter(({ passo }) => !passo.pular);

  // Um passo pode sumir da fila depois de escolhido (marcar "Dinheiro" tira o
  // boleto): a posição se ajusta em vez de apontar para o vazio.
  const onde = Math.min(posicao, fila.length);
  const naRevisao = celular && onde >= fila.length;
  const atual = naRevisao ? null : fila[onde];

  const mostrar = (indice: number) =>
    !celular || (!!atual && atual.indice === indice);

  const cabecalho = celular ? (
    <div className="mb-3">
      <p className="eyebrow">
        {naRevisao
          ? 'Confira antes de finalizar'
          : `Passo ${onde + 1} de ${fila.length}`}
      </p>
      {atual && (
        <h3 className="font-display text-base font-semibold text-tinta-900">
          {atual.passo.rotulo}
        </h3>
      )}
    </div>
  ) : null;

  /**
   * A revisão: cada passo e o que ficou nele.
   *
   * Tocar na linha volta para aquele passo — é o que transforma a revisão em
   * conferência de verdade: achou o valor errado, corrige ali mesmo e volta.
   */
  const resumo = naRevisao ? (
    <div className="lista-dividida mb-4 rounded-xl border border-tinta-200">
      {fila.map(({ passo }, i) => (
        <button
          key={passo.rotulo}
          type="button"
          onClick={() => setPosicao(i)}
          className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-tinta-400">
              {passo.rotulo}
            </span>
            <span className="block text-sm text-tinta-800">
              {passo.resumo || <span className="text-tinta-400">em branco</span>}
            </span>
          </span>
          <span aria-hidden className="shrink-0 pt-1 text-xs text-brand-600 dark:text-brand-300">
            mudar
          </span>
        </button>
      ))}
    </div>
  ) : null;

  /** No computador, a ação de sempre; no celular, só na revisão. */
  const mostrarAcao = !celular || naRevisao;

  const barra =
    celular && !naRevisao ? (
      <div className="mt-4 space-y-2">
        {atual?.passo.falta && (
          <p className="text-[13px] text-amber-700 dark:text-amber-300">
            {atual.passo.falta}
          </p>
        )}
        <div className="flex gap-2">
          {onde > 0 && (
            <button
              type="button"
              onClick={() => setPosicao(onde - 1)}
              className="btn btn-neutro h-12 flex-1 text-base"
            >
              Voltar
            </button>
          )}
          <button
            type="button"
            onClick={() => setPosicao(onde + 1)}
            disabled={!!atual?.passo.falta}
            className="btn btn-primario h-12 flex-1 text-base"
          >
            {onde === fila.length - 1 ? 'Conferir' : 'Continuar'}
          </button>
        </div>
      </div>
    ) : celular && naRevisao ? (
      <button
        type="button"
        onClick={() => setPosicao(fila.length - 1)}
        className="btn btn-sutil btn-p mt-2"
      >
        Voltar ao último passo
      </button>
    ) : null;

  return { celular, naRevisao, mostrar, mostrarAcao, cabecalho, resumo, barra };
}
