import { nomeDoArquivo, tamanhoLegivel, textoDaConferencia, type Conferencia } from './conferencia';
import { conexaoDoPgDump, escolherPgDump, versaoMaior } from './pg-dump';

describe('versaoMaior', () => {
  it('lê a versão maior da saída do pg_dump', () => {
    expect(versaoMaior('pg_dump (PostgreSQL) 17.4\n')).toBe(17);
    expect(versaoMaior('pg_dump (PostgreSQL) 16.10')).toBe(16);
    expect(versaoMaior('pg_dump (PostgreSQL) 18beta1')).toBe(18);
  });
});

describe('escolherPgDump', () => {
  const instalados = [
    { caminho: '/usr/libexec/postgresql16/pg_dump', versao: 16 },
    { caminho: '/usr/libexec/postgresql17/pg_dump', versao: 17 },
    { caminho: '/usr/libexec/postgresql18/pg_dump', versao: 18 },
  ];

  it('prefere o da mesma versão do banco', () => {
    expect(escolherPgDump(instalados, 17)?.versao).toBe(17);
  });

  it('sem o igual, vai o mais novo mais próximo', () => {
    expect(escolherPgDump(instalados, 15)?.versao).toBe(16);
  });

  it('nunca um mais velho que o banco', () => {
    expect(escolherPgDump(instalados, 19)).toBeNull();
  });
});

describe('conexaoDoPgDump', () => {
  it('tira a conexão da URL do Prisma, sem o ?schema', () => {
    expect(
      conexaoDoPgDump('postgresql://folha:s%40nh%3Aa@payments_db:5432/folha?schema=public&sslmode=disable'),
    ).toEqual({
      PGHOST: 'payments_db',
      PGPORT: '5432',
      PGUSER: 'folha',
      PGPASSWORD: 's@nh:a',
      PGDATABASE: 'folha',
      PGSSLMODE: 'disable',
    });
  });

  it('porta padrão e sem senha', () => {
    expect(conexaoDoPgDump('postgres://folha@db/banco')).toEqual({
      PGHOST: 'db',
      PGPORT: '5432',
      PGUSER: 'folha',
      PGDATABASE: 'banco',
    });
  });
});

describe('conferência', () => {
  it('nome do arquivo na hora de Brasília', () => {
    expect(nomeDoArquivo(new Date('2026-11-04T18:05:00Z'))).toBe('backup-ilnet-2026-11-04-15h05.zip');
    // Já é dia 5 em UTC, e ainda dia 4 em Brasília: vale o de Brasília.
    expect(nomeDoArquivo(new Date('2026-11-05T02:30:00Z'))).toBe('backup-ilnet-2026-11-04-23h30.zip');
  });

  it('tamanho legível', () => {
    expect(tamanhoLegivel(512)).toBe('512 bytes');
    expect(tamanhoLegivel(1536)).toBe('1,5 KB');
    expect(tamanhoLegivel(73_400_000)).toBe('70,0 MB');
    expect(tamanhoLegivel(1_288_490_189)).toBe('1,2 GB');
  });

  it('o texto lista cada tabela e o total', () => {
    const c: Conferencia = {
      contadoEm: '2026-11-04T18:05:00Z',
      banco: 'folha',
      versaoDoPostgres: '17.4',
      versaoMaior: 17,
      tamanhoBytes: 1_288_490_189,
      ultimaMigracao: '20261026120000_conferencia_de_os',
      tabelas: [
        { tabela: '_prisma_migrations', registros: 116 },
        { tabela: 'funcionarios', registros: 1234 },
      ],
      totalDeRegistros: 1350,
    };
    const texto = textoDaConferencia(c, 'Administrador');
    expect(texto).toContain('Gerado em 04/11/2026 às 15:05 por Administrador.');
    expect(texto).toContain('2 tabelas e 1.350 registros');
    expect(texto).toMatch(/funcionarios\s+1\.234/);
    expect(texto).toMatch(/Total\s+1\.350/);
  });
});
