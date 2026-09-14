import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type { HistoricoDeSaidas, ItemDeEstoque } from '../../lib/types';
import { numeroDigitado, quantidade } from './ProdutoNoIxc';

/**
 * A saída de um produto, e o histórico de todas as saídas dele.
 *
 * Feita para o celular, na prateleira: de onde sai (um toque), quanto (os
 * botões − e +), pra onde vai, quem pegou. A data é a do dia. O saldo sai no
 * IXC por transferência para o almoxarifado "Saídas".
 */
export function SaidaDoProduto({
  item,
  onFechar,
}: {
  item: ItemDeEstoque;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  // De onde dá para tirar: prateleira com saldo. Perdas e Saídas não são
  // prateleira, e produto inativo não sai (fica só o histórico).
  const origens = item.ativo && !item.servico
    ? item.saldos
        .filter((s) => s.saldo > 0 && !s.perdas && !s.saidas)
        .sort((a, b) => b.saldo - a.saldo)
    : [];

  const [almoxId, setAlmoxId] = useState<number | null>(origens[0]?.almoxId ?? null);
  const [qtd, setQtd] = useState('1');
  const [destino, setDestino] = useState('');
  const [quemPegou, setQuemPegou] = useState('');
  const [observacao, setObservacao] = useState('');
  const [feito, setFeito] = useState<string | null>(null);

  const historico = useQuery({
    queryKey: ['almoxarifado', 'saidas', item.produtoId],
    queryFn: async () =>
      (await api.get<HistoricoDeSaidas>(`/almoxarifado/produtos/${item.produtoId}/saidas`)).data,
  });

  const origem = origens.find((o) => o.almoxId === almoxId);
  const n = numeroDigitado(qtd);
  const unidade = item.unidade ? ` ${item.unidade}` : '';
  const passou = !!origem && n > origem.saldo + 1e-9;
  const pode =
    !!origem && n > 0 && !passou && destino.trim().length >= 2 && quemPegou.trim().length >= 2;

  const darSaida = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/almoxarifado/produtos/${item.produtoId}/saidas`, {
          almoxId,
          quantidade: n,
          destino: destino.trim(),
          quemPegou: quemPegou.trim(),
          observacao: observacao.trim() || undefined,
        })
      ).data,
    onSuccess: () => {
      setFeito(`Saiu ${quantidade(n)}${unidade} para ${destino.trim()}.`);
      setQtd('1');
      setDestino('');
      setObservacao('');
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'saidas', item.produtoId] });
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
    },
  });

  function somar(delta: number) {
    const atual = Number.isFinite(n) ? n : 0;
    setQtd(String(Math.max(1, Math.round(atual + delta))));
  }

  const dados = historico.data;

  return (
    <Janela titulo={item.descricao} onFechar={onFechar}>
      <div className="mx-auto w-full max-w-xl">
        {origens.length === 0 ? (
          <Aviso tom="atencao">Não tem saldo deste produto em almoxarifado nenhum para sair.</Aviso>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="rotulo">De onde sai</p>
              <div className="flex flex-wrap gap-2">
                {origens.map((o) => (
                  <button
                    key={o.almoxId}
                    type="button"
                    onClick={() => setAlmoxId(o.almoxId)}
                    aria-pressed={almoxId === o.almoxId}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      almoxId === o.almoxId
                        ? 'border-brand-400 bg-brand-500/10 font-semibold text-tinta-900 ring-1 ring-brand-300'
                        : 'border-tinta-200 text-tinta-600'
                    }`}
                  >
                    {o.almoxarifado} · <span className="num">{quantidade(o.saldo)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="rotulo" htmlFor="saida-qtd">
                Quantidade{unidade && <span className="text-tinta-400"> ({item.unidade})</span>}
              </label>
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => somar(-1)}
                  className="btn btn-neutro h-12 w-12 shrink-0 !text-2xl font-bold"
                  aria-label="Menos um"
                >
                  −
                </button>
                <input
                  id="saida-qtd"
                  value={qtd}
                  onChange={(e) => setQtd(e.target.value)}
                  inputMode="decimal"
                  className="campo num h-12 min-w-0 flex-1 text-center text-lg"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => somar(1)}
                  className="btn btn-neutro h-12 w-12 shrink-0 !text-2xl font-bold"
                  aria-label="Mais um"
                >
                  +
                </button>
              </div>
              {passou && (
                <p className="ajuda text-rose-600">
                  {origem!.almoxarifado} só tem {quantidade(origem!.saldo)}
                  {unidade}.
                </p>
              )}
            </div>

            <div>
              <label className="rotulo" htmlFor="saida-destino">
                Pra onde vai
              </label>
              <input
                id="saida-destino"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="campo"
                placeholder="Obra, cliente, POP…"
                list="saida-destinos"
                autoComplete="off"
              />
              <datalist id="saida-destinos">
                {dados?.destinos.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>

            <div>
              <label className="rotulo" htmlFor="saida-quem">
                Quem pegou
              </label>
              <input
                id="saida-quem"
                value={quemPegou}
                onChange={(e) => setQuemPegou(e.target.value)}
                className="campo"
                placeholder="Nome de quem levou"
                list="saida-pessoas"
                autoComplete="off"
              />
              <datalist id="saida-pessoas">
                {dados?.pessoas.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>

            <div>
              <label className="rotulo" htmlFor="saida-obs">
                Observação <span className="font-normal text-tinta-400">(opcional)</span>
              </label>
              <textarea
                id="saida-obs"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                rows={2}
                className="campo"
              />
            </div>

            {darSaida.isError && <Aviso tom="erro">{mensagemErro(darSaida.error)}</Aviso>}
            {feito && !darSaida.isPending && <Aviso tom="pago">{feito}</Aviso>}

            <button
              type="button"
              onClick={() => {
                setFeito(null);
                darSaida.mutate();
              }}
              disabled={!pode || darSaida.isPending}
              className="btn btn-acao h-12 w-full text-base"
            >
              {darSaida.isPending
                ? 'Lançando no IXC…'
                : `Dar saída${n > 0 ? ` de ${quantidade(n)}${unidade}` : ''}`}
            </button>
            <p className="-mt-2 text-center text-[11px] text-tinta-400">
              Data: hoje, {new Date().toLocaleDateString('pt-BR')}
            </p>
          </div>
        )}

        <div className="mt-6 border-t border-tinta-100 pt-4">
          <p className="rotulo">Saídas deste produto</p>
          {historico.isLoading && <Carregando />}
          {historico.isError && <Aviso tom="erro">{mensagemErro(historico.error)}</Aviso>}
          {dados && dados.saidas.length === 0 && (
            <p className="text-sm text-tinta-400">Nenhuma saída ainda.</p>
          )}
          {dados && dados.saidas.length > 0 && (
            <ul className="space-y-2">
              {dados.saidas.map((s) => (
                <li key={s.id} className="rounded-xl bg-tinta-50 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium text-tinta-800">{s.destino}</span>
                    <span className="valor shrink-0 text-rose-700 dark:text-rose-300">
                      −{quantidade(s.quantidade)}
                      {s.unidade ? ` ${s.unidade}` : ''}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-tinta-500">
                    <span className="num">{formatData(s.data)}</span> · pegou{' '}
                    <strong className="text-tinta-700">{s.quemPegou}</strong> · de {s.almoxarifado}
                  </div>
                  {s.observacao && (
                    <div className="mt-0.5 text-xs text-tinta-500">{s.observacao}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Janela>
  );
}
