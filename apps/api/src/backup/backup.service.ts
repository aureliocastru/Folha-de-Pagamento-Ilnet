import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import type { Response } from 'express';
import { ZipFile } from 'yazl';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import {
  conexaoDoPgDump,
  escolherPgDump,
  pgDumpsInstalados,
  type PgDump,
} from './pg-dump';
import {
  nomeDoArquivo,
  textoDaConferencia,
  type Conferencia,
  type TabelaContada,
} from './conferencia';

/** Um backup saindo, ou que já saiu. */
export interface AndamentoDoBackup {
  id: string;
  status: 'gerando' | 'completo' | 'falhou' | 'interrompido';
  arquivo: string;
  quem: string;
  iniciadoEm: string;
  terminadoEm: string | null;
  /** Quanto do arquivo já saiu daqui. */
  bytes: number;
  tabelas: number;
  registros: number;
  /** Quantas tabelas o `pg_dump` já copiou, e qual está copiando agora. */
  tabelasCopiadas: number;
  copiando: string | null;
  erro: string | null;
}

/** O bilhete que deixa o navegador baixar o arquivo sem o token. */
interface Bilhete {
  quem: string;
  venceEm: number;
}

/** Quanto tempo o bilhete vale: o clique e o download são seguidos. */
const VALIDADE_DO_BILHETE_MS = 2 * 60_000;

/** Quantos backups a tela mostra (o que saiu desde que a API subiu). */
const GUARDADOS = 10;

/**
 * Uma transação aberta pelo tempo da cópia inteira. Doze horas não é a
 * estimativa — é o teto para o Prisma não derrubar no meio um backup lento.
 */
const TETO_DA_COPIA_MS = 12 * 60 * 60_000;

/**
 * O backup do banco inteiro, num arquivo só.
 *
 * O banco é tudo o que este sistema guarda: os documentos do RH, os arquivos
 * da contabilidade e dos patrocinados são colunas `Bytes`, as fotos são data
 * URLs, e não há pasta de uploads no disco do servidor (ver
 * `MIGRAR-DE-SERVIDOR.md`). Então o backup é o `pg_dump` do banco — todas as
 * tabelas, inclusive a das migrações, que é o que diz ao servidor novo em que
 * versão do sistema o banco está.
 *
 * Sai num zip com a conferência junto: cada tabela com o número de registros,
 * contados na mesma foto do banco que o `pg_dump` copia (`pg_export_snapshot`).
 * Quem estiver lançando durante o backup não desencontra os números — o que
 * entrou depois da foto não está no arquivo e também não está na contagem.
 *
 * Nada passa pelo disco: o `pg_dump` escreve, o zip embrulha e a resposta
 * leva, tudo em fluxo. O disco do servidor antigo está cheio, e é justamente
 * dele que este arquivo precisa sair.
 *
 * Arquivo incompleto nunca chega como completo: se o `pg_dump` falhar no meio,
 * a conexão é cortada antes do fim do zip, e o navegador mostra o download
 * como falho em vez de guardar um arquivo pela metade.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly bilhetes = new Map<string, Bilhete>();
  private readonly historico: AndamentoDoBackup[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** O que vai no backup, contado agora. */
  async conferencia(): Promise<Conferencia & { pgDump: number | null }> {
    const conferencia = await this.prisma.$transaction(
      (tx) => this.contar(tx),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 5 * 60_000,
      },
    );
    const pgDump = escolherPgDump(await pgDumpsInstalados(), conferencia.versaoMaior);
    return { ...conferencia, pgDump: pgDump?.versao ?? null };
  }

  /** Os backups desde que a API subiu, o mais novo primeiro. */
  andamento(): AndamentoDoBackup[] {
    return this.historico;
  }

  /**
   * O bilhete do download.
   *
   * O download vai pelo gerenciador do navegador, e não pela tela: um banco de
   * gigabytes não cabe na memória da aba, e é o navegador que sabe gravar em
   * disco aos pedaços, mostrar o progresso e acusar quando a conexão cai. Só
   * que o link aberto assim não leva o token — leva este bilhete, que vale uma
   * vez e por dois minutos.
   *
   * O que dá para conferir antes é conferido aqui, para o erro voltar à tela
   * e não virar um download falho sem explicação.
   */
  async emitirBilhete(quem: string): Promise<{ bilhete: string }> {
    if (this.historico.some((a) => a.status === 'gerando')) {
      throw new ConflictException('Já tem um backup saindo agora. Espere ele terminar.');
    }
    await this.pgDumpDoBanco();

    const agora = Date.now();
    for (const [chave, b] of this.bilhetes) {
      if (b.venceEm < agora) this.bilhetes.delete(chave);
    }
    const bilhete = randomBytes(24).toString('base64url');
    this.bilhetes.set(bilhete, { quem, venceEm: agora + VALIDADE_DO_BILHETE_MS });
    return { bilhete };
  }

  /** Gera o backup e o manda pela resposta. */
  async gerar(bilhete: string, res: Response): Promise<void> {
    const b = this.bilhetes.get(bilhete);
    this.bilhetes.delete(bilhete);
    if (!b || b.venceEm < Date.now()) {
      throw new UnauthorizedException(
        'Este link de backup já foi usado ou venceu. Clique em "Fazer backup" de novo.',
      );
    }
    if (this.historico.some((a) => a.status === 'gerando')) {
      throw new ConflictException('Já tem um backup saindo agora. Espere ele terminar.');
    }
    const pgDump = await this.pgDumpDoBanco();

    const agora = new Date();
    const a: AndamentoDoBackup = {
      id: randomBytes(8).toString('hex'),
      status: 'gerando',
      arquivo: nomeDoArquivo(agora),
      quem: b.quem,
      iniciadoEm: agora.toISOString(),
      terminadoEm: null,
      bytes: 0,
      tabelas: 0,
      registros: 0,
      tabelasCopiadas: 0,
      copiando: null,
      erro: null,
    };
    this.historico.unshift(a);
    this.historico.splice(GUARDADOS);
    this.logger.log(`Backup ${a.arquivo} começou (pedido por ${a.quem}, pg_dump ${pgDump.versao}).`);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // A foto do banco: a contagem abaixo e o pg_dump enxergam a mesma.
          const [{ foto }] = await tx.$queryRaw<Array<{ foto: string }>>`
            SELECT pg_export_snapshot() AS foto`;
          const conferencia = await this.contar(tx);
          a.tabelas = conferencia.tabelas.length;
          a.registros = conferencia.totalDeRegistros;
          // A transação fica aberta até o fim da cópia: a foto só vale enquanto
          // ela existir.
          await this.transmitir(a, conferencia, pgDump, foto, res);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: TETO_DA_COPIA_MS,
          maxWait: 30_000,
        },
      );
      this.logger.log(
        `Backup ${a.arquivo} completo: ${a.bytes} bytes, ${a.tabelas} tabelas, ${a.registros} registros.`,
      );
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      if (a.status === 'gerando') {
        a.status = 'falhou';
        a.erro = motivo;
      }
      a.terminadoEm ??= new Date().toISOString();
      a.copiando = null;
      this.logger.error(`Backup ${a.arquivo} não terminou: ${a.erro ?? motivo}`);
      // Começada a resposta, o que resta é cortá-la — o que já foi feito.
      if (!res.headersSent) throw e;
    }
  }

  /** O `pg_dump` que serve para este banco, ou o motivo de não haver. */
  private async pgDumpDoBanco(): Promise<PgDump> {
    const versao = await this.versaoMaiorDoBanco();
    const instalados = await pgDumpsInstalados();
    const escolhido = escolherPgDump(instalados, versao);
    if (!escolhido) {
      throw new ServiceUnavailableException(
        instalados.length === 0
          ? 'O servidor não tem o pg_dump instalado — o backup depende dele.'
          : `O banco é PostgreSQL ${versao}, e o servidor só tem o pg_dump ` +
              `${instalados.map((p) => p.versao).join(', ')}.`,
      );
    }
    return escolhido;
  }

  private async versaoMaiorDoBanco(): Promise<number> {
    const [{ versao }] = await this.prisma.$queryRaw<Array<{ versao: string }>>`
      SELECT current_setting('server_version_num') AS versao`;
    return Math.floor(Number(versao) / 10_000);
  }

  /**
   * Cada tabela do banco com o número de registros.
   *
   * Todas as tabelas, e não só as que o Prisma conhece: a das migrações entra,
   * e uma tabela criada à mão algum dia também — o `pg_dump` copia as duas, e
   * a conferência tem de enxergar o mesmo que ele.
   */
  private async contar(tx: Prisma.TransactionClient): Promise<Conferencia> {
    const tabelas = await tx.$queryRaw<Array<{ esquema: string; nome: string }>>`
      SELECT n.nspname AS esquema, c.relname AS nome
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg\\_toast%'
         AND n.nspname NOT LIKE 'pg\\_temp%'
       ORDER BY n.nspname, c.relname`;

    const contadas: TabelaContada[] = [];
    for (const t of tabelas) {
      const [{ n }] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${identificador(t.esquema)}.${identificador(t.nome)}`,
      );
      contadas.push({
        tabela: t.esquema === 'public' ? t.nome : `${t.esquema}.${t.nome}`,
        registros: Number(n),
      });
    }

    const [info] = await tx.$queryRaw<
      Array<{ banco: string; versao: string; versaoNum: string; tamanho: bigint }>
    >`
      SELECT current_database() AS banco,
             current_setting('server_version') AS versao,
             current_setting('server_version_num') AS "versaoNum",
             pg_database_size(current_database()) AS tamanho`;

    let ultimaMigracao: string | null = null;
    if (contadas.some((t) => t.tabela === '_prisma_migrations')) {
      const [m] = await tx.$queryRaw<Array<{ nome: string }>>`
        SELECT migration_name AS nome FROM _prisma_migrations
         WHERE finished_at IS NOT NULL
         ORDER BY migration_name DESC LIMIT 1`;
      ultimaMigracao = m?.nome ?? null;
    }

    return {
      contadoEm: new Date().toISOString(),
      banco: info.banco,
      versaoDoPostgres: info.versao,
      versaoMaior: Math.floor(Number(info.versaoNum) / 10_000),
      tamanhoBytes: Number(info.tamanho),
      ultimaMigracao,
      tabelas: contadas,
      totalDeRegistros: contadas.reduce((s, t) => s + t.registros, 0),
    };
  }

  /**
   * O zip saindo pela resposta: a conferência primeiro, o banco depois.
   *
   * Resolve quando o último byte saiu daqui; rejeita se o `pg_dump` falhar ou
   * se a conexão cair antes — e nos dois casos a resposta é cortada, para o
   * arquivo pela metade não parecer inteiro.
   */
  private transmitir(
    a: AndamentoDoBackup,
    conferencia: Conferencia,
    pgDump: PgDump,
    foto: string,
    res: Response,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.getOrThrow<AppConfig['databaseUrl']>('databaseUrl');
      const proc = spawn(
        pgDump.caminho,
        [
          '--format=custom',
          `--snapshot=${foto}`,
          '--verbose',
          '--no-password',
          // Preso atrás de uma alteração de tabela, desiste em vez de esperar
          // para sempre.
          '--lock-wait-timeout=60000',
        ],
        {
          env: { ...process.env, ...conexaoDoPgDump(url), PGAPPNAME: 'backup-ilnet' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      const errosDoPgDump: string[] = [];
      createInterface({ input: proc.stderr }).on('line', (linha) => {
        const tabela = /dumping contents of table "(.+)"/.exec(linha);
        if (tabela) {
          a.tabelasCopiadas += 1;
          a.copiando = tabela[1].replace(/^public\./, '');
        } else if (/error|fatal|could not/i.test(linha)) {
          errosDoPgDump.push(linha.replace(/^pg_dump:\s*/, ''));
        }
      });

      // O banco só é dado por terminado quando o pg_dump sai sem erro. Ligado
      // direto, o fim da saída dele fecharia o zip mesmo depois de uma falha.
      const banco = new PassThrough();
      proc.stdout.pipe(banco, { end: false });

      const zip = new ZipFile();
      zip.addBuffer(Buffer.from(textoDaConferencia(conferencia, a.quem), 'utf8'), 'conferencia.txt');
      zip.addBuffer(Buffer.from(JSON.stringify(conferencia, null, 2), 'utf8'), 'conferencia.json');
      // Sem compactar de novo: o formato do pg_dump já sai comprimido.
      zip.addReadStream(banco, 'banco.dump', { compress: false });
      zip.end();

      let acabou = false;
      const terminar = (status: AndamentoDoBackup['status'], erro: string | null) => {
        if (acabou) return false;
        acabou = true;
        a.status = status;
        a.erro = erro;
        a.copiando = null;
        a.terminadoEm = new Date().toISOString();
        return true;
      };
      const falhar = (status: 'falhou' | 'interrompido', erro: string) => {
        if (!terminar(status, erro)) return;
        proc.kill();
        res.destroy();
        reject(new Error(erro));
      };

      proc.on('error', (e) => falhar('falhou', `não deu para rodar o pg_dump (${e.message}).`));
      proc.on('close', (codigo, sinal) => {
        if (codigo === 0) {
          banco.end();
          return;
        }
        const detalhe = errosDoPgDump.slice(-3).join(' ') || `saiu com ${codigo ?? sinal}`;
        falhar('falhou', `o pg_dump parou no meio (${detalhe}).`);
      });

      res.on('finish', () => {
        if (terminar('completo', null)) resolve();
      });
      res.on('close', () => falhar('interrompido', 'a conexão caiu antes do fim.'));

      res.status(200).set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${a.arquivo}"`,
        // O banco é da casa: nenhum intermediário guarda cópia.
        'Cache-Control': 'private, no-store',
        // O nginx da web, por padrão, guarda a resposta em disco quando o
        // navegador lê mais devagar do que a API escreve — e é o disco cheio.
        'X-Accel-Buffering': 'no',
      });
      zip.outputStream.on('data', (pedaco: Buffer) => {
        a.bytes += pedaco.length;
      });
      zip.outputStream.pipe(res);
    });
  }
}

/** Nome de tabela ou esquema dentro do SQL, entre aspas. */
function identificador(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}
