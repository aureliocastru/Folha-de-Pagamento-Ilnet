import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CampoDeData } from '../../components/CampoDeData';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { diaBr, mesAnterior, nomeDoPeriodo, type PacoteNaLista } from './tipos';

/**
 * Os períodos mandados (ou a mandar) para a contabilidade.
 *
 * O de sempre é o mês fechado: a tela já abre com as datas dele, e "Montar"
 * cria o período e manda ler o IXC. Um período que já existe não é criado de
 * novo — abre o que está lá, com o que já foi enviado.
 */
export function MesesDaContabilidade() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState(mesAnterior);
  const [erro, setErro] = useState<string | null>(null);

  const pacotes = useQuery({
    queryKey: ['contabilidade', 'pacotes'],
    queryFn: async () => (await api.get<PacoteNaLista[]>('/contabilidade/pacotes')).data,
  });

  const abrir = useMutation({
    mutationFn: async () =>
      (await api.post<{ id: string; novo: boolean }>('/contabilidade/pacotes', periodo)).data,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['contabilidade', 'pacotes'] });
      navigate(`/contabilidade/meses/${r.id}`);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  return (
    <Pagina>
      <CabecalhoPagina secao="Contabilidade" titulo="Documentos do mês" />

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Bloco titulo="Montar um período" className="mb-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
          <div className="min-w-0">
            <label className="rotulo" htmlFor="de">
              De
            </label>
            <CampoDeData id="de" valor={periodo.de} onChange={(de) => setPeriodo((p) => ({ ...p, de }))} />
          </div>
          <div className="min-w-0">
            <label className="rotulo" htmlFor="ate">
              Até
            </label>
            <CampoDeData id="ate" valor={periodo.ate} onChange={(ate) => setPeriodo((p) => ({ ...p, ate }))} />
          </div>
          <button
            type="button"
            className="btn btn-primario"
            disabled={!periodo.de || !periodo.ate || abrir.isPending}
            onClick={() => {
              setErro(null);
              abrir.mutate();
            }}
          >
            {abrir.isPending ? 'Abrindo…' : 'Montar'}
          </button>
        </div>
      </Bloco>

      <Bloco titulo="Períodos" semPadding>
        {pacotes.isLoading ? (
          <Carregando />
        ) : pacotes.isError ? (
          <div className="p-4">
            <Aviso tom="erro">{mensagemErro(pacotes.error)}</Aviso>
          </div>
        ) : (pacotes.data ?? []).length === 0 ? (
          <Vazio titulo="Nenhum período montado ainda" />
        ) : (
          <ul className="divide-y divide-tinta-100">
            {pacotes.data!.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/contabilidade/meses/${p.id}`)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-tinta-50 md:px-5"
                >
                  <span className="min-w-0">
                    <span className="block font-display text-[15px] font-semibold text-tinta-900">
                      {nomeDoPeriodo(p.de, p.ate)}
                    </span>
                    <span className="block text-xs text-tinta-500">Prazo: {diaBr(p.prazo)}</span>
                  </span>
                  {p.lendo ? (
                    <Selo tom="info" ponto>
                      Lendo o IXC
                    </Selo>
                  ) : p.baixadoEm ? (
                    <Selo tom="pago">Baixado em {diaBr(p.baixadoEm)}</Selo>
                  ) : (
                    <Selo tom="atencao">Não baixado</Selo>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Bloco>
    </Pagina>
  );
}
