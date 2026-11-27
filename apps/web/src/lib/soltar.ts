import { useEffect, useRef, useState, type DragEvent } from 'react';

/**
 * Arrastar um arquivo até um lugar da tela, e não à tela inteira.
 *
 * É o par do `useSoltarArquivos` da pasta do RH, que faz da janela toda o alvo
 * porque lá só existe um lugar onde o papel pode ir. No fechamento de caixa
 * existem muitos: cada lançamento tem as notas dele, e o PDF solto tem de ir
 * para a linha em cima da qual foi solto.
 *
 * Só arquivo conta: arrastar um texto ou o link de outra aba também dispara
 * estes eventos, e não é disso que se trata aqui.
 */
function temArquivo(dados: DataTransfer | null): boolean {
  return Array.from(dados?.types ?? []).includes('Files');
}

export interface AlvoDeSoltar {
  onDragEnter?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}

/**
 * Faz de um elemento o lugar onde se solta o arquivo.
 *
 * Devolve os ouvintes para espalhar no elemento (pode ser em mais de um, quando
 * os dois são o mesmo alvo — a linha do lançamento e a tira de notas dela) e se
 * há um arquivo em cima agora, para acender a moldura.
 *
 * Os eventos param aqui (`stopPropagation`): um alvo dentro do outro recebe o
 * arquivo sozinho, e o de fora não fica aceso esperando um `drop` que não vem.
 */
export function useSoltarAqui(
  aoSoltar: (arquivos: File[]) => void,
  ativo = true,
): { sobre: boolean; alvo: AlvoDeSoltar } {
  const [sobre, setSobre] = useState(false);
  /* `dragenter` e `dragleave` disparam a cada filho por que o cursor passa.
     Sem contar entradas e saídas, a moldura pisca ao cruzar cada célula. */
  const profundidade = useRef(0);
  const aoSoltarRef = useRef(aoSoltar);
  aoSoltarRef.current = aoSoltar;

  // Desligado no meio do arrasto, a moldura não pode ficar acesa.
  useEffect(() => {
    if (!ativo) {
      profundidade.current = 0;
      setSobre(false);
    }
  }, [ativo]);

  if (!ativo) return { sobre: false, alvo: {} };

  return {
    sobre,
    alvo: {
      onDragEnter(e) {
        if (!temArquivo(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        profundidade.current += 1;
        setSobre(true);
      },
      onDragOver(e) {
        if (!temArquivo(e.dataTransfer)) return;
        // Sem este `preventDefault` o `drop` nunca acontece.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave(e) {
        if (!temArquivo(e.dataTransfer)) return;
        e.stopPropagation();
        profundidade.current = Math.max(0, profundidade.current - 1);
        if (profundidade.current === 0) setSobre(false);
      },
      onDrop(e) {
        if (!temArquivo(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        profundidade.current = 0;
        setSobre(false);
        const arquivos = Array.from(e.dataTransfer.files);
        if (arquivos.length > 0) aoSoltarRef.current(arquivos);
      },
    },
  };
}

/**
 * O arquivo solto fora de um alvo não troca a página por ele.
 *
 * O padrão do navegador ao soltar um arquivo onde ninguém o espera é **abrir o
 * arquivo**: o PDF que errou a linha por um palmo tomava o lugar da tela, e o
 * que estava sendo conferido se perdia. Fora dos alvos o cursor mostra que ali
 * não entra, e soltar não faz nada.
 */
export function useSegurarArquivoSolto(): void {
  useEffect(() => {
    function aoPassar(e: globalThis.DragEvent) {
      if (!temArquivo(e.dataTransfer) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    }
    function aoSoltar(e: globalThis.DragEvent) {
      if (temArquivo(e.dataTransfer)) e.preventDefault();
    }
    window.addEventListener('dragover', aoPassar);
    window.addEventListener('drop', aoSoltar);
    return () => {
      window.removeEventListener('dragover', aoPassar);
      window.removeEventListener('drop', aoSoltar);
    };
  }, []);
}
