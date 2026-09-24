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
import {
  CONDICAO_LABEL,
  TIPO_LABEL,
  identificacaoDaPeca,
  type Recolhido,
  type ResultadoDoRecebimento,
} from '../../lib/os';

/** Quantos dias com o técnico já pede atenção. */
const DIAS_DE_ATENCAO = 3;

/**
 * Os aparelhos que voltaram de cliente e ainda estão com o técnico.
 *
 * A baixa do comodato os devolve à van dele no IXC — é com ele que estão. Aqui
 * a base confirma que recebeu, e eles vão por transferência para a triagem
 * ("Recolhidos (triagem)", criada no primeiro recebimento) ou para o
 * almoxarifado que se escolher. Até lá, o técnico não consegue instalá-los em
 * outro cliente pela tela das OS.
 *
 * "Sem transferir" é para quando o aparelho já foi mexido no IXC por outro
 * caminho, e é o único jeito da divergência (o aparelho que o IXC não tinha no
 * contrato): não há o que mover.
 */
export function Recolhidos() {
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState('');
  const [resultado, setResultado] = useState<ResultadoDoRecebimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['os', 'recolhidos'],
    queryFn: async () => (await api.get<Recolhido[]>('/os/recolhidos')).data,
  });
  const almoxarifados = useQuery({
    queryKey: ['os', 'almoxarifados'],
    queryFn: async () => (await api.get<Array<{ id: number; nome: string }>>('/os/almoxarifados')).data,
    staleTime: 5 * 60_000,
  });

  const receber = useMutation({
    mutationFn: async (semTransferir: boolean) =>
      (
        await api.post<ResultadoDoRecebimento>('/os/recolhidos/receber', {
          itens: [...marcados],
          ...(destino ? { destinoAlmoxId: Number(destino) } : {}),
          semTransferir,
        })
      ).data,
    onSuccess: (r) => {
      setResultado(r);
      setErro(null);
      setMarcados(new Set());
    },
    onError: (e) => setErro(mensagemErro(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['os'] }),
  });

  const itens = useMemo(() => lista.data ?? [], [lista.data]);
  const porTecnico = useMemo(() => {
    const grupos = new Map<string, { nome: string; almox: string; itens: Recolhido[] }>();
    for (const i of itens) {
      const g = grupos.get(i.tecnicoId) ?? { nome: i.tecnico, almox: i.almoxarifado, itens: [] };
      g.itens.push(i);
      grupos.set(i.tecnicoId, g);
    }
    return [...grupos.values()].sort((a, b) => b.itens.length - a.itens.length);
  }, [itens]);

  function alternar(ids: string[], ligar: boolean) {
    setMarcados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) {
        if (ligar) novo.add(id);
        else novo.delete(id);
      }
      return novo;
    });
  }

  const atrasados = itens.filter((i) => i.dias >= DIAS_DE_ATENCAO).length;
  const comDefeito = itens.filter((i) => i.condicao === 'DEFEITO').length;
  const soDivergencia =
    marcados.size > 0 && itens.filter((i) => marcados.has(i.id)).every((i) => i.tipo === 'DIVERGENCIA');

  return (
    <Pagina>
      <CabecalhoPagina secao="Ordens de Serviço" titulo="Recolhidos" />

      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {resultado && (
        <Aviso tom={resultado.recusados.length ? 'atencao' : 'pago'}>
          {resultado.recebidos} recebido(s)
          {resultado.destino ? ` e levado(s) para "${resultado.destino}"` : ''}
          {resultado.transferencias.length
            ? ` (transferência ${resultado.transferencias.map((t) => `#${t}`).join(', ')} no IXC)`
            : ''}
          .
          {resultado.recusados.map((r) => (
            <span key={r.itemId} className="mt-1 block">
              Ficou de fora — {r.descricao}: {r.motivo}
            </span>
          ))}
        </Aviso>
      )}

      <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
        <Indicador acento rotulo="Com os técnicos" valor={lista.data ? itens.length : '—'} />
        <Indicador
          rotulo={`Há ${DIAS_DE_ATENCAO} dias ou mais`}
          valor={lista.data ? atrasados : '—'}
          alerta={atrasados > 0 ? 'cobrar a entrega' : undefined}
        />
        <Indicador rotulo="Voltaram com defeito" valor={lista.data ? comDefeito : '—'} />
      </div>

      {lista.isLoading && <Carregando />}

      {lista.isSuccess && itens.length === 0 && (
        <Bloco>
          <Vazio titulo="Nenhum aparelho esperando a base">
            Tudo o que foi retirado de cliente já foi recebido.
          </Vazio>
        </Bloco>
      )}

      {itens.length > 0 && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <label className="rotulo" htmlFor="rec-destino">
              Para onde vão
            </label>
            <select
              id="rec-destino"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="campo"
            >
              <option value="">Recolhidos (triagem) — o padrão</option>
              {(almoxarifados.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={marcados.size === 0 || receber.isPending || soDivergencia}
            onClick={() => receber.mutate(false)}
            className="btn btn-primario"
          >
            {receber.isPending
              ? 'Transferindo no IXC…'
              : marcados.size
                ? `Receber ${marcados.size} e transferir`
                : 'Receber e transferir'}
          </button>
          <button
            type="button"
            disabled={marcados.size === 0 || receber.isPending}
            onClick={() => {
              if (
                confirm(
                  'Marcar como recebido sem transferir no IXC? Use quando o aparelho já foi mexido no IXC por outro caminho, ou quando é um aparelho fora da lista.',
                )
              ) {
                receber.mutate(true);
              }
            }}
            className="btn btn-neutro"
          >
            Receber sem transferir
          </button>
        </div>
      )}

      <div className="space-y-3">
        {porTecnico.map((g) => {
          const ids = g.itens.map((i) => i.id);
          const todos = ids.every((id) => marcados.has(id));
          return (
            <Bloco
              key={g.nome}
              semPadding
              titulo={`${g.nome} · ${g.itens.length}`}
              acao={
                <button type="button" onClick={() => alternar(ids, !todos)} className="btn btn-sutil btn-p">
                  {todos ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              }
            >
              <ul className="lista-dividida">
                {g.itens.map((i) => (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 md:px-5">
                      <input
                        type="checkbox"
                        checked={marcados.has(i.id)}
                        onChange={(e) => alternar([i.id], e.target.checked)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-tinta-900">{i.descricao}</span>
                          {i.tipo === 'DIVERGENCIA' && (
                            <Selo tom="atencao" pequeno>
                              {TIPO_LABEL[i.tipo]}
                            </Selo>
                          )}
                          {i.condicao && (
                            <Selo tom={i.condicao === 'DEFEITO' ? 'erro' : 'neutro'} pequeno>
                              {CONDICAO_LABEL[i.condicao]}
                            </Selo>
                          )}
                          {i.dias >= DIAS_DE_ATENCAO && (
                            <Selo tom="atencao" pequeno>
                              {i.dias} dias
                            </Selo>
                          )}
                        </span>
                        <span className="block text-[12px] text-tinta-500">
                          {identificacaoDaPeca(i) || 'sem identificação'} · OS {i.osIxcId}
                          {i.cliente ? ` · ${i.cliente}` : ''}
                        </span>
                        {i.observacao && (
                          <span className="block text-[12px] italic text-tinta-500">{i.observacao}</span>
                        )}
                        {i.aviso && (
                          <span className="block text-[12px] text-amber-700 dark:text-amber-300">{i.aviso}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Bloco>
          );
        })}
      </div>
    </Pagina>
  );
}
