import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import type { AlmoxarifadoCadastro, EstoqueNaTela } from '../../lib/types';
import { Usuarios } from './Almoxarifados';
import { quantidade } from './ProdutoNoIxc';

/**
 * A tela de um almoxarifado: de quem é, e o que tem dentro.
 *
 * Abre pela linha da lista em Almoxarifados. É o mesmo saldo da tela Estoque,
 * recortado a este almoxarifado — de propósito na mesma chave de cache dela:
 * quem vem de lá não faz o servidor ler o IXC de novo. Zero não aparece (o
 * produto está no cadastro, não na prateleira); negativo aparece, porque é o
 * que precisa de acerto.
 */
export function AlmoxarifadoDetalhe() {
  const { id: idDaRota = '' } = useParams();
  const id = Number(idDaRota);
  const navegar = useNavigate();
  const local = useLocation();
  const [busca, setBusca] = useState('');

  /* Veio pela lista: voltar desfaz essa entrada no histórico. Aberto por link,
     não há lista atrás — vai para ela. */
  const voltar = () =>
    (local.state as { daLista?: boolean } | null)?.daLista
      ? navegar(-1)
      : navegar('/almoxarifado/almoxarifados', { replace: true });

  const cadastros = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados'],
    queryFn: async () =>
      (await api.get<AlmoxarifadoCadastro[]>('/almoxarifado/almoxarifados')).data,
  });
  const conteudo = useQuery({
    queryKey: ['almoxarifado', 'estoque', String(id)],
    queryFn: async () =>
      (await api.get<EstoqueNaTela>('/almoxarifado/estoque', { params: { almox: id } })).data,
    staleTime: 60_000,
    enabled: Number.isInteger(id) && id > 0,
  });

  const almox = cadastros.data?.find((a) => a.id === id);

  /* Dentro do almoxarifado só cabe material da prateleira. Inativo no IXC fica
     de fora — foi inativado justamente para sair da frente, e a tela Estoque
     também o esconde por padrão. Serviço idem: o IXC não soma entrada dele, o
     negativo não é falta de nada, e "Ativação de Fibra" não é coisa que se
     guarde em prateleira. */
  const itens = (conteudo.data?.itens ?? [])
    .filter((i) => i.ativo && !i.servico && i.saldos.some((s) => s.saldo !== 0))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  const termo = semAcento(busca.trim());
  const mostrados = termo ? itens.filter((i) => combina([i.descricao, i.produtoId], termo)) : itens;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo={almox?.descricao ?? 'Almoxarifado'}
        voltar={voltar}
      />

      {cadastros.isLoading && <Carregando texto="Lendo do IXC…" />}
      {cadastros.isError && (
        <Vazio titulo="Não deu para ler o almoxarifado">{mensagemErro(cadastros.error)}</Vazio>
      )}
      {cadastros.data && !almox && (
        <Vazio titulo="Esse almoxarifado não existe">
          Pode ter sido apagado no IXC. Volte para a lista.
        </Vazio>
      )}

      {almox && (
        <div className="space-y-4">
          <Bloco>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
              <Fato rotulo="Técnico / usuários">
                <Usuarios usuarios={almox.usuarios} />
              </Fato>
              <Fato rotulo="Filial">{almox.liberado ? (almox.filial ?? '—') : '—'}</Fato>
              <Fato rotulo="Situação">
                <div className="flex flex-wrap gap-1.5">
                  {almox.ativo && almox.liberado ? (
                    <span className="text-[13px] text-tinta-700">Ativo</span>
                  ) : (
                    <>
                      {!almox.ativo && <Selo>inativo</Selo>}
                      {!almox.liberado && (
                        <Selo tom="atencao" titulo="O sistema não está ligado a ele no IXC">
                          não liberado
                        </Selo>
                      )}
                    </>
                  )}
                </div>
              </Fato>
              <Fato rotulo="Código">
                <span className="num">{almox.id}</span>
              </Fato>
            </dl>
          </Bloco>

          <Bloco
            titulo={
              termo
                ? `${mostrados.length} de ${itens.length} ${itens.length === 1 ? 'produto' : 'produtos'}`
                : `${itens.length} ${itens.length === 1 ? 'produto dentro' : 'produtos dentro'}`
            }
          >
            {conteudo.isLoading && <Carregando texto="Lendo o que tem dentro…" />}
            {conteudo.isError && (
              <p className="py-3 text-[13px] text-rose-700">{mensagemErro(conteudo.error)}</p>
            )}

            {conteudo.data && itens.length === 0 && (
              <Vazio titulo="Almoxarifado vazio">Nenhum produto ativo com saldo no IXC.</Vazio>
            )}

            {itens.length > 0 && (
              <>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar produto por nome ou código…"
                  className="campo mb-3"
                  autoComplete="off"
                  aria-label="Buscar produto"
                />
                {mostrados.length === 0 ? (
                  <Vazio titulo="Nenhum produto com esse nome" />
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {mostrados.map((i) => {
                      const saldo = i.saldos.reduce((s, x) => s + x.saldo, 0);
                      const cartao = (
                        <>
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold text-tinta-900">
                              {i.descricao}
                            </div>
                            <div className="num mt-0.5 text-[11px] text-tinta-400">
                              código {i.produtoId}
                            </div>
                          </div>
                          <div className="shrink-0 whitespace-nowrap text-right">
                            <span
                              className={`valor text-[20px] ${
                                saldo < 0 ? 'text-rose-600 dark:text-rose-300' : ''
                              }`}
                            >
                              {quantidade(saldo)}
                            </span>
                            {i.unidade && (
                              <span className="ml-1 text-[11px] text-tinta-400">{i.unidade}</span>
                            )}
                            {i.tipo === 'P' && (
                              <span aria-hidden className="ml-2 text-tinta-400">
                                ›
                              </span>
                            )}
                          </div>
                        </>
                      );
                      const caixa = `cartao-item flex items-start justify-between gap-3 p-3 ${
                        saldo < 0 ? 'border-l-rose-500' : ''
                      }`;
                      // Patrimônio abre os equipamentos dele — tombo, série e MAC de cada um.
                      return i.tipo === 'P' ? (
                        <Link
                          key={i.produtoId}
                          to={`/almoxarifado/almoxarifados/${id}/produtos/${i.produtoId}`}
                          state={{ daLista: true }}
                          className={`${caixa} transition hover:bg-brand-500/5`}
                        >
                          {cartao}
                        </Link>
                      ) : (
                        <div key={i.produtoId} className={caixa}>
                          {cartao}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </Bloco>
        </div>
      )}
    </Pagina>
  );
}

export function Fato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-tinta-400">
        {rotulo}
      </dt>
      <dd className="text-[13px] text-tinta-700">{children}</dd>
    </div>
  );
}
