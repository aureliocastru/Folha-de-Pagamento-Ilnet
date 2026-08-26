import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * O que o LibreOffice sabe abrir e que vale a pena virar PDF.
 *
 * PDF não entra (já é), imagem não entra (virar PDF de uma foto não ajuda
 * ninguém a ler o papel) e texto puro não entra (converter um .txt em PDF é
 * trabalho para não ganhar nada).
 */
const CONVERSIVEIS = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Quanto se espera pelo LibreOffice antes de desistir.
 *
 * A primeira conversão depois de o contêiner subir é a lenta: ele monta o
 * perfil do usuário do zero. As seguintes são de um a três segundos. O teto
 * está aqui para um arquivo estranho não segurar a requisição para sempre —
 * quem sobe o documento prefere guardá-lo em Word a esperar um minuto e meio.
 */
const TETO_MS = 90_000;

/** O que sai da tentativa: ou o PDF, ou o motivo de não ter dado. */
export type ResultadoDaConversao =
  | { convertido: true; pdf: Buffer }
  | { convertido: false; motivo: string };

export function podeVirarPdf(tipo: string): boolean {
  return CONVERSIVEIS.has(tipo);
}

/**
 * Word (e planilha) virando PDF, pelo LibreOffice.
 *
 * A conversão é de propósito **um serviço à parte e que nunca lança**: quem
 * chama recebe "deu" ou "não deu, por isto", e guarda o original quando não
 * deu. Um documento de licitação que não sobe porque o conversor caiu é pior
 * que um documento em Word na pasta — o prazo do edital não espera o servidor.
 *
 * O binário pode simplesmente não existir: a imagem da API pode subir sem o
 * LibreOffice (ele pesa, e nem toda instalação vai querer). Nesse caso a
 * resposta diz isso com todas as letras, em vez de o arquivo sumir ou o upload
 * falhar sem explicação.
 */
@Injectable()
export class ConversaoPdfService {
  private readonly logger = new Logger(ConversaoPdfService.name);

  /** O binário. Trocável pelo ambiente para quem o tem noutro caminho. */
  private readonly binario = process.env.LIBREOFFICE_BIN ?? 'soffice';

  async paraPdf(
    conteudo: Buffer,
    nomeOriginal: string,
  ): Promise<ResultadoDaConversao> {
    // O LibreOffice decide o filtro pela extensão do arquivo de entrada, e não
    // pelo conteúdo: sem ela ele abre o .docx como texto puro e devolve um PDF
    // com o XML dentro.
    const extensao = extensaoDe(nomeOriginal);
    if (!extensao) {
      return {
        convertido: false,
        motivo: 'o arquivo chegou sem extensão no nome',
      };
    }

    const pasta = await mkdtemp(join(tmpdir(), 'converte-'));
    try {
      const entrada = join(pasta, `documento${extensao}`);
      await writeFile(entrada, conteudo);

      const erro = await this.rodar(entrada, pasta);
      if (erro) return { convertido: false, motivo: erro };

      try {
        const pdf = await readFile(join(pasta, 'documento.pdf'));
        // Página em branco não é conversão: é o LibreOffice tendo aberto o
        // arquivo e não entendido nada dele.
        if (pdf.length < 1000) {
          return {
            convertido: false,
            motivo: 'a conversão saiu vazia',
          };
        }
        return { convertido: true, pdf };
      } catch {
        return {
          convertido: false,
          motivo: 'o LibreOffice terminou sem escrever o PDF',
        };
      }
    } finally {
      // A limpeza é melhor-esforço: não conseguir apagar a pasta temporária
      // não pode desfazer uma conversão que deu certo.
      await rm(pasta, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`Sobrou a pasta ${pasta}: ${String(err)}`);
      });
    }
  }

  /** Roda o conversor. Devolve `null` quando deu certo, ou o motivo. */
  private rodar(entrada: string, pasta: string): Promise<string | null> {
    return new Promise((resolve) => {
      /*
       * `-env:UserInstallation` aponta o perfil para a pasta temporária.
       *
       * Sem isso o LibreOffice escreve em `$HOME/.config`, que no contêiner ou
       * não existe ou é a mesma pasta para todas as conversões — e duas ao
       * mesmo tempo travam uma na outra esperando o mesmo perfil. Uma pasta por
       * conversão é o que deixa dois uploads simultâneos não se atropelarem.
       */
      const processo = spawn(
        this.binario,
        [
          '--headless',
          '--norestore',
          '--nolockcheck',
          `-env:UserInstallation=file://${pasta}/perfil`,
          '--convert-to',
          'pdf',
          '--outdir',
          pasta,
          entrada,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let saida = '';
      processo.stdout?.on('data', (d: Buffer) => (saida += d.toString()));
      processo.stderr?.on('data', (d: Buffer) => (saida += d.toString()));

      const relogio = setTimeout(() => {
        processo.kill('SIGKILL');
        resolve(`a conversão passou de ${TETO_MS / 1000} segundos`);
      }, TETO_MS);

      processo.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(relogio);
        if (err.code === 'ENOENT') {
          this.logger.warn(
            `O conversor não está instalado nesta máquina (${this.binario}).`,
          );
          resolve('o LibreOffice não está instalado no servidor');
          return;
        }
        resolve(err.message);
      });

      processo.on('close', (codigo) => {
        clearTimeout(relogio);
        if (codigo === 0) {
          resolve(null);
          return;
        }
        this.logger.warn(
          `O conversor saiu com código ${codigo}: ${saida.trim().slice(0, 400)}`,
        );
        resolve(`o LibreOffice recusou o arquivo (código ${codigo})`);
      });
    });
  }
}

/** ".docx" de "Proposta comercial.docx". Vazio quando não há extensão. */
export function extensaoDe(nome: string): string | null {
  const ponto = nome.lastIndexOf('.');
  if (ponto <= 0 || ponto === nome.length - 1) return null;
  const extensao = nome.slice(ponto).toLowerCase();
  // O que vai virar caminho de arquivo não pode trazer barra nem espaço de
  // dentro do nome: o que se aceita aqui é ".docx", e não ".do cx/../x".
  return /^\.[a-z0-9]{1,8}$/.test(extensao) ? extensao : null;
}

/** "Proposta.docx" → "Proposta.pdf". */
export function nomeComoPdf(nome: string): string {
  const extensao = extensaoDe(nome);
  return extensao ? `${nome.slice(0, -extensao.length)}.pdf` : `${nome}.pdf`;
}
