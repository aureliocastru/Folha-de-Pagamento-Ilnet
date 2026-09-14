import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IconeLupa } from '../../components/icones';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
  type Tom,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { semAcento, useTermoAdiado } from '../../lib/busca';
import { formatBRL } from '../../lib/format';
import type {
  ConferenciaDeEstoque,
  ConferenciaDoAlmoxarifado,
  ItemParaConferir,
  PainelDaConferencia,
  PecaAchada,
  PecaParaConferir,
  ProdutoAchadoParaConferir,
  ProdutoParaConferir,
  SituacaoConferencia,
} from '../../lib/types';
import { JanelaDoProduto, quantidade } from './ProdutoNoIxc';
import { normalizarCodigo } from './transferencia-comum';

const CHAVE = ['almoxarifado', 'conferencia'] as const;

/** "2,5", "2.5" e "1.250,5" → número. Vazio ou inválido → NaN. */
function numeroDigitado(texto: string): number {
  const t = texto.trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
}

/** Cinco casas, como o servidor: 0,1 + 0,2 é 0,3, e não uma diferença. */
function arredondar(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/**
 * A conferência de estoque — o inventário feito na prateleira, item por item.
 *
 * Quem conta diz quanto tem, e o sistema lança a diferença no IXC, sem abrir
 * o IXC: o que faltou vai por transferência para Perdas e Falhas; o que sobrou
 * volta de lá, ou entra por compra de acerto com o valor informado. No fim
 * relê o IXC e mostra o que ficou lá. Tudo fica anotado — o que já foi
 * conferido, por quem, e com que número de transferência ou compra — e cada
 * conferência pode ser desfeita.
 *
 * Feita para o celular, de pé na prateleira: o almoxarifado fica no endereço
 * (recarregar não perde o lugar), a busca aceita o leitor bipando, e os botões
 * são do tamanho do dedo.
 */
export function Conferencia() {
  const [params, setParams] = useSearchParams();
  const almoxId = Number(params.get('almox')) || null;

  const painel = useQuery({
    queryKey: [...CHAVE, 'painel'],
    queryFn: async () => (await api.get<PainelDaConferencia>('/almoxarifado/conferencia')).data,
  });

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Conferência de estoque"
        descricao={
          <>
            Conte o que tem na prateleira e diga aqui. O sistema lança a diferença no IXC: o que
            faltou vai para <strong>Perdas e Falhas</strong>; o que sobrou volta de lá, ou entra
            por compra com o valor que você informar.
          </>
        }
        acoes={painel.data?.rodada && <EncerrarInventario nome={painel.data.rodada.nome} />}
      />

      {painel.isError && <Aviso tom="erro">{mensagemErro(painel.error)}</Aviso>}
      {painel.data && !painel.data.perdas && (
        <Aviso tom="erro">
          Não achei o almoxarifado "Perdas e Falhas" no IXC (ou ele não está liberado para o
          sistema). É para lá que vai o que faltar — cadastre ou libere na aba Almoxarifados antes
          de conferir.
        </Aviso>
      )}
      {painel.data?.perdas && !painel.data.perdas.ativo && (
        <Aviso tom="erro">
          O almoxarifado "{painel.data.perdas.nome}" está desativado no IXC. Ative-o na aba
          Almoxarifados: é para lá que vai o que faltar.
        </Aviso>
      )}

      {almoxId ? (
        <ListaDoAlmoxarifado almoxId={almoxId} onVoltar={() => setParams({})} />
      ) : (
        <EscolherAlmoxarifado
          painel={painel.data}
          carregando={painel.isLoading}
          onEscolher={(id) => setParams({ almox: String(id) })}
        />
      )}
    </Pagina>
  );
}

function EscolherAlmoxarifado({
  painel,
  carregando,
  onEscolher,
}: {
  painel: PainelDaConferencia | undefined;
  carregando: boolean;
  onEscolher: (id: number) => void;
}) {
  const rodada = painel?.rodada;
  return (
    <Bloco titulo="Qual almoxarifado você vai conferir?">
      <p className="mb-3 text-[13px] text-tinta-500">
        {rodada ? (
          <>
            <strong className="text-tinta-700">{rodada.nome}</strong> — começou em{' '}
            {new Date(rodada.iniciadoEm).toLocaleDateString('pt-BR')} com {rodada.iniciadoPor}.{' '}
            {rodada.conferidos} {rodada.conferidos === 1 ? 'produto conferido' : 'produtos conferidos'} até agora.
          </>
        ) : (
          'Nenhum inventário aberto: a primeira conferência começa um.'
        )}
      </p>

      {carregando && <Carregando texto="Lendo o estoque do IXC…" />}
      {painel && painel.almoxarifados.length === 0 && (
        <Vazio titulo="Nenhum almoxarifado">O sistema não enxerga almoxarifado nenhum no IXC.</Vazio>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {painel?.almoxarifados.map((a) => {
          const pct = a.itens > 0 ? Math.round((Math.min(a.conferidos, a.itens) / a.itens) * 100) : 0;
          const pronto = a.itens > 0 && a.conferidos >= a.itens;
          return (
            <button
              key={a.id}
              type="button"
              disabled={!a.liberado}
              onClick={() => onEscolher(a.id)}
              className="rounded-xl border border-tinta-200 bg-white p-3 text-left transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-tinta-50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold text-tinta-800">{a.nome}</span>
                {pronto && <Selo tom="pago" pequeno>conferido</Selo>}
                {!a.ativo && a.liberado && <Selo tom="neutro" pequeno>inativo</Selo>}
              </div>
              <div className="mt-1 text-[12px] text-tinta-500">
                {!a.liberado
                  ? 'não liberado para o sistema — libere na aba Almoxarifados'
                  : a.itens === 0
                    ? 'o IXC não tem saldo nenhum aqui'
                    : `${a.conferidos} de ${a.itens} ${a.itens === 1 ? 'produto conferido' : 'produtos conferidos'}`}
              </div>
              {a.itens > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tinta-100">
                  <div
                    className={`h-full ${pronto ? 'bg-emerald-500' : 'bg-brand-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </Bloco>
  );
}

type Filtro = 'faltam' | 'conferidos' | 'todos';

function conferido(i: ItemParaConferir): boolean {
  return !!i.conferencia && i.conferencia.situacao !== 'DESFEITO';
}

function ListaDoAlmoxarifado({ almoxId, onVoltar }: { almoxId: number; onVoltar: () => void }) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('faltam');
  const [aberto, setAberto] = useState<{ produtoId: number; peca?: PecaAchada } | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  const lista = useQuery({
    queryKey: [...CHAVE, 'almox', almoxId],
    queryFn: async () =>
      (await api.get<ConferenciaDoAlmoxarifado>(`/almoxarifado/conferencia/almoxarifados/${almoxId}`)).data,
  });
  const dados = lista.data;
  const itens = useMemo(() => dados?.itens ?? [], [dados]);
  const feitos = itens.filter(conferido).length;

  const termo = semAcento(busca.trim());
  const filtrados = itens.filter((i) => {
    if (filtro === 'faltam' && conferido(i)) return false;
    if (filtro === 'conferidos' && !conferido(i)) return false;
    return !termo || semAcento(i.descricao).includes(termo) || String(i.produtoId) === busca.trim();
  });

  /* O que o IXC tem com esse nome e não está na lista: zerado aqui, ou que
     nunca teve saldo neste almoxarifado. Na ILNET, que é o geral, o produto
     achado na prateleira tem de poder ser conferido mesmo assim — sem ir ao
     "Achei um que não está na lista". Inativo e serviço o servidor não traz. */
  const buscaAdiada = useTermoAdiado(busca);
  const doIxc = useQuery({
    queryKey: [...CHAVE, 'produtos', buscaAdiada],
    queryFn: async () =>
      (
        await api.get<ProdutoAchadoParaConferir[]>('/almoxarifado/conferencia/produtos', {
          params: { busca: buscaAdiada },
        })
      ).data,
    enabled: buscaAdiada.length >= 2,
    staleTime: 60_000,
  });
  const idsNaLista = useMemo(() => new Set(itens.map((i) => i.produtoId)), [itens]);
  const foraDaLista =
    busca.trim().length >= 2 ? (doIxc.data ?? []).filter((p) => !idsNaLista.has(p.produtoId)) : [];

  const acharPeca = useMutation({
    mutationFn: async (codigo: string) =>
      (await api.get<PecaAchada>('/almoxarifado/patrimonios/onde', { params: { codigo } })).data,
    onSuccess: (peca) => {
      setBusca('');
      setAviso(null);
      setAberto({ produtoId: peca.produtoId, peca });
    },
    onError: (e) => setAviso(mensagemErro(e)),
  });

  /** Enter ou "Procurar": um produto só na lista abre; um código de peça, o IXC diz de qual produto é. */
  function aoBipar() {
    const t = busca.trim();
    if (!t) return;
    const todos = itens.filter(
      (i) => semAcento(i.descricao).includes(semAcento(t)) || String(i.produtoId) === t,
    );
    if (todos.length === 1) {
      setAberto({ produtoId: todos[0].produtoId });
      setBusca('');
      return;
    }
    // Nada na lista, e um só no IXC com esse nome: é ele.
    if (todos.length === 0 && buscaAdiada === t && foraDaLista.length === 1) {
      setAberto({ produtoId: foraDaLista[0].produtoId });
      setBusca('');
      return;
    }
    if (todos.length === 0 && normalizarCodigo(t).length >= 3) {
      acharPeca.mutate(t);
      return;
    }
    if (todos.length === 0) setAviso('Nada na lista com esse nome. Procure no IXC pelo botão abaixo.');
  }

  return (
    <>
      <Bloco
        titulo={dados?.almox.nome ?? 'Almoxarifado'}
        acao={
          <button type="button" onClick={onVoltar} className="btn btn-sutil btn-p">
            ← Almoxarifados
          </button>
        }
      >
        {lista.isLoading && <Carregando texto="Lendo no IXC o que tem aqui…" />}
        {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}

        {dados && (
          <>
            <div className="mb-3">
              <div className="flex items-baseline justify-between text-[13px] text-tinta-600">
                <span>
                  <strong>{feitos}</strong> de {itens.length} conferidos
                </span>
                <span className="text-[11px] text-tinta-400">
                  lido do IXC às{' '}
                  {new Date(dados.lidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-tinta-100">
                <div
                  className="h-full bg-brand-600 transition-all"
                  style={{ width: `${itens.length ? Math.round((feitos / itens.length) * 100) : 0}%` }}
                />
              </div>
            </div>

            <label className="rotulo" htmlFor="conf-busca">
              Produto
            </label>
            <div className="flex gap-2">
              <input
                id="conf-busca"
                ref={campo}
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setAviso(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    aoBipar();
                  }
                }}
                className="campo min-w-0 flex-1"
                placeholder="Nome, código — ou bipe a ONU"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={aoBipar}
                disabled={!busca.trim() || acharPeca.isPending}
                className="btn btn-pagar shrink-0"
              >
                <IconeLupa />
                Procurar
              </button>
            </div>
            {acharPeca.isPending && <p className="ajuda">Procurando a peça no IXC…</p>}
            {aviso && <p className="mt-1 text-[13px] text-rose-600 dark:text-rose-300">{aviso}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(
                [
                  ['faltam', `Falta conferir (${itens.length - feitos})`],
                  ['conferidos', `Conferidos (${feitos})`],
                  ['todos', `Todos (${itens.length})`],
                ] as Array<[Filtro, string]>
              ).map(([f, rotulo]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFiltro(f)}
                  className={`btn btn-p ${filtro === f ? 'btn-primario' : 'btn-neutro'}`}
                >
                  {rotulo}
                </button>
              ))}
              <button type="button" onClick={() => setProcurando(true)} className="btn btn-p btn-sutil">
                Achei um que não está na lista
              </button>
            </div>
          </>
        )}
      </Bloco>

      {/* Achado só no IXC, a lista vazia sai: "Nada por aqui" em cima do que foi achado confunde. */}
      {dados && (filtrados.length > 0 || foraDaLista.length === 0) && (
        <Bloco titulo={`${filtrados.length} ${filtrados.length === 1 ? 'produto' : 'produtos'}`} semPadding>
          {filtrados.length === 0 ? (
            <div className="p-4">
              <Vazio titulo={filtro === 'faltam' && !termo ? 'Tudo conferido aqui' : 'Nada por aqui'}>
                {filtro === 'faltam' && !termo
                  ? 'Todo produto com saldo neste almoxarifado já foi conferido neste inventário.'
                  : 'Nenhum produto com esse filtro.'}
              </Vazio>
            </div>
          ) : (
            <div className="divide-y divide-tinta-100">
              {filtrados.map((i) => (
                <button
                  key={i.produtoId}
                  type="button"
                  onClick={() => setAberto({ produtoId: i.produtoId })}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-tinta-50 md:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-tinta-800">{i.descricao}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-tinta-400">
                      <span className="num">código {i.produtoId}</span>
                      {i.patrimonio && <Selo tom="info" pequeno>patrimônio</Selo>}
                      {i.conferencia && <SeloDaConferencia c={i.conferencia} />}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`valor text-[15px] ${i.saldo < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>
                      {quantidade(i.saldo)}
                      {i.unidade && <span className="ml-1 text-[11px] text-tinta-400">{i.unidade}</span>}
                    </div>
                    <div className="text-[11px] text-tinta-400">no IXC</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Bloco>
      )}

      {dados && busca.trim().length >= 2 && (foraDaLista.length > 0 || doIxc.isFetching) && (
        <Bloco
          titulo={`Sem saldo em ${dados.almox.nome}${foraDaLista.length ? ` (${foraDaLista.length})` : ''}`}
          semPadding
        >
          {foraDaLista.length === 0 ? (
            <div className="p-4">
              <Carregando texto="Procurando no IXC…" />
            </div>
          ) : (
            <div className="divide-y divide-tinta-100">
              {foraDaLista.map((p) => (
                <button
                  key={p.produtoId}
                  type="button"
                  onClick={() => setAberto({ produtoId: p.produtoId })}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-tinta-50 md:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-tinta-800">{p.descricao}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-tinta-400">
                      <span className="num">código {p.produtoId}</span>
                      {p.patrimonio && <Selo tom="info" pequeno>patrimônio</Selo>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="valor text-[15px]">0</div>
                    <div className="text-[11px] text-tinta-400">aqui</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Bloco>
      )}

      {procurando && (
        <ProcurarProduto
          onFechar={() => setProcurando(false)}
          onEscolher={(produtoId) => {
            setProcurando(false);
            setAberto({ produtoId });
          }}
        />
      )}

      {aberto && (
        <JanelaConferir
          key={`${aberto.produtoId}-${aberto.peca?.patrimonioId ?? ''}`}
          almoxId={almoxId}
          produtoId={aberto.produtoId}
          pecaInicial={aberto.peca}
          onFechar={() => {
            setAberto(null);
            setTimeout(() => campo.current?.focus(), 50);
          }}
        />
      )}
    </>
  );
}

const SITUACAO: Record<SituacaoConferencia, { rotulo: string; tom: Tom }> = {
  EM_ANDAMENTO: { rotulo: 'lançando…', tom: 'marca' },
  BATEU: { rotulo: 'bateu', tom: 'pago' },
  AJUSTADO: { rotulo: 'ajustado', tom: 'info' },
  INCOMPLETO: { rotulo: 'incompleto', tom: 'atencao' },
  DESFEITO: { rotulo: 'desfeito', tom: 'neutro' },
};

function SeloDaConferencia({ c }: { c: ConferenciaDeEstoque }) {
  const s = c.rodando ? SITUACAO.EM_ANDAMENTO : SITUACAO[c.situacao];
  const detalhe =
    c.situacao === 'AJUSTADO' || c.situacao === 'INCOMPLETO'
      ? `: ${quantidade(c.sistema)} → ${quantidade(c.contado)}`
      : '';
  return (
    <Selo tom={s.tom} pequeno titulo={`por ${c.conferidoPor} em ${new Date(c.criadoEm).toLocaleString('pt-BR')}`}>
      {s.rotulo}
      {detalhe}
    </Selo>
  );
}

function ProcurarProduto({
  onFechar,
  onEscolher,
}: {
  onFechar: () => void;
  onEscolher: (produtoId: number) => void;
}) {
  const [termo, setTermo] = useState('');
  const [procurado, setProcurado] = useState('');
  const achados = useQuery({
    queryKey: [...CHAVE, 'produtos', procurado],
    queryFn: async () =>
      (
        await api.get<ProdutoAchadoParaConferir[]>('/almoxarifado/conferencia/produtos', {
          params: { busca: procurado },
        })
      ).data,
    enabled: procurado.length >= 2,
  });

  return (
    // Presa no alto no celular: o resultado aparece embaixo do campo, acima do teclado.
    <Janela titulo="Achei um produto que não está na lista" onFechar={onFechar} noAlto>
      <p className="mb-3 text-[13px] text-tinta-500">
        O IXC não tem saldo dele aqui. Procure pelo nome ou código; se não existir no IXC, cadastre
        em Estoque › Novo produto e volte.
      </p>
      <div className="flex gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setProcurado(termo.trim());
            }
          }}
          className="campo min-w-0 flex-1"
          placeholder="Nome ou código do produto"
          autoComplete="off"
          autoFocus
        />
        <button
          type="button"
          onClick={() => setProcurado(termo.trim())}
          disabled={termo.trim().length < 2}
          className="btn btn-pagar shrink-0"
        >
          <IconeLupa />
          Procurar
        </button>
      </div>
      {achados.isFetching && <Carregando texto="Procurando no IXC…" />}
      {achados.isError && <Aviso tom="erro">{mensagemErro(achados.error)}</Aviso>}
      {achados.data && achados.data.length === 0 && (
        <p className="mt-3 text-sm text-tinta-400">Nenhum produto com esse nome no IXC.</p>
      )}
      {achados.data && achados.data.length > 0 && (
        // Sem altura própria: quem rola é a janela, que no celular vai só até o teclado.
        <div className="mt-3 divide-y divide-tinta-100 rounded-xl border border-tinta-100">
          {achados.data.map((p) => (
            <button
              key={p.produtoId}
              type="button"
              onClick={() => onEscolher(p.produtoId)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-tinta-50"
            >
              <span className="min-w-0 truncate text-[13px] text-tinta-800">{p.descricao}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-tinta-400">
                {p.patrimonio && <Selo tom="info" pequeno>patrimônio</Selo>}
                código {p.produtoId}
              </span>
            </button>
          ))}
        </div>
      )}
    </Janela>
  );
}

// ---------------------------------------------------------------------------
// A janela de conferir um produto
// ---------------------------------------------------------------------------

interface Trazida {
  patrimonioId: number;
  identificacao: string;
  de: string;
}

function JanelaConferir({
  almoxId,
  produtoId,
  pecaInicial,
  onFechar,
}: {
  almoxId: number;
  produtoId: number;
  pecaInicial?: PecaAchada;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const detalhe = useQuery({
    queryKey: [...CHAVE, 'produto', almoxId, produtoId],
    queryFn: async () =>
      (
        await api.get<ProdutoParaConferir>(
          `/almoxarifado/conferencia/almoxarifados/${almoxId}/produtos/${produtoId}`,
        )
      ).data,
    staleTime: 0,
    gcTime: 0,
    // O saldo mostrado é o que vai como "o que a tela viu": ele não muda sozinho no meio da contagem.
    refetchOnWindowFocus: false,
  });
  const p = detalhe.data;

  const [contadoTexto, setContadoTexto] = useState('');
  /**
   * "Achei mais": conferiu 20, e depois apareceram mais 5 no fundo da
   * prateleira. Digita-se só os 5, e o contado é o saldo de agora mais eles —
   * o que foi para Perdas na conferência anterior volta de lá, sem compra.
   */
  const [jeito, setJeito] = useState<'total' | 'mais' | null>(null);
  const [maisTexto, setMaisTexto] = useState('');
  const [valor, setValor] = useState('');
  const [observacao, setObservacao] = useState('');
  const [modo, setModo] = useState<'quantidade' | 'pecas'>('quantidade');
  const [achadas, setAchadas] = useState<Set<number>>(new Set());
  const [trazidas, setTrazidas] = useState<Trazida[]>([]);
  const [semCadastro, setSemCadastro] = useState<string[]>([]);
  const [semEtiqueta, setSemEtiqueta] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [conferencia, setConferencia] = useState<ConferenciaDeEstoque | null>(null);
  const [cadastro, setCadastro] = useState(false);

  const jaConferido = !!p?.conferencias.some((c) => c.situacao !== 'DESFEITO');

  /*
   * A janela se prepara com a leitura do IXC — a primeira, e a que "Achei
   * mais deste" pede de novo —, e só com ela: com as peças de uma leitura
   * velha, a ONU que acabou de chegar de Perdas ficaria desmarcada, e
   * voltaria para lá. `preparadaEm` guarda de qual leitura a janela saiu.
   *
   * Já conferido nesta rodada, abre em "Achei mais", que é o que se quer
   * quando se volta a um produto contado; no patrimônio, as peças daqui já
   * vêm marcadas, e bipa-se só as que apareceram.
   */
  const preparadaEm = useRef(0);
  useEffect(() => {
    if (!p || detalhe.isFetching || detalhe.dataUpdatedAt <= preparadaEm.current) return;
    preparadaEm.current = Number.POSITIVE_INFINITY;
    const j = jaConferido ? 'mais' : 'total';
    setJeito(j);
    if (p.patrimonio && (j === 'mais' || pecaInicial)) {
      setModo('pecas');
      setAchadas(new Set(j === 'mais' ? (p.pecas ?? []).map((x) => x.patrimonioId) : []));
    }
    if (p.patrimonio && pecaInicial) marcarPeca(p, pecaInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, detalhe.isFetching, detalhe.dataUpdatedAt, jaConferido]);

  function trocarJeito(j: 'total' | 'mais') {
    setJeito(j);
    setContadoTexto('');
    setMaisTexto('');
    if (j === 'mais' && p?.patrimonio) {
      setModo('pecas');
      setAchadas(new Set((p.pecas ?? []).map((x) => x.patrimonioId)));
    }
  }

  /** O total contado, pelo jeito escolhido: o digitado, ou o saldo de agora mais o que apareceu. */
  const contadoEfetivo = useMemo(() => {
    if (jeito !== 'mais' || !p) return contadoTexto;
    const mais = numeroDigitado(maisTexto);
    return mais >= 0 ? String(arredondar(p.saldo + mais)) : '';
  }, [jeito, p, contadoTexto, maisTexto]);

  // O valor sugerido: o preço base do cadastro, ou o custo médio.
  useEffect(() => {
    if (!p || valor) return;
    const sugerido = p.precoBase > 0 ? p.precoBase : p.custoMedio > 0 ? p.custoMedio : 0;
    if (sugerido > 0) setValor(sugerido.toFixed(2));
  }, [p, valor]);

  const [avisoPeca, setAvisoPeca] = useState<{ texto: string; ruim: boolean } | null>(null);

  function marcarPeca(prod: ProdutoParaConferir, peca: PecaAchada) {
    if (peca.produtoId !== prod.produtoId) {
      setAvisoPeca({
        texto: `Essa peça é de outro produto no IXC: ${peca.descricao}. Confira-a na linha dele.`,
        ruim: true,
      });
      return;
    }
    const daqui = prod.pecas?.find((x) => x.patrimonioId === peca.patrimonioId);
    if (daqui || peca.almoxId === prod.almox.id) {
      setAchadas((s) => new Set(s).add(peca.patrimonioId));
      setAvisoPeca({ texto: `Achada: ${daqui?.identificacao ?? peca.descricao}`, ruim: false });
      return;
    }
    if (!peca.podeMover) {
      setAvisoPeca({
        texto: `Essa peça está em ${peca.almoxarifado || 'lugar nenhum'} no IXC, e não sai de lá por transferência: ${peca.impedimento}.`,
        ruim: true,
      });
      return;
    }
    const identificacao =
      [peca.numeroPatrimonial && `nº ${peca.numeroPatrimonial}`, peca.mac && `MAC ${peca.mac}`, peca.numeroSerie && `série ${peca.numeroSerie}`]
        .filter(Boolean)
        .join(' · ') || `patrimônio #${peca.patrimonioId}`;
    setTrazidas((t) =>
      t.some((x) => x.patrimonioId === peca.patrimonioId)
        ? t
        : [...t, { patrimonioId: peca.patrimonioId, identificacao, de: peca.almoxarifado }],
    );
    setAvisoPeca({ texto: `Está em ${peca.almoxarifado} no IXC — vem para cá: ${identificacao}`, ruim: false });
  }

  const conferir = useMutation({
    mutationFn: async () => {
      if (!p) throw new Error('Produto não lido.');
      const corpo: Record<string, unknown> = {
        almoxId,
        produtoId,
        sistemaVisto: p.saldo,
        observacao: observacao.trim() || undefined,
      };
      if (p.patrimonio && modo === 'pecas') {
        corpo.pecasAchadas = [...achadas];
        corpo.pecasTrazidas = trazidas.map((t) => t.patrimonioId);
        corpo.codigosSemCadastro = semCadastro;
        corpo.pecasSemEtiqueta = semEtiqueta;
      } else {
        corpo.contado = arredondar(numeroDigitado(contadoEfetivo));
      }
      if (plano.compra > 0) corpo.valorUnitario = Number(valor);
      return (await api.post<ConferenciaDeEstoque>('/almoxarifado/conferencia', corpo)).data;
    },
    onSuccess: (c) => {
      setConfirmando(false);
      setConferencia(c);
    },
    onError: () => setConfirmando(false),
  });

  // Acompanha a conferência que passou dos 20 segundos, até terminar.
  const andamento = useQuery({
    queryKey: [...CHAVE, 'uma', conferencia?.id],
    queryFn: async () => (await api.get<ConferenciaDeEstoque>(`/almoxarifado/conferencia/${conferencia!.id}`)).data,
    enabled: !!conferencia?.rodando,
    refetchInterval: (q) => (q.state.data && !q.state.data.rodando ? false : 1500),
  });
  const atual = andamento.data && andamento.data.id === conferencia?.id ? andamento.data : conferencia;
  const terminou = !!atual && !atual.rodando;
  useEffect(() => {
    if (!terminou) return;
    void qc.invalidateQueries({ queryKey: CHAVE });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
  }, [terminou, atual?.situacao, qc]);

  const plano = useMemo(
    () =>
      p ? planoNaTela(p, { modo, contadoTexto: contadoEfetivo, achadas, trazidas, semCadastro, semEtiqueta }) : null,
    [p, modo, contadoEfetivo, achadas, trazidas, semCadastro, semEtiqueta],
  ) ?? { pronto: false, contado: 0, compra: 0, linhas: [], tom: 'info' as Tom, problema: null, nada: false };

  const valorOk = plano.compra === 0 || Number(valor) >= 0.01;
  const podeConfirmar =
    !!p && !p.impedimento && !detalhe.isFetching && plano.pronto && !plano.problema && valorOk;

  /** Depois de lançar, "Achei mais deste": relê o saldo e volta à contagem, só com o que apareceu. */
  function acheiMais() {
    setConferencia(null);
    conferir.reset();
    setConfirmando(false);
    setObservacao('');
    setTrazidas([]);
    setSemCadastro([]);
    setSemEtiqueta(0);
    setAvisoPeca(null);
    setModo('quantidade');
    setAchadas(new Set());
    setJeito(null);
    setContadoTexto('');
    setMaisTexto('');
    // Prepara de novo, mas só com a leitura que vem agora (ver `preparadaEm`).
    preparadaEm.current = detalhe.dataUpdatedAt;
    void detalhe.refetch();
  }
  const erro = conferir.error;
  const conflito = (erro as { response?: { status?: number } } | null)?.response?.status === 409;

  return (
    <Janela titulo={p ? p.descricao : 'Conferir'} onFechar={() => (atual?.rodando ? undefined : onFechar())}>
      {detalhe.isLoading && <Carregando texto="Lendo o saldo de agora no IXC…" />}
      {detalhe.isError && <Aviso tom="erro">{mensagemErro(detalhe.error)}</Aviso>}

      {p && atual && (
        <ResultadoDaConferencia
          c={atual}
          onDesfeito={(c) => setConferencia(c)}
          onAcheiMais={acheiMais}
          onProximo={onFechar}
        />
      )}

      {p && !atual && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-tinta-400">
            <span className="num">código {p.produtoId}</span>
            {p.patrimonio && <Selo tom="info" pequeno>patrimônio</Selo>}
            <button
              type="button"
              onClick={() => setCadastro(true)}
              className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
            >
              Corrigir cadastro (nome, preço, unidade)
            </button>
          </div>

          <div className="mb-4 rounded-xl border border-tinta-200 bg-tinta-50 px-4 py-3 dark:bg-tinta-100">
            <div className="text-[12px] text-tinta-500">O IXC diz que tem em {p.almox.nome}</div>
            <div className={`valor text-[28px] leading-tight ${p.saldo < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>
              {quantidade(p.saldo)} <span className="text-[14px] text-tinta-400">{p.unidade}</span>
            </div>
            {p.perdas && p.saldoEmPerdas !== 0 && (
              <div className="text-[12px] text-tinta-500">
                e {quantidade(p.saldoEmPerdas)} em {p.perdas.nome}
              </div>
            )}
            {p.patrimonio && p.pecas && (
              <div className="text-[12px] text-tinta-500">
                {p.pecas.length} {p.pecas.length === 1 ? 'peça cadastrada' : 'peças cadastradas'} aqui
                {p.saldo - p.pecas.length > 0 && ` · ${quantidade(p.saldo - p.pecas.length)} de saldo sem peça`}
              </div>
            )}
          </div>

          {p.impedimento ? (
            <Aviso tom="erro">{p.impedimento}</Aviso>
          ) : (
            <>
              {jaConferido && (
                <div className="mb-3">
                  <p className="mb-1.5 text-[12px] text-tinta-500">
                    Já conferido neste inventário ({quantidade(p.conferencias[0].contado)}
                    {p.unidade ? ` ${p.unidade}` : ''} por {p.conferencias[0].conferidoPor}). O que aconteceu?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => trocarJeito('mais')}
                      className={`btn btn-p flex-1 ${jeito === 'mais' ? 'btn-primario' : 'btn-neutro'}`}
                    >
                      Achei mais
                    </button>
                    <button
                      type="button"
                      onClick={() => trocarJeito('total')}
                      className={`btn btn-p flex-1 ${jeito === 'total' ? 'btn-primario' : 'btn-neutro'}`}
                    >
                      Contar tudo de novo
                    </button>
                  </div>
                </div>
              )}

              {p.patrimonio && (
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModo('quantidade')}
                    className={`btn btn-p flex-1 ${modo === 'quantidade' ? 'btn-primario' : 'btn-neutro'}`}
                  >
                    Contar a quantidade
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo('pecas')}
                    className={`btn btn-p flex-1 ${modo === 'pecas' ? 'btn-primario' : 'btn-neutro'}`}
                  >
                    Bipar peça por peça
                  </button>
                </div>
              )}

              {(!p.patrimonio || modo === 'quantidade') && jeito === 'mais' && (
                <div className="mb-3">
                  <label className="rotulo" htmlFor="conf-mais">
                    Quantos a mais você achou?
                  </label>
                  <input
                    id="conf-mais"
                    value={maisTexto}
                    onChange={(e) => setMaisTexto(e.target.value.replace(/[^\d.,]/g, ''))}
                    inputMode="decimal"
                    className="campo num text-[20px]"
                    placeholder="0"
                    autoComplete="off"
                    autoFocus
                  />
                  {numeroDigitado(maisTexto) > 0 && (
                    <p className="ajuda">
                      {quantidade(p.saldo)} que o IXC tem + {quantidade(numeroDigitado(maisTexto))} ={' '}
                      <strong>{quantidade(arredondar(p.saldo + numeroDigitado(maisTexto)))}</strong>
                      {p.unidade ? ` ${p.unidade}` : ''} na prateleira.
                    </p>
                  )}
                </div>
              )}

              {(!p.patrimonio || modo === 'quantidade') && jeito !== 'mais' && (
                <div className="mb-3">
                  <label className="rotulo" htmlFor="conf-contado">
                    Quanto tem na prateleira?
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="conf-contado"
                      value={contadoTexto}
                      onChange={(e) => setContadoTexto(e.target.value.replace(/[^\d.,]/g, ''))}
                      inputMode="decimal"
                      className="campo num min-w-0 flex-1 text-[20px]"
                      placeholder="0"
                      autoComplete="off"
                      autoFocus
                    />
                    <button type="button" onClick={() => setContadoTexto('0')} className="btn btn-neutro shrink-0">
                      Não tem nenhum
                    </button>
                  </div>
                </div>
              )}

              {p.patrimonio && modo === 'pecas' && (
                <ContarPecas
                  p={p}
                  achadas={achadas}
                  setAchadas={setAchadas}
                  trazidas={trazidas}
                  setTrazidas={setTrazidas}
                  semCadastro={semCadastro}
                  setSemCadastro={setSemCadastro}
                  semEtiqueta={semEtiqueta}
                  setSemEtiqueta={setSemEtiqueta}
                  aviso={avisoPeca}
                  setAviso={setAvisoPeca}
                  onAchada={(peca) => marcarPeca(p, peca)}
                />
              )}

              {plano.pronto && (
                <div className={`mb-3 rounded-xl border px-3 py-2.5 text-[13px] ${CAIXA[plano.tom]}`}>
                  {plano.linhas.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                  {plano.problema && <p className="mt-1 font-semibold">{plano.problema}</p>}
                </div>
              )}

              {plano.compra > 0 && (
                <div className="mb-3">
                  <label className="rotulo" htmlFor="conf-valor">
                    Valor de cada unidade que entra (R$)
                  </label>
                  <CampoDinheiro id="conf-valor" valor={valor} onChange={setValor} />
                  <p className="ajuda">
                    {p.precoBase > 0 && `Preço base do cadastro: ${formatBRL(p.precoBase)}. `}
                    Compra de acerto do Fornecedor Avulso: {quantidade(plano.compra)} × {formatBRL(Number(valor) || 0)} ={' '}
                    {formatBRL(Math.round(plano.compra * (Number(valor) || 0) * 100) / 100)}.
                  </p>
                </div>
              )}

              <div className="mb-3">
                <label className="rotulo" htmlFor="conf-obs">
                  Observação (opcional, vai para o IXC)
                </label>
                <input
                  id="conf-obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
                  className="campo"
                  placeholder="Ex.: 3 caixas lacradas no fundo"
                  autoComplete="off"
                />
              </div>

              {erro && (
                <Aviso tom="erro">
                  {mensagemErro(erro)}
                  {conflito && (
                    <button
                      type="button"
                      className="btn btn-p btn-neutro"
                      onClick={() => {
                        conferir.reset();
                        void detalhe.refetch();
                      }}
                    >
                      Ler de novo o IXC
                    </button>
                  )}
                </Aviso>
              )}

              {!confirmando ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={onFechar} className="btn btn-neutro">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!podeConfirmar}
                    onClick={() => setConfirmando(true)}
                    className="btn btn-primario"
                  >
                    {!plano.pronto ? 'Diga quanto tem' : !valorOk ? 'Informe o valor' : 'Continuar'}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-brand-400 p-3">
                  <p className="mb-2 text-sm font-semibold text-tinta-800">
                    {plano.nada ? 'Confirma que bateu?' : 'Confirma o lançamento no IXC?'}
                  </p>
                  <ul className="mb-3 list-disc pl-5 text-[13px] text-tinta-700">
                    {plano.linhas.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                    {plano.compra > 0 && (
                      <li>
                        Valor de cada unidade: {formatBRL(Number(valor))} (total{' '}
                        {formatBRL(Math.round(plano.compra * Number(valor) * 100) / 100)})
                      </li>
                    )}
                  </ul>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => setConfirmando(false)} className="btn btn-neutro">
                      Voltar
                    </button>
                    <button
                      type="button"
                      disabled={conferir.isPending}
                      onClick={() => conferir.mutate()}
                      className="btn btn-pagar"
                    >
                      {conferir.isPending
                        ? 'Lançando no IXC…'
                        : plano.nada
                          ? 'Sim, anotar como conferido'
                          : 'Sim, lançar no IXC'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {p.conferencias.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-semibold text-tinta-600">
                Conferências anteriores dele aqui ({p.conferencias.length})
              </summary>
              <div className="mt-2 space-y-1 text-[12px] text-tinta-500">
                {p.conferencias.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2">
                    <SeloDaConferencia c={c} />
                    <span>
                      {new Date(c.criadoEm).toLocaleString('pt-BR')} · {c.conferidoPor} · IXC {quantidade(c.sistema)}, contado{' '}
                      {quantidade(c.contado)}
                    </span>
                    {c.podeDesfazer && c.id === p.conferencias[0].id && (
                      <button
                        type="button"
                        className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        onClick={() => setConferencia(c)}
                      >
                        abrir
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {cadastro && p && (
        <CorrigirCadastro
          produtoId={p.produtoId}
          onFechar={() => {
            setCadastro(false);
            void qc.invalidateQueries({ queryKey: [...CHAVE, 'produto', almoxId, produtoId] });
            void qc.invalidateQueries({ queryKey: [...CHAVE, 'almox', almoxId] });
          }}
        />
      )}
    </Janela>
  );
}

const CAIXA: Record<Tom, string> = {
  neutro: 'border-tinta-200 bg-tinta-50 text-tinta-700',
  marca: 'border-brand-200 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300',
  pago: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  atencao: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  erro: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
};

/** A janela de cadastro do Estoque. O fiscal que faltar vem do modelo padrão, no servidor. */
function CorrigirCadastro({ produtoId, onFechar }: { produtoId: number; onFechar: () => void }) {
  return <JanelaDoProduto produtoId={produtoId} onFechar={onFechar} />;
}

/**
 * O que a conferência vai lançar, dito antes de confirmar — a mesma conta do
 * servidor (`planejarPorQuantidade` e `planejarPecas`). O servidor refaz com o
 * saldo de agora; se tiver mudado, ele recusa em vez de lançar outra coisa.
 */
function planoNaTela(
  p: ProdutoParaConferir,
  e: {
    modo: 'quantidade' | 'pecas';
    contadoTexto: string;
    achadas: Set<number>;
    trazidas: Trazida[];
    semCadastro: string[];
    semEtiqueta: number;
  },
): { pronto: boolean; contado: number; compra: number; linhas: string[]; tom: Tom; problema: string | null; nada: boolean } {
  const un = p.unidade ? ` ${p.unidade}` : '';
  const perdas = p.perdas?.nome ?? 'Perdas e Falhas';
  const q = (n: number) => `${quantidade(n)}${un}`;

  if (!p.patrimonio || e.modo === 'quantidade') {
    const contado = numeroDigitado(e.contadoTexto);
    if (!(contado >= 0)) return { pronto: false, contado: 0, compra: 0, linhas: [], tom: 'info', problema: null, nada: false };
    const c = arredondar(contado);
    const dif = arredondar(c - p.saldo);
    if (p.patrimonio && p.pecas && c < p.pecas.length) {
      return {
        pronto: true,
        contado: c,
        compra: 0,
        tom: 'erro',
        nada: false,
        linhas: [`Você contou ${q(c)}, e o IXC tem ${p.pecas.length} peças cadastradas aqui.`],
        problema: 'Faltou peça de verdade: bipe as que estão na prateleira ("Bipar peça por peça"), para o sistema saber quais foram para Perdas.',
      };
    }
    if (Math.abs(dif) < 1e-6) {
      return { pronto: true, contado: c, compra: 0, tom: 'pago', nada: true, problema: null, linhas: ['Bateu com o IXC. Nada muda lá — só fica anotado que foi conferido.'] };
    }
    if (dif < 0) {
      return {
        pronto: true,
        contado: c,
        compra: 0,
        tom: 'atencao',
        nada: false,
        problema: null,
        linhas: [
          `Faltam ${q(-dif)}: vão por transferência de ${p.almox.nome} para ${perdas}.`,
          `Depois, o IXC fica com ${q(c)} aqui.`,
        ],
      };
    }
    const volta = p.patrimonio ? 0 : Math.min(dif, Math.max(0, p.saldoEmPerdas));
    const compra = arredondar(dif - volta);
    return {
      pronto: true,
      contado: c,
      compra,
      tom: 'info',
      nada: false,
      problema: null,
      linhas: [
        `Sobram ${q(dif)}:`,
        ...(volta > 0 ? [`${q(volta)} voltam de ${perdas} (transferência).`] : []),
        ...(compra > 0 ? [`${q(compra)} entram por compra de acerto${p.patrimonio ? ' — o IXC cria cada peça sem MAC nem série' : ''}.`] : []),
        `Depois, o IXC fica com ${q(c)} aqui.`,
      ],
    };
  }

  // Por peça
  const pecas = p.pecas ?? [];
  const achadas = pecas.filter((x) => e.achadas.has(x.patrimonioId));
  const naoAchadas = pecas.filter((x) => !e.achadas.has(x.patrimonioId));
  const presas = naoAchadas.filter((x) => !x.naPrateleira);
  const soltas = naoAchadas.filter((x) => x.naPrateleira);
  const semPeca = Math.max(0, arredondar(p.saldo - pecas.length));
  const cabem = Math.max(0, Math.floor(p.saldo - semPeca - achadas.length - presas.length + 1e-6));
  const vaoParaPerdas = Math.min(soltas.length, cabem);
  const compra = e.semCadastro.length + e.semEtiqueta;
  const contado = achadas.length + e.trazidas.length + compra;
  const linhas = [
    `Contadas: ${contado} — ${achadas.length} ${achadas.length === 1 ? 'achada' : 'achadas'} das ${pecas.length} daqui` +
      (e.trazidas.length ? `, ${e.trazidas.length} de outro almoxarifado` : '') +
      (compra ? `, ${compra} sem cadastro no IXC` : '') +
      '.',
  ];
  if (e.trazidas.length) linhas.push(`${e.trazidas.length} ${e.trazidas.length === 1 ? 'peça vem' : 'peças vêm'} para cá por transferência.`);
  if (vaoParaPerdas) linhas.push(`${vaoParaPerdas} não ${vaoParaPerdas === 1 ? 'achada vai' : 'achadas vão'} para ${perdas}.`);
  if (semPeca > 0) linhas.push(`${q(semPeca)} de saldo sem peça ${semPeca === 1 ? 'vai' : 'vão'} para ${perdas} (se os movimentos do IXC confirmarem).`);
  if (compra) linhas.push(`${compra} ${compra === 1 ? 'peça entra' : 'peças entram'} por compra de acerto — o IXC cria cada uma sem MAC nem série.`);
  if (presas.length) linhas.push(`${presas.length} não ${presas.length === 1 ? 'achada está presa' : 'achadas estão presas'} no IXC e não ${presas.length === 1 ? 'sai' : 'saem'} daqui — fica anotado para resolver lá.`);
  if (soltas.length > vaoParaPerdas) linhas.push(`${soltas.length - vaoParaPerdas} não achadas ficam: o IXC tem mais peças que saldo aqui.`);
  const nada = !e.trazidas.length && !vaoParaPerdas && !semPeca && !compra;
  if (nada) linhas.push('Bateu com o IXC. Nada muda lá — só fica anotado que foi conferido.');
  return { pronto: true, contado, compra, linhas, tom: nada ? 'pago' : vaoParaPerdas || semPeca ? 'atencao' : 'info', problema: null, nada };
}

function ContarPecas({
  p,
  achadas,
  setAchadas,
  trazidas,
  setTrazidas,
  semCadastro,
  setSemCadastro,
  semEtiqueta,
  setSemEtiqueta,
  aviso,
  setAviso,
  onAchada,
}: {
  p: ProdutoParaConferir;
  achadas: Set<number>;
  setAchadas: (s: Set<number>) => void;
  trazidas: Trazida[];
  setTrazidas: (t: Trazida[]) => void;
  semCadastro: string[];
  setSemCadastro: (s: string[]) => void;
  semEtiqueta: number;
  setSemEtiqueta: (n: number) => void;
  aviso: { texto: string; ruim: boolean } | null;
  setAviso: (a: { texto: string; ruim: boolean } | null) => void;
  onAchada: (peca: PecaAchada) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const pecas = p.pecas ?? [];

  const noIxc = useMutation({
    mutationFn: async (c: string) =>
      (await api.get<PecaAchada>('/almoxarifado/patrimonios/onde', { params: { codigo: c } })).data,
    onSuccess: (peca) => {
      onAchada(peca);
      setCodigo('');
    },
    onError: (e, c) => {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 404) {
        if (!semCadastro.some((x) => normalizarCodigo(x) === normalizarCodigo(c))) {
          setSemCadastro([...semCadastro, c]);
        }
        setAviso({ texto: `O IXC não tem peça com "${c}" — entra como peça sem cadastro (compra).`, ruim: false });
        setCodigo('');
        return;
      }
      setAviso({ texto: mensagemErro(e), ruim: true });
    },
  });

  function bipar() {
    const c = codigo.trim();
    if (!c || noIxc.isPending) return;
    const alvo = normalizarCodigo(c);
    const daqui = pecas.find((x) =>
      [x.mac, x.numeroPatrimonial, x.numeroSerie].some((v) => normalizarCodigo(v) === alvo),
    );
    if (daqui) {
      if (achadas.has(daqui.patrimonioId)) {
        setAviso({ texto: `Já estava marcada: ${daqui.identificacao}`, ruim: true });
      } else {
        setAchadas(new Set(achadas).add(daqui.patrimonioId));
        setAviso({ texto: `Achada: ${daqui.identificacao}`, ruim: false });
      }
      setCodigo('');
      return;
    }
    noIxc.mutate(c);
  }

  function alternar(id: number) {
    const n = new Set(achadas);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setAchadas(n);
  }

  return (
    <div className="mb-3">
      <label className="rotulo" htmlFor="conf-peca">
        Bipe cada peça que está na prateleira
      </label>
      <div className="flex gap-2">
        <input
          id="conf-peca"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              bipar();
            }
          }}
          className="campo min-w-0 flex-1"
          placeholder="Série da etiqueta, nº da casa ou MAC"
          autoComplete="off"
          autoFocus
        />
        <button type="button" onClick={bipar} disabled={!codigo.trim() || noIxc.isPending} className="btn btn-pagar shrink-0">
          {noIxc.isPending ? '…' : 'Marcar'}
        </button>
      </div>
      {aviso && (
        <p className={`mt-1 text-[13px] ${aviso.ruim ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {aviso.texto}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="text-tinta-500">
          {achadas.size} de {pecas.length} {pecas.length === 1 ? 'peça daqui marcada' : 'peças daqui marcadas'}
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-p btn-sutil" onClick={() => setAchadas(new Set(pecas.map((x) => x.patrimonioId)))}>
            Marcar todas
          </button>
          <button type="button" className="btn btn-p btn-sutil" onClick={() => setAchadas(new Set())}>
            Desmarcar todas
          </button>
        </div>
      </div>

      {pecas.length > 0 && (
        <div className="mt-2 max-h-[16rem] divide-y divide-tinta-100 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
          {pecas.map((x: PecaParaConferir) => (
            <label key={x.patrimonioId} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <input
                type="checkbox"
                className="marcador"
                checked={achadas.has(x.patrimonioId)}
                onChange={() => alternar(x.patrimonioId)}
              />
              <span className="min-w-0 flex-1 truncate text-tinta-800">{x.identificacao}</span>
              {!x.naPrateleira && <Selo tom="atencao" pequeno titulo="No IXC ela não está na prateleira: não sai por transferência">{x.situacao}</Selo>}
              {!x.identificada && <Selo tom="neutro" pequeno titulo="Peça sem série nem número da casa — a que uma compra de acerto criou">sem etiqueta</Selo>}
            </label>
          ))}
        </div>
      )}

      {trazidas.length > 0 && (
        <div className="mt-3">
          <div className="text-[12px] font-semibold text-tinta-600">Estão aqui, mas o IXC diz que estão em outro lugar — vêm para cá</div>
          {trazidas.map((t) => (
            <div key={t.patrimonioId} className="flex items-center justify-between gap-2 py-1 text-[13px]">
              <span className="min-w-0 truncate text-tinta-800">
                {t.identificacao} <span className="text-tinta-400">· de {t.de}</span>
              </span>
              <button type="button" className="btn btn-p btn-perigo" onClick={() => setTrazidas(trazidas.filter((x) => x.patrimonioId !== t.patrimonioId))}>
                Tirar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <div className="text-[12px] font-semibold text-tinta-600">Sem cadastro no IXC — entram por compra</div>
        {semCadastro.map((c) => (
          <div key={c} className="flex items-center justify-between gap-2 py-1 text-[13px]">
            <span className="num min-w-0 truncate text-tinta-800">{c}</span>
            <button type="button" className="btn btn-p btn-perigo" onClick={() => setSemCadastro(semCadastro.filter((x) => x !== c))}>
              Tirar
            </button>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 text-[13px] text-tinta-600">
          <span>Peças sem etiqueta nenhuma:</span>
          <button type="button" className="btn btn-p btn-neutro" disabled={semEtiqueta === 0} onClick={() => setSemEtiqueta(semEtiqueta - 1)}>
            −
          </button>
          <span className="num w-6 text-center">{semEtiqueta}</span>
          <button type="button" className="btn btn-p btn-neutro" onClick={() => setSemEtiqueta(semEtiqueta + 1)}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultadoDaConferencia({
  c,
  onDesfeito,
  onAcheiMais,
  onProximo,
}: {
  c: ConferenciaDeEstoque;
  onDesfeito: (c: ConferenciaDeEstoque) => void;
  onAcheiMais: () => void;
  onProximo: () => void;
}) {
  const desfazer = useMutation({
    mutationFn: async () => (await api.post<ConferenciaDeEstoque>(`/almoxarifado/conferencia/${c.id}/desfazer`)).data,
    onSuccess: onDesfeito,
  });
  const s = c.rodando ? SITUACAO.EM_ANDAMENTO : SITUACAO[c.situacao];
  const un = c.unidade ? ` ${c.unidade}` : '';
  const bateuNoFim = c.saldoDepois !== null && Math.abs(c.saldoDepois - c.contado) < 1e-6;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Selo tom={s.tom}>{s.rotulo}</Selo>
        <span className="text-[13px] text-tinta-600">
          IXC tinha {quantidade(c.sistema)}
          {un}, contado {quantidade(c.contado)}
          {un}
        </span>
      </div>

      {c.rodando && (
        <Aviso tom="info">
          Lançando no IXC… pode fechar: continua no servidor, e a lista mostra quando terminar.
        </Aviso>
      )}

      {!c.rodando && c.situacao !== 'DESFEITO' && c.saldoDepois !== null && (
        <Aviso tom={bateuNoFim && c.situacao !== 'INCOMPLETO' ? 'pago' : 'atencao'}>
          Relido o IXC: agora tem {quantidade(c.saldoDepois)}
          {un} em {c.almoxarifado}
          {bateuNoFim ? ' — igual ao contado.' : '.'}
        </Aviso>
      )}
      {c.situacao === 'DESFEITO' && (
        <Aviso tom="pago">
          Desfeita por {c.desfeitoPor}: o IXC voltou a ter {quantidade(c.sistema)}
          {un} aqui.
        </Aviso>
      )}

      {c.lancamentosDitos.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[12px] font-semibold text-tinta-600">O que foi ao IXC</div>
          <ul className="space-y-1 text-[13px]">
            {c.lancamentos.map((l, i) => (
              <li key={i} className={l.ok ? 'text-tinta-700' : 'text-rose-700 dark:text-rose-300'}>
                {l.ok ? '✓' : '✗'} {c.lancamentosDitos[i]}
                {l.tipo === 'transferencia' && (l.falharam?.length ?? 0) > 0 && (
                  <span className="block pl-4 text-[12px]">
                    o IXC recusou {l.falharam!.length}: {l.falharam!.slice(0, 3).map((f) => `${f.identificacao} (${f.motivo})`).join('; ')}
                  </span>
                )}
                {l.pecasCriadas && l.pecasCriadas.length > 0 && (
                  <span className="block pl-4 text-[12px] text-tinta-500">
                    peças criadas: {l.pecasCriadas.join(', ')} — anote o número na caixa
                  </span>
                )}
                {(l.desfeito || (l.tipo === 'compra' && l.apagada && l.motivo !== 'desfazer')) && (
                  <span className="ml-1 text-[11px] text-tinta-400">(desfeito)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.pendencias.length > 0 && (
        <Aviso tom="atencao">
          <div className="space-y-1">
            {c.pendencias.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Aviso>
      )}
      {c.erro && <Aviso tom="erro">{c.erro}</Aviso>}
      {desfazer.isError && <Aviso tom="erro">{mensagemErro(desfazer.error)}</Aviso>}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {c.podeDesfazer && (
          <button
            type="button"
            disabled={desfazer.isPending}
            onClick={() => {
              if (
                confirm(
                  `Desfazer esta conferência de "${c.descricao}"? O que foi transferido volta, e a compra de acerto (se houve) é apagada no IXC.`,
                )
              ) {
                desfazer.mutate();
              }
            }}
            className="btn btn-perigo"
          >
            {desfazer.isPending ? 'Desfazendo no IXC…' : 'Desfazer'}
          </button>
        )}
        {!c.rodando && c.situacao !== 'DESFEITO' && (
          <button type="button" onClick={onAcheiMais} className="btn btn-neutro">
            Achei mais deste
          </button>
        )}
        <button type="button" disabled={c.rodando} onClick={onProximo} className="btn btn-primario">
          Conferir o próximo
        </button>
      </div>
    </div>
  );
}

function EncerrarInventario({ nome }: { nome: string }) {
  const qc = useQueryClient();
  const encerrar = useMutation({
    mutationFn: async () => (await api.post('/almoxarifado/conferencia/rodada/encerrar')).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
    onError: (e) => alert(mensagemErro(e)),
  });
  return (
    <button
      type="button"
      className="btn btn-neutro"
      disabled={encerrar.isPending}
      onClick={() => {
        if (
          confirm(
            `Encerrar "${nome}"? O que foi lançado no IXC continua lá. A próxima conferência começa um inventário novo, com tudo por conferir de novo.`,
          )
        ) {
          encerrar.mutate();
        }
      }}
    >
      Encerrar inventário
    </button>
  );
}
