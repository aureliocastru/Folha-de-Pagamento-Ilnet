import {
  CategoriaItemApr,
  GravidadeApr,
  ModoAssinatura,
  RespostaRelato,
  StatusApr,
} from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { gerarAprPdf, type DadosDaApr } from './apr.pdf';

/**
 * O papel é desenhado à mão — retângulo por retângulo, e o `tsc` não vê nada
 * disso. O que se prova aqui é que ele sai: uma coordenada errada, uma imagem
 * que o pdfkit recusa ou uma quebra de página mal calculada estouram em tempo
 * de execução, e sem este teste a primeira notícia seria um técnico com o
 * serviço parado e um 500 na tela.
 */

/** Um PNG 1×1 transparente, do tamanho de uma assinatura para o pdfkit. */
const PNG_MINIMO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function dados(extra: Partial<DadosDaApr> = {}): DadosDaApr {
  return {
    numero: 42,
    empresaNome: 'M A CASTRO SERVIÇOS DE COMUNICAÇÃO MULTIMÍDIA LTDA',
    empresaCnpj: '86.876.109/0001-02',
    titulo: 'ANÁLISE DE RISCO PARA TRABALHO EM ALTURA (NR-35/NR-10)',
    tipoTrabalho: 'Trabalho em altura',
    local: 'Rua das Palmeiras, poste 42 — Imperatriz/MA',
    coordenador: 'Werick Castro',
    previsaoInicio: new Date('2026-08-21T00:00:00.000Z'),
    previsaoFim: new Date('2026-08-22T00:00:00.000Z'),
    inicioEm: new Date('2026-08-21T11:00:00.000Z'),
    fimEm: null,
    prorrogacoes: 0,
    motivoProrrogacao: null,
    descricaoEtapas:
      'Isolar a área com cones e fita zebrada, revisar o poste, amarrar a ' +
      'escada, subir com trava-quedas e emendar a CTO.',
    gravidade: GravidadeApr.ALTA,
    orientacoes: 'Verificar a OS emitida pelo setor de serviços de suporte.',
    planoResgate: 'SAMU 192. Isolar a área e afastar curiosos.',
    telefonesEmergencia: 'SAMU 192 · Bombeiros 193 · ILNET (99) 98476-8237',
    criadoPorNome: 'João da Silva',
    supervisorNome: null,
    supervisorAssinatura: null,
    supervisorEm: null,
    status: StatusApr.LIBERADA,
    motivoCancelamento: null,
    respostas: [
      {
        categoria: CategoriaItemApr.NORMA,
        texto: 'NR-35',
        marcado: true,
        resposta: null,
        detalhe: null,
      },
      {
        categoria: CategoriaItemApr.ATIVIDADE,
        texto: 'Manutenção de Redes',
        marcado: true,
        resposta: null,
        detalhe: null,
      },
      {
        categoria: CategoriaItemApr.RISCO,
        texto: 'Quedas de altura',
        marcado: true,
        resposta: null,
        detalhe: null,
      },
      {
        categoria: CategoriaItemApr.RISCO,
        texto: 'Outros, quais?',
        marcado: true,
        resposta: null,
        detalhe: 'Cão solto no terreno vizinho',
      },
      {
        categoria: CategoriaItemApr.PROTECAO,
        texto: 'Capacete com jugular',
        marcado: true,
        resposta: null,
        detalhe: null,
      },
      {
        categoria: CategoriaItemApr.RELATO,
        texto: 'As condições atmosféricas são favoráveis?',
        marcado: false,
        resposta: RespostaRelato.SIM,
        detalhe: null,
      },
      {
        categoria: CategoriaItemApr.RELATO,
        texto: 'A área foi isolada e sinalizada?',
        marcado: false,
        resposta: RespostaRelato.NAO,
        detalhe: 'Isolamos com cones assim que o material chegou.',
      },
    ],
    executantes: [
      {
        nome: 'João da Silva',
        cpf: '123.456.789-00',
        assinaturaPng: PNG_MINIMO,
        assinadoEm: new Date('2026-08-21T11:05:00.000Z'),
        modo: ModoAssinatura.DESENHADA,
      },
      {
        nome: 'Maria Souza',
        cpf: null,
        assinaturaPng: PNG_MINIMO,
        assinadoEm: new Date('2026-08-21T11:06:00.000Z'),
        modo: ModoAssinatura.DIGITADA,
      },
    ],
    ...extra,
  };
}

/** O cabeçalho de todo PDF, e a marca de fim de arquivo. */
function pareceUmPdf(buffer: Buffer): boolean {
  return (
    buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buffer.subarray(-1024).toString('latin1').includes('%%EOF')
  );
}

/**
 * Quantas páginas o arquivo tem.
 *
 * Lido do próprio PDF (`/Type /Page`, e não `/Type /Pages`, que é a árvore).
 * Existe por causa de um erro que nenhuma outra verificação pegava: escrever o
 * rodapé abaixo da margem inferior fazia o pdfkit abrir folha nova para
 * acomodá-lo, e um documento de três páginas saía com nove — seis delas em
 * branco.
 */
function contarPaginas(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * O texto impresso, uma linha por trecho desenhado.
 *
 * O pdfkit comprime cada página e escreve o texto em hexadecimal, dentro de
 * operadores `[...] TJ` — os pedaços entre colchetes são a mesma linha partida
 * pelo ajuste entre letras. As fontes embutidas são WinAnsi, que coincide com
 * latin1 nas letras acentuadas do português (o travessão não: fica de fora das
 * comparações).
 */
function textoDoPdf(pdf: Buffer): string {
  const linhas: string[] = [];
  const bruto = pdf.toString('latin1');

  for (const stream of bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let conteudo: string;
    try {
      conteudo = zlib
        .inflateSync(Buffer.from(stream[1], 'latin1'))
        .toString('latin1');
    } catch {
      continue;
    }
    for (const tj of conteudo.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      linhas.push(
        [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)]
          .map((h) => Buffer.from(h[1], 'hex').toString('latin1'))
          .join(''),
      );
    }
  }
  return linhas.join('\n');
}

describe('gerarAprPdf', () => {
  it('desenha a APR inteira', async () => {
    const pdf = await gerarAprPdf(dados());

    expect(pareceUmPdf(pdf)).toBe(true);
    // Uma APR com timbre, sete marcações e duas assinaturas não cabe em 2 KB;
    // o número baixo é de propósito, para o teste falhar em documento vazio e
    // não a cada ajuste de layout.
    expect(pdf.length).toBeGreaterThan(2048);
  });

  it('sai igual com a supervisão assinada', async () => {
    const pdf = await gerarAprPdf(
      dados({
        supervisorNome: 'Aurélio Castro',
        supervisorAssinatura: PNG_MINIMO,
        supervisorEm: new Date('2026-08-21T18:00:00.000Z'),
      }),
    );

    expect(pareceUmPdf(pdf)).toBe(true);
  });

  it('imprime a tarja da APR cancelada', async () => {
    const pdf = await gerarAprPdf(
      dados({ status: StatusApr.CANCELADA, motivoCancelamento: 'Chuva forte, sem subida' }),
    );

    expect(pareceUmPdf(pdf)).toBe(true);
  });

  it('não quebra sem assinatura, sem CPF e sem previsão', async () => {
    const pdf = await gerarAprPdf(
      dados({
        previsaoInicio: null,
        previsaoFim: null,
        empresaCnpj: null,
        executantes: [
          {
            nome: 'Pedro Lima',
            cpf: null,
            assinaturaPng: null,
            assinadoEm: null,
            modo: ModoAssinatura.DESENHADA,
          },
        ],
      }),
    );

    expect(pareceUmPdf(pdf)).toBe(true);
  });

  it('engole assinatura ilegível em vez de derrubar o documento', async () => {
    const pdf = await gerarAprPdf(
      dados({
        executantes: [
          {
            nome: 'Pedro Lima',
            cpf: null,
            assinaturaPng: 'data:image/png;base64,nao-e-base64-de-imagem',
            assinadoEm: new Date(),
            modo: ModoAssinatura.DESENHADA,
          },
        ],
      }),
    );

    expect(pareceUmPdf(pdf)).toBe(true);
  });

  it('não sobra folha em branco por causa do rodapé', async () => {
    // Sem o texto fixo, esta APR ocupa duas páginas — a segunda termina na
    // supervisão. O erro que este teste guarda multiplicava isso por três:
    // cada rodapé escrito abaixo da margem abria uma folha nova para si.
    const pdf = await gerarAprPdf(
      dados({ orientacoes: 'Conferir a OS.', planoResgate: 'SAMU 192.' }),
    );

    expect(contarPaginas(pdf)).toBe(2);
  });

  it('vira mais de uma página quando o texto fixo é longo', async () => {
    const paragrafo = 'Isolamento da área, obrigatório em todo serviço. ';
    const pdf = await gerarAprPdf(
      dados({
        orientacoes: paragrafo.repeat(200),
        planoResgate: paragrafo.repeat(200),
      }),
    );

    expect(pareceUmPdf(pdf)).toBe(true);
    const paginas = contarPaginas(pdf);
    expect(paginas).toBeGreaterThan(1);
    // E nenhuma sobrando: dez páginas de texto corrido dão sete folhas, não
    // vinte.
    expect(paginas).toBeLessThan(10);
  });

  it('imprime inteiro o "quais?" que não cabe na coluna', async () => {
    // Na grade de três colunas cabem uns 35 caracteres; isto passa do dobro.
    const descricao =
      'Galho de mangueira encostado na rede de media tensao, lado da calcada';
    const pdf = await gerarAprPdf(
      dados({
        respostas: [
          {
            categoria: CategoriaItemApr.RISCO,
            texto: 'Outros, quais?',
            marcado: true,
            resposta: null,
            detalhe: descricao,
          },
          {
            categoria: CategoriaItemApr.RISCO,
            texto: 'Quedas de altura',
            marcado: true,
            resposta: null,
            detalhe: null,
          },
        ],
      }),
    );

    const texto = textoDoPdf(pdf);
    expect(texto).toContain(`Outros, quais: ${descricao}`);
    // E o que cabe continua na grade, do jeito de antes.
    expect(texto).toMatch(/^Quedas de altura$/m);
  });

  it('o rascunho sai marcado: tarja no alto e rodapé em toda folha', async () => {
    const pdf = await gerarAprPdf(
      dados({
        status: StatusApr.RASCUNHO,
        orientacoes: 'Isolamento da área, obrigatório. '.repeat(120),
      }),
    );

    const texto = textoDoPdf(pdf);
    expect(texto).toContain('Este papel não autoriza');
    expect(texto).toContain('APR ainda não liberada');
    expect(texto).not.toContain('em andamento');

    const paginas = contarPaginas(pdf);
    expect(paginas).toBeGreaterThan(1);
    expect(texto.match(/^RASCUNHO$/gm)).toHaveLength(paginas);
  });

  it('a cancelada não diz que o serviço está em andamento', async () => {
    const pdf = await gerarAprPdf(
      dados({
        status: StatusApr.CANCELADA,
        motivoCancelamento: 'Chuva forte o dia inteiro. '.repeat(18),
      }),
    );

    const texto = textoDoPdf(pdf);
    expect(texto).toContain('cancelada sem encerramento');
    expect(texto).not.toContain('em andamento');
    expect(texto).toMatch(/^CANCELADA$/m);
  });

  it('a liberada sem encerramento está em andamento, e sem marca', async () => {
    const texto = textoDoPdf(await gerarAprPdf(dados()));

    expect(texto).toContain('em andamento');
    expect(texto).not.toMatch(/RASCUNHO|CANCELADA/);
  });

  it('a logo está onde o desenho a procura', () => {
    // Ela é copiada para o lado do .js pelo `assets` do nest-cli.json. Sem
    // isto o PDF sai sem timbre, e a falha só apareceria no container.
    expect(fs.existsSync(path.join(__dirname, 'logo-ilnet.png'))).toBe(true);
  });
});
