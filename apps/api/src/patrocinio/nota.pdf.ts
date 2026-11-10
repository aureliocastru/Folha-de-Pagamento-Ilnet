/**
 * A nota de recebimento em papel: o patrocinado diz, com a assinatura dele,
 * que recebeu o dinheiro de um pagamento.
 *
 * Tudo que sai impresso vem do retrato congelado em `notas_de_recebimento`,
 * não do cadastro nem do título de hoje — o mesmo cuidado do recibo da diária
 * (`recibo.pdf.ts`), de onde vem o desenho.
 */

import { ModoAssinatura } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { valorPorExtenso } from '../assinaturas/recibo.extenso';
import { formatValorBR } from '../financeiro/folha.calc';

export interface DadosDaNota {
  /** Código da nota, para achar o registro pelo papel */
  id: string;
  empresa: { nome: string; cnpj: string | null };
  patrocinado: { nome: string; cpfCnpj: string | null; projeto: string | null };
  valor: number;
  referente: string;
  vencimento: Date | null;
  pagoEm: Date | null;
  idFnApagar: number;
  assinadoEm: Date;
  assinaturaPng: string;
  /** Quem assinou: o patrocinado, ou o responsável por ele */
  nomeAssinante: string;
  modo: ModoAssinatura;
  ip: string | null;
  userAgent: string | null;
}

const MARGEM = 56;
const TINTA = '#1e293b';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';

export function gerarNotaPdf(d: DadosDaNota): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    info: {
      Title: `Nota de recebimento — ${d.patrocinado.nome}`,
      Author: d.empresa.nome,
      Subject: d.referente,
    },
  });

  const pedacos: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);
  });

  desenhar(doc, d);
  doc.end();
  return pronto;
}

/**
 * A frase que a assinatura confirma. Quem assina pelo patrocinado (a mãe do
 * atleta, o técnico do time) diz em nome de quem recebeu — o dinheiro é do
 * projeto, e a assinatura é de quem responde por ele.
 */
export function declaracaoDaNota(
  d: Pick<DadosDaNota, 'empresa' | 'patrocinado' | 'valor' | 'referente' | 'nomeAssinante'>,
): string {
  const assinaPorOutro =
    d.nomeAssinante.trim() !== '' &&
    normalizar(d.nomeAssinante) !== normalizar(d.patrocinado.nome);
  const quem = assinaPorOutro
    ? `Eu, ${d.nomeAssinante.trim()}, como responsável por ${d.patrocinado.nome}, declaro que recebi de `
    : 'Declaro que recebi de ';
  return (
    quem +
    d.empresa.nome +
    (d.empresa.cnpj ? `, inscrita no CNPJ sob o nº ${d.empresa.cnpj},` : ',') +
    ` a importância de ${formatValorBR(d.valor)} (${valorPorExtenso(d.valor)}), ` +
    'a título de patrocínio' +
    (d.patrocinado.projeto ? ` ao projeto "${d.patrocinado.projeto.trim()}"` : '') +
    `, referente a ${d.referente.trim()}, ` +
    'dando plena, geral e irrevogável quitação pelo valor recebido.'
  );
}

function desenhar(doc: PDFKit.PDFDocument, d: DadosDaNota): void {
  const largura = doc.page.width - MARGEM * 2;

  // --- Quem paga, no alto, como um papel timbrado ---
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

  // --- Título e valor ---
  doc.moveDown(2);
  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(TINTA)
    .text('NOTA DE RECEBIMENTO', { align: 'center', characterSpacing: 1.2 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(TINTA_FRACA)
    .text('Patrocínio', { align: 'center' });

  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(26).fillColor(TINTA).text(formatValorBR(d.valor), {
    align: 'center',
  });

  // --- A declaração ---
  doc.moveDown(1.8);
  doc
    .font('Helvetica')
    .fontSize(11.5)
    .fillColor(TINTA)
    .text(declaracaoDaNota(d), { align: 'justify', lineGap: 3.5 });

  // --- Os dados de conferência ---
  doc.moveDown(1.6);
  linhaDeDado(doc, 'Patrocinado', d.patrocinado.nome);
  if (d.patrocinado.cpfCnpj) linhaDeDado(doc, 'CPF/CNPJ', d.patrocinado.cpfCnpj);
  if (d.vencimento) linhaDeDado(doc, 'Vencimento', formatarData(d.vencimento));
  if (d.pagoEm) linhaDeDado(doc, 'Pago em', formatarData(d.pagoEm));
  linhaDeDado(doc, 'Título no IXC', `nº ${d.idFnApagar}`);

  // --- A assinatura ---
  doc.moveDown(2.4);
  const topoAssinatura = doc.y;
  const larguraAssinatura = 260;
  const esquerda = MARGEM + (largura - larguraAssinatura) / 2;

  const png = Buffer.from(d.assinaturaPng.replace(/^data:image\/png;base64,/, ''), 'base64');
  // `fit` mantém a proporção do rabisco, como no recibo da diária.
  doc.image(png, esquerda, topoAssinatura, { fit: [larguraAssinatura, 70], align: 'center' });

  const linhaY = topoAssinatura + 76;
  doc
    .moveTo(esquerda, linhaY)
    .lineTo(esquerda + larguraAssinatura, linhaY)
    .lineWidth(0.8)
    .strokeColor(TINTA)
    .stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(TINTA)
    .text(d.nomeAssinante, esquerda, linhaY + 7, { width: larguraAssinatura, align: 'center' });

  // Assinatura gerada: o papel diz isso embaixo dela, e não em letra miúda.
  if (d.modo === ModoAssinatura.DIGITADA) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(8.5)
      .fillColor(TINTA_FRACA)
      .text(
        'Assinatura gerada a partir do nome, a pedido de quem recebeu, ' +
          'por não assinar de próprio punho.',
        esquerda - 40,
        doc.y + 6,
        { width: larguraAssinatura + 80, align: 'center' },
      );
  }

  rodape(doc, d);
}

function linhaDeDado(doc: PDFKit.PDFDocument, rotulo: string, valor: string): void {
  doc.font('Helvetica').fontSize(10).fillColor(TINTA_FRACA).text(`${rotulo}: `, MARGEM, doc.y, {
    continued: true,
  });
  doc.font('Helvetica-Bold').fillColor(TINTA).text(valor);
}

/** A prova técnica: quando, de onde e em que aparelho, e o código da nota. */
function rodape(doc: PDFKit.PDFDocument, d: DadosDaNota): void {
  const largura = doc.page.width - MARGEM * 2;
  const y = doc.page.height - MARGEM - 62;

  doc
    .moveTo(MARGEM, y)
    .lineTo(MARGEM + largura, y)
    .lineWidth(0.8)
    .strokeColor(LINHA)
    .stroke();

  const comoFoi =
    d.modo === ModoAssinatura.DIGITADA
      ? 'Assinatura gerada a partir do nome informado'
      : 'Assinado de próprio punho na tela';

  const linhas = [
    `${comoFoi}, eletronicamente, em ${formatarDataHora(d.assinadoEm)}.`,
    d.ip ? `Origem: ${d.ip}` : null,
    d.userAgent ? `Aparelho: ${encurtar(d.userAgent, 96)}` : null,
    `Nota ${d.id}`,
  ].filter((l): l is string => l !== null);

  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA_FRACA)
    .text(linhas.join('\n'), MARGEM, y + 8, { width: largura, lineGap: 1.5 });
}

function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function encurtar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

/** Vencimento e pagamento são dias de calendário: gravados à meia-noite UTC. */
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
