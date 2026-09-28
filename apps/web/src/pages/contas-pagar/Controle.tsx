import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormularioEmPassos } from '../../components/FormularioEmPassos';
import {
  Aviso,
  CabecalhoPagina,
  CampoDinheiro,
  Carregando,
  Janela,
  Pagina,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { AReceber } from '../../lib/types';

/**
 * A aba Controle: quem deve a quem está logado, e quanto.
 *
 * É lembrete, e só isso — o empréstimo feito a alguém. Sem data de receber,
 * sem soma em painel nenhum, sem ida ao IXC. E cada login vê só o que ele
 * mesmo cadastrou.
 */
export function Controle() {
  const qc = useQueryClient();
  /** A janela aberta: um novo (null) ou um que existe. */
  const [editando, setEditando] = useState<AReceber | null | undefined>(undefined);
  const [verRecebidos, setVerRecebidos] = useState(false);

  const lista = useQuery({
    queryKey: ['a-receber'],
    queryFn: async () =>
      (
        await api.get<{ devendo: AReceber[]; recebidos: AReceber[] }>(
          '/a-receber',
        )
      ).data,
  });

  const marcar = useMutation({
    mutationFn: async (dados: { id: string; recebido: boolean }) =>
      api.put(`/a-receber/${dados.id}/recebido`, { recebido: dados.recebido }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['a-receber'] }),
  });

  const devendo = lista.data?.devendo ?? [];
  const recebidos = lista.data?.recebidos ?? [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Controle"
        titulo="Quem me deve"
        acoes={
          <button
            type="button"
            onClick={() => setEditando(null)}
            className="btn btn-primario"
          >
            Novo
          </button>
        }
      />

      {marcar.isError && (
        <div className="mb-4">
          <Aviso tom="erro">{mensagemErro(marcar.error)}</Aviso>
        </div>
      )}

      {lista.isLoading ? (
        <Carregando />
      ) : lista.isError ? (
        <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>
      ) : devendo.length === 0 ? (
        <div className="card">
          <Vazio titulo="Ninguém te devendo" />
        </div>
      ) : (
        <ul className="surgir card lista-dividida">
          {devendo.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <button
                type="button"
                onClick={() => setEditando(d)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold text-tinta-900">{d.pessoa}</span>
                  <span className="valor text-tinta-800">{formatBRL(d.valor)}</span>
                </div>
                {d.observacao && (
                  <div className="text-sm text-tinta-500">{d.observacao}</div>
                )}
                <div className="text-xs text-tinta-400">
                  desde {formatData(d.createdAt)}
                </div>
              </button>
              <button
                type="button"
                onClick={() => marcar.mutate({ id: d.id, recebido: true })}
                disabled={marcar.isPending}
                className="btn btn-p btn-pagar"
              >
                Recebi
              </button>
            </li>
          ))}
        </ul>
      )}

      {recebidos.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setVerRecebidos((v) => !v)}
            className="btn btn-p btn-sutil"
            aria-expanded={verRecebidos}
          >
            {verRecebidos ? 'Esconder os recebidos' : `Recebidos (${recebidos.length})`}
          </button>
          {verRecebidos && (
            <ul className="card lista-dividida mt-3">
              {recebidos.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <div className="min-w-0 flex-1 text-tinta-500">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-medium">{d.pessoa}</span>
                      <span className="valor">{formatBRL(d.valor)}</span>
                    </div>
                    <div className="text-xs text-tinta-400">
                      recebido em {d.recebidoEm ? formatData(d.recebidoEm) : '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => marcar.mutate({ id: d.id, recebido: false })}
                    disabled={marcar.isPending}
                    className="btn btn-p btn-sutil"
                  >
                    Desfazer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editando !== undefined && (
        <JanelaDoLembrete
          lembrete={editando}
          onFechar={() => setEditando(undefined)}
          onPronto={() => {
            setEditando(undefined);
            void qc.invalidateQueries({ queryKey: ['a-receber'] });
          }}
        />
      )}
    </Pagina>
  );
}

/** Quem deve e quanto — novo, ou corrigir um que existe. */
function JanelaDoLembrete({
  lembrete,
  onFechar,
  onPronto,
}: {
  lembrete: AReceber | null;
  onFechar: () => void;
  onPronto: () => void;
}) {
  const [pessoa, setPessoa] = useState(lembrete?.pessoa ?? '');
  const [valor, setValor] = useState(lembrete ? lembrete.valor.toFixed(2) : '');
  const [observacao, setObservacao] = useState(lembrete?.observacao ?? '');

  const valido = pessoa.trim().length >= 2 && Number(valor) > 0;

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        pessoa: pessoa.trim(),
        valor: Number(valor),
        observacao: observacao.trim() || (lembrete ? null : undefined),
      };
      if (lembrete) await api.patch(`/a-receber/${lembrete.id}`, corpo);
      else await api.post('/a-receber', corpo);
    },
    onSuccess: onPronto,
  });

  const apagar = useMutation({
    mutationFn: async () => api.delete(`/a-receber/${lembrete!.id}`),
    onSuccess: onPronto,
  });

  return (
    <Janela titulo={lembrete ? lembrete.pessoa : 'Quem te deve'} onFechar={onFechar}>
      <FormularioEmPassos>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div data-passo-falta={pessoa.trim().length >= 2 ? undefined : 'Diga quem deve.'}>
            <label className="rotulo" htmlFor="ar-pessoa">
              Quem deve
            </label>
            <input
              id="ar-pessoa"
              value={pessoa}
              onChange={(e) => setPessoa(e.target.value)}
              className="campo"
              autoComplete="off"
              autoFocus={!lembrete}
            />
          </div>
          <div data-passo-falta={Number(valor) > 0 ? undefined : 'Diga quanto.'}>
            <label className="rotulo" htmlFor="ar-valor">
              Quanto
            </label>
            <CampoDinheiro id="ar-valor" valor={valor} onChange={setValor} placeholder="0,00" />
          </div>
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="ar-obs">
              Observação (opcional)
            </label>
            <input
              id="ar-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
              autoComplete="off"
            />
          </div>
        </div>

        {(salvar.isError || apagar.isError) && (
          <Aviso tom="erro">{mensagemErro(salvar.error ?? apagar.error)}</Aviso>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {lembrete && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Apagar o lembrete de ${lembrete.pessoa}?`)) {
                  apagar.mutate();
                }
              }}
              disabled={apagar.isPending}
              className="btn btn-sutil mr-auto text-rose-600 dark:text-rose-300"
            >
              Apagar
            </button>
          )}
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => salvar.mutate()}
            disabled={!valido || salvar.isPending}
            className="btn btn-primario"
          >
            {salvar.isPending ? 'Salvando…' : lembrete ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </FormularioEmPassos>
    </Janela>
  );
}
