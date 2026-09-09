import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Arrastar o papel para dentro da tela.
 *
 * O gesto é o mesmo em toda a estante: abre-se a pasta, larga-se o arquivo em
 * qualquer lugar dela, e ele é guardado ali. Era assim só nas Notas Fiscais —
 * na pasta de uma pessoa era preciso abrir a janela "Guardar documento" antes,
 * e só a área tracejada de dentro dela recebia o arrasto. Quem já sabia o
 * gesto de uma tela o tentava na outra, o navegador abria o PDF numa aba e a
 * página se perdia.
 *
 * Os ouvintes moram na `window`, e não num elemento, por causa disso: o
 * padrão do navegador ao soltar um arquivo fora de uma zona de drop é
 * **abrir o arquivo**, trocando a página pelo PDF. Prender o `preventDefault`
 * à janela inteira é o que garante que nenhum canto da tela tenha esse
 * comportamento.
 *
 * Devolve se há um arquivo sendo arrastado agora, para a tela poder acender a
 * moldura (ver a `MolduraDoArrasto`).
 */
export function useSoltarArquivos(
  aoSoltar: (arquivos: File[]) => void,
): boolean {
  const [arrastando, setArrastando] = useState(false);

  /*
   * A função entra por `ref` porque os ouvintes são registrados uma vez só.
   * Lida na hora do evento, ela é sempre a do render atual — sem isto, o
   * `aoSoltar` capturado no primeiro render veria estados velhos (a pasta que
   * estava aberta quando a tela montou, e não a de agora).
   */
  const aoSoltarRef = useRef(aoSoltar);
  aoSoltarRef.current = aoSoltar;

  useEffect(() => {
    /* Só arquivo acende a tela: arrastar um texto ou o link de outra aba
       também dispara estes eventos, e não é disso que se trata aqui. */
    const temArquivo = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    /* `dragenter` e `dragleave` disparam a cada elemento por que o cursor
       passa. Sem contar as entradas e as saídas, a moldura pisca ao cruzar
       cada linha da tabela. */
    let profundidade = 0;

    function aoEntrar(e: DragEvent) {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade += 1;
      setArrastando(true);
    }

    function aoPassar(e: DragEvent) {
      // Sem este `preventDefault` o `drop` nunca acontece: o padrão do
      // navegador é recusar a soltura e abrir o arquivo.
      if (temArquivo(e)) e.preventDefault();
    }

    function aoSair(e: DragEvent) {
      if (!temArquivo(e)) return;
      profundidade = Math.max(0, profundidade - 1);
      if (profundidade === 0) setArrastando(false);
    }

    function soltou(e: DragEvent) {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade = 0;
      setArrastando(false);
      aoSoltarRef.current(Array.from(e.dataTransfer?.files ?? []));
    }

    window.addEventListener('dragenter', aoEntrar);
    window.addEventListener('dragover', aoPassar);
    window.addEventListener('dragleave', aoSair);
    window.addEventListener('drop', soltou);
    return () => {
      window.removeEventListener('dragenter', aoEntrar);
      window.removeEventListener('dragover', aoPassar);
      window.removeEventListener('dragleave', aoSair);
      window.removeEventListener('drop', soltou);
    };
  }, []);

  return arrastando;
}

/**
 * A confirmação de que a tela inteira recebe o arquivo.
 *
 * Um retângulo tracejado sobre tudo é o que diz "pode soltar aqui" sem
 * precisar de legenda — e cobre justamente a parte vazia da página, que é onde
 * a pessoa naturalmente solta.
 */
export function MolduraDoArrasto({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-4 rounded-3xl border-2 border-dashed border-brand-400 bg-brand-500/10 backdrop-blur-[1px]" />
      <p className="relative rounded-2xl bg-papel px-6 py-4 text-center font-display text-sm font-semibold text-tinta-700 shadow-xl ring-1 ring-tinta-200">
        {children}
      </p>
    </div>
  );
}
