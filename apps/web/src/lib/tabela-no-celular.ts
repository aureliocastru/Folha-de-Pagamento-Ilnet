import { useEffect } from 'react';
import { LARGURA_CELULAR } from './celular';

/**
 * A tabela vira lista de cartões no celular — e é aqui que cada célula ganha o
 * nome da sua coluna.
 *
 * No celular a tabela deixa de ser tabela (ver "A tabela no celular" no
 * `index.css`): cada linha vira um cartão, com uma linha "Coluna: valor" por
 * dado. O CSS sabe desenhar isso, mas não sabe qual é o nome da coluna de cada
 * célula — isso está no cabeçalho, que no cartão some. Então este vigia lê o
 * cabeçalho e escreve o nome em cada célula (`data-rotulo`), e marca o papel
 * das que não são dado comum (`data-papel`):
 *
 *  - `controle`: só uma caixa de marcar — vai para a quina do cartão;
 *  - `titulo`: a primeira célula de dado, quase sempre o nome — é o título;
 *  - `acoes`: só botões e links — vai para o pé, com os botões inteiros;
 *  - `inteira`: ocupa várias colunas (o "carregando", o grupo, o total) —
 *    vai de ponta a ponta, sem rótulo;
 *  - `vazia`: sem nada dentro — some, em vez de virar um rótulo solto.
 *
 * Um vigia só, na raiz, e não uma mudança em cada uma das cinquenta tabelas: é
 * o que faz tabela nova já nascer certa no celular, sem ninguém lembrar disso.
 * A tabela que precisa continuar tabela (uma grade pequena que cabe) leva a
 * classe `tabela-fixa` e fica de fora.
 */
export function useTabelasNoCelular(): void {
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${LARGURA_CELULAR - 1}px)`);
    let agendado = 0;

    const marcarTudo = () => {
      agendado = 0;
      if (!media.matches) return;
      document.querySelectorAll('table:not(.tabela-fixa)').forEach((t) => {
        marcarTabela(t as HTMLTableElement);
      });
    };
    // Uma passada por rajada, no máximo: uma lista de quinhentas linhas
    // chegando dispara quinhentas mutações, e elas todas cabem em uma leitura.
    // `setTimeout`, e não `requestAnimationFrame`: o quadro não corre com a
    // aba escondida, e a tabela carregada nesse meio-tempo apareceria sem os
    // nomes das colunas até alguém mexer na tela.
    const agendar = () => {
      if (!agendado) agendado = window.setTimeout(marcarTudo, 16);
    };

    const vigia = new MutationObserver(agendar);
    // Só filhos, e não atributos: a marcação aqui escreve atributos, e vigiá-los
    // faria o vigia acordar a si mesmo.
    vigia.observe(document.body, { childList: true, subtree: true, characterData: true });
    media.addEventListener('change', agendar);
    agendar();

    return () => {
      vigia.disconnect();
      media.removeEventListener('change', agendar);
      if (agendado) window.clearTimeout(agendado);
    };
  }, []);
}

function marcarTabela(tabela: HTMLTableElement): void {
  const { rotulos, dicas } = rotulosDoCabecalho(tabela);

  for (const secao of [...Array.from(tabela.tBodies), tabela.tFoot]) {
    if (!secao) continue;
    for (const linha of Array.from(secao.rows)) {
      const celulas = Array.from(linha.cells);
      const papeis = celulas.map(papelDaCelula);
      const colunas: number[] = [];
      let coluna = 0;
      for (const celula of celulas) {
        colunas.push(coluna);
        coluna += celula.colSpan || 1;
      }

      const titulo = escolherTitulo(celulas, papeis, colunas.map((c) => rotulos[c] ?? ''));
      if (titulo >= 0) papeis[titulo] = 'titulo';

      celulas.forEach((celula, i) => {
        escrever(celula, 'data-papel', papeis[i]);
        escrever(celula, 'data-rotulo', papeis[i] === 'dado' ? (rotulos[colunas[i]] ?? '') : '');
        // Célula de várias partes (o nome com a observação e o selo embaixo)
        // ou de texto comprido: o rótulo vai numa linha e o conteúdo na de
        // baixo, na largura toda. Ao lado do rótulo ela ficava espremida numa
        // coluna de três palavras por linha.
        escrever(celula, 'data-forma', papeis[i] === 'dado' && celulaLarga(celula) ? 'bloco' : '');
        escrever(celula, 'data-celular', dicas[colunas[i]] ?? '');
      });
    }
  }
}

/**
 * O nome de cada coluna, pela última linha do cabeçalho (a de cima, quando há
 * duas, agrupa colunas). Uma coluna de `colSpan` 2 empresta o nome às duas.
 */
function rotulosDoCabecalho(tabela: HTMLTableElement): {
  rotulos: string[];
  /**
   * O `data-celular` de cada coluna, quando a tela quer um cartão mais justo
   * do que o de sempre:
   *
   *  - `sem-rotulo`: o dado dispensa o nome da coluna ("03/09/2026 · 7 dias em
   *    atraso" se explica sozinho) e divide a linha com o vizinho;
   *  - `ao-lado`: sobe para a linha do título, na ponta direita — o valor da
   *    conta, que é a segunda coisa que se procura depois do nome.
   */
  dicas: string[];
} {
  const cabeca = tabela.tHead;
  const linha = cabeca?.rows[cabeca.rows.length - 1];
  if (!linha) return { rotulos: [], dicas: [] };
  const rotulos: string[] = [];
  const dicas: string[] = [];
  for (const celula of Array.from(linha.cells)) {
    const texto = (celula.textContent ?? '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < (celula.colSpan || 1); i++) {
      rotulos.push(texto);
      dicas.push(celula.dataset.celular ?? '');
    }
  }
  return { rotulos, dicas };
}

type Papel = 'controle' | 'titulo' | 'acoes' | 'inteira' | 'vazia' | 'dado';

/** Três letras seguidas: é nome, e não número, data ou código. */
const TEM_PALAVRA = /\p{L}{3,}/u;

/** Colunas que nomeiam a linha — as primeiras candidatas a título do cartão. */
const COLUNA_DE_NOME =
  /nome|fornecedor|benefici|funcion|empregado|trabalhador|colaborador|diarista|empresa|cliente|compra|descri|denomina|item|produto|ferramenta|pessoa|usu[aá]rio|t[ií]tulo/i;

/**
 * O título do cartão: a célula que diz de quem ou do que é a linha.
 *
 * Primeiro a coluna com nome de nome ("Fornecedor", "Beneficiário",
 * "Compra"); na falta dela, a primeira célula com palavra que não comece por
 * número. "08/09/2026 · 2 dias em atraso" tem palavra, mas é o vencimento —
 * não é o que se procura de relance numa lista de contas.
 */
function escolherTitulo(
  celulas: HTMLTableCellElement[],
  papeis: Papel[],
  rotulos: string[],
): number {
  const candidata = (i: number) => {
    const texto = (celulas[i].textContent ?? '').trim();
    return papeis[i] === 'dado' && TEM_PALAVRA.test(texto);
  };
  const porNome = celulas.findIndex((_, i) => candidata(i) && COLUNA_DE_NOME.test(rotulos[i]));
  if (porNome >= 0) return porNome;
  const semNumero = celulas.findIndex(
    (c, i) => candidata(i) && !/^[\d(R$-]/.test((c.textContent ?? '').trim()),
  );
  if (semNumero >= 0) return semNumero;
  return celulas.findIndex((_, i) => candidata(i));
}

function celulaLarga(celula: HTMLTableCellElement): boolean {
  if ((celula.textContent ?? '').trim().length > 32) return true;
  // Mais de uma peça dentro — contando a peça embrulhada num `div` só.
  let el: Element = celula;
  while (el.children.length === 1 && el.firstElementChild) el = el.firstElementChild;
  return el.children.length > 1;
}

function papelDaCelula(celula: HTMLTableCellElement): Papel {
  if ((celula.colSpan || 1) > 1) return 'inteira';

  const texto = (celula.textContent ?? '').trim();
  const temCampo = !!celula.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
  const temMarcador = !!celula.querySelector('input[type=checkbox], input[type=radio]');
  const temBotao = !!celula.querySelector('button, a');
  const temAcao = !!celula.querySelector('.btn');
  const temImagem = !!celula.querySelector('img, svg, canvas');

  if (!texto && !temCampo && !temMarcador && !temBotao && !temImagem) return 'vazia';
  // Só um travessão: na tabela ele segura a coluna; no cartão seria uma linha
  // inteira ("Documento —") para dizer que não há nada.
  if (/^[—–-]$/.test(texto) && !temCampo && !temMarcador && !temBotao) return 'vazia';
  if (temMarcador && !texto && !temCampo && !temBotao) return 'controle';

  // Botões de ação (`.btn`), e no máximo uma palavra solta ao lado deles
  // ("aprovada"): é a coluna de ações. O nome que é link ou botão sem cara de
  // botão ("abrir a ficha") continua sendo dado — e costuma ser o título.
  if (temAcao && !temCampo && textoForaDasAcoes(celula).length <= 24) return 'acoes';
  return 'dado';
}

function textoForaDasAcoes(celula: HTMLElement): string {
  const copia = celula.cloneNode(true) as HTMLElement;
  copia.querySelectorAll('.btn').forEach((b) => b.remove());
  return (copia.textContent ?? '').trim();
}

/** Escreve só o que mudou: atributo reescrito à toa é trabalho de pintura à toa. */
function escrever(el: Element, nome: string, valor: string): void {
  if (el.getAttribute(nome) !== valor) el.setAttribute(nome, valor);
}
