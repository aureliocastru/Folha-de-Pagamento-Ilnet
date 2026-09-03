import { useEffect, useRef, useState } from 'react';

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
 * Algum destes campos contém o termo?
 *
 * O termo já vem peneirado por quem chama (uma vez por busca, e não uma vez por
 * linha); os campos são peneirados aqui. Campo vazio não conta.
 */
export function combina(
  campos: Array<string | null | undefined>,
  termo: string,
): boolean {
  if (!termo) return true;
  return campos.some((v) => !!v && semAcento(v).includes(termo));
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
 * Quem filtra em memória não precisa disto: ali a lista já encolhe na tecla,
 * sem custo nenhum.
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
