/**
 * A APR em papel.
 *
 * É o documento que alguém vai pedir — o cliente na obra, o fiscal, o advogado
 * dois anos depois. Ele sai do retrato congelado na APR, e não do cadastro de
 * hoje: reimprimir a de março tem de dar a folha que a equipe assinou em março.
 *
 * O desenho segue o formulário impresso da casa, seção por seção, para quem
 * conhece o papel reconhecer o que está lendo. As duas diferenças são a favor
 * de quem lê: o que **não** foi marcado não é impresso (o papel gastava três
 * páginas em quadradinhos vazios), e o que foi respondido "Não" no relato ganha
 * destaque com a providência embaixo, em vez de sumir num quadradinho no meio
 * da terceira folha.
 */

import {
  CategoriaItemApr,
  GravidadeApr,
  ModoAssinatura,
  RespostaRelato,
} from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';

export interface RespostaDoPdf {
  categoria: CategoriaItemApr;
  texto: string;
  marcado: boolean;
  resposta: RespostaRelato | null;
  detalhe: string | null;
}

export interface ExecutanteDoPdf {
  nome: string;
  cpf: string | null;
  assinaturaPng: string | null;
  assinadoEm: Date | null;
  modo: ModoAssinatura;
}

export interface DadosDaApr {
  numero: number;
  empresaNome: string;
  empresaCnpj: string | null;
  titulo: string;
  tipoTrabalho: string;
  local: string;
  coordenador: string;
  previsaoInicio: Date | null;
  previsaoFim: Date | null;
  inicioEm: Date;
  fimEm: Date | null;
  prorrogacoes: number;
  motivoProrrogacao: string | null;
  descricaoEtapas: string;
  gravidade: GravidadeApr;
  orientacoes: string;
  planoResgate: string;
  telefonesEmergencia: string;
  criadoPorNome: string;
  supervisorNome: string | null;
  supervisorAssinatura: string | null;
  supervisorEm: Date | null;
  cancelada: boolean;
  motivoCancelamento: string | null;
  respostas: RespostaDoPdf[];
  executantes: ExecutanteDoPdf[];
}

const MARGEM = 38;
const TINTA = '#0f172a';
const TINTA_FRACA = '#64748b';
const LINHA = '#cbd5e1';
const MARCA = '#0a72c4';
const FAIXA = '#eef4fb';
const ALERTA = '#b91c1c';

/** O caminho da logo. Ao lado do arquivo compilado — ver o `nest-cli.json`. */
const LOGO = path.join(__dirname, 'logo-ilnet.png');

export function gerarAprPdf(d: DadosDaApr): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM + 18, left: MARGEM, right: MARGEM },
    // Para numerar as páginas no fim, quando já se sabe quantas são.
    bufferPages: true,
    info: {
      Title: `APR nº ${d.numero} — ${d.local}`,
      Author: d.empresaNome,
      Subject: d.titulo,
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

function desenhar(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  timbre(doc, d);

  if (d.cancelada) {
    tarjaDeCancelamento(doc, d);
  }

  identificacao(doc, d);
  marcados(doc, d, CategoriaItemApr.ATIVIDADE, 'Atividade a ser executada', 2);
  etapas(doc, d);
  marcados(doc, d, CategoriaItemApr.RISCO, 'Riscos da atividade', 3);
  gravidade(doc, d);
  marcados(
    doc,
    d,
    CategoriaItemApr.FERRAMENTA,
    'Máquinas, equipamentos e ferramentas',
    2,
  );
  marcados(
    doc,
    d,
    CategoriaItemApr.PROTECAO,
    'EPI e EPC de uso obrigatório',
    2,
  );
  relatoSituacional(doc, d);
  assinaturas(doc, d);
  textoLongo(doc, 'Orientações de segurança e prevenção de acidentes', d.orientacoes);
  textoLongo(doc, 'Plano de resgate e emergência', d.planoResgate);
}

// --- O alto da folha --------------------------------------------------------

function timbre(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  const largura = doc.page.width - MARGEM * 2;

  // A logo pode faltar num ambiente mal montado, e uma APR sem timbre continua
  // valendo mais que uma APR que não sai.
  if (fs.existsSync(LOGO)) {
    doc.image(LOGO, MARGEM, MARGEM - 4, { fit: [82, 50] });
  }

  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .text(d.empresaNome.toUpperCase(), MARGEM + 96, MARGEM, {
      width: largura - 96,
    });

  if (d.empresaCnpj) {
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(8)
      .text(`CNPJ ${d.empresaCnpj}`, MARGEM + 96, doc.y + 1, {
        width: largura - 96,
      });
  }

  doc
    .fillColor(MARCA)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(d.titulo.toUpperCase(), MARGEM + 96, doc.y + 4, {
      width: largura - 96,
    });

  const baixo = Math.max(doc.y, MARGEM + 48) + 8;
  doc
    .moveTo(MARGEM, baixo)
    .lineTo(doc.page.width - MARGEM, baixo)
    .lineWidth(1.2)
    .strokeColor(MARCA)
    .stroke();

  doc.y = baixo + 10;
}

function tarjaDeCancelamento(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  const largura = doc.page.width - MARGEM * 2;
  const altura = 30;

  doc.rect(MARGEM, doc.y, largura, altura).fillColor('#fee2e2').fill();
  doc
    .fillColor(ALERTA)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(
      `APR CANCELADA — ${d.motivoCancelamento ?? 'sem motivo registrado'}`,
      MARGEM + 8,
      doc.y + 10,
      { width: largura - 16 },
    );

  doc.y += 12;
}

// --- As seções --------------------------------------------------------------

function identificacao(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  tituloDaSecao(doc, `Identificação — APR nº ${d.numero}`);

  const normas = textosMarcados(d, CategoriaItemApr.NORMA);
  const linhas: [string, string][] = [
    ['Local da atividade', d.local],
    ['Normas envolvidas', normas.join('   ·   ') || '—'],
    ['Tipo de trabalho', d.tipoTrabalho],
    ['Coordenador responsável', d.coordenador],
    [
      'Previsão de execução',
      d.previsaoInicio || d.previsaoFim
        ? `${dia(d.previsaoInicio)} a ${dia(d.previsaoFim)}`
        : '—',
    ],
    ['Início', dataHora(d.inicioEm)],
    ['Fim', d.fimEm ? dataHora(d.fimEm) : 'em andamento'],
  ];

  if (d.prorrogacoes > 0) {
    linhas.push([
      `Prorrogação (${d.prorrogacoes}ª)`,
      d.motivoProrrogacao ?? '—',
    ]);
  }
  linhas.push(['Preenchida por', d.criadoPorNome]);

  grade(doc, linhas);
}

function etapas(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  tituloDaSecao(doc, 'A atividade, por etapas');
  garantirEspaco(doc, 40);

  doc
    .fillColor(TINTA)
    .font('Helvetica')
    .fontSize(9)
    .text(d.descricaoEtapas || '—', MARGEM + 4, doc.y, {
      width: doc.page.width - MARGEM * 2 - 8,
      align: 'left',
      lineGap: 1.5,
    });

  doc.y += 8;
}

/**
 * Uma lista do que foi marcado, em colunas.
 *
 * O que não foi marcado não entra. No papel a grade inteira era impressa e a
 * pessoa riscava; aqui, o que se lê é o que vale — e a diferença, na grade de
 * riscos, é entre meia página e três.
 */
function marcados(
  doc: PDFKit.PDFDocument,
  d: DadosDaApr,
  categoria: CategoriaItemApr,
  titulo: string,
  colunas: number,
): void {
  const itens = d.respostas.filter((r) => r.categoria === categoria && r.marcado);
  if (itens.length === 0) return;

  tituloDaSecao(doc, titulo);

  const largura = doc.page.width - MARGEM * 2;
  const larguraColuna = largura / colunas;
  const alturaLinha = 13;
  const linhas = Math.ceil(itens.length / colunas);

  garantirEspaco(doc, linhas * alturaLinha + 6);
  const topo = doc.y;

  itens.forEach((item, indice) => {
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const x = MARGEM + coluna * larguraColuna;
    const y = topo + linha * alturaLinha;

    // Quadradinho desenhado, e não um caractere: as fontes embutidas do pdfkit
    // são WinAnsi, e o "■" não existe nessa tabela — ele saía impresso como
    // "%" em toda marcação do documento.
    doc.rect(x + 0.5, y + 1.5, 6, 6).fillColor(MARCA).fill();

    doc
      .fillColor(TINTA)
      .font('Helvetica')
      .fontSize(8.5)
      .text(rotulo(item), x + 11, y + 0.5, {
        width: larguraColuna - 16,
        lineBreak: false,
        ellipsis: true,
      });
  });

  doc.y = topo + linhas * alturaLinha + 6;
}

/** O texto do item, com o "quais?" junto quando ele foi preenchido. */
function rotulo(item: RespostaDoPdf): string {
  const detalhe = item.detalhe?.trim();
  if (!detalhe) return item.texto;
  return `${item.texto.replace(/\?$/, '')}: ${detalhe}`;
}

function gravidade(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  tituloDaSecao(doc, 'Potencial de gravidade');
  garantirEspaco(doc, 30);

  const opcoes: [GravidadeApr, string, string][] = [
    [GravidadeApr.BAIXA, 'Baixa', '#047857'],
    [GravidadeApr.MEDIA, 'Média', '#b45309'],
    [GravidadeApr.ALTA, 'Alta', '#b91c1c'],
  ];

  const topo = doc.y;
  let x = MARGEM;

  for (const [valor, nome, cor] of opcoes) {
    const escolhida = d.gravidade === valor;
    const largura = 78;

    doc
      .roundedRect(x, topo, largura, 20, 5)
      .lineWidth(escolhida ? 1.2 : 0.6)
      .fillColor(escolhida ? cor : '#ffffff')
      .strokeColor(escolhida ? cor : LINHA)
      .fillAndStroke();

    doc
      .fillColor(escolhida ? '#ffffff' : TINTA_FRACA)
      .font(escolhida ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .text(nome, x, topo + 6, { width: largura, align: 'center' });

    x += largura + 8;
  }

  doc.y = topo + 28;
}

function relatoSituacional(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  const perguntas = d.respostas.filter(
    (r) => r.categoria === CategoriaItemApr.RELATO && r.resposta,
  );
  if (perguntas.length === 0) return;

  tituloDaSecao(doc, 'Relato situacional');

  const largura = doc.page.width - MARGEM * 2;
  const larguraResposta = 52;
  const larguraPergunta = largura - larguraResposta - 12;

  for (const p of perguntas) {
    const alturaTexto = doc
      .font('Helvetica')
      .fontSize(8.5)
      .heightOfString(p.texto, { width: larguraPergunta });

    const providencia =
      p.resposta === RespostaRelato.NAO ? p.detalhe?.trim() : null;
    const alturaProvidencia = providencia
      ? doc
          .font('Helvetica-Oblique')
          .fontSize(8)
          .heightOfString(`Providência: ${providencia}`, {
            width: larguraPergunta,
          }) + 3
      : 0;

    const altura = Math.max(alturaTexto, 12) + alturaProvidencia + 7;
    garantirEspaco(doc, altura);

    const topo = doc.y;
    const atencao = p.resposta === RespostaRelato.NAO;

    if (atencao) {
      doc.rect(MARGEM, topo - 2, largura, altura).fillColor('#fef2f2').fill();
    }

    doc
      .fillColor(TINTA)
      .font('Helvetica')
      .fontSize(8.5)
      .text(p.texto, MARGEM + 4, topo + 1, { width: larguraPergunta });

    if (providencia) {
      doc
        .fillColor(ALERTA)
        .font('Helvetica-Oblique')
        .fontSize(8)
        .text(`Providência: ${providencia}`, MARGEM + 4, doc.y + 2, {
          width: larguraPergunta,
        });
    }

    doc
      .fillColor(atencao ? ALERTA : TINTA_FRACA)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(
        nomeDaResposta(p.resposta),
        MARGEM + larguraPergunta + 12,
        topo + 1,
        { width: larguraResposta, align: 'right' },
      );

    doc.y = topo + altura - 4;
    doc
      .moveTo(MARGEM, doc.y)
      .lineTo(doc.page.width - MARGEM, doc.y)
      .lineWidth(0.4)
      .strokeColor(LINHA)
      .stroke();
    doc.y += 3;
  }

  doc.y += 5;
}

function assinaturas(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  tituloDaSecao(doc, 'Executantes da tarefa');

  const largura = doc.page.width - MARGEM * 2;
  const colunas = 2;
  const larguraColuna = (largura - 12) / colunas;
  const alturaCartao = 74;

  d.executantes.forEach((e, indice) => {
    const coluna = indice % colunas;
    if (coluna === 0) garantirEspaco(doc, alturaCartao + 8);

    const topo = doc.y;
    const x = MARGEM + coluna * (larguraColuna + 12);

    doc
      .roundedRect(x, topo, larguraColuna, alturaCartao, 5)
      .lineWidth(0.6)
      .strokeColor(LINHA)
      .stroke();

    desenharAssinatura(doc, e, x + 6, topo + 5, larguraColuna - 12, 34);

    doc
      .moveTo(x + 10, topo + 43)
      .lineTo(x + larguraColuna - 10, topo + 43)
      .lineWidth(0.4)
      .strokeColor(LINHA)
      .stroke();

    doc
      .fillColor(TINTA)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(e.nome, x + 6, topo + 47, {
        width: larguraColuna - 12,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });

    const rodape = [
      e.cpf ? `CPF ${e.cpf}` : null,
      e.assinadoEm ? dataHora(e.assinadoEm) : 'não assinou',
      e.modo === ModoAssinatura.DIGITADA ? 'assinatura gerada do nome' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(6.5)
      .text(rodape, x + 6, topo + 58, {
        width: larguraColuna - 12,
        align: 'center',
      });

    // Só desce a régua ao fechar a linha, ou o segundo cartão nasceria abaixo
    // do primeiro em vez de ao lado dele.
    if (coluna === colunas - 1 || indice === d.executantes.length - 1) {
      doc.y = topo + alturaCartao + 8;
    } else {
      doc.y = topo;
    }
  });

  supervisao(doc, d);
}

function supervisao(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
  garantirEspaco(doc, 64);

  const largura = doc.page.width - MARGEM * 2;
  const topo = doc.y;

  doc
    .roundedRect(MARGEM, topo, largura, 58, 5)
    .lineWidth(0.6)
    .strokeColor(LINHA)
    .stroke();

  doc
    .fillColor(TINTA_FRACA)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('SUPERVISÃO', MARGEM + 8, topo + 7, { characterSpacing: 0.8 });

  if (d.supervisorAssinatura) {
    desenharAssinatura(
      doc,
      {
        nome: d.supervisorNome ?? '',
        cpf: null,
        assinaturaPng: d.supervisorAssinatura,
        assinadoEm: d.supervisorEm,
        modo: ModoAssinatura.DESENHADA,
      },
      MARGEM + 8,
      topo + 17,
      180,
      26,
    );
    doc
      .fillColor(TINTA)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(d.supervisorNome ?? '', MARGEM + 200, topo + 24, { width: 200 });
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(7)
      .text(
        d.supervisorEm ? dataHora(d.supervisorEm) : '',
        MARGEM + 200,
        doc.y + 1,
        { width: 200 },
      );
  } else {
    doc
      .moveTo(MARGEM + 8, topo + 40)
      .lineTo(MARGEM + 240, topo + 40)
      .lineWidth(0.4)
      .strokeColor(LINHA)
      .stroke();
    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(7)
      .text('Assinatura e data', MARGEM + 8, topo + 43);
  }

  doc.y = topo + 66;
}

/** O PNG da assinatura, ou o traço em branco de quem ainda não assinou. */
function desenharAssinatura(
  doc: PDFKit.PDFDocument,
  e: ExecutanteDoPdf,
  x: number,
  y: number,
  largura: number,
  altura: number,
): void {
  const png = pngDaDataUrl(e.assinaturaPng);
  if (!png) return;

  try {
    doc.image(png, x, y, { fit: [largura, altura], align: 'center' });
  } catch {
    // Assinatura ilegível para o pdfkit não pode derrubar o documento inteiro:
    // o nome impresso embaixo e a data continuam dizendo quem assinou.
  }
}

function textoLongo(
  doc: PDFKit.PDFDocument,
  titulo: string,
  texto: string,
): void {
  if (!texto.trim()) return;

  tituloDaSecao(doc, titulo);
  garantirEspaco(doc, 40);

  doc
    .fillColor(TINTA)
    .font('Helvetica')
    .fontSize(8)
    .text(texto, MARGEM + 4, doc.y, {
      width: doc.page.width - MARGEM * 2 - 8,
      align: 'left',
      lineGap: 1.2,
    });

  doc.y += 8;
}

// --- Peças de desenho -------------------------------------------------------

function tituloDaSecao(doc: PDFKit.PDFDocument, titulo: string): void {
  garantirEspaco(doc, 34);

  const largura = doc.page.width - MARGEM * 2;
  const topo = doc.y;

  doc.rect(MARGEM, topo, largura, 15).fillColor(FAIXA).fill();
  doc
    .rect(MARGEM, topo, 2.5, 15)
    .fillColor(MARCA)
    .fill();

  doc
    .fillColor(MARCA)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(titulo.toUpperCase(), MARGEM + 8, topo + 4.5, {
      width: largura - 16,
      characterSpacing: 0.6,
    });

  doc.y = topo + 20;
}

/** Rótulo à esquerda, conteúdo à direita — a ficha de identificação. */
function grade(doc: PDFKit.PDFDocument, linhas: [string, string][]): void {
  const largura = doc.page.width - MARGEM * 2;
  const larguraRotulo = 128;

  linhas.forEach(([rot, valor], indice) => {
    const alturaValor = doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .heightOfString(valor || '—', { width: largura - larguraRotulo - 8 });
    const altura = Math.max(alturaValor, 11) + 5;

    garantirEspaco(doc, altura);
    const topo = doc.y;

    if (indice % 2 === 0) {
      doc.rect(MARGEM, topo - 1, largura, altura).fillColor('#f8fafc').fill();
    }

    doc
      .fillColor(TINTA_FRACA)
      .font('Helvetica')
      .fontSize(8)
      .text(rot, MARGEM + 4, topo + 1.5, { width: larguraRotulo - 8 });

    doc
      .fillColor(TINTA)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(valor || '—', MARGEM + larguraRotulo, topo + 1, {
        width: largura - larguraRotulo - 8,
      });

    doc.y = topo + altura;
  });

  doc.y += 6;
}

/**
 * Abre página nova quando o que vem a seguir não cabe.
 *
 * O pdfkit quebra o texto sozinho, mas não os retângulos que a gente desenha —
 * sem isto, um cartão de assinatura sairia cortado ao meio na virada da folha.
 */
function garantirEspaco(doc: PDFKit.PDFDocument, altura: number): void {
  const limite = doc.page.height - doc.page.margins.bottom;
  if (doc.y + altura > limite) doc.addPage();
}

/**
 * O rodapé de cada página, escrito no fim, quando já se sabe quantas são.
 *
 * A margem de baixo é zerada em cada página antes de escrever, e é o detalhe
 * que faz isto funcionar: escrever texto abaixo da margem inferior faz o pdfkit
 * abrir uma folha nova para acomodá-lo. Sem isto, um documento de três páginas
 * saía com nove — três com conteúdo e seis em branco, cada uma carregando o
 * rodapé que deveria estar na anterior.
 *
 * Não há por que restaurar a margem: o documento é fechado logo em seguida.
 */
function numerarPaginas(doc: PDFKit.PDFDocument, d: DadosDaApr): void {
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
        `APR nº ${d.numero} · ${d.local} · ${dia(d.inicioEm)}` +
          (d.telefonesEmergencia ? `  |  ${d.telefonesEmergencia}` : ''),
        MARGEM,
        y,
        { width: doc.page.width - MARGEM * 2 - 60, lineBreak: false },
      );

    doc.text(
      `${i + 1} / ${faixa.count}`,
      doc.page.width - MARGEM - 60,
      y,
      { width: 60, align: 'right', lineBreak: false },
    );
  }
}

// --- Miudezas ---------------------------------------------------------------

/** O Buffer de uma data URL de imagem, ou null quando não há assinatura. */
function pngDaDataUrl(url: string | null): Buffer | null {
  if (!url) return null;
  const m = /^data:image\/[-\w.+]+;base64,(.+)$/s.exec(url.trim());
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

function textosMarcados(d: DadosDaApr, categoria: CategoriaItemApr): string[] {
  return d.respostas
    .filter((r) => r.categoria === categoria && r.marcado)
    .map((r) => r.texto);
}

function nomeDaResposta(resposta: RespostaRelato | null): string {
  if (resposta === RespostaRelato.SIM) return 'SIM';
  if (resposta === RespostaRelato.NAO) return 'NÃO';
  if (resposta === RespostaRelato.NAO_SE_APLICA) return 'N.A.';
  return '—';
}

/** Data de calendário, lida em UTC: ela foi guardada à meia-noite de lá. */
function dia(data: Date | null): string {
  if (!data) return '—';
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/**
 * Data e hora, no fuso de casa.
 *
 * Fixo em São Paulo de propósito: o container roda em UTC, e sem isto a APR
 * aberta às sete da manhã sairia impressa como das dez.
 */
function dataHora(data: Date | null): string {
  if (!data) return '—';
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
