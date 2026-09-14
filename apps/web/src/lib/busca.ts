import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Como esta casa compara texto digitado com texto guardado.
 *
 * Ninguém digita acento numa caixa de busca. Quem procura o posto escreve "sao
 * domin", e o que está guardado é "Posto São Domingos" — comparando cru, a tela
 * responde "nenhum pagamento aqui" para uma lista cheia deles, que é o pior
 * jeito de uma busca falhar: ela não erra o resultado, ela nega o que existe.
 *
 * Vale para o que é digitado e para o que vem do banco: os dois passam pela
 * mesma peneira antes de se encontrarem.
 *
 * E, no fim do arquivo, o compasso: quando a busca que fala com o servidor
 * pode sair sem virar uma consulta por tecla.
 */

/** Texto como a busca o vê: sem acento e sem caixa. */
export function semAcento(texto: string): string {
  // `\p{M}` é a classe dos acentos que o NFD separou da letra: em ASCII puro,
  // sem depender de como este arquivo foi salvo.
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * O código como o leitor o bipa: sem acento, sem caixa e sem separador.
 *
 * O IXC guarda o MAC como "E0:C2:50:1A:2B:3C" e a etiqueta traz "E0C2501A2B3C";
 * o patrimônio vem "PAT-0012" num lugar e "PAT0012" noutro. Sem os separadores,
 * os dois se encontram.
 */
export function semSeparador(texto: string): string {
  return semAcento(texto).replace(/[^\p{L}\p{N}]/gu, '');
}

type Campo = string | number | null | undefined;

/** Uma linha pronta para a busca — feita uma vez por leitura, e não uma vez por tecla. */
export interface Buscavel {
  texto: string;
  colado: string;
}

export function buscavel(campos: Campo[]): Buscavel {
  const cheios = campos.filter((c) => c !== null && c !== undefined && c !== '').map(String);
  // Um campo por linha: o termo nunca atravessa de um campo para o outro.
  return {
    texto: semAcento(cheios.join('\n')),
    colado: cheios.map(semSeparador).join('\n'),
  };
}

/** O que foi digitado, peneirado uma vez. */
export interface Termo {
  texto: string;
  /**
   * O termo sem separador, quando ele é uma palavra só — é assim que um código
   * chega. Com espaço é nome ("sao domin"), e colar as palavras acharia o que
   * ninguém procurou.
   */
  colado: string | null;
}

export function termoDeBusca(digitado: string): Termo {
  const texto = semAcento(digitado.trim());
  const colado = texto && !/\s/.test(texto) ? semSeparador(texto) : '';
  return { texto, colado: colado || null };
}

export function acha(linha: Buscavel, termo: Termo): boolean {
  if (!termo.texto) return true;
  return linha.texto.includes(termo.texto) || (!!termo.colado && linha.colado.includes(termo.colado));
}

/**
 * Algum destes campos contém o termo?
 *
 * Para lista pequena, que se peneira inteira a cada busca. Lista de milhares
 * guarda o `buscavel` de cada linha — ver `useFiltrados`.
 */
export function combina(campos: Campo[], termo: string): boolean {
  if (!termo) return true;
  return acha(buscavel(campos), termoDeBusca(termo));
}

/**
 * A busca que filtra a tela, sem travar quem digita.
 *
 * O campo acompanha a tecla; a lista vem um passo atrás. O React desenha a
 * lista nova quando sobra tempo, e larga o desenho no meio se chegou outra
 * tecla. Sem isto, o Comodato (14 mil peças) congelava a página por segundos a
 * cada letra — e o leitor de código de barras, que manda doze teclas num
 * piscar, parecia não escrever nada.
 *
 * Só adianta se a lista não se redesenhar junto com a tecla: quem usa monta a
 * lista num `useMemo` que depende do `termo` devolvido aqui, e não do texto do
 * campo.
 *
 * @returns o termo adiado, e se a lista ainda está atrás do campo
 */
export function useBuscaNaTela(digitado: string): { termo: Termo; atualizando: boolean } {
  const adiado = useDeferredValue(digitado);
  const termo = useMemo(() => termoDeBusca(adiado), [adiado]);
  return { termo, atualizando: adiado !== digitado };
}

/**
 * Os itens que casam com o termo.
 *
 * O texto de busca de cada item é montado uma vez por leitura. `campos` tem de
 * ser a mesma função sempre (declarada fora do componente): trocá-la a cada
 * render remontaria tudo a cada tecla.
 */
export function useFiltrados<T>(itens: T[], campos: (item: T) => Campo[], termo: Termo): T[] {
  const indice = useMemo(() => itens.map((i) => buscavel(campos(i))), [itens, campos]);
  return useMemo(
    () => (termo.texto ? itens.filter((_, k) => acha(indice[k], termo)) : itens),
    [itens, indice, termo],
  );
}

/**
 * Quanto tempo esperar antes de consultar o servidor, em ms.
 *
 * 400 é o que esta casa já usava nas buscas ao IXC: curto o bastante para
 * parecer imediato, longo o bastante para uma palavra digitada de corrida
 * virar uma consulta só.
 */
const ESPERA_DA_BUSCA = 400;

/**
 * O termo depois que quem digita para de digitar.
 *
 * Toda busca desta casa é ao vivo — ninguém aperta Enter para ver a lista
 * encolher. Mas a que fala com o servidor não pode sair a cada tecla:
 * "matheus" seriam sete consultas, seis delas jogadas fora, e a resposta da
 * quarta chegando depois da sétima deixaria a tela mostrando o resultado de
 * "math". Então o valor devolvido só acompanha o campo quando ele fica quieto.
 *
 * Quem filtra em memória não precisa disto: ali a lista encolhe na tecla —
 * e, sendo grande, com `useBuscaNaTela`.
 *
 * @param termo o que está digitado agora
 * @param aoMudar roda quando o termo muda de verdade — é onde a paginação
 *   volta para a primeira página, e onde a seleção em massa se desfaz
 */
export function useTermoAdiado(termo: string, aoMudar?: () => void): string {
  const [adiado, setAdiado] = useState(() => termo.trim());

  // O callback entra por ref para não reiniciar a espera a cada render de quem
  // chama: uma função nova a cada render zeraria o relógio para sempre, e a
  // busca nunca sairia.
  const callback = useRef(aoMudar);
  callback.current = aoMudar;

  // O último valor entregue, para saber se houve mudança sem depender do
  // estado dentro do relógio — e para o aviso sair **fora** do updater, que
  // tem de ser puro: em StrictMode o React o chama duas vezes, e um efeito
  // colateral ali aconteceria em dobro.
  const entregue = useRef(adiado);

  useEffect(() => {
    const id = setTimeout(() => {
      const agora = termo.trim();
      if (entregue.current === agora) return;
      entregue.current = agora;
      setAdiado(agora);
      callback.current?.();
    }, ESPERA_DA_BUSCA);
    return () => clearTimeout(id);
  }, [termo]);

  return adiado;
}
