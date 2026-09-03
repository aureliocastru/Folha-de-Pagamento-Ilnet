import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { rotuloParcelaAtual } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import { SENTIDO_CURTO, SENTIDO_LABEL, SENTIDO_TOM } from '../../lib/status';
import type {
  Funcionario,
  Paginado,
  SentidoVale,
  ValeComSaldo,
  ValeParcela,
} from '../../lib/types';

type Situacao = 'ABERTO' | 'QUITADO' | 'CANCELADO' | 'TODOS';

function competenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(comp: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  return m ? `${m[2]}/${m[1]}` : comp;
}

export function Vales() {
  const qc = useQueryClient();
  const [situacao, setSituacao] = useState<Situacao>('ABERTO');
  const [sentido, setSentido] = useState<SentidoVale | 'TODOS'>('TODOS');
  const [busca, setBusca] = useState('');
  // A lista já acompanhava o que se digita, mas ia ao servidor a cada tecla:
  // "cleyson" eram sete consultas, e a resposta da quarta podia chegar depois
  // da sétima e repintar a tela com o resultado de "cleys".
  const buscaAtiva = useTermoAdiado(busca);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['vales', situacao, sentido, buscaAtiva],
    queryFn: async () => {
      const params: Record<string, string> = { situacao };
      if (sentido !== 'TODOS') params.sentido = sentido;
      if (buscaAtiva) params.busca = buscaAtiva;
      return (await api.get<ValeComSaldo[]>('/vales', { params })).data;
    },
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['vales'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const alterar = useMutation({
    mutationFn: async ({
      id,
      dados,
    }: {
      id: string;
      dados: Record<string, unknown>;
    }) => (await api.patch(`/vales/${id}`, dados)).data,
    onSuccess: invalidar,
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/vales/${id}`)).data,
    onSuccess: () => {
      setFeedback('Vale excluído.');
      invalidar();
    },
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const marcarParcela = useMutation({
    mutationFn: async ({
      parcelaId,
      descontada,
    }: {
      parcelaId: string;
      descontada: boolean;
    }) =>
      (await api.patch(`/vales/parcelas/${parcelaId}`, { descontada })).data,
    onSuccess: invalidar,
    onError: (err) => setFeedback(mensagemErro(err)),
  });

  const totais = useMemo(() => {
    const itens = lista.data ?? [];
    const soma = (s: SentidoVale) =>
      itens
        .filter((v) => v.vale.sentido === s && !v.vale.cancelado)
        .reduce((acc, v) => acc + v.saldo, 0);
    return { deve: soma('DESCONTO'), receber: soma('CREDITO') };
  }, [lista.data]);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Vales e acertos"
        titulo="Acerto de contas"
        descricao="Nos dois sentidos, avulso ou parcelado. O que estiver marcado para a folha entra no salário da competência de cada parcela."
      />

      {feedback && <Aviso tom="marca">{feedback}</Aviso>}

      <div className="surgir surgir-1 mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Indicador
          rotulo="Funcionários devem à empresa"
          valor={formatBRL(totais.deve)}
          detalhe="saldo em aberto nesta lista"
        />
        <Indicador
          rotulo="Empresa deve aos funcionários"
          valor={formatBRL(totais.receber)}
          detalhe="saldo em aberto nesta lista"
        />
      </div>

      <NovoVale
        onCriado={() => {
          setFeedback('Vale registrado.');
          invalidar();
        }}
      />

      <div className="surgir surgir-3 mb-4 mt-8 flex flex-wrap items-end gap-2">
        <div>
          <label className="rotulo" htmlFor="f-situacao">
            Situação
          </label>
          <select
            id="f-situacao"
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as Situacao)}
            className="campo w-auto"
          >
            <option value="ABERTO">Em aberto</option>
            <option value="QUITADO">Quitados</option>
            <option value="CANCELADO">Cancelados</option>
            <option value="TODOS">Todos</option>
          </select>
        </div>
        <div>
          <label className="rotulo" htmlFor="f-sentido">
            Sentido
          </label>
          <select
            id="f-sentido"
            value={sentido}
            onChange={(e) => setSentido(e.target.value as SentidoVale | 'TODOS')}
            className="campo w-auto"
          >
            <option value="TODOS">Os dois</option>
            <option value="DESCONTO">Funcionário paga a empresa</option>
            <option value="CREDITO">Empresa paga o funcionário</option>
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="rotulo" htmlFor="f-busca">
            Buscar
          </label>
          <input
            id="f-busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome da pessoa ou descrição…"
            className="campo"
          />
        </div>
      </div>

      <Bloco className="surgir surgir-4" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Pessoa</th>
                <th className="th">Descrição</th>
                <th className="th text-center">Parcela</th>
                <th className="th text-right">Parcela R$</th>
                <th className="th text-right">Saldo</th>
                <th className="th text-center">Folha</th>
                <th className="th"></th>
              </tr>
            </thead>
            {lista.isLoading && (
              <tbody>
                <tr>
                  <td colSpan={7}>
                    <Carregando />
                  </td>
                </tr>
              </tbody>
            )}
            {lista.data?.length === 0 && (
              <tbody>
                <tr>
                  <td colSpan={7}>
                    <Vazio titulo="Nenhum vale nesta situação">
                      Registre acima um vale, uma compra parcelada ou um
                      reembolso.
                    </Vazio>
                  </td>
                </tr>
              </tbody>
            )}
            {lista.data?.map((v) => {
              const expandido = !!aberto[v.vale.id];
              return (
                <tbody key={v.vale.id}>
                  <tr
                    className={`linha cursor-pointer ${
                      v.vale.cancelado ? 'opacity-45' : ''
                    }`}
                    onClick={() =>
                      setAberto((p) => ({ ...p, [v.vale.id]: !p[v.vale.id] }))
                    }
                  >
                    <td className="td">
                      <span
                        className={`mr-2 inline-block text-tinta-300 transition-transform ${
                          expandido ? 'rotate-90' : ''
                        }`}
                      >
                        ▸
                      </span>
                      <Link
                        to={`/folha/funcionarios/${v.vale.funcionarioId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-tinta-900 decoration-brand-300 underline-offset-4 hover:underline"
                      >
                        {v.funcionarioNome}
                      </Link>
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-tinta-700">
                          {v.vale.descricao}
                        </span>
                        <Selo tom={SENTIDO_TOM[v.vale.sentido]} pequeno>
                          {SENTIDO_CURTO[v.vale.sentido]}
                        </Selo>
                        {v.vale.cancelado && (
                          <Selo pequeno>cancelado</Selo>
                        )}
                        {v.quitado && !v.vale.cancelado && (
                          <Selo tom="pago" pequeno>
                            quitado
                          </Selo>
                        )}
                      </div>
                    </td>
                    <td className="td num text-center text-tinta-600">
                      {rotuloParcelaAtual(v)}
                      {v.proximaParcela && (
                        <div className="text-[11px] text-tinta-400">
                          na folha de {formatComp(v.proximaParcela.competencia)}
                        </div>
                      )}
                    </td>
                    <td className="td num text-right text-tinta-500">
                      {formatBRL(v.vale.valorParcela)}
                    </td>
                    <td className="td text-right">
                      <span
                        className={`valor ${
                          v.vale.sentido === 'CREDITO'
                            ? 'text-emerald-700'
                            : 'text-tinta-900'
                        }`}
                      >
                        {formatBRL(v.saldo)}
                      </span>
                      <div className="text-[10px] text-tinta-300 num">
                        de {formatBRL(v.vale.valorTotal)}
                      </div>
                    </td>
                    <td
                      className="td text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="accent-brand-600"
                        checked={v.vale.descontarDaFolha}
                        disabled={v.vale.cancelado || alterar.isPending}
                        onChange={(e) =>
                          alterar.mutate({
                            id: v.vale.id,
                            dados: { descontarDaFolha: e.target.checked },
                          })
                        }
                        title="Lançar as parcelas na folha de pagamento"
                      />
                    </td>
                    <td
                      className="td text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-end gap-3 text-xs font-semibold">
                        {v.vale.cancelado ? (
                          <button
                            onClick={() =>
                              alterar.mutate({
                                id: v.vale.id,
                                dados: { cancelado: false },
                              })
                            }
                            className="text-brand-700 hover:underline"
                          >
                            reativar
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              alterar.mutate({
                                id: v.vale.id,
                                dados: { cancelado: true },
                              })
                            }
                            className="text-amber-600 hover:underline"
                          >
                            cancelar
                          </button>
                        )}
                        {v.parcelasDescontadas === 0 && (
                          <button
                            onClick={() => excluir.mutate(v.vale.id)}
                            className="text-rose-500 hover:underline"
                          >
                            excluir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {expandido && (
                    <tr>
                      <td colSpan={7} className="bg-tinta-50/80 px-5 pb-5 pt-4">
                        <p className="mb-3 text-xs text-tinta-500">
                          {SENTIDO_LABEL[v.vale.sentido]} · registrado em{' '}
                          {formatData(v.vale.data)} · já{' '}
                          {v.vale.sentido === 'CREDITO' ? 'pago' : 'descontado'}{' '}
                          <strong className="num">
                            {formatBRL(v.totalDescontado)}
                          </strong>
                          {v.vale.observacao ? ` · ${v.vale.observacao}` : ''}
                        </p>
                        <ParcelasTabela
                          parcelas={v.vale.parcelas}
                          onMarcar={(parcelaId, descontada) =>
                            marcarParcela.mutate({ parcelaId, descontada })
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      </Bloco>
    </Pagina>
  );
}

function ParcelasTabela({
  parcelas,
  onMarcar,
}: {
  parcelas: ValeParcela[];
  onMarcar: (parcelaId: string, descontada: boolean) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-papel ring-1 ring-tinta-100">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="th w-10 !py-2"></th>
            <th className="th !py-2">Parcela</th>
            <th className="th !py-2">Competência</th>
            <th className="th !py-2 text-right">Valor</th>
            <th className="th !py-2 text-right">Baixa</th>
          </tr>
        </thead>
        <tbody>
          {parcelas.map((p) => (
            <tr key={p.id} className="border-t border-tinta-100">
              <td className="td !py-2">
                <input
                  type="checkbox"
                  className="accent-brand-600"
                  checked={p.descontada}
                  onChange={(e) => onMarcar(p.id, e.target.checked)}
                  title="Marcar como acertada fora da folha"
                />
              </td>
              <td className="td num !py-2">{p.numero}</td>
              <td className="td num !py-2">{formatComp(p.competencia)}</td>
              <td className="td !py-2 text-right">
                <span className="valor text-[13px]">{formatBRL(p.valor)}</span>
              </td>
              <td className="td num !py-2 text-right text-xs text-tinta-400">
                {p.descontadaEm ? formatData(p.descontadaEm) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Formulário de novo vale/acerto ---
function NovoVale({ onCriado }: { onCriado: () => void }) {
  const [sentido, setSentido] = useState<SentidoVale>('DESCONTO');
  const [funcionarioId, setFuncionarioId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [parcelas, setParcelas] = useState('1');
  const [valorParcela, setValorParcela] = useState('');
  const [competenciaInicio, setCompetenciaInicio] = useState(competenciaAtual());
  const [naFolha, setNaFolha] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const funcionarios = useQuery({
    queryKey: ['funcionarios', 'select'],
    queryFn: async () =>
      (
        await api.get<Paginado<Funcionario>>('/funcionarios', {
          params: { pageSize: 200, ativo: 'true' },
        })
      ).data,
  });

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post('/vales', {
          funcionarioId,
          sentido,
          descricao,
          quantidadeParcelas: Number(parcelas),
          valorParcela: Number(valorParcela),
          competenciaInicio,
          descontarDaFolha: naFolha,
          observacao: observacao || undefined,
        })
      ).data,
    onSuccess: () => {
      setDescricao('');
      setValorParcela('');
      setParcelas('1');
      setObservacao('');
      setErro(null);
      onCriado();
    },
    onError: (err) => setErro(mensagemErro(err)),
  });

  const qtd = Number(parcelas) || 0;
  const total = qtd * (Number(valorParcela) || 0);
  const valido =
    !!funcionarioId &&
    descricao.trim().length >= 2 &&
    Number.isInteger(qtd) &&
    qtd >= 1 &&
    Number(valorParcela) > 0;

  return (
    <Bloco titulo="Novo vale ou acerto" className="surgir surgir-2">
      <div className="mb-5 inline-flex rounded-xl bg-tinta-100 p-1">
        <BotaoSentido
          ativo={sentido === 'DESCONTO'}
          onClick={() => setSentido('DESCONTO')}
        >
          Funcionário paga a empresa
        </BotaoSentido>
        <BotaoSentido
          ativo={sentido === 'CREDITO'}
          onClick={() => setSentido('CREDITO')}
        >
          Empresa paga o funcionário
        </BotaoSentido>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Campo label="Funcionário">
          <select
            value={funcionarioId}
            onChange={(e) => setFuncionarioId(e.target.value)}
            className="campo"
          >
            <option value="">Selecione…</option>
            {funcionarios.data?.itens.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Descrição" span2>
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={
              sentido === 'DESCONTO'
                ? 'Ex.: celular comprado na empresa'
                : 'Ex.: material que comprou para a obra'
            }
            className="campo"
          />
        </Campo>
        <Campo label="Nº de parcelas">
          <input
            type="number"
            min={1}
            step={1}
            value={parcelas}
            onChange={(e) => setParcelas(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo label="Valor de cada parcela (R$)">
          <CampoDinheiro valor={valorParcela} onChange={setValorParcela} />
        </Campo>
        <Campo label="Primeira parcela na folha de">
          <input
            type="month"
            value={competenciaInicio}
            onChange={(e) => setCompetenciaInicio(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo label="Observação" span2>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            className="campo"
          />
        </Campo>
        <Campo>
          <label className="flex h-[42px] w-fit items-center gap-2 text-sm text-tinta-700">
            <input
              type="checkbox"
              className="accent-brand-600"
              checked={naFolha}
              onChange={(e) => setNaFolha(e.target.checked)}
            />
            {sentido === 'DESCONTO' ? 'Descontar da folha' : 'Somar na folha'}
          </label>
        </Campo>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="btn btn-primario"
        >
          {criar.isPending ? 'Registrando…' : 'Registrar'}
        </button>
        {total > 0 && (
          <span className="text-sm text-tinta-500">
            Total{' '}
            <strong className="valor text-[15px]">{formatBRL(total)}</strong> em{' '}
            {qtd}× de {formatBRL(Number(valorParcela))} a partir de{' '}
            {formatComp(competenciaInicio)}
          </span>
        )}
        {!naFolha && (
          <Selo tom="atencao">Fora da folha — fica só registrado</Selo>
        )}
      </div>
      {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
    </Bloco>
  );
}

function Campo({
  label,
  span2,
  children,
}: {
  /** Sem rótulo, o espaço é preservado para alinhar com os vizinhos. */
  label?: string;
  span2?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className="rotulo">{label ?? ' '}</label>
      {children}
    </div>
  );
}

function BotaoSentido({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        ativo
          ? 'bg-papel text-tinta-900 shadow-sm'
          : 'text-tinta-500 hover:text-tinta-800'
      }`}
    >
      {children}
    </button>
  );
}
