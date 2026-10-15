/**
 * Trava a rolagem da página atrás de uma janela, da foto ampliada, da gaveta
 * do celular — e devolve quem destrava.
 *
 * A trava fica no `html`, e não no `body`. O `html` tem `overflow-x: clip`
 * (a página nunca rola para o lado), e com isso o navegador deixa de passar o
 * `overflow` do `body` para a tela: o `overflow: hidden` posto no `body` não
 * travava nada, e a barra de rolagem do fundo continuava viva com a janela
 * aberta (15/10/2026).
 *
 * É um contador, porque uma janela abre outra (a ficha do veículo, e por cima
 * dela o lançamento da conta): fechar a de cima não pode soltar o fundo
 * enquanto a de baixo continua aberta.
 */
let travas = 0;
let overflowAnterior = '';
let calhaAnterior = '';

export function travarRolagem(): () => void {
  const html = document.documentElement;
  if (travas === 0) {
    overflowAnterior = html.style.overflow;
    calhaAnterior = html.style.scrollbarGutter;
    // Sem a barra, a página alargaria e tudo pularia para o lado: a calha
    // guarda o lugar dela — só quando havia barra, senão o pulo é o inverso.
    if (html.scrollHeight > html.clientHeight) html.style.scrollbarGutter = 'stable';
    html.style.overflow = 'hidden';
  }
  travas += 1;

  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    travas -= 1;
    if (travas === 0) {
      html.style.overflow = overflowAnterior;
      html.style.scrollbarGutter = calhaAnterior;
    }
  };
}
