/** Uma tabela do banco e quantos registros ela tem. */
export interface TabelaContada {
  tabela: string;
  registros: number;
}

/** O que há no banco num instante: é o que vai no backup, tabela por tabela. */
export interface Conferencia {
  contadoEm: string;
  banco: string;
  versaoDoPostgres: string;
  versaoMaior: number;
  tamanhoBytes: number;
  /** A migração mais nova aplicada: em que versão do sistema o banco está. */
  ultimaMigracao: string | null;
  tabelas: TabelaContada[];
  totalDeRegistros: number;
}

const FUSO = 'America/Sao_Paulo';

/** "backup-ilnet-2026-11-04-15h30.zip", na hora de Brasília. */
export function nomeDoArquivo(quando: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(quando)
      .map((x) => [x.type, x.value]),
  );
  return `backup-ilnet-${p.year}-${p.month}-${p.day}-${p.hour}h${p.minute}.zip`;
}

/** 1234567 → "1,2 MB". */
export function tamanhoLegivel(bytes: number): string {
  const unidades = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const casas = i === 0 || valor >= 100 ? 0 : 1;
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })} ${unidades[i]}`;
}

const numero = (n: number) => n.toLocaleString('pt-BR');

/**
 * A conferência que vai dentro do zip, para ser lida por gente.
 *
 * É o que se compara depois de restaurar: cada tabela tem de voltar com o
 * mesmo número de registros. O `conferencia.json` ao lado diz o mesmo para
 * quem confere por programa.
 */
export function textoDaConferencia(c: Conferencia, quem: string): string {
  const quando = new Date(c.contadoEm);
  const data = quando.toLocaleDateString('pt-BR', { timeZone: FUSO });
  const hora = quando.toLocaleTimeString('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
  });

  const largura = Math.max(30, ...c.tabelas.map((t) => t.tabela.length)) + 2;
  const coluna = 12;
  const linha = (nome: string, valor: string) => nome.padEnd(largura) + valor.padStart(coluna);
  const fio = '-'.repeat(largura + coluna);

  return [
    'BACKUP COMPLETO DO ILNET FINANCE',
    '',
    `Gerado em ${data} às ${hora} por ${quem}.`,
    `Banco "${c.banco}", PostgreSQL ${c.versaoDoPostgres}, ${tamanhoLegivel(c.tamanhoBytes)} em disco.`,
    `Versão do sistema (última migração): ${c.ultimaMigracao ?? '—'}`,
    '',
    `${numero(c.tabelas.length)} tabelas e ${numero(c.totalDeRegistros)} registros, contados no mesmo`,
    'instante em que o banco foi copiado para o banco.dump. Depois de restaurar,',
    'cada tabela tem de ter exatamente o número de registros que está aqui.',
    '',
    linha('Tabela', 'Registros'),
    fio,
    ...c.tabelas.map((t) => linha(t.tabela, numero(t.registros))),
    fio,
    linha('Total', numero(c.totalDeRegistros)),
    '',
    'Para restaurar num PostgreSQL novo e vazio:',
    '  pg_restore --no-owner --no-privileges -d BANCO banco.dump',
    '',
  ].join('\r\n');
}
