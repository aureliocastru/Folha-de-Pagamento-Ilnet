import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Indicador, Pagina } from '../components/ui';
import { api, mensagemErro } from '../lib/api';
import { combina } from '../lib/busca';

interface Conferencia {
  contadoEm: string;
  banco: string;
  versaoDoPostgres: string;
  versaoMaior: number;
  tamanhoBytes: number;
  ultimaMigracao: string | null;
  tabelas: Array<{ tabela: string; registros: number }>;
  totalDeRegistros: number;
  /** A versão do pg_dump que vai copiar o banco; null = não há. */
  pgDump: number | null;
}

interface AndamentoDoBackup {
  id: string;
  status: 'gerando' | 'completo' | 'falhou' | 'interrompido';
  arquivo: string;
  quem: string;
  iniciadoEm: string;
  terminadoEm: string | null;
  bytes: number;
  tabelas: number;
  registros: number;
  tabelasCopiadas: number;
  copiando: string | null;
  erro: string | null;
}

/** Quanto esperar o download começar antes de dizer que ele não começou. */
const ESPERA_DO_DOWNLOAD_MS = 60_000;

const numero = (n: number) => n.toLocaleString('pt-BR');

/** 1234567 → "1,2 MB". */
function tamanho(bytes: number): string {
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

function quando(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * O banco inteiro num arquivo: para guardar, ou para levar o sistema a outro
 * servidor sem deixar nada para trás.
 *
 * O download vai pelo navegador, e não pela tela (ver `BackupService` na API):
 * aqui se acompanha o que o servidor está mandando, e a resposta final — saiu
 * inteiro ou não — é a do servidor, que sabe se o último byte saiu.
 */
export function Backup() {
  const [pedindo, setPedindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * O backup pedido daqui, enquanto ele não aparece pronto na lista do
   * servidor: os que já estavam lá antes do clique, para reconhecer o novo
   * (pelo id, e não pela hora — o relógio do servidor não é o daqui).
   */
  const [esperando, setEsperando] = useState<Set<string> | null>(null);
  const [busca, setBusca] = useState('');

  const conferencia = useQuery({
    queryKey: ['backup', 'conferencia'],
    queryFn: async () => (await api.get<Conferencia>('/backup/conferencia')).data,
  });

  const andamento = useQuery({
    queryKey: ['backup', 'andamento'],
    queryFn: async () => (await api.get<AndamentoDoBackup[]>('/backup/andamento')).data,
    refetchInterval: (q) =>
      esperando !== null || q.state.data?.some((a) => a.status === 'gerando') ? 1500 : false,
  });

  const backups = andamento.data ?? [];
  const pedido = esperando === null ? null : (backups.find((a) => !esperando.has(a.id)) ?? null);
  const pedidoTerminou = pedido !== null && pedido.status !== 'gerando';

  // Terminado o pedido, a tela para de acompanhar e mostra o resultado.
  useEffect(() => {
    if (pedidoTerminou) setEsperando(null);
  }, [pedidoTerminou]);

  // O pedido que nunca chegou ao servidor: o navegador não abriu o download.
  const chegou = pedido !== null;
  useEffect(() => {
    if (esperando === null || chegou) return;
    const t = setTimeout(() => {
      setEsperando(null);
      setErro('O download não começou. Confira se o navegador bloqueou o arquivo e tente de novo.');
    }, ESPERA_DO_DOWNLOAD_MS);
    return () => clearTimeout(t);
  }, [esperando, chegou]);

  const gerando = backups.find((a) => a.status === 'gerando') ?? null;
  const ultimo = backups[0] ?? null;

  async function fazerBackup() {
    setErro(null);
    setPedindo(true);
    try {
      const antes = new Set(((await andamento.refetch()).data ?? []).map((a) => a.id));
      const { data } = await api.post<{ bilhete: string }>('/backup/bilhete');
      // O navegador baixa direto para o disco, com a barra de progresso dele.
      // Pela tela (blob) o banco inteiro teria de caber na memória da aba.
      const link = document.createElement('a');
      link.href = `${api.defaults.baseURL}/backup/arquivo?bilhete=${encodeURIComponent(data.bilhete)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setEsperando(antes);
      void andamento.refetch();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setPedindo(false);
    }
  }

  const tabelas = useMemo(
    () => (conferencia.data?.tabelas ?? []).filter((t) => combina([t.tabela], busca)),
    [conferencia.data, busca],
  );

  const c = conferencia.data;
  const semPgDump = c != null && c.pgDump === null;
  const ocupado = pedindo || gerando !== null || esperando !== null;

  return (
    <Pagina>
      <CabecalhoPagina secao="Backup" titulo="Backup completo do sistema" />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {conferencia.isError && <Aviso tom="erro">{mensagemErro(conferencia.error)}</Aviso>}
      {semPgDump && (
        <Aviso tom="erro">
          O servidor não tem o pg_dump do PostgreSQL {c.versaoMaior} — o backup não sai.
        </Aviso>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 md:mb-5 md:grid-cols-3 md:gap-3">
        <Indicador rotulo="Tabelas" valor={c ? numero(c.tabelas.length) : '…'} />
        <Indicador rotulo="Registros" valor={c ? numero(c.totalDeRegistros) : '…'} />
        <Indicador
          rotulo="Tamanho do banco"
          valor={c ? tamanho(c.tamanhoBytes) : '…'}
          detalhe={c ? `PostgreSQL ${c.versaoDoPostgres}` : undefined}
        />
      </div>

      <Bloco titulo="Fazer backup" className="mb-4 md:mb-5">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={fazerBackup}
            disabled={ocupado || !c || semPgDump}
            className="btn btn-primario w-full py-3 text-[15px] sm:w-auto sm:self-start sm:px-8"
          >
            {ocupado ? 'Gerando o backup…' : 'Fazer backup'}
          </button>

          {gerando && <Progresso a={gerando} />}
          {!gerando && esperando !== null && (
            <p className="text-[13px] text-tinta-500">Começando…</p>
          )}
          {!gerando && esperando === null && ultimo && <Resultado a={ultimo} />}
        </div>

        {backups.length > 1 && (
          <ul className="mt-4 border-t border-tinta-100 pt-3 text-[12px] text-tinta-500">
            {backups.slice(1).map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2 py-0.5">
                <span className="num">{quando(a.iniciadoEm)}</span>
                <span className={a.status === 'completo' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}>
                  {a.status === 'completo' ? 'completo' : a.status === 'gerando' ? 'gerando' : 'incompleto'}
                </span>
                {a.status === 'completo' && <span className="num">{tamanho(a.bytes)}</span>}
                <span>{a.quem}</span>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      <Bloco titulo="O que vai no backup" semPadding>
        {conferencia.isLoading ? (
          <Carregando texto="Contando os registros…" />
        ) : (
          <>
            <div className="px-3 pb-2 pt-3 md:px-4">
              <input
                className="campo"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar tabela"
                aria-label="Procurar tabela"
                autoComplete="off"
              />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-tinta-200">
                  <th className="th">Tabela</th>
                  <th className="th text-right">Registros</th>
                </tr>
              </thead>
              <tbody>
                {tabelas.map((t) => (
                  <tr key={t.tabela} className="linha">
                    <td className="td break-all">{t.tabela}</td>
                    <td className="td num text-right">{numero(t.registros)}</td>
                  </tr>
                ))}
                {tabelas.length === 0 && (
                  <tr>
                    <td colSpan={2} className="td text-center text-tinta-400">
                      Nenhuma tabela com "{busca.trim()}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </Bloco>
    </Pagina>
  );
}

/** O backup saindo: quanto já foi, e em que tabela está. */
function Progresso({ a }: { a: AndamentoDoBackup }) {
  const parte = a.tabelas > 0 ? Math.min(1, a.tabelasCopiadas / a.tabelas) : 0;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-tinta-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
          style={{ width: `${Math.max(3, parte * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[13px] text-tinta-600">
        <span className="num font-semibold text-tinta-900">{tamanho(a.bytes)}</span>
        {' · '}
        <span className="num">
          {numero(a.tabelasCopiadas)} de {numero(a.tabelas)} tabelas
        </span>
        {a.copiando && <span className="text-tinta-400"> · {a.copiando}</span>}
      </p>
    </div>
  );
}

/** Como terminou o último backup. */
function Resultado({ a }: { a: AndamentoDoBackup }) {
  if (a.status === 'completo') {
    return (
      <Aviso tom="pago">
        <strong>Backup completo</strong> — {a.arquivo}, {tamanho(a.bytes)}, {numero(a.tabelas)} tabelas e{' '}
        {numero(a.registros)} registros. Está na pasta de downloads do computador.
      </Aviso>
    );
  }
  return (
    <Aviso tom="erro">
      <strong>Backup incompleto</strong> ({quando(a.iniciadoEm)}): {a.erro ?? 'não terminou.'} O arquivo
      baixado não serve — apague e faça de novo.
    </Aviso>
  );
}
