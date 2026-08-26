import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Quanto a pasta pode pesar antes de o download ser recusado.
 *
 * O zip é montado lendo os arquivos do banco um a um, então o teto não é de
 * memória — é de paciência e de rede. Uma pasta acima disto quase sempre é a
 * pasta errada (a raiz da estante, com a casa inteira dentro), e recusar com um
 * número é melhor que entregar uma hora de download que ninguém pediu.
 */
const TETO_BYTES = 500 * 1024 * 1024;

/** Quantos documentos entram num zip. O mesmo motivo do teto de bytes. */
const TETO_DE_ARQUIVOS = 2000;

/** Uma pasta com o nome dela e o que há dentro. */
interface PastaComNome {
  id: string;
  nome: string;
}

/**
 * A pasta inteira num arquivo só.
 *
 * É o que a licitação pede: o pacote que vai ser entregue existe como pasta
 * aqui e precisa sair daqui como um arquivo — baixar quarenta documentos um a
 * um, pelo botão "Ver" de cada linha, é o caminho que existia.
 *
 * As subpastas viram diretórios dentro do zip, com o mesmo nome que têm aqui:
 * quem baixa a pasta da licitação recebe "Declarações/", "Balanços/" e o resto
 * já separado, que é a organização que alguém fez aqui dentro e que se perderia
 * num despejo de arquivos soltos.
 *
 * Nada é compactado de verdade: PDF, .docx e foto já são formatos comprimidos, e
 * passá-los pelo deflate custa processador para economizar quase nada. O zip
 * aqui é embrulho, não compressão.
 */
@Injectable()
export class PastaEmZipService {
  private readonly logger = new Logger(PastaEmZipService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monta o zip da pasta e devolve o stream, com o nome do arquivo.
   *
   * O stream começa a sair antes de o último documento ter sido lido: o zip é
   * escrito enquanto o banco é percorrido, e é isso que deixa uma pasta de
   * trezentos megabytes não virar trezentos megabytes de memória.
   */
  async montar(pastaId: string): Promise<{ nome: string; corpo: Readable }> {
    const raiz = await this.prisma.pastaRh.findUnique({
      where: { id: pastaId },
      select: { id: true, nome: true },
    });
    if (!raiz) throw new BadRequestException('Esta pasta não existe mais.');

    const { pastas, pais } = await this.arvore(raiz);

    const documentos = await this.prisma.documentoRh.findMany({
      where: { pastaId: { in: pastas.map((p) => p.id) } },
      select: {
        id: true,
        pastaId: true,
        arquivoNome: true,
        arquivoTamanho: true,
      },
      orderBy: [{ pastaId: 'asc' }, { titulo: 'asc' }],
    });

    if (documentos.length === 0) {
      throw new BadRequestException(
        'Esta pasta está vazia — não há o que baixar.',
      );
    }
    if (documentos.length > TETO_DE_ARQUIVOS) {
      throw new BadRequestException(
        `Esta pasta tem ${documentos.length} documentos, acima do limite de ` +
          `${TETO_DE_ARQUIVOS} por download. Baixe as subpastas separadamente.`,
      );
    }

    const total = documentos.reduce((s, d) => s + d.arquivoTamanho, 0);
    if (total > TETO_BYTES) {
      throw new BadRequestException(
        `Esta pasta tem ${Math.round(total / 1024 / 1024)} MB, acima do limite ` +
          `de ${Math.round(TETO_BYTES / 1024 / 1024)} MB por download. Baixe as ` +
          'subpastas separadamente.',
      );
    }

    const caminhos = caminhosPorPasta(raiz, pastas, pais);
    const zip = new ZipFile();
    const usados = new Set<string>();
    // O `outputStream` do yazl é um Readable do Node; a tipagem dele o declara
    // com a interface mínima, e é por ela que o `destroy` some.
    const saida = zip.outputStream as unknown as Readable;

    // A leitura roda por fora do `await` desta função de propósito: quem chamou
    // recebe o stream agora e começa a mandar bytes para o navegador, enquanto
    // os documentos ainda estão sendo lidos do banco.
    void this.encher(zip, documentos, caminhos, usados).catch((err) => {
      this.logger.error(
        `Falha ao montar o zip da pasta ${pastaId}: ${String(err)}`,
      );
      // O stream morre com erro: melhor um download interrompido que um zip
      // completo com documento faltando dentro e ninguém sabendo qual.
      saida.destroy(err instanceof Error ? err : new Error(String(err)));
    });

    this.logger.log(
      `Zip da pasta "${raiz.nome}": ${documentos.length} documento(s), ` +
        `${Math.round(total / 1024)} KB.`,
    );

    return { nome: `${limparNome(raiz.nome)}.zip`, corpo: saida };
  }

  /** Lê documento por documento e escreve cada um no zip. */
  private async encher(
    zip: ZipFile,
    documentos: { id: string; pastaId: string; arquivoNome: string }[],
    caminhos: Map<string, string>,
    usados: Set<string>,
  ) {
    for (const d of documentos) {
      const doc = await this.prisma.documentoRh.findUnique({
        where: { id: d.id },
        select: { arquivo: true },
      });
      // Apagado entre a listagem e a leitura: o zip sai sem ele, e não quebra.
      if (!doc) continue;

      const dentro = caminhos.get(d.pastaId) ?? '';
      zip.addBuffer(
        Buffer.from(doc.arquivo),
        semRepetir(dentro + limparNome(d.arquivoNome), usados),
        // `compress: false`: ver o comentário da classe.
        { compress: false },
      );
    }
    zip.end();
  }

  /**
   * A pasta e tudo que está abaixo dela, em largura.
   *
   * Devolve também quem é pai de quem, e nada fica guardado no serviço: ele é
   * um singleton, e dois downloads ao mesmo tempo escreveriam um por cima do
   * outro — o segundo receberia a árvore do primeiro.
   */
  private async arvore(
    raiz: PastaComNome,
  ): Promise<{ pastas: PastaComNome[]; pais: Map<string, string> }> {
    const pastas: PastaComNome[] = [raiz];
    const pais = new Map<string, string>();
    let fronteira = [raiz.id];

    // Em níveis, e não com recursão por pasta: a estante tem dezenas de pastas
    // e uma consulta por pasta seria dezenas de idas ao banco para montar uma
    // árvore que cabe em três.
    while (fronteira.length > 0) {
      const filhas = await this.prisma.pastaRh.findMany({
        where: { paiId: { in: fronteira } },
        select: { id: true, nome: true, paiId: true },
      });
      if (filhas.length === 0) break;

      for (const f of filhas) {
        pastas.push({ id: f.id, nome: f.nome });
        if (f.paiId) pais.set(f.id, f.paiId);
      }
      fronteira = filhas.map((f) => f.id);
    }

    return { pastas, pais };
  }
}

/**
 * O prefixo de cada pasta dentro do zip ("Declarações/", "Anexos/Fotos/").
 *
 * A pasta que se está baixando não vira diretório: o zip já tem o nome dela, e
 * uma pasta dentro da outra com o mesmo nome é um clique a mais para chegar ao
 * mesmo lugar.
 */
export function caminhosPorPasta(
  raiz: PastaComNome,
  pastas: PastaComNome[],
  pais: Map<string, string>,
): Map<string, string> {
  const nomes = new Map(pastas.map((p) => [p.id, p.nome]));
  const caminhos = new Map<string, string>([[raiz.id, '']]);

  for (const p of pastas) {
    if (p.id === raiz.id) continue;

    const partes: string[] = [];
    let atual: string | undefined = p.id;
    // O teto de voltas protege de um ciclo no cadastro: pasta que é avó de si
    // mesma travaria o download num laço infinito em vez de dar erro.
    for (let n = 0; atual && atual !== raiz.id && n < 50; n++) {
      partes.unshift(limparNome(nomes.get(atual) ?? 'pasta'));
      atual = pais.get(atual);
    }
    caminhos.set(p.id, partes.length > 0 ? `${partes.join('/')}/` : '');
  }

  return caminhos;
}

/**
 * Um nome que o descompactador de qualquer sistema aceite.
 *
 * Barra, dois-pontos e companhia não são só feios: `..` num nome de entrada de
 * zip é o jeito clássico de um arquivo sair da pasta em que foi extraído. O
 * nome vem do que alguém digitou na tela, então ele é tratado como texto de
 * fora mesmo tendo sido escrito aqui dentro.
 */
export function limparNome(nome: string): string {
  const limpo = nome
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return limpo.slice(0, 150) || 'documento';
}

/**
 * O mesmo nome duas vezes na mesma pasta vira "nome (2)".
 *
 * Acontece de verdade: duas certidões guardadas do mesmo portal chegam as duas
 * como "certidao.pdf". Zip com entrada repetida abre com um sobrescrevendo o
 * outro em alguns descompactadores, e é o segundo documento que desaparece sem
 * aviso.
 */
export function semRepetir(caminho: string, usados: Set<string>): string {
  if (!usados.has(caminho)) {
    usados.add(caminho);
    return caminho;
  }

  const ponto = caminho.lastIndexOf('.');
  const base = ponto > 0 ? caminho.slice(0, ponto) : caminho;
  const extensao = ponto > 0 ? caminho.slice(ponto) : '';

  for (let n = 2; n < 1000; n++) {
    const tentativa = `${base} (${n})${extensao}`;
    if (!usados.has(tentativa)) {
      usados.add(tentativa);
      return tentativa;
    }
  }

  const unico = `${base} (${Date.now()})${extensao}`;
  usados.add(unico);
  return unico;
}
