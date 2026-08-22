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
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatData } from '../../lib/format';
import { MODULOS } from '../../lib/modulos';
import { PERFIL_DESCRICAO, PERFIL_LABEL, PERFIL_TOM } from '../../lib/status';
import type { PerfilUsuario, UsuarioAdmin } from '../../lib/types';

const PERFIS: PerfilUsuario[] = ['ADMIN', 'RH', 'VISUALIZADOR', 'TECNICO'];

/**
 * O que dizer no lugar dos módulos quando o perfil não os escolhe.
 *
 * O técnico de campo não tem lista: ele abre a Segurança do Trabalho e mais
 * nada, sempre, e é o servidor que garante isso (ver o `ModulosGuard`).
 * Mostrar-lhe botões de módulo aqui seria oferecer uma escolha que não existe.
 */
function SemEscolhaDeModulo() {
  return (
    <span
      className="text-xs text-tinta-400"
      title="O técnico de campo abre uma tela só, e é sempre a mesma"
    >
      só a análise de risco
    </span>
  );
}

export function Usuarios() {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);

  const lista = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => (await api.get<UsuarioAdmin[]>('/usuarios')).data,
  });

  function avisar(texto: string, falhou = false) {
    setErro(falhou);
    setFeedback(texto);
    if (!falhou) setTimeout(() => setFeedback(null), 4000);
  }
  function invalidar() {
    qc.invalidateQueries({ queryKey: ['usuarios'] });
  }

  const alterar = useMutation({
    mutationFn: async ({
      id,
      dados,
    }: {
      id: string;
      dados: Record<string, unknown>;
    }) => (await api.patch<UsuarioAdmin>(`/usuarios/${id}`, dados)).data,
    onSuccess: (u) => {
      avisar(`Login de ${u.nome} atualizado.`);
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/usuarios/${id}`)).data,
    onSuccess: () => {
      avisar('Login excluído.');
      invalidar();
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  function novaSenha(u: UsuarioAdmin) {
    const senha = prompt(
      `Nova senha para ${u.nome} (mínimo 8 caracteres).\nAnote: você não verá de novo.`,
    );
    if (!senha) return;
    if (senha.length < 8) {
      avisar('A senha precisa de pelo menos 8 caracteres.', true);
      return;
    }
    alterar.mutate({ id: u.id, dados: { senha } });
  }

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Usuários"
        titulo="Quem entra no sistema"
        descricao="Cada pessoa com um login próprio. O perfil decide o que ela consegue fazer."
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <NovoUsuario
        onCriado={(nome) => {
          avisar(`Login de ${nome} criado. Passe a senha para a pessoa.`);
          invalidar();
        }}
        onErro={(m) => avisar(m, true)}
      />

      <div className="surgir surgir-2 mt-6">
        <Bloco titulo="Logins ativos e inativos" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-tinta-200">
                  <th className="th">Pessoa</th>
                  <th className="th">Perfil</th>
                  <th className="th">Módulos</th>
                  <th className="th">Criado em</th>
                  <th className="th text-center">Acesso</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.isLoading && (
                  <tr>
                    <td colSpan={6}>
                      <Carregando />
                    </td>
                  </tr>
                )}
                {lista.data?.map((u) => {
                  const souEu = u.id === eu?.id;
                  return (
                    <tr key={u.id} className={`linha ${u.ativo ? '' : 'opacity-50'}`}>
                      <td className="td">
                        <div className="font-medium text-tinta-900">
                          {u.nome}
                          {souEu && (
                            <span className="ml-2 text-[11px] font-normal text-tinta-400">
                              você
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-tinta-400">{u.email}</div>
                      </td>
                      <td className="td">
                        <select
                          value={u.role}
                          disabled={souEu || alterar.isPending}
                          onChange={(e) =>
                            alterar.mutate({
                              id: u.id,
                              dados: { role: e.target.value },
                            })
                          }
                          className="campo w-auto py-1.5 text-xs disabled:opacity-60"
                          title={PERFIL_DESCRICAO[u.role]}
                        >
                          {PERFIS.map((p) => (
                            <option key={p} value={p}>
                              {PERFIL_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <ModulosDoLogin
                          usuario={u}
                          pendente={alterar.isPending}
                          onMudar={(modulos) =>
                            alterar.mutate({ id: u.id, dados: { modulos } })
                          }
                        />
                      </td>
                      <td className="td num text-tinta-500">
                        {formatData(u.createdAt)}
                      </td>
                      <td className="td text-center">
                        {souEu ? (
                          <Selo tom="pago" ponto>
                            Ativo
                          </Selo>
                        ) : (
                          <button
                            onClick={() =>
                              alterar.mutate({
                                id: u.id,
                                dados: { ativo: !u.ativo },
                              })
                            }
                            title={
                              u.ativo
                                ? 'Desligar o acesso sem apagar o histórico'
                                : 'Devolver o acesso'
                            }
                          >
                            <Selo tom={u.ativo ? 'pago' : 'neutro'} ponto>
                              {u.ativo ? 'Ativo' : 'Desligado'}
                            </Selo>
                          </button>
                        )}
                      </td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-3 text-xs font-semibold">
                          <button
                            onClick={() => setEditando(u)}
                            className="text-brand-700 hover:underline"
                          >
                            editar
                          </button>
                          <button
                            onClick={() => novaSenha(u)}
                            className="text-brand-700 hover:underline"
                          >
                            trocar senha
                          </button>
                          {!souEu && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Excluir o login de ${u.nome}? Se for só afastamento, prefira desligar o acesso.`,
                                  )
                                )
                                  excluir.mutate(u.id);
                              }}
                              className="text-rose-500 hover:underline"
                            >
                              excluir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Bloco>
      </div>

      {editando && (
        <Janela
          titulo={`Editar — ${editando.nome}`}
          onFechar={() => setEditando(null)}
        >
          <EditarLogin
            usuario={editando}
            pendente={alterar.isPending}
            onSalvar={(dados) => {
              alterar.mutate(
                { id: editando.id, dados },
                { onSuccess: () => setEditando(null) },
              );
            }}
          />
        </Janela>
      )}

      <div className="surgir surgir-3 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PERFIS.map((p) => (
          <div key={p} className="card p-5">
            <Selo tom={PERFIL_TOM[p]}>{PERFIL_LABEL[p]}</Selo>
            <p className="mt-2.5 text-sm leading-relaxed text-tinta-500">
              {PERFIL_DESCRICAO[p]}
            </p>
          </div>
        ))}
      </div>
    </Pagina>
  );
}

function NovoUsuario({
  onCriado,
  onErro,
}: {
  onCriado: (nome: string) => void;
  onErro: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<PerfilUsuario>('RH');
  /** Vazio = todos, que é o que a API entende e o que a tela mostra ligado. */
  const [modulos, setModulos] = useState<string[]>([]);

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post<UsuarioAdmin>('/usuarios', {
          nome,
          email,
          senha,
          role,
          modulos,
        })
      ).data,
    onSuccess: (u) => {
      setNome('');
      setEmail('');
      setSenha('');
      setRole('RH');
      setModulos([]);
      onCriado(u.nome);
    },
    onError: (err) => onErro(mensagemErro(err)),
  });

  const valido =
    nome.trim().length >= 2 && email.includes('@') && senha.length >= 8;

  return (
    <Bloco titulo="Criar login" className="surgir surgir-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="rotulo" htmlFor="u-nome">
            Nome
          </label>
          <input
            id="u-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            placeholder="Ex.: Maria Souza"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-email">
            E-mail
          </label>
          <input
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="campo"
            placeholder="maria@empresa.com"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-senha">
            Senha provisória
          </label>
          <input
            id="u-senha"
            type="text"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="campo"
            placeholder="mínimo 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="u-perfil">
            Perfil
          </label>
          <select
            id="u-perfil"
            value={role}
            onChange={(e) => setRole(e.target.value as PerfilUsuario)}
            className="campo"
          >
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {PERFIL_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Onde este login trabalha. Nada marcado = todos os módulos que o
          perfil permite, que é o padrão de sempre. */}
      <div className="mt-4">
        <span className="rotulo">Módulos</span>
        {role === 'TECNICO' ? (
          <SemEscolhaDeModulo />
        ) : (
        <div className="flex flex-wrap gap-1.5">
          {MODULOS.map((m) => {
            const ligado = modulos.length === 0 || modulos.includes(m.id);
            const some = m.papeis && !m.papeis.includes(role);
            return (
              <button
                key={m.id}
                type="button"
                disabled={some}
                onClick={() => {
                  const atual =
                    modulos.length === 0 ? MODULOS.map((x) => x.id) : modulos;
                  const novo = ligado
                    ? atual.filter((id) => id !== m.id)
                    : [...atual, m.id];
                  if (novo.length === 0) return;
                  setModulos(novo);
                }}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${corDoModulo(ligado, !!some)}`}
                title={
                  some
                    ? `O perfil ${PERFIL_LABEL[role]} não abre ${m.nome}`
                    : undefined
                }
              >
                {m.nome}
              </button>
            );
          })}
        </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-tinta-100 pt-5">
        <button
          onClick={() => criar.mutate()}
          disabled={!valido || criar.isPending}
          className="btn btn-primario"
        >
          {criar.isPending ? 'Criando…' : 'Criar login'}
        </button>
        <p className="text-xs text-tinta-500">
          {PERFIL_DESCRICAO[role]} A pessoa troca a senha depois, em Minha
          conta.
        </p>
      </div>
    </Bloco>
  );
}

/**
 * Onde este login trabalha.
 *
 * O perfil diz o que a pessoa pode fazer; isto diz onde. Um módulo apagado é um
 * módulo que nem aparece para ela — nem no menu, nem digitando o endereço, e a
 * API recusa do mesmo jeito.
 *
 * Lista vazia é "todos", e é assim que nascem os logins antigos: por isso, sem
 * nada marcado, os três aparecem ligados. Desmarcar um grava a lista dos que
 * sobraram. O ADMIN não se restringe: é ele quem distribui o acesso, e trancar
 * a si mesmo não teria conserto por aqui.
 */
function ModulosDoLogin({
  usuario,
  pendente,
  onMudar,
}: {
  usuario: UsuarioAdmin;
  pendente: boolean;
  onMudar: (modulos: string[]) => void;
}) {
  if (usuario.role === 'ADMIN') {
    return (
      <span className="text-xs text-tinta-400" title="Administrador abre tudo">
        todos
      </span>
    );
  }
  if (usuario.role === 'TECNICO') return <SemEscolhaDeModulo />;

  const lista = usuario.modulos ?? [];
  const todos = lista.length === 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {MODULOS.map((m) => {
        const ligado = todos || lista.includes(m.id);
        const some = m.papeis && !m.papeis.includes(usuario.role);
        return (
          <button
            key={m.id}
            type="button"
            disabled={pendente || some}
            title={
              some
                ? `O perfil ${PERFIL_LABEL[usuario.role]} não abre ${m.nome}`
                : ligado
                  ? `Tirar ${m.nome} deste login`
                  : `Dar ${m.nome} a este login`
            }
            onClick={() => {
              const atual = todos ? MODULOS.map((x) => x.id) : [...lista];
              const novo = ligado
                ? atual.filter((id) => id !== m.id)
                : [...atual, m.id];
              // Sem nenhum marcado a lista voltaria a significar "todos", que é
              // o contrário do que quem desmarcou o último quis dizer.
              if (novo.length === 0) return;
              onMudar(novo);
            }}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${corDoModulo(ligado, !!some)}`}
          >
            {m.nome}
          </button>
        );
      })}
    </div>
  );
}

/** Nome e e-mail de um login. A senha tem caminho próprio; o perfil, também. */
function EditarLogin({
  usuario,
  pendente,
  onSalvar,
}: {
  usuario: UsuarioAdmin;
  pendente: boolean;
  onSalvar: (dados: { nome: string; email: string }) => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [email, setEmail] = useState(usuario.email);

  const valido = nome.trim().length >= 2 && email.includes('@');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) onSalvar({ nome: nome.trim(), email: email.trim() });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="editar-nome">
            Nome
          </label>
          <input
            id="editar-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            autoFocus
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="editar-email">
            E-mail
          </label>
          <input
            id="editar-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="campo"
            autoComplete="off"
          />
          <p className="ajuda">
            É por ele que a pessoa entra. Trocando aqui, o login antigo deixa de
            funcionar no mesmo instante.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!valido || pendente}
          className="btn btn-primario"
        >
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

/**
 * Verde abre, vermelho não.
 *
 * O que a coluna responde é "onde esta pessoa entra?", e a resposta se lê de
 * longe: os módulos ligados são os verdes, e o que está de fora fica vermelho —
 * e não apagado, que se confunde com "ainda não decidi".
 *
 * O que o perfil não alcança é vermelho mais claro e não clica: continua de
 * fora, mas não é escolha de ninguém (Visualizador não abre o RH, que guarda
 * contrato e exame médico).
 */
function corDoModulo(ligado: boolean, foraDoPerfil: boolean): string {
  if (foraDoPerfil) {
    return 'cursor-not-allowed border-rose-200/70 text-rose-400/70 dark:border-rose-500/20 dark:text-rose-400/50';
  }
  if (ligado) {
    return 'border-emerald-300 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-300';
  }
  return 'border-rose-300 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300';
}
