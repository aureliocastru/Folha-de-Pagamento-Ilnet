import { ZipFile } from 'yazl';

/**
 * A planilha do Excel (.xlsx) que cada relatório vira.
 *
 * Escrita à mão, sem biblioteca: um .xlsx é um zip de meia dúzia de XMLs, e o
 * que estes relatórios precisam dele é pouco — abas, cabeçalho em negrito,
 * dinheiro como número (para a contabilidade somar e filtrar no Excel dela),
 * data como data. O `yazl` que embrulha o zip já está aqui para a pasta do RH.
 *
 * Dinheiro e data vão como número de verdade, com o formato por cima. Texto
 * "R$ 1.234,56" numa célula é o que a contabilidade teria de redigitar para
 * conferir uma soma — e conferir é o motivo de pedirem planilha.
 */

export type TipoDeColuna = 'texto' | 'moeda' | 'data' | 'numero' | 'inteiro';

export interface Coluna {
  titulo: string;
  tipo: TipoDeColuna;
  /** Em caracteres, como o Excel conta. Ausente = pelo tipo. */
  largura?: number;
}

/** Uma célula: o tipo dela vem da coluna. Data aceita `Date` ou "AAAA-MM-DD". */
export type Valor = string | number | Date | null | undefined;

export interface Aba {
  nome: string;
  /**
   * As linhas de cima, antes da tabela: o que é, de quando, de onde veio. A
   * primeira sai em negrito.
   */
  cabecalho?: string[];
  colunas: Coluna[];
  linhas: Valor[][];
  /** A linha de totais, em negrito, debaixo da tabela. */
  totais?: Valor[];
}

const LARGURA_PADRAO: Record<TipoDeColuna, number> = {
  texto: 30,
  moeda: 15,
  data: 12,
  numero: 12,
  inteiro: 10,
};

/*
 * Os estilos, pela posição em `cellXfs` do styles.xml abaixo. A ordem lá e
 * aqui tem de ser a mesma — é por índice que a célula aponta para o estilo.
 */
const ESTILO = {
  normal: 0,
  negrito: 1,
  moeda: 2,
  data: 3,
  moedaNegrito: 4,
  numero: 5,
  numeroNegrito: 6,
  cabecalhoDaTabela: 7,
} as const;

/** Monta o .xlsx inteiro na memória. */
export function montarPlanilha(abas: Aba[]): Promise<Buffer> {
  if (abas.length === 0) throw new Error('Planilha sem nenhuma aba.');
  const nomes = nomesDasAbas(abas.map((a) => a.nome));

  const zip = new ZipFile();
  const xml = (caminho: string, conteudo: string) =>
    zip.addBuffer(Buffer.from(conteudo, 'utf8'), caminho);

  xml('[Content_Types].xml', tiposDeConteudo(abas.length));
  xml('_rels/.rels', RELS_RAIZ);
  xml('xl/workbook.xml', livro(abas, nomes));
  xml('xl/_rels/workbook.xml.rels', relsDoLivro(abas.length));
  xml('xl/styles.xml', ESTILOS);
  abas.forEach((aba, i) => xml(`xl/worksheets/sheet${i + 1}.xml`, folha(aba)));
  zip.end();

  return new Promise((resolve, reject) => {
    const pedacos: Buffer[] = [];
    zip.outputStream.on('data', (p: Buffer) => pedacos.push(p));
    zip.outputStream.on('end', () => resolve(Buffer.concat(pedacos)));
    zip.outputStream.on('error', reject);
  });
}

/**
 * O nome que o Excel aceita para a aba: até 31 caracteres, sem `[]:*?/\`, e
 * sem repetir — duas abas com o mesmo nome fazem o Excel recusar o arquivo
 * inteiro com "conteúdo ilegível".
 */
export function nomesDasAbas(pedidos: string[]): string[] {
  const usados = new Set<string>();
  return pedidos.map((pedido, i) => {
    const base = (pedido.replace(/[[\]:*?/\\]/g, '-').trim() || `Aba ${i + 1}`).slice(0, 31);
    let nome = base;
    for (let n = 2; usados.has(nome.toLowerCase()); n++) {
      const sufixo = ` (${n})`;
      nome = base.slice(0, 31 - sufixo.length) + sufixo;
    }
    usados.add(nome.toLowerCase());
    return nome;
  });
}

/** Texto que pode ir dentro do XML: escapado e sem caractere de controle. */
export function escaparXml(texto: string): string {
  return texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "A", "B", …, "Z", "AA" — o nome da coluna pela posição (0 = A). */
export function letraDaColuna(indice: number): string {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/**
 * A data como o Excel a guarda: dias desde 30/12/1899.
 *
 * Pelo dia do calendário, e não pelo instante: "2026-09-30" é 30/09 em
 * qualquer fuso, e é esse o dia que tem de aparecer na célula.
 */
export function serialDoExcel(valor: Date | string): number | null {
  let ano: number;
  let mes: number;
  let dia: number;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    ano = valor.getUTCFullYear();
    mes = valor.getUTCMonth() + 1;
    dia = valor.getUTCDate();
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
    if (!m) return null;
    [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return (Date.UTC(ano, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function folha(aba: Aba): string {
  const linhasXml: string[] = [];
  let r = 0;

  for (const [i, texto] of (aba.cabecalho ?? []).entries()) {
    r += 1;
    linhasXml.push(
      `<row r="${r}">${celulaDeTexto(`A${r}`, texto, i === 0 ? ESTILO.negrito : ESTILO.normal)}</row>`,
    );
  }
  // Uma linha em branco separa o que é título do que é tabela.
  if (aba.cabecalho?.length) r += 1;

  r += 1;
  const linhaDosTitulos = r;
  linhasXml.push(
    `<row r="${r}">` +
      aba.colunas
        .map((c, i) =>
          celulaDeTexto(`${letraDaColuna(i)}${r}`, c.titulo, ESTILO.cabecalhoDaTabela),
        )
        .join('') +
      '</row>',
  );

  for (const linha of aba.linhas) {
    r += 1;
    linhasXml.push(`<row r="${r}">${celulas(aba.colunas, linha, r, false)}</row>`);
  }
  const ultimaDosDados = r;

  if (aba.totais) {
    r += 1;
    linhasXml.push(`<row r="${r}">${celulas(aba.colunas, aba.totais, r, true)}</row>`);
  }

  const ultimaColuna = letraDaColuna(Math.max(0, aba.colunas.length - 1));
  const larguras = aba.colunas
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? LARGURA_PADRAO[c.tipo]}" customWidth="1"/>`,
    )
    .join('');

  // Os títulos da tabela ficam parados ao rolar, e o filtro vem ligado: é com
  // ele que a contabilidade acha um cliente numa lista de três mil.
  const congelar = `<pane ySplit="${linhaDosTitulos}" topLeftCell="A${linhaDosTitulos + 1}" activePane="bottomLeft" state="frozen"/>`;
  const filtro =
    aba.linhas.length > 0
      ? `<autoFilter ref="A${linhaDosTitulos}:${ultimaColuna}${ultimaDosDados}"/>`
      : '';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetViews><sheetView workbookViewId="0">${congelar}</sheetView></sheetViews>` +
    `<cols>${larguras}</cols>` +
    `<sheetData>${linhasXml.join('')}</sheetData>` +
    filtro +
    '</worksheet>'
  );
}

function celulas(colunas: Coluna[], valores: Valor[], r: number, negrito: boolean): string {
  return colunas
    .map((coluna, i) => {
      const ref = `${letraDaColuna(i)}${r}`;
      const valor = valores[i];
      if (valor === null || valor === undefined || valor === '') return '';

      if (coluna.tipo === 'data') {
        const serial =
          valor instanceof Date || typeof valor === 'string' ? serialDoExcel(valor) : null;
        // Data que não se lê vai como texto: melhor a célula dizer o que veio
        // do que ficar vazia e a linha parecer sem data.
        if (serial === null) return celulaDeTexto(ref, String(valor), ESTILO.normal);
        return `<c r="${ref}" s="${ESTILO.data}"><v>${serial}</v></c>`;
      }

      if (coluna.tipo === 'moeda' || coluna.tipo === 'numero' || coluna.tipo === 'inteiro') {
        if (typeof valor !== 'number') {
          return celulaDeTexto(ref, String(valor), negrito ? ESTILO.negrito : ESTILO.normal);
        }
        if (!Number.isFinite(valor)) return '';
        const estilo =
          coluna.tipo === 'moeda'
            ? negrito
              ? ESTILO.moedaNegrito
              : ESTILO.moeda
            : negrito
              ? ESTILO.numeroNegrito
              : ESTILO.numero;
        const numero =
          coluna.tipo === 'moeda'
            ? Math.round(valor * 100) / 100
            : Math.round(valor * 1000) / 1000;
        return `<c r="${ref}" s="${estilo}"><v>${numero}</v></c>`;
      }

      const texto = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor);
      return celulaDeTexto(ref, texto, negrito ? ESTILO.negrito : ESTILO.normal);
    })
    .join('');
}

function celulaDeTexto(ref: string, texto: string, estilo: number): string {
  // Célula de texto tem teto de 32.767 caracteres no Excel; acima disso ele
  // recusa o arquivo inteiro.
  const cortado = texto.length > 32_000 ? `${texto.slice(0, 32_000)}…` : texto;
  return (
    `<c r="${ref}" t="inlineStr" s="${estilo}">` +
    `<is><t xml:space="preserve">${escaparXml(cortado)}</t></is></c>`
  );
}

function tiposDeConteudo(quantasAbas: number): string {
  const abas = Array.from(
    { length: quantasAbas },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
  ).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    abas +
    '</Types>'
  );
}

const RELS_RAIZ =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="xl/workbook.xml"/>' +
  '</Relationships>';

function livro(abas: Aba[], nomes: string[]): string {
  const folhas = nomes
    .map((nome, i) => `<sheet name="${escaparXml(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');

  /*
   * O filtro de cada aba precisa do nome definido dele. Sem isto o Excel abre
   * o arquivo, mas o LibreOffice (e o Excel antigo de alguns escritórios)
   * mostra a seta do filtro sem filtrar nada.
   */
  const definidos = abas
    .map((aba, i) => {
      if (aba.linhas.length === 0) return '';
      const linhaDosTitulos = (aba.cabecalho?.length ? aba.cabecalho.length + 1 : 0) + 1;
      const ultima = linhaDosTitulos + aba.linhas.length;
      const ultimaColuna = letraDaColuna(Math.max(0, aba.colunas.length - 1));
      const nome = nomes[i].replace(/'/g, "''");
      return (
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">` +
        `${escaparXml(`'${nome}'`)}!$A$${linhaDosTitulos}:$${ultimaColuna}$${ultima}` +
        '</definedName>'
      );
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${folhas}</sheets>` +
    (definidos ? `<definedNames>${definidos}</definedNames>` : '') +
    '</workbook>'
  );
}

function relsDoLivro(quantasAbas: number): string {
  const abas = Array.from(
    { length: quantasAbas },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" ` +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      `Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    abas +
    `<Relationship Id="rId${quantasAbas + 1}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
    'Target="styles.xml"/>' +
    '</Relationships>'
  );
}

/*
 * Formatos: 164 é o dinheiro ("R$ 1.234,56" no Excel em português — o separador
 * quem põe é o Excel de quem abre) e 165 a data em dia/mês/ano. Quantidade vai
 * no Geral: um formato de "até três casas" escreve "4," no inteiro, e o cabo
 * em metros já chega arredondado no milésimo.
 *
 * A ordem de `cellXfs` é a do objeto `ESTILO` lá em cima.
 */
const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
  '</numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="8">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';
