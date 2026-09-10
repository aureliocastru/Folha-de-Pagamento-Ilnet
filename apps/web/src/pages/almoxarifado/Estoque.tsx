import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { formatBRL } from '../../lib/format';
import type { EstoqueNaTela, ItemDeEstoque } from '../../lib/types';
import { JanelaDoProduto, NovoProduto, quantidade } from './ProdutoNoIxc';

/**
 * O estoque de material, do IXC.
 *
 * **A fonte da verdade é o IXC.** O que se muda aqui — o cadastro do produto,
 * a transferência entre almoxarifados, a entrada de compra — é gravado lá (ver
 * `ProdutoNoIxc`), e esta lista é o espelho, relido depois de cada escrita. A
 * tela diz de onde veio e a que horas.
 *
 * O que ela faz é o que o IXC faz mal: responder de relance **o que está
 * acabando** e **onde tem**. Lá isso é uma consulta com filtros; aqui é a
 * primeira coisa na tela.
 */
export function Estoque() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [almox, setAlmox] = useState('');
  const [soFaltando, setSoFaltando] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  /** O produto aberto na janela de edição. */
  const [editando, setEditando] = useState<number | null>(null);
  const [cadastrando, setCadastrando] = useState(false);

  const lista = useQuery({
    queryKey: ['almoxarifado', 'estoque', almox, soFaltando],
    queryFn: async () =>
      (
        await api.get<EstoqueNaTela>('/almoxarifado/estoque', {
          params: {
            ...(almox ? { almox } : {}),
            ...(soFaltando ? { faltando: 1 } : {}),
          },
        })
      ).data,
    // O servidor guarda a leitura do IXC por um minuto; insistir aqui só
    // encheria a tela de espera para receber a mesma resposta.
    staleTime: 60_000,
  });

  const dados = lista.data;
  const termo = busca.trim().toLowerCase();
  /* A busca é aqui: a lista inteira já veio, e mandar o servidor procurar de
     novo a cada letra seria uma ida ao IXC por tecla digitada. */
  const itens = (dados?.itens ?? []).filter((i) =>
    termo
      ? i.descricao.toLowerCase().includes(termo) ||
        String(i.produtoId) === termo
      : true,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Estoque"
        descricao={
          <>
            O que a casa tem e onde. Vem do IXC, que é onde o estoque é
            controlado — e o que se muda aqui (cadastro, transferência,
            entrada de compra) é gravado lá.
          </>
        }
        acoes={
          <>
          <button
            type="button"
            onClick={() => setCadastrando(true)}
            className="btn btn-acao"
          >
            Novo produto
          </button>
          <button
            type="button"
            onClick={() => {
              void api
                .get('/almoxarifado/estoque', { params: { recarregar: 1 } })
                .finally(() =>
                  qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] }),
                );
            }}
            disabled={lista.isFetching}
            className="btn btn-neutro"
          >
            {lista.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
          </button>
          </>
        }
      />

      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

      <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        <Indicador
          acento
          rotulo="Itens em estoque"
          valor={dados?.resumo.itens ?? '—'}
          detalhe="produtos com saldo lançado"
        />
        <Indicador
          rotulo="Abaixo do mínimo"
          valor={dados?.resumo.abaixoDoMinimo ?? '—'}
          detalhe="tem menos que o cadastrado"
          alerta={
            dados && dados.resumo.abaixoDoMinimo > 0 ? 'precisa comprar' : undefined
          }
        />
        <Indicador
          rotulo="Zerados"
          valor={dados?.resumo.semNenhum ?? '—'}
          detalhe="não tem em almoxarifado nenhum"
        />
        <Indicador
          rotulo="Valor guardado"
          valor={formatBRL(dados?.resumo.valorEmEstoque)}
          detalhe="pelo preço base do cadastro"
        />
      </div>

      <Bloco
        titulo={`${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`}
        semPadding
        acao={
          dados && (
            <span className="text-[11px] text-tinta-400">
              lido do IXC às{' '}
              {new Date(dados.lidoEm).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3 md:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou código do produto…"
            className="campo min-w-0 flex-1"
            autoComplete="off"
          />
          <select
            value={almox}
            onChange={(e) => setAlmox(e.target.value)}
            className="campo w-auto min-w-[12rem]"
            title="Ver o saldo de um almoxarifado só"
          >
            <option value="">Todos os almoxarifados</option>
            {dados?.almoxarifados.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
          <label className="opcao text-[12px]">
            <input
              type="checkbox"
              className="marcador"
              checked={soFaltando}
              onChange={(e) => setSoFaltando(e.target.checked)}
            />
            Só o que está faltando
          </label>
        </div>

        {lista.isLoading && <Carregando texto="Lendo o estoque do IXC…" />}

        {!lista.isLoading && itens.length === 0 && (
          <Vazio titulo="Nada por aqui">
            {soFaltando
              ? 'Nenhum item abaixo do mínimo ou zerado — o estoque está em dia.'
              : 'O IXC não devolveu saldo nenhum para este filtro.'}
          </Vazio>
        )}

        {itens.length > 0 && (
          <div className="rolagem-fina overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Produto</th>
                  <th className="th text-right">Tem</th>
                  <th className="th">Onde</th>
                  <th className="th">Situação</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <LinhaDoItem
                    key={i.produtoId}
                    item={i}
                    aberto={aberto === i.produtoId}
                    onAbrir={() =>
                      setAberto((a) => (a === i.produtoId ? null : i.produtoId))
                    }
                    onEditar={() => setEditando(i.produtoId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {editando !== null && (
        <JanelaDoProduto produtoId={editando} onFechar={() => setEditando(null)} />
      )}
      {cadastrando && (
        <NovoProduto
          produtos={dados?.itens ?? []}
          onFechar={() => setCadastrando(false)}
          onCriado={(id) => {
            setCadastrando(false);
            // O produto novo abre na hora: o passo seguinte quase sempre é dar
            // entrada no primeiro lote dele.
            setEditando(id);
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * Uma linha do estoque.
 *
 * "Onde" mostra os dois almoxarifados com mais saldo e esconde o resto atrás do
 * clique: um item que existe em seis lugares encheria a coluna e empurraria as
 * outras linhas, e quem procura material quase sempre para no primeiro.
 */
function LinhaDoItem({
  item,
  aberto,
  onAbrir,
  onEditar,
}: {
  item: ItemDeEstoque;
  aberto: boolean;
  onAbrir: () => void;
  onEditar: () => void;
}) {
  const temMais = item.saldos.length > 2;
  const mostrados = aberto ? item.saldos : item.saldos.slice(0, 2);

  return (
    <tr className="linha">
      <td className="td">
        <div className="font-medium text-tinta-800">{item.descricao}</div>
        <div className="num text-xs text-tinta-400">
          código {item.produtoId}
          {item.precoBase ? ` · ${formatBRL(item.precoBase)} a unidade` : ''}
        </div>
      </td>

      <td className="td whitespace-nowrap text-right">
        <span
          className={`valor text-[15px] ${
            item.semNenhum ? 'text-rose-600 dark:text-rose-300' : ''
          }`}
        >
          {quantidade(item.total)}
        </span>
        {item.unidade && (
          <span className="ml-1 text-[11px] text-tinta-400">{item.unidade}</span>
        )}
      </td>

      <td className="td">
        <div className="flex flex-wrap items-center gap-1.5">
          {mostrados.map((s) => (
            <span
              key={s.almoxId}
              title={
                s.minimo !== null
                  ? `mínimo cadastrado: ${quantidade(s.minimo)}`
                  : 'sem mínimo cadastrado'
              }
              className={`selo-p ${
                s.abaixoDoMinimo
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-tinta-100 text-tinta-600'
              }`}
            >
              {s.almoxarifado} · {quantidade(s.saldo)}
            </span>
          ))}
          {temMais && (
            <button
              type="button"
              onClick={onAbrir}
              className="text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              {aberto ? 'menos' : `+${item.saldos.length - 2}`}
            </button>
          )}
        </div>
      </td>

      <td className="td">
        {item.semNenhum ? (
          <Selo tom="erro">acabou</Selo>
        ) : item.abaixoDoMinimo ? (
          <Selo tom="atencao">abaixo do mínimo</Selo>
        ) : (
          <span className="text-xs text-tinta-400">—</span>
        )}
      </td>

      <td className="td text-right">
        <button type="button" onClick={onEditar} className="btn btn-neutro btn-p">
          Editar
        </button>
      </td>
    </tr>
  );
}
