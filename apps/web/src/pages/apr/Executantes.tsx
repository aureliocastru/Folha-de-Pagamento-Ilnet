import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import { useAuth } from '../../lib/auth';
import { combina, useTermoAdiado } from '../../lib/busca';
import type { PessoaQuePodeExecutar, Usuario } from '../../lib/types';

/** Tirar da lista é escrever: o visualizador e o perfil "só vê" leem. */
function podeMexer(usuario: Usuario | null | undefined): boolean {
  if (!usuario || usuario.role === 'VISUALIZADOR' || usuario.role === 'TECNICO') return false;
  if (usuario.role !== 'ADMIN' && usuario.permissoes) {
    return usuario.permissoes.seguranca === 'mexer';
  }
  return true;
}

/**
 * Quem aparece como executante na análise de risco.
 *
 * A lista de "Adicionar executante" é de quem tem login no sistema, e login
 * tem também quem não vai ao serviço: o escritório, a diretoria. Tirado daqui,
 * some da lista e não entra sozinho na equipe da APR que abre — a de quem
 * está preenchendo já começa com ele, e quem só abre a análise pela equipe
 * não tem por que se retirar toda vez.
 *
 * Não mexe em APR nenhuma: quem já está numa equipe continua nela.
 */
export function Executantes() {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const mexe = podeMexer(usuario);
  const [busca, setBusca] = useState('');
  const termo = useTermoAdiado(busca);
  const [erro, setErro] = useState<string | null>(null);

  const pessoas = useQuery({
    queryKey: ['apr-equipe', 'todos'],
    queryFn: async () =>
      (await api.get<PessoaQuePodeExecutar[]>('/apr/equipe/todos')).data,
  });

  const marcar = useMutation({
    mutationFn: async (args: { id: string; foraDasAprs: boolean }) =>
      (
        await api.patch<PessoaQuePodeExecutar | null>(`/apr/equipe/${args.id}`, {
          foraDasAprs: args.foraDasAprs,
        })
      ).data,
    onSuccess: (_, args) => {
      setErro(null);
      qc.setQueryData<PessoaQuePodeExecutar[]>(['apr-equipe', 'todos'], (lista) =>
        lista?.map((p) => (p.id === args.id ? { ...p, foraDasAprs: args.foraDasAprs } : p)),
      );
      // A lista do formulário da APR também mudou.
      void qc.invalidateQueries({ queryKey: ['apr-equipe'], exact: true });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const filtradas = useMemo(
    () =>
      (pessoas.data ?? []).filter((p) => combina([p.nome, p.apelido, p.funcao], termo)),
    [pessoas.data, termo],
  );
  const naLista = filtradas.filter((p) => !p.foraDasAprs);
  const fora = filtradas.filter((p) => p.foraDasAprs);

  return (
    <Pagina>
      <CabecalhoPagina secao="Segurança do Trabalho" titulo="Executantes" />

      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-tinta-600">
        Quem aparece para escolher como executante da análise de risco. Quem
        for tirado não aparece em “Adicionar executante” e não entra sozinho na
        equipe da APR que abrir. As APRs já abertas não mudam.
      </p>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <input
        type="search"
        className="campo mb-4 max-w-md"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Localizar por nome ou função"
        aria-label="Localizar pessoa"
        autoComplete="off"
      />

      {pessoas.isLoading && <Carregando />}
      {pessoas.isError && <Aviso tom="erro">{mensagemErro(pessoas.error)}</Aviso>}

      {pessoas.data && (
        <div className="space-y-5">
          <Grupo
            titulo={`Fora da lista (${fora.length})`}
            vazio={
              termo
                ? 'Ninguém fora da lista com esse nome.'
                : 'Ninguém foi tirado da lista: todos com login aparecem.'
            }
            pessoas={fora}
            botao={mexe ? 'Devolver à lista' : null}
            ocupado={marcar.isPending ? marcar.variables?.id : undefined}
            onBotao={(p) => marcar.mutate({ id: p.id, foraDasAprs: false })}
          />
          <Grupo
            titulo={`Aparecem como executante (${naLista.length})`}
            vazio={termo ? 'Nenhum resultado.' : 'Ninguém com login no sistema.'}
            pessoas={naLista}
            botao={mexe ? 'Tirar da lista' : null}
            ocupado={marcar.isPending ? marcar.variables?.id : undefined}
            onBotao={(p) => marcar.mutate({ id: p.id, foraDasAprs: true })}
          />
        </div>
      )}
    </Pagina>
  );
}

function Grupo({
  titulo,
  vazio,
  pessoas,
  botao,
  ocupado,
  onBotao,
}: {
  titulo: string;
  vazio: string;
  pessoas: PessoaQuePodeExecutar[];
  /** Null: quem só lê não vê o botão. */
  botao: string | null;
  /** Quem está sendo gravado agora. */
  ocupado?: string;
  onBotao: (p: PessoaQuePodeExecutar) => void;
}) {
  return (
    <Bloco titulo={titulo} semPadding>
      {pessoas.length === 0 ? (
        <Vazio titulo={vazio} />
      ) : (
        <ul className="lista-dividida">
          {pessoas.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-3 px-3.5 py-3 md:px-5"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-medium text-tinta-800">
                  {p.nome}
                  {p.apelido ? ` (${p.apelido})` : ''}
                  {p.foraDasAprs && (
                    <Selo pequeno tom="neutro">
                      fora das APRs
                    </Selo>
                  )}
                </span>
                {p.funcao && (
                  <span className="block truncate text-xs text-tinta-400">{p.funcao}</span>
                )}
              </span>
              {botao && (
                <button
                  type="button"
                  onClick={() => onBotao(p)}
                  disabled={!!ocupado}
                  className={`btn btn-p shrink-0 ${p.foraDasAprs ? 'btn-neutro' : 'btn-sutil'}`}
                >
                  {ocupado === p.id ? 'Gravando…' : botao}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
