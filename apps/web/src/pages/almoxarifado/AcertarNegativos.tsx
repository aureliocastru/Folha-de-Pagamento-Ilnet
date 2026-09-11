import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import type {
  AndamentoDoAcerto,
  NegativoParaAcertar,
  NegativosNaTela,
  OpcoesDoEstoque,
} from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';
import { OndeFicouNegativo } from './rastreio';

interface FornecedorIxc {
  idFornecedor: number;
  nome: string;
}

/** O fornecedor das compras de acerto: o que não gera financeiro. */
const FORNECEDOR_DO_ACERTO = 'fornecedor avulso';

/**
 * Zerar os saldos negativos de uma vez — uma compra de acerto no IXC, com um
 * item por produto × almoxarifado, na quantidade exata que zera.
 *
 * Cada linha diz em qual movimento o saldo ficou negativo ("por quê?"): se foi
 * uma transferência que saiu do almoxarifado errado, o certo é desfazer lá, e
 * a linha se desmarca. Patrimônio vem desmarcado: a entrada dele faz o IXC
 * criar uma peça sem MAC.
 */
export function AcertarNegativos({ onFechar }: { onFechar: () => void }) {
  const qc = useQueryClient();
  const negativos = useQuery({
    queryKey: ['almoxarifado', 'negativos'],
    queryFn: async () => (await api.get<NegativosNaTela>('/almoxarifado/negativos')).data,
    staleTime: 0,
  });
  const opcoes = useQuery({
    queryKey: ['almoxarifado', 'opcoes'],
    queryFn: async () =>
      (await api.get<OpcoesDoEstoque>('/almoxarifado/produtos/opcoes')).data,
    staleTime: 5 * 60_000,
  });
  const avulso = useQuery({
    queryKey: ['almoxarifado', 'fornecedores', 'avulso'],
    queryFn: async () =>
      (
        await api.get<FornecedorIxc[]>('/almoxarifado/fornecedores', {
          params: { busca: 'avulso' },
        })
      ).data,
    staleTime: 5 * 60_000,
  });

  const [desmarcados, setDesmarcados] = useState<Set<string> | null>(null);
  const [tipoDocumentoId, setTipoDocumentoId] = useState('');
  const [condicaoPagamentoId, setCondicaoPagamentoId] = useState('');
  const [valor, setValor] = useState<'preco' | 'centavo'>('preco');
  const [aberto, setAberto] = useState<string | null>(null);
  const [acertoId, setAcertoId] = useState<string | null>(null);

  const itens = useMemo(() => negativos.data?.itens ?? [], [negativos.data]);
  // Patrimônio começa desmarcado: a entrada dele cria uma peça sem MAC no IXC.
  const fora = desmarcados ?? new Set(itens.filter((i) => i.tipoProduto === 'P').map((i) => i.chave));
  const marcados = itens.filter((i) => !fora.has(i.chave));
  const fornecedor = avulso.data?.find((f) => f.nome.trim().toLowerCase() === FORNECEDOR_DO_ACERTO);

  /*
   * O modelo: a última compra desse fornecedor, feita na tela do IXC. O tipo
   * de documento que ela usa (203) nem aparece na lista de tipos que a API
   * devolve — e com um tipo da lista o IXC recusou abrir a compra.
   */
  const modelo = useQuery({
    queryKey: ['almoxarifado', 'entradas', 'ultima', fornecedor?.idFornecedor],
    queryFn: async () =>
      (
        await api.get<{
          entradaId: number;
          tipoDocumentoId: number;
          condicaoPagamentoId: number;
        } | null>('/almoxarifado/entradas/ultima', {
          params: { fornecedor: fornecedor!.idFornecedor },
        })
      ).data,
    enabled: !!fornecedor,
    staleTime: 5 * 60_000,
  });

  // O tipo de documento e a condição da última compra do fornecedor.
  useEffect(() => {
    const m = modelo.data;
    if (!m) return;
    if (!tipoDocumentoId && m.tipoDocumentoId > 0) setTipoDocumentoId(String(m.tipoDocumentoId));
    if (!condicaoPagamentoId && m.condicaoPagamentoId > 0) {
      setCondicaoPagamentoId(String(m.condicaoPagamentoId));
    }
  }, [modelo.data, tipoDocumentoId, condicaoPagamentoId]);
  const tipoDoModeloForaDaLista =
    !!modelo.data &&
    !opcoes.data?.tiposDeDocumento.some((t) => t.id === modelo.data!.tipoDocumentoId);

  const porAlmox = useMemo(() => {
    const m = new Map<string, NegativoParaAcertar[]>();
    for (const i of itens) m.set(i.almoxarifado, [...(m.get(i.almoxarifado) ?? []), i]);
    return [...m.entries()];
  }, [itens]);

  const unitario = (i: NegativoParaAcertar) =>
    valor === 'centavo' ? 0.01 : i.precoBase > 0 ? i.precoBase : 0.01;
  const total = marcados.reduce((s, i) => s + i.quantidade * unitario(i), 0);

  function alternar(chave: string) {
    const n = new Set(fora);
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    setDesmarcados(n);
  }

  const lancar = useMutation({
    mutationFn: async () =>
      (
        await api.post<AndamentoDoAcerto>('/almoxarifado/negativos/acertar', {
          fornecedorId: fornecedor!.idFornecedor,
          tipoDocumentoId: Number(tipoDocumentoId),
          condicaoPagamentoId: Number(condicaoPagamentoId),
          valor,
          chaves: marcados.map((i) => i.chave),
        })
      ).data,
    onSuccess: (a) => setAcertoId(a.id),
  });

  const andamento = useQuery({
    queryKey: ['almoxarifado', 'acerto', acertoId],
    queryFn: async () =>
      (await api.get<AndamentoDoAcerto>(`/almoxarifado/negativos/acertos/${acertoId}`)).data,
    enabled: !!acertoId,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === 'rodando' ? 1500 : false),
    refetchIntervalInBackground: true,
  });
  const a = andamento.data ?? lancar.data;
  const avisado = useRef(false);
  useEffect(() => {
    if (a && a.status !== 'rodando' && !avisado.current) {
      avisado.current = true;
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
      void qc.invalidateQueries({ queryKey: ['almoxarifado', 'negativos'] });
    }
  }, [a, qc]);

  const pronto =
    !!fornecedor && !!tipoDocumentoId && !!condicaoPagamentoId && marcados.length > 0;

  return (
    <Janela titulo="Acertar saldos negativos" onFechar={onFechar}>
      {!acertoId && (
        <>
          <p className="mb-3 text-[13px] leading-relaxed text-tinta-500">
            Uma <strong>compra de acerto</strong> no IXC, com a quantidade exata que zera cada
            negativo. Antes, veja o <strong>por quê</strong> de cada um: se foi uma transferência
            que saiu do almoxarifado errado, o certo é desfazer a transferência — desmarque a
            linha.
          </p>

          {fornecedor && <ComprasAbertas fornecedorId={fornecedor.idFornecedor} />}

          {negativos.isLoading && <Carregando texto="Lendo os negativos no IXC…" />}
          {negativos.isError && <Aviso tom="erro">{mensagemErro(negativos.error)}</Aviso>}
          {negativos.data && itens.length === 0 && (
            <Aviso tom="pago">Nenhum saldo negativo para acertar.</Aviso>
          )}

          {porAlmox.length > 0 && (
            <div className="mb-3 max-h-[26rem] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
              {porAlmox.map(([almox, lista]) => (
                <div key={almox}>
                  <div className="sticky top-0 z-[1] bg-tinta-50 px-3 py-1.5 text-[12px] font-semibold text-tinta-600 dark:bg-tinta-100">
                    {almox}
                    {!lista[0].almoxAtivo && ' (inativo)'} · {lista.length}
                  </div>
                  {lista.map((i) => (
                    <div key={i.chave} className="border-b border-tinta-100 px-3 py-1.5 last:border-b-0">
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="marcador"
                          checked={!fora.has(i.chave)}
                          onChange={() => alternar(i.chave)}
                        />
                        <span className="min-w-0 flex-1 truncate text-tinta-800" title={i.descricao}>
                          {i.descricao}
                          {i.tipoProduto === 'P' && (
                            <span
                              className="ml-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                              title="A entrada de patrimônio faz o IXC criar uma peça sem MAC"
                            >
                              patrimônio
                            </span>
                          )}
                        </span>
                        <span className="num whitespace-nowrap text-[12px] text-tinta-500">
                          {quantidade(i.saldo)} → +{quantidade(i.quantidade)} {i.unidadeSigla}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAberto(aberto === i.chave ? null : i.chave)}
                          className="text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        >
                          por quê?
                        </button>
                      </label>
                      {aberto === i.chave && (
                        <div className="mt-1 pl-6">
                          <OndeFicouNegativo produtoId={i.produtoId} almoxId={i.almoxId} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {negativos.data && negativos.data.deFora.length > 0 && (
            <details className="mb-3">
              <summary className="cursor-pointer text-sm font-semibold text-tinta-700">
                Ficam fora do acerto ({negativos.data.deFora.length})
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
                {negativos.data.deFora.map((d) => (
                  <div
                    key={d.chave}
                    className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-1.5 text-[13px] last:border-b-0"
                  >
                    <span className="min-w-0 truncate text-tinta-800">
                      {d.descricao} · {d.almoxarifado} ({quantidade(d.saldo)})
                    </span>
                    <span className="max-w-[55%] text-right text-[12px] text-tinta-500">
                      {d.motivo}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {itens.length > 0 && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <span className="rotulo">Fornecedor</span>
                  <p className="campo bg-tinta-50 text-tinta-700">
                    {avulso.isLoading
                      ? 'Procurando no IXC…'
                      : fornecedor
                        ? `${fornecedor.nome} (${fornecedor.idFornecedor})`
                        : 'Não achei o "Fornecedor Avulso" no IXC'}
                  </p>
                </div>
                <div>
                  <span className="rotulo">Valor de cada unidade</span>
                  <div className="flex gap-3 pt-2 text-[13px]">
                    <label className="opcao">
                      <input
                        type="radio"
                        checked={valor === 'preco'}
                        onChange={() => setValor('preco')}
                      />
                      preço base do cadastro
                    </label>
                    <label className="opcao">
                      <input
                        type="radio"
                        checked={valor === 'centavo'}
                        onChange={() => setValor('centavo')}
                      />
                      R$ 0,01
                    </label>
                  </div>
                </div>
                <div>
                  <label className="rotulo" htmlFor="acerto-tipo">
                    Tipo de documento
                  </label>
                  <select
                    id="acerto-tipo"
                    value={tipoDocumentoId}
                    onChange={(e) => setTipoDocumentoId(e.target.value)}
                    className="campo"
                  >
                    <option value="">Escolha…</option>
                    {modelo.data && tipoDoModeloForaDaLista && (
                      <option value={modelo.data.tipoDocumentoId}>
                        {modelo.data.tipoDocumentoId} — o da compra #{modelo.data.entradaId}
                      </option>
                    )}
                    {opcoes.data?.tiposDeDocumento.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} — {t.nome}
                      </option>
                    ))}
                  </select>
                  {modelo.data && (
                    <p className="ajuda">
                      Tipo e condição copiados da última compra do {fornecedor?.nome} no IXC
                      (#{modelo.data.entradaId}), que o IXC aceitou.
                    </p>
                  )}
                </div>
                <div>
                  <label className="rotulo" htmlFor="acerto-condicao">
                    Condição de pagamento
                  </label>
                  <select
                    id="acerto-condicao"
                    value={condicaoPagamentoId}
                    onChange={(e) => setCondicaoPagamentoId(e.target.value)}
                    className="campo"
                  >
                    <option value="">Escolha…</option>
                    {opcoes.data?.condicoesDePagamento.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {lancar.isError && <Aviso tom="erro">{mensagemErro(lancar.error)}</Aviso>}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2 text-[12px]">
                  <button
                    type="button"
                    className="btn btn-p btn-sutil"
                    onClick={() => setDesmarcados(new Set())}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="btn btn-p btn-sutil"
                    onClick={() => setDesmarcados(new Set(itens.map((i) => i.chave)))}
                  >
                    Desmarcar todos
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!pronto || lancar.isPending}
                  onClick={() => {
                    if (
                      confirm(
                        `Lançar no IXC uma compra de acerto com ${marcados.length} ` +
                          `${marcados.length === 1 ? 'item' : 'itens'} (total ${formatBRL(total)}), ` +
                          `de ${fornecedor?.nome}? Cada saldo marcado vai a zero.`,
                      )
                    ) {
                      lancar.mutate();
                    }
                  }}
                  className="btn btn-primario"
                >
                  {lancar.isPending
                    ? 'Abrindo a compra de acerto…'
                    : `Acertar ${marcados.length} ${marcados.length === 1 ? 'item' : 'itens'}`}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {acertoId && a && <Resultado a={a} erro={andamento.error} onFechar={onFechar} />}
    </Janela>
  );
}

interface CompraAberta {
  entradaId: number;
  data: string;
  itens: number;
  valorTotal: number;
}

interface Desfazimento {
  id: string;
  entradaId: number;
  status: 'rodando' | 'terminou' | 'falhou';
  total: number;
  feitos: number;
  falharam: Array<{ descricao: string; motivo: string }>;
  erro: string | null;
}

/**
 * As compras de acerto ainda abertas no IXC, com o botão de desfazer. Aberta,
 * a compra não gerou custo nem financeiro: apagar e refazer é o jeito limpo de
 * consertar uma que saiu errada (as de 11/09/2026 foram com o valor unitário
 * cem vezes maior).
 */
function ComprasAbertas({ fornecedorId }: { fornecedorId: number }) {
  const qc = useQueryClient();
  const abertas = useQuery({
    queryKey: ['almoxarifado', 'entradas', 'abertas', fornecedorId],
    queryFn: async () =>
      (
        await api.get<CompraAberta[]>('/almoxarifado/entradas/abertas', {
          params: { fornecedor: fornecedorId },
        })
      ).data,
  });
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const iniciar = useMutation({
    mutationFn: async (entradaId: number) =>
      (await api.post<Desfazimento>(`/almoxarifado/negativos/desfazer/${entradaId}`)).data,
    onSuccess: (d) => setDesfazendo(d.id),
  });
  const andamento = useQuery({
    queryKey: ['almoxarifado', 'desfazimento', desfazendo],
    queryFn: async () =>
      (await api.get<Desfazimento>(`/almoxarifado/negativos/desfazimentos/${desfazendo}`)).data,
    enabled: !!desfazendo,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === 'rodando' ? 1500 : false),
  });
  const d = andamento.data ?? iniciar.data;
  const terminou = d && d.status !== 'rodando';
  useEffect(() => {
    if (!terminou) return;
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'entradas', 'abertas'] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'negativos'] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
  }, [terminou, qc]);

  if (!abertas.data || abertas.data.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-tinta-200 p-3">
      <p className="mb-2 text-[13px] text-tinta-600">
        <strong>Compras de acerto abertas no IXC.</strong> O saldo já conta com elas. Se uma
        saiu errada, desfaça — os negativos voltam, e o acerto se refaz abaixo.
      </p>
      {abertas.data.map((c) => (
        <div key={c.entradaId} className="flex items-center justify-between gap-2 py-1 text-[13px]">
          <span className="text-tinta-800">
            #{c.entradaId} · {c.itens} {c.itens === 1 ? 'item' : 'itens'} ·{' '}
            {formatBRL(c.valorTotal)}
          </span>
          <button
            type="button"
            className="btn btn-p btn-neutro"
            disabled={!!d && d.status === 'rodando'}
            onClick={() => {
              if (
                confirm(
                  `Desfazer a compra de acerto #${c.entradaId} no IXC? Os ${c.itens} itens e a ` +
                    'compra são apagados, e os saldos voltam ao que eram antes dela.',
                )
              ) {
                iniciar.mutate(c.entradaId);
              }
            }}
          >
            {d?.entradaId === c.entradaId && d.status === 'rodando'
              ? `Desfazendo… ${d.feitos}/${d.total}`
              : 'Desfazer'}
          </button>
        </div>
      ))}
      {iniciar.isError && <Aviso tom="erro">{mensagemErro(iniciar.error)}</Aviso>}
      {d && d.status !== 'rodando' && (
        <Aviso tom={d.falharam.length === 0 && !d.erro ? 'pago' : 'atencao'}>
          Compra #{d.entradaId}:{' '}
          {d.falharam.length === 0 && !d.erro
            ? 'desfeita. Os negativos dela voltaram para a lista.'
            : `${d.feitos - d.falharam.length} de ${d.total} itens apagados — o IXC recusou ` +
              `${d.falharam.length}${d.erro ? ` (${d.erro})` : ''}. A compra ficou; confira no IXC.`}
        </Aviso>
      )}
    </div>
  );
}

function Resultado({
  a,
  erro,
  onFechar,
}: {
  a: AndamentoDoAcerto;
  erro: unknown;
  onFechar: () => void;
}) {
  const pct = a.total > 0 ? Math.round((a.feitos / a.total) * 100) : 100;
  return (
    <div>
      <p className="mb-2 text-sm text-tinta-600">
        {a.compras.length > 0
          ? `Compra de acerto ${a.compras.map((c) => `#${c}`).join(', ')} no IXC`
          : a.status === 'rodando'
            ? 'Abrindo a compra de acerto no IXC…'
            : 'A compra de acerto não abriu no IXC'}
      </p>
      <div className="mb-1 h-2 overflow-hidden rounded-full bg-tinta-100">
        <div
          className={`h-full transition-all ${a.status === 'falhou' ? 'bg-rose-500' : 'bg-brand-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mb-4 text-[12px] text-tinta-400">
        {a.status === 'rodando'
          ? `${a.feitos} de ${a.total} — pode fechar, o acerto continua no servidor.`
          : `${a.feitos} de ${a.total}`}
      </p>

      {erro ? <Aviso tom="erro">{mensagemErro(erro)}</Aviso> : null}
      {a.status === 'falhou' && (
        <Aviso tom="erro">
          {a.compras.length === 0 ? `${a.erro}.` : `O acerto parou no meio (${a.erro}).`}
        </Aviso>
      )}

      {a.status === 'terminou' && (
        <Aviso tom={a.falharam.length === 0 && !a.aindaNegativos?.length ? 'pago' : 'atencao'}>
          {a.lancados.length} {a.lancados.length === 1 ? 'item lançado' : 'itens lançados'}.
          {a.zerados !== null && ` Relido o IXC: ${a.zerados} zeraram.`}
          {a.aindaNegativos && a.aindaNegativos.length > 0 &&
            ` ${a.aindaNegativos.length} ainda aparecem negativos — o IXC deve somar só ` +
              'depois de finalizar a compra: finalize-a no IXC (Entradas › Compras).'}
          {a.falharam.length > 0 && ` O IXC recusou ${a.falharam.length} (abaixo).`}
        </Aviso>
      )}

      {a.falharam.length > 0 && (
        <div className="mb-3 max-h-48 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
          {a.falharam.map((f) => (
            <div
              key={f.chave}
              className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-1.5 text-[13px] last:border-b-0"
            >
              <span className="min-w-0 truncate text-tinta-800">
                {f.descricao} · {f.almoxarifado}
              </span>
              <span className="max-w-[55%] text-right text-[12px] text-tinta-500">{f.motivo}</span>
            </div>
          ))}
        </div>
      )}

      {a.status !== 'rodando' && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onFechar} className="btn btn-primario">
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
