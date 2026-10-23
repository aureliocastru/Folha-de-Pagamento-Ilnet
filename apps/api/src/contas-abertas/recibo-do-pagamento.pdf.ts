/**
 * O recibo de um pagamento que não tem comprovante de banco.
 *
 * O ModoBank devolve o comprovante dele; o dinheiro da gaveta, o boleto pago no
 * aplicativo de outro banco e o Pix feito fora daqui não trazem papel nenhum. É
 * para esses que este recibo existe: o que a casa registrou do pagamento — quem
 * pagou, quem recebeu, quanto, quando e por onde —, num papel que se manda pelo
 * WhatsApp ou se imprime para o recebedor assinar.
 *
 * Tudo sai do IXC na hora (o título, o fornecedor, a filial): o recibo diz o que
 * o registro diz, e não o que alguém digitou para ele.
 */

import PDFDocument from 'pdfkit';
import { valorPorExtenso } from '../assinaturas/recibo.extenso';
import { formatValorBR } from '../financeiro/folha.calc';

/** Quem paga ou quem recebe, como o cadastro do IXC o tem. */
export interface PessoaDoRecibo {
  nome: string;
  /** O nome fantasia, quando é outro: é por ele que a pessoa é conhecida. */
  fantasia: string | null;
  documento: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
}

export interface DadosDoReciboDoPagamento {
  /** O título do IXC: é o número do recibo, e o que acha o pagamento lá. */
  numero: number;
  pagador: PessoaDoRecibo;
  recebedor: PessoaDoRecibo;
  valorPago: number;
  valorDoTitulo: number;
  juros: number;
  multa: number;
  desconto: number;
  /** O dia em que o dinheiro saiu. */
  pagoEm: Date;
  /** Quando a baixa foi registrada no IXC — dia e, quando há, hora. */
  registradoEm: Date;
  hora: string | null;
  forma: string | null;
  saiuDe: string | null;
  chavePix: string | null;
  vencimento: Date | null;
  documento: string | null;
  referente: string;
  emitidoEm: Date;
}

const MARGEM = 50;
const TINTA = '#1e293b';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';
const FUNDO = '#f1f5f9';

export function gerarReciboDoPagamento(d: DadosDoReciboDoPagamento): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    info: {
      Title: `Recibo de pagamento nº ${d.numero} — ${d.recebedor.nome}`,
      Author: d.pagador.nome,
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

/** "23/10/2026 às 10:36" — ou só o dia, quando a hora não veio. */
export function quandoFoiPago(d: Pick<DadosDoReciboDoPagamento, 'pagoEm' | 'registradoEm' | 'hora'>): string {
  const dia = formatarDia(d.pagoEm);
  const mesmoDia = formatarDia(d.registradoEm) === dia;
  if (!d.hora) return dia;
  const hora = d.hora.slice(0, 5);
  // Pago num dia e lançado noutro: a hora é a do lançamento, e o papel diz isso.
  return mesmoDia ? `${dia} às ${hora}` : `${dia} (registrado em ${formatarDia(d.registradoEm)} às ${hora})`;
}

function desenhar(doc: PDFKit.PDFDocument, d: DadosDoReciboDoPagamento): void {
  const largura = doc.page.width - MARGEM * 2;

  // --- Quem paga, no alto, como o timbre de um papel timbrado ---
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(d.pagador.nome.toUpperCase(), MARGEM, MARGEM, { width: largura });
  const timbre = [
    d.pagador.documento ? `CNPJ ${d.pagador.documento}` : null,
    d.pagador.endereco,
    [d.pagador.telefone, d.pagador.email].filter(Boolean).join(' · ') || null,
  ].filter((l): l is string => !!l);
  if (timbre.length > 0) {
    doc.font('Helvetica').fontSize(8.5).fillColor(TINTA_FRACA).text(timbre.join('\n'), { lineGap: 1 });
  }
  regua(doc, doc.y + 10);

  // --- Título, número e valor: o que se lê de longe ---
  doc.y += 22;
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(TINTA)
    .text('RECIBO DE PAGAMENTO', MARGEM, doc.y, { width: largura, align: 'center', characterSpacing: 1.2 });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(TINTA_FRACA)
    .text(`Nº ${d.numero}`, { width: largura, align: 'center' });
  doc.moveDown(0.6);
  doc
    .font('Helvetica-Bold')
    .fontSize(24)
    .fillColor(TINTA)
    .text(formatValorBR(d.valorPago), { width: largura, align: 'center' });
  doc
    .font('Helvetica-Oblique')
    .fontSize(9.5)
    .fillColor(TINTA_FRACA)
    .text(`(${valorPorExtenso(d.valorPago)})`, { width: largura, align: 'center' });

  // --- A declaração ---
  doc.moveDown(1.2);
  const docDoRecebedor = d.recebedor.documento
    ? `, ${rotuloDoDocumento(d.recebedor.documento)} ${d.recebedor.documento}`
    : '';
  const docDoPagador = d.pagador.documento ? `, CNPJ ${d.pagador.documento}` : '';
  const forma = d.forma ? `, por ${d.forma.toLowerCase()}` : '';
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(TINTA)
    .text(
      `${d.pagador.nome}${docDoPagador}, pagou a ${d.recebedor.nome}${docDoRecebedor}, ` +
        `a importância de ${formatValorBR(d.valorPago)} (${valorPorExtenso(d.valorPago)}), ` +
        `referente a ${frase(d.referente)}, em ${quandoFoiPago(d)}${forma}.`,
      MARGEM,
      doc.y,
      { width: largura, align: 'justify', lineGap: 3 },
    );

  // --- O pagamento ---
  secao(doc, 'Pagamento');
  campo(doc, 'Data e hora', quandoFoiPago(d));
  if (d.forma) campo(doc, 'Forma de pagamento', d.forma);
  if (d.saiuDe) campo(doc, 'Saiu de', d.saiuDe);
  if (d.chavePix) campo(doc, 'Chave Pix do recebedor', d.chavePix);
  if (d.vencimento) campo(doc, 'Vencimento', formatarDia(d.vencimento));
  if (d.documento) campo(doc, 'Documento', d.documento);
  const diferente = Math.abs(d.valorDoTitulo - d.valorPago) > 0.005;
  if (diferente) campo(doc, 'Valor do título', formatValorBR(d.valorDoTitulo));
  if (d.juros > 0) campo(doc, 'Juros', formatValorBR(d.juros));
  if (d.multa > 0) campo(doc, 'Multa', formatValorBR(d.multa));
  if (d.desconto > 0) campo(doc, 'Desconto', formatValorBR(d.desconto));
  campo(doc, 'Valor pago', formatValorBR(d.valorPago));
  campo(doc, 'Referente a', d.referente);

  // --- Quem recebeu e quem pagou ---
  secao(doc, 'Recebedor');
  pessoa(doc, d.recebedor);
  secao(doc, 'Pagador');
  pessoa(doc, d.pagador);

  // --- A assinatura de quem recebeu, para o papel que se imprime ---
  const larguraAssinatura = 260;
  const esquerda = MARGEM + (largura - larguraAssinatura) / 2;
  const linhaY = Math.max(doc.y + 46, doc.page.height - MARGEM - 120);
  if (linhaY < doc.page.height - MARGEM - 60) {
    doc
      .moveTo(esquerda, linhaY)
      .lineTo(esquerda + larguraAssinatura, linhaY)
      .lineWidth(0.8)
      .strokeColor(TINTA)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(TINTA)
      .text(d.recebedor.nome, esquerda - 40, linhaY + 6, { width: larguraAssinatura + 80, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(TINTA_FRACA)
      .text('Assinatura do recebedor', esquerda, doc.y + 1, { width: larguraAssinatura, align: 'center' });
  }

  // --- O rodapé: de onde saiu este papel ---
  const y = doc.page.height - MARGEM - 28;
  regua(doc, y);
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA_FRACA)
    .text(
      `Emitido em ${formatarDataHora(d.emitidoEm)} a partir do registro do pagamento no IXC ` +
        `(título nº ${d.numero}). Este recibo não é comprovante emitido por banco.`,
      MARGEM,
      y + 7,
      { width: largura, lineGap: 1.5 },
    );
}

function regua(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .moveTo(MARGEM, y)
    .lineTo(doc.page.width - MARGEM, y)
    .lineWidth(0.8)
    .strokeColor(LINHA)
    .stroke();
}

/** O cabeçalho de um bloco: faixa clara com o nome em maiúsculas. */
function secao(doc: PDFKit.PDFDocument, nome: string): void {
  const largura = doc.page.width - MARGEM * 2;
  const y = doc.y + 14;
  doc.rect(MARGEM, y, largura, 17).fill(FUNDO);
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(TINTA_FRACA)
    .text(nome.toUpperCase(), MARGEM + 8, y + 5, { characterSpacing: 0.8 });
  doc.y = y + 23;
}

/** "Rótulo   valor", alinhados como numa ficha. */
function campo(doc: PDFKit.PDFDocument, rotulo: string, valor: string): void {
  const largura = doc.page.width - MARGEM * 2;
  const colunaDoRotulo = 130;
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(TINTA_FRACA).text(rotulo, MARGEM + 8, y, {
    width: colunaDoRotulo - 8,
  });
  const fimDoRotulo = doc.y;
  doc
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .fillColor(TINTA)
    .text(valor, MARGEM + colunaDoRotulo, y, { width: largura - colunaDoRotulo });
  doc.y = Math.max(doc.y, fimDoRotulo) + 3;
}

function pessoa(doc: PDFKit.PDFDocument, p: PessoaDoRecibo): void {
  campo(doc, 'Nome', p.nome);
  if (p.fantasia && p.fantasia.trim().toLowerCase() !== p.nome.trim().toLowerCase()) {
    campo(doc, 'Nome fantasia', p.fantasia);
  }
  if (p.documento) campo(doc, rotuloDoDocumento(p.documento), p.documento);
  if (p.endereco) campo(doc, 'Endereço', p.endereco);
  if (p.telefone) campo(doc, 'Telefone', p.telefone);
  if (p.email) campo(doc, 'E-mail', p.email);
}

/**
 * A observação do título dentro da frase: numa linha só e sem a pontuação do
 * fim — "…3 almofadas de carimbo," virava ",, em 23/10" (título 37972).
 */
export function frase(texto: string): string {
  return texto.replace(/\s*\n\s*/g, ' ').trim().replace(/[\s.,;:]+$/, '');
}

/** CPF tem 11 dígitos; o resto que se paga aqui é CNPJ. */
function rotuloDoDocumento(documento: string): string {
  return documento.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ';
}

/** O dia civil, como o IXC o guarda — sem fuso. */
function formatarDia(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(d);
}

function formatarDataHora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}
