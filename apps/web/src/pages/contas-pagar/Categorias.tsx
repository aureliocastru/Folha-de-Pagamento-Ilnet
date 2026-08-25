import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { emArvore } from '../../lib/categorias';
import type { CategoriaDespesa } from '../../lib/types';

/**
 * O valor da opção que abre a criação da mãe. Um uuid nunca começa com dois
 * sublinhados, então ele não colide com o id de categoria nenhuma — é o mesmo
 * truque do seletor de categoria da classificação.
 */
const NOVA_MAE = '__nova-mae';

/**
 * O cadastro de "com o que a empresa gasta".
 *
 * É cadastro, e não lista fixa no código, porque o que a empresa compra muda
 * com o tempo e ninguém deveria esperar um deploy para classificar um gasto
 * novo.
 *
 * Tem dois níveis: a categoria ("Veículos") e a subcategoria dentro dela
 * ("Compra de veículos", "Manutenção de veículos"). Etiquetar um débito é
 * escolher a de baixo; o dashboard soma pela de cima. Com trinta nomes soltos
 * o gráfico virava trinta barras que não respondiam "quanto custa a frota?" —
 * a resposta estava espalhada em três delas.
 *
 * Categoria que já etiquetou alguma conta não se apaga — desativa. Apagar
 * reescreveria relatório de mês fechado, e um número que muda sozinho depois
 * de fechado não serve para decidir nada.
 */
export function Categorias() {
  const qc = useQueryClient();
  const [nova, setNova] = useState('');
  const [maeDaNova, setMaeDaNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(
    null,
  );
  /** A linha que está criando a mãe dela, e o nome sendo digitado. */
  const [criandoMae, setCriandoMae] = useState<{
    id: string;
    nome: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['categorias-despesa', 'todas'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa?todas=true')).data,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 2500);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['categorias-despesa'] });
    void qc.invalidateQueries({ queryKey: ['contas-abertas'] });
  }

  const criar = useMutation({
    mutationFn: async (args: { nome: string; paiId: string | null }) =>
      (await api.post<CategoriaDespesa>('/categorias-despesa', args)).data,
    onSuccess: (c) => {
      setNova('');
      avisar(
        c.pai ? `"${c.nome}" criada dentro de "${c.pai.nome}".` : `"${c.nome}" criada.`,
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const salvar = useMutation({
    mutationFn: async (args: { id: string; nome: string }) =>
      (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${args.id}`, {
          nome: args.nome,
        })
      ).data,
    onSuccess: () => {
      setEditando(null);
      avisar('Nome alterado.');
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  /**
   * Põe (ou tira) a categoria de dentro de outra. É o gesto que o cadastro
   * inteiro existe para permitir: a lista já estava cheia de nomes soltos, e
   * agrupá-los é o que dá ao dashboard o "com o quê" em duas alturas.
   */
  const mover = useMutation({
    mutationFn: async (args: { id: string; paiId: string | null }) =>
      (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${args.id}`, {
          paiId: args.paiId,
        })
      ).data,
    onSuccess: (c) => {
      avisar(
        c.pai
          ? `"${c.nome}" agora é subcategoria de "${c.pai.nome}".`
          : `"${c.nome}" saiu do grupo.`,
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  /**
   * Cria a mãe e já põe esta categoria dentro dela, num gesto só.
   *
   * São duas escritas porque são dois registros, mas uma decisão: quem digitou
   * "Veículos" no campo de "Compra de veículos" não quis cadastrar um nome —
   * quis agrupar. Parar no meio deixaria uma categoria-mãe vazia na lista, com
   * cara de engano, e é por isso que a segunda parte não é opcional.
   */
  const agruparEmNova = useMutation({
    mutationFn: async (args: { id: string; nome: string }) => {
      const mae = (
        await api.post<CategoriaDespesa>('/categorias-despesa', {
          nome: args.nome.trim(),
        })
      ).data;
      const filha = (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${args.id}`, {
          paiId: mae.id,
        })
      ).data;
      return { mae, filha };
    },
    onSuccess: ({ mae, filha }) => {
      setCriandoMae(null);
      avisar(`"${mae.nome}" criada, com "${filha.nome}" dentro dela.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const alternar = useMutation({
    mutationFn: async (c: CategoriaDespesa) =>
      (
        await api.patch<CategoriaDespesa>(`/categorias-despesa/${c.id}`, {
          ativa: !c.ativa,
        })
      ).data,
    onSuccess: (c) => {
      avisar(`"${c.nome}" ${c.ativa ? 'reativada' : 'desativada'}.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const remover = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/categorias-despesa/${id}`)).data,
    onSuccess: () => {
      avisar('Categoria apagada.');
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const categorias = lista.data ?? [];
  const { grupos, soltas } = emArvore(categorias);
  /**
   * Quem pode receber subcategorias: quem não está dentro de outra.
   *
   * Desativada fica de fora — pôr gasto novo dentro de um grupo aposentado é
   * escondê-lo. A que já agrupa alguém continua na lista mesmo desativada,
   * senão o campo das filhas dela apareceria em branco, como se estivessem
   * soltas.
   */
  const maesPossiveis = categorias
    .filter((c) => !c.pai && (c.ativa || c.temFilhas))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const ocupado =
    criar.isPending ||
    salvar.isPending ||
    alternar.isPending ||
    mover.isPending ||
    agruparEmNova.isPending ||
    remover.isPending;
  const podeCriarMae =
    !!criandoMae && criandoMae.nome.trim().length >= 2 && !agruparEmNova.isPending;

  /** As linhas na ordem em que se lê: cada grupo com as suas, e as soltas no fim. */
  const linhas = [
    ...grupos.flatMap(({ mae, filhas }) => [
      { categoria: mae, dentroDe: null as CategoriaDespesa | null },
      ...filhas.map((f) => ({ categoria: f, dentroDe: mae })),
    ]),
    ...soltas.map((c) => ({ categoria: c, dentroDe: null })),
  ];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Categorias"
        titulo="Com o que a empresa gasta"
        descricao="A lista que aparece em cada débito e que separa os números do dashboard. Cada categoria pode ficar dentro de outra: o painel soma pela de cima e destrincha pelas de baixo."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <Bloco titulo="Nova categoria" className="surgir mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nova.trim().length >= 2) {
              criar.mutate({ nome: nova, paiId: maeDaNova || null });
            }
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            placeholder="Ex.: Combustível"
            className="campo flex-1"
          />
          {/* Escolher o grupo na hora de criar poupa a segunda viagem: quem
              cadastra "Pneus" já sabe que ela é de "Veículos". */}
          <select
            value={maeDaNova}
            onChange={(e) => setMaeDaNova(e.target.value)}
            className="campo sm:max-w-[16rem]"
            title="Dentro de que categoria ela entra"
          >
            {/* O rótulo diz o que a escolha faz, e não o que falta nela:
                "sem categoria-mãe" descrevia uma ausência, e quem procurava
                onde criar a mãe não reconhecia que era ali. */}
            <option value="">Categoria-mãe (não entra em nenhuma)</option>
            {maesPossiveis.map((c) => (
              <option key={c.id} value={c.id}>
                dentro de {c.nome}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={nova.trim().length < 2 || criar.isPending}
            className="btn btn-primario shrink-0"
          >
            {criar.isPending ? 'Criando…' : 'Criar categoria'}
          </button>
        </form>
        <p className="ajuda">
          Categoria-mãe é só uma categoria que não está dentro de outra: crie
          "Veículos" assim e depois use a coluna "Dentro de" para pôr
          "Compra de veículos" e "Manutenção de veículos" nela — ou crie a mãe
          direto de lá, pela última opção da lista.
        </p>
      </Bloco>

      <Bloco semPadding>
        {lista.isLoading ? (
          <Carregando />
        ) : categorias.length === 0 ? (
          <Vazio titulo="Nenhuma categoria ainda" />
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Categoria</th>
                  <th className="th">Dentro de</th>
                  <th className="th">Em uso</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ categoria: c, dentroDe }) => (
                  <tr key={c.id} className="linha">
                    <td className="td">
                      {editando?.id === c.id ? (
                        <input
                          value={editando.nome}
                          onChange={(e) =>
                            setEditando({ id: c.id, nome: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') salvar.mutate(editando);
                            if (e.key === 'Escape') setEditando(null);
                          }}
                          autoFocus
                          className="campo max-w-xs"
                        />
                      ) : (
                        // O recuo é o que faz a lista se ler como cadastro de
                        // dois níveis sem precisar de uma segunda tabela.
                        <div
                          className={`flex items-center gap-2 ${
                            dentroDe ? 'pl-6' : ''
                          }`}
                        >
                          {dentroDe && (
                            <span
                              aria-hidden
                              className="text-tinta-300"
                              title={`Subcategoria de ${dentroDe.nome}`}
                            >
                              ↳
                            </span>
                          )}
                          <span
                            className={
                              !c.ativa
                                ? 'text-tinta-400'
                                : dentroDe
                                  ? 'text-tinta-800'
                                  : 'font-semibold text-tinta-800'
                            }
                          >
                            {c.nome}
                          </span>
                          {c.temFilhas && (
                            <Selo
                              pequeno
                              tom="marca"
                              titulo="É um grupo: o dashboard soma por ela e destrincha pelas subcategorias"
                            >
                              grupo
                            </Selo>
                          )}
                          {!c.ativa && (
                            <Selo
                              pequeno
                              tom="neutro"
                              titulo="Não aparece mais nas opções, mas o que já foi classificado continua valendo"
                            >
                              desativada
                            </Selo>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      {c.temFilhas ? (
                        // Três níveis o dashboard não somaria, então quem já é
                        // grupo não entra em outro. A saída é esvaziar o grupo
                        // primeiro, e a frase diz isso.
                        <span
                          className="text-xs text-tinta-400"
                          title="Uma categoria que já agrupa outras não pode entrar dentro de uma terceira"
                        >
                          agrupa outras
                        </span>
                      ) : criandoMae?.id === c.id ? (
                        /*
                         * A mãe nasce aqui, no campo em que a falta dela é
                         * percebida.
                         *
                         * Quem está pondo "Compra de veículos" no lugar abre a
                         * lista à procura de "Veículos", não acha, e o caminho
                         * era subir até o formulário do topo, criar, e voltar
                         * para achar a linha de novo. Criada daqui, ela já
                         * recebe esta categoria dentro — que era o motivo de
                         * ela estar sendo criada.
                         */
                        <div className="flex items-center gap-1.5">
                          <input
                            value={criandoMae.nome}
                            autoFocus
                            onChange={(e) =>
                              setCriandoMae({ id: c.id, nome: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && podeCriarMae) {
                                agruparEmNova.mutate(criandoMae);
                              }
                              if (e.key === 'Escape') setCriandoMae(null);
                            }}
                            placeholder="Nome da categoria-mãe"
                            className="campo max-w-[12rem] py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => agruparEmNova.mutate(criandoMae)}
                            disabled={!podeCriarMae}
                            className="btn btn-primario btn-p"
                          >
                            {agruparEmNova.isPending ? 'Criando…' : 'Criar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setCriandoMae(null)}
                            className="btn btn-sutil btn-p"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <select
                          value={c.pai?.id ?? ''}
                          disabled={ocupado}
                          onChange={(e) => {
                            if (e.target.value === NOVA_MAE) {
                              setCriandoMae({ id: c.id, nome: '' });
                              return;
                            }
                            mover.mutate({
                              id: c.id,
                              paiId: e.target.value || null,
                            });
                          }}
                          className="campo max-w-[14rem] py-1 text-xs"
                          title="A categoria de cima, que soma esta no dashboard"
                        >
                          <option value="">— sem categoria-mãe —</option>
                          {maesPossiveis
                            .filter((m) => m.id !== c.id)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.nome}
                              </option>
                            ))}
                          <option value={NOVA_MAE}>
                            + Criar categoria-mãe…
                          </option>
                        </select>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {c.emUso === 0 ? '—' : `${c.emUso} conta(s)`}
                    </td>
                    <td className="td text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {editando?.id === c.id ? (
                          <>
                            <button
                              onClick={() => salvar.mutate(editando)}
                              disabled={ocupado}
                              className="btn btn-primario btn-p"
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditando(null)}
                              className="btn btn-neutro btn-p"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                setEditando({ id: c.id, nome: c.nome })
                              }
                              className="btn btn-neutro btn-p"
                            >
                              Renomear
                            </button>
                            <button
                              onClick={() => alternar.mutate(c)}
                              disabled={ocupado}
                              className="btn btn-sutil btn-p"
                            >
                              {c.ativa ? 'Desativar' : 'Reativar'}
                            </button>
                            {/* Apagar só existe para a que nunca etiquetou
                                nada e não agrupa ninguém: nos outros casos a
                                API recusa e diz o caminho. */}
                            {c.emUso === 0 && !c.temFilhas && (
                              <button
                                onClick={() => {
                                  if (confirm(`Apagar "${c.nome}"?`)) {
                                    remover.mutate(c.id);
                                  }
                                }}
                                className="btn btn-perigo btn-p"
                              >
                                Excluir
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {grupos.length === 0 && categorias.length > 0 && (
        <p className="ajuda mt-3">
          Nenhum grupo ainda: as {categorias.length} categorias estão todas no
          primeiro nível. Crie uma categoria larga — "Veículos", "Estrutura",
          "Pessoal" — e use a coluna "Dentro de" para pôr as de hoje dentro
          dela.
        </p>
      )}
    </Pagina>
  );
}
