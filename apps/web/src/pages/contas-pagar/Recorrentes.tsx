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
import {
  CadastroDoConsorcio,
  JanelaDeAntecipacao,
  JanelaDeHistorico,
  ListaDeConsorcios,
} from './Consorcios';
import { NovaDespesa } from './NovaDespesa';

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
  /** Quantas já tinham sido antecipadas, do fim, quando o contrato entrou. */
  parcelasAntecipadas: number;
  /** As parcelas pagas fora da ordem, cada uma com o seu número. */
  antecipadas: ParcelaAntecipada[];
  /** É financiamento — e mora na aba dele. O que é vem na descrição. */
  ehFinanciamento: boolean;
}

/** Uma parcela paga adiantada: qual era, por quanto saiu e o que ela valia. */
export interface ParcelaAntecipada {
  id: string;
  numero: number;
  valor: string;
  valorDeTabela: string;
  idFnApagarIxc: number | null;
  data: string;
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
  const [aba, setAba] = useState<'mensais' | 'consorcios' | 'financiamentos'>(
    'mensais',
  );
  /**
   * O cadastro aberto: `base` nula é um cadastro novo, e `modo` diz se o que
   * se está cadastrando tem veículo no nome.
   */
  const [cadastro, setCadastro] = useState<{
    base: Recorrente | null;
    modo: 'mensal' | 'consorcio' | 'financiamento';
  } | null>(null);
  /** O contrato cuja parcela se está escolhendo para antecipar. */
  const [antecipando, setAntecipando] = useState<string | null>(null);
  /** O contrato aberto para ver o que já foi pago dele. */
  const [historico, setHistorico] = useState<string | null>(null);
  /**
   * A parcela escolhida, esperando virar conta a pagar. Enquanto isto existe,
   * a tela de lançar está aberta com tudo preenchido menos o valor do boleto.
   */
  const [aLancar, setALancar] = useState<{
    recorrente: Recorrente;
    numero: number;
  } | null>(null);

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

  /**
   * Registra a parcela antecipada — depois que a conta já nasceu no IXC.
   *
   * O valor que fica guardado é o que foi lançado: o do boleto, com o desconto
   * já dentro. O IXC não vê desconto nenhum, vê uma despesa de um valor só, e
   * é isso que faz o título fechar lá sem sobra nem falta.
   */
  const registrarAntecipada = useMutation({
    mutationFn: async (dados: {
      id: string;
      numero: number;
      valor: number;
      valorDeTabela: number;
      contaId?: string | null;
      idFnApagarIxc?: number | null;
      /** O dia em que foi paga, quando o pagamento é antigo. */
      data?: string;
    }) => {
      await api.post(`/recorrentes/${dados.id}/antecipacoes`, {
        numero: dados.numero,
        valor: dados.valor,
        valorDeTabela: dados.valorDeTabela,
        contaId: dados.contaId ?? undefined,
        idFnApagarIxc: dados.idFnApagarIxc ?? undefined,
        data: dados.data ?? undefined,
      });
    },
    onSuccess: (_, dados) => {
      setErro(false);
      setAviso(
        `Parcela ${dados.numero} antecipada por ${formatBRL(dados.valor)}` +
          (dados.valorDeTabela > dados.valor
            ? `, ${formatBRL(dados.valorDeTabela - dados.valor)} a menos do que ela valia`
            : '') +
          '. Ela saiu da fila: não vai nascer de novo no mês dela.',
      );
      invalidar();
    },
    onError: (err) => {
      setErro(true);
      setAviso(
        'A conta foi lançada no IXC, mas o registro da antecipação falhou: ' +
          `${mensagemErro(err)}. Abra "Antecipar" e escolha a parcela de novo — ` +
          'sem isso a rotina vai gerá-la outra vez no mês dela.',
      );
      invalidar();
    },
  });

  const desfazerAntecipada = useMutation({
    mutationFn: async (dados: { id: string; antecipacaoId: string }) => {
      await api.delete(
        `/recorrentes/${dados.id}/antecipacoes/${dados.antecipacaoId}`,
      );
    },
    onSuccess: () => {
      setErro(false);
      setAviso(
        'Antecipação desfeita: a parcela voltou para a fila. A conta que ' +
          'nasceu no IXC continua lá — se ela não vale mais, cancele-a por lá.',
      );
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
  // Financiamento é a mesma coisa marcada como tal — carro, máquina, o que
  // for: quem diz o que é, é a descrição.
  const parceladas = todos.filter((i) => i.recorrente.totalParcelas != null);
  const financiamentos = parceladas.filter((i) => i.recorrente.ehFinanciamento);
  const consorcios = parceladas.filter((i) => !i.recorrente.ehFinanciamento);
  const itens = todos.filter((i) => i.recorrente.totalParcelas == null);
  const ativas = itens.filter((i) => i.recorrente.ativa);
  const porMes = ativas.reduce((s, i) => s + Number(i.recorrente.valor), 0);

  /** O que sai do caixa por mês em parcelas que nascem sozinhas. */
  function somaPorMes(itens: RecorrenteComResumo[]): number {
    return itens
      .filter((i) => i.recorrente.ativa)
      .reduce(
        (s, { recorrente: r }) =>
          s + Number(r.valor) * Math.max(1, r.parcelasPorMes),
        0,
      );
  }

  const consorciosAtivos = consorcios.filter((i) => i.recorrente.ativa);
  const consorciosPorMes = somaPorMes(consorcios);
  const financiamentosAtivos = financiamentos.filter((i) => i.recorrente.ativa);
  const financiamentosPorMes = somaPorMes(financiamentos);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Contas a pagar"
        titulo="Recorrentes"
        descricao="Serviços pagos todo mês e consórcios. A conta de cada mês nasce sozinha no IXC poucos dias antes de vencer — e já aprovada."
        acoes={
          <>
            {/*
              O botão é o da aba aberta.

              Antes ele dizia "Novo consórcio" mesmo em Mensais, e não havia
              caminho nenhum para cadastrar uma despesa que só se repete — o
              jeito era lançar uma conta e depois torná-la recorrente.
            */}
            <button
              onClick={() =>
                setCadastro({
                  base: null,
                  modo:
                    aba === 'financiamentos'
                      ? 'financiamento'
                      : aba === 'consorcios'
                        ? 'consorcio'
                        : 'mensal',
                })
              }
              className="btn btn-neutro"
            >
              {aba === 'financiamentos'
                ? 'Novo financiamento'
                : aba === 'consorcios'
                  ? 'Novo consórcio'
                  : 'Nova despesa mensal'}
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
          modo={cadastro.modo}
          onFechar={() => setCadastro(null)}
          onPronto={(mensagem) => {
            // Cada cadastro termina na aba em que ele passa a morar.
            const destino =
              cadastro.base == null && cadastro.modo === 'mensal'
                ? 'mensais'
                : cadastro.modo === 'financiamento'
                  ? 'financiamentos'
                  : 'consorcios';
            setCadastro(null);
            setErro(false);
            setAviso(mensagem);
            setAba(destino);
            invalidar();
          }}
        />
      )}

      {/* Escolher qual parcela vai ser paga adiantada. */}
      {antecipando && (() => {
        const item = todos.find((i) => i.recorrente.id === antecipando);
        if (!item) return null;
        return (
          <JanelaDeAntecipacao
            item={item}
            onFechar={() => setAntecipando(null)}
            onPagar={(parcela) => {
              setAntecipando(null);
              setALancar({ recorrente: item.recorrente, numero: parcela.numero });
            }}
            onRegistrar={(dados) => {
              setAntecipando(null);
              registrarAntecipada.mutate({
                id: item.recorrente.id,
                numero: dados.numero,
                valor: dados.valor,
                valorDeTabela: Number(item.recorrente.valor),
                data: dados.data,
              });
            }}
            onDesfazer={(antecipada) => {
              if (
                confirm(
                  `Desfazer a antecipação da parcela ${antecipada.numero}? ` +
                    'Ela volta para a fila e a rotina vai gerá-la no mês dela.',
                )
              ) {
                setAntecipando(null);
                desfazerAntecipada.mutate({
                  id: item.recorrente.id,
                  antecipacaoId: antecipada.id,
                });
              }
            }}
          />
        );
      })()}

      {/* O que já foi pago deste contrato, parcela a parcela. */}
      {historico && (() => {
        const item = todos.find((i) => i.recorrente.id === historico);
        if (!item) return null;
        return (
          <JanelaDeHistorico item={item} onFechar={() => setHistorico(null)} />
        );
      })()}

      {/*
       * A conta da parcela antecipada, na mesma tela de sempre.
       *
       * Vem pronta: o credor, a descrição com o número da parcela, a categoria
       * e o veículo. O que fica em branco é o que só o boleto sabe — o valor
       * com desconto — e a forma de pagar, que é onde entra a linha digitável.
       */}
      {aLancar && (
        <NovaDespesa
          inicial={{
            fornecedor: {
              idFornecedor: aLancar.recorrente.idFornecedorIxc,
              nome: aLancar.recorrente.fornecedorNome,
            },
            observacao:
              `${aLancar.recorrente.observacao} ` +
              `(${aLancar.numero}/${aLancar.recorrente.totalParcelas}) antecipada`,
            categoriaId: aLancar.recorrente.categoriaId,
            tipoPagamento: aLancar.recorrente.tipoPagamentoIxc ?? 'Boleto',
          }}
          onLancada={(dados, valorLancado) => {
            registrarAntecipada.mutate({
              id: aLancar.recorrente.id,
              numero: aLancar.numero,
              valor: valorLancado,
              valorDeTabela: Number(aLancar.recorrente.valor),
              contaId: dados.conta.id,
              idFnApagarIxc: dados.conta.idFnApagarIxc,
            });
          }}
          onFechar={() => setALancar(null)}
        />
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ['mensais', `Mensais (${itens.length})`],
            ['consorcios', `Consórcios (${consorcios.length})`],
            ['financiamentos', `Financiamentos (${financiamentos.length})`],
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
                onEditar={(r) => setCadastro({ base: r, modo: 'consorcio' })}
                onAntecipar={(r) => setAntecipando(r.id)}
                onAbrir={(r) => setHistorico(r.id)}
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

      {aba === 'financiamentos' && (
        <>
          {financiamentosAtivos.length > 0 && (
            <p className="mb-4 text-sm text-tinta-500">
              {financiamentosAtivos.length} financiamento(s) correndo, somando{' '}
              <strong className="valor">{formatBRL(financiamentosPorMes)}</strong>{' '}
              por mês.
            </p>
          )}
          <Bloco semPadding>
            {lista.isLoading ? (
              <Carregando />
            ) : (
              <ListaDeConsorcios
                itens={financiamentos}
                vazio={{
                  titulo: 'Nenhum financiamento cadastrado',
                  texto:
                    'Cadastre em "Novo financiamento": o banco, o que está sendo pago e em que parcela está. A conta de cada mês passa a nascer sozinha no IXC.',
                }}
                onEditar={(r) => setCadastro({ base: r, modo: 'financiamento' })}
                onAntecipar={(r) => setAntecipando(r.id)}
                onAbrir={(r) => setHistorico(r.id)}
                onApagar={(r) => {
                  if (
                    confirm(
                      `Apagar o financiamento "${r.observacao}"? ` +
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
                                onClick={() =>
                                  setCadastro({ base: r, modo: 'consorcio' })
                                }
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
