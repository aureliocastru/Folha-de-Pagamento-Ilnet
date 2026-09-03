import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { baseDaFolha, usaValorAReceber } from '../../lib/folha';
import { formatBRL } from '../../lib/format';
import type { Funcionario, Paginado, Resumo, SyncResult } from '../../lib/types';

export function Funcionarios() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  // A lista acompanha o que se digita; a consulta espera a mão parar. Voltar
  // para a página 1 é parte da busca nova: achar "matheus" na página 3 de
  // outra busca mostraria uma lista vazia com resultado existindo.
  const buscaAtiva = useTermoAdiado(busca, () => setPage(1));
  // Nasce em "Ativos": é quem entra na próxima folha, e é essa a pergunta que
  // a tela responde. Quem saiu continua a um clique, no seletor.
  const [ativo, setAtivo] = useState<'todos' | 'true' | 'false'>('true');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  const resumo = useQuery({
    queryKey: ['resumo'],
    queryFn: async () => (await api.get<Resumo>('/funcionarios/resumo')).data,
  });

  const lista = useQuery({
    queryKey: ['funcionarios', buscaAtiva, ativo, page],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize: 25 };
      if (buscaAtiva) params.busca = buscaAtiva;
      if (ativo !== 'todos') params.ativo = ativo;
      return (await api.get<Paginado<Funcionario>>('/funcionarios', { params }))
        .data;
    },
  });

  /**
   * Quem pede para sair some das próximas folhas, mas o cadastro fica: o que já
   * foi pago a ele é histórico, e continua contando na dashboard. Reativar é
   * por aqui — a sincronização com o IXC não desfaz o que se decidiu na tela.
   */
  const alternarAtivo = useMutation({
    mutationFn: async (f: Funcionario) =>
      (await api.patch<Funcionario>(`/funcionarios/${f.id}`, { ativo: !f.ativo }))
        .data,
    onSuccess: (f) => {
      setFeedback(
        f.ativo
          ? `${f.nome} voltou para a folha.`
          : `${f.nome} saiu da folha. O que já foi pago a ele continua nos números.`,
      );
      qc.invalidateQueries({ queryKey: ['funcionarios'] });
      qc.invalidateQueries({ queryKey: ['resumo'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const sync = useMutation({
    mutationFn: async () =>
      (await api.post<{ resultados: SyncResult[] }>('/sync')).data,
    onSuccess: (data) => {
      const f = data.resultados.find((r) => r.recurso === 'funcionarios');
      const forn = data.resultados.find((r) => r.recurso === 'fornecedores');
      setFeedback(
        `${f?.totalLidos ?? 0} funcionário(s) lidos — ${f?.totalNovos ?? 0} novos, ${
          f?.totalAtualizados ?? 0
        } atualizados. Fornecedores isentos de ICMS: ${forn?.totalLidos ?? 0}.`,
      );
      qc.invalidateQueries({ queryKey: ['funcionarios'] });
      qc.invalidateQueries({ queryKey: ['resumo'] });
    },
    onError: (err) => setFeedback(`Não deu para sincronizar: ${mensagemErro(err)}`),
  });

  const temBonus = Number(resumo.data?.bonusFixoMensal ?? 0) > 0;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Funcionários"
        titulo="Quem entra na folha"
        descricao="Fornecedores ativos e isentos de ICMS no IXC. É essa lista que a folha calcula."
        acoes={
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="btn btn-acao"
          >
            {sync.isPending ? 'Sincronizando…' : 'Sincronizar com o IXC'}
          </button>
        }
      />

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      <div className="surgir surgir-1 mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Indicador
          acento
          rotulo="Folha base mensal"
          valor={formatBRL(resumo.data?.folhaBaseMensal)}
          detalhe={
            temBonus
              ? `${formatBRL(resumo.data?.salarioBaseMensal)} de base + ${formatBRL(
                  resumo.data?.bonusFixoMensal,
                )} de bônus fixos`
              : 'soma da base de quem está ativo'
          }
        />
        <Indicador
          rotulo="Ativos"
          valor={resumo.data?.ativos ?? '—'}
          detalhe="entram na próxima folha"
        />
      </div>

      <Bloco className="surgir surgir-2" semPadding>
        {/* Sem botão de buscar: a lista acompanha o que se digita. O que havia
            ali era um clique a mais para ver o que já dava para ver. */}
        <div className="flex flex-wrap gap-2 border-b border-tinta-100 p-4 sm:p-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF ou e-mail…"
            className="campo min-w-[240px] flex-1"
          />
          <select
            value={ativo}
            onChange={(e) => {
              setPage(1);
              setAtivo(e.target.value as typeof ativo);
            }}
            className="campo w-auto"
          >
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Nome</th>
                <th className="th">CPF/CNPJ</th>
                <th className="th">Chave PIX</th>
                <th className="th text-right">Base da folha</th>
                <th className="th text-center">Situação</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {lista.isError && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-rose-600">
                    {mensagemErro(lista.error)}
                  </td>
                </tr>
              )}
              {lista.data?.itens.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Nenhum funcionário por aqui">
                      Sincronize com o IXC para trazer os fornecedores ativos
                      isentos de ICMS.
                    </Vazio>
                  </td>
                </tr>
              )}
              {lista.data?.itens.map((f) => (
                <tr key={f.id} className="linha group">
                  <td className="td">
                    <Link
                      to={`/folha/funcionarios/${f.id}`}
                      className="font-medium text-tinta-900 decoration-brand-300 underline-offset-4 group-hover:underline"
                    >
                      {f.nome}
                    </Link>
                    {f.ixcId && (
                      <span className="ml-2 text-[11px] text-tinta-300 num">
                        IXC {f.ixcId}
                      </span>
                    )}
                    {f.apelido && (
                      <div className="mt-0.5 text-xs text-tinta-500">
                        {f.apelido}
                      </div>
                    )}
                  </td>
                  <td className="td num text-tinta-500">{f.cpfCnpj ?? '—'}</td>
                  <td className="td text-tinta-500">
                    {f.chavePix || (
                      <Selo tom="atencao" pequeno>
                        sem PIX
                      </Selo>
                    )}
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(baseDaFolha(f))}</span>
                    {usaValorAReceber(f) && (
                      <div className="text-[10px] text-tinta-300">
                        salário base {formatBRL(f.salarioBase)}
                      </div>
                    )}
                  </td>
                  <td className="td text-center">
                    <Selo tom={f.ativo ? 'pago' : 'neutro'} ponto>
                      {f.ativo ? 'Ativo' : 'Inativo'}
                    </Selo>
                  </td>
                  <td className="td text-right">
                    <button
                      onClick={() => alternarAtivo.mutate(f)}
                      disabled={alternarAtivo.isPending}
                      title={
                        f.ativo
                          ? 'Sai das próximas folhas. O que já foi pago continua no histórico e na dashboard.'
                          : 'Volta a entrar no cálculo da folha.'
                      }
                      className="btn btn-sutil btn-p"
                    >
                      {f.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lista.data && lista.data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-tinta-100 px-5 py-3 text-sm text-tinta-500">
            <span className="num">
              Página {lista.data.page} de {lista.data.totalPages} ·{' '}
              {lista.data.total} registros
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn btn-neutro btn-p"
              >
                Anterior
              </button>
              <button
                disabled={page >= lista.data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn btn-neutro btn-p"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </Bloco>
    </Pagina>
  );
}
