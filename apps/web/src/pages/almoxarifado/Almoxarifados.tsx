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
import type { AlmoxarifadoCadastro, OpcoesDoAlmoxarifado } from '../../lib/types';

interface DadosDoFormulario {
  descricao: string;
  /** Vazio quando o formulário não mostra a filial (almoxarifado não liberado). */
  filialId: string;
  ativo?: boolean;
  tecnicoUsuarioId?: string;
}

/**
 * O cadastro dos almoxarifados — a tabela `almox` do IXC.
 *
 * **Não é o saldo** (isso é a tela Estoque): é a lista de onde a casa guarda
 * material. E no IXC cada usuário só enxerga os almoxarifados **ligados a
 * ele** (Usuários › aba Almoxarifados) — é assim que a van de cada técnico
 * fica só com o técnico. Por isso a tela mostra de quem é cada um, e avisa
 * quando o próprio sistema não está ligado a algum: sem essa ligação ele não
 * consegue editá-lo nem mandar material para ele.
 */
export function Almoxarifados() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<AlmoxarifadoCadastro | null>(null);
  const [criando, setCriando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  /** Inativo some da lista por padrão — este botão pequeno traz de volta. */
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const lista = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados'],
    queryFn: async () =>
      (await api.get<AlmoxarifadoCadastro[]>('/almoxarifado/almoxarifados')).data,
  });
  const opcoes = useQuery({
    queryKey: ['almoxarifado', 'almoxarifados', 'opcoes'],
    queryFn: async () =>
      (await api.get<OpcoesDoAlmoxarifado>('/almoxarifado/almoxarifados/opcoes')).data,
    staleTime: 5 * 60_000,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 3500);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'almoxarifados'] });
    // O saldo por almoxarifado, os filtros do estoque e o Mover/Dar entrada
    // leem esta mesma lista — o que muda aqui tem de aparecer lá.
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'opcoes'] });
  }

  const salvar = useMutation({
    mutationFn: async (args: { id?: number; dados: DadosDoFormulario }) => {
      const corpo: Record<string, unknown> = { descricao: args.dados.descricao };
      if (args.dados.filialId) corpo.filialId = Number(args.dados.filialId);
      if (args.dados.ativo !== undefined) corpo.ativo = args.dados.ativo;
      if (args.dados.tecnicoUsuarioId) {
        corpo.tecnicoUsuarioId = Number(args.dados.tecnicoUsuarioId);
      }
      return args.id
        ? (await api.patch<AlmoxarifadoCadastro>(`/almoxarifado/almoxarifados/${args.id}`, corpo))
            .data
        : (await api.post<AlmoxarifadoCadastro>('/almoxarifado/almoxarifados', corpo)).data;
    },
    onSuccess: (a, args) => {
      setEditando(null);
      setCriando(false);
      avisar(
        args.id ? `"${a.descricao}" atualizado no IXC.` : `"${a.descricao}" cadastrado no IXC.`,
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const apagar = useMutation({
    mutationFn: async (a: AlmoxarifadoCadastro) => {
      await api.delete(`/almoxarifado/almoxarifados/${a.id}`);
      return a;
    },
    onSuccess: (a) => {
      setEditando(null);
      avisar(`"${a.descricao}" apagado do IXC.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (a: AlmoxarifadoCadastro) =>
      (
        await api.patch<AlmoxarifadoCadastro>(`/almoxarifado/almoxarifados/${a.id}`, {
          ativo: !a.ativo,
        })
      ).data,
    onSuccess: (a) => {
      avisar(a.ativo ? `"${a.descricao}" ativado no IXC.` : `"${a.descricao}" inativado no IXC.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const liberar = useMutation({
    mutationFn: async () =>
      (await api.post<{ liberados: number }>('/almoxarifado/almoxarifados/liberar')).data,
    onSuccess: (r) => {
      avisar(
        r.liberados === 1
          ? '1 almoxarifado liberado para o sistema.'
          : `${r.liberados} almoxarifados liberados para o sistema.`,
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const todos = lista.data ?? [];
  const inativos = todos.filter((a) => !a.ativo).length;
  const naoLiberados = todos.filter((a) => !a.liberado).length;
  const itens = mostrarInativos ? todos : todos.filter((a) => a.ativo);

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Almoxarifados"
        descricao="Onde a casa guarda material — nome, filial, técnico e se está ativo. É o cadastro do IXC, não o saldo (isso é a tela Estoque)."
        acoes={
          <button type="button" onClick={() => setCriando(true)} className="btn btn-primario">
            Novo almoxarifado
          </button>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      {naoLiberados > 0 && (
        <Aviso
          tom="atencao"
          acao={
            <button
              type="button"
              onClick={() => liberar.mutate()}
              disabled={liberar.isPending}
              className="btn btn-p btn-primario"
            >
              {liberar.isPending ? 'Liberando…' : 'Liberar para o sistema'}
            </button>
          }
        >
          {naoLiberados === 1
            ? '1 almoxarifado de técnico não está liberado'
            : `${naoLiberados} almoxarifados de técnico não estão liberados`}{' '}
          para o sistema: no IXC eles só estão ligados ao técnico, e sem essa ligação o sistema
          não os edita nem transfere material para eles. Liberar acrescenta o sistema — não
          tira o técnico nem muda o padrão dele.
        </Aviso>
      )}

      <Bloco
        titulo={`${itens.length} ${itens.length === 1 ? 'almoxarifado' : 'almoxarifados'}`}
        semPadding
        acao={
          (mostrarInativos || inativos > 0) && (
            <label className="opcao text-[12px]">
              <input
                type="checkbox"
                className="marcador"
                checked={mostrarInativos}
                onChange={(e) => setMostrarInativos(e.target.checked)}
              />
              Mostrar inativos{inativos > 0 ? ` (${inativos})` : ''}
            </label>
          )
        }
      >
        {lista.isLoading && <Carregando texto="Lendo do IXC…" />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler a lista">{mensagemErro(lista.error)}</Vazio>
        )}

        {!lista.isLoading && itens.length === 0 && !lista.isError && (
          <Vazio titulo={todos.length > 0 ? 'Só tem inativo' : 'Nenhum almoxarifado cadastrado'}>
            {todos.length > 0
              ? 'Todos os almoxarifados estão inativos. Marque "Mostrar inativos" para vê-los.'
              : 'Cadastre onde a casa guarda material — é lá que o saldo e as ' +
                'transferências entre eles vão morar.'}
          </Vazio>
        )}

        {itens.length > 0 && (
          <div className="rolagem-fina overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Almoxarifado</th>
                  <th className="th">Técnico / usuários</th>
                  <th className="th">Filial</th>
                  <th className="th">Situação</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((a) => (
                  <tr key={a.id} className="linha">
                    <td className="td">
                      <div className="font-medium text-tinta-800">{a.descricao}</div>
                      <div className="num text-xs text-tinta-400">código {a.id}</div>
                    </td>
                    <td className="td">
                      <Usuarios usuarios={a.usuarios} />
                    </td>
                    <td className="td text-tinta-700">
                      {a.liberado ? (
                        (a.filial ?? '—')
                      ) : (
                        <span className="text-xs text-tinta-400">—</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        {!a.ativo && <Selo>inativo</Selo>}
                        {!a.liberado && (
                          <Selo tom="atencao" titulo="O sistema não está ligado a ele no IXC">
                            não liberado
                          </Selo>
                        )}
                        {a.ativo && a.liberado && (
                          <span className="text-xs text-tinta-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              a.ativo &&
                              !confirm(`Inativar "${a.descricao}" (código ${a.id}) no IXC?`)
                            ) {
                              return;
                            }
                            alternarAtivo.mutate(a);
                          }}
                          disabled={alternarAtivo.isPending}
                          className="btn btn-p btn-sutil"
                        >
                          {a.ativo ? 'Inativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(a)}
                          className="btn btn-p btn-neutro"
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {(criando || editando) && (
        <FormularioAlmoxarifado
          almoxarifado={editando}
          opcoes={opcoes.data}
          opcoesCarregando={opcoes.isLoading}
          salvando={salvar.isPending}
          apagando={apagar.isPending}
          onSalvar={(dados) => salvar.mutate({ id: editando?.id, dados })}
          onApagar={() => editando && apagar.mutate(editando)}
          onFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
        />
      )}
    </Pagina>
  );
}

/** Quem está ligado ao almoxarifado no IXC — o padrão do técnico marcado. */
function Usuarios({ usuarios }: { usuarios: AlmoxarifadoCadastro['usuarios'] }) {
  if (usuarios.length === 0) return <span className="text-xs text-tinta-400">—</span>;
  const mostrados = usuarios.slice(0, 2);
  return (
    <div className="space-y-0.5">
      {mostrados.map((u) => (
        <div key={u.id} className="text-[13px] text-tinta-700">
          {u.nome}
          {u.padrao && <span className="ml-1.5 text-[11px] text-tinta-400">(padrão)</span>}
        </div>
      ))}
      {usuarios.length > 2 && (
        <div
          className="text-[11px] text-tinta-400"
          title={usuarios
            .slice(2)
            .map((u) => u.nome)
            .join(', ')}
        >
          +{usuarios.length - 2}
        </div>
      )}
    </div>
  );
}

function FormularioAlmoxarifado({
  almoxarifado,
  opcoes,
  opcoesCarregando,
  salvando,
  apagando,
  onSalvar,
  onApagar,
  onFechar,
}: {
  /** Null = está criando um novo. */
  almoxarifado: AlmoxarifadoCadastro | null;
  opcoes: OpcoesDoAlmoxarifado | undefined;
  opcoesCarregando: boolean;
  salvando: boolean;
  apagando: boolean;
  onSalvar: (dados: DadosDoFormulario) => void;
  onApagar: () => void;
  onFechar: () => void;
}) {
  // O não liberado vem sem filial (o sistema não enxerga o cadastro dele): o
  // campo some, e o servidor mantém a que está no IXC.
  const mostraFilial = !almoxarifado || almoxarifado.liberado;
  const [descricao, setDescricao] = useState(almoxarifado?.descricao ?? '');
  const [filialId, setFilialId] = useState(
    almoxarifado?.filialId ? String(almoxarifado.filialId) : '',
  );
  const [ativo, setAtivo] = useState(almoxarifado?.ativo ?? true);
  const [tecnico, setTecnico] = useState('');
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);

  const filiais = opcoes?.filiais ?? [];
  const tecnicos = opcoes?.tecnicos ?? [];
  const valido = descricao.trim().length >= 2 && (!mostraFilial || !!filialId);

  return (
    <Janela
      titulo={almoxarifado ? almoxarifado.descricao : 'Novo almoxarifado'}
      onFechar={onFechar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar({
            descricao: descricao.trim(),
            filialId: mostraFilial ? filialId : '',
            ativo: almoxarifado ? ativo : undefined,
            tecnicoUsuarioId: almoxarifado ? undefined : tecnico,
          });
        }}
        className="space-y-4"
      >
        {almoxarifado && !almoxarifado.liberado && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Este é de técnico e o sistema ainda não está ligado a ele no IXC. Ao salvar, o
            sistema é ligado — sem tirar o técnico nem mudar o padrão dele.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="almox-nome">
              Nome do almoxarifado
            </label>
            <input
              id="almox-nome"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value.slice(0, 100))}
              className="campo"
              autoComplete="off"
              autoFocus
            />
          </div>

          {mostraFilial && (
            <div>
              <label className="rotulo" htmlFor="almox-filial">
                Filial
              </label>
              <select
                id="almox-filial"
                value={filialId}
                onChange={(e) => setFilialId(e.target.value)}
                className="campo"
                disabled={opcoesCarregando}
              >
                {!filialId && <option value="">Escolha…</option>}
                {filiais.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!almoxarifado && (
            <div>
              <label className="rotulo" htmlFor="almox-tecnico">
                Técnico (opcional)
              </label>
              <select
                id="almox-tecnico"
                value={tecnico}
                onChange={(e) => setTecnico(e.target.value)}
                className="campo"
                disabled={opcoesCarregando}
              >
                <option value="">Nenhum — almoxarifado da casa</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>
          )}

          {almoxarifado && (
            <div className="flex items-end">
              <label className="opcao">
                <input
                  type="checkbox"
                  className="marcador"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                />
                Ativo no IXC
              </label>
            </div>
          )}
        </div>

        {!almoxarifado && (
          <p className="ajuda">
            {tecnico
              ? 'É a van do técnico: ele fica ligado a este almoxarifado no IXC — como o padrão dele, se ainda não tiver um (é de onde a OS dele tira material).'
              : 'Fica visível para quem já vê o Almoxarifado Principal no IXC. Para a van de um técnico, escolha o técnico.'}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-tinta-200 pt-4">
          {/*
            Apagar fica longe do botão que salva, e sem cor até ser pedido: o
            que se faz todo dia é desativar (o "Ativo no IXC" acima), e apagar
            leva junto o histórico — o IXC costuma recusar quem já tem produto
            ou movimento.
          */}
          {almoxarifado ? (
            confirmandoApagar ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-rose-700">Não dá para desfazer.</span>
                <button
                  type="button"
                  disabled={apagando}
                  onClick={onApagar}
                  className="btn btn-p btn-perigo"
                >
                  {apagando ? 'Apagando…' : 'Apagar mesmo assim'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmandoApagar(false)}
                  className="btn btn-p btn-sutil"
                >
                  Deixa
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmandoApagar(true)}
                className="btn btn-p btn-perigo"
              >
                Apagar do IXC
              </button>
            )
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onFechar} className="btn btn-neutro">
              Cancelar
            </button>
            <button type="submit" disabled={salvando || !valido} className="btn btn-primario">
              {salvando ? 'Gravando no IXC…' : 'Salvar no IXC'}
            </button>
          </div>
        </div>
      </form>
    </Janela>
  );
}
