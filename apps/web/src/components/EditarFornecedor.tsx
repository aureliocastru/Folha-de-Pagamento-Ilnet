import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, mensagemErro } from '../lib/api';
import type { CategoriaDespesa } from '../lib/types';
import { SeletorDeCategoria } from './SeletorDeCategoria';
import { Aviso, Janela } from './ui';

/** O que a janela precisa saber do fornecedor do IXC. */
export interface FornecedorParaEditar {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  email?: string | null;
  telefone?: string | null;
  /**
   * A categoria padrão, quando quem abre já a tem (a lista de Fornecedores).
   * Sem ela, a janela pergunta à API.
   */
  categoriaId?: string | null;
}

/**
 * Edita o fornecedor: o nome fantasia, no próprio IXC, e a categoria padrão,
 * aqui. Abre da tela de Fornecedores e do lápis do "Lançar conta".
 *
 * Do cadastro do IXC só o nome fantasia se escreve daqui — o resto está à vista
 * para conferir que é esta a pessoa antes de mexer no cadastro dela. Razão
 * social, documento e contato são o que identifica o fornecedor dentro do IXC
 * e mudam a vida de quem emite nota contra ele; o apelido, não: ele existe
 * justamente para quem procura a pessoa pelo nome de que se lembra.
 *
 * A categoria padrão fica aqui porque o IXC não tem onde guardá-la.
 */
export function EditarFornecedor({
  fornecedor,
  modulo,
  onFechar,
  onSalvo,
}: {
  fornecedor: FornecedorParaEditar;
  /** De qual tela veio — decide a lista do cadastro daqui, se ele nascer agora. */
  modulo: 'folha' | 'contas-pagar';
  onFechar: () => void;
  /** Gravou; a frase diz o que mudou. */
  onSalvo: (mensagem: string) => void;
}) {
  const qc = useQueryClient();
  const id = fornecedor.idFornecedor;

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  /* A mesma chave que o "Lançar conta" usa: gravar aqui atualiza lá. */
  const lida = useQuery({
    queryKey: ['categoria-do-fornecedor', id],
    queryFn: async () =>
      (
        await api.get<{ categoriaId: string | null }>(
          `/avulsos/fornecedores-ixc/${id}/categoria`,
        )
      ).data,
    enabled: fornecedor.categoriaId === undefined,
  });
  const categoriaAtual =
    (fornecedor.categoriaId !== undefined
      ? fornecedor.categoriaId
      : lida.data?.categoriaId) ?? '';

  const [fantasia, setFantasia] = useState(fornecedor.nomeFantasia ?? '');
  /** Null enquanto ninguém escolheu: vale a que já está gravada. */
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const categoriaId = escolhida ?? categoriaAtual;

  const mudouFantasia =
    fantasia.trim() !== (fornecedor.nomeFantasia ?? '').trim();
  const mudouCategoria = escolhida !== null && escolhida !== categoriaAtual;

  const salvar = useMutation({
    mutationFn: async () => {
      if (mudouFantasia) {
        await api.patch(`/avulsos/fornecedores-ixc/${id}`, {
          nomeFantasia: fantasia,
        });
      }
      if (mudouCategoria) {
        await api.put(`/avulsos/fornecedores-ixc/${id}/categoria`, {
          categoriaId: categoriaId || null,
          modulo,
        });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['fornecedores-ixc-avulsos'] });
      void qc.invalidateQueries({ queryKey: ['avulsos'] });
      void qc.invalidateQueries({ queryKey: ['categoria-do-fornecedor'] });
      const nomeDaCategoria = categorias.data?.find(
        (c) => c.id === categoriaId,
      )?.nome;
      const partes = [
        !mudouFantasia
          ? null
          : fantasia.trim()
            ? `agora é "${fantasia.trim()}" no IXC`
            : 'ficou sem apelido no IXC',
        !mudouCategoria
          ? null
          : nomeDaCategoria
            ? `abre em ${nomeDaCategoria} ao lançar conta`
            : 'ficou sem categoria padrão',
      ].filter(Boolean);
      onSalvo(`${fornecedor.nome} ${partes.join(' e ')}.`);
    },
  });

  return (
    <Janela titulo={`Editar — ${fornecedor.nome}`} onFechar={onFechar}>
      <div className="grid max-w-2xl grid-cols-1 gap-3">
        <div>
          <label className="rotulo">Categoria padrão</label>
          <SeletorDeCategoria
            categorias={categorias.data}
            value={categoriaId}
            vazio="Sem categoria padrão"
            carregando={categorias.isLoading || lida.isLoading}
            onChange={setEscolhida}
          />
          <p className="ajuda">
            Já vem marcada ao lançar conta deste fornecedor.
          </p>
        </div>
        <div>
          <label className="rotulo" htmlFor="fornecedor-fantasia">
            Fantasia (como é conhecido)
          </label>
          <input
            id="fornecedor-fantasia"
            value={fantasia}
            onChange={(e) => setFantasia(e.target.value)}
            className="campo"
            placeholder="Ex.: Deda pedreiro"
            autoComplete="off"
          />
          <p className="ajuda">
            É por aqui que a busca passa a achar a pessoa, além da razão
            social. Vazio apaga o apelido no IXC.
          </p>
        </div>
      </div>

      {/*
       * O que o IXC já tem, só para conferir. Não é editável de propósito:
       * trocar razão social ou documento de um fornecedor é mexer no que a
       * contabilidade usa para emitir nota, e isso se faz no IXC, com quem
       * responde por aquele cadastro olhando.
       */}
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-tinta-100 pt-4 text-sm sm:grid-cols-2">
        <Conferir titulo="Razão social / Nome">{fornecedor.nome}</Conferir>
        <Conferir titulo="CPF / CNPJ">{fornecedor.cpfCnpj}</Conferir>
        {fornecedor.email !== undefined && (
          <Conferir titulo="E-mail">{fornecedor.email}</Conferir>
        )}
        {fornecedor.telefone !== undefined && (
          <Conferir titulo="Telefone">{fornecedor.telefone}</Conferir>
        )}
        <Conferir titulo="Código no IXC">#{fornecedor.idFornecedor}</Conferir>
      </dl>

      {salvar.isError && (
        <div className="mt-4">
          <Aviso tom="erro">{mensagemErro(salvar.error)}</Aviso>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={(!mudouFantasia && !mudouCategoria) || salvar.isPending}
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onFechar} className="btn btn-neutro">
          Cancelar
        </button>
      </div>
    </Janela>
  );
}

/** Um dado do cadastro do IXC mostrado só para conferência. */
function Conferir({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-tinta-400">{titulo}</dt>
      <dd className="truncate text-tinta-700">{children || '—'}</dd>
    </div>
  );
}
