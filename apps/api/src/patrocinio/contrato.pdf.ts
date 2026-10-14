/**
 * O contrato de patrocínio em papel, depois de assinado pelo link.
 *
 * Tudo que sai impresso vem do retrato congelado em `contratos_de_patrocinio`,
 * não do cadastro de hoje — e o texto também: é o que a pessoa leu na tela
 * antes de assinar. Reimprimir o contrato de março tem de dar o papel de março.
 */

import { ModoAssinatura } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { formatValorBR } from '../financeiro/folha.calc';
import { blocosDoContrato } from './contrato.texto';

export interface DadosDoContrato {
  /** Código do contrato, para achar o registro pelo papel */
  id: string;
  empresa: { nome: string; cnpj: string | null };
  patrocinado: { nome: string; cpfCnpj: string | null; projeto: string | null };
  valorMensal: number | null;
  inicio: Date | null;
  fim: Date | null;
  texto: string;
  assinadoEm: Date;
  assinaturaPng: string;
  nomeAssinante: string;
  modo: ModoAssinatura;
  ip: string | null;
  userAgent: string | null;
}

const MARGEM = 56;
const TINTA = '#1e293b';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';
/** Espaço que o rodapé ocupa no pé de cada página. */
const ALTURA_DO_RODAPE = 70;

export function gerarContratoPdf(d: DadosDoContrato): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: MARGEM,
      bottom: MARGEM + ALTURA_DO_RODAPE,
      left: MARGEM,
      right: MARGEM,
    },
    bufferPages: true,
    info: {
      Title: `Contrato de patrocínio — ${d.patrocinado.nome}`,
      Author: d.empresa.nome,
      Subject: 'Termo de patrocínio',
    },
  });

  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  desenhar(doc, d);

  // O rodapé vai em todas as páginas: o contrato tem duas ou três, e a prova
  // de onde veio a assinatura tem de estar em cada folha solta.
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    rodape(doc, d, i + 1, paginas.count);
  }

  doc.end();
  return pronto;
}

function desenhar(doc: PDFKit.PDFDocument, d: DadosDoContrato): void {
  const largura = doc.page.width - MARGEM * 2;

  // --- Quem patrocina, no alto, como um papel timbrado ---
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(d.empresa.nome.toUpperCase(), MARGEM, MARGEM);
  if (d.empresa.cnpj) {
    doc.font('Helvetica').fontSize(9).fillColor(TINTA_FRACA).text(`CNPJ ${d.empresa.cnpj}`);
  }
  doc
    .moveTo(MARGEM, doc.y + 12)
    .lineTo(MARGEM + largura, doc.y + 12)
    .lineWidth(1)
    .strokeColor(LINHA)
    .stroke();

  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(TINTA)
    .text('TERMO DE PATROCÍNIO', MARGEM, doc.y, {
      width: largura,
      align: 'center',
      characterSpacing: 1.2,
    });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA_FRACA)
    .text('Contrapartidas do patrocinado', MARGEM, doc.y, { width: largura, align: 'center' });

  // --- As partes e o combinado ---
  doc.moveDown(1.4);
  linhaDeDado(doc, 'Patrocinador', comDocumento(d.empresa.nome, d.empresa.cnpj, 'CNPJ'));
  linhaDeDado(doc, 'Patrocinado', comDocumento(d.patrocinado.nome, d.patrocinado.cpfCnpj, 'CPF/CNPJ'));
  if (d.patrocinado.projeto) linhaDeDado(doc, 'Projeto', d.patrocinado.projeto);
  if (d.valorMensal) linhaDeDado(doc, 'Apoio mensal', formatValorBR(d.valorMensal));
  const vigencia = textoDaVigencia(d.inicio, d.fim);
  if (vigencia) linhaDeDado(doc, 'Vigência', vigencia);

  doc.moveDown(0.8);
  doc
    .moveTo(MARGEM, doc.y)
    .lineTo(MARGEM + largura, doc.y)
    .lineWidth(0.6)
    .strokeColor(LINHA)
    .stroke();
  doc.moveDown(0.8);

  // --- As cláusulas, do texto congelado ---
  for (const bloco of blocosDoContrato(d.texto)) {
    if (bloco.tipo === 'secao') {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(TINTA).text(bloco.texto, MARGEM, doc.y, {
        width: largura,
      });
      doc.moveDown(0.3);
    } else if (bloco.tipo === 'item') {
      doc.font('Helvetica').fontSize(10.5).fillColor(TINTA).text(`•  ${bloco.texto}`, MARGEM + 12, doc.y, {
        width: largura - 12,
        lineGap: 2,
        indent: 0,
      });
      doc.moveDown(0.15);
    } else {
      doc.font('Helvetica').fontSize(10.5).fillColor(TINTA).text(bloco.texto, MARGEM, doc.y, {
        width: largura,
        align: 'justify',
        lineGap: 2.5,
      });
      doc.moveDown(0.4);
    }
  }

  assinaturas(doc, d);
}

/** As duas linhas de assinatura do papel original, lado a lado. */
function assinaturas(doc: PDFKit.PDFDocument, d: DadosDoContrato): void {
  const largura = doc.page.width - MARGEM * 2;
  const alturaDoBloco = 150;
  const limite = doc.page.height - MARGEM - ALTURA_DO_RODAPE;

  // As duas assinaturas não se separam do resto por uma quebra de página no
  // meio delas: se não couberem aqui, vão juntas para a próxima.
  if (doc.y + alturaDoBloco > limite) doc.addPage();

  doc.moveDown(2);
  const topo = doc.y;
  const coluna = (largura - 40) / 2;
  const esquerda = MARGEM;
  const direita = MARGEM + coluna + 40;
  const linhaY = topo + 76;

  // --- Patrocinado: a assinatura desenhada (ou gerada) ---
  const png = Buffer.from(d.assinaturaPng.replace(/^data:image\/png;base64,/, ''), 'base64');
  // `fit` mantém a proporção: esticada, a assinatura deixa de ser a da pessoa.
  doc.image(png, esquerda, topo, { fit: [coluna, 70], align: 'center' });
  traco(doc, esquerda, linhaY, coluna);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(TINTA)
    .text(d.nomeAssinante, esquerda, linhaY + 7, { width: coluna, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA_FRACA)
    .text('Patrocinado', esquerda, doc.y + 1, { width: coluna, align: 'center' });
  if (d.modo === ModoAssinatura.DIGITADA) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .text(
        'Assinatura gerada a partir do nome, a pedido do patrocinado, por não assinar de próprio punho.',
        esquerda,
        doc.y + 4,
        { width: coluna, align: 'center' },
      );
  }

  // --- Patrocinador: a empresa que emitiu o contrato ---
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor(TINTA_FRACA)
    .text('Contrato emitido eletronicamente', direita, linhaY - 22, {
      width: coluna,
      align: 'center',
    });
  traco(doc, direita, linhaY, coluna);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(TINTA)
    .text(d.empresa.nome, direita, linhaY + 7, { width: coluna, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA_FRACA)
    .text('Patrocinador', direita, doc.y + 1, { width: coluna, align: 'center' });
}

function traco(doc: PDFKit.PDFDocument, x: number, y: number, largura: number): void {
  doc.moveTo(x, y).lineTo(x + largura, y).lineWidth(0.8).strokeColor(TINTA).stroke();
}

/** "Rótulo: valor", alinhados como numa ficha. */
function linhaDeDado(doc: PDFKit.PDFDocument, rotulo: string, valor: string): void {
  doc.font('Helvetica').fontSize(10).fillColor(TINTA_FRACA).text(`${rotulo}: `, MARGEM, doc.y, {
    continued: true,
  });
  doc.font('Helvetica-Bold').fillColor(TINTA).text(valor);
}

/**
 * O que responde "de onde saiu isto" se alguém contestar: quando foi assinado,
 * de que endereço, em que aparelho, e o código que liga o papel ao registro.
 */
function rodape(doc: PDFKit.PDFDocument, d: DadosDoContrato, pagina: number, total: number): void {
  const largura = doc.page.width - MARGEM * 2;
  const y = doc.page.height - MARGEM - 52;
  // Escrever abaixo da margem de baixo faria o pdfkit abrir outra página.
  const margemDeBaixo = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.moveTo(MARGEM, y).lineTo(MARGEM + largura, y).lineWidth(0.8).strokeColor(LINHA).stroke();

  const comoFoi =
    d.modo === ModoAssinatura.DIGITADA
      ? 'Assinatura gerada a partir do nome informado'
      : 'Assinado de próprio punho na tela';
  const linhas = [
    `${comoFoi}, eletronicamente, em ${formatarDataHora(d.assinadoEm)}.`,
    [d.ip ? `Origem: ${d.ip}` : null, d.userAgent ? `Aparelho: ${encurtar(d.userAgent, 80)}` : null]
      .filter(Boolean)
      .join(' · ') || null,
    `Contrato ${d.id} · página ${pagina} de ${total}`,
  ].filter((l): l is string => !!l);

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA_FRACA)
    .text(linhas.join('\n'), MARGEM, y + 8, { width: largura, lineGap: 1.5 });

  doc.page.margins.bottom = margemDeBaixo;
}

function comDocumento(nome: string, documento: string | null, rotulo: string): string {
  return documento ? `${nome} — ${rotulo} ${documento}` : nome;
}

/** "de 01/10/2026 a 30/09/2027", "a partir de 01/10/2026", ou nada. */
export function textoDaVigencia(inicio: Date | null, fim: Date | null): string | null {
  if (inicio && fim) return `de ${formatarData(inicio)} a ${formatarData(fim)}`;
  if (inicio) return `a partir de ${formatarData(inicio)}`;
  if (fim) return `até ${formatarData(fim)}`;
  return null;
}

function encurtar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** Datas de calendário: o dia guardado, sem o fuso do servidor no meio. */
function formatarData(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(d);
}

function formatarDataHora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}
