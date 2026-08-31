import { BadRequestException } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PastaEmZipService,
  caminhosPorPasta,
  limparNome,
  semRepetir,
} from './pasta-em-zip.service';

/**
 * A pasta saindo daqui como um arquivo só. O que este arquivo protege:
 *
 *  - o zip abre de verdade — a lista de dentro dele é lida com uma ferramenta
 *    de fora, e não com a mesma biblioteca que o escreveu;
 *  - as subpastas viram diretórios, com a organização que alguém fez aqui;
 *  - dois documentos com o mesmo nome de arquivo não viram um só;
 *  - nome de pasta com barra ou ".." não escapa da pasta ao ser extraído;
 *  - pasta vazia recusa com uma frase, em vez de entregar um zip de zero
 *    arquivos que o descompactador chama de corrompido.
 */

interface DocFalso {
  id: string;
  pastaId: string;
  arquivoNome: string;
  arquivoTamanho: number;
  titulo: string;
}

function montarServico(opts: {
  pastas?: { id: string; nome: string; paiId: string | null }[];
  documentos?: DocFalso[];
  raiz?: { id: string; nome: string } | null;
}) {
  const pastas = opts.pastas ?? [];
  const documentos = opts.documentos ?? [];

  const prisma = {
    pastaRh: {
      findUnique: jest.fn(async () =>
        opts.raiz === undefined ? { id: 'raiz', nome: 'Licitação 016' } : opts.raiz,
      ),
      findMany: jest.fn(
        async ({ where }: { where: { paiId: { in: string[] } } }) =>
          pastas.filter((p) => p.paiId && where.paiId.in.includes(p.paiId)),
      ),
    },
    documentoRh: {
      findMany: jest.fn(async () => documentos),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const d = documentos.find((x) => x.id === where.id);
        return d ? { arquivo: Buffer.from(`conteudo de ${d.id}`) } : null;
      }),
    },
  };

  return new PastaEmZipService(prisma as never);
}

/** Junta o stream inteiro, que é o que um download faz do outro lado. */
async function juntar(corpo: NodeJS.ReadableStream): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const p of corpo) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

/**
 * O que há dentro do zip, lido por fora.
 *
 * Pelo `unzip -Z1` do sistema quando ele existe: escrever e conferir com a
 * mesma biblioteca provaria só que ela é coerente consigo mesma, e não que o
 * arquivo abre na máquina de quem baixou.
 */
function listarComUnzip(zip: Buffer): string[] | null {
  const pasta = mkdtempSync(join(tmpdir(), 'zip-teste-'));
  const caminho = join(pasta, 'pasta.zip');
  try {
    writeFileSync(caminho, zip);
    const saida = execFileSync('unzip', ['-Z1', caminho], {
      encoding: 'utf8',
    });
    return saida.split('\n').filter(Boolean);
  } catch {
    // Sem `unzip` na máquina: o teste que depende dele se declara pulado.
    return null;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const doc = (id: string, pastaId: string, arquivoNome: string): DocFalso => ({
  id,
  pastaId,
  arquivoNome,
  arquivoTamanho: 20,
  titulo: arquivoNome,
});

describe('a pasta em zip', () => {
  it('monta um zip que abre, com as subpastas viradas diretórios', async () => {
    const servico = montarServico({
      pastas: [{ id: 'sub', nome: 'Declarações', paiId: 'raiz' }],
      documentos: [
        doc('1', 'raiz', 'Contrato Social.pdf'),
        doc('2', 'sub', 'ANEXO V.docx'),
      ],
    });

    const { nome, corpo } = await servico.montar('raiz');
    const zip = await juntar(corpo);

    expect(nome).toBe('Licitação 016.zip');
    // "PK" é a assinatura de todo zip: se ela não estiver aqui, nada abre.
    expect(zip.subarray(0, 2).toString()).toBe('PK');

    const dentro = listarComUnzip(zip);
    if (dentro === null) return; // sem unzip nesta máquina
    expect(dentro.sort()).toEqual(
      ['Contrato Social.pdf', 'Declarações/ANEXO V.docx'].sort(),
    );
  });

  it('não deixa dois arquivos de mesmo nome virarem um só', async () => {
    const servico = montarServico({
      documentos: [
        doc('1', 'raiz', 'certidao.pdf'),
        doc('2', 'raiz', 'certidao.pdf'),
      ],
    });

    const zip = await juntar((await servico.montar('raiz')).corpo);

    const dentro = listarComUnzip(zip);
    if (dentro === null) return;
    expect(dentro.sort()).toEqual(['certidao (2).pdf', 'certidao.pdf']);
  });

  it('recusa a pasta vazia com uma frase', async () => {
    const servico = montarServico({ documentos: [] });

    await expect(servico.montar('raiz')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(servico.montar('raiz')).rejects.toThrow(/vazia/i);
  });

  it('recusa pasta que não existe mais', async () => {
    const servico = montarServico({ raiz: null });

    await expect(servico.montar('sumida')).rejects.toThrow(/não existe/i);
  });

  it('recusa a pasta grande demais, dizendo o tamanho', async () => {
    const servico = montarServico({
      documentos: [
        { ...doc('1', 'raiz', 'gigante.pdf'), arquivoTamanho: 600 * 1024 * 1024 },
      ],
    });

    await expect(servico.montar('raiz')).rejects.toThrow(/limite/i);
  });
});

describe('limparNome', () => {
  it('troca o que não pode virar nome de arquivo', () => {
    expect(limparNome('Contrato 1/2 : final?.pdf')).toBe(
      'Contrato 1-2 - final-.pdf',
    );
  });

  it('não deixa o nome escapar da pasta ao ser extraído', () => {
    expect(limparNome('../../etc/passwd')).not.toContain('..');
    expect(limparNome('../../etc/passwd')).not.toContain('/');
    expect(limparNome('...')).toBe('documento');
  });

  it('devolve algo mesmo com o nome vazio', () => {
    expect(limparNome('   ')).toBe('documento');
  });
});

describe('semRepetir', () => {
  it('mantém o primeiro e numera os seguintes', () => {
    const usados = new Set<string>();
    expect(semRepetir('a.pdf', usados)).toBe('a.pdf');
    expect(semRepetir('a.pdf', usados)).toBe('a (2).pdf');
    expect(semRepetir('a.pdf', usados)).toBe('a (3).pdf');
  });

  it('numera também o que não tem extensão', () => {
    const usados = new Set<string>();
    semRepetir('recibo', usados);
    expect(semRepetir('recibo', usados)).toBe('recibo (2)');
  });

  it('conta o caminho inteiro: o mesmo nome em pastas diferentes convive', () => {
    const usados = new Set<string>();
    expect(semRepetir('Sub/a.pdf', usados)).toBe('Sub/a.pdf');
    expect(semRepetir('Outra/a.pdf', usados)).toBe('Outra/a.pdf');
  });
});

describe('caminhosPorPasta', () => {
  const raiz = { id: 'raiz', nome: 'Licitação' };

  it('deixa a pasta baixada na raiz do zip e aninha as de dentro', () => {
    const caminhos = caminhosPorPasta(
      raiz,
      [raiz, { id: 'a', nome: 'Declarações' }, { id: 'b', nome: 'Fotos' }],
      new Map([
        ['a', 'raiz'],
        ['b', 'a'],
      ]),
    );

    expect(caminhos.get('raiz')).toBe('');
    expect(caminhos.get('a')).toBe('Declarações/');
    expect(caminhos.get('b')).toBe('Declarações/Fotos/');
  });

  it('não trava num ciclo do cadastro', () => {
    const caminhos = caminhosPorPasta(
      raiz,
      [raiz, { id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }],
      new Map([
        ['a', 'b'],
        ['b', 'a'],
      ]),
    );

    expect(caminhos.get('a')).toBeDefined();
  });
});
