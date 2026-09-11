import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Aviso, Carregando, Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type {
  AlmoxarifadoCadastro,
  AndamentoDaMudanca,
  ConteudoDoAlmoxarifado,
} from '../../lib/types';
import { quantidade } from './ProdutoNoIxc';

/**
 * Mover tudo o que um almoxarifado tem para outro — para arrumar o estoque de
 * uma vez, e não produto a produto.
 *
 * Três momentos na mesma janela: **conferir** (o que vai e o que fica, lido
 * agora do IXC), **acompanhar** (a mudança roda no servidor, item a item) e o
 * **resultado** (o que foi, o que o IXC recusou e o que ainda sobrou lá).
 */
export function MoverTudo({
  origem,
  almoxarifados,
  onFechar,
  onMudou,
}: {
  origem: AlmoxarifadoCadastro;
  /** Todos — o destino sai dos liberados e ativos. */
  almoxarifados: AlmoxarifadoCadastro[];
  onFechar: () => void;
  /** O saldo mudou no IXC: quem mostra estoque tem de reler. */
  onMudou: () => void;
}) {
  const [para, setPara] = useState('');
  const [observacao, setObservacao] = useState('');
  const [mudancaId, setMudancaId] = useState<string | null>(null);

  const conteudo = useQuery({
    queryKey: ['almoxarifado', 'conteudo', origem.id],
    queryFn: async () =>
      (
        await api.get<ConteudoDoAlmoxarifado>(
          `/almoxarifado/almoxarifados/${origem.id}/conteudo`,
        )
      ).data,
    staleTime: 0,
    enabled: !mudancaId,
  });

  const iniciar = useMutation({
    mutationFn: async () =>
      (
        await api.post<AndamentoDaMudanca>(
          `/almoxarifado/almoxarifados/${origem.id}/mover-tudo`,
          { para: Number(para), observacao: observacao.trim() || undefined },
        )
      ).data,
    onSuccess: (a) => setMudancaId(a.id),
  });

  const andamento = useQuery({
    queryKey: ['almoxarifado', 'mudanca', mudancaId],
    queryFn: async () =>
      (await api.get<AndamentoDaMudanca>(`/almoxarifado/almoxarifados/mudancas/${mudancaId}`))
        .data,
    enabled: !!mudancaId,
    refetchInterval: (q) => (q.state.data?.status === 'rodando' || !q.state.data ? 1500 : false),
  });

  // Terminou (bem ou mal): o saldo mudou no IXC, uma vez só.
  const avisado = useRef(false);
  const status = andamento.data?.status;
  useEffect(() => {
    if (status && status !== 'rodando' && !avisado.current) {
      avisado.current = true;
      onMudou();
    }
  }, [status, onMudou]);

  const destinos = almoxarifados.filter((a) => a.liberado && a.ativo && a.id !== origem.id);
  const nomeDoDestino = destinos.find((a) => String(a.id) === para)?.descricao ?? '';
  const c = conteudo.data;
  const a = andamento.data ?? iniciar.data;

  return (
    <Janela titulo={`Mover tudo de ${origem.descricao}`} onFechar={onFechar}>
      {!mudancaId && (
        <>
          {conteudo.isLoading && <Carregando texto="Lendo no IXC o que tem nele…" />}
          {conteudo.isError && <Aviso tom="erro">{mensagemErro(conteudo.error)}</Aviso>}

          {c && c.moviveis.length === 0 && (
            <Aviso tom="info">
              {c.deFora.length > 0
                ? `Não tem nada que vá numa transferência de produto — só ${c.deFora.length} item(ns) que ficam de fora (abaixo).`
                : 'Este almoxarifado está vazio no IXC.'}
            </Aviso>
          )}

          {c && c.moviveis.length > 0 && (
            <>
              <p className="mb-2 text-sm text-tinta-600">
                Vão <strong>{c.moviveis.length}</strong>{' '}
                {c.moviveis.length === 1 ? 'produto' : 'produtos'}, cada um com tudo o que tem
                aqui, numa transferência só no IXC.
              </p>
              <ListaDeItens
                itens={c.moviveis.map((i) => ({
                  chave: i.produtoId,
                  nome: i.descricao,
                  detalhe: `${quantidade(i.saldo)} ${i.unidadeSigla}`,
                }))}
              />
            </>
          )}

          {c && c.deFora.length > 0 && <FicamDeFora itens={c.deFora} />}

          {c && c.moviveis.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="rotulo" htmlFor="mover-tudo-para">
                  Vai para
                </label>
                <select
                  id="mover-tudo-para"
                  value={para}
                  onChange={(e) => setPara(e.target.value)}
                  className="campo"
                >
                  <option value="">Escolha…</option>
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.descricao}
                    </option>
                  ))}
                </select>
                <p className="ajuda">
                  Só aparecem os ativos e liberados para o sistema.
                </p>
              </div>
              <div>
                <label className="rotulo" htmlFor="mover-tudo-obs">
                  Observação (vai para o IXC)
                </label>
                <input
                  id="mover-tudo-obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value.slice(0, 200))}
                  className="campo"
                  placeholder="Ex.: organização do estoque"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {iniciar.isError && <Aviso tom="erro">{mensagemErro(iniciar.error)}</Aviso>}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onFechar} className="btn btn-neutro">
              Cancelar
            </button>
            {c && c.moviveis.length > 0 && (
              <button
                type="button"
                disabled={!para || iniciar.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Mover ${c.moviveis.length} produtos de "${origem.descricao}" para ` +
                        `"${nomeDoDestino}" no IXC?\n\nCada um vai com a quantidade inteira. ` +
                        'Para desfazer, só movendo de volta.',
                    )
                  ) {
                    iniciar.mutate();
                  }
                }}
                className="btn btn-primario"
              >
                {iniciar.isPending
                  ? 'Abrindo a transferência…'
                  : `Mover ${c.moviveis.length} ${c.moviveis.length === 1 ? 'produto' : 'produtos'}`}
              </button>
            )}
          </div>
        </>
      )}

      {mudancaId && a && <Andamento a={a} erro={andamento.error} onFechar={onFechar} />}
    </Janela>
  );
}

function Andamento({
  a,
  erro,
  onFechar,
}: {
  a: AndamentoDaMudanca;
  erro: unknown;
  onFechar: () => void;
}) {
  const pct = a.total > 0 ? Math.round((a.feitos / a.total) * 100) : 100;

  return (
    <div>
      <p className="mb-2 text-sm text-tinta-600">
        {a.de.nome} → <strong>{a.para.nome}</strong> · transferência{' '}
        <span className="num">#{a.transferenciaId}</span> no IXC
      </p>

      <div className="mb-1 h-2 overflow-hidden rounded-full bg-tinta-100">
        <div
          className={`h-full transition-all ${
            a.status === 'falhou' ? 'bg-rose-500' : 'bg-brand-600'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mb-4 text-[12px] text-tinta-400">
        {a.status === 'rodando'
          ? `${a.feitos} de ${a.total} — pode fechar a janela, a mudança continua no servidor.`
          : `${a.feitos} de ${a.total}`}
      </p>

      {erro ? <Aviso tom="erro">{mensagemErro(erro)}</Aviso> : null}
      {a.status === 'falhou' && (
        <Aviso tom="erro">
          A mudança parou no meio ({a.erro}). O que foi movido está na transferência #
          {a.transferenciaId} do IXC.
        </Aviso>
      )}

      {a.status === 'terminou' && (
        <Aviso tom={a.falharam.length === 0 ? 'pago' : 'atencao'}>
          {a.movidos.length} {a.movidos.length === 1 ? 'produto movido' : 'produtos movidos'}{' '}
          para {a.para.nome}.
          {a.falharam.length > 0 && ` O IXC recusou ${a.falharam.length} (abaixo).`}
          {a.restouNaOrigem !== null &&
            a.restouNaOrigem > 0 &&
            ` Relido agora, ${a.de.nome} ainda tem ${a.restouNaOrigem} produto(s) — confira a transferência no IXC.`}
          {a.restouNaOrigem === 0 && ` ${a.de.nome} ficou vazio (fora o que não vai por aqui).`}
        </Aviso>
      )}

      {a.falharam.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
            Recusados pelo IXC
          </p>
          <ListaDeItens
            itens={a.falharam.map((f) => ({
              chave: f.produtoId,
              nome: f.descricao,
              detalhe: f.motivo,
            }))}
          />
        </div>
      )}

      {a.status !== 'rodando' && a.deFora.length > 0 && <FicamDeFora itens={a.deFora} />}

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

function FicamDeFora({ itens }: { itens: ConteudoDoAlmoxarifado['deFora'] }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-sm font-semibold text-amber-700 dark:text-amber-300">
        Ficam aqui ({itens.length}) — mova pelo IXC
      </p>
      <ListaDeItens
        itens={itens.map((i) => ({
          chave: i.produtoId,
          nome: i.descricao,
          detalhe: `${quantidade(i.saldo)} ${i.unidade ?? ''} · ${i.motivo}`,
        }))}
      />
    </div>
  );
}

function ListaDeItens({
  itens,
}: {
  itens: Array<{ chave: number; nome: string; detalhe: string }>;
}) {
  return (
    <div className="max-h-60 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
      {itens.map((i) => (
        <div
          key={i.chave}
          className="flex items-baseline justify-between gap-3 border-b border-tinta-100 px-3 py-1.5 text-[13px] last:border-b-0"
        >
          <span className="min-w-0 truncate text-tinta-800" title={i.nome}>
            {i.nome}
          </span>
          <span className="max-w-[55%] text-right text-[12px] text-tinta-500">{i.detalhe}</span>
        </div>
      ))}
    </div>
  );
}
