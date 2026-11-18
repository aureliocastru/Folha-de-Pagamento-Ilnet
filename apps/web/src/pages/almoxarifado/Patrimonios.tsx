import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import type { PecaAchada } from '../../lib/types';

/** Uma peça numerada pelo sistema, como a API a devolve. */
interface PatrimonioNumerado {
  numero: number;
  patrimonioId: number;
  produtoId: number;
  produto: string;
  numeroSerie: string | null;
  mac: string | null;
  almoxId: number | null;
  situacao: string | null;
  codigoAnterior: string | null;
  entradaId: number | null;
  dadoPor: string;
  dadoEm: string;
}

interface Resposta {
  pecas: PatrimonioNumerado[];
  proximo: number;
}

const CHAVE = ['almoxarifado', 'patrimonios'];

/**
 * Os equipamentos numerados — cada peça com o número que o almoxarife marca
 * nela, e o número de série de fábrica, que se cadastra aqui.
 */
export function Patrimonios() {
  const [busca, setBusca] = useState('');
  const [soSemSerie, setSoSemSerie] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);

  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api.get<Resposta>('/almoxarifado/patrimonios')).data,
  });

  const todas = lista.data?.pecas ?? [];
  const semSerie = todas.filter((p) => !p.numeroSerie).length;
  const termo = semAcento(busca.trim());
  const mostradas = todas.filter(
    (p) =>
      (!soSemSerie || !p.numeroSerie) &&
      (!termo || combina([String(p.numero), p.produto, p.numeroSerie, p.mac, p.codigoAnterior], termo)),
  );

  return (
    <Pagina>
      <CabecalhoPagina secao="Almoxarifado" titulo="Patrimônios" />

      <div className="space-y-4">
        {lista.data && (
          <div className="card flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-tinta-500">
                Próximo número
              </div>
              <div className="num text-2xl font-bold text-tinta-900">{lista.data.proximo}</div>
            </div>
            {semSerie > 0 && (
              <div className="text-sm text-amber-600">{semSerie} sem número de série</div>
            )}
          </div>
        )}

        <NumerarPecaDoIxc proximo={lista.data?.proximo} />

        <Bloco
          titulo={
            termo || soSemSerie
              ? `${mostradas.length} de ${todas.length} equipamentos`
              : `${todas.length} ${todas.length === 1 ? 'equipamento' : 'equipamentos'}`
          }
        >
          {lista.isLoading && <Carregando texto="Lendo os equipamentos…" />}
          {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
          {lista.data && todas.length === 0 && (
            <Vazio titulo="Nenhum equipamento numerado ainda">
              Os equipamentos das próximas notas aparecem aqui.
            </Vazio>
          )}

          {todas.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por número, produto, série…"
                  className="campo min-w-0 flex-1"
                  autoComplete="off"
                  aria-label="Buscar equipamento"
                />
                <button
                  type="button"
                  onClick={() => setSoSemSerie((v) => !v)}
                  className={`btn btn-p ${soSemSerie ? 'btn-ferramenta' : 'btn-neutro'}`}
                  aria-pressed={soSemSerie}
                >
                  Sem série
                </button>
              </div>

              {mostradas.length === 0 ? (
                <Vazio titulo="Nenhum equipamento com isso" />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {mostradas.map((p) => (
                    <CartaoDaPeca
                      key={p.patrimonioId}
                      peca={p}
                      aberto={editando === p.patrimonioId}
                      onAbrir={() => setEditando(p.patrimonioId)}
                      onFechar={() => setEditando(null)}
                    />
                  ))}
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
  aberto,
  onAbrir,
  onFechar,
}: {
  peca: PatrimonioNumerado;
  aberto: boolean;
  onAbrir: () => void;
  onFechar: () => void;
}) {
  const cliente = useQueryClient();
  const [serie, setSerie] = useState(peca.numeroSerie ?? '');
  const gravar = useMutation({
    mutationFn: async (numeroSerie: string) =>
      (
        await api.patch<{ numeroSerie: string | null }>(
          `/almoxarifado/patrimonios/${peca.patrimonioId}/serie`,
          { numeroSerie },
        )
      ).data,
    onSuccess: (r) => {
      cliente.setQueryData<Resposta>(CHAVE, (antes) =>
        antes
          ? {
              ...antes,
              pecas: antes.pecas.map((x) =>
                x.patrimonioId === peca.patrimonioId ? { ...x, numeroSerie: r.numeroSerie } : x,
              ),
            }
          : antes,
      );
      onFechar();
    },
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
          <div className="num text-xl font-bold text-tinta-900">{peca.numero}</div>
          <div className="text-sm font-semibold text-tinta-700">{peca.produto}</div>
        </div>
        {peca.situacao && peca.situacao !== 'disponível' && (
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
      )}
    </div>
  );
}

/**
 * Peça que veio sem número — a de compra lançada direto no IXC, com as 5
 * letras sorteadas: acha-se pelo código e recebe o próximo número.
 */
function NumerarPecaDoIxc({ proximo }: { proximo?: number }) {
  const cliente = useQueryClient();
  const [codigo, setCodigo] = useState('');
  const [feito, setFeito] = useState<string | null>(null);

  const achar = useMutation({
    mutationFn: async (c: string) =>
      (await api.get<PecaAchada>('/almoxarifado/patrimonios/onde', { params: { codigo: c } })).data,
    onMutate: () => setFeito(null),
  });
  const numerar = useMutation({
    mutationFn: async (patrimonioId: number) =>
      (await api.post<{ numero: number }>(`/almoxarifado/patrimonios/${patrimonioId}/numero`)).data,
    onSuccess: (r) => {
      setFeito(`${achar.data?.descricao ?? 'A peça'} agora é o patrimônio ${r.numero}.`);
      achar.reset();
      setCodigo('');
      void cliente.invalidateQueries({ queryKey: CHAVE });
    },
  });

  const peca = achar.data;
  const jaNumerada = peca?.numeroPatrimonial ? /^\d+$/.test(peca.numeroPatrimonial) : false;

  return (
    <Bloco titulo="Numerar peça do IXC">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (codigo.trim()) achar.mutate(codigo.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código da peça (ex.: M53I1), série ou MAC"
          className="campo min-w-0 flex-1"
          autoComplete="off"
          aria-label="Código da peça"
        />
        <button type="submit" className="btn btn-ferramenta btn-p" disabled={achar.isPending}>
          {achar.isPending ? 'Procurando…' : 'Procurar'}
        </button>
      </form>

      {achar.isError && <div className="mt-2 text-sm text-rose-500">{mensagemErro(achar.error)}</div>}
      {feito && <div className="mt-2 text-sm font-semibold text-emerald-500">{feito}</div>}

      {peca && (
        <div className="mt-3 rounded-xl border-2 border-brand-500 bg-brand-500/10 p-3">
          <div className="text-sm font-semibold text-tinta-900">{peca.descricao}</div>
          <div className="num text-xs text-tinta-500">
            código {peca.numeroPatrimonial ?? '—'} · {peca.almoxarifado || 'sem almoxarifado'} · {peca.situacao}
          </div>
          {numerar.isError && <div className="mt-2 text-xs text-rose-500">{mensagemErro(numerar.error)}</div>}
          <div className="mt-3 flex gap-2">
            {jaNumerada ? (
              <div className="text-sm text-tinta-600">Esta peça já tem número.</div>
            ) : (
              <button
                type="button"
                className="btn btn-ok btn-p"
                onClick={() => numerar.mutate(peca.patrimonioId)}
                disabled={numerar.isPending}
              >
                {numerar.isPending ? 'Numerando…' : `Dar o número ${proximo ?? ''}`.trim()}
              </button>
            )}
            <button type="button" className="btn btn-neutro btn-p" onClick={() => achar.reset()}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Bloco>
  );
}
