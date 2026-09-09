import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Indicador,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData, formatPrecoUnitario } from '../../lib/format';
import type {
  FornecedorCotacao,
  ProdutoCotado,
  ProdutoCotadoDetalhado,
  UnidadeProduto,
} from '../../lib/types';

/**
 * As unidades, por extenso e abreviadas.
 *
 * A unidade mora no produto, e não no preço: é isso que faz a comparação
 * valer. "Drop a R$ 0,85" só quer dizer alguma coisa depois de "o metro" — e
 * dois fornecedores só se comparam se estiverem falando da mesma medida.
 */
const UNIDADES: Array<{ id: UnidadeProduto; curta: string; longa: string }> = [
  { id: 'UN', curta: 'un', longa: 'unidade' },
  { id: 'M', curta: 'm', longa: 'metro' },
  { id: 'KM', curta: 'km', longa: 'quilômetro' },
  { id: 'CX', curta: 'cx', longa: 'caixa' },
  { id: 'ROLO', curta: 'rolo', longa: 'rolo' },
  { id: 'PCT', curta: 'pct', longa: 'pacote' },
  { id: 'KG', curta: 'kg', longa: 'quilo' },
  { id: 'L', curta: 'L', longa: 'litro' },
  { id: 'PAR', curta: 'par', longa: 'par' },
];

function unidadeCurta(u: UnidadeProduto): string {
  return UNIDADES.find((x) => x.id === u)?.curta ?? u.toLowerCase();
}

/**
 * O catálogo de preços: onde cada material está mais barato hoje.
 *
 * É a tela que o módulo existe para ter. Cada linha é uma coisa que a casa
 * compra — drop, ONU, roteador, conector — e o que ela responde é uma pergunta
 * só: na hora de fazer o pedido, de quem comprar.
 *
 * O preço não se sobrescreve: cada cotação vira uma linha com a data em que o
 * vendedor a passou, e o que vale é a mais recente de cada fornecedor. É o que
 * permite ver que o drop subiu 40% desde março — que é a informação com que se
 * pede desconto.
 */
export function Precos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [verInativos, setVerInativos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [criandoProduto, setCriandoProduto] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['cotacoes', 'produtos', verInativos],
    queryFn: async () =>
      (
        await api.get<ProdutoCotado[]>('/cotacoes/produtos', {
          params: verInativos ? { inativos: 1 } : {},
        })
      ).data,
  });

  // Os fornecedores vêm junto porque o formulário de preço precisa deles, e
  // porque "quantos fornecedores temos" é um dos números do topo. Uma consulta
  // só serve às duas coisas.
  const fornecedores = useQuery({
    queryKey: ['cotacoes', 'fornecedores', false],
    queryFn: async () =>
      (await api.get<FornecedorCotacao[]>('/cotacoes/fornecedores')).data,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 2500);
  }

  const criarProduto = useMutation({
    mutationFn: async (dados: {
      nome: string;
      codigo?: string;
      unidade: UnidadeProduto;
      observacao?: string;
    }) => (await api.post<ProdutoCotado>('/cotacoes/produtos', dados)).data,
    onSuccess: (p) => {
      setCriandoProduto(false);
      avisar(`"${p.nome}" cadastrado. Agora lance o preço de cada fornecedor.`);
      void qc.invalidateQueries({ queryKey: ['cotacoes'] });
      // Já abre o produto novo: o cadastro sozinho não serve para nada, e o
      // passo seguinte é sempre lançar o primeiro preço.
      setAberto(p.id);
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const produtos = lista.data ?? [];
  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? produtos.filter((p) =>
        [p.nome, p.codigo].filter(Boolean).some((t) =>
          t!.toLowerCase().includes(termo),
        ),
      )
    : produtos;

  const semPreco = produtos.filter((p) => !p.maisBarato).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Cotações de Preços"
        titulo="Onde está mais barato"
        descricao="O preço de cada material em cada fornecedor. O que vale é a cotação mais recente de cada um — o resto fica no histórico, que é o que mostra o que subiu."
        acoes={
          <button
            type="button"
            onClick={() => setCriandoProduto(true)}
            className="btn btn-primario"
          >
            Novo produto
          </button>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 sm:grid-cols-3">
        <Indicador
          acento
          rotulo="Produtos no catálogo"
          valor={produtos.length}
          detalhe={`${produtos.length - semPreco} com preço`}
        />
        <Indicador
          rotulo="Sem cotação"
          valor={semPreco}
          detalhe="ninguém deu preço ainda"
          alerta={semPreco > 0 ? 'não dá para comparar' : undefined}
        />
        <Indicador
          rotulo="Fornecedores"
          valor={fornecedores.data?.length ?? '—'}
          detalhe="ativos no cadastro"
        />
      </div>

      <Bloco
        titulo={`${filtrados.length} ${filtrados.length === 1 ? 'produto' : 'produtos'}`}
        semPadding
        acao={
          <label className="opcao text-[12px]">
            <input
              type="checkbox"
              className="marcador"
              checked={verInativos}
              onChange={(e) => setVerInativos(e.target.checked)}
            />
            Mostrar desativados
          </label>
        }
      >
        <div className="px-3.5 py-3 md:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código — drop, ONU, roteador…"
            className="campo"
            autoComplete="off"
          />
        </div>

        {lista.isLoading && <Carregando />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler o catálogo">
            {mensagemErro(lista.error)}
          </Vazio>
        )}

        {!lista.isLoading && filtrados.length === 0 && (
          <Vazio titulo="Nenhum produto aqui">
            Comece cadastrando o que a casa compra — drop, roteador, ONU, OLT —
            e depois lance o preço de cada fornecedor em cada um.
          </Vazio>
        )}

        {filtrados.length > 0 && (
          <div className="rolagem-fina overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produto</th>
                  <th className="th text-right">Mais barato</th>
                  <th className="th">Onde</th>
                  <th className="th text-right">Economia</th>
                  <th className="th text-right">Cotado por</th>
                  <th className="th">Última cotação</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setAberto(p.id)}
                    className="linha cursor-pointer"
                  >
                    <td className="td">
                      <div className="font-semibold text-tinta-900">
                        {p.nome}
                        {!p.ativo && (
                          <span className="ml-2">
                            <Selo pequeno>desativado</Selo>
                          </span>
                        )}
                      </div>
                      <div className="text-[12px] text-tinta-400">
                        {[p.codigo, `por ${unidadeCurta(p.unidade)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>

                    <td className="td text-right">
                      {p.maisBarato ? (
                        <span className="valor text-[15px]">
                          {formatPrecoUnitario(p.maisBarato.valor)}
                        </span>
                      ) : (
                        <span className="text-tinta-400">—</span>
                      )}
                    </td>

                    <td className="td">
                      {p.maisBarato ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-300">
                          {p.maisBarato.fornecedor.nome}
                        </span>
                      ) : (
                        <span className="text-tinta-400">sem cotação</span>
                      )}
                    </td>

                    <td className="td text-right">
                      {/*
                        Quanto some da conta trocando o mais caro pelo mais
                        barato. Sem isto a lista diria onde comprar, mas não se
                        a diferença vale o telefonema.
                      */}
                      {p.economia ? (
                        <Selo tom={p.economia.percentual >= 15 ? 'pago' : 'neutro'}>
                          −{p.economia.percentual.toLocaleString('pt-BR')}%
                        </Selo>
                      ) : (
                        <span className="text-tinta-400">—</span>
                      )}
                    </td>

                    <td className="td num text-right">
                      {p.precos.length > 0 ? (
                        p.precos.length
                      ) : (
                        <span className="text-tinta-400">0</span>
                      )}
                    </td>

                    <td className="td text-tinta-500">
                      {p.maisBarato ? formatData(p.maisBarato.data) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {aberto && (
        <JanelaDoProduto
          produtoId={aberto}
          fornecedores={fornecedores.data ?? []}
          onFechar={() => setAberto(null)}
          onAvisar={avisar}
        />
      )}

      {criandoProduto && (
        <FormularioProduto
          salvando={criarProduto.isPending}
          onSalvar={(dados) => criarProduto.mutate(dados)}
          onFechar={() => setCriandoProduto(false)}
        />
      )}
    </Pagina>
  );
}

/**
 * Um produto aberto: os preços que valem, do mais barato ao mais caro, o
 * lançamento de uma cotação nova e o histórico inteiro.
 *
 * Tudo numa janela só porque é um gesto só: liga-se para o vendedor, anota-se
 * o preço, e o que se quer ver em seguida é se ele passou a ser o mais barato.
 */
function JanelaDoProduto({
  produtoId,
  fornecedores,
  onFechar,
  onAvisar,
}: {
  produtoId: string;
  fornecedores: FornecedorCotacao[];
  onFechar: () => void;
  onAvisar: (texto: string, ruim?: boolean) => void;
}) {
  const qc = useQueryClient();
  const [verHistorico, setVerHistorico] = useState(false);

  const produto = useQuery({
    queryKey: ['cotacoes', 'produto', produtoId],
    queryFn: async () =>
      (await api.get<ProdutoCotadoDetalhado>(`/cotacoes/produtos/${produtoId}`))
        .data,
  });

  function guardar(atualizado: ProdutoCotadoDetalhado) {
    // A resposta já traz o produto recalculado: escrevê-la no cache troca o
    // campeão na hora, sem a janela piscar num estado de carregamento.
    qc.setQueryData(['cotacoes', 'produto', produtoId], atualizado);
    void qc.invalidateQueries({ queryKey: ['cotacoes', 'produtos'] });
    void qc.invalidateQueries({ queryKey: ['cotacoes', 'fornecedores'] });
  }

  const lancar = useMutation({
    mutationFn: async (dados: {
      fornecedorId: string;
      valor: number;
      data?: string;
      quantidadeMinima?: number;
      observacao?: string;
    }) =>
      (
        await api.post<ProdutoCotadoDetalhado>('/cotacoes/precos', {
          produtoId,
          ...dados,
        })
      ).data,
    onSuccess: (p) => {
      guardar(p);
      const campeao = p.maisBarato;
      onAvisar(
        campeao
          ? `Preço lançado. O mais barato é ${campeao.fornecedor.nome}, a ${formatPrecoUnitario(campeao.valor)}.`
          : 'Preço lançado.',
      );
    },
    onError: (e) => onAvisar(mensagemErro(e), true),
  });

  const apagarPreco = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<ProdutoCotadoDetalhado>(`/cotacoes/precos/${id}`)).data,
    onSuccess: (p) => {
      guardar(p);
      onAvisar('Cotação apagada.');
    },
    onError: (e) => onAvisar(mensagemErro(e), true),
  });

  const p = produto.data;

  return (
    <Janela titulo={p?.nome ?? 'Produto'} onFechar={onFechar}>
      {produto.isLoading && <Carregando />}
      {produto.isError && (
        <Vazio titulo="Não deu para abrir o produto">
          {mensagemErro(produto.error)}
        </Vazio>
      )}

      {p && (
        <div className="space-y-5">
          <p className="text-[13px] text-tinta-500">
            {[p.codigo, `preço por ${unidadeCurta(p.unidade)}`]
              .filter(Boolean)
              .join(' · ')}
            {p.observacao ? ` — ${p.observacao}` : ''}
          </p>

          {/* Os preços que valem, do mais barato ao mais caro. */}
          {p.precos.length === 0 ? (
            <Vazio titulo="Ninguém deu preço ainda">
              Lance abaixo a primeira cotação. Com um fornecedor só não há o que
              comparar — a comparação começa no segundo.
            </Vazio>
          ) : (
            <div className="lista-dividida rounded-xl border border-tinta-200">
              {p.precos.map((preco, i) => (
                <div
                  key={preco.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-3 ${
                    i === 0 ? 'bg-emerald-500/[0.07]' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-tinta-900">
                        {preco.fornecedor.nome}
                      </span>
                      {i === 0 && <Selo tom="pago">mais barato</Selo>}
                      {!preco.fornecedor.ativo && (
                        <Selo pequeno>fornecedor desativado</Selo>
                      )}
                    </div>
                    <div className="text-[12px] text-tinta-400">
                      cotado em {formatData(preco.data)}
                      {preco.quantidadeMinima
                        ? ` · a partir de ${preco.quantidadeMinima.toLocaleString('pt-BR')} ${unidadeCurta(p.unidade)}`
                        : ''}
                      {preco.registradoPor ? ` · por ${preco.registradoPor}` : ''}
                    </div>
                    {preco.observacao && (
                      <div className="mt-0.5 text-[12px] text-tinta-500">
                        {preco.observacao}
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="valor text-[17px]">
                      {formatPrecoUnitario(preco.valor)}
                    </div>
                    {preco.aMaisQueOMenor > 0 && (
                      <div className="text-[12px] font-semibold text-rose-600 dark:text-rose-300">
                        +{formatPrecoUnitario(preco.aMaisQueOMenor)} por{' '}
                        {unidadeCurta(p.unidade)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {p.economia && (
            <Aviso tom="pago">
              Comprando do mais barato em vez do mais caro, cada{' '}
              {unidadeCurta(p.unidade)} sai{' '}
              <strong>{formatPrecoUnitario(p.economia.valor)}</strong> mais em
              conta — {p.economia.percentual.toLocaleString('pt-BR')}% a menos.
            </Aviso>
          )}

          <FormularioDePreco
            unidade={unidadeCurta(p.unidade)}
            fornecedores={fornecedores}
            lancando={lancar.isPending}
            onLancar={(dados) => lancar.mutate(dados)}
          />

          {p.historico.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setVerHistorico((v) => !v)}
                className="btn btn-p btn-sutil"
              >
                {verHistorico ? 'Esconder' : 'Ver'} o histórico ({p.cotacoes}{' '}
                {p.cotacoes === 1 ? 'cotação' : 'cotações'})
              </button>

              {verHistorico && (
                <div className="rolagem-fina mt-3 overflow-x-auto rounded-xl border border-tinta-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th">Data</th>
                        <th className="th">Fornecedor</th>
                        <th className="th text-right">Preço</th>
                        <th className="th" />
                      </tr>
                    </thead>
                    <tbody>
                      {p.historico.map((c) => (
                        <tr key={c.id} className="linha">
                          <td className="td whitespace-nowrap">
                            {formatData(c.data)}
                          </td>
                          <td className="td">
                            {c.fornecedor.nome}
                            {c.vale && (
                              <span className="ml-2">
                                {/* Qual das linhas é a que conta hoje. Sem
                                    isto, o histórico de um fornecedor com
                                    cinco cotações não diz qual está valendo. */}
                                <Selo pequeno tom="marca">
                                  vale hoje
                                </Selo>
                              </span>
                            )}
                          </td>
                          <td className="td num text-right">
                            {formatPrecoUnitario(c.valor)}
                          </td>
                          <td className="td text-right">
                            <button
                              type="button"
                              disabled={apagarPreco.isPending}
                              onClick={() => apagarPreco.mutate(c.id)}
                              className="btn btn-p btn-perigo"
                            >
                              Apagar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Janela>
  );
}

/** Lançar uma cotação nova neste produto. */
function FormularioDePreco({
  unidade,
  fornecedores,
  lancando,
  onLancar,
}: {
  unidade: string;
  fornecedores: FornecedorCotacao[];
  lancando: boolean;
  onLancar: (dados: {
    fornecedorId: string;
    valor: number;
    data?: string;
    quantidadeMinima?: number;
    observacao?: string;
  }) => void;
}) {
  const [fornecedorId, setFornecedorId] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [minima, setMinima] = useState('');
  const [observacao, setObservacao] = useState('');

  const pronto = fornecedorId !== '' && Number(valor) > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!pronto) return;
        onLancar({
          fornecedorId,
          valor: Number(valor),
          data,
          quantidadeMinima: minima ? Number(minima) : undefined,
          observacao: observacao.trim() || undefined,
        });
        setValor('');
        setMinima('');
        setObservacao('');
      }}
      className="rounded-xl border border-tinta-200 bg-tinta-50 p-3.5"
    >
      <h3 className="titulo-bloco mb-3">Lançar preço</h3>

      {fornecedores.length === 0 ? (
        <p className="text-[13px] text-tinta-500">
          Nenhum fornecedor cadastrado ainda. Cadastre um em Fornecedores — o
          preço mora nele.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="rotulo" htmlFor="preco-fornecedor">
                Fornecedor *
              </label>
              <select
                id="preco-fornecedor"
                value={fornecedorId}
                onChange={(e) => setFornecedorId(e.target.value)}
                className="campo"
              >
                <option value="">Escolha…</option>
                {fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="rotulo" htmlFor="preco-valor">
                Preço por {unidade} *
              </label>
              {/*
                Quatro casas: drop se compra a R$ 0,4750 o metro, e arredondar
                para R$ 0,48 erra R$ 25,00 num rolo de dez mil metros — bem
                acima do que costuma separar dois fornecedores.
              */}
              <CampoDinheiro
                id="preco-valor"
                casas={4}
                valor={valor}
                onChange={setValor}
              />
            </div>

            <div>
              <label className="rotulo" htmlFor="preco-data">
                Data da cotação
              </label>
              <input
                id="preco-data"
                type="date"
                value={data}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setData(e.target.value)}
                className="campo"
              />
              <p className="ajuda">
                O dia em que o vendedor passou o preço, e não o dia em que se
                lançou aqui.
              </p>
            </div>

            <div>
              <label className="rotulo" htmlFor="preco-minima">
                Quantidade mínima
              </label>
              <input
                id="preco-minima"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={minima}
                onChange={(e) => setMinima(e.target.value)}
                className="campo"
                placeholder={`em ${unidade} — vazio = qualquer`}
              />
              <p className="ajuda">
                É o que explica por que o mais barato da lista às vezes não
                serve.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="rotulo" htmlFor="preco-obs">
                Observação
              </label>
              <input
                id="preco-obs"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="campo"
                placeholder="Frete incluso, prazo de entrega, condição de pagamento…"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={!pronto || lancando}
              className="btn btn-primario"
            >
              {lancando ? 'Lançando…' : 'Lançar preço'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/** Cadastrar um produto novo no catálogo. */
function FormularioProduto({
  salvando,
  onSalvar,
  onFechar,
}: {
  salvando: boolean;
  onSalvar: (dados: {
    nome: string;
    codigo?: string;
    unidade: UnidadeProduto;
    observacao?: string;
  }) => void;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [unidade, setUnidade] = useState<UnidadeProduto>('UN');
  const [observacao, setObservacao] = useState('');

  return (
    <Janela titulo="Novo produto" onFechar={onFechar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar({
            nome,
            codigo: codigo.trim() || undefined,
            unidade,
            observacao: observacao.trim() || undefined,
          });
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="rotulo" htmlFor="prod-nome">
              Produto *
            </label>
            <input
              id="prod-nome"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="campo"
              placeholder="Cabo drop 1FO, ONU 1 porta, Roteador AC1200…"
              autoComplete="off"
            />
            <p className="ajuda">
              Específico o bastante para não haver dúvida do que se está
              comparando: "ONU 1 porta" e "ONU 2 portas" são dois produtos.
            </p>
          </div>

          <div>
            <label className="rotulo" htmlFor="prod-unidade">
              Comprado por *
            </label>
            <select
              id="prod-unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value as UnidadeProduto)}
              className="campo"
            >
              {UNIDADES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.longa}
                </option>
              ))}
            </select>
            <p className="ajuda">
              Todos os preços deste produto vão nesta unidade — é o que faz a
              comparação entre fornecedores valer.
            </p>
          </div>

          <div>
            <label className="rotulo" htmlFor="prod-codigo">
              Código
            </label>
            <input
              id="prod-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="campo"
              placeholder="do fabricante ou da casa"
              autoComplete="off"
            />
          </div>

          <div className="md:col-span-2">
            <label className="rotulo" htmlFor="prod-obs">
              Observação
            </label>
            <textarea
              id="prod-obs"
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-tinta-200 pt-4">
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando || nome.trim().length < 2}
            className="btn btn-primario"
          >
            {salvando ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Janela>
  );
}
