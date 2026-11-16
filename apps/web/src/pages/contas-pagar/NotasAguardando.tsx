import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SeletorDeCategoria } from '../../components/SeletorDeCategoria';
import { Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { NotaDeCompra } from '../../lib/notas-de-compra';
import type { CategoriaDespesa } from '../../lib/types';
import { DetalheDaNota } from '../almoxarifado/NotasDeCompra';

/**
 * As notas que o almoxarife lançou e que ainda não viraram conta a pagar.
 *
 * Os produtos já entraram no estoque; o que espera aqui são as parcelas. Só
 * depois de confirmar é que as contas nascem no IXC e aparecem na lista de
 * baixo. Sem nota esperando, isto não ocupa lugar.
 */
export function NotasAguardando() {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState<NotaDeCompra | null>(null);

  const lista = useQuery({
    queryKey: ['notas-de-compra', 'pendentes'],
    queryFn: async () => (await api.get<NotaDeCompra[]>('/notas-de-compra/pendentes')).data,
    // Quem lança é outra pessoa, em outra tela: a nota aparece sem recarregar.
    refetchInterval: 60_000,
  });

  const notas = lista.data ?? [];
  if (notas.length === 0) return null;

  return (
    <div className="surgir mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="font-semibold">
        {notas.length === 1
          ? '1 nota do almoxarifado esperando a sua confirmação'
          : `${notas.length} notas do almoxarifado esperando a sua confirmação`}
      </p>
      <ul className="mt-2 space-y-2">
        {notas.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="min-w-0">
              <strong>{n.fornecedor.nome}</strong>
              <span className="num ml-2 text-xs opacity-80">
                NF {n.numeroNota} · {formatData(n.dataEmissao)} · {n.parcelas.length} parcela
                {n.parcelas.length === 1 ? '' : 's'} · lançada por {n.lancadaPor}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span className="valor">{formatBRL(n.valorTotal)}</span>
              <button type="button" onClick={() => setAberta(n)} className="btn btn-primario btn-p">
                Conferir
              </button>
            </span>
          </li>
        ))}
      </ul>

      {aberta && (
        <ConfirmarNota
          nota={aberta}
          onFechar={() => setAberta(null)}
          onDecidida={() => {
            setAberta(null);
            void qc.invalidateQueries({ queryKey: ['notas-de-compra'] });
            void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
          }}
        />
      )}
    </div>
  );
}

function ConfirmarNota({
  nota,
  onFechar,
  onDecidida,
}: {
  nota: NotaDeCompra;
  onFechar: () => void;
  onDecidida: () => void;
}) {
  const [categoriaId, setCategoriaId] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () => (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  const confirmar = useMutation({
    mutationFn: async () =>
      api.post(`/notas-de-compra/${nota.id}/confirmar`, categoriaId ? { categoriaId } : {}),
    onSuccess: onDecidida,
  });
  const recusar = useMutation({
    mutationFn: async () =>
      api.post(`/notas-de-compra/${nota.id}/recusar`, motivo.trim() ? { motivo } : {}),
    onSuccess: onDecidida,
  });
  const ocupado = confirmar.isPending || recusar.isPending;
  const erro = confirmar.error ?? recusar.error;

  return (
    <Janela titulo="Nota do almoxarifado" onFechar={onFechar} media>
      <DetalheDaNota nota={nota} />

      <div className="mt-4 grid max-w-2xl grid-cols-1 gap-3">
        {recusando ? (
          <div>
            <label className="rotulo" htmlFor="nota-motivo">
              Por que não vai gerar conta
            </label>
            <input
              id="nota-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
              className="campo"
              placeholder="Ex.: já foi paga, bonificação"
              autoComplete="off"
            />
          </div>
        ) : (
          <div>
            <label className="rotulo" htmlFor="nota-categoria">
              Categoria das contas
            </label>
            <SeletorDeCategoria
              id="nota-categoria"
              categorias={categorias.data}
              value={categoriaId}
              vazio="Sem categoria"
              carregando={categorias.isLoading}
              onChange={setCategoriaId}
            />
          </div>
        )}
      </div>

      {erro && <p className="mt-3 text-sm text-rose-600">{mensagemErro(erro)}</p>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-tinta-200 pt-4">
        {recusando ? (
          <>
            <button
              type="button"
              onClick={() => setRecusando(false)}
              disabled={ocupado}
              className="btn btn-neutro"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => recusar.mutate()}
              disabled={ocupado}
              className="btn btn-alerta"
            >
              {recusar.isPending ? 'Recusando…' : 'Não gerar conta'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setRecusando(true)}
              disabled={ocupado}
              className="btn btn-alerta mr-auto"
            >
              Não gerar conta
            </button>
            <button type="button" onClick={onFechar} disabled={ocupado} className="btn btn-neutro">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => confirmar.mutate()}
              disabled={ocupado}
              className="btn btn-primario"
            >
              {confirmar.isPending
                ? 'Criando as contas…'
                : nota.parcelas.length === 1
                  ? 'Confirmar e criar a conta'
                  : `Confirmar e criar as ${nota.parcelas.length} contas`}
            </button>
          </>
        )}
      </div>
    </Janela>
  );
}
