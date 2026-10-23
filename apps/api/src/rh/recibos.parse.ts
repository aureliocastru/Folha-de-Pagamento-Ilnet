/**
 * A leitura do PDF de recibos de pagamento que a contabilidade manda todo mês.
 *
 * É um arquivo só com a folha inteira: uma página por empregado, sempre no
 * mesmo desenho — competência, empregador, matrícula, nome, CPF, as verbas e o
 * líquido. Guardar isso como um documento único obrigaria a abrir 23 páginas
 * para achar a do Fulano, e é exatamente a pergunta que a pasta de RH existe
 * para responder.
 *
 * O que se lê aqui é o cabeçalho de cada página — quem é o dono daquele
 * recibo — e o líquido. As verbas não: a folha desta casa é calculada em outro
 * lugar. O líquido é o "A receber na folha" de quem tem carteira assinada, que
 * era digitado à mão a partir deste papel todo mês (pedido de 23/10/2026).
 *
 * A âncora é o rótulo impresso ("Empregado", "Competência"), e não a posição na
 * página: a extração de texto embaralha colunas, e é por isso que o CPF aparece
 * *antes* do "CPF:" que o nomeia. Rótulo é o que sobrevive a isso.
 */

/** O dono de uma página do PDF. */
export interface ReciboLido {
  /** Páginas deste recibo, 1-based e em ordem. */
  paginas: number[];
  /** A matrícula na contabilidade ("000081"). */
  matricula: string;
  nome: string;
  /** Só os dígitos, ou vazio quando a página não trouxe. */
  cpf: string;
  cargo: string | null;
  /** O "Líquido a Receber", em reais. Null = o recibo não o trouxe legível. */
  liquido: number | null;
}

/** O que o arquivo inteiro diz. */
export interface LeituraDosRecibos {
  /** "AAAA-MM" — a competência impressa. Null = não achei em página nenhuma. */
  competencia: string | null;
  /** Como ela está escrita no papel ("Julho de 2026"), para a tela repetir. */
  competenciaEscrita: string | null;
  recibos: ReciboLido[];
  /** Páginas que não deram para reconhecer, para ninguém achar que sumiram. */
  paginasSemDono: number[];
}

const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/**
 * O texto de cada página, na ordem, vira a lista de recibos.
 *
 * Páginas seguidas do mesmo empregado são o mesmo recibo: um mês com muitas
 * verbas transborda para a página de baixo, e separá-las daria dois documentos
 * pela metade na pasta de uma pessoa só.
 */
export function lerRecibos(paginas: string[]): LeituraDosRecibos {
  const recibos: ReciboLido[] = [];
  const paginasSemDono: number[] = [];
  let competenciaEscrita: string | null = null;

  paginas.forEach((texto, i) => {
    const pagina = i + 1;
    const limpo = texto.replace(/\s+/g, ' ');

    competenciaEscrita ??= lerCompetenciaEscrita(limpo);

    const dono = /Empregado\s+(\d{3,10})\s+([^\d]{3,80}?)\s+Banco\b/.exec(limpo);
    if (!dono) {
      paginasSemDono.push(pagina);
      return;
    }

    const matricula = dono[1];
    const liquido = lerLiquido(limpo);
    const anterior = recibos[recibos.length - 1];
    if (anterior?.matricula === matricula) {
      anterior.paginas.push(pagina);
      // No recibo que transborda, o líquido sai na página do fim.
      anterior.liquido = liquido ?? anterior.liquido;
      return;
    }

    recibos.push({
      paginas: [pagina],
      matricula,
      nome: arrumarNome(dono[2]),
      cpf: (/(\d{3}\.\d{3}\.\d{3}-\d{2})/.exec(limpo)?.[1] ?? '').replace(
        /\D/g,
        '',
      ),
      cargo: /Cargo\s+(.{3,60}?)\s+Empregado\b/.exec(limpo)?.[1].trim() ?? null,
      liquido,
    });
  });

  return {
    competencia: competenciaEscrita ? paraAaaaMm(competenciaEscrita) : null,
    competenciaEscrita,
    recibos,
    paginasSemDono,
  };
}

/** O "Líquido a Receber 1.874,13" da página, em reais. Null = não está nela. */
export function lerLiquido(texto: string): number | null {
  const m = /L[íi]quido\s+a\s+Receber\s+(\d{1,3}(?:\.\d{3})*,\d{2})\b/i.exec(texto);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null;
}

/** "Julho de 2026", como está impresso. */
function lerCompetenciaEscrita(texto: string): string | null {
  const m = /Compet[êe]ncia\s+([A-Za-zÇç]{4,10}\s+de\s+\d{4})/.exec(texto);
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

/** "Julho de 2026" → "2026-07". */
export function paraAaaaMm(escrita: string): string | null {
  const m = /^([A-Za-zÇç]+)\s+de\s+(\d{4})$/.exec(escrita.trim());
  if (!m) return null;
  const mes = MESES[semAcento(m[1]).toLowerCase()];
  if (!mes) return null;
  return `${m[2]}-${String(mes).padStart(2, '0')}`;
}

/**
 * O nome como se escreve, e não como o carimbo o imprime.
 *
 * A contabilidade manda tudo em maiúsculas ("ADAILTON VIEIRA PEREIRA"), e nome
 * em caixa alta numa lista de pastas é ruído — some a diferença entre o nome e
 * o resto da interface. As partículas ficam minúsculas, como se escreve.
 */
export function arrumarNome(bruto: string): string {
  const particulas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  return bruto
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((parte, i) =>
      i > 0 && particulas.has(parte)
        ? parte
        : parte.charAt(0).toLocaleUpperCase('pt-BR') + parte.slice(1),
    )
    .join(' ');
}

/** Sem acento e sem o que não é letra: é assim que dois nomes se comparam. */
export function chaveDoNome(nome: string): string {
  return semAcento(nome).toLowerCase().replace(/[^a-z ]/g, '').trim();
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '');
}
