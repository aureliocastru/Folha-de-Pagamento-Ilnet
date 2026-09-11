import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import type { AlmoxarifadoCadastro, EstoqueNaTela, ItemDeEstoque } from '../../lib/types';
import { AcertarNegativos } from './AcertarNegativos';
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
  /** Só o que não tem na prateleira, ou está abaixo do mínimo — ver `estaFaltando`. */
  const [soFaltando, setSoFaltando] = useState(false);
  /** Só o que tem saldo negativo em algum almoxarifado — o que precisa de acerto. */
  const [soNegativos, setSoNegativos] = useState(false);
  const [acertando, setAcertando] = useState(false);
  /** Inativo no IXC some da lista por padrão — este botão pequeno traz de volta. */
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  /** O produto aberto na janela de edição. */
  const [editando, setEditando] = useState<number | null>(null);
  const [cadastrando, setCadastrando] = useState(false);

  const lista = useQuery({
    queryKey: ['almoxarifado', 'estoque', almox],
    queryFn: async () =>
      (
        await api.get<EstoqueNaTela>('/almoxarifado/estoque', {
          params: { ...(almox ? { almox } : {}) },
        })
      ).data,
    // O servidor guarda a leitura do IXC por um minuto; insistir aqui só
    // encheria a tela de espera para receber a mesma resposta.
    staleTime: 60_000,
  });

  /*
   * O filtro de almoxarifado junta dois lados: o que aparece no saldo e o
   * cadastro. Só o saldo deixava de fora quem nunca teve produto lançado (o
   * de equipamentos perdidos, por exemplo) — e quem o procura aqui quer ver
   * justamente que ele está vazio.
   */
  const cadastro = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados'],
    queryFn: async () =>
      (await api.get<AlmoxarifadoCadastro[]>('/almoxarifado/almoxarifados')).data,
    staleTime: 5 * 60_000,
  });

  const dados = lista.data;
  const almoxarifadosDoFiltro = useMemo(() => {
    const porId = new Map<number, string>();
    for (const a of cadastro.data ?? []) if (a.ativo) porId.set(a.id, a.descricao);
    for (const a of dados?.almoxarifados ?? []) porId.set(a.id, a.nome);
    return [...porId.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [cadastro.data, dados]);
  const termo = busca.trim().toLowerCase();
  const inativos = useMemo(
    () => (dados?.itens ?? []).filter((i) => !i.ativo).length,
    [dados],
  );
  /* A busca é aqui: a lista inteira já veio, e mandar o servidor procurar de
     novo a cada letra seria uma ida ao IXC por tecla digitada. O inativo some
     por padrão: é o que não se compra nem se empresta mais, e só atrapalha
     quem está procurando o que a casa tem hoje. */
  const negativos = useMemo(
    () => (dados?.itens ?? []).filter(temNegativo).length,
    [dados],
  );
  /* O zerado some por padrão, como o inativo: quem abre o estoque quer ver o
     que tem na prateleira. Ele volta quando se pede por ele: "Só o que está
     faltando", "Só negativos", ou uma busca — quem digita o nome de um produto
     quer aquele produto, tendo ou não tendo. */
  const esconderZerados = !soFaltando && !soNegativos && !termo;
  const faltando = useMemo(
    () =>
      (dados?.itens ?? []).filter((i) => (mostrarInativos || i.ativo) && estaFaltando(i))
        .length,
    [dados, mostrarInativos],
  );
  const itens = (dados?.itens ?? []).filter((i) => {
    if (!mostrarInativos && !i.ativo) return false;
    if (soNegativos && !temNegativo(i)) return false;
    if (soFaltando && !estaFaltando(i)) return false;
    if (esconderZerados && !temSaldo(i)) return false;
    return termo
      ? i.descricao.toLowerCase().includes(termo) || String(i.produtoId) === termo
      : true;
  });

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
            {almoxarifadosDoFiltro.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}
              </option>
            ))}
          </select>
          <label
            className="opcao text-[12px]"
            title="O que não tem em almoxarifado nenhum, ou está abaixo do mínimo cadastrado"
          >
            <input
              type="checkbox"
              className="marcador"
              checked={soFaltando}
              onChange={(e) => setSoFaltando(e.target.checked)}
            />
            Só o que está faltando{faltando > 0 ? ` (${faltando})` : ''}
          </label>
          {(soNegativos || negativos > 0) && (
            <label
              className="opcao text-[12px]"
              title="Saiu mais do que entrou no IXC — precisa de acerto"
            >
              <input
                type="checkbox"
                className="marcador"
                checked={soNegativos}
                onChange={(e) => setSoNegativos(e.target.checked)}
              />
              Só negativos ({negativos})
            </label>
          )}
          {/* Sempre à vista: é também onde se desfaz uma compra de acerto aberta. */}
          <button
            type="button"
            onClick={() => setAcertando(true)}
            className="btn btn-p btn-neutro"
            title="Ver de onde veio cada negativo, zerar com uma compra de acerto, ou desfazer uma aberta"
          >
            Acertar negativos
          </button>
          {(mostrarInativos || inativos > 0) && (
            <label className="opcao text-[12px]">
              <input
                type="checkbox"
                className="marcador"
                checked={mostrarInativos}
                onChange={(e) => setMostrarInativos(e.target.checked)}
              />
              Mostrar inativos{inativos > 0 ? ` (${inativos})` : ''}
            </label>
          )}
        </div>

        {lista.isLoading && <Carregando texto="Lendo o estoque do IXC…" />}

        {!lista.isLoading && itens.length === 0 && (
          <Vazio titulo="Nada por aqui">
            {soFaltando
              ? 'Nenhum item abaixo do mínimo ou zerado — o estoque está em dia.'
              : almox && !termo
                ? 'Este almoxarifado não tem produto lançado no IXC — está vazio.'
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
                    esconderZeros={esconderZerados}
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

      {acertando && <AcertarNegativos onFechar={() => setAcertando(false)} />}

      {editando !== null && (
        <JanelaDoProduto
          produtoId={editando}
          produtos={dados?.itens ?? []}
          onFechar={() => setEditando(null)}
        />
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
  esconderZeros,
  onAbrir,
  onEditar,
}: {
  item: ItemDeEstoque;
  aberto: boolean;
  /** O almoxarifado com saldo 0 não aparece em "Onde" — o negativo aparece, em vermelho. */
  esconderZeros: boolean;
  onAbrir: () => void;
  onEditar: () => void;
}) {
  const saldos = esconderZeros ? item.saldos.filter((s) => s.saldo !== 0) : item.saldos;
  const temMais = saldos.length > 2;
  const mostrados = aberto ? saldos : saldos.slice(0, 2);

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
                s.saldo < 0
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  : s.abaixoDoMinimo
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
              {aberto ? 'menos' : `+${saldos.length - 2}`}
            </button>
          )}
        </div>
      </td>

      <td className="td">
        <div className="flex flex-wrap items-center gap-1.5">
          {!item.ativo && <Selo tom="neutro">inativo</Selo>}
          {item.servico ? (
            <Selo tom="neutro" titulo="Serviço não é estoque: o IXC não soma entrada de serviço.">
              serviço
            </Selo>
          ) : temNegativo(item) ? (
            <Selo
              tom="erro"
              titulo="Saiu mais do que entrou no IXC. Abra em Editar para acertar."
            >
              negativo
            </Selo>
          ) : item.semNenhum ? (
            <Selo tom="erro">acabou</Selo>
          ) : item.abaixoDoMinimo ? (
            <Selo tom="atencao">abaixo do mínimo</Selo>
          ) : item.ativo ? (
            <span className="text-xs text-tinta-400">—</span>
          ) : null}
        </div>
      </td>

      <td className="td text-right">
        <div className="flex justify-end gap-1.5">
          <AlternarAtivo item={item} />
          <button type="button" onClick={onEditar} className="btn btn-neutro btn-p">
            Editar
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Negativo em algum almoxarifado. Não é "acabou": zero é prateleira vazia;
 * negativo é o IXC registrando saída do que nunca entrou ali — uma entrada
 * que faltou, ou uma saída lançada no almoxarifado errado.
 */
/**
 * Tem alguma coisa na prateleira: saldo acima de zero em algum almoxarifado
 * (no filtro de um almoxarifado, o servidor já recorta os saldos a ele). Não
 * é o total: 5 no ILNET e -5 no Principal somam zero, e os 5 existem.
 */
function temSaldo(item: ItemDeEstoque): boolean {
  return item.saldos.some((s) => s.saldo > 0);
}

/**
 * Está faltando: não tem nada na prateleira em almoxarifado nenhum, ou o IXC
 * diz que o saldo está abaixo do mínimo cadastrado. Era o que os dois botões
 * antigos — "Só o que está faltando" e "Mostrar zerados" — respondiam, cada um
 * do seu jeito: como o mínimo quase nunca está preenchido no IXC, um mostrava
 * a mesma lista que o outro.
 */
function estaFaltando(item: ItemDeEstoque): boolean {
  return item.abaixoDoMinimo || !temSaldo(item);
}

function temNegativo(item: ItemDeEstoque): boolean {
  // Serviço não conta: o IXC não soma entrada dele, e o negativo não é falta de nada.
  return !item.servico && item.saldos.some((s) => s.saldo < 0);
}

/** Ativar/inativar o produto no IXC, direto da lista — sem abrir a janela inteira. */
function AlternarAtivo({ item }: { item: ItemDeEstoque }) {
  const qc = useQueryClient();
  const alternar = useMutation({
    mutationFn: async () => {
      await api.patch(`/almoxarifado/produtos/${item.produtoId}`, { ativo: !item.ativo });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] }),
  });

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={() => {
          if (
            item.ativo &&
            !confirm(`Inativar "${item.descricao}" (código ${item.produtoId}) no IXC?`)
          ) {
            return;
          }
          alternar.mutate();
        }}
        disabled={alternar.isPending}
        className="btn btn-sutil btn-p"
      >
        {alternar.isPending ? '…' : item.ativo ? 'Inativar' : 'Ativar'}
      </button>
      {alternar.isError && (
        <p className="mt-1 max-w-[14rem] text-[11px] text-rose-600">
          {mensagemErro(alternar.error)}
        </p>
      )}
    </div>
  );
}
