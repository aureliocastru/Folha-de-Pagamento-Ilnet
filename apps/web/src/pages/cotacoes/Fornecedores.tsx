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
import type { FornecedorCotacao } from '../../lib/types';

/** O formulário vazio — também é o que "Novo fornecedor" abre. */
const EM_BRANCO = {
  nome: '',
  nomeFantasia: '',
  cnpj: '',
  contato: '',
  telefone: '',
  email: '',
  site: '',
  observacao: '',
};

type Formulario = typeof EM_BRANCO;

/**
 * Quem vende material para a casa.
 *
 * **Não é a lista de fornecedores do IXC**, e a distinção é o motivo de esta
 * tela existir. Lá estão os três mil e duzentos que já receberam dinheiro da
 * empresa — prestador de serviço, concessionária, aluguel, imposto —, e essa
 * lista responde "para quem já pagamos?". A pergunta daqui é outra e a lista é
 * curta: quem tem preço de drop, de ONU, de roteador para dar. Cadastro
 * próprio, um por um.
 *
 * A coluna que importa não é quantos produtos cada um cota — é em quantos ele
 * está mais barato. É ela que diz de quem se compra.
 */
export function Fornecedores() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [verInativos, setVerInativos] = useState(false);
  const [editando, setEditando] = useState<FornecedorCotacao | null>(null);
  const [criando, setCriando] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['cotacoes', 'fornecedores', verInativos],
    queryFn: async () =>
      (
        await api.get<FornecedorCotacao[]>('/cotacoes/fornecedores', {
          params: verInativos ? { inativos: 1 } : {},
        })
      ).data,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 2500);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['cotacoes'] });
  }

  const salvar = useMutation({
    mutationFn: async (args: { id?: string; dados: Partial<Formulario> }) =>
      args.id
        ? (
            await api.patch<FornecedorCotacao>(
              `/cotacoes/fornecedores/${args.id}`,
              args.dados,
            )
          ).data
        : (
            await api.post<FornecedorCotacao>(
              '/cotacoes/fornecedores',
              args.dados,
            )
          ).data,
    onSuccess: (f, args) => {
      setEditando(null);
      setCriando(false);
      avisar(args.id ? `"${f.nome}" atualizado.` : `"${f.nome}" cadastrado.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const alternarAtivo = useMutation({
    mutationFn: async (f: FornecedorCotacao) =>
      (
        await api.patch<FornecedorCotacao>(`/cotacoes/fornecedores/${f.id}`, {
          ativo: !f.ativo,
        })
      ).data,
    onSuccess: (f) => {
      avisar(
        f.ativo
          ? `"${f.nome}" voltou para as opções.`
          : `"${f.nome}" desativado. Os preços dele continuam na comparação.`,
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const excluir = useMutation({
    mutationFn: async (args: { f: FornecedorCotacao; comAsCotacoes: boolean }) =>
      api.delete(`/cotacoes/fornecedores/${args.f.id}`, {
        params: args.comAsCotacoes ? { comAsCotacoes: 1 } : {},
      }),
    onSuccess: (_r, args) => {
      setEditando(null);
      avisar(`"${args.f.nome}" apagado.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const fornecedores = lista.data ?? [];
  const filtrados = fornecedores.filter((f) =>
    busca.trim()
      ? [f.nome, f.nomeFantasia, f.contato, f.cnpj]
          .filter(Boolean)
          .some((t) => t!.toLowerCase().includes(busca.trim().toLowerCase()))
      : true,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Cotações de Preços"
        titulo="Fornecedores"
        descricao="Quem vende material para a casa. É cadastro daqui — não tem relação com os fornecedores do IXC, que são a lista de quem já recebeu dinheiro da empresa."
        acoes={
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="btn btn-primario"
          >
            Novo fornecedor
          </button>
        }
      />

      {feedback && (
        <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>
      )}

      <Bloco
        titulo={`${filtrados.length} ${filtrados.length === 1 ? 'fornecedor' : 'fornecedores'}`}
        semPadding
        acao={
          <label className="opcao text-[12px]">
            <input
              type="checkbox"
              className="marcador"
              checked={verInativos}
              onChange={(e) => setVerInativos(e.target.checked)}
            />
            Mostrar desativados
          </label>
        }
      >
        <div className="px-3.5 py-3 md:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, contato ou CNPJ…"
            className="campo"
            autoComplete="off"
          />
        </div>

        {lista.isLoading && <Carregando />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler a lista">
            {mensagemErro(lista.error)}
          </Vazio>
        )}

        {!lista.isLoading && filtrados.length === 0 && (
          <Vazio titulo="Nenhum fornecedor aqui">
            Cadastre quem vende material para a casa — depois é neles que os
            preços de cada produto vão pendurados.
          </Vazio>
        )}

        {filtrados.length > 0 && (
          <div className="rolagem-fina overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Fornecedor</th>
                  <th className="th">Contato</th>
                  <th className="th text-right">Produtos</th>
                  <th className="th text-right">Mais barato em</th>
                  <th className="th text-right">Cotações</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {filtrados.map((f) => (
                  <tr key={f.id} className="linha">
                    <td className="td">
                      <div className="font-semibold text-tinta-900">
                        {f.nome}
                        {!f.ativo && (
                          <span className="ml-2">
                            <Selo pequeno>desativado</Selo>
                          </span>
                        )}
                      </div>
                      {(f.nomeFantasia || f.cnpj) && (
                        <div className="text-[12px] text-tinta-400">
                          {[f.nomeFantasia, f.cnpj].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <div className="text-tinta-700">{f.contato ?? '—'}</div>
                      {f.telefone && (
                        <div className="text-[12px] text-tinta-400">
                          {f.telefone}
                        </div>
                      )}
                    </td>
                    <td className="td num text-right">{f.produtos}</td>
                    <td className="td text-right">
                      {/* A única coluna que decide alguma coisa: em quantos
                          itens vale a pena comprar dele. */}
                      {f.maisBaratoEm > 0 ? (
                        <Selo tom="pago">{f.maisBaratoEm} itens</Selo>
                      ) : (
                        <span className="text-tinta-400">—</span>
                      )}
                    </td>
                    <td className="td num text-right text-tinta-400">
                      {f.cotacoes}
                    </td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditando(f)}
                          className="btn btn-p btn-neutro"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => alternarAtivo.mutate(f)}
                          className="btn btn-p btn-sutil"
                        >
                          {f.ativo ? 'Desativar' : 'Reativar'}
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
        <FormularioFornecedor
          fornecedor={editando}
          salvando={salvar.isPending}
          apagando={excluir.isPending}
          onSalvar={(dados) =>
            salvar.mutate({ id: editando?.id, dados })
          }
          onApagar={(comAsCotacoes) =>
            editando && excluir.mutate({ f: editando, comAsCotacoes })
          }
          onFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
        />
      )}
    </Pagina>
  );
}

function FormularioFornecedor({
  fornecedor,
  salvando,
  apagando,
  onSalvar,
  onApagar,
  onFechar,
}: {
  /** Null = está criando um novo. */
  fornecedor: FornecedorCotacao | null;
  salvando: boolean;
  apagando: boolean;
  onSalvar: (dados: Formulario) => void;
  onApagar: (comAsCotacoes: boolean) => void;
  onFechar: () => void;
}) {
  const [form, setForm] = useState<Formulario>(() =>
    fornecedor
      ? {
          nome: fornecedor.nome,
          nomeFantasia: fornecedor.nomeFantasia ?? '',
          cnpj: fornecedor.cnpj ?? '',
          contato: fornecedor.contato ?? '',
          telefone: fornecedor.telefone ?? '',
          email: fornecedor.email ?? '',
          site: fornecedor.site ?? '',
          observacao: fornecedor.observacao ?? '',
        }
      : EM_BRANCO,
  );
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);

  const campo = (chave: keyof Formulario) => ({
    value: form[chave],
    onChange: (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [chave]: e.target.value })),
    className: 'campo',
    autoComplete: 'off',
  });

  return (
    <Janela
      titulo={fornecedor ? fornecedor.nome : 'Novo fornecedor'}
      onFechar={onFechar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar(form);
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="rotulo" htmlFor="forn-nome">
              Nome *
            </label>
            <input id="forn-nome" required {...campo('nome')} />
            <p className="ajuda">
              Como a casa chama este fornecedor. É por ele que os preços se
              agrupam — dois cadastros do mesmo lugar dividiriam a lista dele em
              duas.
            </p>
          </div>

          <div>
            <label className="rotulo" htmlFor="forn-fantasia">
              Nome fantasia
            </label>
            <input id="forn-fantasia" {...campo('nomeFantasia')} />
          </div>
          <div>
            <label className="rotulo" htmlFor="forn-cnpj">
              CNPJ
            </label>
            <input id="forn-cnpj" {...campo('cnpj')} />
          </div>

          <div>
            <label className="rotulo" htmlFor="forn-contato">
              Contato
            </label>
            <input id="forn-contato" {...campo('contato')} />
            <p className="ajuda">O vendedor com quem se fala.</p>
          </div>
          <div>
            <label className="rotulo" htmlFor="forn-telefone">
              Telefone
            </label>
            <input id="forn-telefone" {...campo('telefone')} />
          </div>

          <div>
            <label className="rotulo" htmlFor="forn-email">
              E-mail
            </label>
            <input id="forn-email" type="email" {...campo('email')} />
          </div>
          <div>
            <label className="rotulo" htmlFor="forn-site">
              Site
            </label>
            <input id="forn-site" {...campo('site')} />
          </div>

          <div className="md:col-span-2">
            <label className="rotulo" htmlFor="forn-obs">
              Observação
            </label>
            <textarea id="forn-obs" rows={3} {...campo('observacao')} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-tinta-200 pt-4">
          {/*
            Apagar fica longe do botão que salva, e sem cor até ser pedido: o
            que se faz todo dia é desativar, e apagar leva o histórico junto.
          */}
          {fornecedor ? (
            confirmandoApagar ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-rose-700">
                  Apagar leva junto {fornecedor.cotacoes}{' '}
                  {fornecedor.cotacoes === 1 ? 'cotação' : 'cotações'}.
                </span>
                <button
                  type="button"
                  disabled={apagando}
                  onClick={() => onApagar(true)}
                  className="btn btn-p btn-perigo"
                >
                  Apagar mesmo assim
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
                Apagar
              </button>
            )
          ) : (
            <span />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="btn btn-neutro"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || form.nome.trim().length < 2}
              className="btn btn-primario"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </form>
    </Janela>
  );
}
