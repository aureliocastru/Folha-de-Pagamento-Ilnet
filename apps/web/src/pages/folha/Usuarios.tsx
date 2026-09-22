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
import { combina } from '../../lib/busca';
import { useAuth } from '../../lib/auth';
import { formatData } from '../../lib/format';
import { AREAS_DO_COLABORADOR, AREAS_PADRAO } from '../../lib/colaborador';
import { MODULOS_DISTRIBUIVEIS as MODULOS } from '../../lib/modulos';
import { PERFIL_DESCRICAO, PERFIL_LABEL, PERFIL_TOM } from '../../lib/status';
import type {
  NivelDeAcesso,
  PerfilDeAcesso,
  PerfilUsuario,
  UsuarioAdmin,
} from '../../lib/types';

const PERFIS: PerfilUsuario[] = ['ADMIN', 'RH', 'VISUALIZADOR', 'TECNICO'];

/*
 * O acesso de um login cabe num valor só, para o mesmo seletor servir aos
 * perfis fixos e aos criados: "RH", ou "perfil:<id>".
 */
const PREFIXO_PERFIL = 'perfil:';

function valorDoAcesso(u: { role: PerfilUsuario; perfil?: { id: string } | null }): string {
  return u.perfil ? `${PREFIXO_PERFIL}${u.perfil.id}` : u.role;
}

/** O que mandar à API para um valor do seletor. */
function dadosDoAcesso(valor: string): { role?: PerfilUsuario; perfilId: string | null } {
  return valor.startsWith(PREFIXO_PERFIL)
    ? { perfilId: valor.slice(PREFIXO_PERFIL.length) }
    : { role: valor as PerfilUsuario, perfilId: null };
}

const NIVEIS: Array<{ valor: NivelDeAcesso; rotulo: string }> = [
  { valor: 'nao', rotulo: 'Não abre' },
  { valor: 'ver', rotulo: 'Só vê' },
  { valor: 'mexer', rotulo: 'Mexe' },
];

function usePerfis() {
  return useQuery({
    queryKey: ['usuarios', 'perfis'],
    queryFn: async () => (await api.get<PerfilDeAcesso[]>('/usuarios/perfis')).data,
  });
}

/** Um colaborador ativo da casa, para ligar a um login. */
interface ColaboradorParaLigar {
  id: string;
  nome: string;
  apelido: string | null;
}

function useColaboradores() {
  return useQuery({
    queryKey: ['usuarios', 'colaboradores'],
    queryFn: async () =>
      (await api.get<ColaboradorParaLigar[]>('/usuarios/colaboradores')).data,
  });
}

/**
 * De quem é o login, no cadastro de funcionários.
 *
 * É por aqui que a tela do colaborador sabe de quem são os pontos e o veículo
 * — sem um segundo login para isso. Vazio é "achar pelo nome", e é assim que
 * nascem os logins: só se escolhe à mão quando o nome não basta (dois xarás,
 * um login com nome de cargo).
 */
function SeletorDeColaborador({
  id,
  valor,
  colaboradores,
  onChange,
}: {
  id?: string;
  valor: string;
  colaboradores: ColaboradorParaLigar[];
  onChange: (valor: string) => void;
}) {
  return (
    <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} className="campo">
      <option value="">Achar pelo nome</option>
      {colaboradores.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
          {c.apelido ? ` (${c.apelido})` : ''}
        </option>
      ))}
    </select>
  );
}

/** O seletor de acesso: os perfis fixos, e embaixo os que o administrador criou. */
function SeletorDeAcesso({
  id,
  valor,
  perfis,
  disabled,
  className = 'campo',
  onChange,
}: {
  id?: string;
  valor: string;
  perfis: PerfilDeAcesso[];
  disabled?: boolean;
  className?: string;
  onChange: (valor: string) => void;
}) {
  return (
    <select
      id={id}
      value={valor}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <optgroup label="Perfis fixos">
        {PERFIS.map((p) => (
          <option key={p} value={p}>
            {PERFIL_LABEL[p]}
          </option>
        ))}
      </optgroup>
      {perfis.length > 0 && (
        <optgroup label="Perfis criados">
          {perfis.map((p) => (
            <option key={p.id} value={`${PREFIXO_PERFIL}${p.id}`}>
              {p.nome}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/**
 * O que um perfil criado permite, módulo por módulo, de relance: verde mexe,
 * azul só vê, e o que não abre nem aparece — a linha fica curta.
 */
function NiveisDoPerfil({ permissoes }: { permissoes: Record<string, NivelDeAcesso> }) {
  const abertos = MODULOS.filter((m) => permissoes[m.id] === 'ver' || permissoes[m.id] === 'mexer');
  if (abertos.length === 0) {
    return <span className="text-xs text-rose-500">não abre nenhum módulo</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {abertos.map((m) => {
        const mexe = permissoes[m.id] === 'mexer';
        return (
          <span
            key={m.id}
            title={mexe ? `Mexe em ${m.nome}` : `Só vê ${m.nome}`}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              mexe
                ? 'border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300'
                : 'border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-500/40 dark:text-sky-300'
            }`}
          >
            {m.nome}
            {!mexe && ' · só vê'}
          </span>
        );
      })}
    </div>
  );
}

/**
 * O que dizer no lugar dos módulos quando o perfil não os escolhe.
 *
 * O técnico de campo não tem lista: ele abre a Segurança do Trabalho e mais
 * nada, sempre, e é o servidor que garante isso (ver o `ModulosGuard`).
 * Mostrar-lhe botões de módulo aqui seria oferecer uma escolha que não existe.
 */
function SemEscolhaDeModulo({ longo = false }: { longo?: boolean }) {
  if (longo) {
    return (
      <p className="ajuda mt-1">
        O técnico de campo abre uma tela só — a do colaborador: pontuação,
        abastecimento e análise de risco — e não tem módulos para distribuir. Para dar um módulo a esta pessoa, troque o
        perfil aqui em cima: os módulos aparecem para escolher.
      </p>
    );
  }
  return (
    <span
      className="text-xs text-tinta-400"
      title="O técnico de campo abre uma tela só, e é sempre a mesma"
    >
      só a tela do colaborador
    </span>
  );
}

/**
 * Os módulos de um login, para clicar — a mesma escolha na criação, na lista e
 * na janela de editar, e por isso escrita uma vez só.
 *
 * Lista vazia é "todos", e é assim que nascem os logins antigos: por isso, sem
 * nada marcado, todos aparecem ligados. Desmarcar o último não grava lista
 * vazia — isso voltaria a significar "todos", o contrário do que quem
 * desmarcou quis dizer.
 */
function ChipsDeModulo({
  role,
  modulos,
  pendente = false,
  pequeno = false,
  onMudar,
}: {
  role: PerfilUsuario;
  modulos: string[];
  pendente?: boolean;
  /** Na linha da tabela, onde o espaço é da largura da coluna. */
  pequeno?: boolean;
  onMudar: (modulos: string[]) => void;
}) {
  const todos = modulos.length === 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      {MODULOS.map((m) => {
        const ligado = todos || modulos.includes(m.id);
        const some = m.papeis && !m.papeis.includes(role);
        return (
          <button
            key={m.id}
            type="button"
            disabled={pendente || some}
            title={
              some
                ? `O perfil ${PERFIL_LABEL[role]} não abre ${m.nome}`
                : ligado
                  ? `Tirar ${m.nome} deste login`
                  : `Dar ${m.nome} a este login`
            }
            onClick={() => {
              const atual = todos ? MODULOS.map((x) => x.id) : [...modulos];
              const novo = ligado
                ? atual.filter((id) => id !== m.id)
                : [...atual, m.id];
              if (novo.length === 0) return;
              onMudar(novo);
            }}
            className={`rounded-full border font-medium transition ${
              pequeno ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
            } ${corDoModulo(ligado, !!some)}`}
          >
            {m.nome}
          </button>
        );
      })}
    </div>
  );
}

export function Usuarios() {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);
  const [vendoSenha, setVendoSenha] = useState<UsuarioAdmin | null>(null);
  const [busca, setBusca] = useState('');

  const lista = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => (await api.get<UsuarioAdmin[]>('/usuarios')).data,
  });
  const perfis = usePerfis();
  const colaboradores = useColaboradores();

  /** Os logins que a busca deixa à vista. */
  const achados = (lista.data ?? []).filter((u) =>
    combina([u.nome, u.email, u.role, u.perfil?.nome, u.colaborador?.nomeCompleto], busca),
  );

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

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Usuários"
        titulo="Quem entra no sistema"
        descricao="Cada pessoa com um login próprio. O perfil decide o que ela consegue fazer."
        // O cabeçalho escuro de cima já tem o "‹ Módulos": duas setas seria dúvida.
        voltar={false}
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'marca'}>{feedback}</Aviso>}

      <NovoUsuario
        perfis={perfis.data ?? []}
        colaboradores={colaboradores.data ?? []}
        logins={lista.data ?? []}
        onCriado={(nome) => {
          avisar(`Login de ${nome} criado. Passe a senha para a pessoa.`);
          invalidar();
        }}
        onErro={(m) => avisar(m, true)}
      />

      <div className="surgir surgir-2 mt-6">
        {/* A mesma busca das outras listas: pelo nome, pelo e-mail, pelo perfil
            ou por quem o login é no cadastro. */}
        {(lista.data?.length ?? 0) > 0 && (
          <input
            type="search"
            className="campo mb-3 max-w-xs"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar pelo nome, e-mail ou perfil"
            aria-label="Procurar login"
            autoComplete="off"
          />
        )}
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
                {achados.length === 0 && !lista.isLoading && (
                  <tr>
                    <td colSpan={6} className="td text-center text-sm text-tinta-400">
                      Nenhum login com "{busca.trim()}" no nome, no e-mail ou no perfil.
                    </td>
                  </tr>
                )}
                {achados.map((u) => {
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
                        <ColaboradorDoLogin usuario={u} />
                      </td>
                      <td className="td">
                        <SeletorDeAcesso
                          valor={valorDoAcesso(u)}
                          perfis={perfis.data ?? []}
                          disabled={souEu || alterar.isPending}
                          onChange={(valor) =>
                            alterar.mutate({ id: u.id, dados: dadosDoAcesso(valor) })
                          }
                          className="campo w-auto py-1.5 text-xs disabled:opacity-60"
                        />
                      </td>
                      <td className="td">
                        {u.perfil ? (
                          <NiveisDoPerfil
                            permissoes={
                              perfis.data?.find((p) => p.id === u.perfil?.id)?.permissoes ?? {}
                            }
                          />
                        ) : (
                          <ModulosDoLogin
                            usuario={u}
                            pendente={alterar.isPending}
                            onMudar={(modulos) =>
                              alterar.mutate({ id: u.id, dados: { modulos } })
                            }
                          />
                        )}
                        <div className="mt-1.5">
                          <ChipsDaArea
                            areas={u.minhaArea ?? []}
                            pendente={alterar.isPending}
                            pequeno
                            onMudar={(minhaArea) =>
                              alterar.mutate({ id: u.id, dados: { minhaArea } })
                            }
                          />
                        </div>
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
                            className="text-brand-600 hover:underline dark:text-brand-300"
                          >
                            editar
                          </button>
                          <button
                            onClick={() => setVendoSenha(u)}
                            className="text-brand-600 hover:underline dark:text-brand-300"
                            title={
                              u.senhaVisivel
                                ? 'Ver, copiar ou trocar a senha'
                                : 'A senha deste login é de antes — gere uma nova para poder vê-la'
                            }
                          >
                            senha
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
            perfis={perfis.data ?? []}
            colaboradores={colaboradores.data ?? []}
            souEu={editando.id === eu?.id}
            pendente={alterar.isPending}
            onSalvar={(dados) => {
              alterar.mutate(
                { id: editando.id, dados },
                { onSuccess: () => setEditando(null) },
              );
            }}
            onSenha={() => {
              setVendoSenha(editando);
              setEditando(null);
            }}
          />
        </Janela>
      )}

      {vendoSenha && (
        <SenhaDoLogin
          usuario={vendoSenha}
          onFechar={() => setVendoSenha(null)}
          onMudou={invalidar}
        />
      )}

      <PerfisDeAcesso perfis={perfis.data} carregando={perfis.isLoading} />

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

/**
 * Quem este login é no cadastro, embaixo do nome, na lista.
 *
 * Sem ninguém ligado, o aviso aparece em qualquer perfil: sem o vínculo, a
 * Minha área não mostra a pontuação — e o almoxarife ou o escritório também
 * têm pontos. O veículo não depende disso: ele pode ficar no nome do login. Só o
 * administrador fica em cinza: é quase sempre o login genérico da casa.
 */
function ColaboradorDoLogin({ usuario }: { usuario: UsuarioAdmin }) {
  const c = usuario.colaborador;
  if (!c) {
    return (
      <div
        className={`mt-0.5 text-[11px] font-medium ${
          usuario.role === 'ADMIN' ? 'text-tinta-400' : 'text-amber-600 dark:text-amber-300'
        }`}
      >
        sem cadastro ligado — editar para ligar
      </div>
    );
  }
  return (
    <div
      className="mt-0.5 text-[11px] text-tinta-500"
      title={
        c.automatico
          ? 'Achado pelo nome. Se estiver errado, escolha a pessoa em "editar".'
          : 'Ligado pelo administrador.'
      }
    >
      é {c.nomeCompleto}
      {c.automatico && <span className="text-tinta-400"> · pelo nome</span>}
    </div>
  );
}

/**
 * O que é da própria pessoa: a pontuação dela, o abastecimento do veículo no
 * nome dela, e ser coordenador — pontuar os outros e transferir entre
 * almoxarifados. Chips iguais aos dos módulos, logo embaixo deles, e para
 * qualquer perfil — o técnico e o administrador também têm pontos e podem ter
 * carro.
 *
 * Diferente dos módulos, aqui nada marcado é nada: "todos" daria o painel de
 * pontuar a quem ninguém escolheu. O coordenador deixa de ver a análise de
 * risco.
 */
function ChipsDaArea({
  areas,
  pendente = false,
  pequeno = false,
  onMudar,
}: {
  areas: string[];
  pendente?: boolean;
  pequeno?: boolean;
  onMudar: (areas: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {AREAS_DO_COLABORADOR.map((a) => {
        const ligado = areas.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            disabled={pendente}
            title={
              a.id === 'pontuar'
                ? ligado
                  ? 'Tirar: deixa de pontuar e de transferir entre almoxarifados, e volta a ver a análise de risco'
                  : 'Coordenador: pontua os funcionários, transfere entre almoxarifados, e não vê a análise de risco'
                : ligado
                  ? `Tirar ${a.nome} deste login`
                  : `Dar ${a.nome} a este login`
            }
            onClick={() =>
              onMudar(ligado ? areas.filter((x) => x !== a.id) : [...areas, a.id])
            }
            className={`rounded-full border font-medium transition ${
              pequeno ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
            } ${corDoModulo(ligado, false)}`}
          >
            {/* No login a marca se chama pelo que a pessoa é: pontuar é uma das
                coisas que o coordenador faz — transferir é a outra. */}
            {a.id === 'pontuar' ? 'Coordenador' : a.nome}
          </button>
        );
      })}
    </div>
  );
}

function NovoUsuario({
  perfis,
  colaboradores,
  logins,
  onCriado,
  onErro,
}: {
  perfis: PerfilDeAcesso[];
  colaboradores: ColaboradorParaLigar[];
  /** Os logins que já existem: é por eles que se sabe se a pessoa já entra. */
  logins: UsuarioAdmin[];
  onCriado: (nome: string) => void;
  onErro: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState('');
  /** Vazio = achar pelo nome depois de criado. */
  const [funcionarioId, setFuncionarioId] = useState('');
  const [minhaArea, setMinhaArea] = useState<string[]>(AREAS_PADRAO);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  /** "RH", ou "perfil:<id>" — ver `valorDoAcesso`. */
  const [acesso, setAcesso] = useState('RH');
  /** Vazio = todos, que é o que a API entende e o que a tela mostra ligado. */
  const [modulos, setModulos] = useState<string[]>([]);

  const { role: roleFixo, perfilId } = dadosDoAcesso(acesso);
  const role: PerfilUsuario = roleFixo ?? 'RH';
  const perfilEscolhido = perfis.find((p) => p.id === perfilId) ?? null;

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post<UsuarioAdmin>('/usuarios', {
          nome,
          email,
          senha,
          ...(perfilId ? { perfilId } : { role, modulos }),
          ...(funcionarioId ? { funcionarioId } : {}),
          minhaArea,
        })
      ).data,
    onSuccess: (u) => {
      setNome('');
      setFuncionarioId('');
      setMinhaArea(AREAS_PADRAO);
      setEmail('');
      setSenha('');
      setAcesso('RH');
      setModulos([]);
      onCriado(u.nome);
    },
    onError: (err) => onErro(mensagemErro(err)),
  });

  // Uma pessoa, um login: a escolhida já entrando por outro, não se cria.
  const jaEntra = funcionarioId
    ? logins.find((l) => l.colaborador?.id === funcionarioId) ?? null
    : null;

  const valido =
    nome.trim().length >= 2 && email.includes('@') && senha.length >= 8 && !jaEntra;

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
            autoComplete="off"
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
            Senha
          </label>
          <div className="flex gap-2">
            <input
              id="u-senha"
              type="text"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="campo min-w-0 flex-1"
              placeholder="mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setSenha(senhaAleatoria())}
              className="btn btn-neutro shrink-0"
              title="Gerar uma senha de dez letras e números"
            >
              Gerar
            </button>
          </div>
        </div>
        <div>
          <label className="rotulo" htmlFor="u-perfil">
            Perfil
          </label>
          <SeletorDeAcesso id="u-perfil" valor={acesso} perfis={perfis} onChange={setAcesso} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="u-colaborador">
            Colaborador
          </label>
          <SeletorDeColaborador
            id="u-colaborador"
            valor={funcionarioId}
            colaboradores={colaboradores}
            onChange={(id) => {
              setFuncionarioId(id);
              // O nome do login sai do cadastro, se ainda não foi digitado (ou se
              // o que está lá é o de outra pessoa escolhida antes).
              const escolhido = colaboradores.find((c) => c.id === id);
              const nomeDoCadastro = colaboradores.some((c) => c.nome === nome);
              if (escolhido && (!nome.trim() || nomeDoCadastro)) setNome(escolhido.nome);
            }}
          />
          {jaEntra ? (
            <p className="mt-1 text-xs font-semibold text-rose-600">
              Essa pessoa já entra pelo login de {jaEntra.nome} ({jaEntra.email}). Uma
              pessoa, um login: use aquele.
            </p>
          ) : (
            <p className="ajuda">
              Quem é esta pessoa no cadastro — é o que mostra a pontuação e o veículo dela
              na tela do colaborador.
            </p>
          )}
        </div>
      </div>

      {/* Onde este login trabalha. Com perfil criado, é ele que diz; com perfil
          fixo, nada marcado = todos os módulos que o perfil permite. Embaixo, o
          que é da própria pessoa — esse, sim, nada marcado é nada. */}
      <div className="mt-4">
        <span className="rotulo">Módulos</span>
        {perfilEscolhido ? (
          <NiveisDoPerfil permissoes={perfilEscolhido.permissoes} />
        ) : role === 'TECNICO' ? (
          <SemEscolhaDeModulo />
        ) : (
          <ChipsDeModulo role={role} modulos={modulos} onMudar={setModulos} />
        )}
        <div className="mt-2">
          <ChipsDaArea areas={minhaArea} onMudar={setMinhaArea} />
        </div>
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
          {perfilEscolhido
            ? perfilEscolhido.descricao || `Perfil ${perfilEscolhido.nome}.`
            : PERFIL_DESCRICAO[role]}{' '}
          A senha fica guardada: dá para vê-la depois, em "senha".
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

  return (
    <ChipsDeModulo
      role={usuario.role}
      modulos={usuario.modulos ?? []}
      pendente={pendente}
      pequeno
      onMudar={onMudar}
    />
  );
}

/**
 * O que se muda num login que já existe: nome, e-mail, perfil e módulos.
 *
 * O perfil e os módulos também se mexem direto na linha, um clique cada. Aqui
 * eles estão de novo porque um depende do outro — é o perfil que diz quais
 * módulos existem para a pessoa —, e porque quem abre "editar" para distribuir
 * acesso não deveria ter de fechar a janela para achar onde se escolhe. A
 * senha continua tendo caminho próprio ("trocar senha").
 */
function EditarLogin({
  usuario,
  perfis,
  colaboradores,
  souEu,
  pendente,
  onSalvar,
  onSenha,
}: {
  usuario: UsuarioAdmin;
  perfis: PerfilDeAcesso[];
  colaboradores: ColaboradorParaLigar[];
  /** O próprio administrador logado: a API não o deixa rebaixar-se. */
  souEu: boolean;
  pendente: boolean;
  onSalvar: (dados: Record<string, unknown>) => void;
  /** Abre a janela da senha deste login. */
  onSenha: () => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [email, setEmail] = useState(usuario.email);
  const [acesso, setAcesso] = useState(valorDoAcesso(usuario));
  const [modulos, setModulos] = useState<string[]>(usuario.modulos ?? []);
  const [ativo, setAtivo] = useState(usuario.ativo);
  /** Só o ligado à mão vem escolhido; o achado pelo nome é o "vazio". */
  const [funcionarioId, setFuncionarioId] = useState(
    usuario.colaborador && !usuario.colaborador.automatico ? usuario.colaborador.id : '',
  );
  const [minhaArea, setMinhaArea] = useState<string[]>(usuario.minhaArea ?? []);

  const { role: roleFixo, perfilId } = dadosDoAcesso(acesso);
  const role: PerfilUsuario = roleFixo ?? 'RH';
  const perfilEscolhido = perfis.find((p) => p.id === perfilId) ?? null;

  const valido = nome.trim().length >= 2 && email.includes('@');
  /* ADMIN abre tudo, TECNICO abre a tela dele e o perfil criado traz os seus:
     nos três não há lista para mandar. */
  const escolheModulos = !perfilId && role !== 'ADMIN' && role !== 'TECNICO';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) {
          onSalvar({
            nome: nome.trim(),
            email: email.trim(),
            ...(perfilId ? { perfilId } : { role, perfilId: null }),
            modulos: escolheModulos ? modulos : undefined,
            funcionarioId: funcionarioId || null,
            minhaArea,
            ...(souEu ? {} : { ativo }),
          });
        }
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
            autoComplete="off"
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
        <div>
          <label className="rotulo" htmlFor="editar-perfil">
            Perfil
          </label>
          <SeletorDeAcesso
            id="editar-perfil"
            valor={acesso}
            perfis={perfis}
            disabled={souEu}
            onChange={setAcesso}
            className="campo disabled:opacity-60"
          />
          <p className="ajuda">
            {souEu
              ? 'É o seu próprio login: o perfil não se rebaixa por aqui.'
              : perfilEscolhido
                ? perfilEscolhido.descricao || `Perfil ${perfilEscolhido.nome}, montado aqui embaixo.`
                : PERFIL_DESCRICAO[role]}
          </p>
        </div>
        <div>
          <span className="rotulo">Acesso e senha</span>
          <div className="flex flex-wrap items-center gap-2">
            {!souEu && (
              <label className="opcao">
                <input
                  type="checkbox"
                  className="marcador"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                />
                Pode entrar
              </label>
            )}
            <button type="button" onClick={onSenha} className="btn btn-neutro btn-p">
              Ver ou trocar a senha
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="editar-colaborador">
            Colaborador
          </label>
          <SeletorDeColaborador
            id="editar-colaborador"
            valor={funcionarioId}
            colaboradores={colaboradores}
            onChange={setFuncionarioId}
          />
          <p className="ajuda">
            {funcionarioId
              ? 'Ligado à mão: a pontuação e o veículo desta pessoa aparecem na tela do colaborador deste login.'
              : usuario.colaborador?.automatico
                ? `Achado pelo nome: ${usuario.colaborador.nomeCompleto}. Se não for esta pessoa, escolha a certa.`
                : 'Pelo nome, não se achou ninguém (ou há dois parecidos). Escolha a pessoa para ligar.'}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <span className="rotulo">Módulos</span>
        {perfilEscolhido ? (
          <NiveisDoPerfil permissoes={perfilEscolhido.permissoes} />
        ) : role === 'ADMIN' ? (
          <p className="ajuda mt-1">
            Administrador abre todos os módulos — é ele quem distribui o acesso
            dos outros. Para limitar onde esta pessoa entra, troque o perfil.
          </p>
        ) : role === 'TECNICO' ? (
          <SemEscolhaDeModulo longo />
        ) : (
          <ChipsDeModulo role={role} modulos={modulos} onMudar={setModulos} />
        )}
        <div className="mt-2">
          <ChipsDaArea areas={minhaArea} onMudar={setMinhaArea} />
        </div>
        <p className="ajuda">
          Pontuação só aparece para quem o login está ligado ao cadastro. Abastecimento,
          para quem tem veículo no nome — no do cadastro ou no do próprio login (o dono, o
          administrador). Quem tem Pontuar não vê a análise de risco.
        </p>
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

/** Dez letras e números, sem os que se confundem — o mesmo desenho da do servidor. */
function senhaAleatoria(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const sorteio = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(sorteio, (n) => letras[n % letras.length]).join('');
}

/**
 * A senha de um login: ver, copiar, gerar uma nova ou digitar uma.
 *
 * A senha só é pedida ao servidor quando se clica em "Mostrar" — cada leitura
 * fica no log de quem viu —, e some da tela ao fechar a janela.
 */
function SenhaDoLogin({
  usuario,
  onFechar,
  onMudou,
}: {
  usuario: UsuarioAdmin;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const [senha, setSenha] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [digitada, setDigitada] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const mostrar = useMutation({
    mutationFn: async () =>
      (await api.get<{ senha: string }>(`/usuarios/${usuario.id}/senha`)).data.senha,
    onSuccess: setSenha,
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (await api.post<{ senha: string }>(`/usuarios/${usuario.id}/gerar-senha`)).data.senha,
    onSuccess: (s) => {
      setSenha(s);
      setAviso('Senha nova gravada. A antiga não entra mais — passe esta para a pessoa.');
      onMudou();
    },
  });

  const definir = useMutation({
    mutationFn: async () => {
      await api.patch(`/usuarios/${usuario.id}`, { senha: digitada });
      return digitada;
    },
    onSuccess: (s) => {
      setSenha(s);
      setDigitada('');
      setAviso('Senha trocada. A antiga não entra mais.');
      onMudou();
    },
  });

  async function copiar() {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Navegador que recusa a área de transferência: a senha está na tela.
    }
  }

  const erro = mostrar.error ?? gerar.error ?? definir.error;

  return (
    <Janela titulo={`Senha — ${usuario.nome}`} onFechar={onFechar}>
      <p className="mb-4 text-sm text-tinta-500">
        Entra com <strong className="text-tinta-800">{usuario.email}</strong>.
      </p>

      <div className="rounded-2xl bg-tinta-50 p-4">
        <p className="eyebrow mb-2">Senha atual</p>
        {senha ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="num select-all rounded-lg border border-tinta-200 bg-papel px-3 py-2 font-mono text-lg font-semibold tracking-wide text-tinta-900">
              {senha}
            </span>
            <button type="button" onClick={copiar} className="btn btn-neutro btn-p">
              {copiada ? 'Copiada!' : 'Copiar'}
            </button>
          </div>
        ) : usuario.senhaVisivel ? (
          <button
            type="button"
            onClick={() => mostrar.mutate()}
            disabled={mostrar.isPending}
            className="btn btn-primario"
          >
            {mostrar.isPending ? 'Buscando…' : 'Mostrar a senha'}
          </button>
        ) : (
          <p className="text-sm text-tinta-600">
            Esta senha é de antes de o sistema passar a guardá-las, e não tem como
            ser lida. Gere uma nova aqui embaixo — a partir dela, dá para ver sempre.
          </p>
        )}
        {aviso && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{aviso}</p>}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="rotulo">Senha nova, sorteada</p>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Gerar uma senha nova para ${usuario.nome}? A atual deixa de entrar.`)) {
                gerar.mutate();
              }
            }}
            disabled={gerar.isPending}
            className="btn btn-neutro w-full"
          >
            {gerar.isPending ? 'Gerando…' : 'Gerar senha nova'}
          </button>
        </div>
        <div>
          <label className="rotulo" htmlFor="senha-digitada">
            Ou digite uma
          </label>
          <div className="flex gap-2">
            <input
              id="senha-digitada"
              type="text"
              value={digitada}
              onChange={(e) => setDigitada(e.target.value)}
              className="campo min-w-0 flex-1"
              placeholder="mínimo 8 caracteres"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => definir.mutate()}
              disabled={digitada.length < 8 || definir.isPending}
              className="btn btn-primario shrink-0"
            >
              Salvar
            </button>
          </div>
        </div>
      </div>

      {erro && <Aviso tom="erro">{mensagemErro(erro)}</Aviso>}
    </Janela>
  );
}

/**
 * Os perfis que o administrador monta. Cada um diz, módulo por módulo, se não
 * abre, se só vê ou se mexe — e vale para todos os logins que o usam.
 */
function PerfisDeAcesso({
  perfis,
  carregando,
}: {
  perfis: PerfilDeAcesso[] | undefined;
  carregando: boolean;
}) {
  const [editando, setEditando] = useState<PerfilDeAcesso | 'novo' | null>(null);

  return (
    <div className="surgir surgir-3 mt-6">
      <Bloco
        titulo="Perfis de acesso"
        acao={
          <button onClick={() => setEditando('novo')} className="btn btn-primario btn-p">
            Criar perfil
          </button>
        }
      >
        {carregando ? (
          <Carregando />
        ) : !perfis?.length ? (
          <p className="text-sm text-tinta-500">
            Nenhum perfil criado ainda. Crie um — "Financeiro", "Almoxarife" — e
            marque em cada módulo se ele não abre, só vê ou mexe. Depois é só
            escolher o perfil no login de cada pessoa.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {perfis.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setEditando(p)}
                className="rounded-2xl border border-tinta-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-500/5"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-tinta-900">{p.nome}</span>
                  <span className="text-xs text-tinta-400">{p.usuarios} login(s)</span>
                </span>
                {p.descricao && <span className="mt-1 block text-xs text-tinta-500">{p.descricao}</span>}
                <span className="mt-2 block">
                  <NiveisDoPerfil permissoes={p.permissoes} />
                </span>
              </button>
            ))}
          </div>
        )}
      </Bloco>

      {editando && (
        <FormularioDePerfil
          perfil={editando === 'novo' ? null : editando}
          onFechar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function FormularioDePerfil({
  perfil,
  onFechar,
}: {
  perfil: PerfilDeAcesso | null;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [descricao, setDescricao] = useState(perfil?.descricao ?? '');
  const [permissoes, setPermissoes] = useState<Record<string, NivelDeAcesso>>(
    () => Object.fromEntries(MODULOS.map((m) => [m.id, perfil?.permissoes[m.id] ?? 'nao'])),
  );

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['usuarios'] });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = { nome: nome.trim(), descricao: descricao.trim() || null, permissoes };
      if (perfil) await api.patch(`/usuarios/perfis/${perfil.id}`, dados);
      else await api.post('/usuarios/perfis', { ...dados, descricao: dados.descricao ?? undefined });
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const apagar = useMutation({
    mutationFn: async () => {
      await api.delete(`/usuarios/perfis/${perfil!.id}`);
    },
    onSuccess: () => {
      recarregar();
      onFechar();
    },
  });

  const erro = salvar.error ?? apagar.error;

  return (
    <Janela titulo={perfil ? `Perfil — ${perfil.nome}` : 'Criar perfil'} onFechar={onFechar}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="rotulo" htmlFor="perfil-nome">
            Nome
          </label>
          <input
            id="perfil-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="campo"
            placeholder="Financeiro, Almoxarife"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="perfil-descricao">
            Para quem é
          </label>
          <input
            id="perfil-descricao"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="campo"
            placeholder="opcional"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="rotulo mt-5">O que abre em cada módulo</p>
      <ul className="lista-dividida rounded-xl border border-tinta-200">
        {MODULOS.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <span className="text-sm font-medium text-tinta-800">{m.nome}</span>
            <span className="grid grid-cols-3 gap-1 rounded-lg bg-tinta-100 p-1">
              {NIVEIS.map((n) => {
                const escolhido = permissoes[m.id] === n.valor;
                return (
                  <button
                    key={n.valor}
                    type="button"
                    onClick={() => setPermissoes((atual) => ({ ...atual, [m.id]: n.valor }))}
                    aria-pressed={escolhido}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      escolhido
                        ? n.valor === 'mexer'
                          ? 'bg-emerald-600 text-white'
                          : n.valor === 'ver'
                            ? 'bg-sky-600 text-white'
                            : 'bg-papel text-rose-600 shadow-sm'
                        : 'text-tinta-500 hover:text-tinta-800'
                    }`}
                  >
                    {n.rotulo}
                  </button>
                );
              })}
            </span>
          </li>
        ))}
      </ul>
      <p className="ajuda">
        "Só vê" consulta tudo do módulo, mas não lança, paga, edita nem apaga. Mudar
        um perfil vale para todos os logins dele, no próximo clique de cada um.
      </p>

      {erro && <Aviso tom="erro">{mensagemErro(erro)}</Aviso>}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {perfil && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Apagar o perfil ${perfil.nome}?`)) apagar.mutate();
            }}
            disabled={apagar.isPending}
            className="btn btn-sutil btn-p mr-auto text-rose-600"
            title={perfil.usuarios > 0 ? 'Troque o perfil dos logins dele antes' : undefined}
          >
            Apagar perfil
          </button>
        )}
        <button onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
        <button
          onClick={() => salvar.mutate()}
          disabled={nome.trim().length < 2 || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : perfil ? 'Salvar' : 'Criar perfil'}
        </button>
      </div>
    </Janela>
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
