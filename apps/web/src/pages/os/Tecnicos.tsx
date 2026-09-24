import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import {
  identificacaoDaPeca,
  quantidadeComUnidade,
  type TecnicoNaLista,
  type VanDoTecnico,
} from '../../lib/os';

const ORIGEM: Record<'fixado' | 'padrao' | 'unico', string> = {
  fixado: 'fixado aqui',
  padrao: 'padrão no IXC',
  unico: 'o único ligado no IXC',
};

/**
 * Técnico por técnico: de que almoxarifado do IXC sai o material dele, e o que
 * tem lá dentro agora.
 *
 * O almoxarifado vem do IXC — o usuário ligado ao colaborador, e a ligação
 * marcada como padrão. Quando o IXC não diz um só (dois padrões, nenhum, o
 * usuário sem colaborador), a linha diz o que falta, e dá para fixar um aqui.
 *
 * "Ver a van" é a conferência: os aparelhos na prateleira dele, os que
 * voltaram de cliente e ainda não passaram pela base, e o saldo de cada
 * material — o negativo primeiro, que é material lançado sem ter saído dali.
 */
export function Tecnicos() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState<TecnicoNaLista | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['os', 'tecnicos'],
    queryFn: async () => (await api.get<TecnicoNaLista[]>('/os/tecnicos')).data,
  });
  const almoxarifados = useQuery({
    queryKey: ['os', 'almoxarifados'],
    queryFn: async () => (await api.get<Array<{ id: number; nome: string }>>('/os/almoxarifados')).data,
    staleTime: 5 * 60_000,
  });

  const fixar = useMutation({
    mutationFn: async (p: { funcionarioId: string; almoxId: number | null }) => {
      if (p.almoxId) await api.put(`/os/tecnicos/${p.funcionarioId}/almox`, { almoxId: p.almoxId });
      else await api.delete(`/os/tecnicos/${p.funcionarioId}/almox`);
    },
    onSuccess: () => setErro(null),
    onError: (e) => setErro(mensagemErro(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['os', 'tecnicos'] }),
  });

  const tecnicos = lista.data ?? [];
  const semAlmox = tecnicos.filter((t) => !t.almox.ok).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Ordens de Serviço"
        titulo="Técnicos"
        acoes={
          <button
            type="button"
            onClick={() => {
              void api
                .get('/os/tecnicos', { params: { recarregar: 1 } })
                .finally(() => qc.invalidateQueries({ queryKey: ['os', 'tecnicos'] }));
            }}
            disabled={lista.isFetching}
            className="btn btn-neutro"
          >
            {lista.isFetching ? 'Lendo o IXC…' : 'Atualizar'}
          </button>
        }
      />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
      {semAlmox > 0 && (
        <Aviso tom="atencao">
          {semAlmox} técnico(s) sem almoxarifado definido — eles não conseguem lançar material nas OS
          até isso ser resolvido.
        </Aviso>
      )}

      {lista.isLoading && <Carregando texto="Lendo os usuários e almoxarifados do IXC…" />}

      {lista.isSuccess && tecnicos.length === 0 && (
        <Bloco>
          <Vazio titulo="Nenhum técnico achado">
            Técnico é o colaborador com usuário no IXC (o campo Colaborador do usuário). Sincronize os
            funcionários e confira os usuários no IXC.
          </Vazio>
        </Bloco>
      )}

      {tecnicos.length > 0 && (
        <Bloco semPadding>
          <ul className="lista-dividida">
            {tecnicos.map((t) => (
              <li key={t.funcionarioId} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5">
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-medium text-tinta-900">{t.nome}</p>
                  {t.almox.ok ? (
                    <p className="text-[12px] text-tinta-500">
                      {t.almox.nome} <span className="text-tinta-400">· {ORIGEM[t.almox.origem]}</span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-rose-600 dark:text-rose-300">{t.almox.motivo}</p>
                  )}
                </div>
                <select
                  value={t.fixado && t.almox.ok ? String(t.almox.almoxId) : ''}
                  disabled={fixar.isPending}
                  onChange={(e) =>
                    fixar.mutate({
                      funcionarioId: t.funcionarioId,
                      almoxId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="campo w-auto min-w-[200px]"
                  aria-label={`Almoxarifado de ${t.nome}`}
                >
                  <option value="">O do IXC</option>
                  {(almoxarifados.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      Fixar: {a.nome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!t.almox.ok}
                  onClick={() => setAberto(t)}
                  className="btn btn-neutro btn-p"
                >
                  Ver a van
                </button>
              </li>
            ))}
          </ul>
        </Bloco>
      )}

      {aberto && <JanelaDaVan tecnico={aberto} onFechar={() => setAberto(null)} />}
    </Pagina>
  );
}

function JanelaDaVan({ tecnico, onFechar }: { tecnico: TecnicoNaLista; onFechar: () => void }) {
  const van = useQuery({
    queryKey: ['os', 'van', tecnico.funcionarioId],
    queryFn: async () => (await api.get<VanDoTecnico>(`/os/tecnicos/${tecnico.funcionarioId}/van`)).data,
    retry: 0,
  });
  const dados = van.data;
  const negativos = dados?.materiais.filter((m) => m.saldo < 0) ?? [];
  const recolhidos = dados?.aparelhos.filter((a) => a.recolhido) ?? [];

  return (
    <Janela titulo={`A van de ${tecnico.nome}`} onFechar={onFechar}>
      {van.isLoading && <Carregando texto="Lendo o almoxarifado no IXC…" />}
      {van.isError && <Aviso tom="erro">{mensagemErro(van.error)}</Aviso>}
      {dados && (
        <div className="space-y-5">
          <p className="text-[13px] text-tinta-500">
            {dados.tecnico.almox.nome} — lido do IXC às{' '}
            {new Date(dados.lidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          </p>

          {negativos.length > 0 && (
            <Aviso tom="erro">
              {negativos.length} material(is) negativo(s): foi lançado mais do que a van tinha no IXC.
              Falta uma transferência para cá, ou algo foi lançado no almoxarifado errado.
            </Aviso>
          )}

          <section>
            <h3 className="eyebrow mb-2">Aparelhos na prateleira ({dados.aparelhos.length})</h3>
            {dados.aparelhos.length === 0 ? (
              <p className="text-[13px] text-tinta-400">Nenhum.</p>
            ) : (
              <ul className="space-y-1.5">
                {dados.aparelhos.map((a) => (
                  <li key={a.patrimonioId} className="rounded-lg border border-tinta-200 px-3 py-2">
                    <p className="text-[13px] font-medium text-tinta-900">
                      {a.descricao}{' '}
                      {a.recolhido && (
                        <Selo tom="atencao" pequeno>
                          recolhido — OS {a.recolhido.osIxcId}, há {a.recolhido.dias} dia(s)
                        </Selo>
                      )}
                    </p>
                    <p className="text-[12px] text-tinta-500">{identificacaoDaPeca(a)}</p>
                  </li>
                ))}
              </ul>
            )}
            {recolhidos.length > 0 && (
              <p className="mt-2 text-[12px] text-tinta-500">
                Os recolhidos estão na van no IXC mas ainda não passaram pela base — receba-os na aba
                Recolhidos.
              </p>
            )}
          </section>

          <section>
            <h3 className="eyebrow mb-2">Material ({dados.materiais.length})</h3>
            {dados.materiais.length === 0 ? (
              <p className="text-[13px] text-tinta-400">Nenhum saldo.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">Produto</th>
                    <th className="th text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.materiais.map((m) => (
                    <tr key={m.produtoId} className="linha">
                      <td className="td">
                        {m.descricao}{' '}
                        {m.noCatalogo && (
                          <Selo tom="marca" pequeno>
                            material de OS
                          </Selo>
                        )}
                      </td>
                      <td className={`td num text-right ${m.saldo < 0 ? 'font-semibold text-rose-600' : ''}`}>
                        {quantidadeComUnidade(m.saldo, m.unidade)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Janela>
  );
}
