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
  type Tom,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento } from '../../lib/busca';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { formatBRL, formatData } from '../../lib/format';
import { TIPO_LABEL } from '../../lib/status';
import type {
  CategoriaDespesa,
  ContaAberta,
  ContasAbertas,
} from '../../lib/types';
import { EditarConta, ExcluirConta, PagarEmMaos } from './AcoesDaConta';
import { DespesasNaoEnviadas } from './DespesasNaoEnviadas';
import { DetalheDaConta } from './DetalheDaConta';
import { NovaDespesa } from './NovaDespesa';
import { TornarRecorrente } from './TornarRecorrente';

/**
 * O que a empresa deve hoje, lido do IXC na hora de abrir.
 *
 * Não há cópia local de propósito: conta em aberto é o estado mais volátil do
 * financeiro — alguém paga uma no caixa e ela deixa de ser devida no mesmo
 * minuto. Um espelho aqui estaria errado a maior parte do dia, e número errado
 * sobre dívida é pior que número nenhum.
 */

/** As fatias do resumo viram filtro: clicar no número mostra as contas dele. */
type Recorte = 'todas' | 'vencidas' | 'semana' | 'demais' | 'sem-data';

export function Inicio() {
  const queryClient = useQueryClient();
  const [recorte, setRecorte] = useState<Recorte>('todas');
  const [busca, setBusca] = useState('');
  /** Mostrar só o que ninguém etiquetou ainda — a fila de trabalho. */
  const [soSemCategoria, setSoSemCategoria] = useState(false);
  /** Título cujos campos crus do IXC estamos olhando. */
  const [detalhando, setDetalhando] = useState<ContaAberta | null>(null);
  const [lancando, setLancando] = useState(false);
  /** Títulos marcados para receber a mesma etiqueta de uma vez. */
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [categoriaLote, setCategoriaLote] = useState('');
  const [avisoLote, setAvisoLote] = useState<string | null>(null);
  const [erroLote, setErroLote] = useState(false);
  /** Contas na janela de pagamento — uma, ou as marcadas. */
  const [pagandoEmMaos, setPagandoEmMaos] = useState<ContaAberta[] | null>(null);
  const [editando, setEditando] = useState<ContaAberta | null>(null);
  const [excluindo, setExcluindo] = useState<ContaAberta | null>(null);
  /** Conta que está virando despesa mensal. */
  const [repetindo, setRepetindo] = useState<ContaAberta | null>(null);

  const consulta = useQuery({
    queryKey: ['contas-abertas'],
    queryFn: async () =>
      (await api.get<ContasAbertas>('/contas-abertas')).data,
    // Sem retentativa automática, ao contrário do resto do app. Quando o IXC
    // não responde ele costuma não responder por 30 segundos até estourar o
    // tempo — tentar de novo por baixo dobraria a espera com a tela parada em
    // "lendo", sem dizer nada a quem espera. Aqui é melhor falhar rápido e
    // deixar o botão Atualizar à mão.
    retry: 0,
  });

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const contas = useMemo(
    () => filtrar(consulta.data?.contas ?? [], recorte, busca, soSemCategoria),
    [consulta.data, recorte, busca, soSemCategoria],
  );

  /**
   * Etiqueta tudo que está marcado de uma vez. A lista inteira é recarregada
   * depois — é dela que o dashboard tira os agrupamentos, e as duas telas
   * discordarem sobre em que categoria está um gasto é pior que não ter
   * categoria nenhuma.
   */
  const classificarLote = useMutation({
    mutationFn: async (categoriaId: string | null) => {
      const { data } = await api.put<{ classificadas: number }>(
        '/contas-abertas/categoria-lote',
        { idsFnApagar: [...marcados], categoriaId },
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
      void queryClient.invalidateQueries({ queryKey: ['categorias-despesa'] });
      setMarcados(new Set());
      setCategoriaLote('');
    },
  });

  /**
   * Apaga no IXC tudo o que está marcado. Uma que falhe não impede as outras —
   * conta já paga, por exemplo, é recusada e a tela diz quantas ficaram.
   */
  const excluirLote = useMutation({
    mutationFn: async (ids: number[]) => {
      const { data } = await api.post<{
        apagados: number[];
        falhas: Array<{ idFnApagar: number; erro: string }>;
      }>('/contas-abertas/excluir-lote', { idsFnApagar: ids });
      return data;
    },
    onSuccess: (r) => {
      setMarcados(new Set());
      setAvisoLote(
        `${r.apagados.length} título(s) apagados no IXC.` +
          (r.falhas.length
            ? ` ${r.falhas.length} não puderam ser apagados: ${r.falhas
                .map((f) => `nº ${f.idFnApagar} (${f.erro})`)
                .join('; ')}`
            : ''),
      );
      setErroLote(r.falhas.length > 0);
      void queryClient.invalidateQueries({ queryKey: ['contas-abertas'] });
    },
    onError: (err) => {
      setErroLote(true);
      setAvisoLote(mensagemErro(err));
    },
  });

  function alternarMarcado(idFnApagar: number) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(idFnApagar)) proximo.add(idFnApagar);
      return proximo;
    });
  }

  /**
   * O checkbox do cabeçalho vale para o que está na tela, não para a base
   * inteira: marcar 528 títulos porque alguém clicou num quadradinho depois de
   * filtrar por um fornecedor seria classificar a empresa toda sem querer.
   */
  const visiveisMarcados = contas.filter((c) => marcados.has(c.idFnApagar));
  const todosVisiveisMarcados =
    contas.length > 0 && visiveisMarcados.length === contas.length;

  function alternarTodosVisiveis() {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (todosVisiveisMarcados) {
        contas.forEach((c) => proximo.delete(c.idFnApagar));
      } else {
        contas.forEach((c) => proximo.add(c.idFnApagar));
      }
      return proximo;
    });
  }

  const semCategoria = (consulta.data?.contas ?? []).filter(
    (c) => !c.classificacao,
  ).length;

  const resumo = consulta.data?.resumo;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Em aberto"
        titulo="O que a empresa deve"
        descricao="Tudo que está em aberto no IXC, do jeito que está lá agora. Daqui dá para lançar, pagar, editar e apagar — o que for feito aqui é gravado lá."
        acoes={
          <>
            <button
              onClick={() => setLancando(true)}
              className="btn btn-primario"
            >
              Lançar conta
            </button>
            <button
              onClick={() => consulta.refetch()}
              disabled={consulta.isFetching}
              className="btn btn-acao"
            >
              {consulta.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
            </button>
          </>
        }
      />

      {consulta.error && (
        <Aviso tom="erro">
          Não deu para ler as contas do IXC: {mensagemErro(consulta.error)}
          {consulta.data
            ? ' Os números abaixo são da última leitura que deu certo.'
            : ''}
        </Aviso>
      )}

      {avisoLote && (
        <Aviso
          tom={erroLote ? 'erro' : 'pago'}
          acao={
            <button
              onClick={() => setAvisoLote(null)}
              className="btn btn-sutil btn-p"
            >
              Fechar
            </button>
          }
        >
          {avisoLote}
        </Aviso>
      )}

      {(consulta.data?.avisos ?? []).map((aviso) => (
        <Aviso key={aviso} tom="atencao">
          {aviso}
        </Aviso>
      ))}

      {/* Acima dos indicadores de propósito: uma despesa que não chegou ao IXC
          não está somada em nenhum deles, e é a primeira coisa a resolver. */}
      <DespesasNaoEnviadas />

      {resumo && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Indicador
            rotulo="Total em aberto"
            valor={formatBRL(resumo.total)}
            detalhe={`${resumo.quantidade} título(s)`}
            acento
            aberto={recorte === 'todas'}
            onClick={() => setRecorte('todas')}
          />
          <Indicador
            rotulo="Vencidas"
            valor={formatBRL(resumo.vencidas.total)}
            detalhe={`${resumo.vencidas.quantidade} título(s)`}
            alerta={
              resumo.vencidas.quantidade > 0
                ? 'Já passou do vencimento'
                : undefined
            }
            aberto={recorte === 'vencidas'}
            onClick={() => setRecorte('vencidas')}
          />
          <Indicador
            rotulo="Vencem em 7 dias"
            valor={formatBRL(resumo.venceEmSeteDias.total)}
            detalhe={`${resumo.venceEmSeteDias.quantidade} título(s)`}
            aberto={recorte === 'semana'}
            onClick={() => setRecorte('semana')}
          />
          <Indicador
            rotulo="Depois disso"
            valor={formatBRL(resumo.demais.total)}
            detalhe={
              resumo.semVencimento.quantidade > 0
                ? `${resumo.demais.quantidade} título(s) · ${resumo.semVencimento.quantidade} sem data`
                : `${resumo.demais.quantidade} título(s)`
            }
            aberto={recorte === 'demais'}
            onClick={() => setRecorte('demais')}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor, documento ou observação"
          className="campo max-w-md"
        />
        <button
          onClick={() => setSoSemCategoria((s) => !s)}
          aria-pressed={soSemCategoria}
          title="Mostrar só os débitos que ninguém etiquetou ainda"
          className={
            soSemCategoria
              ? 'btn btn-p bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'btn btn-neutro btn-p'
          }
        >
          Sem categoria
          {semCategoria > 0 && (
            <span className="num opacity-70">· {semCategoria}</span>
          )}
        </button>
        {recorte !== 'todas' && (
          <button
            onClick={() => setRecorte('todas')}
            className="btn btn-sutil btn-p"
          >
            Ver todas
          </button>
        )}
        {consulta.data && (
          <span className="ml-auto text-xs text-tinta-400">
            Lido do IXC às {formatHora(consulta.data.lidoEm)}
          </span>
        )}
      </div>

      {/*
        A barra só existe quando há algo marcado, e some sozinha ao terminar.
        Ela fica acima da tabela de propósito: é onde o olho está depois de
        marcar as linhas, e no rodapé de uma lista de 500 títulos ninguém a
        encontraria.
      */}
      {marcados.size > 0 && (
        <div className="surgir barra-selecao mb-4">
          <span className="barra-selecao-titulo">
            {marcados.size} título(s) marcado(s)
          </span>
          <span className="valor text-sm text-white/80">
            {formatBRL(
              (consulta.data?.contas ?? [])
                .filter((c) => marcados.has(c.idFnApagar))
                .reduce((s, c) => s + c.valorAberto, 0),
            )}
          </span>
          {marcados.size > visiveisMarcados.length && (
            <span
              className="text-xs text-white/50"
              title="A marcação continua valendo para o que o filtro escondeu"
            >
              ({visiveisMarcados.length} na tela agora)
            </span>
          )}
          <SeletorDeCategoria
            className="campo max-w-xs py-1.5 text-sm"
            categorias={categorias.data}
            value={categoriaLote}
            vazio="Escolha a categoria…"
            carregando={categorias.isLoading}
            desabilitado={classificarLote.isPending}
            onChange={setCategoriaLote}
            extras={<option value="__limpar">— tirar a categoria —</option>}
          />
          <button
            onClick={() =>
              classificarLote.mutate(
                categoriaLote === '__limpar' ? null : categoriaLote,
              )
            }
            disabled={!categoriaLote || classificarLote.isPending}
            className="btn btn-primario btn-p"
          >
            {classificarLote.isPending
              ? 'Aplicando…'
              : `Aplicar a ${marcados.size}`}
          </button>
          {/* Pagar o que está marcado, tudo numa janela só: quem separa dez
              contas para pagar em dinheiro não quer dez confirmações. */}
          <button
            onClick={() =>
              setPagandoEmMaos(
                (consulta.data?.contas ?? []).filter((c) =>
                  marcados.has(c.idFnApagar),
                ),
              )
            }
            className="btn btn-pagar btn-p"
          >
            Pagar em mãos
          </button>
          <button
            onClick={() => {
              const alvos = (consulta.data?.contas ?? []).filter((c) =>
                marcados.has(c.idFnApagar),
              );
              const total = alvos.reduce((s, c) => s + c.valorAberto, 0);
              if (
                confirm(
                  `Apagar ${alvos.length} título(s) no IXC, somando ` +
                    `${formatBRL(total)}? As contas já pagas são puladas. ` +
                    'Não dá para desfazer.',
                )
              ) {
                excluirLote.mutate(alvos.map((c) => c.idFnApagar));
              }
            }}
            disabled={excluirLote.isPending}
            className="btn btn-p border border-white/15 text-rose-200 hover:bg-rose-500/20"
          >
            {excluirLote.isPending ? 'Apagando…' : 'Excluir'}
          </button>
          <button
            onClick={() => setMarcados(new Set())}
            className="btn btn-p text-white/60 hover:bg-white/10 hover:text-white"
          >
            Limpar seleção
          </button>
          {classificarLote.isError && (
            <span className="w-full text-sm text-rose-700">
              {mensagemErro(classificarLote.error)}
            </span>
          )}
        </div>
      )}

      <Bloco semPadding>
        {/*
          A ordem destes casos é a regra mais importante da tela: só dá para
          dizer "não há conta nenhuma" depois de a lista ter chegado. Sem esse
          cuidado, todo instante em que a leitura falha ou está a caminho
          viraria um "a empresa não deve nada" — e essa é a única mentira que
          uma tela de contas a pagar não pode contar.
        */}
        {!consulta.data ? (
          consulta.error ? (
            <Vazio titulo="Não deu para ler o IXC">
              As contas ficam no IXC e ele não respondeu agora, então não há o
              que mostrar — o que não quer dizer que não haja contas em aberto.
              Tente de novo em Atualizar.
            </Vazio>
          ) : (
            <Carregando texto="Lendo as contas no IXC…" />
          )
        ) : contas.length === 0 ? (
          <Vazio titulo="Nenhuma conta aqui">
            {consulta.data.contas.length
              ? 'Nenhuma conta bate com o filtro. Tente "Ver todas".'
              : 'Não há conta em aberto no IXC neste momento.'}
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-10">
                    <input
                      type="checkbox"
                      checked={todosVisiveisMarcados}
                      onChange={alternarTodosVisiveis}
                      aria-label={`Marcar os ${contas.length} títulos desta lista`}
                      title={`Marcar os ${contas.length} títulos que o filtro está mostrando`}
                      className="h-4 w-4 cursor-pointer accent-brand-600"
                    />
                  </th>
                  <th className="th">Vencimento</th>
                  <th className="th">Fornecedor</th>
                  <th className="th">Documento</th>
                  <th className="th text-right">Em aberto</th>
                  <th className="th text-right">Pagar</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => (
                  <Linha
                    key={c.idFnApagar}
                    conta={c}
                    marcado={marcados.has(c.idFnApagar)}
                    onMarcar={() => alternarMarcado(c.idFnApagar)}
                    onVerDados={() => setDetalhando(c)}
                    onPagarEmMaos={() => setPagandoEmMaos([c])}
                    onEditar={() => setEditando(c)}
                    onExcluir={() => setExcluindo(c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {detalhando && (
        <DetalheDaConta
          conta={detalhando}
          onFechar={() => setDetalhando(null)}
          onRepetir={() => {
            setRepetindo(detalhando);
            setDetalhando(null);
          }}
        />
      )}

      {repetindo && (
        <TornarRecorrente
          conta={repetindo}
          todas={consulta.data?.contas ?? []}
          onFechar={() => setRepetindo(null)}
        />
      )}

      {lancando && <NovaDespesa onFechar={() => setLancando(false)} />}

      {pagandoEmMaos && pagandoEmMaos.length > 0 && (
        <PagarEmMaos
          contas={pagandoEmMaos}
          onFechar={() => {
            setPagandoEmMaos(null);
            setMarcados(new Set());
          }}
        />
      )}

      {editando && (
        <EditarConta conta={editando} onFechar={() => setEditando(null)} />
      )}

      {excluindo && (
        <ExcluirConta conta={excluindo} onFechar={() => setExcluindo(null)} />
      )}
    </Pagina>
  );
}

function Linha({
  conta,
  marcado,
  onMarcar,
  onVerDados,
  onPagarEmMaos,
  onEditar,
  onExcluir,
}: {
  conta: ContaAberta;
  marcado: boolean;
  onMarcar: () => void;
  onVerDados: () => void;
  /** Abre a janela de pagamento desta conta. */
  onPagarEmMaos: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  const urgencia = urgenciaDaConta(conta);
  return (
    <tr
      onClick={onVerDados}
      // A linha inteira abre o débito. É o gesto que se tenta primeiro numa
      // lista, e o teclado chega ao mesmo lugar pelo tabindex.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onVerDados();
        }
      }}
      title="Abrir o detalhe deste débito"
      className={`linha cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${
        marcado ? 'linha-marcada' : ''
      }`}
    >
      {/* O clique aqui morre no checkbox: marcar para classificar em lote e
          abrir a ficha do débito são dois gestos diferentes na mesma linha. */}
      <td className="td" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={marcado}
          onChange={onMarcar}
          aria-label={`Marcar o título ${conta.idFnApagar} de ${conta.fornecedor.nome}`}
          className="h-4 w-4 cursor-pointer accent-brand-600"
        />
      </td>
      <td
        className={`td whitespace-nowrap border-l-4 ${urgencia.barra}`}
      >
        <div className="num text-tinta-700">
          {conta.vencimento ? formatData(conta.vencimento) : '—'}
        </div>
        <PrazoDaConta conta={conta} />
      </td>
      <td className="td">
        {/* Nome inteiro, sem corte: é por ele que se reconhece a conta, e
            "Companhia Energética do Mar…" obriga a abrir a ficha para saber de
            quem é. */}
        <div className="text-tinta-800">
          {conta.fornecedor.nome || `Fornecedor ${conta.fornecedor.id ?? '?'}`}
        </div>
        {(conta.observacao || conta.parcela) && (
          <div className="mt-0.5 text-xs text-tinta-400">
            {conta.observacao}
            {/* A parcela vem escrita no próprio título ("29/36" no número da
                nota), e é a resposta de "esta é qual delas?" — a pergunta que
                se faz olhando sete linhas iguais do mesmo financiamento. Sai
                junto da observação porque é a mesma frase: do que é esta
                conta. */}
            {conta.parcela && (
              <span className="num ml-1.5 text-tinta-500">
                parcela {conta.parcela.posicao}/{conta.parcela.total}
              </span>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {conta.classificacao ? (
            <Selo
              pequeno
              tom="info"
              titulo={
                conta.classificacao.grupo
                  ? `${conta.classificacao.grupo.nome} · ${conta.classificacao.nome}`
                  : undefined
              }
            >
              {conta.classificacao.nome}
            </Selo>
          ) : (
            <Selo
              pequeno
              tom="atencao"
              titulo="Sem isto o débito fica de fora dos relatórios por categoria — clique para escolher"
            >
              sem classificação
            </Selo>
          )}
          {conta.origem && (
            <Selo
              pequeno
              tom="marca"
              titulo="Esta conta nasceu no módulo Folha de Pagamento — é a mesma dívida, não uma a mais"
            >
              Folha · {TIPO_LABEL[conta.origem.tipo] ?? conta.origem.tipo}
              {conta.origem.beneficiario ? ` · ${conta.origem.beneficiario}` : ''}
            </Selo>
          )}
        </div>
      </td>
      <td className="td num text-tinta-500">{conta.documento ?? '—'}</td>
      <td className="td whitespace-nowrap text-right">
        <span className="valor">{formatBRL(conta.valorAberto)}</span>
        {/* Pagamento parcial: mostrar só o saldo esconderia metade da história. */}
        {conta.valor > conta.valorAberto + 0.005 && (
          <div className="num text-xs text-tinta-400">
            de {formatBRL(conta.valor)}
          </div>
        )}
      </td>

      {/* O clique aqui não abre a ficha: são ações que mexem no IXC. */}
      <td
        className="td whitespace-nowrap text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end gap-1.5">
          {/* Um botão só: a conta escolhida na janela é que decide se o IXC
              recebe a aprovação e a baixa, ou só a aprovação (ModoBank). */}
          <button
            onClick={onPagarEmMaos}
            title="Escolher de onde sai e pagar — aprova no IXC junto"
            className="btn btn-pagar btn-p disabled:opacity-40"
          >
            Pagar
          </button>
          {conta.statusAuditoria === 'A' && (
            <span
              className="self-center text-[11px] text-emerald-700 dark:text-emerald-300"
              title="Já passou pela auditoria do IXC"
            >
              aprovada
            </span>
          )}
          <button
            onClick={onEditar}
            title="Mudar meio de pagamento, valor, vencimento…"
            className="btn btn-sutil btn-p"
          >
            Editar
          </button>
          <button
            onClick={onExcluir}
            title="Apagar este título no IXC"
            className="btn btn-perigo btn-p"
          >
            Excluir
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * O semáforo da conta: vermelho venceu, amarelo vence hoje, verde ainda tem
 * prazo. É a primeira coisa que se lê na tela, então a cor aparece duas vezes —
 * na barra da esquerda, que se enxerga correndo o olho pela lista, e no selo,
 * que diz o quanto em palavras. Cor sozinha não serve a quem não a distingue.
 */
interface Urgencia {
  /** Classe da barra colorida na borda da linha */
  barra: string;
  tom: Tom;
  texto: string;
}

function urgenciaDaConta(conta: ContaAberta): Urgencia {
  const dias = conta.diasParaVencer;

  if (dias === null) {
    return { barra: 'border-tinta-200', tom: 'neutro', texto: 'sem data' };
  }
  if (dias < 0) {
    const atraso = Math.abs(dias);
    return {
      barra: 'border-rose-500',
      tom: 'erro',
      texto: atraso === 1 ? 'venceu ontem' : `${atraso} dias em atraso`,
    };
  }
  if (dias === 0) {
    return { barra: 'border-amber-400', tom: 'atencao', texto: 'vence hoje' };
  }
  return {
    barra: 'border-emerald-500',
    tom: 'pago',
    texto: dias === 1 ? 'vence amanhã' : `em ${dias} dias`,
  };
}

function PrazoDaConta({ conta }: { conta: ContaAberta }) {
  const { tom, texto } = urgenciaDaConta(conta);
  return (
    <Selo
      pequeno
      tom={tom}
      titulo={
        conta.diasParaVencer === null ? 'Sem data de vencimento no IXC' : undefined
      }
    >
      {texto}
    </Selo>
  );
}

/**
 * Tira os acentos para comparar. Quem procura "aurelio" quer achar "Marco
 * Aurélio Castro" — e não achou, uma vez, concluindo que a conta nem existia.
 */
function filtrar(
  contas: ContaAberta[],
  recorte: Recorte,
  busca: string,
  soSemCategoria: boolean,
): ContaAberta[] {
  const termo = semAcento(busca.trim());

  return contas.filter((c) => {
    if (soSemCategoria && c.classificacao) return false;
    const dias = c.diasParaVencer;
    const passaRecorte =
      recorte === 'todas' ||
      (recorte === 'vencidas' && dias !== null && dias < 0) ||
      (recorte === 'semana' && dias !== null && dias >= 0 && dias <= 7) ||
      (recorte === 'demais' && dias !== null && dias > 7) ||
      (recorte === 'sem-data' && dias === null);
    if (!passaRecorte) return false;
    if (!termo) return true;

    return [c.fornecedor.nome, c.documento, c.observacao, c.origem?.beneficiario]
      .filter((v): v is string => !!v)
      .some((v) => semAcento(v).includes(termo));
  });
}

function formatHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(
    new Date(iso),
  );
}
