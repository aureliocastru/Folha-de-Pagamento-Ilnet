import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import { CadastroDoConsorcio, ListaDeConsorcios } from './Consorcios';

/** Uma despesa que se repete todo mês, como a API a devolve. */
export interface Recorrente {
  id: string;
  idFornecedorIxc: number;
  fornecedorNome: string;
  valor: string;
  observacao: string;
  proximoVencimento: string;
  diasDeAntecedencia: number;
  ativa: boolean;
  apenasDiasUteis: boolean;
  ultimaGeracaoEm: string | null;
  ultimoErro: string | null;
  categoriaId: string | null;
  tipoPagamentoIxc: string | null;
  diaDoVencimento: number | null;
  /** Preenchido, é consórcio. */
  totalParcelas: number | null;
  parcelasLancadas: number;
  parcelasPorMes: number;
  lancadasNoMes: number;
}

export interface RecorrenteComResumo {
  recorrente: Recorrente;
  geradas: number;
  /** Dias até a próxima nascer no IXC. Negativo = já era para ter nascido. */
  diasParaGerar: number;
}

/**
 * As despesas que se repetem todo mês — internet, aluguel, contabilidade.
 *
 * A conta de cada mês não fica pronta com antecedência de propósito: ela nasce
 * no IXC poucos dias antes de vencer, porque conta a pagar lá é dívida
 * assumida. O que esta tela mostra é a regra e quando ela vai disparar de novo.
 */
export function Recorrentes() {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [aba, setAba] = useState<'mensais' | 'consorcios'>('mensais');
  /** O cadastro de consórcio aberto: `base` nula é consórcio novo. */
  const [cadastro, setCadastro] = useState<{ base: Recorrente | null } | null>(
    null,
  );

  const lista = useQuery({
    queryKey: ['recorrentes'],
    queryFn: async () =>
      (await api.get<RecorrenteComResumo[]>('/recorrentes')).data,
  });

  function invalidar() {
    void queryClient.invalidateQueries({ queryKey: ['recorrentes'] });
    void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  const salvar = useMutation({
    mutationFn: async (args: { id: string; dados: Record<string, unknown> }) => {
      await api.patch(`/recorrentes/${args.id}`, args.dados);
    },
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/recorrentes/${id}`);
    },
    onSuccess: () => {
      setErro(false);
      setAviso('Repetição apagada. As contas que ela já gerou continuam lá.');
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  const gerarAgora = useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          geradas: number;
          fornecedores: string[];
          erros: Array<{ fornecedor: string; erro: string }>;
        }>('/recorrentes/gerar-agora')
      ).data,
    onSuccess: (r) => {
      setErro(r.erros.length > 0);
      setAviso(
        (r.geradas > 0
          ? `${r.geradas} conta(s) geradas no IXC: ${r.fornecedores.join(', ')}.`
          : 'Nenhuma conta para gerar agora — nenhuma entrou na janela dos dias de antecedência.') +
          (r.erros.length
            ? ` Falharam: ${r.erros.map((e) => `${e.fornecedor} (${e.erro})`).join('; ')}`
            : ''),
      );
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(mensagemErro(err));
    },
  });

  const todos = lista.data ?? [];
  // Consórcio é a recorrente com fim: mora na aba dele, e não entre as mensais.
  const consorcios = todos.filter((i) => i.recorrente.totalParcelas != null);
  const itens = todos.filter((i) => i.recorrente.totalParcelas == null);
  const ativas = itens.filter((i) => i.recorrente.ativa);
  const porMes = ativas.reduce((s, i) => s + Number(i.recorrente.valor), 0);
  const consorciosAtivos = consorcios.filter((i) => i.recorrente.ativa);
  const consorciosPorMes = consorciosAtivos.reduce(
    (s, i) =>
      s + Number(i.recorrente.valor) * Math.max(1, i.recorrente.parcelasPorMes),
    0,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Recorrentes"
        descricao="Serviços pagos todo mês e consórcios. A conta de cada mês nasce sozinha no IXC poucos dias antes de vencer — e já aprovada."
        acoes={
          <>
            <button
              onClick={() => setCadastro({ base: null })}
              className="btn btn-neutro"
            >
              Novo consórcio
            </button>
            <button
              onClick={() => gerarAgora.mutate()}
              disabled={gerarAgora.isPending}
              className="btn btn-acao"
            >
              {gerarAgora.isPending ? 'Gerando…' : 'Gerar agora'}
            </button>
          </>
        }
      />

      {cadastro && (
        <CadastroDoConsorcio
          base={cadastro.base}
          todas={todos}
          onFechar={() => setCadastro(null)}
          onPronto={(mensagem) => {
            setCadastro(null);
            setErro(false);
            setAviso(mensagem);
            setAba('consorcios');
            invalidar();
          }}
        />
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['mensais', `Mensais (${itens.length})`],
            ['consorcios', `Consórcios (${consorcios.length})`],
          ] as const
        ).map(([qual, rotulo]) => (
          <button
            key={qual}
            onClick={() => setAba(qual)}
            aria-pressed={aba === qual}
            className={`btn btn-p ${aba === qual ? 'btn-acao' : 'btn-sutil'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aviso && (
        <Aviso
          tom={erro ? 'erro' : 'pago'}
          acao={
            <button
              onClick={() => setAviso(null)}
              className="btn btn-sutil btn-p"
            >
              Fechar
            </button>
          }
        >
          {aviso}
        </Aviso>
      )}

      {aba === 'consorcios' && (
        <>
          {consorciosAtivos.length > 0 && (
            <p className="mb-4 text-sm text-tinta-500">
              {consorciosAtivos.length} consórcio(s) correndo, somando{' '}
              <strong className="valor">{formatBRL(consorciosPorMes)}</strong>{' '}
              por mês.
            </p>
          )}
          <Bloco semPadding>
            {lista.isLoading ? (
              <Carregando />
            ) : (
              <ListaDeConsorcios
                itens={consorcios}
                ocupado={salvar.isPending}
                onEditar={(r) => setCadastro({ base: r })}
                onLigar={(r) =>
                  salvar.mutate({ id: r.id, dados: { ativa: !r.ativa } })
                }
                onApagar={(r) => {
                  if (
                    confirm(
                      `Apagar o consórcio de ${r.fornecedorNome}? ` +
                        'As parcelas já geradas continuam no IXC.',
                    )
                  ) {
                    remover.mutate(r.id);
                  }
                }}
              />
            )}
          </Bloco>
        </>
      )}

      {aba === 'mensais' && ativas.length > 0 && (
        <p className="mb-4 text-sm text-tinta-500">
          {ativas.length} despesa(s) ativa(s), somando{' '}
          <strong className="valor">{formatBRL(porMes)}</strong> por mês.
        </p>
      )}

      {aba === 'mensais' && (
      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : itens.length === 0 ? (
          <Vazio titulo="Nenhuma despesa repetida ainda">
            Ao lançar uma conta, marque "Repetir todo mês" — a partir do mês
            seguinte ela nasce sozinha aqui.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            {/*
             * Larguras fixas, e não o cálculo automático do navegador.
             *
             * Em tabela automática a folga da tela inteira vai parar na coluna
             * de conteúdo mais largo — aqui, a do fornecedor. O resultado era um
             * vão de uns quatrocentos pixels entre o nome e o valor: as colunas
             * viravam ilhas separadas por vazio, e seguir uma linha da esquerda
             * até a direita virava trabalho.
             *
             * Repartida assim, a folga é dividida entre todas e cada coluna fica
             * do tamanho do que carrega. O `min-w` é o que faz a tabela rolar em
             * tela estreita em vez de espremer tudo.
             */}
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <colgroup>
                <col className="w-[32%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[26%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="th">Fornecedor</th>
                  <th className="th text-right">Por mês</th>
                  <th className="th">Próxima vence</th>
                  <th className="th">Nasce no IXC</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map(({ recorrente: r, geradas, diasParaGerar }) => {
                  const emEdicao = editando === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={`linha ${r.ativa ? '' : 'opacity-50'}`}
                    >
                      <td className="td">
                        <div className="text-tinta-800">{r.fornecedorNome}</div>
                        <div className="text-xs text-tinta-400">
                          {r.observacao}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {!r.ativa && (
                            <Selo pequeno tom="neutro">
                              desligada
                            </Selo>
                          )}
                          {geradas > 0 && (
                            <span className="text-[11px] text-tinta-400">
                              {geradas} conta(s) geradas
                            </span>
                          )}
                          {r.ultimoErro && (
                            <Selo pequeno tom="erro" titulo={r.ultimoErro}>
                              a última falhou
                            </Selo>
                          )}
                        </div>
                      </td>

                      <td className="td text-right">
                        {emEdicao ? (
                          <CampoDinheiro
                            valor={valor}
                            onChange={setValor}
                            className="campo py-1 text-right"
                          />
                        ) : (
                          <span className="valor">
                            {formatBRL(Number(r.valor))}
                          </span>
                        )}
                      </td>

                      <td className="td num whitespace-nowrap text-tinta-600">
                        {emEdicao ? (
                          <input
                            type="date"
                            value={vencimento}
                            onChange={(e) => setVencimento(e.target.value)}
                            className="campo py-1"
                          />
                        ) : (
                          formatData(r.proximoVencimento)
                        )}
                      </td>

                      <td className="td text-tinta-500">
                        {!r.ativa ? (
                          '—'
                        ) : diasParaGerar <= 0 ? (
                          <Selo pequeno tom="atencao">
                            na próxima rodada
                          </Selo>
                        ) : (
                          `em ${diasParaGerar} dia(s)`
                        )}
                        <div className="text-[11px] text-tinta-400">
                          {r.diasDeAntecedencia} dias antes de vencer
                        </div>
                        {/* Só dias úteis: é aqui que se vê e se troca, porque
                            muda a data que o fornecedor vai receber. */}
                        <label
                          className="mt-1 flex items-center gap-1.5 text-[11px] text-tinta-500"
                          title="Vencimento em sábado, domingo ou feriado nacional anda para o próximo dia útil"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-brand-600"
                            checked={r.apenasDiasUteis}
                            onChange={(e) =>
                              salvar.mutate({
                                id: r.id,
                                dados: { apenasDiasUteis: e.target.checked },
                              })
                            }
                          />
                          só dias úteis
                        </label>
                      </td>

                      <td className="td text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {emEdicao ? (
                            <>
                              <button
                                onClick={() =>
                                  salvar.mutate({
                                    id: r.id,
                                    dados: {
                                      valor: Number(valor),
                                      proximoVencimento: vencimento,
                                    },
                                  })
                                }
                                disabled={salvar.isPending}
                                className="btn btn-primario btn-p"
                              >
                                Salvar
                              </button>
                              <button
                                onClick={() => setEditando(null)}
                                className="btn btn-sutil btn-p"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditando(r.id);
                                  setValor(String(Number(r.valor)));
                                  setVencimento(
                                    String(r.proximoVencimento).slice(0, 10),
                                  );
                                }}
                                className="btn btn-neutro btn-p"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => setCadastro({ base: r })}
                                className="btn btn-sutil btn-p"
                                title="Tem número de parcelas: passa para Consórcios, numera as contas e para na última"
                              >
                                É consórcio
                              </button>
                              <button
                                onClick={() =>
                                  salvar.mutate({
                                    id: r.id,
                                    dados: { ativa: !r.ativa },
                                  })
                                }
                                className="btn btn-sutil btn-p"
                                title={
                                  r.ativa
                                    ? 'Para de gerar; o que já gerou continua lá'
                                    : 'Volta a gerar todo mês'
                                }
                              >
                                {r.ativa ? 'Desligar' : 'Religar'}
                              </button>
                              <button
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Apagar a repetição de ${r.fornecedorNome}? ` +
                                        'As contas já geradas continuam no IXC.',
                                    )
                                  ) {
                                    remover.mutate(r.id);
                                  }
                                }}
                                className="btn btn-perigo btn-p"
                              >
                                Apagar
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
      )}

      <p className="ajuda">
        A verificação roda sozinha a cada seis horas. "Gerar agora" só antecipa
        essa checagem — nada nasce antes da janela dos dias de antecedência.
      </p>
    </Pagina>
  );
}
