import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
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
import { combina, semAcento } from '../../lib/busca';
import type {
  AlmoxarifadoCadastro,
  EstoqueNaTela,
  OpcoesDoAlmoxarifado,
} from '../../lib/types';
import { MoverTudo } from './MoverTudo';
import { quantidade } from './ProdutoNoIxc';

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
  /** A origem aberta na janela "Mover tudo". */
  const [movendo, setMovendo] = useState<AlmoxarifadoCadastro | null>(null);
  /** A linha aberta, mostrando o que o almoxarifado tem dentro. */
  const [aberto, setAberto] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  /** Inativo some da lista por padrão — este botão pequeno traz de volta. */
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [busca, setBusca] = useState('');

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
  const visiveis = mostrarInativos ? todos : todos.filter((a) => a.ativo);
  // Pelo nome, pelo código ou por quem está ligado a ele — "anderson" acha a van dele.
  const termo = semAcento(busca.trim());
  const itens = termo
    ? visiveis.filter(
        (a) =>
          String(a.id) === termo ||
          combina([a.descricao, a.filial, ...a.usuarios.map((u) => u.nome)], termo),
      )
    : visiveis;

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
        {todos.length > 0 && (
          <div className="px-3.5 py-3 md:px-5">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, código ou técnico…"
              className="campo"
              autoComplete="off"
              aria-label="Buscar almoxarifado"
            />
          </div>
        )}

        {lista.isLoading && <Carregando texto="Lendo do IXC…" />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler a lista">{mensagemErro(lista.error)}</Vazio>
        )}

        {!lista.isLoading && itens.length === 0 && !lista.isError && (
          <Vazio
            titulo={
              termo
                ? 'Nenhum almoxarifado com esse nome'
                : todos.length > 0
                  ? 'Só tem inativo'
                  : 'Nenhum almoxarifado cadastrado'
            }
          >
            {termo
              ? mostrarInativos || inativos === 0
                ? 'Confira o que foi digitado — a busca olha o nome, o código e quem está ligado a ele.'
                : 'Pode estar entre os inativos: marque "Mostrar inativos".'
              : todos.length > 0
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
                  <Fragment key={a.id}>
                  <tr className="linha">
                    <td className="td">
                      {/* Clicar no nome abre o que ele tem dentro, na própria linha. */}
                      <button
                        type="button"
                        onClick={() => setAberto((x) => (x === a.id ? null : a.id))}
                        className="text-left"
                        aria-expanded={aberto === a.id}
                        title="Ver o que tem dentro deste almoxarifado"
                      >
                        <div className="font-medium text-tinta-800 hover:underline">
                          {a.descricao}
                        </div>
                        <div className="num text-xs text-tinta-400">código {a.id}</div>
                      </button>
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
                          onClick={() => setMovendo(a)}
                          disabled={!a.liberado}
                          title={
                            a.liberado
                              ? 'Levar tudo o que ele tem para outro almoxarifado'
                              : 'Libere para o sistema antes'
                          }
                          className="btn btn-p btn-sutil"
                        >
                          Mover tudo
                        </button>
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
                  {aberto === a.id && (
                    <tr>
                      <td colSpan={5} className="bg-tinta-50/80 px-4 pb-4">
                        <ConteudoDoAlmoxarifado id={a.id} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {movendo && (
        <MoverTudo
          origem={movendo}
          almoxarifados={todos}
          onFechar={() => setMovendo(null)}
          onMudou={invalidar}
        />
      )}

      {(criando || editando) && (
        <FormularioAlmoxarifado
          /* Da lista, e não do clique: ligar ou tirar um usuário relê a lista,
             e a janela tem de mostrar o que ficou. */
          almoxarifado={editando ? (todos.find((a) => a.id === editando.id) ?? editando) : null}
          opcoes={opcoes.data}
          opcoesCarregando={opcoes.isLoading}
          salvando={salvar.isPending}
          apagando={apagar.isPending}
          onSalvar={(dados) => salvar.mutate({ id: editando?.id, dados })}
          onApagar={() => editando && apagar.mutate(editando)}
          onMudouUsuarios={invalidar}
          avisar={avisar}
          onFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
        />
      )}
    </Pagina>
  );
}

/**
 * O que o almoxarifado tem dentro, aberto na própria linha.
 *
 * É o mesmo saldo da tela Estoque, recortado a este almoxarifado — de
 * propósito na mesma chave de cache dela: quem vem de lá não faz o servidor
 * ler o IXC de novo. Zero não aparece (o produto está no cadastro, não na
 * prateleira); negativo aparece, porque é o que precisa de acerto.
 */
function ConteudoDoAlmoxarifado({ id }: { id: number }) {
  const conteudo = useQuery({
    queryKey: ['almoxarifado', 'estoque', String(id)],
    queryFn: async () =>
      (
        await api.get<EstoqueNaTela>('/almoxarifado/estoque', { params: { almox: id } })
      ).data,
    staleTime: 60_000,
  });

  if (conteudo.isLoading) return <Carregando texto="Lendo o que tem dentro…" />;
  if (conteudo.isError) {
    return <p className="py-3 text-[13px] text-rose-700">{mensagemErro(conteudo.error)}</p>;
  }

  /* Dentro do almoxarifado só cabe material da prateleira. Inativo no IXC
     fica de fora — foi inativado justamente para sair da frente, e a tela
     Estoque também o esconde por padrão. Serviço idem: o IXC não soma entrada
     dele, o negativo não é falta de nada, e "Ativação de Fibra" não é coisa
     que se guarde em prateleira. */
  const itens = (conteudo.data?.itens ?? [])
    .filter((i) => i.ativo && !i.servico && i.saldos.some((s) => s.saldo !== 0))
    .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));

  if (itens.length === 0) {
    return (
      <p className="py-3 text-[13px] text-tinta-500">
        Este almoxarifado está vazio — nenhum produto ativo com saldo no IXC.
      </p>
    );
  }

  return (
    <div className="pt-3">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-tinta-400">
        {itens.length === 1 ? '1 produto dentro' : `${itens.length} produtos dentro`}
      </div>
      <div className="rolagem-fina max-h-72 overflow-y-auto rounded-xl border border-tinta-200">
        <table className="w-full text-sm">
          <tbody>
            {itens.map((i) => {
              const saldo = i.saldos.reduce((s, x) => s + x.saldo, 0);
              return (
                <tr key={i.produtoId} className="linha">
                  <td className="td py-1.5">
                    <div className="text-[13px] text-tinta-700">{i.descricao}</div>
                    <div className="num text-[11px] text-tinta-400">código {i.produtoId}</div>
                  </td>
                  <td className="td whitespace-nowrap py-1.5 text-right">
                    <span
                      className={`valor text-[14px] ${
                        saldo < 0 ? 'text-rose-600 dark:text-rose-300' : ''
                      }`}
                    >
                      {quantidade(saldo)}
                    </span>
                    {i.unidade && (
                      <span className="ml-1 text-[11px] text-tinta-400">{i.unidade}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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

/**
 * Quem enxerga este almoxarifado no IXC — e quem o tem como padrão.
 *
 * No IXC isso é a aba "Almoxarifados" de cada usuário (a tabela
 * `almox_usuario`): sem estar ligado, a pessoa não vê o almoxarifado nem nas
 * telas de lá. O padrão é do usuário, e um só por pessoa — é de onde a OS dele
 * tira material —, por isso marcar aqui tira a marca dos outros almoxarifados
 * dele.
 *
 * Cada botão é uma escrita no IXC na hora, e não algo que espera o "Salvar":
 * ligar alguém é um ato, não um campo do cadastro.
 */
function UsuariosDoAlmoxarifado({
  almoxarifado,
  opcoes,
  opcoesCarregando,
  onMudou,
  avisar,
}: {
  almoxarifado: AlmoxarifadoCadastro;
  opcoes: OpcoesDoAlmoxarifado | undefined;
  opcoesCarregando: boolean;
  onMudou: () => void;
  avisar: (texto: string, ruim?: boolean) => void;
}) {
  const [novo, setNovo] = useState('');
  const [comoPadrao, setComoPadrao] = useState(false);
  const rota = `/almoxarifado/almoxarifados/${almoxarifado.id}/usuarios`;

  const ligar = useMutation({
    mutationFn: async (args: { usuarioId: number; padrao: boolean }) => {
      await api.post(rota, { usuarioId: args.usuarioId, padrao: args.padrao });
      return args;
    },
    onSuccess: (args) => {
      setNovo('');
      setComoPadrao(false);
      avisar(
        `${nomeDoUsuario(opcoes, args.usuarioId)} agora enxerga "${almoxarifado.descricao}" no IXC` +
          (args.padrao ? ', e é o almoxarifado padrão dele.' : '.'),
      );
      onMudou();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const tirar = useMutation({
    mutationFn: async (u: { id: number; nome: string }) => {
      await api.delete(`${rota}/${u.id}`);
      return u;
    },
    onSuccess: (u) => {
      avisar(`${u.nome} não enxerga mais "${almoxarifado.descricao}" no IXC.`);
      onMudou();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const padrao = useMutation({
    mutationFn: async (args: { u: { id: number; nome: string }; padrao: boolean }) => {
      await api.patch(`${rota}/${args.u.id}`, { padrao: args.padrao });
      return args;
    },
    onSuccess: (args) => {
      avisar(
        args.padrao
          ? `"${almoxarifado.descricao}" é o almoxarifado padrão de ${args.u.nome} no IXC — é de lá que a OS dele tira material.`
          : `${args.u.nome} fica sem almoxarifado padrão no IXC.`,
      );
      onMudou();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const mexendo = ligar.isPending || tirar.isPending || padrao.isPending;
  const ligados = new Set(almoxarifado.usuarios.map((u) => u.id));
  const paraLigar = (opcoes?.usuarios ?? []).filter((u) => !ligados.has(u.id));

  return (
    <div className="border-t border-tinta-200 pt-4">
      <div className="rotulo">Quem enxerga este almoxarifado no IXC</div>

      {almoxarifado.usuarios.length === 0 ? (
        <p className="ajuda mt-1">
          Ninguém além do sistema. Ligue o técnico da van para ele ver o almoxarifado no IXC.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-tinta-200 rounded-xl border border-tinta-200">
          {almoxarifado.usuarios.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-[13px] text-tinta-700">
                {u.nome}
                {u.padrao && (
                  <span className="ml-1.5">
                    <Selo tom="marca" pequeno titulo="É de onde a OS dele tira material">
                      padrão
                    </Selo>
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={mexendo}
                onClick={() => padrao.mutate({ u, padrao: !u.padrao })}
                title={
                  u.padrao
                    ? 'Deixa de ser o almoxarifado padrão dele'
                    : 'Passa a ser o almoxarifado padrão dele — e deixa de ser o outro que for'
                }
                className="btn btn-p btn-sutil"
              >
                {u.padrao ? 'Tirar o padrão' : 'Marcar como padrão'}
              </button>
              <button
                type="button"
                disabled={mexendo}
                onClick={() => {
                  if (!confirm(`${u.nome} deixa de enxergar "${almoxarifado.descricao}" no IXC?`)) {
                    return;
                  }
                  tirar.mutate(u);
                }}
                className="btn btn-p btn-sutil"
              >
                Tirar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          className="campo w-auto min-w-[14rem] flex-1"
          disabled={opcoesCarregando || mexendo}
          aria-label="Usuário do IXC para ligar a este almoxarifado"
        >
          <option value="">
            {opcoesCarregando ? 'Lendo os usuários do IXC…' : 'Ligar alguém a este almoxarifado…'}
          </option>
          {paraLigar.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
        <label className="opcao text-[12px]" title="É de onde a OS dele passa a tirar material">
          <input
            type="checkbox"
            className="marcador"
            checked={comoPadrao}
            onChange={(e) => setComoPadrao(e.target.checked)}
            disabled={mexendo}
          />
          e é o padrão dele
        </label>
        <button
          type="button"
          disabled={!novo || mexendo}
          onClick={() => ligar.mutate({ usuarioId: Number(novo), padrao: comoPadrao })}
          className="btn btn-p btn-neutro"
        >
          {ligar.isPending ? 'Ligando…' : 'Ligar'}
        </button>
      </div>
    </div>
  );
}

function nomeDoUsuario(opcoes: OpcoesDoAlmoxarifado | undefined, id: number): string {
  return opcoes?.usuarios.find((u) => u.id === id)?.nome ?? `Usuário ${id}`;
}

function FormularioAlmoxarifado({
  almoxarifado,
  opcoes,
  opcoesCarregando,
  salvando,
  apagando,
  onSalvar,
  onApagar,
  onMudouUsuarios,
  avisar,
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
  /** Ligou, tirou ou mudou o padrão de alguém — a lista tem de ser relida. */
  onMudouUsuarios: () => void;
  avisar: (texto: string, ruim?: boolean) => void;
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

        {almoxarifado && (
          <UsuariosDoAlmoxarifado
            almoxarifado={almoxarifado}
            opcoes={opcoes}
            opcoesCarregando={opcoesCarregando}
            onMudou={onMudouUsuarios}
            avisar={avisar}
          />
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
