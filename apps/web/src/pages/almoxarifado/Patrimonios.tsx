import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';

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

  // A busca roda no servidor: espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(digitado.trim());
      setPagina(1);
    }, 300);
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dados.pecas.map((p) => (
                  <CartaoDaPeca
                    key={p.patrimonioId}
                    peca={p}
                    proximo={dados.proximo}
                    aberto={editando === p.patrimonioId}
                    onAbrir={() => setEditando(p.patrimonioId)}
                    onFechar={() => setEditando(null)}
                    onMudou={atualizar}
                  />
                ))}
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
    </Pagina>
  );
}

function CartaoDaPeca({
  peca,
  proximo,
  aberto,
  onAbrir,
  onFechar,
  onMudou,
}: {
  peca: PecaDoCatalogo;
  proximo: number;
  aberto: boolean;
  onAbrir: () => void;
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

  return (
    <div
      className={
        aberto
          ? 'rounded-xl border-2 border-brand-500 bg-brand-500/10 p-3 shadow-lg ring-4 ring-brand-500/15'
          : 'cartao-item p-3'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {peca.numerada ? (
            <div className="num text-xl font-bold text-tinta-900">{peca.tombo}</div>
          ) : (
            <div className="num text-sm text-tinta-500">sem número · {peca.tombo ?? '—'}</div>
          )}
          <div className="text-sm font-semibold text-tinta-700">{peca.produto}</div>
          {peca.almoxarifado && <div className="text-xs text-tinta-500">{peca.almoxarifado}</div>}
        </div>
        {peca.situacao !== 'disponível' && (
          <Selo tom="neutro" pequeno>
            {peca.situacao}
          </Selo>
        )}
      </div>

      {aberto ? (
        <form onSubmit={enviar} className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-tinta-600" htmlFor={`serie-${peca.patrimonioId}`}>
            Número de série
          </label>
          <input
            id={`serie-${peca.patrimonioId}`}
            value={serie}
            onChange={(e) => setSerie(e.target.value.toUpperCase())}
            className="campo num w-full"
            autoFocus
            autoComplete="off"
            maxLength={60}
          />
          {gravar.isError && <div className="text-xs text-rose-500">{mensagemErro(gravar.error)}</div>}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-ok btn-p" disabled={gravar.isPending}>
              {gravar.isPending ? 'Gravando…' : 'Gravar'}
            </button>
            <button type="button" className="btn btn-neutro btn-p" onClick={onFechar} disabled={gravar.isPending}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="min-w-0 text-sm">
              {peca.numeroSerie ? (
                <div className="num break-all text-tinta-800">{peca.numeroSerie}</div>
              ) : (
                <div className="text-amber-600">sem número de série</div>
              )}
              {peca.mac && <div className="num break-all text-xs text-tinta-500">MAC {peca.mac}</div>}
            </div>
            <button
              type="button"
              onClick={() => {
                setSerie(peca.numeroSerie ?? '');
                gravar.reset();
                onAbrir();
              }}
              className="btn btn-ferramenta btn-p shrink-0"
            >
              {peca.numeroSerie ? 'Editar série' : 'Pôr série'}
            </button>
          </div>
          {!peca.numerada && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => numerar.mutate()}
                disabled={numerar.isPending}
                className="btn btn-ok btn-p"
              >
                {numerar.isPending ? 'Numerando…' : `Dar o número ${proximo}`}
              </button>
              {numerar.isError && (
                <div className="mt-1 text-xs text-rose-500">{mensagemErro(numerar.error)}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
