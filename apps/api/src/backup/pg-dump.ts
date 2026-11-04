import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const executar = promisify(execFile);

/**
 * Onde o Alpine põe cada versão do cliente do Postgres. A imagem da API
 * instala várias lado a lado (ver o Dockerfile), e cada uma mora na sua pasta.
 */
const PASTA_DAS_VERSOES = '/usr/libexec';

/** Um `pg_dump` achado na máquina, com a versão maior dele. */
export interface PgDump {
  caminho: string;
  versao: number;
}

/**
 * Os `pg_dump` que existem aqui: um por versão do Alpine, e o do PATH (que é
 * o que há na máquina de quem desenvolve).
 */
export async function pgDumpsInstalados(): Promise<PgDump[]> {
  const candidatos: string[] = [];
  try {
    for (const nome of readdirSync(PASTA_DAS_VERSOES)) {
      if (/^postgresql\d+$/.test(nome)) {
        candidatos.push(join(PASTA_DAS_VERSOES, nome, 'pg_dump'));
      }
    }
  } catch {
    // Fora do Alpine a pasta nem existe — fica o do PATH.
  }
  candidatos.push('pg_dump');

  const achados: PgDump[] = [];
  for (const caminho of candidatos) {
    try {
      const { stdout } = await executar(caminho, ['--version'], { timeout: 10_000 });
      const versao = versaoMaior(stdout);
      if (versao && !achados.some((a) => a.versao === versao)) {
        achados.push({ caminho, versao });
      }
    } catch {
      // Não existe, ou não roda: não é candidato.
    }
  }
  return achados.sort((a, b) => a.versao - b.versao);
}

/** "pg_dump (PostgreSQL) 17.4" → 17. */
export function versaoMaior(texto: string): number | null {
  const m = /(\d+)(?:\.\d+)?/.exec(texto.replace(/^[^)]*\)/, ''));
  return m ? Number(m[1]) : null;
}

/**
 * O `pg_dump` certo para o banco: o da mesma versão maior que ele.
 *
 * Mais novo também copia, mas o arquivo sai num formato que o `pg_restore`
 * do banco antigo não lê — e o servidor novo pode nascer com a mesma versão do
 * antigo. Mais velho não serve nunca: o `pg_dump` recusa banco mais novo que
 * ele. Sem o igual, vai o mais novo que serve.
 */
export function escolherPgDump(instalados: PgDump[], versaoDoBanco: number): PgDump | null {
  const igual = instalados.find((p) => p.versao === versaoDoBanco);
  if (igual) return igual;
  return instalados.find((p) => p.versao > versaoDoBanco) ?? null;
}

/**
 * A conexão do `pg_dump`, tirada da `DATABASE_URL` do Prisma.
 *
 * Vai por variável de ambiente, e não pela URL na linha de comando: a senha
 * não aparece na lista de processos, e o `?schema=public` do Prisma — que o
 * `pg_dump` recusa como parâmetro desconhecido — fica para trás.
 */
export function conexaoDoPgDump(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const ssl = url.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}
