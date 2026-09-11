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

interface Formulario {
  descricao: string;
  filialId: string;
}

const EM_BRANCO: Formulario = { descricao: '', filialId: '' };

/**
 * O cadastro dos almoxarifados — a tabela `almox` do IXC.
 *
 * **Não é o saldo.** O saldo de cada um é a tela Estoque, que lê `estoque_
 * produtos_almox_filial`; esta tela é a lista de **onde a casa guarda
 * material** — nome, filial e se está ativo. Criar um almoxarifado aqui é o
 * mesmo que criar em Sistema › Cadastros › Almoxarifados no IXC, só que sem
 * trocar de tela.
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
    if (!ruim) setTimeout(() => setFeedback(null), 2500);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'almoxarifados'] });
    // O saldo por almoxarifado, os filtros de estoque e a entrada de compra
    // todos leem esta mesma lista — um cadastro novo tem de aparecer neles.
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'estoque'] });
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'produtos', 'opcoes'] });
  }

  const salvar = useMutation({
    mutationFn: async (args: { id?: number; dados: Partial<Formulario> & { ativo?: boolean } }) => {
      const dados: Record<string, unknown> = {};
      if (args.dados.descricao !== undefined) dados.descricao = args.dados.descricao;
      if (args.dados.filialId) dados.filialId = Number(args.dados.filialId);
      if (args.dados.ativo !== undefined) dados.ativo = args.dados.ativo;
      return args.id
        ? (await api.patch<AlmoxarifadoCadastro>(`/almoxarifado/almoxarifados/${args.id}`, dados)).data
        : (await api.post<AlmoxarifadoCadastro>('/almoxarifado/almoxarifados', dados)).data;
    },
    onSuccess: (a, args) => {
      setEditando(null);
      setCriando(false);
      avisar(args.id ? `"${a.descricao}" atualizado no IXC.` : `"${a.descricao}" cadastrado no IXC.`);
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

  const todos = lista.data ?? [];
  const inativos = todos.filter((a) => !a.ativo).length;
  const soNoSaldo = todos.filter((a) => a.filialId === 0).length;
  const itens = mostrarInativos ? todos : todos.filter((a) => a.ativo);

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

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Almoxarifados"
        descricao="Onde a casa guarda material — nome, filial e se está ativo. É o cadastro do IXC, não o saldo (isso é a tela Estoque)."
        acoes={
          <button type="button" onClick={() => setCriando(true)} className="btn btn-primario">
            Novo almoxarifado
          </button>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      {soNoSaldo > 0 && (
        <Aviso tom="atencao">
          {soNoSaldo === 1 ? '1 almoxarifado apareceu' : `${soNoSaldo} almoxarifados apareceram`}{' '}
          só pelo saldo, marcados "não achado no cadastro": o IXC tem produto com eles, mas a
          listagem de almoxarifados dele não os trouxe. Editar funciona — é só escolher a filial.
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
                    <td className="td text-tinta-700">
                      {a.filialId === 0 ? (
                        <span
                          className="text-xs text-tinta-400"
                          title='O "Almoxarifados (listar)" do IXC não trouxe este — apareceu porque tem produto com ele. Ao editar, escolha a filial.'
                        >
                          não achado no cadastro
                        </span>
                      ) : (
                        (a.filial ?? '—')
                      )}
                    </td>
                    <td className="td">
                      {!a.ativo && <Selo>inativo</Selo>}
                      {a.ativo && a.filialId !== 0 && (
                        <span className="text-xs text-tinta-400">—</span>
                      )}
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
          filiais={opcoes.data?.filiais ?? []}
          filiaisCarregando={opcoes.isLoading}
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

function FormularioAlmoxarifado({
  almoxarifado,
  filiais,
  filiaisCarregando,
  salvando,
  apagando,
  onSalvar,
  onApagar,
  onFechar,
}: {
  /** Null = está criando um novo. */
  almoxarifado: AlmoxarifadoCadastro | null;
  filiais: Array<{ id: number; nome: string }>;
  filiaisCarregando: boolean;
  salvando: boolean;
  apagando: boolean;
  onSalvar: (dados: Formulario & { ativo?: boolean }) => void;
  onApagar: () => void;
  onFechar: () => void;
}) {
  const [descricao, setDescricao] = useState(almoxarifado?.descricao ?? EM_BRANCO.descricao);
  const [filialId, setFilialId] = useState(
    almoxarifado ? String(almoxarifado.filialId) : EM_BRANCO.filialId,
  );
  const [ativo, setAtivo] = useState(almoxarifado?.ativo ?? true);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);

  const valido = descricao.trim().length >= 2 && !!filialId;

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
            filialId,
            ativo: almoxarifado ? ativo : undefined,
          });
        }}
        className="space-y-4"
      >
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
          <div>
            <label className="rotulo" htmlFor="almox-filial">
              Filial
            </label>
            <select
              id="almox-filial"
              value={filialId}
              onChange={(e) => setFilialId(e.target.value)}
              className="campo"
              disabled={filiaisCarregando}
            >
              {!filialId && <option value="">Escolha…</option>}
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>
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
