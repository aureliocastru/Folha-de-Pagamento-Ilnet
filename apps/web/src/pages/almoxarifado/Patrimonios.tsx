import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Janela, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';

/** Uma peça do IXC, como a consulta da API a devolve. */
interface PecaDoCatalogo {
  patrimonioId: number;
  /** O número da casa, ou as 5 letras que o IXC sorteou. */
  tombo: string | null;
  numerada: boolean;
  numeroSerie: string | null;
  mac: string | null;
  produtoId: number;
  produto: string;
  almoxarifado: string | null;
  situacao: string;
}

interface PaginaDoCatalogo {
  pecas: PecaDoCatalogo[];
  total: number;
  semSerie: number;
  proximo: number;
  lidoEm: string;
}

interface DetalheDaPeca {
  peca: PecaDoCatalogo;
  comodato: {
    contratoId: number;
    plano: string | null;
    contratoStatus: string | null;
    clienteId: number | null;
    cliente: string | null;
    endereco: string | null;
    desde: string | null;
  } | null;
  numeracao: { dadoPor: string; dadoEm: string; codigoAnterior: string | null; entradaId: number | null } | null;
  movimentos: Array<{ data: string | null; oque: string; entrou: boolean; almoxarifado: string | null }>;
  aquisicao: string | null;
  valor: number | null;
}

const SITUACAO_DO_CONTRATO: Record<string, string> = {
  A: 'ativo',
  I: 'inativo',
  P: 'pré-contrato',
  N: 'negativado',
  D: 'desistiu',
};

const CHAVE = ['almoxarifado', 'patrimonios'];

/**
 * Os equipamentos do IXC — o número que está marcado em cada um, o produto,
 * onde está, e o número de série de fábrica, que se cadastra aqui.
 */
export function Patrimonios() {
  const cliente = useQueryClient();
  const [digitado, setDigitado] = useState('');
  const [busca, setBusca] = useState('');
  const [todas, setTodas] = useState(false);
  const [soSemSerie, setSoSemSerie] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<number | null>(null);
  const [vendo, setVendo] = useState<PecaDoCatalogo | null>(null);

  // A busca roda no servidor: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(digitado.trim());
      setPagina(1);
    }, 120);
    return () => clearTimeout(t);
  }, [digitado]);

  const consulta = useQuery({
    queryKey: [...CHAVE, busca, todas, soSemSerie, pagina],
    queryFn: async () =>
      (
        await api.get<PaginaDoCatalogo>('/almoxarifado/patrimonios', {
          params: { busca: busca || undefined, todas: todas ? 1 : undefined, semSerie: soSemSerie ? 1 : undefined, pagina },
        })
      ).data,
    placeholderData: (anterior) => anterior,
  });
  const reler = useMutation({
    mutationFn: async () =>
      (await api.get<PaginaDoCatalogo>('/almoxarifado/patrimonios', { params: { reler: 1 } })).data,
    onSuccess: () => void cliente.invalidateQueries({ queryKey: CHAVE }),
  });

  const dados = consulta.data;
  const atualizar = () => void cliente.invalidateQueries({ queryKey: CHAVE });

  return (
    <Pagina>
      <CabecalhoPagina secao="Almoxarifado" titulo="Patrimônios" />

      <div className="space-y-4">
        {dados && (
          <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-tinta-500">
                Próximo número
              </div>
              <div className="num text-2xl font-bold text-tinta-900">{dados.proximo}</div>
            </div>
            {dados.semSerie > 0 && (
              <div className="text-sm text-amber-600">{dados.semSerie} sem número de série</div>
            )}
            <button
              type="button"
              onClick={() => reler.mutate()}
              disabled={reler.isPending}
              className="btn btn-neutro btn-p ml-auto"
            >
              {reler.isPending ? 'Lendo o IXC…' : 'Atualizar do IXC'}
            </button>
          </div>
        )}

        <Bloco
          titulo={
            dados
              ? `${dados.total} ${dados.total === 1 ? 'equipamento' : 'equipamentos'}`
              : 'Equipamentos'
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder="Buscar por número, série, MAC ou produto…"
              className="campo min-w-0 flex-1 basis-56"
              autoComplete="off"
              aria-label="Buscar equipamento"
            />
            <button
              type="button"
              onClick={() => {
                setSoSemSerie((v) => !v);
                setPagina(1);
              }}
              className={`btn btn-p ${soSemSerie ? 'btn-ferramenta' : 'btn-neutro'}`}
              aria-pressed={soSemSerie}
            >
              Sem série
            </button>
            <button
              type="button"
              onClick={() => {
                setTodas((v) => !v);
                setPagina(1);
              }}
              className={`btn btn-p ${todas ? 'btn-ferramenta' : 'btn-neutro'}`}
              aria-pressed={todas}
            >
              Sem número também
            </button>
          </div>

          {consulta.isLoading && <Carregando texto="Lendo os equipamentos no IXC…" />}
          {consulta.isError && <Aviso tom="erro">{mensagemErro(consulta.error)}</Aviso>}
          {dados && dados.pecas.length === 0 && <Vazio titulo="Nenhum equipamento com isso" />}

          {dados && dados.pecas.length > 0 && (
            <>
              <div className={`-mx-3.5 md:-mx-5 ${consulta.isFetching ? 'opacity-70' : ''}`}>
                <div className="hidden border-b border-fio md:grid md:grid-cols-[88px_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] md:gap-3 md:px-5">
                  <div className="th px-0">Número</div>
                  <div className="th px-0">Produto</div>
                  <div className="th px-0">Onde</div>
                  <div className="th px-0">Série</div>
                  <div className="th px-0 text-right">Ação</div>
                </div>
                <div>
                  {dados.pecas.map((p) => (
                    <LinhaDaPeca
                      key={p.patrimonioId}
                      peca={p}
                      proximo={dados.proximo}
                      aberta={editando === p.patrimonioId}
                      onAbrir={() => setEditando(p.patrimonioId)}
                      onVer={() => setVendo(p)}
                      onFechar={() => setEditando(null)}
                      onMudou={atualizar}
                    />
                  ))}
                </div>
              </div>
              {dados.pecas.length < dados.total && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={() => setPagina((n) => n + 1)}
                    disabled={consulta.isFetching}
                    className="btn btn-neutro"
                  >
                    {consulta.isFetching ? 'Carregando…' : `Mostrar mais (${dados.total - dados.pecas.length})`}
                  </button>
                </div>
              )}
            </>
          )}
        </Bloco>
      </div>

      {vendo && <JanelaDaPeca peca={vendo} onFechar={() => setVendo(null)} />}
    </Pagina>
  );
}

/** A peça aberta: onde está, com quem, de que compra veio e por onde passou. */
function JanelaDaPeca({ peca, onFechar }: { peca: PecaDoCatalogo; onFechar: () => void }) {
  const detalhe = useQuery({
    queryKey: [...CHAVE, 'peca', peca.patrimonioId],
    queryFn: async () => (await api.get<DetalheDaPeca>(`/almoxarifado/patrimonios/${peca.patrimonioId}`)).data,
  });
  const d = detalhe.data;
  const p = d?.peca ?? peca;

  return (
    <Janela titulo={p.numerada ? `Patrimônio ${p.tombo}` : `Peça ${p.tombo ?? `#${p.patrimonioId}`}`} onFechar={onFechar}>
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-base font-semibold text-tinta-900">{p.produto}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Selo tom={p.situacao === 'disponível' ? 'pago' : 'neutro'} pequeno>
              {p.situacao}
            </Selo>
            {p.almoxarifado && <span className="text-tinta-600">{p.almoxarifado}</span>}
          </div>
        </div>

        <dl className="divide-y divide-fio rounded-lg border border-fio">
          <Dado rotulo="Série">{p.numeroSerie ?? <span className="text-amber-600">sem série</span>}</Dado>
          {p.mac && <Dado rotulo="MAC">{p.mac}</Dado>}
          {d?.aquisicao && <Dado rotulo="Aquisição">{formatData(d.aquisicao)}</Dado>}
          {d?.valor != null && <Dado rotulo="Valor do bem">{formatBRL(d.valor)}</Dado>}
          {d?.numeracao && (
            <Dado rotulo="Numerada">
              {formatData(d.numeracao.dadoEm.slice(0, 10))} por {d.numeracao.dadoPor}
              {d.numeracao.entradaId ? ` · compra #${d.numeracao.entradaId}` : ''}
              {d.numeracao.codigoAnterior ? ` · era ${d.numeracao.codigoAnterior}` : ''}
            </Dado>
          )}
        </dl>

        {detalhe.isLoading && <Carregando texto="Lendo a peça no IXC…" />}
        {detalhe.isError && <Aviso tom="erro">{mensagemErro(detalhe.error)}</Aviso>}

        {d?.comodato && (
          <div className="rounded-lg border-2 border-brand-500 bg-brand-500/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-tinta-500">Com o cliente</div>
            <div className="mt-1 text-base font-semibold text-tinta-900">
              {d.comodato.cliente ?? `Contrato #${d.comodato.contratoId}`}
            </div>
            {d.comodato.endereco && <div className="text-tinta-700">{d.comodato.endereco}</div>}
            <div className="mt-1 text-xs text-tinta-500">
              contrato #{d.comodato.contratoId}
              {d.comodato.plano ? ` · ${d.comodato.plano}` : ''}
              {d.comodato.contratoStatus
                ? ` · ${SITUACAO_DO_CONTRATO[d.comodato.contratoStatus] ?? d.comodato.contratoStatus}`
                : ''}
              {d.comodato.desde ? ` · desde ${formatData(d.comodato.desde)}` : ''}
            </div>
          </div>
        )}

        {d && d.movimentos.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-tinta-500">Por onde passou</div>
            <div className="rounded-lg border border-fio">
              {d.movimentos.map((m, i) => (
                <div key={i} className="linha flex items-baseline gap-3 px-3 py-1.5 first:border-t-0">
                  <span className="num w-20 shrink-0 text-xs text-tinta-500">{m.data ? formatData(m.data) : '—'}</span>
                  <span className="min-w-0 flex-1 text-tinta-800">{m.oque}</span>
                  {m.almoxarifado && <span className="truncate text-xs text-tinta-500">{m.almoxarifado}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Janela>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="text-xs text-tinta-500">{rotulo}</dt>
      <dd className="num min-w-0 break-all text-right text-tinta-800">{children}</dd>
    </div>
  );
}

function LinhaDaPeca({
  peca,
  proximo,
  aberta,
  onAbrir,
  onVer,
  onFechar,
  onMudou,
}: {
  peca: PecaDoCatalogo;
  proximo: number;
  aberta: boolean;
  onAbrir: () => void;
  onVer: () => void;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [serie, setSerie] = useState(peca.numeroSerie ?? '');
  const gravar = useMutation({
    mutationFn: async (numeroSerie: string) =>
      (
        await api.patch<{ numeroSerie: string | null }>(
          `/almoxarifado/patrimonios/${peca.patrimonioId}/serie`,
          { numeroSerie },
        )
      ).data,
    onSuccess: () => {
      onFechar();
      onMudou();
    },
  });
  const numerar = useMutation({
    mutationFn: async () =>
      (await api.post<{ numero: number }>(`/almoxarifado/patrimonios/${peca.patrimonioId}/numero`)).data,
    onSuccess: onMudou,
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    gravar.mutate(serie.trim());
  };

  const acoes = (
    <div className="flex shrink-0 items-center justify-end gap-2">
      {!peca.numerada && (
        <button
          type="button"
          onClick={() => numerar.mutate()}
          disabled={numerar.isPending}
          className="btn btn-ok btn-p"
        >
          {numerar.isPending ? 'Numerando…' : `Dar o número ${proximo}`}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setSerie(peca.numeroSerie ?? '');
          gravar.reset();
          onAbrir();
        }}
        className="btn btn-ferramenta btn-p"
      >
        {peca.numeroSerie ? 'Editar série' : 'Pôr série'}
      </button>
    </div>
  );

  return (
    <div
      onClick={(e) => {
        // Clique no botão ou no campo é do botão e do campo; no resto da linha, abre a peça.
        if (aberta || (e.target as HTMLElement).closest('button, input, form, a')) return;
        onVer();
      }}
      className={`linha cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-1.5 text-sm md:grid md:grid-cols-[88px_minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] md:px-5 ${
        aberta ? 'bg-brand-500/10 outline outline-2 -outline-offset-2 outline-brand-500' : ''
      }`}
    >
      <div className="shrink-0">
        {peca.numerada ? (
          <span className="num font-bold text-tinta-900">{peca.tombo}</span>
        ) : (
          <span className="num text-tinta-500">{peca.tombo ?? '—'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 truncate font-semibold text-tinta-800" title={peca.produto}>
        {peca.produto}
      </div>
      {/* No celular o lugar e a série descem para a segunda linha; no computador são colunas. */}
      <div className="order-4 flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 md:order-none md:contents">
        <div className="min-w-0 truncate text-xs text-tinta-500 md:text-sm md:text-tinta-600">
          {peca.almoxarifado ?? '—'}
          {peca.situacao !== 'disponível' && (
            <span className="ml-2">
              <Selo tom="neutro" pequeno>
                {peca.situacao}
              </Selo>
            </span>
          )}
        </div>
        <div className={`min-w-0 ${aberta ? 'basis-full md:col-span-2 md:basis-auto' : ''}`}>
          {aberta ? (
            <form onSubmit={enviar} className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              <input
                value={serie}
                onChange={(e) => setSerie(e.target.value.toUpperCase())}
                className="campo num min-w-0 flex-1 basis-40"
                autoFocus
                autoComplete="off"
                maxLength={60}
                aria-label="Número de série"
              />
              <button type="submit" className="btn btn-ok btn-p" disabled={gravar.isPending}>
                {gravar.isPending ? 'Gravando…' : 'Gravar'}
              </button>
              <button type="button" className="btn btn-neutro btn-p" onClick={onFechar} disabled={gravar.isPending}>
                Cancelar
              </button>
              {gravar.isError && (
                <div className="basis-full text-xs text-rose-500">{mensagemErro(gravar.error)}</div>
              )}
            </form>
          ) : (
            <>
              {peca.numeroSerie ? (
                <span className="num break-all text-tinta-800">{peca.numeroSerie}</span>
              ) : (
                <span className="text-amber-600">sem série</span>
              )}
              {peca.mac && <span className="num ml-2 break-all text-xs text-tinta-500">MAC {peca.mac}</span>}
            </>
          )}
        </div>
      </div>
      {!aberta && <div className="order-3 ml-auto md:order-none md:ml-0">{acoes}</div>}
      {numerar.isError && (
        <div className="order-5 basis-full text-xs text-rose-500 md:col-span-5">{mensagemErro(numerar.error)}</div>
      )}
    </div>
  );
}
