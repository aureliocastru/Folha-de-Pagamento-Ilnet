import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import type { AlmoxarifadoCadastro, EstoqueNaTela, PecaDoProduto } from '../../lib/types';
import { Fato } from './AlmoxarifadoDetalhe';
import { quantidade } from './ProdutoNoIxc';

/**
 * Os equipamentos de um produto de patrimônio num almoxarifado — cada peça com
 * o tombo, o número de série e o MAC, como o IXC os tem.
 *
 * Abre pelo cartão do produto na tela do almoxarifado. O nome e o saldo do
 * produto vêm da mesma leitura de estoque dessa tela (mesma chave de cache),
 * então quem vem de lá não faz o servidor ler o IXC de novo; só as peças são
 * lidas aqui, e lidas agora.
 */
export function PecasDoProduto() {
  const { id: idDaRota = '', produtoId: produtoDaRota = '' } = useParams();
  const almoxId = Number(idDaRota);
  const produtoId = Number(produtoDaRota);
  const navegar = useNavigate();
  const local = useLocation();
  const [busca, setBusca] = useState('');

  /* Veio do almoxarifado: voltar desfaz essa entrada no histórico. Aberto por
     link, não há tela atrás — vai para o almoxarifado. */
  const voltar = () =>
    (local.state as { daLista?: boolean } | null)?.daLista
      ? navegar(-1)
      : navegar(`/almoxarifado/almoxarifados/${almoxId}`, { replace: true });

  const valido = Number.isInteger(almoxId) && almoxId > 0 && Number.isInteger(produtoId) && produtoId > 0;
  const cadastros = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados'],
    queryFn: async () =>
      (await api.get<AlmoxarifadoCadastro[]>('/almoxarifado/almoxarifados')).data,
  });
  const estoque = useQuery({
    queryKey: ['almoxarifado', 'estoque', String(almoxId)],
    queryFn: async () =>
      (await api.get<EstoqueNaTela>('/almoxarifado/estoque', { params: { almox: almoxId } })).data,
    staleTime: 60_000,
    enabled: valido,
  });
  const pecas = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados', String(almoxId), 'pecas', String(produtoId)],
    queryFn: async () =>
      (
        await api.get<PecaDoProduto[]>(
          `/almoxarifado/almoxarifados/${almoxId}/produtos/${produtoId}/pecas`,
        )
      ).data,
    enabled: valido,
  });

  const almox = cadastros.data?.find((a) => a.id === almoxId);
  const produto = estoque.data?.itens.find((i) => i.produtoId === produtoId);
  const saldo = produto?.saldos.reduce((s, x) => s + x.saldo, 0);

  // Pelo tombo (como número: 2 vem antes de 10); sem tombo, no fim.
  const todas = [...(pecas.data ?? [])].sort((a, b) =>
    a.numeroPatrimonial && b.numeroPatrimonial
      ? a.numeroPatrimonial.localeCompare(b.numeroPatrimonial, 'pt-BR', { numeric: true })
      : a.numeroPatrimonial
        ? -1
        : b.numeroPatrimonial
          ? 1
          : a.patrimonioId - b.patrimonioId,
  );
  // O MAC acha com ou sem os dois-pontos: é assim que o leitor o bipa.
  const termo = semAcento(busca.trim());
  const mostradas = termo
    ? todas.filter((p) => combina([p.numeroPatrimonial, p.numeroSerie, p.mac], termo))
    : todas;

  return (
    <Pagina>
      <CabecalhoPagina
        secao={almox?.descricao ?? 'Almoxarifado'}
        titulo={produto?.descricao ?? 'Equipamentos'}
        voltar={voltar}
      />

      <div className="space-y-4">
        <Bloco>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Fato rotulo="Almoxarifado">{almox?.descricao ?? '—'}</Fato>
            <Fato rotulo="Saldo no IXC">
              {saldo === undefined ? (
                '—'
              ) : (
                <>
                  <span className="valor text-[15px]">{quantidade(saldo)}</span>
                  {produto?.unidade && (
                    <span className="ml-1 text-[11px] text-tinta-400">{produto.unidade}</span>
                  )}
                </>
              )}
            </Fato>
            <Fato rotulo="Código">
              <span className="num">{produtoId}</span>
            </Fato>
          </dl>
        </Bloco>

        <Bloco
          titulo={
            termo
              ? `${mostradas.length} de ${todas.length} ${todas.length === 1 ? 'equipamento' : 'equipamentos'}`
              : `${todas.length} ${todas.length === 1 ? 'equipamento' : 'equipamentos'}`
          }
        >
          {pecas.isLoading && <Carregando texto="Lendo os equipamentos no IXC…" />}
          {pecas.isError && (
            <Vazio titulo="Não deu para ler os equipamentos">{mensagemErro(pecas.error)}</Vazio>
          )}
          {pecas.data && todas.length === 0 && (
            <Vazio titulo="Nenhum equipamento cadastrado aqui">
              O IXC não tem peça deste produto neste almoxarifado.
            </Vazio>
          )}

          {todas.length > 0 && (
            <>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por tombo, série ou MAC…"
                className="campo mb-3"
                autoComplete="off"
                aria-label="Buscar equipamento"
              />
              {mostradas.length === 0 ? (
                <Vazio titulo="Nenhum equipamento com esse número" />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {mostradas.map((p) => (
                    <div
                      key={p.patrimonioId}
                      className="rounded-xl border border-tinta-200 bg-white p-3 dark:bg-tinta-50"
                    >
                      <dl className="space-y-2">
                        <Fato rotulo="Tombo">
                          <span className="num text-[15px] font-semibold text-tinta-800">
                            {p.numeroPatrimonial ?? '—'}
                          </span>
                        </Fato>
                        <Fato rotulo="Número de série">
                          <span className="num break-all">{p.numeroSerie ?? '—'}</span>
                        </Fato>
                        <Fato rotulo="MAC">
                          <span className="num break-all">{p.mac ?? '—'}</span>
                        </Fato>
                      </dl>
                      {!p.naPrateleira && (
                        <div className="mt-2">
                          <Selo tom="atencao" pequeno>
                            {p.situacao}
                          </Selo>
                        </div>
                      )}
                    </div>
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
