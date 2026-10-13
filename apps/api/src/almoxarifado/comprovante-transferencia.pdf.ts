/**
 * O comprovante da transferência entre almoxarifados.
 *
 * É o papel que acompanha a caixa — impresso, ou mandado pelo WhatsApp para
 * quem vai receber — e responde, do outro lado, "o que era para ter vindo?".
 * Por isso o equipamento sai peça por peça, com tombo, MAC e série: é com
 * eles que se confere a etiqueta de cada ONU na mão.
 *
 * Sai do andamento que o servidor guardou ao gravar no IXC. Só o que o IXC
 * aceitou entra como enviado; o que ele recusou vem à parte, para ninguém
 * procurar na caixa o que ficou na prateleira.
 */

import * as fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { LOGO } from '../apr/apr.pdf';

/** A peça de patrimônio — o que está na etiqueta dela. */
export interface PecaDoComprovante {
  patrimonioId: number;
  /** O tombo: `patrimonio.serial`, o "Número do patrimônio" da tela do IXC. */
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
}

/** Um item da transferência, do jeito que o comprovante precisa. */
export interface ItemDoComprovante {
  produtoId: number;
  descricao: string;
  /** Do produto, a quantidade levada; da peça, 1. */
  quantidade: number;
  unidade: string;
  /** Só no equipamento (patrimônio). */
  peca: PecaDoComprovante | null;
}

export interface DadosDoComprovante {
  empresaNome: string;
  empresaCnpj: string | null;
  /** O número da transferência no IXC. */
  transferenciaId: number;
  de: string;
  para: string;
  /** Quem fez, pelo login do sistema. */
  por: string;
  /** A hora em que foi gravada no IXC. */
  feitaEm: Date;
  /** O dia dela no IXC, "AAAA-MM-DD" — é de antes do `feitaEm` quando é retroativa. */
  data: string;
  observacao: string | null;
  enviados: ItemDoComprovante[];
  /** `talvezTenhaIdo`: o IXC deu erro, mas a origem relida já não tinha o item. */
  recusados: Array<ItemDoComprovante & { talvezTenhaIdo: boolean }>;
  /** O motivo, quando a transferência parou no meio. */
  parouNoMeio: string | null;
}

const MARGEM = 38;
const TINTA = '#0f172a';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';
const MARCA = '#0a72c4';
const FAIXA = '#eef4fb';
const ZEBRA = '#f8fafc';
const ALERTA = '#b91c1c';

export function gerarComprovantePdf(d: DadosDoComprovante): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM + 18, left: MARGEM, right: MARGEM },
    // Para numerar as páginas no fim, quando já se sabe quantas são.
    bufferPages: true,
    info: {
      Title: `Transferência nº ${d.transferenciaId} — ${d.de} para ${d.para}`,
      Author: d.empresaNome,
      Subject: 'Comprovante de transferência entre almoxarifados',
    },
  });

  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  desenhar(doc, d);
  numerarPaginas(doc, d);
  doc.end();
  return pronto;
}

function desenhar(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  timbre(doc, d);
  if (d.parouNoMeio) {
    tarja(
      doc,
      `A transferência parou no meio (${d.parouNoMeio}). Abaixo, só o que o IXC gravou.`,
    );
  }
  rota(doc, d);
  ficha(doc, d);

  const equipamentos = ordenar(d.enviados.filter((i) => i.peca));
  const material = ordenar(d.enviados.filter((i) => !i.peca));

  if (equipamentos.length > 0) {
    tituloDaSecao(doc, `Equipamentos (${equipamentos.length})`);
    tabela(
      doc,
      [
        { titulo: 'Nº', largura: 24, alinhar: 'right' },
        { titulo: 'Equipamento', largura: 214 },
        { titulo: 'Tombo', largura: 66, codigo: true },
        { titulo: 'MAC', largura: 97, codigo: true },
        { titulo: 'Nº de série', largura: 118, codigo: true },
      ],
      equipamentos.map((i, n) => [
        String(n + 1),
        i.descricao,
        i.peca?.numeroPatrimonial ?? '',
        i.peca?.mac ?? '',
        i.peca?.numeroSerie ?? '',
      ]),
    );
  }

  if (material.length > 0) {
    tituloDaSecao(doc, `Material (${material.length})`);
    tabela(
      doc,
      [
        { titulo: 'Nº', largura: 24, alinhar: 'right' },
        { titulo: 'Material', largura: 333 },
        { titulo: 'Cód. IXC', largura: 62, alinhar: 'right' },
        { titulo: 'Quantidade', largura: 100, alinhar: 'right' },
      ],
      material.map((i, n) => [
        String(n + 1),
        i.descricao,
        String(i.produtoId),
        `${quantidade(i.quantidade)} ${i.unidade}`.trim(),
      ]),
    );
  }

  if (d.recusados.length > 0) {
    tituloDaSecao(doc, `Não foram — o IXC recusou (${d.recusados.length})`, ALERTA);
    tabela(
      doc,
      [
        { titulo: 'Nº', largura: 24, alinhar: 'right' },
        { titulo: 'Item', largura: 235 },
        { titulo: 'Tombo / MAC / série ou quantidade', largura: 260 },
      ],
      ordenar(d.recusados).map((i, n) => [
        String(n + 1),
        i.talvezTenhaIdo
          ? `${i.descricao} — pode ter ido: confira a transferência no IXC`
          : i.descricao,
        i.peca ? etiqueta(i.peca) : `${quantidade(i.quantidade)} ${i.unidade}`.trim(),
      ]),
    );
  }

  assinaturas(doc, d);
}

// --- O alto da folha --------------------------------------------------------

function timbre(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  const largura = doc.page.width - MARGEM * 2;
  const larguraNumero = 130;
  const x = MARGEM + 96;
  const larguraTexto = largura - 96 - larguraNumero - 8;

  // A logo pode faltar num ambiente mal montado, e o comprovante sem timbre
  // continua valendo mais que um comprovante que não sai.
  if (fs.existsSync(LOGO)) {
    doc.image(LOGO, MARGEM, MARGEM - 4, { fit: [82, 50] });
  }

  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(d.empresaNome.toUpperCase(), x, MARGEM, { width: larguraTexto });
  if (d.empresaCnpj) {
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(8)
      .text(`CNPJ ${d.empresaCnpj}`, x, doc.y + 1, { width: larguraTexto });
  }
  doc
    .fillColor(MARCA)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('COMPROVANTE DE TRANSFERÊNCIA ENTRE ALMOXARIFADOS', x, doc.y + 4, {
      width: larguraTexto,
    });
  const baixoDoTexto = doc.y;

  // O número, à direita: é por ele que se acha a transferência no IXC.
  const xNumero = MARGEM + largura - larguraNumero;
  doc
    .fillColor(TINTA_FRACA)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('TRANSFERÊNCIA NO IXC', xNumero, MARGEM, {
      width: larguraNumero,
      align: 'right',
      characterSpacing: 0.5,
    });
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(`nº ${d.transferenciaId}`, xNumero, doc.y + 2, {
      width: larguraNumero,
      align: 'right',
    });

  const baixo = Math.max(baixoDoTexto, doc.y, MARGEM + 48) + 8;
  doc
    .moveTo(MARGEM, baixo)
    .lineTo(MARGEM + largura, baixo)
    .lineWidth(1.2)
    .strokeColor(MARCA)
    .stroke();
  doc.y = baixo + 12;
}

function tarja(doc: PDFKit.PDFDocument, texto: string): void {
  const largura = doc.page.width - MARGEM * 2;
  const altura =
    doc.font('Helvetica-Bold').fontSize(9).heightOfString(texto, { width: largura - 16 }) + 14;
  const topo = doc.y;
  doc.rect(MARGEM, topo, largura, altura).fillColor('#fee2e2').fill();
  doc.fillColor(ALERTA).text(texto, MARGEM + 8, topo + 7, { width: largura - 16 });
  doc.y = topo + altura + 10;
}

/**
 * De onde sai e para onde vai, grandes, lado a lado — é a primeira coisa que
 * quem recebe procura no papel.
 */
function rota(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  const largura = doc.page.width - MARGEM * 2;
  const vao = 36;
  const caixa = (largura - vao) / 2;
  doc.font('Helvetica-Bold').fontSize(13);
  const altura =
    Math.max(
      doc.heightOfString(d.de, { width: caixa - 20 }),
      doc.heightOfString(d.para, { width: caixa - 20 }),
    ) + 30;
  const topo = doc.y;

  ponta(doc, 'SAI DE', d.de, MARGEM, topo, caixa, altura, false);
  ponta(doc, 'VAI PARA', d.para, MARGEM + caixa + vao, topo, caixa, altura, true);

  // A seta é desenhada: a "→" não existe nas fontes embutidas do pdfkit.
  const meio = topo + altura / 2;
  const x0 = MARGEM + caixa + 9;
  const x1 = MARGEM + caixa + vao - 9;
  doc
    .moveTo(x0, meio)
    .lineTo(x1, meio)
    .moveTo(x1 - 6, meio - 5)
    .lineTo(x1, meio)
    .lineTo(x1 - 6, meio + 5)
    .lineWidth(1.8)
    .strokeColor(MARCA)
    .stroke();

  doc.y = topo + altura + 12;
}

function ponta(
  doc: PDFKit.PDFDocument,
  rotulo: string,
  nome: string,
  x: number,
  y: number,
  largura: number,
  altura: number,
  destino: boolean,
): void {
  doc
    .roundedRect(x, y, largura, altura, 5)
    .lineWidth(destino ? 1.4 : 0.8)
    .fillAndStroke(destino ? FAIXA : ZEBRA, destino ? MARCA : LINHA);
  doc
    .fillColor(destino ? MARCA : TINTA_FRACA)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(rotulo, x + 10, y + 8, { width: largura - 20, characterSpacing: 0.6 });
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(nome, x + 10, y + 19, { width: largura - 20 });
}

/** Quando, quem, quanto — rótulo à esquerda, valor à direita. */
function ficha(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  const equipamentos = d.enviados.filter((i) => i.peca).length;
  const material = d.enviados.length - equipamentos;
  const linhas: Array<[string, string]> = [['Enviado em', dataHora(d.feitaEm)]];
  if (d.data < diaEmBrasilia(d.feitaEm)) {
    linhas.push(['Data no IXC', `${dia(d.data)} (retroativa)`]);
  }
  linhas.push(['Enviado por', d.por]);
  linhas.push([
    'Itens enviados',
    [
      String(d.enviados.length),
      [
        equipamentos > 0 && plural(equipamentos, 'equipamento', 'equipamentos'),
        material > 0 && plural(material, 'material', 'materiais'),
      ]
        .filter(Boolean)
        .join(' e '),
    ].join(' — '),
  ]);
  if (d.observacao) linhas.push(['Observação', d.observacao]);

  const largura = doc.page.width - MARGEM * 2;
  const larguraRotulo = 110;
  linhas.forEach(([rotulo, valor], indice) => {
    const alturaValor = doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .heightOfString(valor, { width: largura - larguraRotulo - 8 });
    const altura = Math.max(alturaValor, 12) + 7;
    const topo = doc.y;
    if (indice % 2 === 0) doc.rect(MARGEM, topo, largura, altura).fillColor(ZEBRA).fill();
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(8.5)
      .text(rotulo, MARGEM + 6, topo + 4, { width: larguraRotulo - 10 });
    doc
      .fillColor(TINTA)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(valor, MARGEM + larguraRotulo, topo + 3.5, { width: largura - larguraRotulo - 8 });
    doc.y = topo + altura;
  });
  doc.y += 12;
}

// --- As listas --------------------------------------------------------------

function tituloDaSecao(doc: PDFKit.PDFDocument, titulo: string, cor = MARCA): void {
  // O título não fica sozinho no pé da folha: ele e a primeira linha juntos.
  garantirEspaco(doc, 60);
  const largura = doc.page.width - MARGEM * 2;
  const topo = doc.y;
  doc.rect(MARGEM, topo, largura, 16).fillColor(FAIXA).fill();
  doc.rect(MARGEM, topo, 2.5, 16).fillColor(cor).fill();
  doc
    .fillColor(cor)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(titulo.toUpperCase(), MARGEM + 8, topo + 5, {
      width: largura - 16,
      characterSpacing: 0.6,
    });
  doc.y = topo + 20;
}

interface Coluna {
  titulo: string;
  largura: number;
  alinhar?: 'left' | 'right';
  /** Tombo, MAC e série em letra de máquina: 0 e O, 1 e I não se confundem na conferência. */
  codigo?: boolean;
}

/**
 * Uma tabela que quebra página sozinha e repete o cabeçalho na folha nova —
 * quarenta ONUs passam de uma página, e a segunda sem nome nas colunas é uma
 * lista de códigos soltos.
 */
function tabela(doc: PDFKit.PDFDocument, colunas: Coluna[], linhas: string[][]): void {
  const largura = doc.page.width - MARGEM * 2;
  const limite = () => doc.page.height - doc.page.margins.bottom;
  const fonte = (c: Coluna) =>
    doc.font(c.codigo ? 'Courier' : 'Helvetica').fontSize(8.5);

  const cabecalho = () => {
    const topo = doc.y;
    let x = MARGEM;
    for (const c of colunas) {
      doc
        .fillColor(TINTA_FRACA)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(c.titulo.toUpperCase(), x + 4, topo + 2, {
          width: c.largura - 8,
          align: c.alinhar ?? 'left',
          lineBreak: false,
          characterSpacing: 0.4,
        });
      x += c.largura;
    }
    doc
      .moveTo(MARGEM, topo + 13)
      .lineTo(MARGEM + largura, topo + 13)
      .lineWidth(0.8)
      .strokeColor(LINHA)
      .stroke();
    doc.y = topo + 15;
  };

  cabecalho();
  linhas.forEach((linha, indice) => {
    const altura =
      Math.max(
        10,
        ...linha.map((v, j) =>
          fonte(colunas[j]).heightOfString(v || '—', { width: colunas[j].largura - 8 }),
        ),
      ) + 7;
    if (doc.y + altura > limite()) {
      doc.addPage();
      cabecalho();
    }
    const topo = doc.y;
    if (indice % 2 === 1) doc.rect(MARGEM, topo, largura, altura).fillColor(ZEBRA).fill();
    let x = MARGEM;
    linha.forEach((v, j) => {
      const c = colunas[j];
      fonte(c)
        .fillColor(v ? TINTA : LINHA)
        .text(v || '—', x + 4, topo + 3.5, { width: c.largura - 8, align: c.alinhar ?? 'left' });
      x += c.largura;
    });
    doc
      .moveTo(MARGEM, topo + altura)
      .lineTo(MARGEM + largura, topo + altura)
      .lineWidth(0.3)
      .strokeColor(LINHA)
      .stroke();
    doc.y = topo + altura;
  });
  doc.y += 14;
}

/** Quem entregou assina, quem recebeu assina — para o papel que vai na caixa. */
function assinaturas(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  garantirEspaco(doc, 76);
  const largura = doc.page.width - MARGEM * 2;
  const vao = 40;
  const cada = (largura - vao) / 2;
  const y = doc.y + 34;

  const lados: Array<[string, string]> = [
    [d.por, 'Enviado por'],
    ['', 'Recebido por — nome e data'],
  ];
  lados.forEach(([nome, rotulo], i) => {
    const x = MARGEM + i * (cada + vao);
    doc
      .moveTo(x, y)
      .lineTo(x + cada, y)
      .lineWidth(0.8)
      .strokeColor(TINTA)
      .stroke();
    if (nome) {
      doc
        .fillColor(TINTA)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(nome, x, y + 5, { width: cada, align: 'center' });
    }
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(7.5)
      .text(rotulo, x, y + (nome ? 18 : 5), { width: cada, align: 'center' });
  });
  doc.y = y + 32;
}

/**
 * O rodapé de cada página, escrito no fim, quando já se sabe quantas são.
 * A margem de baixo é zerada antes de escrever, pelo mesmo motivo da APR:
 * texto abaixo dela faz o pdfkit abrir folha nova (ver `apr.pdf.ts`).
 */
function numerarPaginas(doc: PDFKit.PDFDocument, d: DadosDoComprovante): void {
  const faixa = doc.bufferedPageRange();
  for (let i = 0; i < faixa.count; i++) {
    doc.switchToPage(faixa.start + i);
    doc.page.margins.bottom = 0;

    const y = doc.page.height - MARGEM - 4;
    doc
      .moveTo(MARGEM, y - 6)
      .lineTo(doc.page.width - MARGEM, y - 6)
      .lineWidth(0.4)
      .strokeColor(LINHA)
      .stroke();
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(6.5)
      .text(
        `Transferência nº ${d.transferenciaId} · ${d.de} para ${d.para} · ${dataHora(d.feitaEm)}`,
        MARGEM,
        y,
        { width: doc.page.width - MARGEM * 2 - 60, lineBreak: false, ellipsis: true },
      );
    doc.text(`${i + 1} / ${faixa.count}`, doc.page.width - MARGEM - 60, y, {
      width: 60,
      align: 'right',
      lineBreak: false,
    });
  }
}

// --- Miudezas ---------------------------------------------------------------

function garantirEspaco(doc: PDFKit.PDFDocument, altura: number): void {
  if (doc.y + altura > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/** Pelo nome, e dentro do mesmo produto pela etiqueta — a ordem de quem confere a caixa. */
function ordenar<T extends ItemDoComprovante>(itens: T[]): T[] {
  const chave = (i: ItemDoComprovante) =>
    i.peca ? (i.peca.numeroPatrimonial ?? i.peca.mac ?? i.peca.numeroSerie ?? '') : '';
  return [...itens].sort(
    (a, b) =>
      a.descricao.localeCompare(b.descricao, 'pt-BR') ||
      chave(a).localeCompare(chave(b), 'pt-BR', { numeric: true }),
  );
}

/** "tombo 00123 · MAC AA:BB:… · série ZTEG…" — o que a etiqueta da peça tem. */
function etiqueta(p: PecaDoComprovante): string {
  const partes = [
    p.numeroPatrimonial && `tombo ${p.numeroPatrimonial}`,
    p.mac && `MAC ${p.mac}`,
    p.numeroSerie && `série ${p.numeroSerie}`,
  ].filter(Boolean);
  return partes.length > 0 ? partes.join(' · ') : `patrimônio #${p.patrimonioId}`;
}

function quantidade(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
function dia(data: string): string {
  return data.slice(0, 10).split('-').reverse().join('/');
}

/** O dia civil em Brasília, "AAAA-MM-DD" — o container roda em UTC. */
function diaEmBrasilia(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** "13/10/2026 às 14:32", no fuso de casa. */
function dataHora(d: Date): string {
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${data} às ${hora}`;
}
